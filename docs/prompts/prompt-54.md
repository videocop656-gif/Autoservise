# Prompt 54 — Customer & Vehicle Intake from Conversation

> Verbatim — reproduced exactly as provided in the development
> conversation for this project (not reconstructed, not paraphrased).

---

# PROMPT 54 — CUSTOMER & VEHICLE INTAKE FROM CONVERSATION
## Safely turn a real inbound conversation into identified customer + vehicle context

You are working in the existing project `Autoservise`.

This prompt continues directly from Prompt 53.

The goal is NOT autonomous AI.

The goal is to close the operational identity gap between:

REAL inbound Conversation
→ known Customer
→ known Vehicle
→ enough trusted context for later qualification and booking.

The operator remains in control of all persistent data creation/linking.

--------------------------------------------------
0. VERIFIED BASELINE
--------------------------------------------------

Repository:
- Project: Autoservise
- Branch: master
- Prompt 53 commit:
  `929a6bc feat: add ai reply drafts to conversations`
- Prompt 53 has been pushed to origin/master.
- Repository is clean and synchronized.

Stack:
- React + TypeScript + Vite
- Tailwind
- shadcn/ui
- lucide-react
- Vercel-compatible Node/TypeScript REST API
- PostgreSQL / Supabase
- Prisma
- Zod
- Vitest
- custom auth
- Argon2id
- HttpOnly sessions
- multi-tenant architecture
- roles:
  - owner
  - admin
  - manager

Current test baseline:
- 1562 tests passing

Existing operational lifecycle:

Telegram inbound
→ Conversation
→ Message
→ CustomerRequest
→ Appointment
→ ServiceRecord
→ ServiceFollowUp

Existing Conversation capabilities:
- real inbound Telegram messages
- real operator outbound Telegram messages
- Conversation Detail
- Conversation → CustomerRequest bridge
- Prompt 53:
  `Предложить ответ AI`
- AI draft is editable
- AI draft does NOT auto-send
- AI draft mode blocks mutating booking tools
- AI may use read-only availability
- AI context includes:
  - current business-local date/time
  - business working hours
  - services
  - prices/durations
  - KnowledgeItem
  - BusinessRule
  - known Customer context
  - recent Conversation history

Known gap:

A new Telegram sender may have a Conversation but still not be connected to a real Customer and Vehicle.

Booking should not rely on guessed identity.

--------------------------------------------------
1. OBJECTIVE
--------------------------------------------------

Add a safe operator-controlled Customer + Vehicle intake workflow directly inside Conversation Detail.

Target workflow:

new Telegram sender
→ Conversation
→ operator identifies/creates Customer
→ operator identifies/adds Vehicle
→ Conversation now has trusted Customer context
→ AI draft automatically benefits from that existing context
→ later prompts may qualify the request and create booking flow

The operator must be able to:

1. see whether the Conversation is linked to a Customer
2. search/select an existing Customer
3. create a Customer if needed
4. see that Customer's Vehicles
5. select/reuse an existing Vehicle where appropriate
6. add a new Vehicle if needed
7. clearly see the resulting identity context in Conversation Detail

Do NOT make AI autonomously create Customer or Vehicle.

--------------------------------------------------
2. FIRST — AUDIT BEFORE IMPLEMENTATION
--------------------------------------------------

Before changing code, inspect actual project architecture.

Audit:

1. Conversation Prisma model
2. Conversation.customerId or equivalent
3. Message model
4. Customer model
5. Vehicle model
6. Customer ↔ Vehicle relations
7. Customer repositories/services/API
8. Vehicle repositories/services/API
9. existing customer creation forms
10. existing vehicle creation forms
11. Conversation Detail right-hand context panel
12. existing Conversation PATCH semantics
13. Prompt 49 Conversation → CustomerRequest bridge
14. Prompt 49.1 request-link protection
15. AI context builder
16. how known Customer is currently passed to AI
17. whether Vehicle context is currently passed to AI
18. phone normalization/validation utilities
19. tenant-isolation patterns
20. active/inactive/archive semantics if present
21. existing duplicate protections
22. relevant tests

Do not assume field names from this prompt.

Reuse the real architecture.

Briefly report audit findings before implementation.

--------------------------------------------------
3. IMPORTANT — CUSTOMER LINK IS DIFFERENT FROM REQUEST LINK
--------------------------------------------------

Prompt 49.1 deliberately protected:

Conversation ↔ CustomerRequest

from generic mutation.

Do NOT weaken that protection.

This prompt concerns:

Conversation ↔ Customer

and Customer ↔ Vehicle.

Audit current Customer linking behavior separately.

