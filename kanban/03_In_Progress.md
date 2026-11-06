---
title: "03 · In Progress"
type: kanban-column
column_id: in-progress
aliases: ["In Progress", "Doing", "Active Tasks"]
tags:
  - kanban/column
  - project/orderdrop
  - stage/in-progress
created: 2026-11-02
---

# 🔄 03 · In Progress (Active Sprint Execution)

> **Navigation**: [[Kanban_Board|📋 Master Board]] · [[01_Backlog|📥 01 Backlog]] · [[02_To_Do|⏳ 02 To Do]] · **[[03_In_Progress|🔄 03 In Progress]]** · [[04_Done|✅ 04 Done]]

---

## 📊 Column Metrics
* **WIP Limit**: 3 Tasks (Agile focus rule)
* **Total Active**: 2
* **Current Focus**: Shopify Partner App Store submission & custom domain endpoint cutover.

---

### 🔄 CARD-07: Update App URL to Custom Domain in Partner Dashboard
* **Tags**: #devops #shopify-config #priority/high #status/active
* **Started**: 2026-11-03 14:21 UTC+5:30
* **Details**:
  - Update App URL from `https://orderdrop.onrender.com` to `https://orderdrop.store`.
  - Update Allowed redirection URL(s) to include `https://orderdrop.store/auth/callback`.
  - Update mandatory GDPR webhook targets.
* **Acceptance Criteria**:
  - [ ] App URL set to `https://orderdrop.store`.
  - [ ] Redirect URL set to `https://orderdrop.store/auth/callback`.
  - [ ] Test store installation re-verified over new custom domain.

---

### 🔄 CARD-05: Submit OrderDrop to Shopify App Store Review
* **Tags**: #launch #app-store #shopify #priority/highest #status/active
* **Started**: 2026-11-03 14:21 UTC+5:30
* **Details**:
  - Upload official 1200x1200px App Icon.
  - Upload 3 high-resolution 1600x900px screenshots.
  - Submit prepared marketing listing copy, pricing plans, and reviewer instructions from [[shopify_app_store_listing_packet]].
* **Acceptance Criteria**:
  - [ ] Visual assets uploaded.
  - [ ] Listing copy pasted.
  - [ ] Submitted to Shopify App Review Team.
  - Hostinger DNS already configured:
    * A record `@` → `216.24.57.1` (Render IP, TTL 300)
    * CNAME `www` → `orderdrop.onrender.com` (TTL 300)
  - Render settings: Both `orderdrop.store` and `www.orderdrop.store` added.
* **Remaining Acceptance Criteria**:
  - [x] A record configured on Hostinger.
  - [x] CNAME configured on Hostinger.
  - [ ] Click "Retry Verification" in Render dashboard once [[03_In_Progress|CARD-09]] clears.
  - [ ] Status changes to "Verified" on Render.
  - [ ] Let's Encrypt SSL certificate issued and HTTP 200 returned over HTTPS.
* **Linked Notes**: [[server.js]], [[04_Done]]

---
*When finished, verify acceptance criteria and move cards to [[04_Done]].*
