# Prompt 38 — Post-Service Follow-up & Next Action Audit

> Verbatim — reproduced exactly as provided in the development
> conversation for this project (not reconstructed, not paraphrased).

---

# Prompt 38 — Post-Service Follow-up & Next Action Audit

## ROLE

You are working inside the existing Autoservise project.

Repository:
D:\Autoservise

Branch:
master

Project:
AI-администратор для автосервисов

This is an EXISTING production-oriented codebase.

Your task is audit-first.

DO NOT invent functionality.
DO NOT redesign existing screens.
DO NOT create duplicate models, APIs, helpers, or business logic.

First inspect what already exists.

Only implement a change if the audit proves there is a real operational gap.

---

# CURRENT BASELINE

Latest validated state:

TypeScript: PASS
Build: PASS
Tests: 1260/1260

Latest feature commits:

Prompt 35:
5be0a57
92a41d2

Prompt 36:
f7ccb76
a5279db

Prompt 37:
4e54766 (docs only)

Prompt 37 confirmed:

Request → Appointment already works.

Appointment → Request already works.

Existing relation:
CustomerRequest.appointmentId

No application code changes were required.

IMPORTANT:

Prompt 36 and Prompt 37 were audit-first.
Do not assume that any previously discussed gap still exists.

---

# OBJECTIVE

Audit the operational flow AFTER an appointment is completed.

The intended operational sequence is:

Appointment
→ IN_PROGRESS
→ COMPLETED
→ ServiceRecord
→ Service History
→ recommendations / next action
→ possible follow-up

The key question is:

"After a service visit is completed, does the manager have enough information and a clear next operational action, using the functionality that already exists?"

This is an AUDIT.

It is NOT a request to build:
- CRM automation;
- SMS;
- WhatsApp;
- Telegram automation;
- AI follow-up;
- payment;
- loyalty system;
- marketing automation.

---

# STEP 1 — AUDIT APPOINTMENT COMPLETION

Inspect the existing Appointment Detail flow.

Verify:

1. How an appointment becomes COMPLETED.
2. What happens immediately after completion.
3. Whether the UI clearly indicates that the appointment is completed.
4. Whether the ServiceRecord state is visible.
5. Whether a completed appointment without a ServiceRecord is clearly identifiable.
6. Whether a completed appointment with a ServiceRecord is clearly identifiable.

Reuse Prompt 33's existing:

serviceCompletionState()

Do NOT replace it.

Do NOT create a second completion classifier.

---

# STEP 2 — AUDIT SERVICE RECORD

Inspect the existing ServiceRecord implementation.

Verify the actual current fields and behavior.

Pay attention to:

- performedAt
- mileage
- workDescription
- partsDescription
- recommendations
- totalPrice
- currency
- appointmentId

Determine:

1. Whether recommendations are displayed after completion.
2. Whether they are visible in Appointment Detail.
3. Whether they are visible in Client Detail.
4. Whether they are visible in Vehicle Detail.
5. Whether the existing service history gives enough context for the manager.

Do NOT add new ServiceRecord fields unless the current architecture genuinely cannot represent existing information.

---

# STEP 3 — AUDIT "NEXT ACTION"

Determine whether the current application gives the manager a meaningful next action after service completion.

Examples of existing capabilities that may already satisfy this:

- viewing service recommendations;
- returning to the client;
- viewing vehicle history;
- creating another appointment;
- viewing the originating request;
- creating/following up a customer request;
- existing Operations follow-up queue.

DO NOT assume a missing "Next Action" button is a defect.

First inspect what the application already provides.

The goal is operational continuity, not adding buttons.

---

# STEP 4 — AUDIT OPERATIONS

Inspect `/operations`.

Verify whether completed appointments:

1. correctly disappear from the active appointment queue;
2. remain accessible through Appointment Detail;
3. have any existing follow-up representation;
4. are accidentally duplicated in another queue;
5. leave the manager without context when a follow-up is actually needed.

Do not redesign Operations.

Do not create a new follow-up system.

If Operations already has follow-ups, inspect their actual implementation and relationship to CustomerRequest / Appointment / Customer.

---

# STEP 5 — AUDIT CLIENT AND VEHICLE HISTORY

Inspect:

`/clients`

Client Detail.

Vehicle Detail.

Service History.

Verify that after completing an appointment and creating a ServiceRecord:

- the client history reflects the service;
- the vehicle history reflects the service;
- the appointment relationship is preserved where applicable;
- service details are readable;
- recommendations are not silently lost.

Do not duplicate service history logic.

Reuse the existing service-history APIs and components.

---

# STEP 6 — AUDIT THE COMPLETE FLOW WITH REAL DATA

Use the existing test data if available.

Known previously tested data may include:

Customer:
Иван Иванов

Vehicle:
Subaru Legacy Legacy (1997)

Service:
Покраска капота

Request context:
покраска крыши

Do NOT create duplicate records merely for testing.

If existing data is unsuitable, use the current dev data.

---

# STEP 7 — IDENTIFY REAL GAPS

Classify the result into exactly one of these categories.

### OUTCOME A — FLOW IS COMPLETE

If the current application already provides sufficient post-service continuity:

DO NOT change application code.

Document exactly what was verified.

This is an acceptable and preferred result.

---

### OUTCOME B — SMALL UX GAP

Only if all necessary data/functionality already exists but the manager cannot reasonably discover it.

Examples:

- an existing recommendation is present but hidden in an unexpected location;
- an existing link is missing from a relevant detail view;
- an existing action is inaccessible from the natural workflow.

Make the smallest UI change possible.

Do not redesign the screen.

---

### OUTCOME C — REAL FUNCTIONAL GAP

Only if the existing architecture genuinely cannot complete an important operational step.

Before implementation:

1. identify the missing capability;
2. identify the existing models/APIs that can be reused;
3. implement the smallest coherent change.

Do not introduce speculative future architecture.

---

# IMPORTANT: DO NOT INVENT AUTOMATION

This prompt does NOT authorize implementation of:

- automatic SMS;
- Telegram messages;
- WhatsApp;
- AI follow-up;
- reminders;
- CRM synchronization;
- payment collection;
- loyalty;
- marketing campaigns;
- scheduled jobs;
- email campaigns.

Those are future product capabilities.

The current objective is to validate the manual operational workflow only.

---

# STEP 8 — SECURITY

Verify tenant/business isolation across:

- Appointment
- ServiceRecord
- Customer
- Vehicle
- CustomerRequest
- service history
- Operations

Any new query must reuse existing tenant-scoped helpers.

Do not introduce direct unscoped lookups.

Do not weaken authorization.

---

# STEP 9 — REGRESSION CHECK

Explicitly verify that these remain intact:

Prompt 33:
serviceCompletionState()

Prompt 34:
Appointment creation

Prompt 35:
Appointment date navigation and URL state

Prompt 36:
Operations daily queue

Prompt 37:
Request ↔ Appointment navigation

Do not modify these unless the audit discovers an actual regression.

---

# STEP 10 — TESTING

Before any changes:

Run the existing test suite and establish the actual baseline.

After any changes:

- TypeScript
- Build
- full test suite
- focused tests for changed behavior

Do not rewrite unrelated tests.

Expected baseline is approximately:

1260/1260

But use the ACTUAL result.

---

# STEP 11 — MANUAL VALIDATION

If application code is changed, manually verify the affected workflow.

Preferred flow:

1. Open `/appointments`.
2. Open a completed appointment.
3. Verify completion state.
4. Verify ServiceRecord state.
5. Open service history.
6. Verify work description / recommendations / price where applicable.
7. Navigate to Client Detail.
8. Verify the service is present in history.
9. Navigate to Vehicle Detail.
10. Verify the service is present in history.
11. Check `/operations`.
12. Verify the completed appointment does not incorrectly remain in the active queue.
13. Verify existing follow-ups are not broken.

Do not create duplicate test appointments or ServiceRecords.

If some manual step cannot be performed because the available tenant has no suitable data, report that honestly.

Do not fabricate validation.

---

# DO NOT TOUCH

Do NOT modify:

- authentication;
- tenant architecture;
- Telegram integration;
- AI functionality;
- payment architecture;
- CRM integrations;
- SMS;
- WhatsApp;
- ServiceRecord schema unless absolutely necessary;
- appointment status model;
- appointment creation;
- Prompt 35 date navigation;
- Prompt 36 Operations queue;
- Prompt 37 Request ↔ Appointment flow;
- design system;
- unrelated pages;
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
- automated reminders;
- new CRM abstraction;
- new scheduling system.

---

# GIT

Create a commit ONLY if application or documentation changes were actually made.

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

Return:

## 1. Audit Result

Choose:

- Outcome A — flow complete
- Outcome B — small UX gap
- Outcome C — real functional gap

## 2. Existing Flow

Describe what already happens after appointment completion.

## 3. Findings

Only real findings.

## 4. Implementation

If changed:
- exact files;
- exact behavior;
- reused APIs/helpers;
- Prisma/schema changes, if any.

If unchanged:

"No application code changes were necessary."

## 5. Security

Tenant/business isolation verification.

## 6. Regression Check

Explicitly confirm Prompts 33–37.

## 7. Validation

- TypeScript
- Build
- Tests
- Manual validation

## 8. Git

- branch
- commits
- push status
- working tree

STOP after the Final Report.
