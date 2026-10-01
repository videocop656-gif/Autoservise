# Prompt 55 — AI-Assisted Request Qualification

> Verbatim — reproduced exactly as provided in the development
> conversation for this project (not reconstructed, not paraphrased).

---

# PROMPT 55 — AI-ASSISTED REQUEST QUALIFICATION
## Turn a real Conversation into a reviewed, structured CustomerRequest without autonomous booking

You are working in the existing project `Autoservise`.

This prompt continues directly from Prompt 54.

Prompt 53 connected the existing AI administrator to real Conversations through safe editable AI reply drafts.

Prompt 54 added operator-controlled Customer + Vehicle intake directly inside Conversation Detail.

Prompt 55 now adds the next controlled layer:

REAL Conversation
→ AI analyzes what the customer needs
→ AI proposes structured request data
→ operator reviews/corrects it
→ operator explicitly creates or updates CustomerRequest

AI must NOT autonomously create a CustomerRequest or Appointment.

--------------------------------------------------
0. VERIFIED BASELINE
--------------------------------------------------

Repository:
- Project: Autoservise
- Branch: master
- Prompt 54 commit:
  `256641d feat: add conversation customer intake`
- Prompt 54 has been pushed to origin/master.
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

Roles:
- owner
- admin
- manager

Current test baseline:
- 1604 tests passing

Current operational lifecycle:

Telegram inbound
→ Conversation
→ Customer
→ Vehicle
→ CustomerRequest
→ Appointment
→ ServiceRecord
→ ServiceFollowUp

Existing Conversation capabilities:

- real Telegram inbound messages
- real operator outbound Telegram delivery
- Conversation Detail
- Prompt 49:
  Conversation → CustomerRequest bridge
- Prompt 49.1:
  protected CustomerRequest linkage
- Prompt 53:
  `Предложить ответ AI`
- Prompt 54:
  Customer + Vehicle intake

Existing AI capabilities:

- canonical AI administrator core
- current business-local date/time
- Business Hours
- Services
- prices/durations
- KnowledgeItem
- BusinessRule
- recent Conversation history
- trusted linked Customer context
- stored Customer Vehicles
- read-only availability in draft mode
- mutating booking tools blocked in draft mode

Prompt 54 architectural decisions:

- Conversation may be linked to Customer
- Vehicle is NOT persisted directly on Conversation
- Vehicle for a job remains canonical on CustomerRequest
- message text about identity/vehicle is unverified
- stored Customer/Vehicle data is trusted domain context
- CustomerRequest consistency must not be broken

--------------------------------------------------
1. OBJECTIVE
--------------------------------------------------

Add an AI-assisted qualification workflow to Conversation Detail.

The operator should be able to ask AI:

`Разобрать обращение`

The AI should analyze the real Conversation and propose a STRUCTURED qualification draft.

Conceptually:

Клиент:
Алексей Смирнов

Автомобиль:
Toyota Camry · 2021

Потребность:
Замена моторного масла

Услуга:
Замена масла

Пожелание по времени:
Завтра после 15:00

Не хватает:
— номер/госномер автомобиля, if genuinely required by current workflow
OR
— nothing

Confidence / uncertainty must be represented safely where useful.

The operator then reviews the proposed fields.

Only after explicit operator confirmation may existing CustomerRequest creation/update logic persist the data.

--------------------------------------------------
2. FIRST — AUDIT BEFORE IMPLEMENTATION
--------------------------------------------------

Before changing code, inspect the actual implementation.

Audit:

1. CustomerRequest Prisma model
2. CustomerRequest statuses
3. CustomerRequest required/optional fields
4. CustomerRequest repository/service
5. create/update API
6. Prompt 49 Conversation → CustomerRequest bridge
7. Prompt 49.1 linkage protection
8. Request Detail UI
9. existing Request create forms
10. Conversation Detail
11. Prompt 54 Customer/Vehicle intake
12. Conversation.customerId
13. CustomerRequest.customerId
14. CustomerRequest.vehicleId
15. CustomerRequest.serviceId
16. description / notes / source fields if present
17. any preferred-date/time fields if present
18. Service model
19. active/inactive Service semantics
20. AI provider abstraction
21. canonical AI context builder
22. Prompt 53 draft/read-only execution mode
23. AI tool schemas
24. existing structured-output utilities, if any
25. Zod schemas
26. relevant tests

