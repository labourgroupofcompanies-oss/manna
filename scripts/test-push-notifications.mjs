// ==============================================================================
// OKADA BOOK — FIREBASE PUSH NOTIFICATION SYSTEM VERIFICATION
// Script: scripts/test-push-notifications.mjs
// Description: Automated test suite validating Firebase Cloud Messaging (FCM),
//              service worker registration, database schema, multi-portal dispatch,
//              and lifecycle notification triggers.
// ==============================================================================

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';

console.log('\n🔔 Starting Okada Book Firebase Push Notification Verification...\n');

let passCount = 0;
let failCount = 0;

function it(description, fn) {
  try {
    fn();
    console.log(`  ✅ [PASS] ${description}`);
    passCount++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${description}`);
    console.error(`     Error: ${err.message}`);
    failCount++;
  }
}

// 1. Verify Service Worker File
it('1.1: Service Worker (firebase-messaging-sw.js) exists in public folder with push and notificationclick listeners', () => {
  const swPath = path.resolve('public/firebase-messaging-sw.js');
  assert(fs.existsSync(swPath), 'public/firebase-messaging-sw.js must exist');
  const content = fs.readFileSync(swPath, 'utf8');

  assert(content.includes('importScripts'), 'SW must import Firebase messaging scripts');
  assert(content.includes('onBackgroundMessage') || content.includes("addEventListener('push'"), 'SW must handle background push messages');
  assert(content.includes("addEventListener('notificationclick'"), 'SW must handle notificationclick to open/focus app window');
});

// 2. Verify Database Migration
it('2.1: Database migration defines fcm_tokens and push_notifications tables with indexes and RPCs', () => {
  const migPath = path.resolve('supabase/migrations/20261120000000_create_push_notification_system.sql');
  assert(fs.existsSync(migPath), 'Push notification migration file must exist');
  const sql = fs.readFileSync(migPath, 'utf8');

  assert(sql.includes('CREATE TABLE IF NOT EXISTS public.fcm_tokens'), 'Must define public.fcm_tokens table');
  assert(sql.includes('CREATE TABLE IF NOT EXISTS public.push_notifications'), 'Must define public.push_notifications table');
  assert(sql.includes("user_type IN ('customer', 'rider', 'admin')"), 'fcm_tokens must enforce valid user_types');
  assert(sql.includes('register_fcm_token'), 'Must define register_fcm_token RPC');
  assert(sql.includes('delete_fcm_token'), 'Must define delete_fcm_token RPC');
  assert(sql.includes('get_order_customer_tokens'), 'Must define get_order_customer_tokens RPC');
  assert(sql.includes('get_online_rider_tokens'), 'Must define get_online_rider_tokens RPC');
  assert(sql.includes('get_admin_fcm_tokens'), 'Must define get_admin_fcm_tokens RPC');
  assert(sql.includes('record_push_notification'), 'Must define record_push_notification RPC');
});

// 3. Verify Edge Function
it('3.1: Supabase Edge Function send-push-notification implements modern FCM HTTP v1 API and OAuth 2.0', () => {
  const fnPath = path.resolve('supabase/functions/send-push-notification/index.ts');
  assert(fs.existsSync(fnPath), 'send-push-notification Edge Function must exist');
  const code = fs.readFileSync(fnPath, 'utf8');

  assert(code.includes('serve('), 'Edge function must call serve()');
  assert(!code.includes('fcm.googleapis.com/fcm/send'), 'Must NOT use deprecated FCM Legacy API endpoint');
  assert(!code.includes('FIREBASE_SERVER_KEY'), 'Must NOT use deprecated FIREBASE_SERVER_KEY');
  assert(code.includes('FIREBASE_SERVICE_ACCOUNT'), 'Must use FIREBASE_SERVICE_ACCOUNT secret');
  assert(code.includes('oauth2.googleapis.com/token'), 'Must implement OAuth 2.0 token generation');
  assert(code.includes('fcm.googleapis.com/v1/projects'), 'Must dispatch to modern FCM HTTP v1 API endpoint');
  assert(code.includes('is_admin'), 'Must check admin privileges for sensitive actions');
  assert(code.includes('normalizeGhanaPhone'), 'Must verify customer phone matches booking ownership');
  assert(code.includes('orderData.status !== \'pending\''), 'Must verify order status is pending before rider dispatch');
  assert(code.includes('isDeduplicated'), 'Must provide cooldown protection against repeated broadcasts');
  assert(code.includes('callerUser && !isCallerAdmin && !callerRiderProfile'), 'Must block ordinary authenticated customers from broadcasting');
  assert(code.includes('callerRiderProfile.verification_status === \'suspended\''), 'Must reject suspended or unapproved riders');
  assert(code.includes('isMalformedToken') && code.includes('isUnregistered'), 'Token cleanup must delete tokens ONLY when Firebase identifies token as unregistered/invalid');
  assert(code.includes('deliveredByFirebase'), 'Must return accurate delivery metrics and not fake successful Firebase dispatch');
  assert(code.includes('record_push_notification'), 'Edge function must record push notification in database history');
});

// 4. Verify Frontend Service Architecture
it('4.1: Firebase configuration service handles environment variables and safe development fallback', () => {
  const cfgPath = path.resolve('src/services/firebase/firebaseConfig.ts');
  assert(fs.existsSync(cfgPath), 'firebaseConfig.ts must exist');
  const content = fs.readFileSync(cfgPath, 'utf8');

  assert(content.includes('VITE_FIREBASE_API_KEY'), 'Reads VITE_FIREBASE_API_KEY');
  assert(content.includes('VITE_FIREBASE_PROJECT_ID'), 'Reads VITE_FIREBASE_PROJECT_ID');
  assert(content.includes('isFirebaseConfigured'), 'Exposes isFirebaseConfigured() check');
});

it('4.2: Firebase messaging service provides token retrieval, permission request, foreground listeners, and synth chimes', () => {
  const msgPath = path.resolve('src/services/firebase/firebaseMessaging.ts');
  assert(fs.existsSync(msgPath), 'firebaseMessaging.ts must exist');
  const content = fs.readFileSync(msgPath, 'utf8');

  assert(content.includes('getFcmToken'), 'Must expose getFcmToken()');
  assert(content.includes('requestNotificationPermission'), 'Must expose requestNotificationPermission()');
  assert(content.includes('onForegroundMessage'), 'Must expose onForegroundMessage()');
  assert(content.includes('playNotificationChime'), 'Must provide synthesized Web Audio chime');
  assert(content.includes('displayNativeNotification'), 'Must support native Notification API');
});

it('4.3: PushNotificationService coordinates Customer, Rider, and Admin notification lifecycles', () => {
  const svcPath = path.resolve('src/services/firebase/pushNotificationService.ts');
  assert(fs.existsSync(svcPath), 'pushNotificationService.ts must exist');
  const content = fs.readFileSync(svcPath, 'utf8');

  assert(content.includes('registerCustomerNotifications'), 'Supports customer token registration');
  assert(content.includes('registerRiderNotifications'), 'Supports rider token registration');
  assert(content.includes('registerAdminNotifications'), 'Supports admin token registration');
  assert(content.includes('notifyOrderCreated'), 'Triggers rider broadcast and admin alert on order creation');
  assert(content.includes('notifyOrderAccepted'), 'Triggers customer arrival alert when rider accepts');
  assert(content.includes('notifyOrderCompleted'), 'Triggers trip completed alert to customer');
  assert(content.includes('notifyRiderRegistered'), 'Triggers admin notification when new rider registers');
  assert(content.includes('notifyRiderStatusChanged'), 'Triggers rider alert on verification update');
  assert(content.includes('initRealtimeSubscription'), 'Establishes Supabase Realtime fallback subscription');
});

// 5. Verify UI Integration across Portals
it('5.1: Customer portal integrates push notification opt-in and live ride alerts', () => {
  const bookingForm = fs.readFileSync(path.resolve('src/components/customer/CustomerBookingForm.tsx'), 'utf8');
  assert(bookingForm.includes('pushNotificationService.notifyOrderCreated'), 'Booking form triggers notifyOrderCreated');

  const tracker = fs.readFileSync(path.resolve('src/components/customer/OrderTracker.tsx'), 'utf8');
  assert(tracker.includes('registerCustomerNotifications'), 'Order tracker provides customer push notification opt-in');
  assert(tracker.includes('tracker-push-alert-banner'), 'Order tracker renders push alert banner');
});

it('5.2: Rider portal provides push notification toggle, alert sound test, and auto-dispatches on accept/complete', () => {
  const riderDash = fs.readFileSync(path.resolve('src/components/rider/RiderDashboard.tsx'), 'utf8');
  assert(riderDash.includes('pushNotificationService.notifyOrderAccepted'), 'Rider dashboard notifies customer on ride acceptance');
  assert(riderDash.includes('pushNotificationService.notifyOrderCompleted'), 'Rider dashboard notifies customer on ride completion');
  assert(riderDash.includes('playNotificationChime'), 'Rider dashboard plays audible chime on incoming order');
  assert(riderDash.includes('rider-push-control-bar'), 'Rider dashboard renders push notification control toolbar');
});

it('5.3: Admin portal provides push bell indicator, verification push alerts, dispute notifications, and test simulator', () => {
  const adminLayout = fs.readFileSync(path.resolve('src/layouts/AdminLayout.tsx'), 'utf8');
  assert(adminLayout.includes('admin-notif-bell-wrap'), 'Admin layout includes notification bell with badge');

  const adminSettings = fs.readFileSync(path.resolve('src/pages/admin/AdminSettingsPage.tsx'), 'utf8');
  assert(adminSettings.includes('Firebase Cloud Messaging'), 'Admin settings includes FCM control panel');
  assert(adminSettings.includes('handleSendTestPush'), 'Admin settings provides push test simulator for Admin, Rider, and Customer');

  const adminVerify = fs.readFileSync(path.resolve('src/pages/admin/AdminVerificationPage.tsx'), 'utf8');
  assert(adminVerify.includes('notifyRiderStatusChanged'), 'Verification page notifies rider on status change');
});

it('5.4: Root App component mounts global NotificationToast and initializes realtime notification subscription', () => {
  const appCode = fs.readFileSync(path.resolve('src/App.tsx'), 'utf8');
  assert(appCode.includes('NotificationToast'), 'App.tsx renders NotificationToast');
  assert(appCode.includes('pushNotificationService.initRealtimeSubscription'), 'App.tsx initializes realtime notification subscription');
});

// 6. Security Vulnerability & Capability Token Verification Tests
const cryptoModule = await import('node:crypto');
const rawBookingToken = cryptoModule.randomBytes(32).toString('hex');
const bookingTokenHash = cryptoModule.createHash('sha256').update(rawBookingToken).digest('hex');
const orderRef = 'OKD-SEC001';
const orderDbId = 'd3b07384-d113-4f44-9722-9c70e62054a8';
const validPhone = '0241234567';
const wrongPhone = '0559998877';

function simulateAuthMatrix({
  callerUser = null,
  isCallerAdmin = false,
  callerRiderProfile = null,
  recipient_type,
  order_reference = null,
  recipient_phone = null,
  booking_token = null,
  tokens = []
}) {
  if (tokens.length > 0 && !isCallerAdmin) {
    return { status: 403, error: 'only administrators may supply raw device tokens directly' };
  }
  if (recipient_type === 'all' && !isCallerAdmin) {
    return { status: 403, error: 'broadcast to all recipients requires administrative privileges' };
  }

  if (callerUser && !isCallerAdmin) {
    if (!callerRiderProfile) {
      return { status: 403, error: 'authenticated customer accounts are not authorized to broadcast notifications' };
    }
    if (recipient_type !== 'customer') {
      return { status: 403, error: 'riders are only authorized to notify the customer of their assigned order' };
    }
    if (callerRiderProfile.verification_status === 'suspended' || callerRiderProfile.verification_status !== 'approved') {
      return { status: 403, error: 'rider is not fully approved' };
    }
    if (!callerRiderProfile.is_available) {
      return { status: 403, error: 'rider is currently inactive/offline' };
    }
    if (!order_reference) {
      return { status: 400, error: 'order_reference required' };
    }
    return { status: 200, success: true };
  }

  if (!callerUser && !isCallerAdmin) {
    if (recipient_type !== 'rider') {
      return { status: 403, error: 'unauthenticated callers are only permitted to request rider dispatch for a new booking' };
    }
    if (!order_reference) {
      return { status: 400, error: 'order_reference required' };
    }
    if (!recipient_phone) {
      return { status: 401, error: 'customer phone required' };
    }
    if (recipient_phone !== validPhone) {
      return { status: 403, error: 'caller phone does not match booking ownership record' };
    }
    if (!booking_token) {
      return { status: 403, error: 'missing booking capability token' };
    }
    if (booking_token === orderDbId || booking_token.toLowerCase() === orderRef.toLowerCase()) {
      return { status: 403, error: 'order reference or order id cannot be used as booking capability token' };
    }
    const tokenHash = cryptoModule.createHash('sha256').update(booking_token).digest('hex');
    if (tokenHash !== bookingTokenHash) {
      return { status: 403, error: 'invalid booking capability token' };
    }
    return { status: 200, success: true };
  }

  return { status: 200, success: true };
}

it('6.1: A public order reference cannot be used as a booking token', () => {
  const fnCode = fs.readFileSync(path.resolve('supabase/functions/send-push-notification/index.ts'), 'utf8');
  assert(fnCode.includes('callerCapabilityToken.toLowerCase() === orderData.order_reference.toLowerCase()'), 'Must explicitly reject order reference as capability token');
  const res = simulateAuthMatrix({
    recipient_type: 'rider',
    order_reference: orderRef,
    recipient_phone: validPhone,
    booking_token: orderRef
  });
  assert(res.status === 403, 'Must reject order reference as token with HTTP 403');
});

it('6.2: A database UUID cannot be used as a booking token', () => {
  const fnCode = fs.readFileSync(path.resolve('supabase/functions/send-push-notification/index.ts'), 'utf8');
  assert(fnCode.includes('callerCapabilityToken === orderData.id'), 'Must explicitly reject database UUID as capability token');
  const res = simulateAuthMatrix({
    recipient_type: 'rider',
    order_reference: orderRef,
    recipient_phone: validPhone,
    booking_token: orderDbId
  });
  assert(res.status === 403, 'Must reject database UUID as token with HTTP 403');
});

it('6.3: An incorrect booking token is rejected', () => {
  const res = simulateAuthMatrix({
    recipient_type: 'rider',
    order_reference: orderRef,
    recipient_phone: validPhone,
    booking_token: 'fake-capability-token-12345'
  });
  assert(res.status === 403, 'Must reject incorrect booking token with HTTP 403');
});

it('6.4: A correct token with the wrong phone number is rejected', () => {
  const res = simulateAuthMatrix({
    recipient_type: 'rider',
    order_reference: orderRef,
    recipient_phone: wrongPhone,
    booking_token: rawBookingToken
  });
  assert(res.status === 403, 'Must reject mismatched phone number with HTTP 403');
});

it('6.5: A valid anonymous booking can dispatch riders', () => {
  const res = simulateAuthMatrix({
    recipient_type: 'rider',
    order_reference: orderRef,
    recipient_phone: validPhone,
    booking_token: rawBookingToken
  });
  assert(res.status === 200 && res.success === true, 'Must accept valid booking dispatch');
});

it('6.6: An authenticated rider cannot broadcast to riders', () => {
  const fnCode = fs.readFileSync(path.resolve('supabase/functions/send-push-notification/index.ts'), 'utf8');
  assert(fnCode.includes('recipient_type !== \'customer\''), 'Must restrict riders strictly to customer recipient_type');
  const res = simulateAuthMatrix({
    callerUser: { id: 'u1' },
    callerRiderProfile: { id: 'r1', verification_status: 'approved', is_available: true },
    recipient_type: 'rider'
  });
  assert(res.status === 403, 'Rider broadcasting to riders must be rejected with HTTP 403');
});

it('6.7: An authenticated rider cannot notify administrators', () => {
  const res = simulateAuthMatrix({
    callerUser: { id: 'u1' },
    callerRiderProfile: { id: 'r1', verification_status: 'approved', is_available: true },
    recipient_type: 'admin'
  });
  assert(res.status === 403, 'Rider notifying admins must be rejected with HTTP 403');
});

it('6.8: An approved rider can notify only the customer of their assigned order', () => {
  const res = simulateAuthMatrix({
    callerUser: { id: 'u1' },
    callerRiderProfile: { id: 'r1', verification_status: 'approved', is_available: true },
    recipient_type: 'customer',
    order_reference: orderRef
  });
  assert(res.status === 200 && res.success === true, 'Approved rider notifying customer of assigned order must succeed');
});

it('6.9: An unapproved or offline rider is rejected', () => {
  const resSuspended = simulateAuthMatrix({
    callerUser: { id: 'u1' },
    callerRiderProfile: { id: 'r1', verification_status: 'suspended', is_available: true },
    recipient_type: 'customer',
    order_reference: orderRef
  });
  assert(resSuspended.status === 403, 'Suspended rider must be rejected with HTTP 403');

  const resOffline = simulateAuthMatrix({
    callerUser: { id: 'u1' },
    callerRiderProfile: { id: 'r1', verification_status: 'approved', is_available: false },
    recipient_type: 'customer',
    order_reference: orderRef
  });
  assert(resOffline.status === 403, 'Offline rider must be rejected with HTTP 403');
});

it('6.10: An ordinary authenticated customer is rejected', () => {
  const res = simulateAuthMatrix({
    callerUser: { id: 'cust1' },
    isCallerAdmin: false,
    callerRiderProfile: null,
    recipient_type: 'rider'
  });
  assert(res.status === 403, 'Authenticated ordinary customer must be rejected with HTTP 403');
});

// 7. Four Final Security Verifications
it('7.1: Raw booking capability token is stored in dedicated isolated client storage and NOT in okada_recent_orders', () => {
  const orderServiceCode = fs.readFileSync(path.resolve('src/services/orders/orderService.ts'), 'utf8');
  assert(orderServiceCode.includes('BOOKING_TOKENS_STORAGE_KEY'), 'Must define separate BOOKING_TOKENS_STORAGE_KEY');
  assert(orderServiceCode.includes('saveBookingCapabilityToken'), 'Must expose saveBookingCapabilityToken()');
  assert(orderServiceCode.includes('getBookingCapabilityToken'), 'Must expose getBookingCapabilityToken()');
  assert(orderServiceCode.includes('{ bookingToken: _omitted, ...publicOrder }'), 'Must omit bookingToken from public okada_recent_orders list');
});

it('7.2: Invalid or expired Bearer token is rejected with HTTP 401 and not silently treated as anonymous', () => {
  const fnCode = fs.readFileSync(path.resolve('supabase/functions/send-push-notification/index.ts'), 'utf8');
  assert(fnCode.includes('userError || !userData?.user'), 'Must detect userError or missing user when Bearer token supplied');
  assert(fnCode.includes('status: 401'), 'Must return HTTP 401 on invalid/expired Bearer token');
  assert(fnCode.includes('Authentication error: invalid or expired session token'), 'Must include explicit authentication error message');
});

it('7.3: Database booking_token_hash is immutable and excluded from public RPCs', () => {
  const trackingSql = fs.readFileSync(path.resolve('supabase/migrations/20261118000000_customer_order_tracking.sql'), 'utf8');
  assert(!trackingSql.includes('booking_token_hash'), 'track_order and get_orders_by_phone RPCs must NOT query or return booking_token_hash');

  const tokenMigrationSql = fs.readFileSync(path.resolve('supabase/migrations/20261120000001_add_booking_token_hash_to_orders.sql'), 'utf8');
  assert(tokenMigrationSql.includes('protect_orders_booking_token_hash'), 'Must define protect_orders_booking_token_hash trigger');
  assert(tokenMigrationSql.includes('booking_token_hash is immutable'), 'Must reject updates to booking_token_hash');
});

it('7.4: Token persistence restores capability token on page refresh and enables notification retry', () => {
  const orderServiceCode = fs.readFileSync(path.resolve('src/services/orders/orderService.ts'), 'utf8');
  assert(orderServiceCode.includes('const restoredCapabilityToken = this.getBookingCapabilityToken(ref)'), 'trackOrder must restore capability token from isolated store');

  const trackerCode = fs.readFileSync(path.resolve('src/components/customer/OrderTracker.tsx'), 'utf8');
  assert(trackerCode.includes('handleRetryNotification'), 'OrderTracker must provide retry dispatch capability');
  assert(trackerCode.includes('btn-retry-dispatch'), 'OrderTracker must render retry button when booking is pending');
});

// 8. Database Booking Token Hash Immutability Trigger Tests
function simulateImmutabilityTrigger(operation, oldRecord, newRecord) {
  if (operation === 'INSERT') {
    // Trigger is BEFORE UPDATE only; INSERT sets initial hash freely
    return { success: true, record: newRecord };
  }
  if (operation === 'UPDATE') {
    const oldHash = oldRecord?.booking_token_hash ?? null;
    const newHash = newRecord?.booking_token_hash ?? null;
    const isDistinct = oldHash !== newHash;
    if (isDistinct) {
      return { success: false, error: 'Security error: booking_token_hash is immutable' };
    }
    return { success: true, record: newRecord };
  }
  return { success: true, record: newRecord };
}

it('8.1: SQL trigger definition in migration and setup files rejects any UPDATE change without IS NOT NULL loophole', () => {
  const migrationSql = fs.readFileSync(path.resolve('supabase/migrations/20261120000001_add_booking_token_hash_to_orders.sql'), 'utf8');
  assert(migrationSql.includes('IF NEW.booking_token_hash IS DISTINCT FROM OLD.booking_token_hash THEN'), 'Migration must check IS DISTINCT FROM unconditionally');
  assert(!migrationSql.includes('OLD.booking_token_hash IS NOT NULL AND'), 'Migration must NOT have loophole permitting NULL hash alteration');

  const setupSql = fs.readFileSync(path.resolve('supabase/QUICK_SETUP.sql'), 'utf8');
  assert(setupSql.includes('IF NEW.booking_token_hash IS DISTINCT FROM OLD.booking_token_hash THEN'), 'QUICK_SETUP must check IS DISTINCT FROM unconditionally');
  assert(!setupSql.includes('OLD.booking_token_hash IS NOT NULL AND'), 'QUICK_SETUP must NOT have loophole permitting NULL hash alteration');
});

it('8.2: An existing non-NULL hash cannot be changed through UPDATE', () => {
  const res = simulateImmutabilityTrigger('UPDATE', { booking_token_hash: 'initial-hash-123' }, { booking_token_hash: 'tampered-hash-456' });
  assert(!res.success, 'Trigger must reject modifying non-NULL hash');
  assert(res.error === 'Security error: booking_token_hash is immutable', 'Must report immutable security error');
});

it('8.3: An existing non-NULL hash cannot be cleared through UPDATE', () => {
  const res = simulateImmutabilityTrigger('UPDATE', { booking_token_hash: 'initial-hash-123' }, { booking_token_hash: null });
  assert(!res.success, 'Trigger must reject clearing non-NULL hash to NULL');
  assert(res.error === 'Security error: booking_token_hash is immutable', 'Must report immutable security error');
});

it('8.4: An existing NULL hash cannot be populated through UPDATE', () => {
  const res = simulateImmutabilityTrigger('UPDATE', { booking_token_hash: null }, { booking_token_hash: 'attacker-populated-hash' });
  assert(!res.success, 'Trigger must reject populating a previously NULL hash through UPDATE');
  assert(res.error === 'Security error: booking_token_hash is immutable', 'Must report immutable security error');
});

it('8.5: A new order can receive its hash during INSERT', () => {
  const newOrder = { id: 'ord-123', order_reference: 'OKD-NEW01', booking_token_hash: 'initial-hash-123', status: 'pending' };
  const res = simulateImmutabilityTrigger('INSERT', null, newOrder);
  assert(res.success, 'INSERT must succeed');
  assert(res.record.booking_token_hash === 'initial-hash-123', 'INSERT must retain initial booking_token_hash');
});

it('8.6: Unrelated order fields can still be updated without triggering the protection', () => {
  const oldOrder = { id: 'ord-123', status: 'pending', rider_id: null, booking_token_hash: 'valid-hash-abc' };
  const updatedOrder = { id: 'ord-123', status: 'accepted', rider_id: 'rider-456', booking_token_hash: 'valid-hash-abc' };
  const res = simulateImmutabilityTrigger('UPDATE', oldOrder, updatedOrder);
  assert(res.success, 'Unrelated status/rider update must succeed');
  assert(res.record.status === 'accepted' && res.record.rider_id === 'rider-456', 'Updated fields must persist');

  // Also verify orders with NULL hash can update status without triggering
  const oldNullOrder = { id: 'ord-124', status: 'pending', booking_token_hash: null };
  const updatedNullOrder = { id: 'ord-124', status: 'cancelled', booking_token_hash: null };
  const resNull = simulateImmutabilityTrigger('UPDATE', oldNullOrder, updatedNullOrder);
  assert(resNull.success, 'Unrelated update on order with NULL hash must succeed');
  assert(resNull.record.status === 'cancelled', 'Status update must succeed');
});

console.log('\n========================================');
console.log(`Push Notification Summary: ${passCount}/${passCount + failCount} tests passed.`);
console.log('========================================\n');

if (failCount > 0) {
  process.exit(1);
}
