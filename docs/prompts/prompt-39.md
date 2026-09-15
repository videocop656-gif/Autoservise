# Prompt 39 — Client Service History & Retention Flow Audit

> Verbatim — reproduced exactly as provided in the development
> conversation for this project (not reconstructed, not paraphrased).

---

# Prompt 39 — Client Service History & Retention Flow Audit

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

DO NOT invent functionality.
DO NOT redesign the application.
DO NOT create duplicate APIs, models, helpers, or business logic.

First inspect the existing implementation.

Only implement a change if the audit proves there is a real operational or UX gap.

---

# CURRENT BASELINE

Current Git state:

local master = origin/master = b0fad12

Latest validated test baseline:

TypeScript: PASS
Build: PASS
Tests: 1260/1260

Recent accepted prompts:

- Prompt 33 — Service completion visibility
- Prompt 34 — Appointment creation
- Prompt 35 — Appointment date navigation
- Prompt 36 — Operations daily work queue
- Prompt 37 — Request ↔ Appointment operational flow audit
- Prompt 38 — Post-Service Follow-up & Next Action audit

Prompt 38 found and fixed a real UX gap:

`ServiceRecord.recommendations`

was already stored and returned by the API, but was not visible in the normal service-history views.

The frontend now displays:

"Рекомендовано: ..."

in the existing ServiceRecord history rows.

Do NOT undo or duplicate this implementation.

---

# OBJECTIVE

Audit the complete CLIENT SERVICE HISTORY experience.

The intended operational flow is:

Client
→ Vehicle
→ Appointment
→ Completed Service
→ ServiceRecord
→ Service History
→ Recommendations
→ Future visit / continued relationship

The key question:

"Can a manager open a client and quickly understand what has already been serviced, on which vehicle, when it happened, what was done, what was recommended, and what the logical next action is?"

This is an AUDIT.

It is NOT a request to build automated retention marketing.

---

# STEP 1 — AUDIT CLIENT DETAIL

Inspect the current `/clients` implementation and Client Detail.

Determine exactly what a manager can see about service history.

Verify whether the client view provides:

1. Service date.
2. Vehicle.
3. Service / appointment context.
4. Work performed.
5. Parts used, if recorded.
6. Recommendations.
7. Total price and currency, if recorded.
8. Link back to the relevant appointment, where applicable.
9. Link to the vehicle, where applicable.
10. Clear distinction between historical service and upcoming/current appointments.

Do not assume any of these are missing.

Read the actual implementation.

---

# STEP 2 — AUDIT VEHICLE HISTORY

Inspect Vehicle Detail.

Determine whether service history is sufficiently contextualized.

A manager should be able to understand:

- which service was performed;
- when;
- what mileage was recorded;
- what work was done;
- what was recommended;
- which appointment produced the record, when available.

Check whether Prompt 38's recommendation display is already present here.

Do not add another representation if the existing one is sufficient.

---

# STEP 3 — AUDIT SERVICE HISTORY DATA

Inspect the existing service-history API and DTOs.

Determine:

1. What fields the API actually returns.
2. Whether the frontend DTOs accurately represent those fields.
3. Whether any useful existing fields are silently omitted by the UI.
4. Whether appointment/customer/vehicle/service context is already available.
5. Whether filtering by client or vehicle is already supported.

IMPORTANT:

If an API already returns a field, prefer exposing it correctly in the existing UI over creating a new endpoint.

Do not change backend contracts unnecessarily.

---

# STEP 4 — AUDIT NAVIGATION

Trace the natural manager workflow.

Starting from:

`/clients`

can the manager reach:

Client Detail
→ Vehicle
→ Service History
→ Appointment Detail
→ originating Request where applicable?

And can the manager move back naturally?

Check whether existing `?open=` conventions are reused.

Do not create a new routing architecture.

---

# STEP 5 — AUDIT EMPTY / ERROR STATES

Inspect Client Detail and Vehicle Detail service-history states.

Distinguish:

1. Loading.
2. Empty history.
3. API failure.
4. Existing records.

Verify that an API failure is not presented as "История обслуживания отсутствует".

If an existing shared pattern is already used elsewhere, reuse it.

---

# STEP 6 — AUDIT MULTI-VEHICLE CLIENTS

This is important.

A customer may own multiple vehicles.

Verify that Client Detail does not create ambiguity when:

- one client has multiple vehicles;
- each vehicle has different service history;
- the same service appears on different vehicles.