Do not assume fields from this prompt exist.

Do not invent persistence fields merely because the conceptual UI contains them.

Briefly report audit findings before implementation.

--------------------------------------------------
3. CORE SAFETY PRINCIPLE
--------------------------------------------------

AI qualification is a PROPOSAL.

It is not trusted persisted business data.

Generating qualification must have ZERO business-domain mutation.

It must NOT:

- create CustomerRequest
- update CustomerRequest
- create Customer
- update Customer
- create Vehicle
- update Vehicle
- create Appointment
- reschedule Appointment
- cancel Appointment
- send Telegram
- create outbound Message
- create ChannelDelivery

The operator must explicitly confirm before any CustomerRequest mutation.

--------------------------------------------------
4. QUALIFICATION ACTION
--------------------------------------------------

Add an operator action in Conversation Detail:

`Разобрать обращение`

Use Russian UI.

Place it logically near the existing request/customer context.

Do not redesign the entire Conversation page.

When clicked:

Conversation
→ canonical AI analysis
→ structured qualification proposal
→ editable/reviewable UI

Suggested states:

IDLE:
`Разобрать обращение`

LOADING:
`AI анализирует обращение…`

SUCCESS:
structured proposal shown

ERROR:
`Не удалось разобрать обращение. Попробуйте ещё раз.`

Do not silently retry.

--------------------------------------------------
5. DO NOT DUPLICATE THE AI CORE
--------------------------------------------------

Reuse the canonical AI infrastructure introduced/used by Prompt 53.

Do not create:

- second provider abstraction
- second system prompt architecture
- duplicated Service context
- duplicated Knowledge context
- duplicated BusinessRule context
- duplicated date/time logic
- duplicated Business Hours logic

Qualification may require a specialized task/schema, but it must run through the same canonical AI infrastructure.

--------------------------------------------------
6. STRUCTURED OUTPUT
--------------------------------------------------

The qualification result must be structured and server-validated.

Do NOT parse arbitrary prose with fragile regex.

Prefer existing provider structured-output mechanisms if available.

Otherwise introduce the smallest provider-neutral structured response contract.

Validate AI output with Zod before returning it to the UI.

The exact structure must follow actual domain fields.

Conceptually it may include:

{
  customer: {
    linkedCustomerId?: string,
    confidence?: ...
  },

  vehicle: {
    matchedVehicleId?: string,
    mentionedMake?: string,
    mentionedModel?: string,
    mentionedYear?: number,
    confidence?: ...
  },

  service: {
    matchedServiceId?: string,
    mentionedNeed?: string,
    confidence?: ...
  },

  customerNeed: string,

  preferredTiming?: {
    rawText?: string,
    date?: string,
    partOfDay?: string,
    afterTime?: string,
    beforeTime?: string
  },

  missingInformation: string[],

  summary: string
}

THIS IS CONCEPTUAL ONLY.

Do not blindly implement these fields.

First map qualification to the existing CustomerRequest domain.

Do not add DB columns merely to persist AI analysis.

--------------------------------------------------
7. TRUST LEVELS
--------------------------------------------------

Preserve the distinction established in Prompt 54.

TRUSTED:
- linked Customer
- stored Vehicle
- configured Service
- existing CustomerRequest
- Business Hours
- persisted domain data

UNVERIFIED:
- names mentioned only in chat
- phone numbers mentioned only in chat
- vehicle make/model/year mentioned only in chat
- service interpretation from natural language
- timing preference inferred from natural language

AI may propose a match.

It must not present inferred data as persisted fact.

Example:

Customer writes:
`У меня Camry 2021`

If no stored Vehicle matches:

qualification may show:

`Из сообщения: Toyota Camry, 2021`

but must NOT show it as an already stored Vehicle.

--------------------------------------------------
8. CUSTOMER
--------------------------------------------------

If Conversation already has a linked Customer:

use that Customer as authoritative.

Do not let AI propose replacing the linked Customer.

If Conversation has NO linked Customer:

qualification may say:

`Клиент не определён`

and identify missing customer data.

But do NOT create or link Customer automatically.

Prompt 54 remains the operator-controlled identity workflow.

