# Prompt 40 — Dashboard Operational Truth Audit

> Verbatim — reproduced exactly as provided in the development
> conversation for this project (not reconstructed, not paraphrased).

---

# Prompt 40 — Dashboard Operational Truth Audit

## ROLE

You are working inside the existing Autoservise project.

Repository:
D:\Autoservise

Branch:
master

Project:
AI-администратор для автосервисов

This is an EXISTING production-oriented codebase.

Work audit-first.

DO NOT redesign the Dashboard.
DO NOT invent new KPIs.
DO NOT create duplicate APIs.
DO NOT introduce new business models.

First inspect the existing implementation and compare it against the actual operational data model.

Only make changes if the audit proves that the Dashboard currently contains a real correctness, consistency, or UX gap.

---

# CURRENT BASELINE

Current Git state:

local master = origin/master = 42cd87d

Latest validated test baseline:

TypeScript: PASS
Build: PASS
Tests: 1260/1260

Accepted recent prompts:

- Prompt 33 — Service completion visibility
- Prompt 34 — Appointment creation
- Prompt 35 — Appointment date navigation
- Prompt 36 — Operations daily work queue
- Prompt 37 — Request ↔ Appointment flow
- Prompt 38 — Post-Service recommendations visibility
- Prompt 39 — Client/Vehicle service-history context

Prompt 39 confirmed and fixed two real UX gaps:

1. Client service-history rows now identify the vehicle.
2. Client/Vehicle/Appointment history rows now show:
   - vehicle;
   - service;
   - mileage;
   - price.

Do NOT undo or duplicate this work.

---

# OBJECTIVE

Audit the existing `/dashboard` as a management/overview layer.

The dashboard should reflect the actual operational system.

The core operational entities currently include:

- Customer
- Vehicle
- Service
- CustomerRequest
- Appointment
- ServiceRecord
- Conversation
- AiEscalation
- follow-up / operational queue items

The key question is:

"Do the Dashboard KPIs, lists, labels, periods, and navigation accurately represent the same data that the manager sees in Requests, Appointments, Operations, and Service History?"

This is an AUDIT.

Do NOT automatically add more analytics.

---

# STEP 1 — AUDIT EXISTING DASHBOARD DATA SOURCES

Inspect `/dashboard` implementation.

Identify every KPI/card/list displayed.

For each one determine:

1. Which API endpoint supplies the data.
2. Which Prisma/query layer supplies it.
3. Which date field is used.
4. Which timezone is used.
5. Whether the calculation is tenant/business scoped.
6. Whether the frontend applies additional filtering.
7. Whether the displayed number corresponds to the underlying business entity.

Document this mapping.

Do not change anything yet.

---

# STEP 2 — AUDIT PERIOD SELECTOR

Prompt 20 introduced:

- Сегодня
- 7 дней
- 30 дней
- 90 дней

Verify the current implementation.

Determine:

1. Whether all KPI cards use the same selected period.
2. Whether recent/upcoming lists use the same or intentionally different ranges.
3. Whether the period boundaries use Business timezone.
4. Whether date boundaries are inclusive/exclusive consistently.
5. Whether changing the period actually changes the displayed data.
6. Whether the URL persists the period, if that was intentionally implemented.

Do not assume that all Dashboard blocks should share the same date range.

Identify intentional differences versus accidental inconsistencies.

---

# STEP 3 — AUDIT APPOINTMENT KPI

Trace the Dashboard appointment-related KPI back to the actual Appointment model.

Verify:

- which statuses are counted;
- whether cancelled appointments are excluded;
- whether no-shows are excluded or included;
- whether completed appointments are counted;
- whether the date uses `startAt`;
- whether Business timezone is respected.

Compare the result with `/appointments` and `/operations`.

IMPORTANT:

Do not invent a new definition of "appointment".

Use the existing business semantics where they are already established.

---

# STEP 4 — AUDIT REQUEST KPI

Trace request-related Dashboard numbers to `CustomerRequest`.

Verify:

- which statuses are counted;
- whether cancelled/closed requests are included;
- whether converted requests are handled correctly;
- whether the KPI represents requests created during the period or current requests whose status happens to be active;
- whether the date field is appropriate.

Compare with `/requests` and `/operations`.

If the Dashboard label is ambiguous, determine whether the implementation or the label is the actual problem.

---

# STEP 5 — AUDIT REVENUE / PRICE DATA

If the Dashboard currently displays revenue, total service value, or similar financial KPI:

Trace it to the actual source.

Determine:

- whether it uses Appointment price or ServiceRecord totalPrice;
- whether cancelled/no-show visits are excluded;
- whether only completed services are counted;
- whether currency is handled safely;
- whether multiple currencies can exist in one tenant;
- whether the KPI is actually a revenue metric or merely service value.

IMPORTANT:

Do not create a payment system.

Do not rename a metric casually.

If the current metric is not truly revenue, report the semantic issue before changing it.

---

# STEP 6 — AUDIT "RECENT" AND "UPCOMING" LISTS

Inspect Dashboard lists such as:

- recent requests;
- upcoming appointments;
- recent conversations;
- escalations;
- other existing operational summaries.

For each list verify:

1. Correct tenant.
2. Correct date ordering.
3. Correct status filtering.
4. Correct empty state.
5. Correct navigation.
6. No stale or duplicated records.

Compare appointment navigation with Prompt 35's existing:

`/appointments?open=<id>`

Do not create new navigation patterns.

---

# STEP 7 — AUDIT "REQUIRES ATTENTION" / ESCALATIONS

If Dashboard contains an attention/escalation count or list:

Compare it with `/operations`.

Verify that:

