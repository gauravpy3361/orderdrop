const { Resend } = require('resend');

let resendInstance = null;

function getResend() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  if (!resendInstance) {
    resendInstance = new Resend(apiKey);
  }
  return resendInstance;
}

/**
 * Send an Excel orders dispatch email via Resend
 * @param {Object} options
 * @param {string} options.to - Recipient email
 * @param {string} options.shop - Store domain
 * @param {number} options.orderCount - Number of unfulfilled orders
 * @param {Buffer} options.excelBuffer - .xlsx buffer
 * @param {string} options.filename - attachment filename
 */
async function sendOrdersEmail({ to, shop, orderCount, excelBuffer, filename }) {
  const resend = getResend();
  if (!resend) {
    throw new Error('Resend API key is not configured in environment variables');
  }

  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!to || !emailRegex.test(to.trim())) {
    throw new Error(`Invalid recipient email address: "${to}"`);
  }

  const cleanShop = shop.replace('.myshopify.com', '');
  const subject = `📦 ${cleanShop} Daily Orders: ${orderCount} Unfulfilled Order(s) [${new Date().toISOString().split('T')[0]}]`;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1e293b; margin: 0; padding: 20px; background-color: #f8fafc; }
        .card { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 28px; max-width: 600px; margin: 0 auto; box-shadow: 0 2px 4px rgba(0,0,0,0.04); }
        .badge { display: inline-block; background: #0f172a; color: white; padding: 4px 10px; border-radius: 6px; font-size: 12px; font-weight: 600; }
        .summary-box { background: #f1f5f9; border-radius: 8px; padding: 16px; margin: 20px 0; border: 1px solid #e2e8f0; }
        .footer { font-size: 12px; color: #94a3b8; text-align: center; margin-top: 24px; }
      </style>
    </head>
    <body>
      <div class="card">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
          <h2 style="margin: 0; color: #0f172a; font-size: 20px;">📦 OrderDrop Daily Dispatch</h2>
          <span class="badge">Warehouse Ready</span>
        </div>
        <p style="margin: 0 0 12px; color: #475569; font-size: 14px;">Here is the automated daily orders export for <strong>${shop}</strong>.</p>
        
        <div class="summary-box">
          <div style="font-size: 14px; font-weight: 600; color: #0f172a;">Export Details</div>
          <div style="font-size: 13px; color: #475569; margin-top: 6px;">Total Pending Orders: <strong>${orderCount} order(s)</strong></div>
          <div style="font-size: 13px; color: #475569; margin-top: 4px;">Attached Workbook: <code>${filename}</code></div>
        </div>

        <p style="font-size: 13px; color: #64748b; line-height: 1.5; margin: 0;">The attached Excel spreadsheet has been formatted with standardized columns (Order #, SKU, Item Title, Quantity, Customer, and Shipping Address) for immediate pick-and-pack fulfillment.</p>
        
        <div class="footer">
          Generated automatically by OrderDrop · <a href="https://orderdrop.onrender.com" style="color: #64748b;">OrderDrop SaaS</a>
        </div>
      </div>
    </body>
    </html>
  `;

  // Production from address (or onboarding@resend.dev sandbox)
  const fromAddress = process.env.RESEND_FROM_EMAIL || 'OrderDrop <onboarding@resend.dev>';

  const result = await resend.emails.send({
    from: fromAddress,
    to: [to.trim()],
    subject: subject,
    html: html,
    attachments: [
      {
        filename: filename,
        content: Buffer.from(excelBuffer)
      }
    ]
  });

  if (result.error) {
    throw new Error(`Resend error: ${result.error.message}`);
  }

  return { success: true, id: result.data.id };
}

module.exports = {
  sendOrdersEmail
};