Do not accidentally reopen arbitrary `customerRequestId` PATCH mutation.

All Prompt 49/49.1 guarantees must remain intact.

--------------------------------------------------
4. CONVERSATION DETAIL — IDENTITY SECTION
--------------------------------------------------

Add or improve a clear section in Conversation Detail.

Suggested conceptual heading:

`КЛИЕНТ И АВТОМОБИЛЬ`

Use existing UI language/design patterns.

If no Customer is linked:

show a clear state such as:

`Клиент не определён`

Actions:

`Найти клиента`
`Создать клиента`

If Customer is linked:

show useful compact context such as:

- customer name
- phone
- email if present/useful
- existing vehicles

Do not overload the narrow Conversation side panel.

Reuse existing cards/components where practical.

--------------------------------------------------
5. FIND EXISTING CUSTOMER
--------------------------------------------------

The operator must be able to find an existing Customer before creating a duplicate.

Reuse existing Customer search API/service if available.

Search should use actual supported fields.

At minimum, where fields exist:
- name
- phone

Email may be included if already supported.

Do not implement a new search engine.

Do not perform unsafe fuzzy identity matching.

The operator explicitly chooses the Customer.

--------------------------------------------------
6. PHONE NORMALIZATION & DUPLICATE SAFETY
--------------------------------------------------

Phone is the strongest practical identity key available for this workflow.

Audit existing phone normalization.

If canonical normalization already exists:
reuse it.

Do NOT create competing normalization rules.

When creating a Customer from Conversation:

if a phone is supplied and an existing Customer in the SAME tenant has the same normalized phone:

do NOT silently create a duplicate.

Return/show a useful result that allows the operator to use the existing Customer.

Conceptual Russian UI:

`Клиент с таким номером уже существует.`

Action:

`Связать существующего клиента`

Do not search across tenants.

Never reveal existence of customers in another tenant.

If current schema/data does not support a safe DB uniqueness constraint because legacy duplicates may exist:

do NOT add one blindly.

Implement the smallest safe service-level behavior and document the limitation.

--------------------------------------------------
7. CREATE CUSTOMER FROM CONVERSATION
--------------------------------------------------

Allow creating a Customer without leaving Conversation Detail.

Reuse existing Customer creation service/schema/validation.

Do not create a second implementation.

Use the smallest form consistent with current Customer model.

Likely fields may include:
- name
- phone
- email

but use actual schema.

Do not invent required fields.

After successful creation:

- link Customer to Conversation
- update Conversation Detail immediately
- show trusted Customer context
- do NOT send anything to Telegram
- do NOT automatically create CustomerRequest
- do NOT automatically create Appointment

Prefer one safe server-side operation/transaction where needed so that:

Customer creation
+
Conversation linking

cannot leave an avoidable half-completed state.

--------------------------------------------------
8. LINK EXISTING CUSTOMER
--------------------------------------------------

Allow operator to explicitly link an existing same-tenant Customer to the Conversation.

This must be server-authorized and tenant-safe.

Do not accept a customerId merely because the browser sends it.

Verify Customer belongs to authorized tenant.

If Conversation already has a Customer:

do NOT silently replace it.

Use the safest smallest behavior.

Preferred:

require an explicit change/relink action with clear confirmation.

Accidental clicks must not silently reassign conversation identity.

Document chosen behavior.

--------------------------------------------------
9. CUSTOMER UNLINK / RELINK
--------------------------------------------------

Audit whether unlinking Customer is already supported and whether other records depend on the relationship.

Do not introduce casual destructive unlinking.

If safe relinking is implemented:

- require explicit operator intent
- do not modify existing CustomerRequest ownership automatically
- do not rewrite historical Messages
- do not move Appointments
- do not move Vehicles between Customers

If the Conversation already has a CustomerRequest associated with Customer A and the operator tries to relink Conversation to Customer B:

STOP the operation unless existing domain logic can prove consistency.

Return a clear conflict rather than corrupting lifecycle relationships.

Example concept:

`Нельзя изменить клиента: связанное обращение принадлежит другому клиенту.`

Use actual domain relationships.

--------------------------------------------------
10. VEHICLE CONTEXT
--------------------------------------------------

Once Customer is known, show that Customer's existing Vehicles.

Operator must be able to:

- see existing vehicles
- choose the relevant vehicle for the current conversation/request context
- add a new vehicle if necessary

IMPORTANT:

First audit whether Conversation currently has a direct `vehicleId`.

Do NOT automatically add a new Conversation.vehicleId column.

If the current architecture already has a safe vehicle-context mechanism:
reuse it.

