const assert = require('assert');
const crypto = require('crypto');
const db = require('./db');
const shopify = require('./shopify');
const { generateOrdersWorkbook } = require('./export_engine');

async function runTests() {
  console.log('--- [OrderDrop Test Suite] Starting Verification ---');
  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ FAIL: ${name} ->`, err.message);
      failed++;
    }
  }

  async function testAsync(name, fn) {
    try {
      await fn();
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ FAIL: ${name} ->`, err.message);
      failed++;
    }
  }

  // Test 1: Database CRUD & Multi-Tenancy Isolation
  test('DB: Save and retrieve multi-tenant store data', () => {
    const testDomain = 'test-audit-store.myshopify.com';
    const saved = db.saveShop(testDomain, {
      recipientEmail: 'warehouse@teststore.com',
      scheduleTime: '09:00',
      autoDispatchEnabled: true
    });
    assert.strictEqual(saved.shop, testDomain);
    assert.strictEqual(saved.recipientEmail, 'warehouse@teststore.com');

    const fetched = db.getShop(testDomain);
    assert.strictEqual(fetched.scheduleTime, '09:00');
    assert.strictEqual(fetched.autoDispatchEnabled, true);

    // Clean up
    db.deleteShop(testDomain);
    assert.strictEqual(db.getShop(testDomain), null);
  });

  // Test 2: HMAC Verification Algorithm
  test('Shopify: Timing-safe HMAC calculation and verification', () => {
    const secret = 'mock_secret_key_12345';
    const params = {
      code: 'auth_code_xyz',
      shop: 'test-store.myshopify.com',
      timestamp: '1793552000'
    };
    
    // Sort keys and compute valid HMAC
    const sorted = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&');
    const validHmac = crypto.createHmac('sha256', secret).update(sorted).digest('hex');

    // Should pass
    const isValid = shopify.verifyHmac({ ...params, hmac: validHmac }, secret);
    assert.strictEqual(isValid, true);

    // Altered params should fail
    const isInvalid = shopify.verifyHmac({ ...params, hmac: 'forged_hmac_signature' }, secret);
    assert.strictEqual(isInvalid, false);
  });

  // Test 3: Webhook HMAC Verification
  test('Shopify: Webhook raw body HMAC verification', () => {
    const secret = 'mock_secret_key_12345';
    const rawBody = JSON.stringify({ shop_domain: 'store.myshopify.com' });
    const headerHmac = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64');

    const isValid = shopify.verifyWebhookHmac(rawBody, headerHmac, secret);
    assert.strictEqual(isValid, true);

    const isInvalid = shopify.verifyWebhookHmac(rawBody, 'tampered_base64_hmac', secret);
    assert.strictEqual(isInvalid, false);
  });

  // Test 4: Excel Generation Engine with Real Orders
  await testAsync('Excel: Generates valid workbook buffer with order items', async () => {
    const sampleOrders = [
      {
        name: '#1001',
        date: '2026-11-01',
        customer: 'Test Buyer',
        email: 'buyer@test.com',
        sku: 'TEST-SKU-01',
        item: 'Yoga Mat Pro',
        qty: 2,
        unitPrice: '$45.00',
        total: '$90.00',
        status: 'UNFULFILLED',
        address: '123 Main St, New York, NY'
      }
    ];

    const { buffer, filename } = await generateOrdersWorkbook(sampleOrders, 'test-shop.myshopify.com');
    assert(Buffer.isBuffer(buffer));
    assert(buffer.length > 3000, `Buffer length is ${buffer.length}, expected > 3000 bytes`);
    assert(filename.startsWith('test-shop_Orders_'));
    assert(filename.endsWith('.xlsx'));
  });

  // Test 5: Excel Generation with 0 Orders (Graceful Empty State)
  await testAsync('Excel: Generates valid workbook buffer when 0 orders pending', async () => {
    const { buffer, filename } = await generateOrdersWorkbook([], 'hk-mart.myshopify.com');
    assert(Buffer.isBuffer(buffer));
    assert(buffer.length > 2000);
    assert(filename.includes('hk-mart_Orders_'));
  });

  console.log('--- [Test Suite Summary] ---');
  console.log(`  Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

runTests();
