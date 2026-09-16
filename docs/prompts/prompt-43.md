# Prompt 43 — Operational Readiness & Product Gap Audit

> Verbatim — reproduced exactly as provided in the development
> conversation for this project (not reconstructed, not paraphrased).

---

# Prompt 43 — Operational Readiness & Product Gap Audit

## Context

This is the existing **AI-admin-for-auto-services** application.

The application has already gone through a long sequence of implementation and audit prompts.

Do NOT restart the project analysis from scratch.

Do NOT redesign the application.

Do NOT implement speculative features.

The purpose of this prompt is to determine:

> **What does the existing application already support, what is genuinely missing for a real auto-service operator, and what should be built next?**

This is a **readiness and product-gap audit**, not a feature-building prompt.

---

# 1. Current product reality

Inspect the actual repository, Prisma schema, API routes, services, frontend routes/components, tests, and existing documentation.

Do not rely only on previous reports.

Build a factual inventory of what is actually implemented.

At minimum audit these domains:

* Authentication
* Tenants
* Roles
* Dashboard
* Clients
* Vehicles
* Services
* Requests
* Conversations
* Appointments
* Operations
* Service Records / Service History
* Settings
* Telegram integration
* Audit/security infrastructure

For every domain identify:

1. What exists in the database?
2. What backend/API functionality exists?
3. What frontend functionality exists?
4. What can an operator actually do?
5. What lifecycle/statuses exist?
6. What important relationships exist?
7. What is tested?
8. What is currently only scaffolding/foundation?
9. What is completely absent?

Do not assume that the existence of a Prisma model means the feature is operational.

---

# 2. Real auto-service operator workflow

Evaluate the product from the perspective of a small or medium auto-service.

The core operational workflow is:

**Lead / Conversation**
→ **Customer**
→ **Vehicle**
→ **Request**
→ **Service**
→ **Appointment**
→ **Visit**
→ **Service Result**
→ **Service History**
→ **Repeat Service**

Determine exactly which parts are currently operational.

For each stage answer:

* Can the operator perform this through the UI?
* Is the workflow complete?
* Is important information missing?
* Does the operator need to leave the application?
* Is there a manual workaround?
* Is the limitation acceptable for an MVP?
* Is the limitation a genuine blocker for daily operation?

Do not fix anything yet.

---

# 3. Operational capability matrix

Create a table with these columns:

| Domain | Implemented | Operator can use it end-to-end | Important limitation | MVP impact | Priority |
| ------ | ----------- | ------------------------------ | -------------------- | ---------- | -------- |

Use these priority levels ONLY:

* **MUST HAVE** — required for the product's intended core workflow
* **SHOULD HAVE** — materially improves daily operation but core workflow can function without it
* **LATER** — useful but should not block the next milestone
* **NOT REQUIRED NOW** — explicitly not necessary for the current product stage

Do NOT use subjective ratings or numeric scores.

Do NOT produce a "best/worst" ranking.

---

# 4. Customer management gap audit

Audit whether a real operator can maintain a useful customer record.

Check:

* name;
* phone;
* contact information;
* vehicles;
* requests;
* conversations;
* appointments;
* service history;
* notes where currently supported;
* customer status where currently supported;
* duplicate/customer identity handling;
* search;
* filtering;
* opening related records;
* tenant isolation.

Determine what is sufficient and what is missing.

Do not automatically add CRM functionality.

---

# 5. Vehicle management gap audit

A vehicle is central to an auto-service workflow.

Audit:

* make;
* model;
* year;
* VIN where supported;
* license plate where supported;
* mileage;
* customer relationship;
* service history;
* requests;
* appointments;
* current context when creating operational records;
* search/filtering where supported.

Identify whether the current implementation is sufficient for an MVP auto-service workflow.

Do not add fields merely because other auto-service software has them.

---

# 6. Service catalog gap audit

Audit the existing Service implementation.

Determine whether an operator can realistically maintain:

* service name;
* description;
* price;
* currency;
* active/inactive state;
* duration where applicable;
* other currently implemented fields.

Then determine what the appointment/request workflow actually consumes from the Service record.

Important:

Do not invent a price-book architecture.

Do not introduce service packages, parts catalogs, inventory, technician assignment, or work orders unless the existing product already contains them.

Only identify them as future gaps if they materially matter.

---

# 7. Request / lead management gap audit

Audit the existing CustomerRequest lifecycle.

Current known statuses include:

