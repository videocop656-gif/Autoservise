# Prompt 37 — Request → Appointment Operational Flow Audit

> Verbatim — reproduced exactly as provided in the development
> conversation for this project (not reconstructed, not paraphrased).

---

# Prompt 37 — Request → Appointment Operational Flow Audit

## ROLE

You are working inside the existing Autoservise project.

Repository:
D:\Autoservise

Branch:
master

Project:
AI-администратор для автосервисов

This is an EXISTING production-oriented codebase.

Your task is NOT to redesign the application and NOT to create duplicate functionality.

Work audit-first:
1. inspect the existing implementation;
2. identify what already works;
3. identify only the real gaps in the Request → Appointment operational flow;
4. make the smallest coherent improvement only where a real gap exists.

Do not rebuild existing features.

---

# CURRENT BASELINE

The project has already passed:

TypeScript: PASS
Build: PASS
Tests: 1260/1260

Relevant completed prompts:

- Prompt 24 — Requests list/detail and lifecycle
- Prompt 25 — Operations queue
- Prompt 28 — Appointment Detail audit
- Prompt 29 — Service execution flow
- Prompt 30 — End-to-end operational flow audit
- Prompt 31 — UX hardening
- Prompt 32 — Service completion/read-only audit
- Prompt 33 — Service completion visibility
- Prompt 34 — Appointment creation
- Prompt 35 — Appointment list/date navigation
- Prompt 36 — Operations daily work queue

Do NOT assume that a previously reported gap still exists.
Verify the current code first.

---

# OBJECTIVE

Audit the complete operational path:

Customer Request
→ qualification / request state
→ Appointment
→ Appointment Detail
→ appointment status progression
→ ServiceRecord / service completion

The specific question is:

"Can a manager naturally move from a Customer Request to its appointment, create an appointment when appropriate, and move back from the appointment to the originating request?"

We are looking for broken or missing operational continuity — NOT cosmetic improvements.

---

# STEP 1 — AUDIT CURRENT REQUEST DETAIL

Inspect the existing Request Detail implementation.

Determine:

1. How the request displays its current appointment, if any.
2. Whether the appointment ID is already available.
3. Whether there is already a link/button from Request Detail to Appointment Detail.
4. Whether the request can create an appointment.
5. Whether the existing "Создать запись" flow is already sufficient.
6. Whether appointment creation correctly attaches the created appointment to the request.
7. Whether the request status/lifecycle remains correct after appointment creation.

Do NOT change anything if this is already coherent.

---

# STEP 2 — AUDIT APPOINTMENT DETAIL

Inspect Appointment Detail.

Determine:

1. Whether an appointment knows its originating CustomerRequest.
2. Whether `CustomerRequest.appointmentId` is already used.
3. Whether Appointment Detail displays the originating request.
4. Whether there is already a navigation path:

Appointment → Request Detail

5. Whether this navigation is tenant-safe.
6. Whether the request shown actually belongs to the same tenant/business.

Again:
DO NOT add a second relation or duplicate API if the existing relation is sufficient.

---

# STEP 3 — AUDIT THE REAL DATA MODEL

Inspect the current Prisma schema and relevant API routes.

Use the existing models and relations.

Pay particular attention to:

- CustomerRequest
- Appointment
- Customer
- Vehicle
- Service
- Conversation

Verify the current relation:

CustomerRequest.appointmentId

and determine whether it is sufficient for the intended flow.

Do NOT introduce another foreign key such as `Appointment.requestId` unless the current architecture genuinely cannot support the required navigation.

Prefer the existing relation.

---

# STEP 4 — AUDIT API BEHAVIOR

Inspect the existing endpoints used by:

- Request Detail
- Appointment Detail
- appointment creation
- request updates

Verify:

1. Tenant isolation.
2. Business isolation where applicable.
3. Relation ownership checks.
4. Whether appointment creation can attach a request.
5. Whether Appointment Detail can safely expose the related request.
6. Whether Request Detail can safely expose the related appointment.

Do not create new endpoints if existing endpoints can provide the required data.

---

# STEP 5 — DECIDE WHETHER A CHANGE IS ACTUALLY NEEDED

There are only three acceptable outcomes.

### OUTCOME A — EVERYTHING ALREADY WORKS

If the audit shows that Request → Appointment → Request navigation is already complete and coherent:

DO NOT modify application code.

