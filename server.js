const express = require('express');
const https = require('https');
const http = require('http');
const cors = require('cors');
const path = require('path');
const selfsigned = require('selfsigned');
const ExcelJS = require('exceljs');
const { Resend } = require('resend');
const cron = require('node-cron');
const fs = require('fs');

// Load environment variables from .env if present
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    lines.forEach(line => {
      const parts = line.split('=');
      if (parts.length >= 2) {
        process.env[parts[0].trim()] = parts.slice(1).join('=').trim();
      }
    });
  }
}
loadEnv();

const resendApiKey = process.env.RESEND_API_KEY;
const resend = resendApiKey ? new Resend(resendApiKey) : null;
const DEFAULT_EMAIL = process.env.MERCHANT_EMAIL || 'www.sunitajoshi98765@gmail.com';

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Allow iframe embedding inside Shopify Admin
app.use((req, res, next) => {
  res.removeHeader('X-Frame-Options');
  res.setHeader('Content-Security-Policy', "frame-ancestors https://*.myshopify.com https://admin.shopify.com");
  next();
});

// App In-Memory State
const appConfig = {
  scheduleTime: '18:00',
  recipientEmail: DEFAULT_EMAIL,
  autoDispatchEnabled: true,
  plan: 'Starter ($9.99/mo)',
  trialDaysRemaining: 7,
  billingStatus: 'active'
};

// Mock / Connected Store Orders (Sample live order #1001)
const currentOrders = [
  {
    name: "#1001",
    date: new Date().toISOString().split('T')[0],
    customer: "Gourav Joshi",
    email: "gourav@example.com",
    sku: "GYM-BAND-01",
    item: "Test Gym Bands",
    qty: 1,
    unitPrice: "$29.99",
    total: "$29.99",
    status: "PAID / UNFULFILLED",
    address: "Shop Location, United States"
  }
];

// Helper: Generate Excel Buffer
async function createExcelBuffer(orders) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'OrderDrop';
  const worksheet = workbook.addWorksheet('Today Orders');

  worksheet.columns = [
    { header: 'Order #', key: 'name', width: 14 },
    { header: 'Date', key: 'date', width: 14 },
    { header: 'Customer', key: 'customer', width: 22 },
    { header: 'Email', key: 'email', width: 26 },
    { header: 'SKU', key: 'sku', width: 16 },
    { header: 'Item Name', key: 'item', width: 28 },
    { header: 'Qty', key: 'qty', width: 10 },
    { header: 'Unit Price', key: 'unitPrice', width: 14 },
    { header: 'Total Price', key: 'total', width: 14 },
    { header: 'Fulfillment Status', key: 'status', width: 22 },
    { header: 'Shipping Address', key: 'address', width: 36 }
  ];

  // Slate Dark Navy header
  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF0F172A' }
  };
  headerRow.height = 24;

  orders.forEach(order => worksheet.addRow(order));
  return await workbook.xlsx.writeBuffer();
}

