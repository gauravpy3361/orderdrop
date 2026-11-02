const cron = require('node-cron');
const db = require('./db');
const shopify = require('./shopify');
const { generateOrdersWorkbook } = require('./export_engine');
const { sendOrdersEmail } = require('./mailer');

/**
 * Run a full orders dispatch for a single store
 */
async function runDispatchForShop(shopDomain, recipientOverride = null) {
  const shopData = db.getShop(shopDomain);
  if (!shopData) {
    throw new Error(`Shop "${shopDomain}" not found in database.`);
  }

  const recipient = recipientOverride || shopData.recipientEmail;
  if (!recipient || !recipient.trim()) {
    throw new Error(`No recipient email configured for shop "${shopDomain}".`);
  }

  let orders = [];

  // Fetch real unfulfilled orders if access token is present
  if (shopData.accessToken) {
    console.log(`[Scheduler] Fetching live Shopify orders for ${shopDomain}...`);
    try {
      orders = await shopify.fetchUnfulfilledOrders(shopData.shop, shopData.accessToken);
    } catch (err) {
      console.error(`[Scheduler] Failed to fetch live orders for ${shopDomain}:`, err.message);
      db.saveShop(shopDomain, {
        lastDispatchStatus: `error: ${err.message}`,
        lastDispatchedAt: new Date().toISOString()
      });
      throw new Error(`Order fetch failed: ${err.message}. Aborting dispatch to prevent sending inaccurate data.`);
    }
  } else {
    console.log(`[Scheduler] No access token for ${shopDomain}, generating empty template.`);
    orders = [];
  }

  // Generate Excel buffer
  const { buffer, filename } = await generateOrdersWorkbook(orders, shopData.shop);

  // Send email
  console.log(`[Scheduler] Dispatching workbook "${filename}" (${orders.length} orders) to ${recipient}...`);
  const result = await sendOrdersEmail({
    to: recipient,
    shop: shopData.shop,
    orderCount: orders.length,
    excelBuffer: buffer,
    filename: filename
  });

  // Update last dispatch timestamp & metrics
  db.saveShop(shopDomain, {
    lastDispatchedAt: new Date().toISOString(),
    lastOrderCount: orders.length,
    lastDispatchStatus: 'success'
  });

  return {
    success: true,
    emailId: result.id,
    orderCount: orders.length,
    filename: filename,
    recipient: recipient
  };
}

/**
 * Scheduled pass checking all active stores
 */
async function runScheduledPass() {
  const activeShops = db.getAllActiveShops();
  if (activeShops.length === 0) return;

  const now = new Date();
  const currentHour = String(now.getUTCHours()).padStart(2, '0');

  for (const shop of activeShops) {
    // Check if store's schedule matches current UTC time (matching hourly window)
    const targetTime = shop.scheduleTime || '18:00';
    const [targetHour] = targetTime.split(':');
    
    // Check if already dispatched today in this hour
    const lastDispatched = shop.lastDispatchedAt ? new Date(shop.lastDispatchedAt) : null;
    const dispatchedToday = lastDispatched && 
      lastDispatched.getUTCFullYear() === now.getUTCFullYear() &&
      lastDispatched.getUTCMonth() === now.getUTCMonth() &&
      lastDispatched.getUTCDate() === now.getUTCDate() &&
      lastDispatched.getUTCHours() === now.getUTCHours() &&
      shop.lastDispatchStatus === 'success';

    if (currentHour === targetHour && !dispatchedToday) {
      console.log(`[Scheduler] Executing scheduled daily dispatch for ${shop.shop}...`);
      try {
        await runDispatchForShop(shop.shop);
      } catch (err) {
        console.error(`[Scheduler] Error in scheduled run for ${shop.shop}:`, err.message);
        db.saveShop(shop.shop, { 
          lastDispatchStatus: 'error: ' + err.message,
          lastDispatchedAt: new Date().toISOString()
        });
      }
    }
  }
}

// Start cron runner: checks every 15 minutes
function startCron() {
  cron.schedule('*/15 * * * *', async () => {
    try {
      await runScheduledPass();
    } catch (err) {
      console.error('[Scheduler] Cron pass error:', err.message);
    }
  });
  console.log('[Scheduler] Multi-tenant background cron runner active.');
}

module.exports = {
  runDispatchForShop,
  runScheduledPass,
  startCron
};
