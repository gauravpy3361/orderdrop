require('dotenv').config();
const express = require('express');
const https = require('https');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const selfsigned = require('selfsigned');

const db = require('./db');
const shopify = require('./shopify');
const { generateOrdersWorkbook } = require('./export_engine');
const scheduler = require('./scheduler');

const app = express();
app.set('trust proxy', 1);

const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const APP_URL = process.env.APP_URL || 'https://orderdrop.onrender.com';
const CRON_SECRET = process.env.CRON_SECRET || 'orderdrop_cron_secret_secure_key';
const SESSION_SECRET = CLIENT_SECRET || 'orderdrop_production_session_secure_key';

// Disable X-Powered-By
app.disable('x-powered-by');

// Security Headers with Helmet
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        frameAncestors: ["'self'", "https://*.myshopify.com", "https://admin.shopify.com"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.shopify.com", "https://unpkg.com"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'"]
      }
    },
    crossOriginEmbedderPolicy: false
  })
);

// Global Rate Limiter for API routes (Max 120 reqs / 15 mins)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

// Stricter Rate Limiter for Email Sending (Max 10 reqs / 15 mins)
const emailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Email dispatch rate limit reached. Please wait a few minutes.' },
  standardHeaders: true,
  legacyHeaders: false
});

// Raw body parser for Shopify Webhooks (required for HMAC verification)
app.use('/webhooks', express.raw({ type: 'application/json' }));

// Standard body parsers for all other routes
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// HTML Escaping Helper to prevent XSS
function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Authentication Middleware for API endpoints (prevents tenant IDOR & token leaks)
function verifyShopAuth(req, res, next) {
  const shop = req.body.shop || req.query.shop;
  const token = req.headers['x-orderdrop-token'] || req.query.token;

  if (!shop || !shopify.isValidShopDomain(shop)) {
    return res.status(400).json({ success: false, error: 'Invalid or missing shop domain format.' });
  }

  const hasValidToken = shopify.verifySessionToken(token, shop, SESSION_SECRET);
  const hasValidHmac = req.query.hmac && shopify.verifyHmac(req.query, SESSION_SECRET);

  if (!hasValidToken && !hasValidHmac) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Invalid or expired session credentials.' });
  }

  next();
}

// Ensure default test store is registered in db if present
const DEFAULT_SHOP = process.env.SHOP_DOMAIN || 'hk-mart-cfoepmjd.myshopify.com';
if (!db.getShop(DEFAULT_SHOP)) {
  db.saveShop(DEFAULT_SHOP, {
    shop: DEFAULT_SHOP,
    recipientEmail: process.env.MERCHANT_EMAIL || '',
    plan: 'Starter ($9.99/mo)',
    subscriptionStatus: 'active'
  });
}

// -------------------------------------------------------------
// 1. PUBLIC SAAS / EMBEDDED DASHBOARD ROUTE
// -------------------------------------------------------------
app.get('/', async (req, res) => {
  const shopQuery = req.query.shop;
  const isEmbedded = req.query.embedded === '1' || req.query.host || Boolean(shopQuery);

  if (isEmbedded && shopQuery) {
    if (!shopify.isValidShopDomain(shopQuery)) {
      return res.status(400).send('<h3>Invalid store domain. Please provide a valid .myshopify.com address.</h3>');
    }

    const cleanShop = shopQuery.toLowerCase().trim();

    // Verify HMAC when coming from Shopify embedded admin
    if (CLIENT_SECRET && (req.query.hmac || req.query.embedded)) {
      const isValidHmac = shopify.verifyHmac(req.query, CLIENT_SECRET);
      if (!isValidHmac) {
        return res.status(401).send('<h3>Unauthorized: Invalid Shopify HMAC signature</h3>');
      }
    }

    let shopData = db.getShop(cleanShop);
    if (!shopData) {
      shopData = db.saveShop(cleanShop, {
        shop: cleanShop
      });
    }

    // Attempt to fetch real unfulfilled orders if access token is present
    let orders = [];
    let fetchError = null;
    if (shopData.accessToken) {
      try {
        orders = await shopify.fetchUnfulfilledOrders(shopData.shop, shopData.accessToken);
      } catch (err) {
        fetchError = err.message;
      }
    }

    const sessionToken = shopify.createSessionToken(cleanShop, SESSION_SECRET);
    return res.send(renderDashboard(shopData, orders, fetchError, sessionToken));
  }

  return res.send(renderLandingPage());
});

