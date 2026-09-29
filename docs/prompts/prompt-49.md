# Prompt 49 — Conversation → Customer Request Operational Bridge

> Verbatim — reproduced exactly as provided in the development
> conversation for this project (not reconstructed, not paraphrased).

---

# PROMPT 49 — Conversation → Customer Request Operational Bridge

## CONTEXT

Autoservise is an AI-administrator / operational SaaS for auto-service businesses.

Current stable state is already pushed to GitHub.

Expected baseline:

- branch: master
- local master = origin/master
- HEAD = 054398a
- Prompt 48–48.3 complete and accepted
- Supabase schema up to date
- tests: 1368/1368 PASS
- local development DATABASE_URL uses the faster session connection on port 5432
- migrations use DIRECT_URL
- no pending local commits

Existing operational lifecycle:

Conversation
Customer
Vehicle
CustomerRequest
Appointment
Service
ServiceRecord
ServiceFollowUp

Downstream lifecycle is already substantially implemented:

CustomerRequest
→ Appointment
→ Service
→ ServiceRecord
→ Service History
→ ServiceFollowUp / retention

The remaining operational gap:

an inbound Conversation is visible in Conversations, but an operator does not yet have a clear, safe, idempotent workflow to turn that conversation into a CustomerRequest and continue the operational lifecycle.

Prompt 49 closes ONLY this bridge.

Do NOT start Prompt 50.

---

# 1. PRIMARY GOAL

Implement a production-safe operational bridge:

Conversation
→ CustomerRequest

so an operator can open an existing conversation and either:

A. create a CustomerRequest from it;

or

B. see/open the CustomerRequest already associated with it.

The workflow must reuse existing Customer, Vehicle, Conversation and CustomerRequest architecture.

Do NOT create a second lead/request model.

Do NOT restore the retired Lead model.

---

# 2. AUDIT FIRST — NO ASSUMPTIONS

Before changing code, inspect the existing source of truth.

At minimum inspect:

- prisma/schema.prisma
- Conversation model
- Message model
- Customer model
- Vehicle model
- CustomerRequest model
- Appointment model
- existing Conversation API
- existing CustomerRequest API
- Conversation Detail UI
- Customer Request create/edit UI
- Client Detail if relevant
- shared tenant/business helpers
- existing status enums
- tests for Conversations
- tests for CustomerRequest
- docs from Prompts 22, 27–31, 44, 47, 48

Determine:

1. whether Conversation already has any direct/indirect CustomerRequest relation;
2. whether CustomerRequest already stores source/provenance;
3. whether Conversation is already linked to Customer;
4. whether Conversation can be linked to Vehicle;
5. how businessId and tenantId are enforced;
6. how CustomerRequest creation currently works;
7. whether an existing API can safely be reused;
8. whether there is already a request shortcut hidden somewhere in UI;
9. what statuses represent an active/closed request;
10. whether one Conversation should map to one request or potentially multiple requests under the current product semantics.

Do not implement until this audit is complete.

---

# 3. GIT BASELINE

Run:

git status
git log --oneline -n 10
git fetch origin

Confirm:

- branch = master
- HEAD = 054398a
- working tree clean
- local master and origin/master match

If not, STOP and report the difference before modifying code.

Do not reset or rewrite history.

---

# 4. PRODUCT SEMANTICS

The intended operator workflow is:

1. Customer sends a message.
2. Conversation exists.
3. Operator opens Conversation Detail.
4. Operator understands who the customer is and what they need.
5. Operator clicks:

   Создать обращение

6. Existing information is reused/pre-filled.
7. Operator confirms the request.
8. CustomerRequest is created.
9. Conversation now visibly shows that an operational request exists.
10. Operator can open that request and continue:

CustomerRequest → Appointment → Service → History.

This is an operational handoff.

It is NOT an AI-generation feature.

---

# 5. RELATIONSHIP / DATA MODEL DECISION

After auditing existing schema, choose the smallest correct relationship.

Preferred semantics for v1:

one Conversation may have at most ONE primary CustomerRequest created through this bridge.

The operation must be idempotent:

repeated clicks / retries / duplicate HTTP requests must NOT create duplicate CustomerRequests for the same Conversation.

However:

DO NOT add a new Prisma relation if the existing schema can express this safely and clearly.