- active escalations are represented consistently;
- resolved/closed items are not incorrectly counted;
- CustomerRequest and AiEscalation are not accidentally double-counted;
- the manager can navigate to the relevant operational item.

Do not redesign Operations.

---

# STEP 8 — CROSS-SCREEN CONSISTENCY CHECK

Compare the same real-world data across:

`/dashboard`
`/requests`
`/appointments`
`/operations`
`/clients`
`/settings/service-history`

The goal is not identical numbers everywhere.

The goal is semantic consistency.

Examples:

A completed appointment should not appear as an active appointment in Dashboard if Operations correctly excludes it.

A cancelled request should not inflate an "active requests" KPI unless that is explicitly the intended definition.

A ServiceRecord total should not be presented as revenue unless the underlying metric truly represents revenue.

---

# STEP 9 — USE REAL DATA

Use existing dev/test data where possible.

Known data may include:

Customer:
Иван Иванов

Vehicle:
Subaru Legacy Legacy (1997)

Service:
Покраска капота

Request:
покраска крыши

Completed ServiceRecord:
recommendations may include "приехать через год"

Do NOT create duplicate records merely to test Dashboard calculations.

If suitable data is unavailable, inspect the implementation and report the limitation honestly.

---

# STEP 10 — IDENTIFY REAL GAPS

Use exactly one outcome.

### OUTCOME A — DASHBOARD IS CORRECT

Everything is semantically consistent.

No application code changes.

Document the verified KPI definitions and data sources.

---

### OUTCOME B — SMALL UX / SEMANTIC GAP

The underlying data is correct but:

- a label is misleading;
- a navigation target is wrong;
- an empty state is confusing;
- a period label is inconsistent;
- a KPI omits an important existing distinction;
- an existing value is displayed without necessary context.

Make the smallest safe correction.

---

### OUTCOME C — REAL DATA/LOGIC GAP

The Dashboard calculation itself is incorrect.

Examples:

- wrong status set;
- wrong date field;
- wrong timezone;
- wrong tenant scope;
- wrong aggregation;
- completed/cancelled items incorrectly counted;
- data source does not match the KPI definition.

Fix the smallest possible underlying logic.

Do not redesign the Dashboard.

Do not introduce a new analytics architecture.

---

# STEP 11 — SECURITY

Verify every Dashboard query is:

- authenticated;
- tenant-scoped;
- business-scoped where required;
- free from unscoped aggregate queries.

If changing a query, preserve the existing authorization helpers.

Do not introduce a direct global Prisma aggregation.

---

# STEP 12 — REGRESSION CHECK

Explicitly verify that these remain intact:

Prompt 33:
`serviceCompletionState()`

Prompt 34:
Appointment creation

Prompt 35:
Appointment date navigation

Prompt 36:
Operations daily queue

Prompt 37:
Request ↔ Appointment navigation

Prompt 38:
ServiceRecord recommendations

Prompt 39:
Client/Vehicle/Appointment service-history context

Do not modify unrelated functionality.

---

# STEP 13 — TESTING

Before changes:

Run the current test suite and establish the actual baseline.

After changes:

- TypeScript
- Build
- full tests
- focused tests for changed Dashboard logic if applicable

Expected baseline is approximately:

1260/1260

Use the ACTUAL result.

If a pure UI change does not require new unit tests, explain why.

---

# STEP 14 — MANUAL VALIDATION

If application code changes, validate the Dashboard in the live application.

Check:

1. `/dashboard` loads without errors.
2. Change each available period.
3. KPI values update.
4. Recent/upcoming lists update appropriately.
5. Appointment navigation opens the correct record.
6. Request navigation opens the correct request.
7. Attention/escalation navigation opens the correct operational item.
8. Empty states are correct where applicable.
9. Browser console has no unexpected errors.
10. Compare at least one Dashboard value with the corresponding underlying screen.

Do NOT fabricate manual results.

If the current tenant does not contain sufficient data for a particular check, report that limitation.

---

# DO NOT TOUCH

Do NOT modify:

- authentication;
- tenant architecture;
- Telegram;
- AI;
- payments;
- CRM;
- SMS;
- WhatsApp;
- automated reminders;
- ServiceRecord schema;
- appointment status model;
- appointment creation;
- Operations architecture;
- Client/Vehicle history architecture unless a Dashboard regression requires it;
- `.mcp.json`;
- `marketing/`;
- `origin/main`.

Do NOT introduce:

- analytics warehouse;
- event-sourcing;
- new reporting service;
- new KPI framework;
- WorkOrder;
- Invoice;
- Payment;
- Inventory;
- Technician;
- Loyalty;
- CRM abstraction;
- background jobs.

---

# GIT

Create a commit ONLY if application or documentation changes were actually made.

DO NOT push to GitHub in this prompt.

At the end report:

- branch;
- commit hash(es), if any;
- working tree status;
- `.mcp.json` / `marketing/` status;
- explicit push status.

---

# FINAL REPORT FORMAT

## 1. Audit Result

Outcome A / B / C.

## 2. Dashboard Inventory

For every existing KPI/list:
- label;
- source;
- date field;
- status semantics;
- timezone;
- tenant scope.

## 3. Findings

Only real findings.

## 4. Implementation

If changed:
- exact files;
- exact behavior;
- reused APIs/helpers;
- schema/API changes.

If unchanged:

"No application code changes were necessary."

## 5. Cross-Screen Consistency

Summarize comparison with:
- Requests
- Appointments
- Operations
- Clients
- Service History

## 6. Security

Tenant/business isolation.

## 7. Regression Check

Prompts 33–39.

## 8. Validation

TypeScript:
Build:
Tests:
Manual validation:

## 9. Git

Branch:
Commit(s):
Push:
Working tree:

STOP after the Final Report.
