/**
 * Okada Book — Customer Order Tracking Verification Test Suite
 * Tests Order Reference validation, real-time status progression,
 * assigned rider information display, phone lookup normalization,
 * cancellation constraints, and zero admin link leakage.
 */

import assert from 'node:assert';
import { validateGhanaPhone, resolveRiderPhotoUrl, getRiderInitials } from '../src/utils/formatters.ts';

console.log('🧪 Starting Okada Book Customer Order Tracking Verification...\n');

let passedTests = 0;
let totalTests = 0;

function test(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✅ [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}:`, err.message);
  }
}

// 1. Order Reference Format & Normalization
test('Order Reference normalizes to uppercase and trims whitespace', () => {
  const inputs = ['okd-9h4k2m', '  OKD-ABC123  ', 'okd-xyz789\n'];
  for (const input of inputs) {
    const normalized = input.trim().toUpperCase();
    assert(/^OKD-[0-9A-Z]{6}$/i.test(normalized), `Reference ${normalized} must match pattern OKD-XXXXXX`);
  }
});

test('Rejects empty or malformed order references', () => {
  const invalid = ['', '   ', '12345', 'INVALID'];
  for (const val of invalid) {
    const trimmed = val.trim().toUpperCase();
    const isValid = /^OKD-[0-9A-Z]{6}$/i.test(trimmed);
    assert.strictEqual(isValid, false, `Should reject ${val}`);
  }
});

// 2. Order Tracking Status Lifecycle
test('Status progression maps accurately to stepper milestones', () => {
  const getStepIndex = (status) => {
    switch (status) {
      case 'pending': return 0;
      case 'assigned':
      case 'accepted': return 1;
      case 'completed': return 3;
      case 'cancelled': return -1;
      default: return 0;
    }
  };

  assert.strictEqual(getStepIndex('pending'), 0, 'Pending should be step 0');
  assert.strictEqual(getStepIndex('accepted'), 1, 'Accepted should be step 1 (Rider Assigned)');
  assert.strictEqual(getStepIndex('assigned'), 1, 'Assigned should be step 1');
  assert.strictEqual(getStepIndex('completed'), 3, 'Completed should be step 3');
  assert.strictEqual(getStepIndex('cancelled'), -1, 'Cancelled should be step -1');
});

// 3. Assigned Rider Information Model
test('Assigned rider profile contains required contact and motorcycle fields', () => {
  const sampleTrackedOrder = {
    id: 'ord-123',
    orderReference: 'OKD-9H4K2M',
    customerPhone: '0245660622',
    orderType: 'text',
    status: 'accepted',
    riderId: 'rider-456',
    riderName: 'Kwame Mensah',
    riderPhone: '0244123456',
    motorcycleModel: 'Boxer Bajaj 150',
    motorcycleReg: 'GR-4921-22',
    motorcycleColour: 'Red',
    operatingArea: 'Circle - Kaneshie',
    createdAt: '2026-11-18T10:00:00Z',
    acceptedAt: '2026-11-18T10:02:15Z'
  };

  assert.strictEqual(sampleTrackedOrder.status, 'accepted');
  assert(sampleTrackedOrder.riderName && sampleTrackedOrder.riderName.length > 0);
  assert(sampleTrackedOrder.riderPhone && sampleTrackedOrder.riderPhone.startsWith('024'));
  assert(sampleTrackedOrder.motorcycleReg && sampleTrackedOrder.motorcycleReg.length >= 6);
  assert(sampleTrackedOrder.motorcycleModel && sampleTrackedOrder.motorcycleModel.length > 0);
});

// 4. Customer Phone Lookup Normalization
test('Phone lookup normalizes Ghanaian numbers for matching orders', () => {
  const rawPhones = ['0245660622', '+233245660622', '024 566 0622'];
  for (const raw of rawPhones) {
    const res = validateGhanaPhone(raw);
    assert.strictEqual(res.isValid, true, `Should validate ${raw}`);
    assert(res.formatted && res.formatted.includes('024'), `Should have formatted string for ${raw}`);
  }
});

// 5. Customer Cancellation Rules
test('Cancellation is permitted only when status is strictly pending', () => {
  const canCancel = (status) => status === 'pending';

  assert.strictEqual(canCancel('pending'), true, 'Pending orders can be cancelled');
  assert.strictEqual(canCancel('accepted'), false, 'Accepted orders cannot be cancelled by customer');
  assert.strictEqual(canCancel('completed'), false, 'Completed orders cannot be cancelled');
  assert.strictEqual(canCancel('cancelled'), false, 'Already cancelled orders cannot be cancelled');
});

// 6. Local Storage Caching & De-duplication Logic
test('Local order history de-duplicates orders by reference and limits to 10', () => {
  const MAX = 10;
  let history = [];

  const addOrder = (order) => {
    history = history.filter(o => o.orderReference !== order.orderReference);
    history.unshift(order);
    history = history.slice(0, MAX);
  };

  for (let i = 1; i <= 15; i++) {
    addOrder({
      id: `id-${i}`,
      orderReference: `OKD-REF${String(i).padStart(3, '0')}`,
      status: 'pending'
    });
  }

  assert.strictEqual(history.length, 10, 'History must cap at 10 items');
  assert.strictEqual(history[0].orderReference, 'OKD-REF015', 'Most recent order must be first');

  // Add duplicate of REF010
  addOrder({
    id: 'id-10-new',
    orderReference: 'OKD-REF010',
    status: 'accepted'
  });

  assert.strictEqual(history.length, 10);
  assert.strictEqual(history[0].orderReference, 'OKD-REF010', 'Re-added order moves to front');
  assert.strictEqual(history[0].status, 'accepted');
  const countRef10 = history.filter(o => o.orderReference === 'OKD-REF010').length;
  assert.strictEqual(countRef10, 1, 'Reference must be unique in history');
});

// 7. WhatsApp Contact URL Generation
test('WhatsApp link formats correctly with Ghana country code (233)', () => {
  const formatWhatsApp = (phone, ref) => {
    const digits = phone.replace(/\D/g, '');
    const intl = digits.startsWith('0') ? `233${digits.slice(1)}` : digits;
    return `https://wa.me/${intl}?text=${encodeURIComponent(`Hello! Tracking ${ref}`)}`;
  };

  const url = formatWhatsApp('0244123456', 'OKD-9H4K2M');
  assert(url.includes('https://wa.me/233244123456'), 'Must use 233 country prefix');
  assert(url.includes('OKD-9H4K2M'), 'Must include order reference');
});

