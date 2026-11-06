const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'shops.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// In-memory cache synced with disk and PostgreSQL
let shops = {};
let pgPool = null;
let initPromise = null;

function loadLocal() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const data = fs.readFileSync(DB_FILE, 'utf8');
      shops = { ...shops, ...JSON.parse(data) };
    }
  } catch (err) {
    console.error('[DB] Error loading shops file:', err.message);
  }
}

function persistLocal() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(shops, null, 2), 'utf8');
  } catch (err) {
    console.error('[DB] Error saving shops file:', err.message);
  }
}

async function persistPg(shopDomain, data) {
  if (!pgPool && !initPromise) return;
  try {
    if (initPromise) {
      await initPromise;
    }
    if (!pgPool) return;
    await pgPool.query(`
      INSERT INTO shops (shop, data, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (shop) DO UPDATE SET data = $2, updated_at = NOW();
    `, [shopDomain, JSON.stringify(data)]);
  } catch (err) {
    console.error(`[DB] Error persisting shop ${shopDomain} to PostgreSQL:`, err.message);
  }
}

async function deletePg(shopDomain) {
  if (!pgPool && !initPromise) return;
  try {
    if (initPromise) {
      await initPromise;
    }
    if (!pgPool) return;
    await pgPool.query('DELETE FROM shops WHERE shop = $1;', [shopDomain]);
  } catch (err) {
    console.error(`[DB] Error deleting shop ${shopDomain} from PostgreSQL:`, err.message);
  }
}

// Initial local load from disk
loadLocal();

async function init() {
  if (!process.env.DATABASE_URL) {
    return shops;
  }

  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      if (!pgPool) {
        pgPool = new Pool({
          connectionString: process.env.DATABASE_URL,
          ssl: { rejectUnauthorized: false }
        });
      }

      await pgPool.query(`
        CREATE TABLE IF NOT EXISTS shops (
          shop VARCHAR(255) PRIMARY KEY,
          data JSONB NOT NULL,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
      `);

      const res = await pgPool.query('SELECT shop, data FROM shops;');
      for (const row of res.rows) {
        const key = row.shop.toLowerCase().trim();
        shops[key] = { ...(shops[key] || {}), ...row.data };
      }
      persistLocal();
      console.log(`[DB] Loaded ${res.rows.length} store(s) from persistent PostgreSQL.`);
      return shops;
    } catch (err) {
      console.error('[DB] PostgreSQL init/sync error:', err.message);
      return shops;
    }
  })();

  return initPromise;
}

async function close() {
  if (pgPool) {
    const pool = pgPool;
    pgPool = null;
    initPromise = null;
    await pool.end().catch(() => {});
  }
}

module.exports = {
  init,
  close,

  getShop(domain) {
    if (!domain) return null;
    const cleanDomain = domain.toLowerCase().trim();
    return shops[cleanDomain] || null;
  },

  saveShop(domain, data) {
    if (!domain) return null;
    const cleanDomain = domain.toLowerCase().trim();
    const existing = shops[cleanDomain] || {};
    const defaultDevShop = (process.env.SHOP_DOMAIN || 'hk-mart-cfoepmjd.myshopify.com').toLowerCase().trim();
    const isDevStore = cleanDomain === defaultDevShop;

    shops[cleanDomain] = {
      shop: cleanDomain,
      installedAt: existing.installedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      scheduleTime: existing.scheduleTime || '18:00',
      recipientEmail: existing.recipientEmail !== undefined 
        ? existing.recipientEmail 
        : (isDevStore ? (process.env.MERCHANT_EMAIL || '') : ''),
      autoDispatchEnabled: existing.autoDispatchEnabled !== undefined 
        ? existing.autoDispatchEnabled 
        : (isDevStore && Boolean(process.env.MERCHANT_EMAIL)),
      plan: existing.plan || 'Free Trial (7 Days)',
      subscriptionStatus: existing.subscriptionStatus || 'trial',
      trialEndsAt: existing.trialEndsAt || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      subscriptionId: existing.subscriptionId || null,
      ...existing,
      ...data
    };

    persistLocal();
    persistPg(cleanDomain, shops[cleanDomain]).catch(() => {});
    return shops[cleanDomain];
  },

  deleteShop(domain) {
    if (!domain) return false;
    const cleanDomain = domain.toLowerCase().trim();
    if (shops[cleanDomain]) {
      delete shops[cleanDomain];
      persistLocal();
      deletePg(cleanDomain).catch(() => {});
      return true;
    }
    return false;
  },

  getAllShops() {
    return Object.values(shops);
  },

  getAllActiveShops() {
    const now = new Date();
    return Object.values(shops).filter(s => {
      // Must have valid credentials, recipient, and enabled dispatch
      if (!s.accessToken || !s.autoDispatchEnabled || !s.recipientEmail || !s.recipientEmail.trim()) {
        return false;
      }
      // Must be active subscriber OR within 7-day free trial
      if (s.subscriptionStatus === 'active') {
        return true;
      }
      if (s.subscriptionStatus === 'trial' || s.plan?.includes('Trial')) {
        if (!s.trialEndsAt) return true;
        return new Date(s.trialEndsAt) > now;
      }
      return false;
    });
  }
};