The UI should guide the operator back to the existing Customer intake action where necessary.

--------------------------------------------------
9. VEHICLE MATCHING
--------------------------------------------------

This is important.

The AI may use:
- stored vehicles of the linked Customer
- conversation text

If the conversation clearly refers to ONE existing stored Vehicle, AI may PROPOSE that vehicle.

But the operator must confirm the vehicle before CustomerRequest creation/update.

Do not persist AI vehicle match automatically.

If multiple stored Vehicles plausibly match:

show ambiguity.

Example:

`Нужно выбрать автомобиль`

Do not guess.

If the customer mentions a vehicle not stored in the system:

show it as unverified message-derived data and direct the operator to Prompt 54's existing `Добавить автомобиль` workflow.

Do not create Vehicle from qualification.

--------------------------------------------------
10. SERVICE MATCHING
--------------------------------------------------

AI may propose an existing active Service.

Examples:

Customer:
`Нужно масло поменять`

Possible proposed Service:
`Замена моторного масла`

Customer:
`При торможении что-то скрипит`

If no configured Service can be safely matched:

do NOT force a service.

Show:
`Услуга требует уточнения`

or equivalent.

Do not invent a Service.

Do not match inactive Service as bookable.

Operator must be able to change the proposed Service before confirmation.

Use existing Service IDs as persisted values.

Never persist arbitrary AI service names as if they were configured Services.

--------------------------------------------------
11. CUSTOMER NEED / DESCRIPTION
--------------------------------------------------

CustomerRequest already has an existing description/need representation.

Audit and reuse it.

AI may propose a concise factual summary of the customer's request.

Example:

Conversation:
`Добрый день. На Camry появился скрип при торможении, особенно утром. Хотел бы приехать завтра после работы.`

Possible description:

`Клиент сообщает о скрипе при торможении, сильнее утром.`

Do not add diagnosis:

BAD:
`Изношены тормозные колодки.`

unless that was explicitly stated as known fact.

AI must summarize symptoms/requests, not fabricate mechanical diagnosis.

--------------------------------------------------
12. TIMING PREFERENCE
--------------------------------------------------

Prompt 53 gave AI current business-local date/time.

Use it.

AI may interpret:

- сегодня
- завтра
- послезавтра
- в пятницу
- после 15
- утром
- после работы

But first audit whether CustomerRequest has canonical fields for timing preference.

If it does:
map safely.

If it does NOT:

do NOT add Prisma fields in Prompt 55.

Keep timing preference in the qualification proposal UI and/or existing description/notes only if that matches current domain conventions.

Do not create hidden persistence semantics.

Do not create Appointment merely because the customer expressed a preferred time.

--------------------------------------------------
13. MISSING INFORMATION
--------------------------------------------------

One of the most useful outputs is:

`Чего не хватает для следующего шага`

Examples:

- клиент ещё не связан
- автомобиль не выбран
- услуга требует уточнения
- клиент не указал подходящее время
- insufficient information required by existing booking flow

But do NOT invent requirements.

For example, if license plate is not required to create an Appointment, do not claim it is mandatory.

Derive missing information from the ACTUAL domain requirements.

--------------------------------------------------
14. OPERATOR REVIEW UI
--------------------------------------------------

After successful qualification, show a compact editable review surface.

Conceptually:

РАЗБОР ОБРАЩЕНИЯ

Клиент
[Алексей Смирнов ✓]

Автомобиль
[Toyota Camry · 2021 ▼]

Услуга
[Замена масла ▼]

Потребность
[editable text]

Пожелание по времени
[display/edit where domain permits]

Не хватает
[...]

Actions depend on existing state:

If no linked CustomerRequest:
`Создать обращение`

If Conversation already has linked CustomerRequest:
`Обновить обращение`

Do not create a second Request if one is already linked.

--------------------------------------------------
15. OPERATOR EDITABILITY
--------------------------------------------------

The operator must be able to correct AI before persistence.

At minimum where applicable:

- Vehicle
- Service
- request description

Customer identity should come from Prompt 54's trusted linked Customer, not a free-text AI field.

If timing is represented in existing CustomerRequest fields, allow correction there too.

Do not make the AI proposal read-only if it will become persisted data.

