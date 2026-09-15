# Prompt 42 — End-to-End Operator Flow & UX Integrity Audit

> Verbatim — reproduced exactly as provided in the development
> conversation for this project (not reconstructed, not paraphrased).

---

# Prompt 42 — End-to-End Operator Flow & UX Integrity Audit

## Context

This is the existing **AI-admin-for-auto-services** application.

Do NOT redesign the product, introduce new architecture, or add unrelated features.

The goal of this prompt is to audit the **real operator workflow end-to-end**, using the existing implementation and existing domain model.

Previous prompts 27–41 already audited and hardened the underlying lifecycle logic. Do not duplicate those audits unless needed to verify an end-to-end dependency.

## Primary Goal

Audit whether a real auto-service operator can complete the full operational lifecycle through the existing UI without dead ends, contradictory states, missing navigation, or unnecessary manual workarounds.

The canonical lifecycle to audit is:

**Client → Vehicle → Service → Request → Appointment → Visit → Service Result → Service History → Future/Repeat Service**

Also audit the reverse/contextual paths where the operator naturally starts from:

* Conversations
* Clients
* Requests
* Appointments
* Operations

The audit must use the **actual existing frontend and backend implementation**, not an imagined UI.

---

# 1. Audit the canonical workflow

Trace the complete workflow through the existing application.

For every step determine:

1. Where does the operator start?
2. What UI action creates or opens the next object?
3. Is the required data already available?
4. If data is missing, is the reason clearly explained?
5. Can the operator continue without leaving the current workflow unnecessarily?
6. Is there an obvious way to return to the previous object?
7. After creation/update, is the resulting object immediately visible?
8. Are status changes reflected immediately?
9. Does the UI link the related entities correctly?

Audit this exact chain:

### Client

Create/open client → inspect client → vehicle context.

### Vehicle

Create/open vehicle → verify client relationship → inspect vehicle history.

### Service

Open/create service → verify it can be selected during appointment creation.

### Request

Create/open request → assign/link client and vehicle where supported → move request through its existing lifecycle.

### Appointment

Create appointment from the available UI → verify:

* customer
* vehicle
* service
* date/time
* request relationship where applicable
* appointment status

Verify that the operator can understand what the appointment belongs to.

### Visit

Trace the existing appointment status flow:

`SCHEDULED → CONFIRMED → IN_PROGRESS → COMPLETED`

and verify the UI provides the expected next action at each stage.

Do not invent new status transitions.

### Service Result

After a completed visit:

* verify the UI clearly indicates whether the service result exists;
* verify the operator can create the result when appropriate;
* verify the result is associated with the correct appointment/vehicle/client;
* verify the existing Prompt 41 restriction remains intact.

### Service History

Verify the completed service appears in the appropriate history views.

Verify that the operator can understand:

* what vehicle was serviced;
* what service was performed;
* when it happened;
* the result/details;
* mileage where applicable;
* recommendations;
* total price where applicable.

### Repeat Service / Retention

Determine whether the existing product provides a usable path from completed service/history to a future service need.

Do NOT add a retention feature in this prompt.

Only audit what already exists.

If no such path exists, classify it as a product gap rather than inventing an implementation.

---

# 2. Audit entry points

The same operational task may be started from different parts of the application.

Audit these entry points:

## Conversations

Can an operator go from a conversation to the relevant client/request?

Can the operator reach an appointment/request workflow without losing context?

## Clients

From a client:

* vehicle
* requests
* conversations
* appointments
* service history

must be discoverable where the existing implementation supports them.

## Requests

From a request:

* client
* vehicle
* service
* appointment

must be understandable and reachable.

Verify the existing quick action for creating an appointment.

## Appointments

From an appointment:

* client
* vehicle
* service
* request
* service result/history

must be discoverable where applicable.

## Operations

Verify that active operational work leads to the correct underlying object.

Check that completed/closed lifecycle objects do not incorrectly remain in active queues.

Do not change queue semantics unless a genuine regression is found.

---

# 3. Dead-end audit

Explicitly search for UI dead ends.

Examples:

