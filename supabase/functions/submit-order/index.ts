// ==============================================================================
// OKADA BOOK — SUPABASE EDGE FUNCTION: submit-order
// Runtime: Deno / TypeScript
// Path: supabase/functions/submit-order/index.ts
// Description: Secure order submission entry point. Validates payload & phone,
//              enforces cooldown abuse protection, stores voice notes to private
//              storage, and inserts orders using the privileged service-role key.
// ==============================================================================

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1';

// 1. CORS Headers for Secure Cross-Origin Invocations
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

// 2. Constants & Limits
const MAX_AUDIO_SIZE_BYTES = 10 * 1024 * 1024; // 10 Megabytes limit
const PHONE_COOLDOWN_SECONDS = 45; // Minimum interval between orders per phone number
const ALLOWED_AUDIO_TYPES = [
  'audio/webm',
  'audio/webm;codecs=opus',
  'audio/mp4',
  'audio/ogg',
  'audio/ogg;codecs=opus',
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-m4a',
  'audio/aac'
];

/**
 * Validate Ghanaian Phone Numbers
 */
function validateGhanaPhone(phone: string): { isValid: boolean; normalized?: string; error?: string } {
  const trimmed = (phone || '').trim();
  if (!trimmed) {
    return { isValid: false, error: 'Phone number is required.' };
  }

  let normalized = trimmed.replace(/[\s-]/g, '');
  if (normalized.startsWith('+233')) {
    normalized = '0' + normalized.slice(4);
  } else if (normalized.startsWith('233')) {
    normalized = '0' + normalized.slice(3);
  }

  if (!/^0\d{9}$/.test(normalized)) {
    return {
      isValid: false,
      error: 'Invalid Ghanaian phone number format. Must be a 10-digit number like 0245660622.'
    };
  }

  const prefix = normalized.slice(0, 3);
  const validPrefixes = [
    '020', '050', // Telecel (Vodafone)
    '024', '054', '055', '059', '053', // MTN
    '026', '056', '027', '057', // AT (AirtelTigo)
    '030', '031', '032', '033', '034', '035', '036', '037', '038', '039' // Landline & Regional
  ];

  if (!validPrefixes.includes(prefix)) {
    return {
      isValid: false,
      error: `Invalid network prefix "${prefix}". Please check your Ghanaian phone number.`
    };
  }

  return { isValid: true, normalized };
}

/**
 * Generate a unique human-readable Order Reference (e.g. OKD-7K9M2P)
 */
function generateOrderReference(): string {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // Exclude ambiguous 0/O, 1/I
  let code = '';
  const randomBytes = new Uint8Array(6);
  crypto.getRandomValues(randomBytes);
  for (let i = 0; i < 6; i++) {
    code += chars[randomBytes[i] % chars.length];
  }
  return `OKD-${code}`;
}