// -------------------------------------------------------------
// 2. SHOPIFY OAUTH HANDSHAKE ROUTES
// -------------------------------------------------------------
app.get('/auth', (req, res) => {
  const shop = req.query.shop;
  if (!shop) {
    return res.status(400).send('Missing "shop" parameter. Please provide your myshopify.com address.');
  }

  const cleanShop = shop.replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase().trim();
  if (!shopify.isValidShopDomain(cleanShop)) {
    return res.status(400).send('Security error: Invalid shop domain format.');
  }

  const stateNonce = crypto.randomBytes(16).toString('hex');
  const redirectUri = `${APP_URL}/auth/callback`;
  const scopes = 'read_orders,write_orders';
  const installUrl = `https://${cleanShop}/admin/oauth/authorize?client_id=${CLIENT_ID}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${stateNonce}`;

  res.redirect(installUrl);
});

app.get('/auth/callback', async (req, res) => {
  const { shop, hmac, code } = req.query;

  if (!shop || !code) {
    return res.status(400).send('Invalid OAuth callback: missing shop or code.');
  }

  if (!shopify.isValidShopDomain(shop)) {
    return res.status(400).send('Security check failed: Invalid shop domain format.');
  }

  // 1. Strictly verify HMAC Signature
  if (!hmac || !CLIENT_SECRET) {
    return res.status(400).send('Security check failed: Missing security credentials.');
  }

  const isValid = shopify.verifyHmac(req.query, CLIENT_SECRET);
  if (!isValid) {
    return res.status(400).send('Security check failed: HMAC verification failed.');
  }

  try {
    // 2. Exchange authorization code for offline access token
    const tokenData = await shopify.exchangeCodeForToken(shop, code, CLIENT_ID, CLIENT_SECRET);
    
    // 3. Persist in Multi-Tenant Database
    const existing = db.getShop(shop);
    db.saveShop(shop, {
      accessToken: tokenData.accessToken,
      scopes: tokenData.scope,
      installedAt: new Date().toISOString(),
      subscriptionStatus: existing?.subscriptionStatus || 'trial',
      trialEndsAt: existing?.trialEndsAt || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      plan: existing?.plan || 'Free Trial (7 Days)'
    });

    console.log(`[OAuth] Successfully authenticated shop: ${shop}`);

    // 4. Redirect into Shopify Admin Embedded App
    res.redirect(`https://admin.shopify.com/store/${shop.replace('.myshopify.com', '')}/apps/orderdrop-1`);
  } catch (err) {
    console.error('[OAuth] Token exchange error:', err.message);
    res.status(500).send(`Authentication failed: ${escapeHtml(err.message)}`);
  }
});

// -------------------------------------------------------------
// 3. SHOPIFY RECURRING BILLING ROUTES (Monthly $9.99 / Annual $99.99)
// -------------------------------------------------------------
app.get('/api/billing/subscribe', async (req, res) => {
  const shop = req.query.shop || DEFAULT_SHOP;
  const planType = req.query.plan === 'annual' ? 'annual' : 'monthly';
  const shopData = db.getShop(shop);

  if (!shopData || !shopData.accessToken) {
    return res.redirect(`/auth?shop=${encodeURIComponent(shop)}`);
  }

  try {
    const returnUrl = `${APP_URL}/api/billing/confirm?shop=${encodeURIComponent(shop)}&plan=${planType}`;
    const isTestFlag = process.env.SHOPIFY_BILLING_TEST === 'true' || process.env.NODE_ENV !== 'production';
    const subscription = await shopify.createAppSubscription(shop, shopData.accessToken, returnUrl, isTestFlag, planType);

    if (subscription.confirmationUrl) {
      return res.redirect(subscription.confirmationUrl);
    }
    res.redirect(`/?shop=${encodeURIComponent(shop)}&billing=success`);
  } catch (err) {
    console.error('[Billing] Subscription create error:', err.message);
    res.status(500).send(`Billing initiation failed: ${escapeHtml(err.message)}`);
  }
});