If a persistent relationship is required, implement the smallest explicit relation supported by the architecture.

Possible approaches may include:

- nullable conversationId on CustomerRequest;
- nullable customerRequestId on Conversation;
- an existing provenance/source relation.

Choose based on the current architecture.

Explain the decision in the Final Report.

If a schema change is necessary:

- create exactly one forward migration;
- no destructive migration;
- preserve all existing data;
- verify migration against Supabase.

If no schema change is necessary:

do not create a migration.

---

# 6. SOURCE / PROVENANCE

Audit the existing CustomerRequest source field/enum.

Do NOT invent a second source system.

If existing source semantics can represent a conversation-created request, reuse them.

If the current source enum cannot accurately represent this workflow, make the smallest justified extension.

The UI should be able to communicate that the request originated from a conversation where appropriate.

Do not expose technical enum names to users.

---

# 7. CUSTOMER LINKAGE

When creating a CustomerRequest from a Conversation:

reuse the Conversation's existing customer relationship if one exists.

Do NOT create a duplicate Customer.

If the Conversation is not linked to a Customer:

the operator must be given a clear existing-product-compatible way to select/link/create the customer before the request can be finalized.

First audit existing customer-linking functionality.

Reuse it if available.

Do not build an entire new customer-management flow inside Conversation Detail.

Tenant/business ownership must be verified server-side.

Never trust a client-provided customerId without checking ownership.

---

# 8. VEHICLE LINKAGE

If the Conversation/customer already provides an unambiguous Vehicle:

pre-fill it.

If the customer has multiple vehicles:

allow the operator to select the correct existing vehicle.

If there is no vehicle:

follow the existing CustomerRequest semantics.

If vehicle is optional today:

keep it optional.

If vehicle is required today:

reuse the existing vehicle creation/selection workflow.

Do not weaken current CustomerRequest invariants.

Do not create duplicate vehicles.

---

# 9. SERVICE LINKAGE

If the conversation already has an existing structured service reference, reuse it.

Otherwise:

allow selection from existing active Services if that is part of the current CustomerRequest creation flow.

Do NOT use AI to infer a service in Prompt 49.

Do NOT guess from free text.

The operator remains in control.

---

# 10. REQUEST CONTENT

The new CustomerRequest should reuse only information that already exists safely.

Possible pre-fill sources:

- customer;
- vehicle;
- service;
- conversation/channel provenance;
- latest relevant inbound text;
- existing conversation summary if already stored.

Do NOT fabricate information.

Do NOT call an AI provider.

Do NOT automatically summarize the conversation with AI.

If request description/problem text is pre-filled from a message, keep the source deterministic and obvious.

Prefer the latest meaningful inbound customer message if the current architecture supports this cleanly.

The operator must be able to edit the request before creation.

---

# 11. UX — CONVERSATION DETAIL

Use the existing Conversation Detail screen.

Do NOT create a new top-level page.

Add an operational block/action in a logical location in the existing context panel.

State A — no request linked:

show:

Обращение

and primary action:

Создать обращение

Optionally include concise helper copy such as:

Создайте обращение, чтобы продолжить работу с клиентом: запись, обслуживание и история.

State B — request already exists:

show:

Обращение создано

with useful existing request information, such as:

- request status;
- vehicle if present;
- service if present;
- created date if useful.

Primary action:

Открыть обращение

Do NOT continue showing a second “Создать обращение” action after the request exists.

---

# 12. CREATE FLOW

Prefer a lightweight flow consistent with the current application.

Possible implementation:

button
→ modal / sheet / existing form
→ pre-filled CustomerRequest fields
→ operator reviews
→ create

Do NOT navigate the operator through multiple unrelated pages just to create the request if the existing component architecture supports a modal/sheet.

But reuse existing form components if practical.

Do not duplicate large form logic.

The form must clearly allow the operator to confirm/edit the data before creation.

---

# 13. IDEMPOTENCY

This is mandatory.

Creating a CustomerRequest from a Conversation must be retry-safe.

Protect against:

- double-click;
- browser retry;
- concurrent HTTP requests;
- operator opening two tabs;
- network retry.

At the database/server level, guarantee that Prompt 49 cannot create two primary CustomerRequests for the same Conversation.

Do NOT rely only on disabling the button in React.