If Conversation does NOT have a vehicle relation:

determine whether vehicle selection should live only in the intake UI until a CustomerRequest is created, or whether an existing related entity already provides the canonical vehicle link.

Do not create a schema change just to make the UI convenient.

If you believe persistent Conversation→Vehicle linkage is necessary:

STOP before changing Prisma schema.

Explain:
- why existing CustomerRequest/Conversation architecture cannot represent it
- what minimal schema change would be needed
- what lifecycle consistency rules it introduces

Expected result is preferably NO schema change.

--------------------------------------------------
11. ADD VEHICLE
--------------------------------------------------

Allow adding a Vehicle for the linked Customer from Conversation Detail.

Reuse existing Vehicle create service/API/schema.

Do not duplicate Vehicle creation logic.

Use actual Vehicle fields.

Likely examples:
- make
- model
- year
- license plate
- VIN
- mileage

but only show/use fields that exist and make sense in current product.

Do not require unnecessary information merely for intake.

After creation:
- Vehicle belongs to linked Customer
- Vehicle belongs to same tenant
- UI refreshes immediately
- no Appointment is created
- no CustomerRequest is automatically created

--------------------------------------------------
12. VEHICLE DUPLICATE SAFETY
--------------------------------------------------

Audit existing uniqueness/duplicate rules.

If VIN or license plate has existing normalization/duplicate logic:
reuse it.

Do not invent unsafe identity heuristics.

If the operator attempts to create an obvious duplicate in the same tenant/customer and current domain rules can detect it reliably:

surface the existing Vehicle rather than silently duplicating.

Do not expose vehicles belonging to another tenant.

Do not automatically move a Vehicle from one Customer to another.

--------------------------------------------------
13. WHAT DOES “SELECT VEHICLE” MEAN?
--------------------------------------------------

Be precise here.

We need operational context, not fake persistence.

If Conversation has no vehicle relation and CustomerRequest is the canonical place where vehicle belongs:

then selecting a Vehicle in Conversation should NOT pretend the Conversation permanently owns that Vehicle.

Prefer one of:

A. show Customer's vehicles as context and allow vehicle selection only when creating/linking the CustomerRequest

OR

B. reuse an existing canonical relation if one already exists

Do not introduce hidden frontend-only state that appears persisted after reload when it is not.

The UI must truthfully represent what is stored.

Document the decision.

--------------------------------------------------
14. EXISTING CUSTOMERREQUEST CONSISTENCY
--------------------------------------------------

Prompt 49 already supports Conversation → CustomerRequest.

Audit interactions carefully.

If Conversation already has a linked CustomerRequest:

- display its Customer/Vehicle context consistently
- do not allow intake actions that contradict the linked request
- reuse CustomerRequest.customerId / vehicleId where canonical
- avoid duplicate/conflicting identity state

If Conversation has Customer A and linked CustomerRequest has Customer A:
normal.

If inconsistent legacy/test data exists:
surface safe warning/state rather than silently rewriting history.

Do not auto-fix unrelated production data.

--------------------------------------------------
15. AI CONTEXT INTEGRATION
--------------------------------------------------

Prompt 53 already uses the canonical AI context.

After Customer is linked, AI drafts should automatically receive the trusted Customer context through the existing mechanism.

Verify this end-to-end.

If Vehicle context can be derived canonically from the linked request/current architecture, include it through the canonical AI context.

Do not build a second Conversation-specific AI context.

Do not let AI infer stored Customer/Vehicle identity from raw text and treat that inference as trusted data.

Important distinction:

Conversation text:
`У меня Camry 2021`

is untrusted natural-language context.

Stored Vehicle:
`Toyota Camry, 2021`

is trusted domain context.

The AI may read both, but must not confuse inferred text with persisted identity.

--------------------------------------------------
16. NO AI EXTRACTION YET
--------------------------------------------------

Do NOT implement automatic extraction such as:

`Меня зовут Алексей, Camry 2021, телефон ...`

→ automatically create Customer
→ automatically create Vehicle

That belongs to a later prompt.

Do NOT add:
- LLM structured extraction
- regex auto-customer creation
- automatic vehicle parsing
- automatic Customer linking
- automatic Vehicle linking

Prompt 54 establishes the safe manual domain workflow first.

--------------------------------------------------
17. TELEGRAM IDENTITY
--------------------------------------------------

Audit what Telegram metadata is stored today:
- chat ID
- username
- display name
- phone if any

Do not assume Telegram provides a customer's phone number.

Do not use Telegram username as a unique Customer identity key unless the existing architecture explicitly supports that and its limitations are documented.