Only add/update an audit/final report if the project's established documentation workflow requires it.

State clearly:

- what was inspected;
- what already existed;
- why no code change was necessary.

Do not manufacture a feature just to produce a commit.

---

### OUTCOME B — SMALL UX GAP EXISTS

If the underlying data/API already supports the relation but the UI lacks a useful navigation affordance:

Make the smallest possible UI change.

Examples of acceptable changes:

- Request Detail shows "Запись" with a link to Appointment Detail.
- Appointment Detail shows "Обращение" with a link to Request Detail.

Reuse the existing navigation conventions.

Do not redesign either page.

---

### OUTCOME C — REAL FUNCTIONAL GAP EXISTS

Only if the current architecture genuinely cannot complete the flow:

Implement the smallest required backend/frontend change.

Prefer:

- existing models;
- existing endpoints;
- existing relation `CustomerRequest.appointmentId`;
- existing tenant/business guards;
- existing Appointment Detail and Request Detail components.

Do not introduce a new abstraction layer.

---

# IMPORTANT BUSINESS RULE

Do NOT automatically change Request status merely because an appointment exists.

First inspect the existing request lifecycle and current business rules.

Do not invent a new status transition.

If appointment creation already updates the request correctly, preserve it.

If it does not, report the finding before making a lifecycle change unless the fix is clearly required by an already-established rule in the codebase.

---

# STEP 6 — SECURITY AUDIT

Any relation displayed or navigated through must remain tenant-safe.

Verify that:

- Request A from Tenant A cannot expose Appointment B from Tenant B.
- Appointment B cannot expose Request A from another tenant.
- Existing `assert...Owned...` helpers are reused.
- No direct unscoped Prisma lookup is introduced.
- No authorization shortcut is added.

Do not weaken existing guards.

---

# STEP 7 — TESTING

Before changes:

Run the existing test suite and establish the actual baseline.

After changes, if changes are necessary:

- TypeScript
- Build
- full test suite
- focused tests for any new helper/behavior

Do not rewrite existing tests unnecessarily.

If no code change is necessary, still run the relevant validation and report the result.

Expected baseline is approximately:

1260/1260

But use the ACTUAL current result, not this number blindly.

---

# STEP 8 — MANUAL VALIDATION

If a real UI change is made, use the existing live application and validate:

1. Open `/requests`.
2. Open a request that has an appointment.
3. Navigate to the appointment.
4. Open Appointment Detail.
5. Navigate back to the originating request.
6. Verify the displayed customer/vehicle/service/request context is consistent.
7. Verify there are no console errors.
8. Verify no unrelated screen changed.

If the tenant has suitable test data, use it.

Do NOT create unnecessary duplicate appointments or records just for testing.

---

# DO NOT TOUCH

Do NOT modify:

- authentication architecture;
- tenant architecture;
- Telegram integration;
- AI functionality;
- ServiceRecord model;
- `serviceCompletionState()`;
- appointment status system;
- appointment creation logic unless the audit proves it is required;
- Prompt 35 date navigation;
- Prompt 36 Operations queue;
- unrelated pages;
- design system;
- `.mcp.json`;
- `marketing/`;
- `origin/main`.

Do NOT introduce:

- WorkOrder;
- Invoice;
- Payment;
- Inventory;
- Technician;
- new CRM abstraction;
- new appointment/request relation unless absolutely necessary.

---

# GIT

Create a commit ONLY if application/documentation changes were actually made.

Use a descriptive commit message.

DO NOT push to GitHub in this prompt.

At the end report:

- current branch;
- commit hash(es), if any;
- whether working tree is clean;
- whether `.mcp.json` and `marketing/` remain untouched;
- explicitly state that nothing was pushed.

---

# FINAL REPORT FORMAT

Return a concise but complete Final Report containing:

## 1. Audit Result

What already existed in Request → Appointment flow.

## 2. Findings

List only real gaps.

## 3. Implementation

If changed:
- exact files;
- exact behavior;
- reused APIs/helpers;
- whether Prisma/schema changed.

If unchanged:
- explicitly say "No application code changes were necessary."

## 4. Security

Tenant/business isolation verification.

## 5. Regression Check

Confirm Prompts 33–36 remain intact.

## 6. Validation

- TypeScript
- Build
- Tests
- Manual validation

## 7. Git

- branch
- commit(s)
- push status
- working tree status

STOP after the Final Report.

Do not proceed to another feature.