app.get('/api/billing/confirm', async (req, res) => {
  const shop = req.query.shop || DEFAULT_SHOP;
  const chargeId = req.query.charge_id;
  const planType = req.query.plan === 'annual' ? 'annual' : 'monthly';
  const planLabel = planType === 'annual' ? 'Annual Plan ($99.99/yr)' : 'Monthly Plan ($9.99/mo)';
  const shopData = db.getShop(shop);

  if (shopData?.accessToken) {
    try {
      const activeCheck = await shopify.checkActiveSubscription(shop, shopData.accessToken);
      console.log(`[Billing] Confirmed subscriptions for ${shop}:`, activeCheck.subscriptions);
    } catch (err) {
      console.warn('[Billing] GraphQL verification note:', err.message);
    }
  }

  db.saveShop(shop, {
    subscriptionStatus: 'active',
    subscriptionId: chargeId || 'sub_active',
    plan: planLabel
  });

  res.redirect(`/?shop=${encodeURIComponent(shop)}&billing=confirmed`);
});

// -------------------------------------------------------------
// 4. MERCHANT API ENDPOINTS (AUTHENTICATED & RATE-LIMITED)
// -------------------------------------------------------------
app.use('/api', apiLimiter);

// Direct Excel Download Endpoint (Secured by Session Token or HMAC)
app.get('/api/export', async (req, res) => {
  const shop = req.query.shop || DEFAULT_SHOP;
  const token = req.query.token;

  if (!shopify.isValidShopDomain(shop)) {
    return res.status(400).json({ error: 'Invalid store domain format' });
  }

  const isValidToken = shopify.verifySessionToken(token, shop, SESSION_SECRET);
  const isValidHmac = req.query.hmac && shopify.verifyHmac(req.query, SESSION_SECRET);

  if (!isValidToken && !isValidHmac) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or expired download credentials' });
  }

  const shopData = db.getShop(shop);
  if (!shopData) {
    return res.status(404).json({ error: 'Store not found' });
  }

  try {
    let orders = [];
    if (shopData.accessToken) {
      try {
        orders = await shopify.fetchUnfulfilledOrders(shopData.shop, shopData.accessToken);
      } catch (e) {
        orders = [];
      }
    }

    const { buffer, filename } = await generateOrdersWorkbook(orders, shopData.shop);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate Excel: ' + err.message });
  }
});