Telegram chat ID may identify the channel conversation, but it must not be treated as equivalent to a verified Customer phone number.

Do not add Telegram-specific fields to Customer schema in this prompt unless already present.

--------------------------------------------------
18. API DESIGN
--------------------------------------------------

Prefer focused endpoints/actions following existing conventions.

Possible conceptual actions:

- search Customers
- link Conversation to Customer
- create Customer + link Conversation
- list Customer Vehicles
- create Vehicle for linked Customer

But do NOT blindly create these exact routes.

Audit and reuse existing APIs first.

Only add endpoints where current APIs cannot safely express the workflow.

All mutations must:

1. authenticate
2. enforce authorized role
3. derive tenant server-side
4. verify Conversation ownership
5. verify Customer ownership
6. verify Vehicle ownership where applicable
7. preserve CustomerRequest consistency
8. return safe Russian-facing errors where relevant

--------------------------------------------------
19. TRANSACTION / CONCURRENCY SAFETY
--------------------------------------------------

Consider concurrent operator actions.

Examples:

Two tabs both try to create/link Customer.

Two operators both see unknown Customer and create at nearly the same time.

Do not overengineer distributed locking, but prevent obvious inconsistent states.

Where practical:
- transactionally create + link
- re-check current Conversation linkage before replacing
- detect duplicate normalized phone
- return conflict when state changed

Never silently overwrite another operator's newer identity decision.

--------------------------------------------------
20. UI — KEEP IT COMPACT
--------------------------------------------------

Conversation Detail already contains significant context.

Do NOT redesign the page.

Use compact progressive disclosure.

Recommended interaction:

Unknown state:

КЛИЕНТ И АВТОМОБИЛЬ
Клиент не определён

[Найти клиента] [Создать]

After Customer:

КЛИЕНТ
Алексей Смирнов
+7 ...

АВТОМОБИЛИ
Toyota Camry · 2021
Kia Rio · 2019

[Добавить автомобиль]

If current request identifies a canonical vehicle, make that clear.

Use existing graphite/gold design tokens.

No giant forms permanently occupying the sidebar.

Modal/sheet/popover may be used if consistent with existing UI components.

--------------------------------------------------
21. MOBILE
--------------------------------------------------

Conversation Detail must remain usable at 390px.

Validate:

- Customer section
- search
- create Customer
- vehicle list
- add Vehicle
- confirmation/conflict states

No horizontal overflow.

Do not shrink text to unreadable sizes.

--------------------------------------------------
22. ERROR STATES
--------------------------------------------------

Provide clear Russian operator errors.

Examples conceptually:

`Не удалось связать клиента.`

`Клиент с таким номером уже существует.`

`Этот клиент уже связан с другим контекстом обращения.`

`Не удалось добавить автомобиль.`

`Данные изменились. Обновите диалог и попробуйте ещё раз.`

Use actual project error conventions.

Do not expose:
- SQL
- Prisma internals
- stack traces
- tenant IDs
- internal IDs unnecessarily

--------------------------------------------------
23. SECURITY / TENANT ISOLATION
--------------------------------------------------

Add focused coverage proving:

- unauthenticated user cannot search/link/create
- Customer from another tenant cannot be linked
- Vehicle from another tenant cannot be exposed/used
- foreign Conversation cannot be mutated
- duplicate search never leaks another tenant's customer
- CustomerRequest consistency cannot be bypassed with crafted IDs
- role restrictions remain consistent with existing app policy

Do not trust browser-provided tenantId.

--------------------------------------------------
24. TESTS
--------------------------------------------------

Keep all 1562 existing tests passing.

Add focused tests where applicable.

At minimum cover:

CUSTOMER SEARCH
1. search same-tenant customer
2. foreign tenant never returned
3. normalized phone matching if supported

CUSTOMER CREATE/LINK
4. create Customer from Conversation
5. created Customer linked correctly
6. link existing Customer
7. foreign Customer rejected
8. foreign Conversation rejected
9. duplicate phone handled safely
10. existing Customer not silently replaced
11. concurrent/stale relink conflict handled

CUSTOMERREQUEST CONSISTENCY
12. matching linked request allowed
13. conflicting request/customer relationship rejected
14. Prompt 49.1 customerRequestId protection still passes

VEHICLE
15. list only linked Customer's Vehicles
16. create Vehicle for linked Customer
17. foreign Vehicle rejected/not exposed
18. vehicle cannot be moved between customers accidentally
19. duplicate VIN/plate behavior where current domain supports it

AI
20. linked Customer appears in Prompt 53 draft context
21. trusted Customer context remains tenant-safe
22. Vehicle context appears only where canonically available
23. draft still causes no mutation/send