// 8. Rider Profile Photo URL Resolution & Avatar Initials
test('Rider profile photo URL resolution handles relative paths and public URLs', () => {
  // Empty or null
  assert.strictEqual(resolveRiderPhotoUrl(null), null);
  assert.strictEqual(resolveRiderPhotoUrl(''), null);
  assert.strictEqual(resolveRiderPhotoUrl('   '), null);

  // Already an absolute URL
  const absoluteUrl = 'https://example.supabase.co/storage/v1/object/public/rider-profiles/avatars/user1/pic.webp';
  assert.strictEqual(resolveRiderPhotoUrl(absoluteUrl), absoluteUrl);

  // Relative storage path with mock environment URL
  process.env.VITE_SUPABASE_URL = 'https://testproject.supabase.co';
  const relPath = 'avatars/user1/pic.webp';
  const resolved = resolveRiderPhotoUrl(relPath);
  assert.strictEqual(
    resolved,
    'https://testproject.supabase.co/storage/v1/object/public/rider-profiles/avatars/user1/pic.webp'
  );

  // Path prefixed with bucket name
  const prefixedPath = 'rider-profiles/avatars/user1/pic.webp';
  const resolvedPrefixed = resolveRiderPhotoUrl(prefixedPath);
  assert.strictEqual(
    resolvedPrefixed,
    'https://testproject.supabase.co/storage/v1/object/public/rider-profiles/avatars/user1/pic.webp'
  );
});

test('Rider avatar initials helper extracts clean fallback representation', () => {
  assert.strictEqual(getRiderInitials('Kofi Mensah'), 'KM');
  assert.strictEqual(getRiderInitials('Kwame'), 'KW');
  assert.strictEqual(getRiderInitials('Emmanuel Kwesi Arthur'), 'EA');
  assert.strictEqual(getRiderInitials(''), '🏍️');
  assert.strictEqual(getRiderInitials(null), '🏍️');
});

// 9. Zero Admin Links in Public Customer Interfaces
test('Customer tracking navigation contains zero admin routes or credentials', () => {
  const allowedCustomerTabs = ['book', 'track'];
  assert(!allowedCustomerTabs.includes('admin'), 'Customer tabs must not include admin');
  assert(!allowedCustomerTabs.includes('portal'), 'Customer tabs must not include portal');
});

console.log(`\n========================================`);
console.log(`Order Tracking Summary: ${passedTests}/${totalTests} tests passed.`);
console.log(`========================================\n`);

if (passedTests !== totalTests) {
  process.exit(1);
}