If a database uniqueness constraint is appropriate, use it.

If existing architecture provides another safe mechanism, use that.

Test concurrency.

---

# 14. TRANSACTIONAL INTEGRITY

If request creation requires:

- creating CustomerRequest;
- linking it to Conversation;
- updating Conversation state;

perform the logically coupled writes atomically.

A failure must not leave:

- request without intended conversation linkage;
- conversation pointing to nonexistent request;
- duplicate requests;
- cross-tenant relation.

Use existing Prisma transaction patterns.

---

# 15. TENANT ISOLATION

Mandatory.

A tenant must never:

- create a request from another tenant's conversation;
- attach another tenant's customer;
- attach another tenant's vehicle;
- attach another tenant's service;
- view another tenant's linked request;
- use guessed IDs to bypass ownership.

Use existing tenant/business guards.

Foreign-tenant resources should follow the existing API convention, preferably 404 where that is already established.

Add explicit tests.

---

# 16. REQUEST STATUS

Use the existing CustomerRequest lifecycle.

Do NOT create a new lifecycle.

The newly created request should start in the correct existing initial status.

Audit the current canonical initial state and reuse it.

Do not automatically:

- confirm it;
- convert it;
- create Appointment;
- create ServiceRecord.

Prompt 49 stops at creation/linkage.

---

# 17. CONVERSATION STATUS

Do not invent a new Conversation lifecycle unless required.

Creating a CustomerRequest should NOT automatically close the conversation unless current product semantics explicitly require that.

Conversation can remain available for communication while operational work continues.

If existing Conversation status changes are necessary, justify them in the Final Report.

Default preference:

do not change Conversation status.

---

# 18. NAVIGATION

“Открыть обращение” must take the operator to the existing CustomerRequest experience.

Do not create a duplicate request-detail implementation inside Conversations.

Reuse existing route/detail behavior.

If current CustomerRequest detail is inline rather than route-based, integrate with the existing architecture.

Do not introduce a second competing navigation model.

---

# 19. CUSTOMER REQUEST UI

On the existing CustomerRequest detail/list, if inexpensive and supported by the new relationship, provide provenance such as:

Источник: Диалог

Optionally provide:

Открыть диалог

only if this can reuse existing Conversation navigation cleanly.

Do not overbuild bidirectional navigation if the current routing architecture makes it unsafe.

Conversation → Request is mandatory.

Request → Conversation is desirable but secondary.

---

# 20. CLOSED / EXISTING REQUEST BEHAVIOR

If a linked CustomerRequest already exists but is later:

- converted;
- closed;
- otherwise terminal under existing lifecycle;

the Conversation should still show that linked request.

Do NOT silently allow creation of another primary request from the same Conversation in Prompt 49.

For v1:

one conversation → one primary request.

If future business requirements need multiple jobs from one conversation, that is a separate product decision.

---

# 21. ERROR UX

User-facing errors must be Russian.

Examples:

Не удалось создать обращение.

Клиент не выбран.

Автомобиль не принадлежит выбранному клиенту.

Обращение для этого диалога уже существует.

Do not expose:

- stack traces;
- Prisma errors;
- raw SQL errors;
- internal enum names.

Keep internal error codes stable/structured where useful.

---

# 22. LOADING / DOUBLE CLICK UX

While request creation is in progress:

- disable the primary submit action;
- show existing loading treatment;
- prevent accidental repeat submission in UI.

This is UX only.

Server/database idempotency remains mandatory.

---

# 23. MOBILE

Conversation Detail and the create flow must remain usable on narrow screens.

Validate approximately 390 px width.

No horizontal overflow.

Actions must remain reachable.

Do not redesign the whole Conversation screen.

---

# 24. STRICTLY OUT OF SCOPE

Do NOT implement:

- AI response generation;
- AI classification;
- AI service inference;
- AI summarization;
- automatic Appointment creation;
- automatic booking;
- automatic outbound messages;
- Telegram sending changes;
- WhatsApp;
- SMS;
- email;
- newsletters;
- retention messaging;
- CRM integration;
- CPBS;
- billing;
- payment;
- service capacity;
- technician scheduling;
- inventory;
- WorkOrder;
- Invoice;
- Prompt 50;
- launch-screen changes;
- Dashboard redesign;
- broad localization cleanup.