serve(async (req: Request) => {
  // Handle CORS preflight OPTIONS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ success: false, error: 'Method not allowed. Use POST.' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Verify server-side credentials
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment secrets.');
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Backend service configuration error. Service role key not configured.'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Initialize privileged server-side Supabase client
  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false }
  });

  try {
    let customerPhone = '';
    let orderType = '';
    let orderDescription: string | null = null;
    let audioFile: File | Blob | null = null;

    const contentType = req.headers.get('content-type') || '';

    // Parse either multipart/form-data or application/json
    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      customerPhone = (formData.get('customerPhone') as string) || (formData.get('phone') as string) || '';
      orderType = (formData.get('orderType') as string) || '';
      orderDescription = (formData.get('orderDescription') as string) || (formData.get('description') as string) || null;
      audioFile = (formData.get('audioFile') as File) || (formData.get('audio') as File) || null;
    } else if (contentType.includes('application/json')) {
      const json = await req.json();
      customerPhone = json.customerPhone || json.phone || '';
      orderType = json.orderType || '';
      orderDescription = json.orderDescription || json.description || null;
    } else {
      return new Response(
        JSON.stringify({ success: false, error: 'Unsupported Content-Type. Use multipart/form-data.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 1. Validate Phone Number
    const phoneCheck = validateGhanaPhone(customerPhone);
    if (!phoneCheck.isValid || !phoneCheck.normalized) {
      return new Response(
        JSON.stringify({ success: false, error: phoneCheck.error || 'Invalid phone number.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const validatedPhone = phoneCheck.normalized;

    // 2. Validate Order Type
    if (orderType !== 'text' && orderType !== 'voice') {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid orderType. Must be "text" or "voice".' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 3. Abuse Protection: Phone Submission Cooldown
    const cooldownTimestamp = new Date(Date.now() - PHONE_COOLDOWN_SECONDS * 1000).toISOString();
    const { data: recentOrders, error: cooldownError } = await supabaseAdmin
      .from('orders')
      .select('id, created_at')
      .eq('customer_phone', validatedPhone)
      .gt('created_at', cooldownTimestamp)
      .limit(1);

    if (cooldownError) {
      console.warn('Cooldown check query warning:', cooldownError);
    } else if (recentOrders && recentOrders.length > 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Please wait ${PHONE_COOLDOWN_SECONDS} seconds before placing another ride request.`
        }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 4. Validate Content Based on Order Type
    let voiceRecordingPath: string | null = null;

    if (orderType === 'text') {
      if (!orderDescription || !orderDescription.trim()) {
        return new Response(
          JSON.stringify({ success: false, error: 'Text orders require a description of your destination.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (orderDescription.length > 1000) {
        return new Response(
          JSON.stringify({ success: false, error: 'Description exceeds maximum allowed length of 1,000 characters.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      orderDescription = orderDescription.trim();
    } else if (orderType === 'voice') {
      if (!audioFile) {
        return new Response(
          JSON.stringify({ success: false, error: 'Voice orders require an audio recording file.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Validate File Size
      if (audioFile.size === 0) {
        return new Response(
          JSON.stringify({ success: false, error: 'Audio recording is empty. Please record your request.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (audioFile.size > MAX_AUDIO_SIZE_BYTES) {
        return new Response(
          JSON.stringify({ success: false, error: 'Audio recording exceeds the 10MB maximum limit.' }),
          { status: 413, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Validate MIME type
      const fileMime = audioFile.type.toLowerCase();
      const isAllowedMime = ALLOWED_AUDIO_TYPES.some((allowed) => fileMime.startsWith(allowed.split(';')[0]));
      if (!isAllowedMime && fileMime !== 'application/octet-stream') {
        return new Response(
          JSON.stringify({
            success: false,
            error: `Unsupported audio format "${fileMime}". Supported formats: WebM, MP4, OGG, MP3, WAV.`
          }),
          { status: 415, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Generate Unique Storage Path
      const orderUUID = crypto.randomUUID();
      const fileExt = fileMime.includes('mp4') ? 'mp4' : fileMime.includes('ogg') ? 'ogg' : fileMime.includes('wav') ? 'wav' : 'webm';
      voiceRecordingPath = `orders/${orderUUID}/voice_${Date.now()}.${fileExt}`;

      // Upload to Private Bucket 'order-recordings'
      const audioBytes = await audioFile.arrayBuffer();
      const { error: uploadError } = await supabaseAdmin.storage
        .from('order-recordings')
        .upload(voiceRecordingPath, audioBytes, {
          contentType: fileMime || 'audio/webm',
          upsert: false
        });

      if (uploadError) {
        console.error('Failed to upload audio to private storage:', uploadError);
        return new Response(
          JSON.stringify({ success: false, error: 'Failed to upload voice note. Please try again.' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // 5. Generate Unique Order Reference
    let orderReference = generateOrderReference();
    let isUnique = false;
    let attempts = 0;

    while (!isUnique && attempts < 5) {
      attempts++;
      const { data: existingRef } = await supabaseAdmin
        .from('orders')
        .select('id')
        .eq('order_reference', orderReference)
        .maybeSingle();

      if (!existingRef) {
        isUnique = true;
      } else {
        orderReference = generateOrderReference();
      }
    }

    // 6. Insert Order Record into Database
    const { data: insertedOrder, error: insertError } = await supabaseAdmin
      .from('orders')
      .insert({
        order_reference: orderReference,
        customer_phone: validatedPhone,
        order_type: orderType,
        order_description: orderType === 'text' ? orderDescription : null,
        voice_recording_path: orderType === 'voice' ? voiceRecordingPath : null,
        status: 'pending'
      })
      .select('id, order_reference, status, created_at')
      .single();

    if (insertError) {
      console.error('Failed to insert order into database:', insertError);

      // Clean up orphaned audio recording if DB insert fails
      if (voiceRecordingPath) {
        await supabaseAdmin.storage.from('order-recordings').remove([voiceRecordingPath]).catch(() => {});
      }

      return new Response(
        JSON.stringify({ success: false, error: 'Database error placing your order. Please try again.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 7. Return Clean Sanitized Response
    return new Response(
      JSON.stringify({
        success: true,
        orderReference: insertedOrder.order_reference,
        status: insertedOrder.status,
        createdAt: insertedOrder.created_at,
        message: 'Order placed successfully.'
      }),
      { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: unknown) {
    const error = err as Error;
    console.error('Unhandled submit-order error:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'An unexpected error occurred while submitting your order.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
