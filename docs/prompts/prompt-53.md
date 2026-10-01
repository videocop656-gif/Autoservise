# Prompt 53 — AI Reply Draft in Conversation

> Verbatim — reproduced exactly as provided in the development
> conversation for this project (not reconstructed, not paraphrased).

---

# PROMPT 53 — AI REPLY DRAFT IN CONVERSATION
## Human-in-the-loop AI copilot for real Telegram conversations

You are working in the existing project `Autoservise`.

This prompt implements the first controlled connection between a REAL inbound Conversation and the EXISTING AI administrator.

The AI must NOT autonomously send messages.

The operator remains responsible for reviewing/editing the draft and pressing the existing Send action.

Do not expand scope beyond this human-in-the-loop workflow.

--------------------------------------------------
0. VERIFIED BASELINE
--------------------------------------------------

Repository:
- Project: Autoservise
- Branch: master
- Prompt 51:
  `da1cce0 feat: add booking availability ux`
- Prompt 52 audit documentation:
  `5f0c247 docs: add ai administrator mvp readiness audit`
- Both have been pushed to origin/master.
- Repository was clean and synchronized after Prompt 52.

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
- 1515 tests passing

Current operational lifecycle:

Telegram inbound
→ Conversation
→ Message
→ operator
→ CustomerRequest
→ Appointment
→ ServiceRecord
→ ServiceFollowUp

Current AI status from Prompt 52 audit:

- Telegram inbound is real and persisted.
- Telegram webhook does NOT invoke AI.
- AI currently runs only from the separate AI administrator/operator flow.
- Existing AI core can see:
  - Services
  - prices
  - durations
  - KnowledgeItem
  - BusinessRule
  - known Customer context
- Existing AI tools are real.
- Existing AI availability/booking uses authoritative booking logic.
- Existing AI can create escalation.
- AI output is currently NOT saved as a Message.
- AI output is currently NOT sent to Telegram.
- operator outbound Telegram sending already works.
- outbound staff delivery has duplicate-send protection.

Prompt 52 also identified:
- current date is missing from AI context
- working hours are missing from AI context
- new Telegram customers are not automatically created/linked
- AI cannot create Customer/Vehicle/CustomerRequest
- AI is intentionally disconnected from inbound webhook
- autonomous AI sending does not exist

THIS PROMPT MUST NOT CHANGE THOSE AUTONOMY BOUNDARIES.

--------------------------------------------------
1. OBJECTIVE
--------------------------------------------------

Add a human-in-the-loop action to Conversation Detail:

`Предложить ответ AI`

Workflow:

REAL inbound Telegram message
→ stored Conversation
→ operator opens Conversation Detail
→ operator clicks `Предложить ответ AI`
→ server runs the EXISTING AI analysis against the REAL conversation context
→ AI returns a proposed reply
→ proposed reply appears as an EDITABLE draft in the EXISTING message composer
→ operator can edit it
→ operator presses the EXISTING Send button
→ existing staff outbound delivery sends it normally

CRITICAL:

The AI draft itself must NOT send anything.

Generating a draft must have ZERO customer-visible side effects.

--------------------------------------------------
2. FIRST — AUDIT BEFORE IMPLEMENTATION
--------------------------------------------------

Before changing code, inspect the actual implementation.

Audit:

1. Conversation Detail UI
2. existing message composer
3. existing Send action
4. Conversation/message API
5. operator outbound Telegram delivery
6. current AI administrator page
7. existing `analyzeMessage` or equivalent AI service
8. AI provider abstraction
9. AI prompt/context builder
10. AI tools
11. escalation tool
12. Services context
13. KnowledgeItem context
14. BusinessRule context
15. Business Hours model/service
16. business timezone utilities
17. Conversation history retrieval
18. current Customer context
19. authentication/role/tenant middleware
20. relevant tests

Do not assume names from this prompt.

Use actual project architecture.

Briefly report audit findings before implementation.