Do not restore Lead.

No new npm dependencies unless absolutely necessary.

---

# 25. MIGRATION SAFETY

If Prompt 49 requires a Prisma schema change:

Before deployment run:

npx prisma validate
npx prisma migrate status

Inspect current Supabase migration state.

Create one forward migration with a descriptive name, for example:

conversation_customer_request_bridge

Do not use:

prisma migrate reset
db push --force-reset
DROP
TRUNCATE

Apply only the new migration with the safe existing deployment workflow.

Verify existing row counts/data remain intact.

If no schema change is required:

do not manufacture a migration.

---

# 26. API DESIGN

Prefer extending existing REST architecture rather than introducing a parallel API style.

Possible endpoint shape, only if appropriate after audit:

POST /api/conversations/:id/request

But do NOT use this exact route blindly if an existing CustomerRequest endpoint is the better architectural fit.

The endpoint should be retry-safe.

A reasonable idempotent behavior may be:

first successful creation → 201
subsequent same-conversation retries → 200 with the existing request

provided this fits existing API conventions.

Do not return duplicate resources.

---

# 27. CONCURRENCY TEST

Explicitly test concurrent creation.

For example:

10 simultaneous create-from-conversation calls

Expected:

- all safe responses;
- exactly ONE CustomerRequest in DB for that Conversation;
- every successful/idempotent response resolves to the same request ID;
- no orphan links;
- no 500 caused by expected race conditions.

Use the same robust transaction/concurrency principles already used in Prompt 48.1 where appropriate.

Do not copy code blindly.

---

# 28. TESTS

Record baseline first.

Expected baseline:

1368 tests.

Add tests for at least:

1. create request from Conversation;
2. correct initial CustomerRequest status;
3. existing Customer reused;
4. vehicle ownership validation;
5. service ownership validation if applicable;
6. conversation/request linkage;
7. repeated call returns same request;
8. concurrent creation produces one request;
9. foreign tenant Conversation rejected;
10. foreign tenant Customer rejected;
11. foreign tenant Vehicle rejected;
12. foreign tenant Service rejected if applicable;
13. existing linked request returned;
14. terminal linked request still shown rather than duplicated;
15. creation failure rolls back coupled writes;
16. user-facing error behavior where appropriate.

Do not weaken existing tests.

Run:

npm run typecheck
npm run build
npm test

Report actual final count.

---

# 29. SUPABASE VALIDATION

Validate against the existing restored Supabase.

Use safe dedicated test data.

Do not modify real user data.

Prefer an existing Prompt 48.1 test tenant if suitable.

If a new test tenant is truly necessary, clearly identify it in the report.

Verify:

- migration if any;
- request creation;
- linkage;
- idempotency;
- concurrency;
- tenant isolation.

Do not delete user data.

---

# 30. BROWSER VALIDATION

Validate the real operator workflow:

A. Open Conversations.

B. Open a conversation without a linked request.

C. Confirm “Создать обращение” is visible.

D. Open create flow.

E. Verify customer pre-fill/reuse.

F. Verify vehicle behavior.

G. Verify service behavior.

H. Edit request text if applicable.

I. Create request.

J. Confirm UI changes to “Обращение создано”.

K. Click “Открыть обращение”.

L. Confirm correct existing request opens.

M. Return to Conversation.

N. Confirm a second create action is not offered.

O. Refresh page.

P. Confirm linkage persists.

Q. Test narrow/mobile width (~390 px).

R. Check browser console.

No new console errors.

---

# 31. EXISTING DATA SAFETY

Before and after any migration or validation, ensure existing business data is preserved.

Do not delete or rewrite existing:

- Customers;
- Vehicles;
- Conversations;
- Messages;
- CustomerRequests;
- Appointments;
- ServiceRecords;
- ServiceFollowUps.

Test data must be clearly isolated.

---

# 32. PERFORMANCE

Do not regress the Prompt 48.3 database connection configuration.

Local development must continue using the currently documented fast connection strategy.

Do not change:

DATABASE_URL topology
DIRECT_URL topology
Supabase region

unless Prompt 49 unexpectedly proves this is necessary — which it normally should not.

Do not introduce N+1 queries into Conversation list rendering.

Only fetch linked request data needed by the detail/list UI.

---