`NEW`
`IN_PROGRESS`
`WAITING_CUSTOMER`
`QUALIFIED`
`CONVERTED`
`CLOSED`
`CANCELLED`

Current known sources include:

`PHONE`
`WEBSITE`
`MANUAL`
`OTHER`

Verify the actual implementation.

Determine:

* what creates a request;
* how a request is qualified;
* how it becomes an appointment;
* how it becomes converted;
* how it is closed;
* how an operator knows what to do next;
* whether request information survives into the appointment;
* whether the request remains traceable after conversion.

Do not redesign the request lifecycle.

---

# 8. Appointment / scheduling gap audit

Audit the current appointment functionality.

Determine exactly what is supported for:

* creation;
* editing;
* status changes;
* customer;
* vehicle;
* service;
* request;
* date/time;
* duration if supported;
* conflicts;
* search;
* filtering;
* calendar representation;
* today/upcoming views;
* cancellation;
* no-show;
* completion;
* service-result linkage.

Distinguish carefully between:

### Existing limitation

A capability intentionally absent from the current implementation.

### Actual defect

A capability that should already work according to the existing product model but does not.

Do not turn every limitation into a bug.

---

# 9. Service execution audit

Audit what happens after an appointment becomes `IN_PROGRESS` or `COMPLETED`.

Determine whether the application currently supports the actual operational concept of:

**"The car arrived and the work was performed."**

Inspect the existing ServiceRecord implementation.

Document exactly what can be recorded:

* performedAt;
* mileage;
* work description;
* parts description;
* recommendations;
* total price;
* currency;
* appointment relation.

Determine what is still missing from actual service execution.

Examples may include:

* technician;
* work order;
* parts inventory;
* invoice;
* payment;
* estimate;
* photos;
* documents.

Do NOT implement these in this prompt.

Classify whether each is necessary for the current MVP or can remain future scope.

---

# 10. Money / commercial workflow audit

Determine exactly how money is currently represented.

Inspect:

* Service price;
* ServiceRecord total price;
* currency;
* invoices;
* payments;
* payment status;
* subscriptions;
* billing;
* usage events.

Distinguish:

**customer service price**

from

**actual transaction/payment processing**.

Do not implement payment providers.

Do not implement Stripe, ЮKassa, T-Bank, or any other payment provider in this prompt.

The goal is only to determine the current gap and its product priority.

---

# 11. Communication / AI readiness

The product is intended to become an AI administrator for auto-services.

Audit the foundation needed for the future AI layer.

Inspect:

* Conversations;
* Messages;
* Telegram integration;
* contact/request relationships;
* conversation history;
* escalation;
* operations queue;
* Knowledge/Service information;
* existing AIProvider abstraction if present;
* ChannelAdapter or equivalent if present.

Determine whether the current foundation can support a future flow:

**incoming customer message**
→ **understand request**
→ **qualify**
→ **select service**
→ **offer appointment**
→ **create appointment**
→ **send confirmation**
→ **follow-up**

Do not implement AI or LLM functionality.

Do not add OpenAI.

Do not add Telegram/WhatsApp/etc. channels beyond what already exists.

The goal is to identify architectural/product gaps that must be addressed before AI can safely operate.

---

# 12. Operations / daily work audit

Evaluate whether the Operations screen can realistically function as the operator's daily work queue.

Audit:

* active escalations;
* customer requests;
* follow-ups;
* waiting states;
* appointments requiring action;
* completed work;
* cancelled/no-show work;
* stale items;
* closed lifecycle exclusion.

Determine whether the operator can answer:

> "What do I need to do right now?"

If not, document the precise gap.

Do not redesign Operations in this prompt.

---

# 13. Search and discoverability

Audit whether an operator can find records without knowing IDs.

Check existing search/filter capabilities for:

* customers;
* vehicles;
* requests;
* conversations;
* appointments;
* services.

Identify critical missing search capabilities.

Do not implement a global search unless the audit proves it is necessary.

---

# 14. Settings and configuration

Audit the existing Settings area.

Determine what a real tenant/operator can configure.

Check:

* tenant/business information;
* users;
* roles;
* services;
* Telegram;
* other currently implemented integrations;
* operational settings.

Identify missing configuration only when it directly affects daily operation.

---

# 15. Security and tenant isolation

Perform a targeted review of the existing multi-tenant architecture.

Verify that the operational domains consistently use:

* tenant scoping;
* ownership checks;
* active-status checks;
* relation consistency checks.

Focus on newly discovered or under-audited paths.

