---
title: "01 · Backlog"
type: kanban-column
column_id: backlog
aliases: ["Backlog", "Ideas", "Future Sprints"]
tags:
  - kanban/column
  - project/orderdrop
  - stage/backlog
created: 2026-11-02
---

# 📥 01 · Agile Backlog (Future Sprints & Roadmap)

> **Navigation**: [[Kanban_Board|📋 Master Board]] · **[[01_Backlog|📥 01 Backlog]]** · [[02_To_Do|⏳ 02 To Do]] · [[03_In_Progress|🔄 03 In Progress]] · [[04_Done|✅ 04 Done]]

---

## 📊 Column Metrics
* **WIP Limit**: ∞ (Uncapped)
* **Total Cards**: 4
* **Theme**: Scaling, feature expansions, and secondary growth loops.

---

### 📦 CARD-01: Multi-Carrier & 3PL Custom Excel Layouts
* **Tags**: #feature #enhancement #epic/orders #priority/medium
* **Estimated Effort**: 3 Story Points
* **Description**: Allow merchants to customize column order (e.g. ShipBob, ShipStation, or localized warehouse column headers) directly from the settings panel.
* **Acceptance Criteria**:
  - [ ] Drag-and-drop column reordering UI in dashboard.
  - [ ] Support custom date format (YYYY-MM-DD vs DD/MM/YYYY).
  - [ ] Persist column mappings in `shops` table in Neon PostgreSQL.
* **Linked Notes**: [[server.js]], [[excel.js]]

---

### 📦 CARD-02: Multi-Language Warehouse Translation
* **Tags**: #internationalization #feature #epic/warehouse #priority/low
* **Estimated Effort**: 2 Story Points
* **Description**: Add toggle to translate spreadsheet column names into Spanish, French, German, and Chinese for cross-border fulfillment centers.
* **Acceptance Criteria**:
  - [ ] Localization dictionary in `locales/`.
  - [ ] Warehouse recipient language selector dropdown in dashboard.
* **Linked Notes**: [[excel.js]]

---

### 📦 CARD-03: Multiple Daily Dispatch Schedules (Morning + Night)
* **Tags**: #automation #feature #epic/cron #priority/medium
* **Estimated Effort**: 3 Story Points
* **Description**: Enable high-volume stores (100+ orders/day) to trigger 2 scheduled runs per day (e.g., 09:00 AM UTC and 06:00 PM UTC).
* **Acceptance Criteria**:
  - [ ] Support array of cron times in `scheduleTime` column.
  - [ ] Upsell hook for Pro tier.
* **Linked Notes**: [[scheduler.js]], [[server.js]]

---

### 📦 CARD-04: Reddit & Community Keyword Auto-Alerts
* **Tags**: #gtm #marketing #growth #priority/low
* **Estimated Effort**: 1 Story Point
* **Description**: Set up F5Bot or Google Alerts for phrases like *"Shopify daily order export"* and *"email excel to supplier"* to notify us when prospective merchants ask for solutions.
* **Acceptance Criteria**:
  - [ ] Alerts configured for `r/shopify`, `r/ecommerce`, `r/dropship`.
  - [ ] Webhook notification into personal Discord or Telegram.
* **Linked Notes**: [[02_To_Do]]

---
*Next Stage: Move refined cards to [[02_To_Do]] during Sprint Planning.*