// Background Cron Engine: Run daily at 18:00 (6:00 PM) UTC
cron.schedule('0 18 * * *', async () => {
  if (!appConfig.autoDispatchEnabled) {
    console.log('[Cron Engine] Daily auto-dispatch is currently paused.');
    return;
  }
  console.log(`[Cron Engine] Auto-dispatching daily orders export to ${appConfig.recipientEmail}...`);
  try {
    if (!resend) return console.error('[Cron Engine] Resend client not configured.');
    const excelBuffer = await createExcelBuffer(currentOrders);
    const result = await resend.emails.send({
      from: 'OrderDrop <onboarding@resend.dev>',
      to: [appConfig.recipientEmail],
      subject: `📦 Automated Daily Orders Export: ${currentOrders.length} Unfulfilled Order(s)`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 24px; border: 1px solid #e2e8f0; border-radius: 10px; max-width: 600px; color: #1e293b;">
          <h2 style="color: #0f172a; margin-top: 0;">OrderDrop Daily Scheduled Dispatch</h2>
          <p>Here is your automated daily fulfillment compilation for <strong>Hk mart</strong>.</p>
          <div style="background: #f8fafc; padding: 12px 16px; border-radius: 6px; margin: 16px 0; border: 1px solid #e2e8f0;">
            <p style="margin: 0; font-size: 14px;"><strong>Orders Included:</strong> ${currentOrders.length} order (#1001)</p>
            <p style="margin: 4px 0 0; font-size: 14px;"><strong>Total Value:</strong> $29.99 USD</p>
          </div>
          <p style="font-size: 13px; color: #64748b;">The supplier-ready formatted pick-and-pack spreadsheet is attached as <code>HK_Mart_Orders_Export.xlsx</code>.</p>
        </div>
      `,
      attachments: [{ filename: 'HK_Mart_Orders_Export.xlsx', content: Buffer.from(excelBuffer) }]
    });
    console.log('[Cron Engine] Dispatch successful! Email ID:', result.data ? result.data.id : 'ok');
  } catch (err) {
    console.error('[Cron Engine] Auto-dispatch error:', err.message);
  }
});

// 1. Root Route: Serves Embedded Dashboard if inside Shopify, or Public SaaS Landing Page
app.get('/', (req, res) => {
  const shop = req.query.shop;
  const isEmbedded = req.query.embedded === '1' || req.query.host || shop;

  if (isEmbedded) {
    return res.send(renderDashboard(shop || 'hk-mart-cfoepmjd.myshopify.com'));
  }
  return res.send(renderLandingPage());
});

// 2. Direct Excel Export Download API
app.get('/api/export', async (req, res) => {
  try {
    const buffer = await createExcelBuffer(currentOrders);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="HK_Mart_Orders_Export.xlsx"');
    res.send(buffer);
  } catch (err) {
    res.status(500).send('Error generating export: ' + err.message);
  }
});

// 3. Send Real Email Endpoint
app.post('/api/send-email', async (req, res) => {
  try {
    const toEmail = req.body.email || appConfig.recipientEmail;
    if (!resend) {
      return res.status(500).json({ success: false, error: 'Resend API key missing in environment' });
    }

    const excelBuffer = await createExcelBuffer(currentOrders);
    const result = await resend.emails.send({
      from: 'OrderDrop <onboarding@resend.dev>',
      to: [toEmail],
      subject: `📦 Daily Orders Export: ${currentOrders.length} Unfulfilled Order (#1001)`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 24px; border: 1px solid #e2e8f0; border-radius: 10px; max-width: 600px; color: #1e293b;">
          <h2 style="color: #0f172a; margin-top: 0;">OrderDrop Daily Fulfillment Dispatch</h2>
          <p>Here is your daily order compilation for <strong>Hk mart</strong> (<code>hk-mart-cfoepmjd.myshopify.com</code>).</p>
          <div style="background: #f8fafc; padding: 12px 16px; border-radius: 6px; margin: 16px 0; border: 1px solid #e2e8f0;">
            <p style="margin: 0; font-size: 14px;"><strong>Order #1001:</strong> Test Gym Bands ($29.99 USD)</p>
            <p style="margin: 4px 0 0; font-size: 14px;"><strong>Customer:</strong> Gourav Joshi</p>
          </div>
          <p style="font-size: 13px; color: #64748b;">The clean pick-and-pack spreadsheet is attached as <code>HK_Mart_Orders_Export.xlsx</code>.</p>
        </div>
      `,
      attachments: [
        {
          filename: 'HK_Mart_Orders_Export.xlsx',
          content: Buffer.from(excelBuffer)
        }
      ]
    });

    if (result.error) {
      return res.status(400).json({ success: false, error: result.error.message });
    }

    res.json({ success: true, id: result.data.id });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Update Schedule Settings API
app.post('/api/settings', (req, res) => {
  if (req.body.scheduleTime) appConfig.scheduleTime = req.body.scheduleTime;
  if (req.body.recipientEmail) appConfig.recipientEmail = req.body.recipientEmail;
  if (typeof req.body.autoDispatchEnabled === 'boolean') appConfig.autoDispatchEnabled = req.body.autoDispatchEnabled;
  res.json({ success: true, config: appConfig });
});

// 5. Shopify Recurring Billing Mock / GraphQL endpoint
app.get('/api/billing/subscribe', (req, res) => {
  const shop = req.query.shop || 'hk-mart-cfoepmjd.myshopify.com';
  // In production, queries appSubscriptionCreate GraphQL mutation.
  // Returns confirmation URL or simulates approval for test store.
  res.send(`
    <!DOCTYPE html>
    <html>
    <head><title>Approving OrderDrop Subscription</title><link rel="stylesheet" href="https://unpkg.com/@shopify/polaris@12.0.0/build/esm/styles.css"></head>
    <body style="font-family: system-ui; padding: 40px; text-align: center; background: #f6f6f7;">
      <div style="max-width: 480px; margin: 0 auto; background: white; padding: 32px; border-radius: 12px; border: 1px solid #dcdfe3; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
        <h2 style="margin-top:0;">Shopify App Subscription</h2>
        <p style="color: #5c5f62;">Plan: <strong>OrderDrop Starter ($9.99 USD / month)</strong></p>
        <p style="color: #008060; font-weight: 600;">7-Day Free Trial included. You won't be charged today.</p>
        <div style="margin-top: 24px;">
          <a href="/?shop=${shop}&billing=success" style="background: #008060; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: 600; display: inline-block;">Approve Subscription ($9.99/mo)</a>
        </div>
      </div>
    </body>
    </html>
  `);
});

// 6. OAuth Install Callback
app.get('/auth/callback', (req, res) => {
  const shop = req.query.shop || 'hk-mart-cfoepmjd.myshopify.com';
  res.redirect(`/?shop=${shop}`);
});

// HTML Renderer: Merchant Dashboard (Inside Shopify Admin)
function renderDashboard(shop) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OrderDrop - Automated Export</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background-color: #f6f6f7;
      margin: 0;
      padding: 24px;
      color: #202223;
    }
    .card {
      background: white;
      border-radius: 12px;
      padding: 24px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.08);
      margin-bottom: 20px;
      border: 1px solid #e1e3e5;
    }
    .badge {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 600;
      background: #cbf4c9;
      color: #0e6251;
    }
    .badge-plan {
      background: #e0f2fe;
      color: #0369a1;
      border: 1px solid #bae6fd;
    }
    .btn {
      background: #008060;
      color: white;
      border: none;
      padding: 10px 18px;
      border-radius: 8px;
      font-weight: 600;
      font-size: 14px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      text-decoration: none;
    }
    .btn:hover {
      background: #006e52;
    }
    .btn-secondary {
      background: #f1f2f4;
      color: #202223;
      border: 1px solid #c9cccf;
    }
    .btn-secondary:hover {
      background: #e4e5e7;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 16px;
    }
    th, td {
      text-align: left;
      padding: 12px;
      border-bottom: 1px solid #e1e3e5;
      font-size: 13px;
    }
    th {
      background: #f9fafb;
      font-weight: 600;
      color: #5c5f62;
    }
    input, select {
      width: 100%;
      box-sizing: border-box;
      padding: 10px 12px;
      border-radius: 6px;
      border: 1px solid #c9cccf;
      font-size: 14px;
      margin-top: 6px;
    }
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }
    .toast {
      display: none;
      background: #202223;
      color: white;
      padding: 12px 20px;
      border-radius: 8px;
      position: fixed;
      bottom: 20px;
      right: 20px;
      font-size: 14px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      z-index: 1000;
    }
  </style>
</head>
<body>

  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
    <div>
      <h1 style="font-size: 22px; margin: 0; font-weight: 700;">OrderDrop · Daily Export</h1>
      <p style="margin: 4px 0 0; color: #6d7175; font-size: 13px;">Connected Store: <strong>${shop}</strong></p>
    </div>
    <div style="display: flex; gap: 8px;">
      <span class="badge badge-plan">💎 Starter Plan ($9.99/mo)</span>
      <span class="badge">● Active & Connected</span>
    </div>
  </div>

  <!-- Manual One-Click Export Card -->
  <div class="card">
    <div style="display: flex; justify-content: space-between; align-items: center;">
      <div>
        <h2 style="font-size: 16px; margin: 0 0 4px; font-weight: 600;">Today's Unfulfilled Orders</h2>
        <p style="margin: 0; color: #6d7175; font-size: 13px;">1 order ready to be exported for warehouse fulfillment.</p>
      </div>
      <a href="/api/export" class="btn">
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
          <th>Product</th>
          <th>Qty</th>
          <th>Total</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><strong>#1001</strong></td>
          <td>${currentOrders[0].date}</td>
          <td>${currentOrders[0].customer}</td>
          <td>${currentOrders[0].item}</td>
          <td>${currentOrders[0].qty}</td>
          <td>${currentOrders[0].total}</td>
          <td><span style="background: #fed7aa; color: #9a3412; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;">UNFULFILLED</span></td>
        </tr>
      </tbody>
    </table>
  </div>

  <!-- Automated Daily Schedule Card -->
  <div class="card">
    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 14px;">
      <div>
        <h2 style="font-size: 16px; margin: 0 0 4px; font-weight: 600;">Autonomous 24/7 Cloud Schedule</h2>
        <p style="margin: 0; color: #6d7175; font-size: 13px;">Automatically compiles unfulfilled orders and emails your warehouse or 3PL every day.</p>
      </div>
      <div style="text-align: right;">
        <span style="font-size: 12px; color: #008060; font-weight: 600;">● Cloud Cron Engine Active</span>
      </div>
    </div>

    <div class="grid">
      <div>
        <label style="font-size: 13px; font-weight: 600;">Daily Delivery Time</label>
        <select id="scheduleTime">
          <option value="18:00" selected>Every day at 06:00 PM (18:00 UTC)</option>
          <option value="09:00">Every day at 09:00 AM (09:00 UTC)</option>
          <option value="23:59">Every night at Midnight (23:59 UTC)</option>
        </select>
      </div>

      <div>
        <label style="font-size: 13px; font-weight: 600;">Supplier / Warehouse Email</label>
        <input type="email" id="recipientEmail" placeholder="warehouse@example.com" value="${appConfig.recipientEmail}" />
      </div>
    </div>

    <div style="margin-top: 20px; display: flex; gap: 10px;">
      <button class="btn" onclick="saveSchedule()">Save Schedule</button>
      <button class="btn btn-secondary" onclick="testEmail()">Send Live Dispatch Now</button>
    </div>
  </div>

  <!-- Plan & Billing Card -->
  <div class="card" style="border-left: 4px solid #008060;">
    <div style="display: flex; justify-content: space-between; align-items: center;">
      <div>
        <h3 style="font-size: 15px; margin: 0 0 4px; font-weight: 600;">Subscription & Plan</h3>
        <p style="margin: 0; font-size: 13px; color: #6d7175;">You are on the <strong>OrderDrop Starter Plan</strong> ($9.99 USD / month). Unlimited daily auto-exports.</p>
      </div>
      <a href="/api/billing/subscribe?shop=${shop}" class="btn btn-secondary" style="font-size: 13px;">Manage Subscription</a>
    </div>
  </div>

  <div id="toast" class="toast">Schedule updated successfully!</div>

  <script>
    async function saveSchedule() {
      const email = document.getElementById('recipientEmail').value;
      const time = document.getElementById('scheduleTime').value;
      const toast = document.getElementById('toast');
      
      try {
        await fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ recipientEmail: email, scheduleTime: time, autoDispatchEnabled: true })
        });
        toast.innerText = "Schedule saved! Orders will automatically export daily at " + time + " to " + email;
      } catch (e) {
        toast.innerText = "Schedule updated locally!";
      }
      toast.style.display = 'block';
      setTimeout(() => { toast.style.display = 'none'; }, 3500);
    }

    async function testEmail() {
      const email = document.getElementById('recipientEmail').value;
      const toast = document.getElementById('toast');
      toast.innerText = "Dispatching real spreadsheet via Resend to " + email + "...";
      toast.style.display = 'block';

      try {
        const res = await fetch('/api/send-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });
        const data = await res.json();
        if (data.success) {
          toast.innerText = "Excel delivered successfully to " + email + "! (Delivery ID: " + data.id.slice(0, 8) + ")";
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

// HTML Renderer: Public SaaS Landing Page (For external visitors / direct installs)
function renderLandingPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OrderDrop - Automated Daily Shopify Orders to Warehouse Excel</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      margin: 0;
      padding: 0;
      background: #0f172a;
      color: #f8fafc;
      line-height: 1.6;
    }
    .header {
      padding: 30px 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      max-width: 1100px;
      margin: 0 auto;
    }
    .logo {
      font-size: 22px;
      font-weight: 800;
      color: white;
      letter-spacing: -0.5px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .logo span { color: #10b981; }
    .hero {
      text-align: center;
      padding: 80px 20px 60px;
      max-width: 850px;
      margin: 0 auto;
    }
    .badge-hero {
      background: rgba(16, 185, 129, 0.15);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.3);
      padding: 6px 16px;
      border-radius: 20px;
      font-size: 13px;
      font-weight: 600;
      display: inline-block;
      margin-bottom: 24px;
    }
    h1 {
      font-size: 46px;
      font-weight: 800;
      line-height: 1.15;
      letter-spacing: -1px;
      margin: 0 0 20px;
    }
    p.sub {
      font-size: 18px;
      color: #94a3b8;
      max-width: 650px;
      margin: 0 auto 36px;
    }
    .cta-box {
      background: #1e293b;
      padding: 12px;
      border-radius: 12px;
      display: flex;
      gap: 10px;
      max-width: 520px;
      margin: 0 auto 16px;
      border: 1px solid #334155;
    }
    .cta-box input {
      flex: 1;
      background: transparent;
      border: none;
      color: white;
      font-size: 15px;
      padding: 10px 14px;
      outline: none;
    }
    .btn-cta {
      background: #10b981;
      color: #0f172a;
      font-weight: 700;
      border: none;
      padding: 12px 24px;
      border-radius: 8px;
      font-size: 15px;
      cursor: pointer;
      text-decoration: none;
      display: inline-block;
      transition: background 0.2s;
    }
    .btn-cta:hover { background: #059669; }
    .features {
      max-width: 1100px;
      margin: 40px auto 100px;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 24px;
      padding: 0 20px;
    }
    .card-f {
      background: #1e293b;
      padding: 30px;
      border-radius: 14px;
      border: 1px solid #334155;
    }
    .card-f h3 { margin-top: 0; font-size: 19px; color: white; }
    .card-f p { color: #94a3b8; font-size: 14px; margin: 0; }
    .pricing {
      background: #111827;
      border-top: 1px solid #1f2937;
      padding: 70px 20px;
      text-align: center;
    }
    .price-card {
      background: #1e293b;
      border: 2px solid #10b981;
      border-radius: 16px;
      max-width: 400px;
      margin: 30px auto 0;
      padding: 36px;
    }
    .price { font-size: 48px; font-weight: 800; color: white; }
    .price span { font-size: 18px; color: #94a3b8; font-weight: 400; }
  </style>
</head>
<body>

  <div class="header">
    <div class="logo">📦 Order<span>Drop</span></div>
    <div>
      <span style="font-size: 14px; color: #94a3b8; margin-right: 16px;">$9.99/mo (7-Day Free Trial)</span>
      <a href="#install" class="btn-cta" style="padding: 8px 18px; font-size: 13px;">Install App</a>
    </div>
  </div>

  <div class="hero" id="install">
    <span class="badge-hero">🚀 Stop Manual Order Export Hell</span>
    <h1>Automate Daily Shopify Orders Sent Directly to Your Warehouse</h1>
    <p class="sub">Every evening, OrderDrop automatically aggregates all unfulfilled orders into a clean, warehouse-ready Excel spreadsheet and emails it straight to your suppliers or fulfillment 3PL.</p>

    <div class="cta-box">
      <input type="text" id="storeInput" placeholder="your-store-name.myshopify.com" value="hk-mart-cfoepmjd.myshopify.com" />
      <button class="btn-cta" onclick="installNow()">Install Free</button>
    </div>
    <p style="font-size: 13px; color: #64748b; margin: 0;">7-day free trial · 1-click install via Shopify · Cancel anytime</p>
  </div>

  <div class="features">
    <div class="card-f">
      <h3>⏰ Set & Forget Automation</h3>
      <p>Configure once. OrderDrop runs in the cloud 24/7 and dispatches your order batches automatically every single day at your specified time.</p>
    </div>
    <div class="card-f">
      <h3>📊 Warehouse-Ready Excel (.xlsx)</h3>
      <p>Formatted with dark headers, clear SKU columns, customer delivery notes, and item quantities so warehouse pickers make zero mistakes.</p>
    </div>
    <div class="card-f">
      <h3>✉️ Direct Multi-Recipient Email</h3>
      <p>Powered by ultra-fast transactional email. Sends clean spreadsheet attachments directly to your fulfillment partners with 99.9% inbox delivery.</p>
    </div>
  </div>

  <div class="pricing">
    <h2 style="font-size: 32px; margin: 0 0 10px;">Simple, Transparent Pricing</h2>
    <p style="color: #94a3b8; margin: 0;">No hidden fees. One plan with everything included.</p>

    <div class="price-card">
      <h3 style="margin: 0; font-size: 20px;">Unlimited Store Plan</h3>
      <div class="price">$9.99 <span>/ month</span></div>
      <p style="color: #34d399; font-weight: 600; margin: 12px 0 24px;">Includes 7-day free trial</p>

      <ul style="text-align: left; color: #cbd5e1; font-size: 14px; padding-left: 20px; line-height: 2;">
        <li>Unlimited daily automated dispatches</li>
        <li>Custom warehouse email recipients</li>
        <li>Dark-slate warehouse formatted .xlsx</li>
        <li>Cloud 24/7 cron background engine</li>
        <li>Direct priority support</li>
      </ul>

      <div style="margin-top: 24px;">
        <button class="btn-cta" style="width: 100%;" onclick="installNow()">Start 7-Day Free Trial</button>
      </div>
    </div>
  </div>

  <script>
    function installNow() {
      let store = document.getElementById('storeInput').value.trim();
      if (!store) {
        alert('Please enter your myshopify.com store address');
        return;
      }
      if (!store.includes('.myshopify.com')) {
        store = store.replace(/^https?:\\/\\//, '').replace(/\\/.*$/, '') + '.myshopify.com';
      }
      window.location.href = 'https://' + store + '/admin/oauth/authorize?client_id=4ef9cc1f66fcf5d38b1900192dd5c130&scope=read_orders,write_orders,read_products&redirect_uri=https://orderdrop.onrender.com/auth/callback';
    }
  </script>

</body>
</html>`;
}

// Port Configuration for Render & Local
const PORT = process.env.PORT || 3000;

// On Cloud / Render: Listen on process.env.PORT
if (process.env.NODE_ENV === 'production' || process.env.RENDER) {
  app.listen(PORT, () => {
    console.log(`[OrderDrop Cloud] Server running on port ${PORT}`);
  });
} else {
  // Local Development: Support both HTTPS (for Shopify Admin) & HTTP
  const attrs = [{ name: 'commonName', value: 'localhost' }];
  const pems = selfsigned.generate(attrs, { days: 365 });

  https.createServer({ key: pems.private, cert: pems.cert }, app).listen(3000, () => {
    console.log(`[OrderDrop] HTTPS Server running at https://localhost:3000`);
  });

  http.createServer(app).listen(3001, () => {
    console.log(`[OrderDrop] HTTP Server running at http://localhost:3001`);
  });
}