--------------------------------------------------
16. EXISTING CUSTOMERREQUEST — UPDATE, NOT DUPLICATE
--------------------------------------------------

If Conversation already has a linked CustomerRequest:

qualification must work against that existing Request.

Do not create another Request.

The operator may use qualification to propose safe updates to appropriate editable fields.

Do not silently change:
- Customer
- lifecycle history
- Appointment
- status
unless existing Request semantics explicitly require it.

Preserve Prompt 49/49.1 linkage invariants.

--------------------------------------------------
17. CREATE CUSTOMERREQUEST
--------------------------------------------------

If Conversation does NOT yet have a CustomerRequest:

operator may explicitly click:

`Создать обращение`

Use/reuse the existing canonical CustomerRequest creation service.

Do not implement a second Request creation path.

The operation must require the actual domain prerequisites.

Likely:
- linked Customer
- selected Vehicle if required
- selected Service if required

Use actual service validation.

After successful creation:

- link Request to Conversation using the existing protected bridge
- show linked Request in Conversation
- preserve lifecycle history
- do NOT create Appointment

Prefer atomic behavior using existing Prompt 49 bridge semantics.

--------------------------------------------------
18. REQUEST STATUS
--------------------------------------------------

Do not invent a new AI-specific CustomerRequest status.

Use existing statuses:

NEW
IN_PROGRESS
WAITING_CUSTOMER
QUALIFIED
CONVERTED
CLOSED
CANCELLED

Audit current transition rules.

Do not automatically mark a Request QUALIFIED merely because AI produced a qualification proposal.

AI analysis != business qualification.

If operator confirmation should transition status according to existing lifecycle semantics, only do so if already supported and clearly correct.

Otherwise leave status unchanged and document the decision.

--------------------------------------------------
19. AI DRAFT CONNECTION
--------------------------------------------------

Prompt 53's:

`Предложить ответ AI`

must continue working.

Do not replace it with qualification.

These are separate operator actions:

`Предложить ответ AI`
= help answer customer

`Разобрать обращение`
= help structure the business request

They may share the canonical AI core/context.

Do not make one automatically trigger the other.

--------------------------------------------------
20. FUTURE CUSTOMER QUESTION
--------------------------------------------------

The qualification result should make it easier for the operator to ask the next useful question.

OPTIONAL only if it fits existing architecture cleanly:

allow an action such as:

`Подготовить уточняющий ответ`

which feeds the known missing-information context into the EXISTING Prompt 53 draft workflow.

But:

- do NOT create a second composer
- do NOT auto-send
- do NOT build a new AI response engine

If this introduces meaningful complexity:
DO NOT implement it in Prompt 55.

Document it as a future improvement.

--------------------------------------------------
21. READ-ONLY AI TOOLS
--------------------------------------------------

Qualification should run in a safe non-mutating execution mode.

AI may read where needed:

- Services
- Customer
- Vehicles
- Business Hours
- Knowledge
- Rules

Availability should only be called if genuinely useful to qualification.

But qualification itself does not need to book anything.

Block all mutation tools:

- create Appointment
- reschedule Appointment
- cancel Appointment
- create Customer
- create Vehicle
- create CustomerRequest
- Telegram send
- delivery creation

Server-side gate remains mandatory.

Do not rely only on prompt instructions.

--------------------------------------------------
22. PROVIDER / MOCK
--------------------------------------------------

Preserve the provider abstraction.

Tests must not require live OpenAI.

Extend the mock provider only as necessary to exercise structured qualification.

Do not make the mock artificially bypass validation.

The mock response should use the same Zod contract as a real provider response.

Do not add API keys.

Do not modify `.env`.

--------------------------------------------------
23. STRUCTURED OUTPUT FAILURE
--------------------------------------------------

Treat malformed AI structured output safely.

If provider returns:

- invalid JSON
- unknown Service ID
- foreign Vehicle ID
- foreign Customer ID
- impossible date
- invalid enum
- malformed shape

do NOT pass it through to the UI as trusted data.

Validate and sanitize/reject server-side.

Never allow model-provided IDs to bypass tenant checks.

Where safe:
drop invalid proposed match and mark it unresolved.

Otherwise return a safe error.

--------------------------------------------------
24. TENANT ISOLATION
--------------------------------------------------

Critical.

AI-proposed IDs are UNTRUSTED INPUT.

