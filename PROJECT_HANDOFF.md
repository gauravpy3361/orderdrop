# 📦 OrderDrop — Master Project Handoff & Architecture Blueprint
**Version**: 1.1.0 (Hardened Production Release)  
**Author**: Gaurav Joshi  
**Date**: November 2026  
**License**: Proprietary / MIT  

---

## 🧭 1. Executive Overview
**OrderDrop** is a production B2B SaaS application built for Shopify e-commerce merchants. It connects to stores via Shopify's GraphQL Admin API, extracts pending unfulfilled orders, formats them into warehouse-ready pick-and-pack Excel spreadsheets (`.xlsx`) with formula-injection defenses, and automatically dispatches them to warehouse teams on a daily schedule via Resend DKIM/SPF-authenticated email.

* **Live Branded URL**: [https://orderdrop.store](https://orderdrop.store)
* **Production Cloud Service**: [https://orderdrop.onrender.com](https://orderdrop.onrender.com)
* **Health Check**: [https://orderdrop.store/health](https://orderdrop.store/health)
* **GitHub Repository**: [https://github.com/gauravpy3361/orderdrop](https://github.com/gauravpy3361/orderdrop)
* **Shopify Test Store**: `hk-mart-cfoepmjd.myshopify.com`

---

## 📂 2. File Index & Directory Structure

All files reside on your local machine at:  
📁 `C:\Users\gaurav\.gemini\antigravity\scratch\orderdrop\`

```
orderdrop/
├── server.js               # Main Express.js application, routes, auth middleware, App Bridge UI
├── shopify.js              # Shopify GraphQL API client, HMAC, OAuth state CSRF, App Bridge JWT & session crypto
├── export_engine.js        # ExcelJS spreadsheet generator & CSV/Excel formula injection sanitizer
├── db.js                   # Dual-persistence layer: Neon Serverless PostgreSQL + local fallback cache
├── scheduler.js            # Node-cron background worker for automated daily order dispatch
├── mailer.js               # Resend transactional email dispatcher with HTML escaping & DKIM domain
├── test_orderdrop.js       # 12-suite automated unit, route security, and integration test runner
├── verify_production.py    # 18-point live cloud penetration and security audit script
├── package.json            # Node.js dependencies, scripts, and project metadata
├── .env                    # Local environment secrets (gitignored)
├── .gitignore              # Git ignore rules for node_modules, data/, temp files, and credentials
├── assets/                 # Official Shopify App Store listing graphics (1200x1200 & 1600x900)
└── kanban/                 # Obsidian-native Agile task management board
```

---

## ⚙️ 3. Core Subsystems & Security Architecture

### `server.js` (Core Server & Web Routing)
* Serves the public marketing landing page (`/`), privacy policy (`/privacy`), support (`/support`), and terms (`/terms`).
* Embeds **Shopify App Bridge** (`https://cdn.shopify.com/shopifycloud/app-bridge.js`) and strictly requires a valid Shopify HMAC signature, App Bridge HS256 JWT (`id_token`), or signed session token on `GET /?shop=...` (returning `401 Unauthorized` to unauthenticated visitors).
* Handles OAuth 2.0 handshake (`/auth` and `/auth/callback`) with SSRF domain validation, HMAC verification, and signed `state` CSRF verification.
* Protects `/api/billing/subscribe` and `/api/billing/confirm` with session authentication and verifies `currentAppInstallation.activeSubscriptions` via Shopify GraphQL before marking any subscription active.
* Protects `/api/settings`, `/api/export`, and `/api/send-email` with cryptographic session tokens and two-tier rate limiting.
* Listens to Shopify GDPR webhooks (`/webhooks/customers/data_request`, `/webhooks/customers/redact`, `/webhooks/shop/redact`, `/webhooks/app/uninstalled`).

### `shopify.js` (Shopify Integration & Cryptography)
* `isValidShopDomain(shop)`: Strict regex validation against `^[a-zA-Z0-9][a-zA-Z0-9\-]*\.myshopify\.com$`.
* `verifyHmac(params, secret)` & `verifyWebhookHmac(rawBody, headerHmac, secret)`: Timing-safe HMAC verification.
* `createOAuthState(shop, secret)` & `verifyOAuthState(state, shop, secret)`: Stateless signed OAuth `state` CSRF protection.
* `verifyAppBridgeJwt(jwt, clientId, clientSecret, shop)`: Verifies Shopify App Bridge HS256 JWT session tokens.
* `createSessionToken(shop, secret)` & `verifySessionToken(token, shop, secret)`: Signs and validates merchant dashboard session tokens.
* `fetchUnfulfilledOrders(shop, accessToken)`: GraphQL cursor pagination fetching up to 250 unfulfilled orders.
* `createAppSubscription(...)` & `checkActiveSubscription(...)`: Creates and verifies recurring billing charges ($9.99/mo or $99.99/yr) with 7-day free trial.

---

## 🔒 4. Environment Variables (`.env` — Do Not Commit Secrets)

```env
PORT=3000
SHOPIFY_CLIENT_ID=<your_shopify_client_id>
SHOPIFY_CLIENT_SECRET=<your_shopify_client_secret>
APP_URL=https://orderdrop.store
DATABASE_URL=postgresql://<user>:<password>@<neon_host>/neondb?sslmode=require
RESEND_API_KEY=<your_resend_api_key>
RESEND_FROM_EMAIL=OrderDrop <orders@orderdrop.store>
SHOP_DOMAIN=hk-mart-cfoepmjd.myshopify.com
SHOPIFY_BILLING_TEST=false
```

---

## 🚀 5. How to Run & Verify

```powershell
cd C:\Users\gaurav\.gemini\antigravity\scratch\orderdrop
npm test
python verify_production.py
```