# 33. DOCUMENTATION

Create:

docs/prompts/prompt-49.md

docs/final-reports/final-report-49.md

Update PRODUCT_BLUEPRINT / README only if they are already used as source-of-truth for lifecycle capabilities.

Do not rewrite unrelated docs.

Final Report must include:

1. Initial state
2. Architecture audit
3. Existing models/APIs reused
4. Relationship decision
5. Migration/schema changes, or confirmation none were needed
6. API implementation
7. Idempotency strategy
8. Concurrency strategy/results
9. Transactional integrity
10. Tenant isolation
11. Conversation Detail UX
12. Customer/Vehicle/Service behavior
13. CustomerRequest provenance/navigation
14. Error UX
15. Files changed
16. Tests before/after
17. Typecheck
18. Build
19. Supabase validation
20. Browser validation
21. Mobile validation
22. Existing-data safety
23. Remaining limitations
24. Git state
25. Push status
26. LOCAL APP URL

---

# 34. GIT

Before implementation:

git status
git fetch origin
git log --oneline -n 10

Expected:

HEAD = 054398a
master = origin/master
working tree clean

After successful implementation and validation:

git status
git diff
git log --oneline -n 10

Create exactly ONE local commit:

feat: bridge conversations to customer requests

DO NOT PUSH.

Do not modify:

- origin;
- main;
- GitHub default branch;
- remote history;
- GitHub settings.

After commit:

master should be exactly 1 commit ahead of origin/master.

---

# 35. ACCEPTANCE CRITERIA

Prompt 49 is complete only if:

AC1. Operator can create a CustomerRequest from Conversation Detail.

AC2. Existing Customer is reused rather than duplicated.

AC3. Vehicle relationship respects current ownership rules.

AC4. Service relationship respects current ownership rules.

AC5. Operator reviews/edits request before creation.

AC6. One Conversation produces at most one primary CustomerRequest in v1.

AC7. Repeated create requests are idempotent.

AC8. Concurrent creation produces exactly one CustomerRequest.

AC9. Tenant isolation is enforced server-side.

AC10. Coupled writes are transactional.

AC11. Existing CustomerRequest lifecycle is reused.

AC12. No Appointment is automatically created.

AC13. Conversation remains usable after request creation.

AC14. Conversation clearly shows linked request.

AC15. Operator can open the existing CustomerRequest.

AC16. Refresh preserves linkage.

AC17. Terminal request does not cause a duplicate create action.

AC18. User-facing errors are Russian.

AC19. Mobile layout works.

AC20. Existing data remains intact.

AC21. Prompt 48.3 DB configuration is not regressed.

AC22. Prisma validate PASS.

AC23. Migration status clean.

AC24. Typecheck PASS.

AC25. Build PASS.

AC26. All tests PASS.

AC27. Browser validation PASS.

AC28. Exactly one local Prompt 49 commit exists.

AC29. Nothing pushed.

---

# 36. STOP CONDITIONS

STOP and report instead of improvising if:

- current git baseline differs materially from expected;
- Supabase migration history is inconsistent;
- implementing the bridge would require destructive schema changes;
- existing CustomerRequest architecture conflicts with the proposed one-to-one semantics;
- tenant isolation cannot be preserved with the proposed approach;
- safe concurrency cannot be guaranteed;
- completing the task requires restoring Lead;
- completing it requires a new parallel request model.

Do not hide architecture conflicts.

---

# 37. EXECUTION ORDER

1. Git baseline
2. Read source of truth
3. Audit Conversation → CustomerRequest architecture
4. Decide minimal relationship
5. Decide whether migration is necessary
6. Implement backend relationship/API
7. Implement transaction + idempotency
8. Implement tenant isolation
9. Implement Conversation Detail UX
10. Reuse CustomerRequest form behavior
11. Add navigation to existing request
12. Tests
13. Concurrency validation
14. Prisma validation/migration status
15. Apply migration safely if required
16. Supabase validation
17. Typecheck
18. Build
19. Full tests
20. Browser validation
21. Mobile validation
22. Existing-data safety check
23. Documentation
24. Git review
25. One local commit
26. Final Report
27. STOP

Do NOT push.
Do NOT start Prompt 50.

At the end provide:

LOCAL APP URL: http://localhost:...

Then STOP.