Even if the AI provider returns a UUID:

verify it server-side.

Prove:

- Service belongs to tenant/business
- Vehicle belongs to linked Customer and tenant
- Customer comes from Conversation, not model authority
- CustomerRequest belongs to tenant
- Conversation belongs to tenant

Never allow cross-tenant model hallucinations to resolve to data.

--------------------------------------------------
25. STALE DATA / CONCURRENCY
--------------------------------------------------

Consider:

AI analyzes Conversation.

While analysis is running:
- operator links a different Customer
- another operator creates a Request
- Service becomes inactive
- Request changes

The qualification proposal is a snapshot, not authority.

Before persistence:

revalidate all selected IDs and current Conversation/Request state.

Do not overwrite newer changes silently.

If state changed materially:

return a clear conflict such as:

`Данные обращения изменились. Обновите разбор и проверьте его ещё раз.`

Use existing error conventions.

--------------------------------------------------
26. NO SCHEMA CHANGE EXPECTED
--------------------------------------------------

Expected:

NO Prisma schema change.
NO migration.

Qualification proposal should remain transient UI/server response state until operator confirmation maps it into existing CustomerRequest fields.

If you believe a schema change is required:

STOP BEFORE changing Prisma.

Explain:
1. missing field/relation
2. why existing CustomerRequest cannot represent the needed state
3. minimal proposed schema
4. migration impact
5. lifecycle consequences

Wait for approval.

--------------------------------------------------
27. UI DESIGN
--------------------------------------------------

Use existing graphite/gold design system.

Do not redesign Conversation Detail.

Qualification should feel operational, not like a chatbot.

Prefer:
- compact cards
- labels
- select fields
- badges for missing/unverified data
- existing shadcn components

Avoid:
- giant AI gradient panels
- robot icons
- neon effects
- excessive animation

AI is a workflow capability, not a visual gimmick.

--------------------------------------------------
28. MOBILE
--------------------------------------------------

Validate at 390px.

Qualification panel must remain usable.

If the existing Conversation Detail uses a narrow/right panel on desktop, adapt appropriately on mobile using existing responsive patterns.

No horizontal overflow.

Selectors and buttons must remain tappable.

--------------------------------------------------
29. TESTS
--------------------------------------------------

Keep all 1604 existing tests passing.

Add focused tests.

AI QUALIFICATION:
1. authorized qualification succeeds
2. unauthenticated rejected
3. foreign Conversation rejected
4. latest/recent Conversation context used
5. linked Customer treated as authoritative
6. stored Vehicles supplied as trusted context
7. raw vehicle mention remains unverified
8. active Service may be proposed
9. inactive Service cannot become valid match
10. ambiguous/no Service handled safely
11. description summarizes request without invented diagnosis
12. business-local relative date context works

STRUCTURED OUTPUT:
13. schema-valid output accepted
14. malformed output rejected safely
15. hallucinated Service ID rejected
16. foreign Service ID rejected
17. foreign Vehicle ID rejected
18. Vehicle not owned by linked Customer rejected
19. invalid date/timing sanitized/rejected
20. model cannot replace linked Customer

NO SIDE EFFECTS:
21. qualification creates no CustomerRequest
22. qualification creates no Appointment
23. qualification sends no Telegram
24. qualification creates no outbound Message
25. qualification creates no ChannelDelivery
26. mutating tools blocked server-side

PERSISTENCE:
27. operator-confirmed create uses canonical CustomerRequest service
28. Request linked to Conversation correctly
29. existing linked Request updated rather than duplicated
30. foreign IDs rejected at confirmation
31. stale state conflict handled
32. no automatic Appointment created
33. Prompt 49.1 protections remain intact

REGRESSION:
34. Prompt 53 AI draft still works
35. Prompt 54 Customer intake still works
36. existing Request lifecycle tests pass
37. Appointment lifecycle unaffected

Add more focused tests if actual architecture reveals important invariants.

--------------------------------------------------
30. MANUAL / BROWSER VALIDATION
--------------------------------------------------

Use test tenant/data only.

Scenario A — complete known context:

- Conversation linked to Customer
- Customer has stored Vehicle
- customer asks for configured Service
- click `Разобрать обращение`
- AI proposes correct Vehicle/Service/description
- nothing persisted yet
- operator confirms
- CustomerRequest created and linked
- no Appointment created