REGRESSION
24. Conversation outbound send still works
25. Conversation → CustomerRequest still works
26. appointment lifecycle unaffected

Do not add a large frontend testing framework solely for this prompt.

--------------------------------------------------
25. MANUAL / BROWSER VALIDATION
--------------------------------------------------

Use test tenant/data only.

Scenario A — new customer:
- open unknown Telegram Conversation
- Customer section says unknown
- create Customer
- Conversation immediately shows Customer
- refresh page
- link persists

Scenario B — existing customer:
- search existing Customer
- select
- link
- refresh
- correct Customer remains

Scenario C — duplicate:
- attempt Customer create using existing same-tenant phone
- no duplicate created
- operator can select/link existing Customer

Scenario D — vehicle:
- linked Customer has existing Vehicle
- Vehicle appears
- add another Vehicle
- refresh
- Vehicle persists correctly

Scenario E — request consistency:
- Conversation with linked CustomerRequest
- attempt conflicting Customer relink
- operation safely rejected

Scenario F — Prompt 53:
- link Customer
- click `Предложить ответ AI`
- verify AI receives stored Customer context
- no send/mutation occurs from draft generation

Scenario G — mobile:
- 390px
- Customer/Vehicle intake usable
- no horizontal overflow

Do NOT message a real customer.

--------------------------------------------------
26. DO NOT ADD
--------------------------------------------------

Do NOT add:

- autonomous AI replies
- webhook → AI
- AI auto-send
- AI extraction of Customer
- AI extraction of Vehicle
- AI automatic Customer creation
- AI automatic Vehicle creation
- automatic CustomerRequest creation
- automatic Appointment creation
- automatic booking confirmation
- CRM integration
- CPBS integration
- email
- WhatsApp
- SMS
- retention campaigns
- payments
- billing
- technician scheduling
- bay entities
- voice transcription
- photo recognition
- launch-screen work
- landing-page work

--------------------------------------------------
27. DATABASE
--------------------------------------------------

Expected result:

NO Prisma schema change.
NO migration.

Reuse:
- Conversation
- Customer
- Vehicle
- CustomerRequest

If you determine that a schema change is required:

STOP BEFORE editing Prisma schema.

Explain:
1. exact missing relationship
2. why existing models cannot represent the workflow safely
3. proposed minimal schema change
4. migration impact
5. lifecycle invariants affected

Wait for approval.

--------------------------------------------------
28. QUALITY GATES
--------------------------------------------------

Run:

- full test suite
- TypeScript/typecheck
- build
- Prisma validate
- relevant lint/check scripts if present

Report exact results and test counts.

--------------------------------------------------
29. DOCUMENTATION
--------------------------------------------------

Follow existing project convention.

Create:

`docs/prompts/prompt-54.md`

and:

`docs/final-reports/final-report-54.md`

Document:
- existing relations reused
- duplicate strategy
- relink rules
- CustomerRequest consistency rules
- Vehicle-context persistence decision
- AI-context verification
- known remaining gaps

--------------------------------------------------
30. GIT
--------------------------------------------------

Before implementation:

verify:
- branch = master
- working tree clean
- HEAD = `929a6bc`
- origin/master = `929a6bc`

If baseline differs unexpectedly:
STOP and report.

After successful implementation and validation:

create ONE local commit:

`feat: add conversation customer intake`

Do NOT push automatically.

Do NOT force push.

--------------------------------------------------
31. REQUIRED FINAL REPORT
--------------------------------------------------

Return:

1. Audit findings
2. Existing models/relations reused
3. Conversation identity UX
4. Customer search behavior
5. Customer creation behavior
6. Phone normalization / duplicate behavior
7. Existing-Customer linking
8. Relink/unlink safety
9. CustomerRequest consistency
10. Vehicle workflow
11. Vehicle duplicate behavior
12. Vehicle-context persistence decision
13. AI context integration
14. Telegram identity findings
15. API changes
16. Transaction/concurrency behavior
17. Tenant isolation/security
18. Error behavior
19. Database/schema status
20. Tests:
    - baseline
    - added
    - final
21. TypeScript/build/Prisma results
22. Browser validation
23. 390px validation
24. Files changed
25. Commit hash
26. Git status
27. Remaining gaps explicitly NOT solved

--------------------------------------------------
32. STOP CONDITION
--------------------------------------------------

STOP after Prompt 54 is:

- implemented
- tested
- browser-validated
- documented
- committed locally

DO NOT PUSH.

DO NOT proceed to Prompt 55.

DO NOT enable autonomous AI.

Wait for review.
