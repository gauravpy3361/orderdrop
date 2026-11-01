const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'shops.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// In-memory cache synced with disk
let shops = {};

function load() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const data = fs.readFileSync(DB_FILE, 'utf8');
      shops = JSON.parse(data);
    }
  } catch (err) {
    console.error('[DB] Error loading shops file:', err.message);
    shops = {};
  }
}

function persist() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(shops, null, 2), 'utf8');
  } catch (err) {
    console.error('[DB] Error saving shops file:', err.message);
  }
}

// Initial load
load();

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
    persist();
    return shops[cleanDomain];
  },

  deleteShop(domain) {
    if (!domain) return false;
    const cleanDomain = domain.toLowerCase().trim();
    if (shops[cleanDomain]) {
      delete shops[cleanDomain];
      persist();
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
