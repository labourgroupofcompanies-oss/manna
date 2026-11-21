// ==============================================================================
// OKADA BOOK — SUPABASE EDGE FUNCTION: send-push-notification
// Runtime: Deno / TypeScript
// Path: supabase/functions/send-push-notification/index.ts
// Description: Secure Firebase Cloud Messaging (FCM) HTTP v1 push notification
//              dispatch edge function. Generates OAuth 2.0 access tokens via
//              RSA-SHA256 Web Crypto using FIREBASE_SERVICE_ACCOUNT, enforces
//              booking capability token ownership, strict rider approval,
//              failure-resilient deduplication, and precise FCM acceptance reporting.
// ==============================================================================

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1';

// 1. CORS Headers for Secure Cross-Origin Invocations
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

// 2. Types & Interfaces
interface FirebaseServiceAccount {
  type: string;
  project_id: string;
  private_key_id?: string;
  private_key: string;
  client_email: string;
  client_id?: string;
  auth_uri?: string;
  token_uri?: string;
  auth_provider_x509_cert_url?: string;
  client_x509_cert_url?: string;
}

interface PushNotificationRequest {
  tokens?: string[];
  recipient_type: 'customer' | 'rider' | 'admin' | 'all';
  recipient_id?: string;
  recipient_phone?: string;
  order_reference?: string;
  booking_token?: string;
  order_id?: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  icon?: string;
  click_action?: string;
}

// In-memory OAuth 2.0 access token cache
let cachedOAuthToken: { token: string; expiresAt: number } | null = null;

// ============================================================================
// Helper Utilities: Phone Normalization, Web Crypto RSA-SHA256 & OAuth 2.0
// ============================================================================

/**
 * Normalizes Ghanaian phone numbers for strict equality verification
 */
function normalizeGhanaPhone(phone: string): string {
  let clean = (phone || '').replace(/[\s-]/g, '');
  if (clean.startsWith('+233')) {
    clean = '0' + clean.slice(4);
  } else if (clean.startsWith('233')) {
    clean = '0' + clean.slice(3);
  }
  return clean;
}

/**
 * Computes SHA-256 hex digest of a UTF-8 string for booking capability token verification
 */
async function sha256Hex(message: string): Promise<string> {
  const data = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * URL-safe Base64 encoding without padding
 */
function base64UrlEncode(input: string | Uint8Array): string {
  let base64: string;
  if (typeof input === 'string') {
    const bytes = new TextEncoder().encode(input);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    base64 = btoa(binary);
  } else {
    let binary = '';
    for (let i = 0; i < input.byteLength; i++) {
      binary += String.fromCharCode(input[i]);
    }
    base64 = btoa(binary);
  }
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Converts PKCS#8 PEM string to binary DER buffer
 */
function pemToBinary(pem: string): Uint8Array {
  const cleanPem = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/[\r\n\s]/g, '');

  const raw = atob(cleanPem);
  const binary = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    binary[i] = raw.charCodeAt(i);
  }
  return binary;
}

/**
 * Parse and validate Firebase Service Account JSON secret
 */
function parseServiceAccount(raw: string): FirebaseServiceAccount {
  let jsonStr = raw.trim();
  // Handle optional base64 encoded JSON
  if (jsonStr.startsWith('ey') && !jsonStr.startsWith('{')) {
    try {
      jsonStr = atob(jsonStr);
    } catch {
      // Continue with raw text
    }
  }

  const parsed = JSON.parse(jsonStr) as FirebaseServiceAccount;
  if (!parsed.client_email || !parsed.private_key || !parsed.project_id) {
    throw new Error('Invalid service account: client_email, private_key, and project_id are required');
  }

  // Normalize escaped newlines in private key string
  parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
  return parsed;
}

/**
 * Generates Google OAuth 2.0 Bearer access token for FCM v1 API using RS256 JWT
 */