// Send Dispatch Email Now Endpoint (Strictly Rate-Limited & Authenticated)
app.post('/api/send-email', emailLimiter, verifyShopAuth, async (req, res) => {
  const shop = req.body.shop || DEFAULT_SHOP;
  const emailOverride = req.body.email;

  const shopData = db.getShop(shop);
  if (!shopData) {
    return res.status(404).json({ success: false, error: 'Store not found' });
  }

  try {
    const result = await scheduler.runDispatchForShop(shopData.shop, emailOverride);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update Store Schedule Settings Endpoint (Authenticated & Token-Sanitized)
app.post('/api/settings', verifyShopAuth, (req, res) => {
  const shop = req.body.shop || DEFAULT_SHOP;
  const shopData = db.getShop(shop);

  if (!shopData) {
    return res.status(404).json({ success: false, error: 'Store not found' });
  }

  const updates = {};
  if (req.body.scheduleTime) updates.scheduleTime = req.body.scheduleTime;
  if (req.body.recipientEmail !== undefined) updates.recipientEmail = req.body.recipientEmail.trim();
  if (typeof req.body.autoDispatchEnabled === 'boolean') updates.autoDispatchEnabled = req.body.autoDispatchEnabled;

  const updated = db.saveShop(shop, updates);
  // Strip private tokens before returning to client
  const { accessToken, scopes, ...safeConfig } = updated;
  res.json({ success: true, config: safeConfig });
});

// External Cron Trigger Endpoint (Protected by CRON_SECRET)
app.post('/api/cron/trigger', async (req, res) => {
  const authHeader = req.headers['x-cron-secret'] || req.query.secret;
  if (authHeader !== CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized: Invalid cron secret' });
  }

  try {
    await scheduler.runScheduledPass();
    res.json({ success: true, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// 5. MANDATORY SHOPIFY COMPLIANCE & GDPR WEBHOOKS
// -------------------------------------------------------------
function verifyShopifyWebhook(req, res, next) {
  const hmacHeader = req.headers['x-shopify-hmac-sha256'];
  if (!hmacHeader || !CLIENT_SECRET) {
    return res.status(401).send('Missing webhook HMAC header');
  }

  const rawBody = req.body.toString('utf8');
  const isValid = shopify.verifyWebhookHmac(rawBody, hmacHeader, CLIENT_SECRET);
  if (!isValid) {
    return res.status(401).send('Invalid webhook HMAC signature');
  }
  next();
}

app.post('/webhooks/customers/data_request', verifyShopifyWebhook, (req, res) => {
  console.log('[Webhook] customers/data_request received.');
  res.status(200).send('OK');
});

app.post('/webhooks/customers/redact', verifyShopifyWebhook, (req, res) => {
  console.log('[Webhook] customers/redact received.');
  res.status(200).send('OK');
});

app.post('/webhooks/shop/redact', verifyShopifyWebhook, (req, res) => {
  try {
    const payload = JSON.parse(req.body.toString('utf8'));
    const domain = payload.shop_domain;
    if (domain) {
      db.deleteShop(domain);
      console.log(`[Webhook] shop/redact: Cleaned up data for ${domain}`);
    }
  } catch (e) {}
  res.status(200).send('OK');
});

app.post('/webhooks/app/uninstalled', verifyShopifyWebhook, (req, res) => {
  try {
    const payload = JSON.parse(req.body.toString('utf8'));
    const domain = payload.myshopify_domain;
    if (domain) {
      db.saveShop(domain, { accessToken: null, autoDispatchEnabled: false });
      console.log(`[Webhook] app/uninstalled: Deactivated shop ${domain}`);
    }
  } catch (e) {}
  res.status(200).send('OK');
});

// -------------------------------------------------------------
// 6. HEALTH, PRIVACY, TERMS & SUPPORT ROUTES
// -------------------------------------------------------------
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    storesActive: db.getAllActiveShops().length
  });
});

app.get('/privacy', (req, res) => {
  res.send(renderLegalPage('Privacy Policy', `
    <h3>1. Information We Collect</h3>
    <p>OrderDrop accesses store orders strictly to generate warehouse export spreadsheets and deliver them to your authorized recipients. We do not sell, rent, or trade customer personal data.</p>
    <h3>2. How Data is Used</h3>
    <p>Customer shipping names and delivery addresses are processed ephemerally in memory solely to format the pick-and-pack Excel document.</p>
    <h3>3. Data Retention & Deletion</h3>
    <p>When you uninstall OrderDrop, our webhook immediately deactivates automated dispatches and deletes store tokens. You may request complete erasure at any time by contacting support.</p>
    <h3>4. Contact</h3>
    <p>For privacy inquiries: <a href="mailto:support@orderdrop.store">support@orderdrop.store</a></p>
  `));
});

app.get('/terms', (req, res) => {
  res.send(renderLegalPage('Terms of Service', `
    <h3>1. Services Provided</h3>
    <p>OrderDrop provides automated daily export of unfulfilled Shopify orders via email attachments.</p>
    <h3>2. Billing & Subscriptions</h3>
    <p>Subscriptions are billed through Shopify Billing. All plans include a 7-day free trial. Cancellation takes effect immediately upon app removal.</p>
    <h3>3. Limitation of Liability</h3>
    <p>OrderDrop is provided "as is". Merchants are responsible for ensuring recipient email addresses are correct and up-to-date.</p>
  `));
});

app.get('/support', (req, res) => {
  res.send(renderLegalPage('OrderDrop Support & Help Center', `
    <p>Need assistance with your daily orders dispatch schedule, column formatting, or warehouse email configuration?</p>
    <div style="background: #f1f5f9; padding: 18px; border-radius: 8px; margin: 20px 0;">
      <p style="margin: 0; font-size: 15px;"><strong>Official Support Email:</strong> <a href="mailto:support@orderdrop.store">support@orderdrop.store</a></p>
      <p style="margin: 8px 0 0; font-size: 13px; color: #64748b;">Typical response time: Under 12 hours</p>
    </div>
  `));
});

// -------------------------------------------------------------
// 7. HTML TEMPLATES (POLARIS-ALIGNED & ESCAPE-SANITIZED)
// -------------------------------------------------------------
function renderDashboard(shopData, orders = [], fetchError = null, sessionToken = '') {
  const shop = escapeHtml(shopData.shop);
  const recipient = escapeHtml(shopData.recipientEmail || '');
  const scheduleTime = escapeHtml(shopData.scheduleTime || '18:00');
  const plan = escapeHtml(shopData.plan || 'Free Trial (7 Days)');
  const isActive = shopData.subscriptionStatus === 'active';
  const orderCount = orders.length;

  let trialText = '7-Day Free Trial';
  if (shopData.trialEndsAt) {
    const daysLeft = Math.max(0, Math.ceil((new Date(shopData.trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
    trialText = `Trial: ${daysLeft} day${daysLeft === 1 ? '' : 's'} left`;
  }

  // Generate 24-hour UTC dropdown options
  let timeOptions = '';
  for (let h = 0; h < 24; h++) {
    const val = String(h).padStart(2, '0') + ':00';
    const ampm = h === 0 ? '12:00 AM' : h < 12 ? `${h}:00 AM` : h === 12 ? '12:00 PM' : `${h - 12}:00 PM`;
    const selected = scheduleTime === val ? 'selected' : '';
    timeOptions += `<option value="${val}" ${selected}>Daily at ${val} UTC (${ampm} UTC)</option>\n`;
  }

  let tableRows = '';
  if (orders.length === 0) {
    tableRows = `
      <tr>
        <td colspan="7" style="text-align: center; color: #64748b; padding: 24px;">
          ${fetchError ? `Note: ${escapeHtml(fetchError)}` : 'No unfulfilled orders pending right now. All orders are fulfilled!'}
        </td>
      </tr>
    `;
  } else {
    tableRows = orders.slice(0, 10).map(o => `
      <tr>
        <td><strong>${escapeHtml(o.name)}</strong></td>
        <td>${escapeHtml(o.date)}</td>
        <td>${escapeHtml(o.customer)}</td>
        <td>${escapeHtml(o.item)}</td>
        <td>${escapeHtml(String(o.qty))}</td>
        <td>${escapeHtml(o.total)}</td>
        <td><span style="background: #fed7aa; color: #9a3412; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;">${escapeHtml(o.status)}</span></td>
      </tr>
    `).join('');
  }

  const lastDispatchedStr = shopData.lastDispatchedAt 
    ? new Date(shopData.lastDispatchedAt).toUTCString()
    : 'No dispatches recorded yet';
  const lastStatus = shopData.lastDispatchStatus || 'Ready';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OrderDrop - Automated Export</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background-color: #f6f6f7; margin: 0; padding: 24px; color: #202223; }
    .card { background: white; border-radius: 12px; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); margin-bottom: 20px; border: 1px solid #e1e3e5; }
    .badge { display: inline-block; padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: 600; background: #cbf4c9; color: #0e6251; }
    .badge-plan { background: #e0f2fe; color: #0369a1; border: 1px solid #bae6fd; }
    .btn { background: #008060; color: white; border: none; padding: 10px 18px; border-radius: 8px; font-weight: 600; font-size: 14px; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; text-decoration: none; }
    .btn:hover { background: #006e52; }
    .btn-secondary { background: #f1f2f4; color: #202223; border: 1px solid #c9cccf; }
    .btn-secondary:hover { background: #e4e5e7; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; }
    th, td { text-align: left; padding: 12px; border-bottom: 1px solid #e1e3e5; font-size: 13px; }
    th { background: #f9fafb; font-weight: 600; color: #5c5f62; }
    input, select { width: 100%; box-sizing: border-box; padding: 10px 12px; border-radius: 6px; border: 1px solid #c9cccf; font-size: 14px; margin-top: 6px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .toast { display: none; background: #202223; color: white; padding: 12px 20px; border-radius: 8px; position: fixed; bottom: 20px; right: 20px; font-size: 14px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); z-index: 1000; }
  </style>
</head>
<body>

  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
    <div>
      <h1 style="font-size: 22px; margin: 0; font-weight: 700;">OrderDrop · Daily Export</h1>
      <p style="margin: 4px 0 0; color: #6d7175; font-size: 13px;">Connected Store: <strong>${shop}</strong></p>
    </div>
    <div style="display: flex; gap: 8px;">
      <span class="badge ${isActive ? 'badge-plan' : ''}" style="${isActive ? '' : 'background: #fef3c7; color: #92400e; border: 1px solid #fde68a;'}">
        ${isActive ? '💎 ' + plan : '⏱️ ' + trialText}
      </span>
      <span class="badge">● Multi-Tenant Active</span>
    </div>
  </div>

  <div class="card">
    <div style="display: flex; justify-content: space-between; align-items: center;">
      <div>
        <h2 style="font-size: 16px; margin: 0 0 4px; font-weight: 600;">Today's Unfulfilled Orders (${orderCount})</h2>
        <p style="margin: 0; color: #6d7175; font-size: 13px;">Live order stream queried directly from your Shopify store.</p>
      </div>
      <a href="/api/export?shop=${encodeURIComponent(shop)}&token=${encodeURIComponent(sessionToken)}" class="btn">
        <svg width="16" height="16" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>
        Download Excel (.xlsx)
      </a>
    </div>

    <table>
      <thead>
        <tr>
          <th>Order #</th>
          <th>Date</th>
          <th>Customer</th>
          <th>Item Title</th>
          <th>Qty</th>
          <th>Total</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${tableRows}
      </tbody>
    </table>
  </div>

  <div class="card">
    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 14px;">
      <div>
        <h2 style="font-size: 16px; margin: 0 0 4px; font-weight: 600;">Autonomous Daily Email Schedule</h2>
        <p style="margin: 0; color: #6d7175; font-size: 13px;">Automatically compiles unfulfilled orders and emails your warehouse or 3PL every day.</p>
      </div>
      <div style="text-align: right; font-size: 12px; color: #6d7175;">
        <span>Last Dispatch: <strong>${escapeHtml(lastDispatchedStr)}</strong></span>
        <br><span style="color: ${lastStatus === 'success' ? '#008060' : '#b91c1c'}; font-weight: 600;">● ${escapeHtml(lastStatus)}</span>
      </div>
    </div>

    <div class="grid">
      <div>
        <label style="font-size: 13px; font-weight: 600;">Daily Delivery Time (UTC)</label>
        <select id="scheduleTime">
          ${timeOptions}
        </select>
        <p style="font-size: 11px; color: #6d7175; margin: 4px 0 0;">Pick your preferred daily cut-off time (UTC).</p>
      </div>

      <div>
        <label style="font-size: 13px; font-weight: 600;">Warehouse / Supplier Recipient Email</label>
        <input type="email" id="recipientEmail" placeholder="warehouse@example.com" value="${recipient}" />
        <p style="font-size: 11px; color: #6d7175; margin: 4px 0 0;">The destination inbox where .xlsx files are delivered.</p>
      </div>
    </div>

    <div style="margin-top: 20px; display: flex; gap: 10px;">
      <button class="btn" onclick="saveSchedule()">Save Schedule</button>
      <button class="btn btn-secondary" onclick="testEmail()">Send Live Dispatch Now</button>
    </div>
  </div>

  <div class="card" style="border-left: 4px solid #008060;">
    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 14px;">
      <div>
        <h3 style="font-size: 16px; margin: 0 0 4px; font-weight: 700;">Subscription & Plan</h3>
        <p style="margin: 0; font-size: 13px; color: #6d7175;">
          ${isActive
            ? `Active Plan: <strong>${plan}</strong> · Charges managed seamlessly via your Shopify monthly bill.`
            : `<strong>7-Day Free Trial Active (${trialText})</strong> · No upfront credit card required. Choose your plan to keep automations uninterrupted:`}
        </p>
      </div>
      <span class="badge" style="${isActive ? 'background: #dcfce7; color: #166534;' : 'background: #fef3c7; color: #92400e;'}">
        ${isActive ? '● Active Subscriber' : '⏱️ 7-Day Free Trial'}
      </span>
    </div>

    ${!isActive ? `
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 12px;">
      <div style="border: 1px solid #e2e8f0; border-radius: 8px; padding: 18px; background: #ffffff;">
        <div style="font-weight: 700; font-size: 15px; margin-bottom: 4px;">Monthly Plan</div>
        <div style="font-size: 24px; font-weight: 800; color: #008060; margin-bottom: 6px;">$9.99 <span style="font-size: 13px; font-weight: 400; color: #64748b;">/ month</span></div>
        <p style="font-size: 12px; color: #64748b; margin: 0 0 14px; min-height: 32px;">Includes full 7-day free trial. Billed every 30 days via Shopify. Cancel anytime with zero fees.</p>
        <a href="/api/billing/subscribe?shop=${encodeURIComponent(shop)}&plan=monthly" target="_top" class="btn btn-secondary" style="width: 100%; justify-content: center; box-sizing: border-box;">Start Monthly ($9.99/mo)</a>
      </div>

      <div style="border: 2px solid #008060; border-radius: 8px; padding: 18px; background: #f0fdf4; position: relative;">
        <span style="position: absolute; top: -11px; right: 14px; background: #008060; color: white; font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 12px; letter-spacing: 0.5px;">SAVE 17% · 2 MONTHS FREE</span>
        <div style="font-weight: 700; font-size: 15px; margin-bottom: 4px;">Annual Plan</div>
        <div style="font-size: 24px; font-weight: 800; color: #008060; margin-bottom: 6px;">$99.99 <span style="font-size: 13px; font-weight: 400; color: #64748b;">/ year</span></div>
        <p style="font-size: 12px; color: #166534; margin: 0 0 14px; min-height: 32px;">Includes full 7-day free trial. ~$8.33/mo. Best value for high-volume and scaling merchants.</p>
        <a href="/api/billing/subscribe?shop=${encodeURIComponent(shop)}&plan=annual" target="_top" class="btn" style="width: 100%; justify-content: center; box-sizing: border-box;">Start Annual ($99.99/yr)</a>
      </div>
    </div>
    ` : `
    <div style="padding: 14px; background: #f0fdf4; border-radius: 8px; font-size: 13px; color: #166534; display: flex; align-items: center; justify-content: space-between;">
      <span>Your store is subscribed to <strong>${plan}</strong>. All automated dispatches and Excel exports are fully active.</span>
      <span style="font-size: 12px; color: #15803d; font-weight: 600;">Managed via Shopify Billing</span>
    </div>
    `}
  </div>

  <div id="toast" class="toast">Schedule updated successfully!</div>

  <script>
    const currentShop = "${shop}";
    const sessionToken = "${sessionToken}";

    async function saveSchedule() {
      const email = document.getElementById('recipientEmail').value.trim();
      const time = document.getElementById('scheduleTime').value;
      const toast = document.getElementById('toast');
      
      try {
        const res = await fetch('/api/settings', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'x-orderdrop-token': sessionToken
          },
          body: JSON.stringify({ 
            shop: currentShop, 
            recipientEmail: email, 
            scheduleTime: time, 
            autoDispatchEnabled: Boolean(email) 
          })
        });
        const data = await res.json();
        if (data.success) {
          toast.innerText = email 
            ? "Schedule saved! Orders will export daily at " + time + " UTC to " + email
            : "Settings saved! Please enter a recipient email to enable automated dispatches.";
        } else {
          toast.innerText = "Error: " + (data.error || 'Failed to update');
        }
      } catch (e) {
        toast.innerText = "Failed to update schedule: " + e.message;
      }
      toast.style.display = 'block';
      setTimeout(() => { toast.style.display = 'none'; }, 4000);
    }

    async function testEmail() {
      const email = document.getElementById('recipientEmail').value.trim();
      const toast = document.getElementById('toast');
      if (!email) {
        toast.innerText = "Please enter a recipient email address first.";
        toast.style.display = 'block';
        setTimeout(() => { toast.style.display = 'none'; }, 4000);
        return;
      }

      toast.innerText = "Dispatching real spreadsheet to " + email + "...";
      toast.style.display = 'block';

      try {
        const res = await fetch('/api/send-email', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'x-orderdrop-token': sessionToken
          },
          body: JSON.stringify({ shop: currentShop, email: email })
        });
        const data = await res.json();
        if (data.success) {
          toast.innerText = "Excel delivered successfully! (ID: " + data.emailId.slice(0, 8) + ")";
        } else {
          toast.innerText = "Error: " + (data.error || 'Failed to send');
        }
      } catch (err) {
        toast.innerText = "Failed: " + err.message;
      }
      setTimeout(() => { toast.style.display = 'none'; }, 5000);
    }
  </script>

</body>
</html>`;
}

function renderLandingPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OrderDrop - Automated Daily Shopify Orders to Warehouse Excel</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; padding: 0; background: #0f172a; color: #f8fafc; line-height: 1.6; }
    .header { padding: 30px 20px; display: flex; justify-content: space-between; align-items: center; max-width: 1100px; margin: 0 auto; }
    .logo { font-size: 22px; font-weight: 800; color: white; letter-spacing: -0.5px; }
    .logo span { color: #10b981; }
    .hero { text-align: center; padding: 80px 20px 60px; max-width: 850px; margin: 0 auto; }
    .badge-hero { background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); padding: 6px 16px; border-radius: 20px; font-size: 13px; font-weight: 600; display: inline-block; margin-bottom: 24px; }
    h1 { font-size: 46px; font-weight: 800; line-height: 1.15; letter-spacing: -1px; margin: 0 0 20px; }
    p.sub { font-size: 18px; color: #94a3b8; max-width: 650px; margin: 0 auto 36px; }
    .cta-box { background: #1e293b; padding: 12px; border-radius: 12px; display: flex; gap: 10px; max-width: 520px; margin: 0 auto 16px; border: 1px solid #334155; }
    .cta-box input { flex: 1; background: transparent; border: none; color: white; font-size: 15px; padding: 10px 14px; outline: none; }
    .btn-cta { background: #10b981; color: #0f172a; font-weight: 700; border: none; padding: 12px 24px; border-radius: 8px; font-size: 15px; cursor: pointer; text-decoration: none; display: inline-block; }
    .btn-cta:hover { background: #059669; }
    .footer-links { text-align: center; padding: 40px 20px; font-size: 13px; color: #64748b; }
    .footer-links a { color: #94a3b8; text-decoration: none; margin: 0 10px; }
    .footer-links a:hover { color: white; }
  </style>
</head>
<body>

  <div class="header">
    <div class="logo">📦 Order<span>Drop</span></div>
    <div>
      <span style="font-size: 14px; color: #94a3b8; margin-right: 16px;">$9.99/mo or $99.99/yr · 7-Day Free Trial</span>
      <a href="#install" class="btn-cta" style="padding: 8px 18px; font-size: 13px;">Install App</a>
    </div>
  </div>

  <div class="hero" id="install">
    <span class="badge-hero">🚀 Stop Manual Order Export Hell</span>
    <h1>Automate Daily Shopify Orders Sent Directly to Your Warehouse</h1>
    <p class="sub">Every evening, OrderDrop automatically aggregates unfulfilled orders into a formatted pick-and-pack Excel workbook and delivers it straight to your fulfillment partner.</p>

    <div class="cta-box">
      <input type="text" id="storeInput" placeholder="your-store-name.myshopify.com" value="hk-mart-cfoepmjd.myshopify.com" />
      <button class="btn-cta" onclick="installNow()">Install Free</button>
    </div>
    <p style="font-size: 13px; color: #64748b; margin: 0;">7-day free trial on all plans · No credit card required to install · Cancel anytime with zero lock-in</p>
  </div>

  <div class="footer-links">
    <a href="/privacy">Privacy Policy</a> • 
    <a href="/terms">Terms of Service</a> • 
    <a href="/support">Support & Help</a> • 
    <a href="/health">System Status</a>
  </div>

  <script>
    function installNow() {
      let store = document.getElementById('storeInput').value.trim();
      if (!store) {
        alert('Please enter your myshopify.com store domain');
        return;
      }
      if (!store.includes('.myshopify.com')) {
        store = store.replace(/^https?:\\/\\//, '').replace(/\\/.*$/, '') + '.myshopify.com';
      }
      window.location.href = '/auth?shop=' + encodeURIComponent(store);
    }
  </script>

</body>
</html>`;
}

function renderLegalPage(title, content) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} - OrderDrop</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; padding: 40px 20px; line-height: 1.7; }
    .container { max-width: 760px; margin: 0 auto; background: #1e293b; padding: 40px; border-radius: 12px; border: 1px solid #334155; }
    h1 { color: white; margin-top: 0; font-size: 28px; border-bottom: 1px solid #334155; padding-bottom: 16px; }
    h3 { color: #f1f5f9; margin-top: 24px; font-size: 18px; }
    a { color: #34d399; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .back { display: inline-block; margin-bottom: 20px; font-size: 14px; }
  </style>
</head>
<body>
  <div class="container">
    <a href="/" class="back">← Back to OrderDrop</a>
    <h1>${escapeHtml(title)}</h1>
    ${content}
  </div>
</body>
</html>`;
}

// -------------------------------------------------------------
// 8. SERVER INITIALIZATION & BACKGROUND SCHEDULER
// -------------------------------------------------------------
const PORT = process.env.PORT || 3000;

// Initialize Postgres cache and start scheduler
(async () => {
  try {
    await db.init();
    console.log('[OrderDrop] Database initialized successfully.');
  } catch (err) {
    console.error('[OrderDrop] DB init warning:', err.message);
  }

  scheduler.startCron();

  if (process.env.NODE_ENV === 'production' || process.env.RENDER) {
    app.listen(PORT, () => {
      console.log(`[OrderDrop Production] Server running on port ${PORT}`);
    });
  } else {
    // Local Development
    const attrs = [{ name: 'commonName', value: 'localhost' }];
    const pems = selfsigned.generate(attrs, { days: 365 });

    https.createServer({ key: pems.private, cert: pems.cert }, app).listen(3000, () => {
      console.log(`[OrderDrop] HTTPS Server running at https://localhost:3000`);
    });

    http.createServer(app).listen(3001, () => {
      console.log(`[OrderDrop] HTTP Server running at http://localhost:3001`);
    });
  }
})();
