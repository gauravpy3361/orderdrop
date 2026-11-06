---
title: "04 · Done"
type: kanban-column
column_id: done
aliases: ["Done", "Completed", "Shipped"]
tags:
  - kanban/column
  - project/orderdrop
  - stage/done
created: 2026-11-02
---

# ✅ 04 · Done (Completed & Shipped)

> **Navigation**: [[Kanban_Board|📋 Master Board]] · [[01_Backlog|📥 01 Backlog]] · [[02_To_Do|⏳ 02 To Do]] · [[03_In_Progress|🔄 03 In Progress]] · **[[04_Done|✅ 04 Done]]**

---

## 📊 Column Metrics
* **Total Shipped**: 11 Major Epics
* **Velocity**: 100% test pass rate (8/8)
* **Zero Ongoing Cost**: Maintained (Render Free + Neon Free + ₹99 domain)

---

### ✅ CARD-10: Edge SSL & Branded Custom Domain Binding on Render
* **Tags**: #devops #render #ssl #shipped
* **Completed**: 2026-11-03 14:20 UTC+5:30
* **Delivered**:
  - Bound apex domain `orderdrop.store` and subdomain `www.orderdrop.store` to Render edge.
  - Automated Let's Encrypt TLS certificate issued and validated.
  - Public health verification: `https://orderdrop.store/health` and `https://www.orderdrop.store/health` both return `200 OK`.
  - Automatic HTTP-to-HTTPS redirect enforced.

---

### ✅ CARD-09: Radix Registry Unsuspension & Global Domain Activation
* **Tags**: #domain #dns #radix #shipped
* **Completed**: 2026-11-03 13:44 UTC+5:30
* **Delivered**:
  - Successfully lifted algorithmic `serverHold` from global registry operator Radix.
  - Provided comprehensive technical proof: live Render service, health endpoint, GitHub source code, and dashboard screenshots.
  - Domain `orderdrop.store` status updated to `Active` (WHOIS `serverHold` removed).
  - Public DNS propagation confirmed via Google DNS `8.8.8.8` pointing to Render's IP `216.24.57.1`.

---

### ✅ CARD-19: CTO Security Audit Remediations & Hardening
* **Tags**: #security #cve #hardening #shipped
* **Completed**: 2026-11-02 23:40 UTC+5:30
* **Delivered**:
  - Implemented cryptographic HMAC session tokens on `/api/settings` and `/api/export` in [[server.js]] and [[shopify.js]].
  - Escaped Excel/CSV Formula Injection vectors (`=`, `+`, `-`, `@`, `\t`, `\r`) in [[export_engine.js]].
  - Hardened regex subdomain validation (`isValidShopDomain`) to protect against SSRF and open redirect attacks.
  - Eliminated DB startup race condition via `async init()` in [[db.js]].
  - Expanded automated test suite from 5 to 8 tests in [[test_orderdrop.js]] (8/8 passing).

---

### ✅ CARD-11: Dual Recurring Subscription Billing ($9.99/mo & $99.99/yr)
* **Tags**: #billing #shopify-api #revenue #shipped
* **Completed**: 2026-11-02
* **Delivered**:
  - Implemented GraphQL `appSubscriptionCreate` in [[shopify.js]] supporting:
    * **Monthly Plan**: $9.99 billed every 30 days (`EVERY_30_DAYS`) with 7-day free trial.
    * **Annual Plan**: $99.99 billed annually (`ANNUAL`, Save 17% / 2 Months Free) with 7-day free trial.
  - Wired `/api/billing/subscribe` and `/api/billing/confirm` in [[server.js]].
  - Zero upfront credit card requirement: Stores install with immediate 7-day trial access.
  - Interactive pricing tier selection cards added to dashboard.

---

### ✅ CARD-12: Cloud Database Persistence via Neon Serverless PostgreSQL
* **Tags**: #database #neon #persistence #shipped
* **Completed**: 2026-11-02
* **Delivered**:
  - Provisioned Neon project `my-first-project` (Postgres 16, US-East-2).
  - Built connection pooler with SSL support in [[db.js]].
  - Implemented automatic in-memory write-through cache + file fallback (`shops.json`).
  - Successfully verified persistent store installation state and dispatch schedules.

---

### ✅ CARD-13: Resend Enterprise Custom Domain Verification (SPF / DKIM / DMARC)
* **Tags**: #email #resend #dns #shipped
* **Completed**: 2026-11-02
* **Delivered**:
  - Verified `orderdrop.store` in Resend dashboard.
  - Added DKIM (`resend._domainkey`), SPF (`rsend` CNAME), and DMARC (`_dmarc` TXT) in Hostinger DNS.
  - Dispatched live test email with attached pick-and-pack `.xlsx` spreadsheet from `OrderDrop <orders@orderdrop.store>` to `gauravjoshi3361@gmail.com`. Delivery status confirmed **Delivered**.

---

### ✅ CARD-14: Production Web Service Deployment on Render
* **Tags**: #deployment #render #devops #shipped
* **Completed**: 2026-11-02
* **Delivered**:
  - Fixed reverse proxy rate-limiting issue via `app.set('trust proxy', 1)`.
  - Configured environment variables (`DATABASE_URL`, `CLIENT_ID`, `CLIENT_SECRET`, `RESEND_API_KEY`, `CRON_SECRET`).
  - Auto-deploy pipeline linked to GitHub repository `gauravpy3361/orderdrop` (`main` branch).
  - Production service live and healthy at `https://orderdrop.onrender.com`.

---

### ✅ CARD-15: Warehouse Pick-and-Pack Excel Generation Engine
* **Tags**: #excel #engine #fulfillment #shipped
* **Completed**: 2026-11-01
* **Delivered**:
  - ExcelJS generator producing styled `.xlsx` workbooks with branded green header row.
  - Automatic parsing of order items, quantities, totals, customer shipping addresses, and order tags.
  - Empty queue handler generating graceful "0 orders pending" workbook.
  - Direct download endpoint `/api/export` and email attachment streaming.

---

### ✅ CARD-16: Shopify OAuth Handshake & GDPR Mandatory Webhooks
* **Tags**: #shopify #security #compliance #shipped
* **Completed**: 2026-11-01
* **Delivered**:
  - Timing-safe HMAC calculation and verification for query params and webhook payloads.
  - Offline access token exchange flow.
  - Mandatory GDPR compliance endpoints: `customers/data_request`, `customers/redact`, `shop/redact`, `app/uninstalled`.

---

### ✅ CARD-17: Pixel-Perfect Shopify App Store Visual Assets
* **Tags**: #design #assets #app-store #shipped
* **Completed**: 2026-11-02
* **Delivered**:
  - Generated 1200x1200px App Icon: `assets/app_icon_1200x1200.png`.
  - Generated Screenshot 1: Orders Dashboard (1600x900px).
  - Generated Screenshot 2: Excel Pick Sheet (1600x900px).
  - Generated Screenshot 3: Daily Email Schedule (1600x900px).

---

### ✅ CARD-18: Automated Test Suite (5/5 Passing)
* **Tags**: #testing #qa #ci #shipped
* **Completed**: 2026-11-02
* **Delivered**:
  - Comprehensive automated test runner in `test_orderdrop.js`.
  - Verified HMAC verification, DB persistence, webhook parsing, and Excel generation.
  - 100% test pass rate maintained across all deploys.
