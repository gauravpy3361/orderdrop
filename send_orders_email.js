const fs = require('fs');
const path = require('path');
const { Resend } = require('resend');
const ExcelJS = require('exceljs');

// 1. Read API Key from .env
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

const apiKey = process.env.RESEND_API_KEY;
const recipient = process.env.MERCHANT_EMAIL || 'www.sunitajoshi98765@gmail.com';

if (!apiKey) {
  console.error('[ERROR] RESEND_API_KEY is not defined in .env');
  process.exit(1);
}

const resend = new Resend(apiKey);

// 2. Generate Orders Excel Buffer
async function generateWorkbookBuffer() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'OrderDrop';
  const worksheet = workbook.addWorksheet('Daily Orders');

  worksheet.columns = [
    { header: 'Order #', key: 'order', width: 14 },
    { header: 'Date', key: 'date', width: 14 },
    { header: 'Customer Name', key: 'customer', width: 22 },
    { header: 'Email', key: 'email', width: 26 },
    { header: 'Item Name', key: 'item', width: 28 },
    { header: 'Quantity', key: 'qty', width: 10 },
    { header: 'Price', key: 'price', width: 14 },
    { header: 'Total Paid', key: 'total', width: 14 },
    { header: 'Fulfillment Status', key: 'status', width: 20 },
    { header: 'Destination', key: 'dest', width: 32 }
  ];

  // Slate 900 styled header row
  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF0F172A' }
  };
  headerRow.height = 24;

  // Add real store order #1001
  worksheet.addRow({
    order: '#1001',
    date: '2026-11-01',
    customer: 'Gourav Joshi',
    email: 'www.sunitajoshi98765@gmail.com',
    item: 'Test Gym Bands',
    qty: 1,
    price: '$29.99',
    total: '$29.99',
    status: 'UNFULFILLED',
    dest: 'Shop Location, United States'
  });

  return await workbook.xlsx.writeBuffer();
}

// 3. Dispatch Email via Resend
async function dispatch() {
  console.log(`[OrderDrop] Generating Excel spreadsheet for Order #1001...`);
  const excelBuffer = await generateWorkbookBuffer();

  console.log(`[OrderDrop] Dispatching email with Excel attachment to: ${recipient}...`);

  const response = await resend.emails.send({
    from: 'OrderDrop <onboarding@resend.dev>',
    to: [recipient],
    subject: `📦 Daily Orders Export: 1 Unfulfilled Order (#1001)`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
        <div style="display: flex; align-items: center; margin-bottom: 20px;">
          <h2 style="margin: 0; color: #0f172a; font-size: 20px;">OrderDrop Daily Fulfillment Dispatch</h2>
        </div>
        <p style="color: #475569; font-size: 15px; line-height: 1.5;">
          Hello! Here is your daily order compilation for <strong>Hk mart</strong> (<code>hk-mart-cfoepmjd.myshopify.com</code>).
        </p>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 20px 0;">
          <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <tr>
              <td style="color: #64748b; padding-bottom: 8px;">Order Count:</td>
              <td style="font-weight: 600; color: #0f172a; text-align: right; padding-bottom: 8px;">1 unfulfilled order</td>
            </tr>
            <tr>
              <td style="color: #64748b; padding-bottom: 8px;">Sample Order:</td>
              <td style="font-weight: 600; color: #0f172a; text-align: right; padding-bottom: 8px;">#1001 (Test Gym Bands)</td>
            </tr>
            <tr>
              <td style="color: #64748b;">Total Value:</td>
              <td style="font-weight: 600; color: #16a34a; text-align: right;">$29.99 USD</td>
            </tr>
          </table>
        </div>
        <p style="color: #475569; font-size: 14px;">
          The clean warehouse pick-and-pack spreadsheet is attached as <code>HK_Mart_Orders_2026-11-01.xlsx</code>.
        </p>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
        <p style="color: #94a3b8; font-size: 12px; margin: 0;">
          Sent automatically by <strong>OrderDrop</strong> · Micro-SaaS for Shopify.
        </p>
      </div>
    `,
    attachments: [
      {
        filename: 'HK_Mart_Orders_2026-11-01.xlsx',
        content: Buffer.from(excelBuffer)
      }
    ]
  });

  if (response.error) {
    console.error('[FAILED]', response.error);
  } else {
    console.log(`[SUCCESS] Email successfully sent! Delivery ID: ${response.data.id}`);
  }
}

dispatch().catch(err => {
  console.error('[UNHANDLED ERROR]', err);
});
