// ==============================================================================
// MANNA — SUPABASE EDGE FUNCTION: paystack-verify
// Verifies a Paystack transaction (via rider callback OR Paystack Webhook)
// and credits the rider's prepaid wallet idempotently.
// Required Supabase Secret: PAYSTACK_SECRET_KEY
// ==============================================================================

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-paystack-signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

async function verifyPaystackSignature(rawBody: string, signature: string, secret: string): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign']
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const expectedHex = Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return expectedHex.toLowerCase() === signature.trim().toLowerCase();
}

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
        JSON.stringify({ success: false, error: 'PAYSTACK_SECRET_KEY is not configured.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const rawBody = await req.text();
    const webhookSignature = req.headers.get('x-paystack-signature');
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    let reference = '';
    let expectedRiderId: string | null = null;

    if (webhookSignature) {
      // Path A: Paystack Webhook (server-to-server)
      const isValid = await verifyPaystackSignature(rawBody, webhookSignature, paystackSecret);
      if (!isValid) {
        return new Response(
          JSON.stringify({ success: false, error: 'Invalid Paystack webhook signature.' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const event = JSON.parse(rawBody);
      if (event?.event !== 'charge.success') {
        return new Response(
          JSON.stringify({ success: true, ignored: true }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      reference = event?.data?.reference || '';
      expectedRiderId = event?.data?.metadata?.rider_id || null;
    } else {
      // Path B: Authenticated Rider Callback Verification
      const authHeader = req.headers.get('Authorization') || '';
      if (!authHeader.startsWith('Bearer ')) {
        return new Response(
          JSON.stringify({ success: false, error: 'Authentication required.' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const token = authHeader.replace('Bearer ', '').trim();
      const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
      if (userErr || !userData?.user) {
        return new Response(
          JSON.stringify({ success: false, error: 'Invalid session.' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { data: rider } = await supabaseAdmin
        .from('riders')
        .select('id')
        .eq('user_id', userData.user.id)
        .maybeSingle();

      if (!rider) {
        return new Response(
          JSON.stringify({ success: false, error: 'Rider profile not found.' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const parsed = JSON.parse(rawBody || '{}');
      reference = String(parsed.reference || '').trim();
      expectedRiderId = rider.id;
    }

    if (!reference) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing Paystack transaction reference.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Always verify transaction directly with Paystack API
    const verifyRes = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      {
        headers: { Authorization: `Bearer ${paystackSecret}` }
      }
    );
    const verifyJson = await verifyRes.json().catch(() => null);

    if (!verifyRes.ok || !verifyJson?.status || verifyJson?.data?.status !== 'success') {
      return new Response(
        JSON.stringify({
          success: false,
          error: verifyJson?.data?.gateway_response || verifyJson?.message || 'Payment has not completed.'
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const txData = verifyJson.data;
    if (String(txData.currency || '').toUpperCase() !== 'GHS') {
      return new Response(
        JSON.stringify({ success: false, error: 'Unsupported currency.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const metaRiderId = txData.metadata?.rider_id || expectedRiderId;
    if (!metaRiderId || (expectedRiderId && metaRiderId !== expectedRiderId)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Transaction does not belong to this rider.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const amountGhs = Number(txData.amount || 0) / 100;
    const channelLabel = txData.channel === 'mobile_money' ? 'Mobile Money' : 'Card';

    const { data: creditRes, error: creditErr } = await supabaseAdmin.rpc('credit_rider_wallet_paystack', {
      p_rider_id: metaRiderId,
      p_amount: amountGhs,
      p_paystack_ref: reference,
      p_description: `Wallet top-up via Paystack (${channelLabel})`
    });

    if (creditErr || !creditRes?.success) {
      return new Response(
        JSON.stringify({
          success: false,
          error: creditErr?.message || creditRes?.error || 'Could not credit wallet.'
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        amountCredited: amountGhs,
        walletBalance: Number(creditRes.wallet_balance || 0),
        alreadyCredited: Boolean(creditRes.already_credited)
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: unknown) {
    return new Response(
      JSON.stringify({ success: false, error: (err as Error).message || 'Verification failed.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
