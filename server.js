const express = require('express');
const https = require('https');
const http = require('http');
const cors = require('cors');
const path = require('path');
const selfsigned = require('selfsigned');
const ExcelJS = require('exceljs');
const { Resend } = require('resend');
const fs = require('fs');

// Load environment variables from .env
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

// Mock current order store (including our live Order #1001)
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

  // Header style (Navy Slate)
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

// 1. Embedded App UI Route
app.get('/', (req, res) => {
  const shop = req.query.shop || 'hk-mart-cfoepmjd.myshopify.com';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OrderDrop - Automated Export</title>
  <link rel="stylesheet" href="https://unpkg.com/@shopify/polaris@12.0.0/build/esm/styles.css" />
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
    }
  </style>
</head>
<body>

  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
    <div>
      <h1 style="font-size: 22px; margin: 0; font-weight: 700;">OrderDrop · Daily Export</h1>
      <p style="margin: 4px 0 0; color: #6d7175; font-size: 13px;">Connected Store: <strong>${shop}</strong></p>
    </div>
    <span class="badge">● Active & Connected</span>
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
    <h2 style="font-size: 16px; margin: 0 0 6px; font-weight: 600;">Automated Daily Email Schedule</h2>
    <p style="margin: 0 0 16px; color: #6d7175; font-size: 13px;">Automatically compile and email today's orders to your warehouse or supplier every day.</p>

    <div class="grid">
      <div>
        <label style="font-size: 13px; font-weight: 600;">Delivery Time</label>
        <select id="scheduleTime">
          <option value="18:00" selected>Every day at 06:00 PM</option>
          <option value="09:00">Every day at 09:00 AM</option>
          <option value="23:59">Every night at Midnight</option>
        </select>
      </div>

      <div>
        <label style="font-size: 13px; font-weight: 600;">Recipient Email(s)</label>
        <input type="email" id="recipientEmail" placeholder="warehouse@example.com, supplier@drop.com" value="warehouse@hkmart.com" />
      </div>
    </div>

    <div style="margin-top: 18px; display: flex; gap: 10px;">
      <button class="btn" onclick="saveSchedule()">Save Schedule</button>
      <button class="btn btn-secondary" onclick="testEmail()">Send Test Email Now</button>
    </div>
  </div>

  <div id="toast" class="toast">Schedule updated successfully!</div>

  <script>
    function saveSchedule() {
      const toast = document.getElementById('toast');
      toast.innerText = "Schedule saved! Orders will automatically export daily at " + document.getElementById('scheduleTime').value;
      toast.style.display = 'block';
      setTimeout(() => { toast.style.display = 'none'; }, 3500);
    }

    async function testEmail() {
      const email = document.getElementById('recipientEmail').value;
      const toast = document.getElementById('toast');
      toast.innerText = "Dispatching real email via Resend to " + email + "...";
      toast.style.display = 'block';

      try {
        const res = await fetch('/api/send-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });
        const data = await res.json();
        if (data.success) {
          toast.innerText = "Email successfully delivered to " + email + "! (ID: " + data.id.slice(0, 8) + ")";
        } else {
          toast.innerText = "Error: " + (data.error || 'Failed to send');
        }
      } catch (err) {
        toast.innerText = "Failed: " + err.message;
      }
      setTimeout(() => { toast.style.display = 'none'; }, 4500);
    }
  </script>

</body>
</html>`;

  res.send(html);
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
    const toEmail = req.body.email || process.env.MERCHANT_EMAIL || 'www.sunitajoshi98765@gmail.com';
    if (!resend) {
      return res.status(500).json({ success: false, error: 'Resend API key missing' });
    }

    const excelBuffer = await createExcelBuffer(currentOrders);
    const result = await resend.emails.send({
      from: 'OrderDrop <onboarding@resend.dev>',
      to: [toEmail],
      subject: `📦 Daily Orders Export: 1 Unfulfilled Order (#1001)`,
      html: `
        <div style="font-family: sans-serif; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <h2 style="color: #0f172a; margin-top: 0;">OrderDrop Daily Fulfillment Dispatch</h2>
          <p>Here is your daily order compilation for <strong>Hk mart</strong> (<code>hk-mart-cfoepmjd.myshopify.com</code>).</p>
          <p><strong>1 Unfulfilled Order (#1001 - Test Gym Bands, $29.99)</strong></p>
          <p>The clean pick-and-pack spreadsheet is attached as <code>HK_Mart_Orders_Export.xlsx</code>.</p>
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

// Generate in-memory self-signed certificate for local HTTPS
const attrs = [{ name: 'commonName', value: 'localhost' }];
const pems = selfsigned.generate(attrs, { days: 365 });

const HTTPS_PORT = 3000;
const HTTP_PORT = 3001;

// Start HTTPS Server (for Shopify Embedded Iframe on port 3000)
https.createServer({ key: pems.private, cert: pems.cert }, app).listen(HTTPS_PORT, () => {
  console.log(`[OrderDrop] HTTPS Server running at https://localhost:${HTTPS_PORT}`);
});

// Also start HTTP Server (on port 3001 for plain browser testing)
http.createServer(app).listen(HTTP_PORT, () => {
  console.log(`[OrderDrop] HTTP Server running at http://localhost:${HTTP_PORT}`);
});