async function getFcmAccessToken(serviceAccount: FirebaseServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  // Check cache (refresh 60 seconds before expiration)
  if (cachedOAuthToken && cachedOAuthToken.expiresAt > now + 60) {
    return cachedOAuthToken.token;
  }

  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: serviceAccount.client_email,
    sub: serviceAccount.client_email,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/firebase.messaging'
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const unsignedJwt = `${encodedHeader}.${encodedPayload}`;

  const derBytes = pemToBinary(serviceAccount.private_key);
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    derBytes.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    new TextEncoder().encode(unsignedJwt)
  );

  const signedJwt = `${unsignedJwt}.${base64UrlEncode(new Uint8Array(signature))}`;

  // Exchange assertion JWT for OAuth access token
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: signedJwt
    })
  });

  if (!tokenResponse.ok) {
    const errorBody = await tokenResponse.text();
    throw new Error(`Google OAuth 2.0 exchange failed (${tokenResponse.status}): ${errorBody}`);
  }

  const tokenData = await tokenResponse.json();
  const accessToken = tokenData.access_token as string;
  const expiresIn = (tokenData.expires_in as number) || 3600;

  cachedOAuthToken = {
    token: accessToken,
    expiresAt: now + expiresIn
  };

  return accessToken;
}

// ============================================================================
// Main HTTP Request Handler
// ============================================================================

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const serviceAccountSecret = Deno.env.get('FIREBASE_SERVICE_ACCOUNT') || '';

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ success: false, error: 'Server configuration error: missing Supabase credentials' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // ========================================================================
    // 1. Caller Authentication & Identity Resolution
    // ========================================================================
    const authHeader = req.headers.get('Authorization') || '';
    const callerJwt = authHeader.replace(/^Bearer\s+/i, '');

    let callerUser: { id: string; email?: string } | null = null;
    let isCallerAdmin = false;
    let callerRiderProfile: { id: string; full_name: string; is_available: boolean; verification_status: string } | null = null;

    if (callerJwt && callerJwt !== Deno.env.get('SUPABASE_ANON_KEY')) {
      const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(callerJwt);
      if (userError || !userData?.user) {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'Authentication error: invalid or expired session token'
          }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      callerUser = { id: userData.user.id, email: userData.user.email };

      // Check if caller is admin
      const { data: adminCheck } = await supabaseAdmin.rpc('is_admin', {
        p_user_id: callerUser.id
      });
      isCallerAdmin = Boolean(adminCheck);

      // Check if caller is rider
      if (!isCallerAdmin) {
        const { data: riderData } = await supabaseAdmin
          .from('riders')
          .select('id, full_name, is_available, verification_status')
          .eq('user_id', callerUser.id)
          .maybeSingle();

        if (riderData) {
          callerRiderProfile = riderData;
        }
      }
    }

    // ========================================================================
    // 2. Validate Payload
    // ========================================================================
    const payload: PushNotificationRequest = await req.json();
    const {
      tokens = [],
      recipient_type,
      recipient_id,
      recipient_phone,
      order_reference,
      booking_token,
      order_id,
      title,
      body,
      data = {},
      icon = '/favicon.svg',
      click_action = '/'
    } = payload;

    if (!title || !body) {
      return new Response(
        JSON.stringify({ success: false, error: 'Title and body are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ========================================================================
    // 3. Authorization Matrix & Security Enforcement
    // ========================================================================

    // Rule A: Supplying arbitrary device tokens directly is strictly restricted to Admins
    if (tokens.length > 0 && !isCallerAdmin) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Security error: only administrators may supply raw device tokens directly'
        }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Rule B: Global broadcast ('all') is strictly restricted to Admins
    if (recipient_type === 'all' && !isCallerAdmin) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Security error: broadcast to all recipients requires administrative privileges'
        }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Rule C: Authenticated caller authorization
    // 1. Authenticated ordinary customer accounts (neither admin nor rider) are strictly blocked
    if (callerUser && !isCallerAdmin && !callerRiderProfile) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Security error: authenticated customer accounts are not authorized to broadcast notifications'
        }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2. Authenticated Rider rules:
    // Riders are ONLY permitted to notify the customer ('customer') of their assigned order.
    // Riders must NEVER broadcast to riders or administrators.
    if (callerUser && !isCallerAdmin && callerRiderProfile) {
      if (recipient_type !== 'customer') {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'Security error: riders are only authorized to notify the customer of their assigned order'
          }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Rider must be approved (reject pending, rejected, suspended, unverified)
      if (callerRiderProfile.verification_status === 'suspended' || callerRiderProfile.verification_status !== 'approved') {
        return new Response(
          JSON.stringify({
            success: false,
            error: `Security error: rider is not fully approved (current status: '${callerRiderProfile.verification_status}')`
          }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Rider must be currently online / active
      if (!callerRiderProfile.is_available) {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'Security error: rider is currently inactive/offline'
          }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (!order_reference) {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'Security error: order_reference required when notifying customer'
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Verify that this order exists and is actively assigned to this specific rider
      const { data: orderData, error: orderErr } = await supabaseAdmin
        .from('orders')
        .select('id, rider_id, status')
        .eq('order_reference', order_reference)
        .maybeSingle();

      if (orderErr || !orderData) {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'Security error: referenced order does not exist'
          }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (orderData.rider_id !== callerRiderProfile.id) {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'Security error: rider is not assigned to this order'
          }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Order must be in active status
      if (!['assigned', 'accepted', 'completed'].includes(orderData.status)) {
        return new Response(
          JSON.stringify({
            success: false,
            error: `Security error: cannot notify customer for order with status '${orderData.status}'`
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Rule D: Unauthenticated (Anonymous) Customer Verification & Capability Token Protection
    if (!callerUser && !isCallerAdmin) {
      // Unauthenticated callers are permitted to initiate rider dispatch ONLY for a new booking
      if (recipient_type !== 'rider') {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'Security error: unauthenticated callers are only permitted to request rider dispatch for a new booking'
          }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (!order_reference) {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'Security error: unauthenticated order alerts require an order_reference'
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // 1. Phone number requirement
      const callerPhone = recipient_phone || (data?.customerPhone as string);
      if (!callerPhone) {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'Security error: customer phone verification required to authorize order broadcast'
          }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Fetch the actual booking record from database (including booking_token_hash)
      const { data: orderData, error: orderErr } = await supabaseAdmin
        .from('orders')
        .select('id, order_reference, status, customer_phone, created_at, booking_token_hash')
        .eq('order_reference', order_reference)
        .maybeSingle();

      if (orderErr || !orderData) {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'Security error: referenced order does not exist'
          }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // 2. Phone ownership check
      const normCallerPhone = normalizeGhanaPhone(callerPhone);
      const normOrderPhone = normalizeGhanaPhone(orderData.customer_phone);

      if (!normCallerPhone || normCallerPhone !== normOrderPhone) {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'Security error: caller phone does not match booking ownership record'
          }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // 3. Cryptographically Secure Booking Capability Token Verification
      // Must supply a valid random capability token whose SHA-256 matches stored hash
      const callerCapabilityToken = booking_token || (data?.bookingToken as string);
      if (!callerCapabilityToken) {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'Security error: missing booking capability token'
          }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Explicitly reject: orders.id or order_reference can NEVER be used as the capability token
      if (
        callerCapabilityToken === orderData.id ||
        callerCapabilityToken.toLowerCase() === orderData.order_reference.toLowerCase()
      ) {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'Security error: order reference or order id cannot be used as booking capability token'
          }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Verify SHA-256 hash of the supplied token matches the database hash
      const suppliedTokenHash = await sha256Hex(callerCapabilityToken);
      if (!orderData.booking_token_hash || suppliedTokenHash !== orderData.booking_token_hash) {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'Security error: invalid booking capability token'
          }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // 4. Verify order is in eligible 'pending' status for rider dispatch
      if (orderData.status !== 'pending') {
        return new Response(
          JSON.stringify({
            success: false,
            error: `Security error: order status is '${orderData.status}', not eligible for rider dispatch`
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // 5. Expiration guard: order must be recent (created within 15 minutes)
      const orderAgeMs = Date.now() - new Date(orderData.created_at).getTime();
      if (orderAgeMs > 15 * 60 * 1000) {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'Security error: booking dispatch window has expired'
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // 6. Repeated notification protection (cooldown deduplication)
      // Only SUCCESSFUL previous dispatches activate the 120-second cooldown
      const { data: recentBroadcast } = await supabaseAdmin
        .from('push_notifications')
        .select('id, created_at, status, data')
        .eq('order_reference', order_reference)
        .eq('recipient_type', 'rider')
        .eq('status', 'sent')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (recentBroadcast) {
        const broadcastAgeSeconds = (Date.now() - new Date(recentBroadcast.created_at).getTime()) / 1000;
        const wasSuccessful = recentBroadcast.data?.fcm_accepted === true || recentBroadcast.data?.realtime_dispatched === true;

        if (broadcastAgeSeconds < 120 && wasSuccessful) {
          return new Response(
            JSON.stringify({
              success: true,
              deliveredByFirebase: false,
              fcmAccepted: false,
              fcmAcceptedCount: 0,
              failedCount: 0,
              tokensCount: 0,
              isSimulated: false,
              isDeduplicated: true,
              message: 'Riders have already been alerted for this booking. Cooldown in effect.'
            }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }
    }

    // ========================================================================
    // 4. Resolve Target Device Tokens Securely via Database
    // ========================================================================
    let targetTokens: string[] = isCallerAdmin && tokens.length > 0 ? [...tokens] : [];

    if (targetTokens.length === 0) {
      if (recipient_type === 'rider') {
        if (recipient_id && isCallerAdmin) {
          // Target ONLY the specific rider (e.g. verification approval, decline, or suspension)
          // regardless of whether they are currently online or offline
          const { data: specificRiderTokens, error: specificErr } = await supabaseAdmin
            .from('fcm_tokens')
            .select('token')
            .eq('user_type', 'rider')
            .eq('user_id', recipient_id)
            .eq('is_active', true);

          if (!specificErr && Array.isArray(specificRiderTokens)) {
            targetTokens = specificRiderTokens.map((r: { token: string }) => r.token);
          }
        } else {
          // Enforce online and non-suspended criteria via get_online_rider_tokens RPC for ride broadcasts
          const { data: riderTokens, error: riderErr } = await supabaseAdmin.rpc('get_online_rider_tokens');
          if (!riderErr && Array.isArray(riderTokens)) {
            targetTokens = riderTokens.map((r: { token: string }) => r.token);
          }
        }
      } else if (recipient_type === 'admin') {
        // Fetch active administrator tokens via get_admin_fcm_tokens RPC
        const { data: adminTokens, error: adminErr } = await supabaseAdmin.rpc('get_admin_fcm_tokens');
        if (!adminErr && Array.isArray(adminTokens)) {
          targetTokens = adminTokens.map((a: { token: string }) => a.token);
        }
      } else if (recipient_type === 'customer') {
        if (order_reference) {
          // Fetch tokens registered for this order reference or customer phone
          const { data: customerTokens, error: custErr } = await supabaseAdmin.rpc('get_order_customer_tokens', {
            p_order_reference: order_reference
          });
          if (!custErr && Array.isArray(customerTokens)) {
            targetTokens = customerTokens.map((c: { token: string }) => c.token);
          }
        } else if (isCallerAdmin) {
          // Administrator test dispatch: target active customer tokens
          const { data: customerTokens } = await supabaseAdmin
            .from('fcm_tokens')
            .select('token')
            .eq('user_type', 'customer')
            .eq('is_active', true)
            .limit(25);
          if (customerTokens && Array.isArray(customerTokens)) {
            targetTokens = customerTokens.map((c: { token: string }) => c.token);
          }
        }
      }
    }

    // Deduplicate and filter empty tokens
    targetTokens = [...new Set(targetTokens.filter((t) => typeof t === 'string' && t.trim().length > 0))];

    // ========================================================================
    // 5. Record Notification in Audit History Table
    // ========================================================================
    const notifAuditId = await supabaseAdmin.rpc('record_push_notification', {
      p_recipient_type: recipient_type,
      p_title: title,
      p_body: body,
      p_order_reference: order_reference || null,
      p_recipient_id: recipient_id || null,
      p_recipient_phone: recipient_phone || null,
      p_data: {
        ...data,
        icon,
        click_action,
        sent_at: new Date().toISOString()
      }
    });

    // ========================================================================
    // 6. Dispatch via Modern FCM HTTP v1 API
    // ========================================================================
    let fcmAccepted = false;
    let acceptedCount = 0;
    let failedCount = 0;
    const deliveryErrors: string[] = [];

    if (serviceAccountSecret && targetTokens.length > 0) {
      try {
        const serviceAccount = parseServiceAccount(serviceAccountSecret);
        const accessToken = await getFcmAccessToken(serviceAccount);
        const fcmUrl = `https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`;

        // Format string-only data dictionary for FCM v1 specification
        const fcmDataPayload: Record<string, string> = {};
        for (const [key, value] of Object.entries(data)) {
          if (value !== undefined && value !== null) {
            fcmDataPayload[key] = typeof value === 'string' ? value : String(value);
          }
        }
        fcmDataPayload['click_action'] = click_action;
        if (order_reference) {
          fcmDataPayload['orderReference'] = order_reference;
        }

        for (const token of targetTokens) {
          try {
            const messageBody = {
              message: {
                token,
                notification: {
                  title,
                  body
                },
                data: fcmDataPayload,
                webpush: {
                  headers: {
                    Urgency: 'high'
                  },
                  notification: {
                    title,
                    body,
                    icon,
                    badge: '/favicon.svg',
                    tag: order_reference || 'okada-book-notification',
                    requireInteraction: true
                  },
                  fcm_options: {
                    link: click_action
                  }
                }
              }
            };

            const fcmResponse = await fetch(fcmUrl, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json; UTF-8'
              },
              body: JSON.stringify(messageBody)
            });

            if (fcmResponse.ok) {
              acceptedCount++;
            } else {
              failedCount++;
              const errorJson = await fcmResponse.json().catch(() => null);
              const errorCode = errorJson?.error?.details?.[0]?.errorCode;
              const errorStatus = errorJson?.error?.status;
              const errorMessage = (errorJson?.error?.message || `HTTP ${fcmResponse.status}`) as string;

              deliveryErrors.push(`FCM error (${fcmResponse.status}): ${errorMessage}`);

              // Strict token cleanup: Delete token ONLY when Firebase explicitly identifies
              // the registration token itself as unregistered, not found, or malformed
              const isUnregistered =
                errorCode === 'UNREGISTERED' ||
                (fcmResponse.status === 404 && (errorStatus === 'NOT_FOUND' || errorMessage.toLowerCase().includes('token')));

              const isMalformedToken =
                errorCode === 'INVALID_ARGUMENT' && errorMessage.toLowerCase().includes('registration token');

              if (isUnregistered || isMalformedToken) {
                await supabaseAdmin.from('fcm_tokens').delete().eq('token', token);
              }
            }
          } catch (tokenErr) {
            failedCount++;
            deliveryErrors.push(String(tokenErr));
          }
        }

        fcmAccepted = acceptedCount > 0;
      } catch (fcmInitErr) {
        fcmAccepted = false;
        deliveryErrors.push(`FCM v1 initialization error: ${(fcmInitErr as Error).message}`);
      }
    }

    // ========================================================================
    // 7. Update Audit Log Status & Build Transparent Response
    // ========================================================================
    const hasServiceAccount = Boolean(serviceAccountSecret);
    const isSimulated = !hasServiceAccount;

    // If dispatch failed completely, mark audit record as failed so deduplication cooldown does NOT block retries
    if (hasServiceAccount && targetTokens.length > 0 && acceptedCount === 0) {
      if (notifAuditId) {
        await supabaseAdmin
          .from('push_notifications')
          .update({
            status: 'failed',
            error_message: deliveryErrors.join('; ') || 'FCM delivery failed for all target tokens'
          })
          .eq('id', notifAuditId);
      }
    } else if (notifAuditId) {
      await supabaseAdmin
        .from('push_notifications')
        .update({
          data: {
            ...data,
            fcm_accepted: fcmAccepted,
            realtime_dispatched: isSimulated,
            accepted_count: acceptedCount
          }
        })
        .eq('id', notifAuditId);
    }

    // Precise notification reporting (distinguishes FCM acceptance from confirmed device delivery)
    const message = hasServiceAccount
      ? `FCM HTTP v1 accepted ${acceptedCount} message(s) for delivery (${failedCount} failed, ${targetTokens.length} target tokens). Note: FCM acceptance confirms server handover to Google; device presentation depends on client device connectivity.`
      : `Notification recorded in Supabase audit history and broadcast via Realtime (${targetTokens.length} tokens registered). Remote push to background devices via FCM HTTP v1 requires the FIREBASE_SERVICE_ACCOUNT secret.`;

    return new Response(
      JSON.stringify({
        success: true,
        deliveredByFirebase: hasServiceAccount && fcmAccepted,
        fcmAccepted,
        fcmAcceptedCount: acceptedCount,
        failedCount,
        tokensCount: targetTokens.length,
        isSimulated,
        message,
        errors: deliveryErrors.length > 0 ? deliveryErrors.slice(0, 5) : undefined
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, error: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