* object exists but there is no way to open it;
* detail page has no route back to its parent;
* action exists but requires unexplained prerequisite data;
* action succeeds but UI does not show the created object;
* link points to an invalid/nonexistent route;
* operator must manually remember an ID;
* related object exists in backend but is inaccessible from the relevant screen;
* status changes but available actions do not update;
* empty states do not explain how to proceed.

Every discovered issue must be classified:

* **P0** — blocks core operation / data integrity
* **P1** — serious operational friction or broken workflow
* **P2** — minor UX friction
* **P3** — cosmetic/documentation only

---

# 4. Empty-state and prerequisite audit

Pay special attention to the issue discovered in Prompt 34.

When an action requires prerequisite reference data, the UI must not simply present a disabled action with no explanation.

Audit all similar cases, not just appointments.

For example:

* no clients;
* no vehicles;
* no services;
* no requests;
* no available appointments;
* no service history;
* no active conversations.

For each empty state determine:

1. Is the state understandable?
2. Does it explain why the action is unavailable?
3. Does it provide the most useful next action/link?
4. Does it avoid misleading the operator?

Do not create fake seed data.

---

# 5. URL and navigation integrity

Audit all major detail/open states.

Verify that existing URL-based navigation works where the product already uses query parameters or routes, including the appointment pattern introduced in Prompt 31.

Look for:

* broken links;
* stale query parameters;
* opening the wrong object;
* browser refresh losing necessary context;
* back-navigation producing unexpected state;
* links to objects belonging to another tenant.

Do not introduce a new routing architecture.

---

# 6. Data consistency visible to the operator

Verify that the same entity does not display contradictory information in different screens.

Examples:

* appointment status differs between list and detail;
* request says appointment exists but appointment cannot be found;
* client detail and vehicle detail show different service history;
* service result appears in one screen but not another;
* completed appointment appears as active operational work;
* cancelled/no-show appointment appears eligible for service completion.

Focus on user-visible consistency.

---

# 7. Tenant isolation through UI navigation

Perform a targeted audit of all discovered entity links.

Confirm that an operator cannot use a legitimate UI link to access another tenant's:

* client;
* vehicle;
* request;
* conversation;
* appointment;
* service;
* service record.

Do not duplicate the complete security test suite unless necessary.

The goal is specifically to ensure that UI navigation does not bypass the existing server-side tenant protections.

---

# 8. Real-data verification

If the local development database contains usable real test data, inspect the workflow using it.

Do NOT create large amounts of unnecessary test data.

If the existing `Torque` tenant contains the usable test dataset referenced in previous prompts, use it for manual verification where possible.

If a step cannot be manually tested because the required reference data is unavailable, document the limitation rather than fabricating data.

---

# 9. Implementation rules

If you find a genuine issue:

1. Fix the smallest correct layer.
2. Prefer existing shared helpers/components/services.
3. Do not introduce duplicate business logic.
4. Do not change the data model unless absolutely necessary.
5. Do not add speculative features.
6. Do not redesign existing screens.
7. Preserve tenant isolation.
8. Preserve all existing lifecycle rules.
9. Preserve the existing dark graphite + gold design system.
10. Do not touch `.mcp.json`.
11. Do not touch `marketing/`.

If no implementation change is necessary for a finding, report it as an observation rather than changing code.

---

# 10. Validation

After any changes run:

* TypeScript
* production build
* full existing test suite

Add focused regression tests for every actual bug fixed.

Do not weaken or remove existing tests.

The final report must include:

### Validation

* TypeScript:
* Build:
* Tests:

### Findings

For every finding:

* severity;
* exact problem;
* affected screen/route;
* root cause;
* whether fixed or only documented.

### End-to-End Result

State whether the canonical lifecycle is:

* PASS
* PASS WITH P2/P3 ISSUES
* PARTIAL
* BLOCKED

### Manual Verification

State exactly what was manually verified and what could not be verified.

### Regression

Confirm whether Prompts 33–41 remain intact.

### Git

Report:

* branch;
* commit hash(es);
* whether pushed;
* working tree status.

## Critical constraint

Do not stop after finding the first issue.

Complete the entire end-to-end audit first, then implement the smallest set of genuine fixes, then run the complete validation suite.

Do not create new product features merely because a workflow could theoretically be improved.

STOP after the final report.