Do not duplicate the complete tenant-isolation test suite unless a regression is suspected.

---

# 16. Data model vs product reality

This section is especially important.

Compare the Prisma schema against actual product behavior.

Identify:

### A. Models that are fully operational

### B. Models that exist but are only partially used

### C. Models that appear to be future architecture

### D. Important business concepts that are absent

Do not conclude that every absent concept must be implemented.

The objective is to understand whether the current schema accurately represents the product's intended MVP.

---

# 17. Existing abstractions

Inspect the repository for architectural abstractions such as:

* AIProvider
* CRMAdapter
* CalendarAdapter
* ChannelAdapter
* PaymentAdapter

and determine their actual implementation state.

Report:

* implemented;
* interface only;
* partially implemented;
* unused;
* future-ready.

Do not implement future adapters in this prompt.

---

# 18. MVP boundary

Based on the complete audit, define the current MVP boundary.

Produce four sections:

## Already sufficient

Capabilities that are genuinely usable today.

## Must build next

Capabilities that should be implemented before treating the product as a usable MVP for an auto-service.

## Should build later

Capabilities that materially improve the product but should not block the next milestone.

## Explicitly defer

Capabilities that should deliberately remain outside the current scope.

Be conservative.

The fact that a feature exists in competitors does NOT make it required.

---

# 19. Recommended next development sequence

After the audit, propose a development sequence.

Do not provide a generic roadmap.

Use the actual gaps discovered in this repository.

The sequence should contain no more than **5 next milestones**.

For each milestone state:

1. objective;
2. exact product gap it closes;
3. affected existing modules;
4. dependencies;
5. whether it is required before AI integration;
6. whether it changes the data model;
7. whether it can be independently tested.

Do not implement any of these milestones in this prompt.

---

# 20. Critical scope rules

This prompt is an AUDIT.

Therefore:

### DO NOT:

* add AI;
* add LLM;
* add OpenAI;
* add CRM;
* add Kommo;
* add Calendar integration;
* add SMS;
* add WhatsApp;
* add Avito;
* add VK/MAX;
* add voice AI;
* add payments;
* add billing providers;
* add inventory;
* add work orders;
* add technicians;
* add invoices;
* redesign the UI;
* rewrite the data model;
* create speculative features;
* seed fake business data.

### DO:

* inspect the real code;
* compare schema/API/UI behavior;
* identify actual product gaps;
* distinguish defects from deliberate scope limitations;
* identify dependencies;
* establish a realistic MVP boundary.

---

# 21. Validation

Because this prompt is primarily an audit:

Run at minimum:

* TypeScript;
* production build;
* full existing test suite.

Do not modify code merely to make the audit pass.

If you discover an actual regression that prevents the audit from being completed, fix only that regression and add a focused test.

Otherwise, do not make implementation changes.

---

# 22. Final Report format

Return exactly:

# Final Report — Prompt 43: Operational Readiness & Product Gap Audit

## 1. Audit Result

One of:

* **READY FOR NEXT PRODUCT MILESTONE**
* **READY WITH DEFINED MVP GAPS**
* **NOT READY — CORE OPERATIONAL GAP**

Explain briefly.

## 2. Current Product Inventory

Table:

| Domain | Backend | Frontend | Operator usable | Status |
| ------ | ------- | -------- | --------------- | ------ |

## 3. Operational Capability Matrix

Use the table specified in Section 3.

## 4. Critical Product Gaps

Only genuine gaps.

For each:

* Severity/priority;
* exact gap;
* evidence from repository;
* operational consequence;
* recommendation.

## 5. Existing Limitations That Are NOT Bugs

Explicitly list important limitations that should not currently be treated as defects.

## 6. Data Model vs Product Reality

Classify models into:

* fully operational;
* partially used;
* future architecture;
* missing concepts.

## 7. AI Readiness

State what is already ready for future AI integration and what foundation is still missing.

Do not implement AI.

## 8. MVP Boundary

### Already sufficient

### Must build next

### Should build later

### Explicitly defer

## 9. Recommended Next 5 Milestones

Maximum five.

For each include:

* objective;
* gap closed;
* modules affected;
* dependencies;
* AI dependency;
* data-model impact;
* testability.

## 10. Validation

* TypeScript:
* Build:
* Tests:

## 11. Regression

Confirm that Prompts 33–42 remain intact.

## 12. Git

Report:

* branch;
* commits;
* pushed/not pushed;
* working tree status.

STOP after the final report.