--------------------------------------------------
3. REUSE THE EXISTING AI CORE
--------------------------------------------------

Do NOT create a second AI implementation.

The Conversation draft action must reuse the existing canonical AI analysis service.

If the current AI administrator page uses something equivalent to:

`analyzeMessage(...)`

reuse/refactor that shared service.

Do not duplicate:

- system prompt
- tool definitions
- service context
- knowledge context
- rules context
- availability tools
- booking tools
- escalation behavior

There must remain one canonical AI administrator core.

--------------------------------------------------
4. REAL CONVERSATION CONTEXT
--------------------------------------------------

The AI draft must be generated from the actual Conversation.

At minimum provide:

- latest inbound customer message
- relevant recent conversation history
- business identity/context already supported
- known Customer context if linked
- existing Service context
- KnowledgeItem context
- BusinessRule context
- current date in BUSINESS timezone
- current business working hours

Do NOT require the operator to manually copy/paste the customer's message into the AI page.

That is the main product improvement of this prompt.

--------------------------------------------------
5. CURRENT DATE — REQUIRED
--------------------------------------------------

Prompt 52 found that the AI does not know the current date.

Fix this in the canonical AI context, not only in the Conversation UI.

Provide the AI with the CURRENT LOCAL DATE for the business.

Use the existing business timezone.

Do NOT use:
- browser timezone
- server timezone
- hard-coded Moscow
- hard-coded Kazakhstan timezone

The AI should receive enough explicit context to interpret phrases such as:

- сегодня
- завтра
- послезавтра
- в пятницу
- на следующей неделе

Example conceptual context:

`Текущая дата по часовому поясу автосервиса: 2026-10-01.`

Use the project's actual context-building conventions.

Add tests around timezone-sensitive date generation.

--------------------------------------------------
6. BUSINESS HOURS — REQUIRED
--------------------------------------------------

Prompt 52 found that working hours are not supplied to the AI.

Add the current business's configured working hours to the canonical AI context.

The AI should be able to answer questions such as:

`До скольки вы сегодня работаете?`

without requiring a manually written KnowledgeItem.

Include:
- day-of-week schedule
- closed days
- relevant business timezone context

Do not hard-code working hours.

Reuse the existing Business Hours domain/service.

Do not create a second working-hours configuration.

--------------------------------------------------
7. CONVERSATION HISTORY
--------------------------------------------------

Audit how much history the existing AI receives.

For Conversation draft generation, provide enough recent history for multi-turn context.

Example:

Customer:
`Сколько стоит замена масла?`

Operator:
`От 5 000 ₽.`

Customer:
`А завтра после 15 можно?`

The AI must understand what the newest message refers to.

Do not send unlimited conversation history blindly.

Use a bounded/reasonable recent-history strategy consistent with the current architecture.

Preserve chronological ordering.

Clearly distinguish:
- customer messages
- staff/operator messages

Do not invent an AI Message sender type in this prompt.

--------------------------------------------------
8. BUTTON — CONVERSATION DETAIL
--------------------------------------------------

Add an operator action:

`Предложить ответ AI`

Place it logically near the existing composer.

Use existing UI patterns and the current graphite/gold design system.

The action should be available only where generating a reply makes operational sense.

At minimum:
- Conversation must exist
- operator must be authorized
- there should be customer/inbound content to answer

Do not redesign Conversation Detail.

Do not create a new page.

--------------------------------------------------
9. DRAFT GENERATION UX
--------------------------------------------------

When the operator clicks:

`Предложить ответ AI`

show a clear loading state, e.g.:

`AI готовит ответ…`

Prevent accidental duplicate generation while the request is already running.

When generation succeeds:

- place the proposed reply into the EXISTING composer
- it must remain ordinary editable text
- operator can freely edit/delete/replace it
- operator sends it using the EXISTING Send button

Do NOT auto-send after generation.

Do NOT create a countdown auto-send.

Do NOT hide the draft behind another modal unless the existing UI architecture clearly requires it.

Preferred behavior:
AI fills the existing composer directly.