Scenario B — unknown vehicle:

Customer says:
`У меня Camry 2021`

but no stored Vehicle exists.

Expected:
- message-derived vehicle shown as unverified
- no Vehicle automatically created
- operator directed to existing add-Vehicle workflow

Scenario C — ambiguous service:

Customer:
`Что-то стучит спереди`

Expected:
- no fabricated diagnosis
- Service remains unresolved where appropriate
- missing/clarification state shown

Scenario D — existing Request:

- Conversation already linked to Request
- run qualification
- edit proposal
- confirm
- existing Request updated
- no duplicate Request

Scenario E — malformed/hallucinated AI data:
- use mock/test path
- invalid Service/Vehicle ID cannot be persisted

Scenario F — Prompt 53 regression:
- `Предложить ответ AI`
- editable draft still works
- no mutation/send until operator sends

Scenario G — mobile:
- 390px
- qualification usable
- no horizontal overflow

Do NOT message a real customer.

--------------------------------------------------
31. TEST DATA
--------------------------------------------------

Use only clearly marked test tenant/test records.

Do not alter real tenant data.

If browser validation leaves test data:

list exactly what remains.

Deactivate any temporary mock channel connections after validation.

Do not perform broad destructive cleanup.

--------------------------------------------------
32. DO NOT ADD
--------------------------------------------------

Do NOT add:

- autonomous AI replies
- webhook → AI
- automatic Customer creation
- automatic Vehicle creation
- automatic Customer linking
- automatic CustomerRequest creation
- automatic Appointment creation
- automatic booking confirmation
- automatic Telegram sending
- autonomous human handoff
- CRM
- CPBS
- WhatsApp
- SMS
- email
- billing
- payments
- technician scheduling
- physical bay entities
- voice transcription
- photo understanding
- launch screen changes
- landing page work

--------------------------------------------------
33. QUALITY GATES
--------------------------------------------------

Run:

- full test suite
- TypeScript/typecheck
- build
- Prisma validate
- relevant lint/check scripts if present

All must pass.

Report exact counts.

--------------------------------------------------
34. DOCUMENTATION
--------------------------------------------------

Follow existing project convention.

Create:

`docs/prompts/prompt-55.md`

and:

`docs/final-reports/final-report-55.md`

Document:

- structured qualification contract
- trusted vs unverified data
- Service matching rules
- Vehicle matching rules
- timing representation decision
- CustomerRequest create/update behavior
- stale-state behavior
- AI execution safety
- remaining gaps

--------------------------------------------------
35. GIT
--------------------------------------------------

Before work verify:

- branch = master
- clean working tree
- HEAD = `256641d`
- origin/master = `256641d`

If baseline differs unexpectedly:
STOP and report.

After successful implementation and validation:

create ONE local commit:

`feat: add ai request qualification`

Do NOT push automatically.

Do NOT force push.

--------------------------------------------------
36. REQUIRED FINAL REPORT
--------------------------------------------------

Return:

1. Audit findings
2. CustomerRequest domain mapping
3. Structured qualification contract
4. Trusted vs unverified data handling
5. Customer behavior
6. Vehicle matching behavior
7. Service matching behavior
8. Description/need summarization
9. Timing preference handling
10. Missing-information logic
11. Conversation qualification UX
12. Operator edit/review behavior
13. New Request creation behavior
14. Existing Request update behavior
15. Request status behavior
16. AI core reuse
17. AI execution safety / blocked tools
18. Structured-output validation
19. Hallucinated-ID protection
20. Stale/concurrent-state behavior
21. Tenant isolation/security
22. Database/schema status
23. Tests:
    - baseline
    - added
    - final
24. TypeScript/build/Prisma results
25. Browser validation
26. 390px validation
27. Test data left behind
28. Files changed
29. Commit hash
30. Git status
31. Remaining gaps explicitly NOT solved

--------------------------------------------------
37. STOP CONDITION
--------------------------------------------------

STOP after Prompt 55 is:

- implemented
- tested
- browser-validated
- documented
- committed locally

DO NOT PUSH.

DO NOT proceed to Prompt 56.

DO NOT enable autonomous AI.

Wait for review.
