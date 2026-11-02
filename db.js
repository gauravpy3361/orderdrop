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

if (process.env.DATABASE_URL) {
  try {
    pgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });

    // Initialize DB table and load existing shops from Postgres into memory
    (async () => {
      try {
        await pgPool.query(`
          CREATE TABLE IF NOT EXISTS shops (
            shop VARCHAR(255) PRIMARY KEY,
            data JSONB NOT NULL,
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
          );
        `);
        const res = await pgPool.query('SELECT shop, data FROM shops;');
        for (const row of res.rows) {
          shops[row.shop.toLowerCase().trim()] = row.data;
        }
        console.log(`[DB] Loaded ${res.rows.length} store(s) from persistent PostgreSQL.`);
      } catch (err) {
        console.error('[DB] PostgreSQL init/sync error:', err.message);
      }
    })();
  } catch (poolErr) {
    console.error('[DB] Failed to initialize PostgreSQL pool:', poolErr.message);
  }
}

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
  if (!pgPool) return;
  try {
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
  if (!pgPool) return;
  try {
    await pgPool.query('DELETE FROM shops WHERE shop = $1;', [shopDomain]);
  } catch (err) {
    console.error(`[DB] Error deleting shop ${shopDomain} from PostgreSQL:`, err.message);
  }
}

// Initial local load
loadLocal();

module.exports = {
  getShop(domain) {
    if (!domain) return null;
    const cleanDomain = domain.toLowerCase().trim();
    return shops[cleanDomain] || null;
  },

  saveShop(domain, data) {
    if (!domain) return null;
    const cleanDomain = domain.toLowerCase().trim();
    const existing = shops[cleanDomain] || {};
    shops[cleanDomain] = {
      shop: cleanDomain,
      installedAt: existing.installedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      scheduleTime: '18:00',
      recipientEmail: process.env.MERCHANT_EMAIL || 'www.sunitajoshi98765@gmail.com',
      autoDispatchEnabled: true,
      plan: 'Starter ($9.99/mo)',
      subscriptionStatus: 'active',
      subscriptionId: null,
      ...existing,
      ...data
    };
    persistLocal();
    persistPg(cleanDomain, shops[cleanDomain]);
    return shops[cleanDomain];
  },

  deleteShop(domain) {
    if (!domain) return false;
    const cleanDomain = domain.toLowerCase().trim();
    if (shops[cleanDomain]) {
      delete shops[cleanDomain];
      persistLocal();
      deletePg(cleanDomain);
      return true;
    }
    return false;
  },

  getAllShops() {
    return Object.values(shops);
  },

  getAllActiveShops() {
    return Object.values(shops).filter(s => s.accessToken && s.autoDispatchEnabled);
  }
};
