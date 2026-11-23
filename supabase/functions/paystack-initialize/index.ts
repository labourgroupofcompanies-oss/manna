// ==============================================================================
// MANNA — SUPABASE EDGE FUNCTION: paystack-initialize
// Initializes a Paystack GHS Mobile Money / Card top-up for a logged-in rider.
// Required Supabase Secret: PAYSTACK_SECRET_KEY (sk_test_... or sk_live_...)
// ==============================================================================

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const paystackSecret = Deno.env.get('PAYSTACK_SECRET_KEY');
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

    if (!paystackSecret) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Paystack is not configured on the server yet. Please add PAYSTACK_SECRET_KEY in Supabase Secrets.'
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ success: false, error: 'Authentication required.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    const token = authHeader.replace('Bearer ', '').trim();
    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);

    if (userErr || !userData?.user) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid or expired session.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Lookup rider profile
    const { data: rider } = await supabaseAdmin
      .from('riders')
      .select('id, full_name, phone_number')
      .eq('user_id', userData.user.id)
      .maybeSingle();

    if (!rider) {
      return new Response(
        JSON.stringify({ success: false, error: 'Rider profile not found.' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body = await req.json().catch(() => ({}));
    const amountGhs = Number(body.amount);
    const callbackUrl = typeof body.callbackUrl === 'string' && body.callbackUrl.startsWith('http')
      ? body.callbackUrl
      : undefined;

    if (!Number.isFinite(amountGhs) || amountGhs < 3 || amountGhs > 5000) {
      return new Response(
        JSON.stringify({ success: false, error: 'Top-up amount must be between GH₵ 3.00 and GH₵ 5,000.00.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const amountPesewas = Math.round(amountGhs * 100);
    const reference = `MNA_${rider.id.slice(0, 8)}_${Date.now()}`;
    const riderEmail = userData.user.email || `rider_${rider.phone_number}@okadabook.com`;

    const psRes = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${paystackSecret}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: riderEmail,
        amount: amountPesewas,
        currency: 'GHS',
        reference,
        channels: ['mobile_money', 'card'],
        callback_url: callbackUrl,
        metadata: {
          rider_id: rider.id,
          rider_name: rider.full_name,
          rider_phone: rider.phone_number,
          purpose: 'manna_rider_wallet_topup'
        }
      })
    });

    const psJson = await psRes.json().catch(() => null);
    if (!psRes.ok || !psJson?.status || !psJson?.data?.authorization_url) {
      return new Response(
        JSON.stringify({
          success: false,
          error: psJson?.message || 'Could not initialize Paystack checkout.'
        }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        authorizationUrl: psJson.data.authorization_url,
        accessCode: psJson.data.access_code,
        reference: psJson.data.reference
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: unknown) {
    return new Response(
      JSON.stringify({ success: false, error: (err as Error).message || 'Unexpected error.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