--------------------------------------------------
10. EXISTING COMPOSER CONTENT
--------------------------------------------------

Protect operator-written text.

If the composer already contains non-empty text when the operator clicks:

`Предложить ответ AI`

do NOT silently overwrite it.

Choose the smallest coherent UX consistent with the current application.

Acceptable patterns include:
- disable AI generation while unsent text exists, with a clear explanation
OR
- explicit confirmation before replacing

Prefer the simpler, safer implementation.

Document the decision.

--------------------------------------------------
11. NO AI MESSAGE PERSISTENCE YET
--------------------------------------------------

Prompt 52 found there is no AI sender type in the Message schema.

Do NOT change Message schema for Prompt 53.

Do NOT persist the generated draft as a sent Message.

The AI draft exists only as operator-side draft state until the operator presses Send.

Once Send is pressed:

the message follows the EXISTING staff/operator message path exactly as before.

This preserves the current sender/delivery model.

--------------------------------------------------
12. NO AUTONOMOUS DELIVERY
--------------------------------------------------

Absolutely prohibited in this prompt:

Telegram webhook
→ AI
→ automatic customer response

Do NOT connect AI directly to webhook.

Do NOT call outbound Telegram delivery from the draft-generation endpoint.

Do NOT automatically create a ChannelDelivery.

Do NOT automatically create an outbound Message.

Only the existing operator Send action may perform delivery.

--------------------------------------------------
13. AI SIDE EFFECTS / TOOLS
--------------------------------------------------

This is important.

The existing AI core may expose tools with side effects, including:
- appointment creation
- escalation creation
- possibly other domain mutations

For a "reply suggestion" action, audit whether calling the existing AI analysis can cause domain side effects.

The draft-generation action MUST NOT unexpectedly create an Appointment merely because an operator asked for a suggested reply.

Preferred safety model:

Introduce/reuse an AI execution mode equivalent to:

`draft` / `advisory` / `read-only`

where the AI may use READ-ONLY tools needed to answer accurately, such as:
- service lookup
- availability lookup
- business information

but cannot perform customer-visible/domain-mutating actions such as:
- creating Appointment
- changing Appointment
- creating Customer
- creating Vehicle
- creating CustomerRequest
- sending Telegram message

ESCALATION:
Audit existing semantics carefully.

If escalation creation is itself a useful operator-side AI safety action and existing architecture expects it during analysis, preserve it only if doing so is intentional and clearly documented.

Otherwise, for a pure draft action, prefer no hidden mutation.

Do not make a broad AI architecture rewrite.

Implement the smallest safe execution-mode boundary.

--------------------------------------------------
14. AVAILABILITY IN DRAFT MODE
--------------------------------------------------

The AI should still be able to answer:

`Можно завтра после обеда?`

where enough context exists.

It may use the existing READ-ONLY availability tool.

It must reuse the same canonical availability logic from Prompts 50–51:

- Business Hours
- service duration
- serviceBayCapacity
- vehicle conflict
- existing appointments
- business timezone

Do NOT duplicate availability calculations in the AI layer.

If required information is missing, the AI should ask the customer for the missing information in its proposed reply rather than inventing availability.

--------------------------------------------------
15. UNKNOWN CUSTOMER / VEHICLE
--------------------------------------------------

Prompt 52 found that AI cannot currently create Customer/Vehicle/CustomerRequest.

Do NOT solve that in Prompt 53.

For an unknown Telegram user or missing vehicle information, the draft should naturally ask for the required information where appropriate.

Example:

`Подскажите, пожалуйста, марку, модель и год автомобиля.`

Do not fabricate a Customer or Vehicle.

Do not create them automatically.

That domain automation belongs to a later prompt.

--------------------------------------------------
16. SERVICE IDENTIFICATION
--------------------------------------------------

Do not build a new semantic service-matching system in Prompt 53.

Reuse existing AI context/tools.

If AI cannot reliably identify the service, the proposed reply should clarify the customer's need.