The manager must be able to tell which vehicle the service belongs to.

Do NOT redesign the client model.

Do NOT create a new vehicle relationship.

---

# STEP 7 — AUDIT POST-SERVICE CONTINUITY

Using the existing capabilities only, determine whether a manager can naturally move from historical service information to a future operational action.

Potential existing actions include:

- open the appointment;
- open the vehicle;
- open the client;
- create a new appointment;
- open an existing request;
- see recommendations.

Do NOT create:

- automatic reminders;
- SMS;
- WhatsApp;
- Telegram campaigns;
- AI follow-ups;
- loyalty programs;
- marketing automation.

We are auditing the MANUAL workflow only.

---

# STEP 8 — USE REAL EXISTING DATA

If suitable test data exists, inspect it.

Previously verified data may include:

Customer:
Иван Иванов

Vehicle:
Subaru Legacy Legacy (1997)

Service:
Покраска капота

Request context:
покраска крыши

There may also be a real completed service record with a recommendation similar to:

"приехать через год"

Do NOT create duplicate records.

Do NOT mutate real data merely to test presentation.

---

# STEP 9 — CLASSIFY THE RESULT

Use exactly one outcome.

### OUTCOME A — COMPLETE

The existing Client/Vehicle/Service History workflow is coherent.

No application code changes.

Document what was verified.

---

### OUTCOME B — SMALL UX GAP

The necessary information already exists, but the manager cannot easily discover or interpret it.

Examples:

- existing field omitted from an existing row;
- missing contextual label;
- unclear vehicle attribution;
- missing natural navigation link;
- misleading empty/error state.

Make the smallest possible frontend change.

---

### OUTCOME C — REAL FUNCTIONAL GAP

Only if the existing architecture cannot provide an important piece of the operational flow.

Identify the smallest required change.

Reuse existing models, APIs, guards and components.

Do NOT introduce speculative architecture.

---

# STEP 10 — SECURITY

Verify tenant/business isolation for:

- Client
- Vehicle
- Appointment
- ServiceRecord
- CustomerRequest
- service history

Any queries introduced must use existing tenant-scoped patterns.

Do not introduce unscoped lookups.

---

# STEP 11 — REGRESSION CHECK

Explicitly verify that these remain intact:

Prompt 33:
`serviceCompletionState()`

Prompt 34:
Appointment creation

Prompt 35:
Date navigation and URL state

Prompt 36:
Operations daily queue

Prompt 37:
Request ↔ Appointment navigation

Prompt 38:
ServiceRecord recommendations visibility

Do not modify them unless a genuine regression is discovered.

---

# STEP 12 — TESTING

Before changes:

Run the current suite and establish the actual baseline.

After changes:

- TypeScript
- Build
- full tests
- focused tests if new behavior requires them

Expected baseline is approximately:

1260/1260

Use the actual number.

---

# STEP 13 — MANUAL VALIDATION

If application code changes, validate the affected workflow in the live application.

Preferred flow:

1. Open `/clients`.
2. Open a client.
3. Inspect service history.
4. Identify the vehicle.
5. Open the vehicle.
6. Inspect vehicle service history.
7. Open the related appointment where available.
8. Verify recommendations are visible.
9. Verify navigation back to client/vehicle remains coherent.
10. Check empty/error states if testable.
11. Check browser console for errors.

Do not fabricate validation.

If a manual step cannot be performed because suitable credentials/data are unavailable, report that explicitly.

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
- marketing automation;
- ServiceRecord schema unless absolutely necessary;
- appointment status system;
- appointment creation;
- Operations architecture;
- Prompt 35 date navigation;
- Prompt 36 queue;
- Prompt 37 Request ↔ Appointment flow;
- `.mcp.json`;
- `marketing/`;
- `origin/main`.

Do NOT introduce:

- WorkOrder;
- Invoice;
- Payment;
- Inventory;
- Technician;
- Loyalty;
- CRM abstraction;
- scheduling system;
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

## 2. Existing Flow

What currently works.

## 3. Findings

Only real findings.

## 4. Implementation

If changed:
- exact files;
- behavior;
- reused APIs/helpers;
- schema/API changes.

If unchanged:

"No application code changes were necessary."

## 5. Security

Tenant/business isolation.

## 6. Regression Check

Prompts 33–38.

## 7. Validation

TypeScript:
Build:
Tests:
Manual validation:

## 8. Git

Branch:
Commit(s):
Push:
Working tree:

STOP after the Final Report.
