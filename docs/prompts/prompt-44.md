# Prompt 44 — Lead vs CustomerRequest Domain Consolidation Audit

> Verbatim — reproduced exactly as provided in the development
> conversation for this project (not reconstructed, not paraphrased).

---

# Prompt 44 — Lead vs CustomerRequest Domain Consolidation Audit

## Context

This is the existing **AI-admin-for-auto-services** application.

Prompt 43 identified one MUST HAVE product gap:

> The repository contains both `Lead` and `CustomerRequest`, but `Lead` is effectively orphaned from the current operational flow while `CustomerRequest` is the active request/lead lifecycle used by the product.

This ambiguity must be resolved before autonomous AI intake is implemented.

## Primary Goal

Determine the correct role of `Lead` and `CustomerRequest` in the current product and implement the smallest safe change that leaves **one unambiguous operational intake concept**.

The result must make it clear which entity represents an incoming customer request/lead in the current MVP.

---

# 1. Full repository audit

Inspect all references to:

* `Lead`
* `CustomerRequest`
* `leadId`
* `customerRequestId`
* lead-related API routes;
* lead-related services;
* lead-related frontend components;
* lead-related forms;
* lead-related tests;
* lead-related seed/test fixtures;
* migrations;
* documentation.

Search the entire repository, not only currently imported files.

Determine:

1. Is `Lead` reachable from the current UI?
2. Is `Lead` reachable from any API endpoint?
3. Is `Lead` created anywhere?
4. Is `Lead` updated anywhere?
5. Is `Lead` deleted anywhere?
6. Is `Lead` referenced by any active model?
7. Is `Lead` referenced by any active workflow?
8. Is `Lead` used only by historical/legacy code?
9. Does `CustomerRequest` already cover the same business concept?
10. Are there any meaningful fields or behaviors in `Lead` that do not exist in `CustomerRequest`?

Do not infer from naming alone.

---

# 2. Compare the two domain models

Create a precise comparison:

| Concern               | Lead | CustomerRequest |
| --------------------- | ---- | --------------- |
| Database model        |      |                 |
| Customer relation     |      |                 |
| Vehicle relation      |      |                 |
| Conversation relation |      |                 |
| Source                |      |                 |
| Status/lifecycle      |      |                 |
| Notes/details         |      |                 |
| Creation path         |      |                 |
| UI                    |      |                 |
| API                   |      |                 |
| Operations            |      |                 |
| Tests                 |      |                 |
| Active usage          |      |                 |

Then determine whether they are:

* genuinely different business concepts;
* historical duplication;
* partially overlapping concepts;
* one intended to replace the other.

Do not make the decision until the repository evidence has been inspected.

---

# 3. Historical intent

Inspect:

* Prisma migration history;
* git history where useful;
* existing documentation;
* previous final reports;
* comments explaining the domain.

Determine why `Lead` exists.

If git history is useful, inspect relevant commits rather than guessing.

Document whether `Lead` appears to be:

* original architecture;
* abandoned architecture;
* future architecture;
* accidental duplication;
* partially migrated architecture.

---

# 4. Current operational truth

Trace the actual active lifecycle.

Start from the current entry points:

### Conversations

Determine what entity represents the incoming customer intent.

### Operations

Determine what entity represents actionable customer work.

### Requests

Determine the authoritative request lifecycle.

### Appointments

Determine what entity is linked to an appointment.

### Service history

Determine whether either entity participates in completed operational history.

The objective is to identify the **current canonical intake entity**.

---

# 5. AI implications

Inspect the existing AI implementation and tools.

Specifically audit:

* AIProvider;
* OpenAI implementation;
* mock AI provider;
* Telegram ChannelAdapter;
* AI booking tools;
* tool schemas;
* conversation handling;
* customer identification;
* request creation;
* appointment creation.

Determine which entity future AI intake would naturally create or update.

The future desired flow is:

**Incoming message**
→ identify/create Customer
→ identify/create Vehicle
→ understand request
→ create/update request
→ qualify
→ offer appointment
→ create Appointment

Do NOT implement autonomous AI in this prompt.

The goal is to ensure there is exactly one authoritative request/intake entity before AI uses it.

---

# 6. Choose the safest consolidation strategy

Based on repository evidence, choose ONE strategy.

### Strategy A — Retire Lead

Use this only if `CustomerRequest` clearly supersedes `Lead`.

Potential implementation:

* remove unused `Lead` model;
* remove orphaned code;
* create migration;
* remove dead API/frontend code if any;
* update tests/docs.

### Strategy B — Formally scope Lead

Use this only if `Lead` represents a genuinely different business concept.

If so:

* document the distinction;
* establish explicit relationships where necessary;
* make navigation/API semantics unambiguous;
* ensure future AI intake knows exactly which entity to use.

### Strategy C — Migrate Lead into CustomerRequest

Use this only if there are meaningful existing Lead records or functionality that must be preserved.

If chosen:

* define mapping;
* preserve data;
* migrate safely;
* avoid duplicate records;
* update references;
* add regression tests.

Do NOT choose a strategy based on which requires the least code.

Choose based on actual product/domain evidence.

---

# 7. Data safety

Before changing the Prisma schema:

Determine whether the development database or any repository fixtures contain real `Lead` records.

Check:

* existing tenants;
* test data;
* migrations;
* seed data;
* fixtures.

If Lead data exists:

* do not silently destroy it;
* define a migration/retention strategy;
* report the exact situation.

If there are no meaningful Lead records and the model is genuinely unused, a clean retirement may be appropriate.

Do not fabricate production assumptions.

---

# 8. Tenant isolation

If any Lead functionality remains or is migrated, verify:

* tenant ownership;
* relation ownership;
* active tenant checks;
* cross-tenant access prevention.

Do not weaken existing security helpers.

---

# 9. API and frontend cleanup

If `Lead` is retired or consolidated:

Search for and remove/update:

* imports;
* API routes;
* services;
* validation schemas;
* frontend components;
* navigation;
* forms;
* query hooks;
* types;
* tests;
* documentation.

Do not leave misleading dead references behind.

However:

**Do not delete historical documentation merely because it references the old model.**

Update it where appropriate.

---

# 10. Preserve CustomerRequest lifecycle

If `CustomerRequest` is confirmed as canonical, preserve the existing lifecycle exactly:

`NEW`
→ `IN_PROGRESS`
→ `WAITING_CUSTOMER`
→ `QUALIFIED`
→ `CONVERTED`
→ `CLOSED`

with existing:

`CANCELLED`

behavior.

Do not invent new statuses.

Do not redesign the request lifecycle.

Do not change existing appointment relationships unless required by the consolidation.

---

# 11. Preserve existing product behavior

The following must remain intact:

* Conversations;
* Clients;
* Vehicles;
* Requests;
* Appointments;
* Operations;
* Service History;
* Telegram integration;
* AI booking tools;
* tenant isolation;
* existing appointment conflict checking;
* Prompts 33–43 behavior.

Do not introduce new product features.

---

# 12. Tests

Add focused regression tests for the chosen consolidation.

At minimum verify:

### If Lead is retired

* repository contains no active runtime references;
* Prisma schema no longer exposes the retired model;
* migration applies correctly;
* existing CustomerRequest tests remain green;
* tenant isolation remains green.

### If Lead remains

* its distinction from CustomerRequest is tested;
* relationships are explicit;
* ambiguous creation paths are eliminated.

Run the complete existing test suite.

Do not weaken existing tests.

---

# 13. Validation

Run:

* TypeScript;
* production build;
* full test suite;
* Prisma validation/generation;
* migration validation if schema changed.

If possible, verify the resulting database schema against the intended model.

---

# 14. Final Report

Return exactly:

# Final Report — Prompt 44: Lead vs CustomerRequest Domain Consolidation

## 1. Decision

State:

* chosen strategy;
* canonical entity;
* reason based on repository evidence.

## 2. Evidence

Summarize the important findings from:

* schema;
* API;
* frontend;
* tests;
* migrations;
* git history;
* actual data.

## 3. Implementation

List exactly what changed.

If no code change was required, explicitly state why.

## 4. Data Safety

State:

* whether Lead records exist;
* whether migration was required;
* whether any data was removed;
* how existing data was preserved.

## 5. AI Readiness Impact

Explain how the decision affects future AI intake.

Do NOT implement AI.

## 6. Regression

Explicitly confirm:

* Conversations;
* Requests;
* Appointments;
* Operations;
* Service History;
* Telegram;
* AI booking tools;
* tenant isolation;
* Prompts 33–43.

## 7. Validation

* TypeScript:
* Build:
* Prisma:
* Tests:

## 8. Git

Report:

* branch;
* commit(s);
* pushed/not pushed;
* working tree status.

STOP after the final report.