Do not automatically select a Service by unsafe fuzzy matching.

--------------------------------------------------
17. ESCALATION / HUMAN REQUEST
--------------------------------------------------

Prompt 52 found:

`Позовите администратора`

does not currently automatically create a handoff from Telegram inbound.

Do NOT implement autonomous inbound handoff in this prompt.

However, when generating a suggested reply, the AI must not tell the customer that escalation functionality "doesn't exist" if the current system already has AiEscalation.

Audit and correct the stale system-prompt statement identified in Prompt 52.

Keep wording consistent with actual capabilities.

Do not expand escalation workflow beyond what is necessary for truthful AI context.

--------------------------------------------------
18. API
--------------------------------------------------

Prefer a focused endpoint using existing conventions, conceptually similar to:

POST /api/conversations/:id/ai-draft

but DO NOT blindly use this path.

First inspect route conventions.

The endpoint should:

1. authenticate operator
2. enforce role
3. derive tenant server-side
4. load Conversation tenant-safely
5. load relevant recent messages
6. load business AI context
7. execute AI in safe draft mode
8. return proposed reply text
9. perform NO outbound send

Possible response concept:

{
  "draft": "..."
}

Use actual project response conventions.

Do not expose:
- provider secrets
- raw system prompts
- internal tool traces
- stack traces

--------------------------------------------------
19. AUTHORIZATION / TENANT ISOLATION
--------------------------------------------------

Verify:

- unauthenticated request rejected
- Conversation from another tenant inaccessible
- Business context always comes from authorized tenant
- Customer context cannot cross tenant
- Service context cannot cross tenant
- KnowledgeItem cannot cross tenant
- BusinessRule cannot cross tenant
- Business Hours cannot cross tenant

Do not accept tenantId from client as authority.

Add focused tests.

--------------------------------------------------
20. AI PROVIDER FAILURE
--------------------------------------------------

Handle AI provider failure gracefully.

The operator should see a concise Russian error, e.g.:

`Не удалось подготовить ответ AI. Попробуйте ещё раз.`

Do not:
- clear existing composer content
- send anything
- create fake draft
- expose raw provider errors

Retry should remain manual.

Do not build background retry infrastructure.

--------------------------------------------------
21. MOCK PROVIDER / LOCAL DEVELOPMENT
--------------------------------------------------

Prompt 52 found local `.env` currently has no real OpenAI key and therefore uses the project's mock provider.

Preserve existing provider abstraction.

Tests must not require a live paid AI call.

Browser validation may use the mock provider where that is the configured local environment.

Do NOT insert API keys.

Do NOT modify secrets.

Do NOT modify `.env` unless absolutely required; expected outcome is no `.env` change.

--------------------------------------------------
22. UI STATES
--------------------------------------------------

At minimum support:

IDLE:
`Предложить ответ AI`

LOADING:
`AI готовит ответ…`

SUCCESS:
draft appears in existing composer

ERROR:
clear Russian retryable error

EXISTING COMPOSER TEXT:
must not be silently overwritten

Use accessible button state.

Avoid layout shift where practical.

No horizontal overflow at 390px.

--------------------------------------------------
23. TESTS
--------------------------------------------------

Keep all 1515 existing tests passing.

Add focused tests for applicable behavior.

Backend/API tests should cover:

1. authorized draft generation
2. unauthenticated rejection
3. foreign-tenant Conversation rejected
4. Conversation context loaded tenant-safely
5. latest/recent history included correctly
6. current business-local date included
7. Business Hours included
8. Knowledge/Rules/Services still included
9. draft mode does not send Telegram message
10. draft mode does not create outbound Message
11. draft mode does not create ChannelDelivery
12. mutating booking tool unavailable/blocked in draft mode
13. read-only availability remains usable
14. AI provider failure returns safe API error
15. empty/no-answerable conversation handled correctly
16. stale "escalation doesn't exist" instruction removed/corrected

Frontend/pure tests where practical:

17. non-empty composer protection
18. generated draft populates composer
19. stale async response cannot overwrite newer operator text, if relevant to implementation
20. error preserves existing composer state

Do not introduce a large component-testing framework solely for Prompt 53.

Use existing Vitest/pure-function testing where appropriate.

--------------------------------------------------
24. MANUAL / BROWSER VALIDATION
--------------------------------------------------

Validate against the real existing Conversation UI.

Use test tenant/data only.

Scenario A:
- open Conversation with inbound Telegram text
- click `Предложить ответ AI`
- loading state appears
- mock/AI draft appears in composer
- edit draft manually
- DO NOT send during the first validation
- verify no outbound Message/ChannelDelivery was created merely by generating draft

Scenario B:
- generate draft
- operator presses existing Send
- verify existing staff send path is used
- where mock Telegram adapter is active, verify expected local/mock delivery behavior

Scenario C:
- composer already contains operator text
- click/attempt AI suggestion
- verify text is not silently overwritten

Scenario D:
- simulate provider error where existing test/dev architecture permits
- verify safe Russian error
- verify nothing is sent

Scenario E:
- narrow viewport 390px
- button/composer usable
- no horizontal overflow

Scenario F:
- verify business date/timezone context
- verify configured Business Hours appear in AI context through test instrumentation or existing mock provider where practical

Do NOT message a real customer.

--------------------------------------------------
25. DO NOT ADD
--------------------------------------------------

Do NOT add:

- autonomous AI replies
- webhook → AI invocation
- AI Message sender enum
- automatic outbound Message creation
- automatic Telegram sending
- Customer auto-creation
- Vehicle auto-creation
- CustomerRequest auto-creation
- semantic service search redesign
- technician scheduling
- individual bay entities
- CRM
- CPBS
- email
- WhatsApp
- SMS
- billing
- payments
- retention campaigns
- voice transcription
- photo understanding
- new launch screen
- mobile video integration
- unrelated dashboard work

--------------------------------------------------
26. DATABASE
--------------------------------------------------

Expected result:

NO Prisma schema change.
NO migration.

If you believe a schema change is required:

STOP BEFORE creating it.

Explain why.

The desired draft workflow should use frontend draft state and existing domain models.

--------------------------------------------------
27. QUALITY GATES
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
28. DOCUMENTATION
--------------------------------------------------

Follow existing convention.

Create:

`docs/prompts/prompt-53.md`

and:

`docs/final-reports/final-report-53.md`

Use existing documentation style.

--------------------------------------------------
29. GIT
--------------------------------------------------

Before work:

- verify `master`
- verify clean working tree
- verify synchronized Prompt 52 baseline

If unexpectedly dirty:
STOP and report.

After successful implementation and validation:

create ONE commit with a concise message such as:

`feat: add ai reply drafts to conversations`

Do NOT push automatically.

Do NOT force push.

Leave the commit local for review.

--------------------------------------------------
30. REQUIRED FINAL REPORT
--------------------------------------------------

Return:

1. Audit findings
2. Implementation summary
3. Conversation UX
4. AI core reuse
5. Draft execution safety model
6. Current-date context
7. Business-hours context
8. Conversation-history behavior
9. Availability behavior in draft mode
10. Mutating tools blocked/preserved
11. Escalation prompt correction
12. API contract
13. Tenant isolation/security
14. AI provider failure behavior
15. Composer overwrite protection
16. Database/schema status
17. Tests:
    - baseline
    - new count
    - final count
18. TypeScript/build/Prisma results
19. Browser validation
20. Mobile 390px validation
21. Files changed
22. Commit hash
23. Git status
24. Remaining gaps explicitly not solved

--------------------------------------------------
31. STOP CONDITION
--------------------------------------------------

STOP after Prompt 53 is:

- implemented
- tested
- browser-validated
- documented
- committed locally

DO NOT PUSH.

DO NOT proceed to Prompt 54.

DO NOT enable autonomous AI.

Wait for review.
