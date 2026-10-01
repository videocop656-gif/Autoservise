# Prompt 52 — AI Administrator MVP Readiness Audit

> Verbatim — reproduced exactly as provided in the development
> conversation for this project (not reconstructed, not paraphrased).

---

# PROMPT 52 — AI ADMINISTRATOR MVP READINESS AUDIT
## End-to-end audit: Telegram message → safe real appointment

You are working in the existing project `Autoservise`.

This is an AUDIT-ONLY prompt.

DO NOT implement features.
DO NOT modify application code.
DO NOT create Prisma migrations.
DO NOT refactor.
DO NOT "fix while auditing".
DO NOT install dependencies.
DO NOT create speculative architecture.

Your job is to inspect the actual repository and determine how close the current system is to a real MVP in which an AI administrator can take a customer's inbound Telegram conversation and safely move it toward a real service appointment.

--------------------------------------------------
0. VERIFIED BASELINE
--------------------------------------------------

Repository:
- Project: Autoservise
- Branch: master
- Latest completed milestone:
  Prompt 51 — Booking Availability UX
- Prompt 51 commit:
  `da1cce0 feat: add booking availability ux`
- `da1cce0` has been pushed to origin/master.
- Working tree was clean after push.

Current stack:
- React + TypeScript + Vite
- Tailwind
- shadcn/ui
- lucide-react
- Vercel-compatible Node/TypeScript REST API
- PostgreSQL / Supabase
- Prisma
- Zod
- Vitest
- custom authentication
- Argon2id
- HttpOnly server-side sessions
- multi-tenant architecture
- roles:
  - owner
  - admin
  - manager

Current domain lifecycle:

Customer
→ CustomerRequest
→ Appointment
→ Service
→ ServiceRecord
→ Service History
→ ServiceFollowUp

Important completed foundations:

Prompt 48:
- structured ServiceFollowUp / retention loop

Prompt 49:
- Conversation → CustomerRequest bridge

Prompt 49.1:
- protected Conversation.customerRequestId linkage

Prompt 50:
- Service Capacity Foundation
- Business.serviceBayCapacity
- race-safe capacity checks
- vehicle conflicts
- business-row locking
- server availability foundation

Prompt 51:
- Booking Availability UX
- server-calculated free slots
- create appointment slot picker
- request → appointment slot picker
- reschedule slot picker
- business hours
- service duration
- service-bay capacity
- vehicle conflict
- business timezone
- stale-slot handling
- final transactional 409 protection

Prompt 51 baseline:
- 1515 tests passing
- TypeScript PASS
- build PASS
- Prisma validate PASS
- no schema migration
- browser validation PASS
- mobile 390px PASS

--------------------------------------------------
1. PRIMARY QUESTION
--------------------------------------------------

Answer this question from the ACTUAL CODE:

If a real auto-service business is connected today and a customer sends a Telegram message such as:

"Здравствуйте. Нужно поменять передние тормозные колодки на Kia Rio. Можно завтра после обеда?"

how far can the current AI administrator ACTUALLY take that customer without an operator manually performing the next domain action?

Audit the full path:

Telegram inbound
→ Conversation
→ Message persistence
→ AI invocation
→ intent/context extraction
→ Customer identification/creation
→ Vehicle identification/creation
→ CustomerRequest creation/linking
→ Service identification
→ business knowledge/rules
→ availability lookup
→ capacity-aware slot proposal
→ customer slot confirmation
→ Appointment creation
→ confirmation response
→ escalation/operator handoff

Do not infer functionality from filenames, comments, TODOs, docs, or planned architecture.

Trace executable code.

--------------------------------------------------
2. FIRST: VERIFY REPOSITORY STATE
--------------------------------------------------

Before auditing:

- run `git status`
- verify branch = `master`
- verify latest Prompt 51 baseline is present
- verify working tree is clean

If the repository is unexpectedly dirty:

STOP.

Report the unexpected changes.

Do not modify anything.

--------------------------------------------------
3. AUDIT METHOD
--------------------------------------------------

For every capability classify it as exactly one of:

READY
PARTIAL
MISSING
DISABLED

Definitions:

READY:
Implemented and connected into the actual runtime path.

PARTIAL:
Some required pieces exist, but the end-to-end capability cannot reliably complete.

MISSING:
Required implementation does not exist.

DISABLED:
Implementation exists but is deliberately switched off, stubbed, gated, or otherwise unavailable in the current runtime.

IMPORTANT:

Do not classify something READY merely because:
- a Prisma model exists
- an endpoint exists
- an adapter interface exists
- a helper exists
- tests exist
- UI exists

READY means the real runtime path reaches and uses it.

--------------------------------------------------
4. TELEGRAM INBOUND
--------------------------------------------------

Trace the Telegram inbound path.

Determine:

- Is there a real Telegram webhook/update endpoint?
- How is webhook authenticity/security handled?
- How is tenant/business determined from an inbound update?
- Is Telegram configuration tenant-specific?
- Are incoming messages persisted?
- Is Conversation created/reused?
- Is Customer associated automatically?
- What happens for an unknown Telegram user?
- Are duplicate Telegram updates handled idempotently?
- What happens if Telegram retries the same update?
- What message types are supported?
- text?
- voice?
- photo?
- attachments?
- unsupported content?

Identify the exact runtime entry point and service path.

Classification:
READY / PARTIAL / MISSING / DISABLED

--------------------------------------------------
5. CONVERSATION / MESSAGE LIFECYCLE
--------------------------------------------------

Audit:

- Conversation creation
- existing Conversation reuse
- Message persistence
- inbound/outbound distinction
- conversation status
- open/closed behavior
- customer linkage
- CustomerRequest linkage
- channel linkage
- tenant isolation

Determine whether an inbound Telegram conversation can become operationally usable without an operator manually editing database relationships.

Prompt 49 added an operator-facing Conversation → CustomerRequest bridge.

Determine specifically:

Is that bridge automatic for AI?
Or is it still an operator action?

Classification.

--------------------------------------------------
6. AI RUNTIME
--------------------------------------------------

Trace the actual AI runtime.

Determine:

- Is an AI provider configured?
- Which provider/model architecture is implemented?
- Is it enabled in the current inbound path?
- What causes an AI invocation?
- What context is supplied?
- What tools/functions can the AI invoke?
- Is tool execution real or mocked/stubbed?
- Are AI responses persisted?
- Are AI responses actually delivered back through Telegram?
- Are failures escalated?
- Are timeouts/retries handled?

IMPORTANT:

Earlier project stages may have intentionally disabled AI.

Verify CURRENT code.

Do not rely on historical assumptions.

Classification:
READY / PARTIAL / MISSING / DISABLED

--------------------------------------------------
7. BUSINESS KNOWLEDGE + RULES
--------------------------------------------------

Audit how AI obtains business-specific context.

Inspect actual usage of:

- KnowledgeItem
- BusinessRule
- Services
- prices
- duration
- business hours
- business identity/settings
- other AI context

Determine:

Can AI correctly answer questions such as:

"Сколько стоит замена колодок?"

"До скольки вы работаете?"

"Можно завтра?"

"Сколько времени занимает работа?"

Do not judge whether the data happens to be populated in a test tenant.

Judge whether the architecture/runtime retrieves and supplies it correctly.

Classification.

--------------------------------------------------
8. CUSTOMER IDENTIFICATION
--------------------------------------------------

Trace what happens when an unknown person messages via Telegram.

Determine:

- Can the system find an existing Customer?
- By what identifier?
- Telegram ID?
- phone?
- conversation?
- channel identity?
- something else?
- Can AI create a Customer?
- Can inbound pipeline create one?
- Is customer creation safe/idempotent?
- What happens if identity is ambiguous?

Then trace a returning customer.

Classification.

--------------------------------------------------
9. VEHICLE IDENTIFICATION
--------------------------------------------------

For a message such as:

"Kia Rio 2019"

determine whether AI/runtime can:

- recognize that vehicle information is present
- locate an existing vehicle
- ask for missing information
- create a Vehicle
- associate it with the correct Customer
- prevent cross-tenant/cross-customer linkage

Do not confuse UI capability with AI capability.

Classification.

--------------------------------------------------
10. CUSTOMER REQUEST
--------------------------------------------------

Audit CustomerRequest creation in the AI path.

Prompt 49 created an operator bridge:

Conversation
→ CustomerRequest

Determine whether AI can:

- create a request
- attach it to the Conversation
- select Customer
- select Vehicle
- select Service
- preserve description/context
- update request state

Or whether an operator must still press the button in Conversation Detail.

Classification.

--------------------------------------------------
11. SERVICE IDENTIFICATION
--------------------------------------------------

Audit whether AI can map natural language such as:

"поменять передние тормозные колодки"

to a tenant's actual Service.

Determine:

- exact-name matching?
- aliases?
- AI tool?
- semantic matching?
- free text only?
- operator selection required?
- behavior when multiple services match?
- behavior when no service matches?

Do not claim semantic capability unless executable code proves it.

Classification.

--------------------------------------------------
12. AVAILABILITY
--------------------------------------------------

This section is especially important after Prompts 50–51.

Trace the AI availability path.

Determine whether AI currently uses the SAME canonical availability logic that now powers:

- business hours
- service duration
- serviceBayCapacity
- vehicle conflicts
- existing appointments
- timezone

Determine:

- Can AI ask for available slots?
- What arguments are required?
- Can it search a date/day?
- Can it interpret "tomorrow afternoon"?
- Does it return actual free slots?
- Does it respect capacity > 1?
- Does it respect vehicle conflict?
- Does it use business timezone?
- Is this tool actually wired into the active AI runtime?

Distinguish:

"availability service exists"

from:

"active AI can actually invoke it."

Classification.

--------------------------------------------------
13. SLOT PROPOSAL
--------------------------------------------------

Determine whether AI can take availability results and safely tell the customer something like:

"Завтра свободно в 14:00, 15:30 и 17:00. Какое время вам подходит?"

Check whether:

- slots are server-derived
- AI can hallucinate times outside tool output
- prompts/tool schema constrain it
- results are represented in business-local time
- stale availability is handled

Classification.

--------------------------------------------------
14. CUSTOMER CONFIRMATION
--------------------------------------------------

Audit multi-turn state.

Example:

AI:
"Есть 14:00 и 15:30."

Customer:
"Давайте в 15:30."

Determine whether the system can reliably understand that "15:30" refers to the previously offered date/service/vehicle/request.

Inspect:

- Conversation history supplied to AI
- tool context
- persisted structured state
- request linkage
- proposed-slot persistence, if any
- safeguards against ambiguous confirmations

Classification.

--------------------------------------------------
15. APPOINTMENT CREATION BY AI
--------------------------------------------------

This is a critical MVP capability.

Determine whether AI can ACTUALLY create an Appointment.

Trace executable code.

If an appointment-create tool exists:

Audit:

- tenant enforcement
- customer validation
- vehicle validation
- service validation
- business hours
- capacity
- vehicle conflict
- transaction locking
- race conditions
- idempotency
- duplicate customer confirmation
- error mapping

Most importantly:

Does AI appointment creation reuse the authoritative Prompt 50 booking service?

Or is there a separate/older booking path?

If AI booking does not exist or is disabled, say so explicitly.

Classification.

--------------------------------------------------
16. BOOKING RACE
--------------------------------------------------

Suppose AI offers 15:30.

Before customer confirms it, an operator books the final available post at 15:30.

Then customer says:

"Да, 15:30."

Determine what the current code would do.

Correct behavior should ultimately rely on the authoritative transactional booking validation.

Audit whether AI path:

- gets 409/capacity conflict
- maps it into a recoverable tool result
- requests fresh availability
- offers alternatives

or whether this flow is missing.

Do not implement it.

Report actual behavior.

--------------------------------------------------
17. OUTBOUND TELEGRAM DELIVERY
--------------------------------------------------

Audit whether AI-generated responses can actually reach the Telegram customer.

Trace:

AI output
→ Message
→ delivery service
→ Telegram adapter/API
→ delivery status

Determine:

- outbound adapter status
- retry behavior
- delivery persistence
- failure state
- duplicate-send protection
- whether this is connected to AI runtime

Classification.

--------------------------------------------------
18. ESCALATION / HUMAN HANDOFF
--------------------------------------------------

Audit actual escalation behavior.

Determine what can create AiEscalation.

Examples:

- AI uncertainty
- unsupported request
- missing service
- customer asks for human
- tool failure
- booking conflict
- AI provider failure

Check:

- OPEN / IN_PROGRESS behavior
- Operations visibility
- Dashboard visibility
- Conversation linkage
- operator ability to continue conversation
- whether AI stops responding after escalation
- whether operator can resume/reopen

Classification.

--------------------------------------------------
19. END-TO-END SCENARIOS
--------------------------------------------------

Trace these scenarios through actual code.

Do not merely describe desired behavior.

SCENARIO A — known customer

Existing customer + vehicle.

Customer:
"Нужно поменять масло. Можно завтра после 15?"

Report exactly where automation succeeds and where manual intervention becomes necessary.

SCENARIO B — new customer

Unknown Telegram user:

"Здравствуйте. Kia Rio 2019, нужно поменять передние колодки."

Report exact stopping point.

SCENARIO C — capacity race

AI offers a slot.
Another booking consumes the last post.
Customer confirms old slot.

Report current behavior.

SCENARIO D — ambiguous service

Customer:
"Что-то стучит спереди."

Determine whether AI:
- asks clarification
- selects a service
- escalates
- or has no implemented path

SCENARIO E — human request

Customer:
"Позовите администратора."

Trace current behavior.

--------------------------------------------------
20. OPERATOR DEPENDENCY MAP
--------------------------------------------------

Produce a concise table:

| Stage | Status | Automatic today? | Operator action required | Evidence |
|---|---|---|---|---|

Stages:

Telegram inbound
Conversation
Customer
Vehicle
CustomerRequest
Service identification
Knowledge/rules
Availability
Slot proposal
Customer confirmation
Appointment creation
Outbound reply
Escalation
Operator takeover

Evidence must reference actual files/functions/endpoints.

--------------------------------------------------
21. MVP BLOCKERS
--------------------------------------------------

After the audit, identify gaps by severity.

P0:
A gap that prevents the core AI-admin booking flow from functioning safely at all.

P1:
Core MVP functionality works partially but needs this for a credible real pilot.

P2:
Important polish/hardening, but not necessary for the first controlled pilot.

Do NOT inflate severity.

Do NOT include unrelated product wishes.

Focus only on:

Telegram customer
→ AI administrator
→ safe booking or human handoff.

--------------------------------------------------
22. MOST IMPORTANT NEXT IMPLEMENTATION
--------------------------------------------------

At the end, identify the SMALLEST coherent next implementation that would remove the largest MVP blocker.

Do NOT implement it.

Describe:

- problem
- current code foundation that can be reused
- minimum scope
- what should explicitly remain out of scope

Do NOT automatically call it Prompt 53 unless useful in the report.

We will decide the next prompt separately.

--------------------------------------------------
23. SECURITY AUDIT
--------------------------------------------------

Within the flow above, explicitly check:

- tenant isolation
- auth boundaries
- webhook trust boundary
- external Telegram identifiers
- AI tool authorization
- server-side relation validation
- cross-tenant IDs
- prompt/tool arguments controlled by AI
- idempotency
- duplicate inbound events
- duplicate outbound delivery
- duplicate appointment creation

Only report issues supported by actual code.

--------------------------------------------------
24. TEST COVERAGE AUDIT
--------------------------------------------------

Do NOT add tests.

Report existing tests covering:

- Telegram inbound
- Conversation
- AI runtime
- AI tools
- availability
- appointment creation
- capacity races
- tenant isolation
- outbound delivery
- escalation

Identify critical untested AI-runtime paths.

Current baseline is 1515 passing tests.

You may run tests to verify baseline.

Do not modify tests.

--------------------------------------------------
25. DATABASE / DATA
--------------------------------------------------

Do NOT modify Supabase data.

Do NOT create test records unless absolutely necessary for a read-only verification.

Prefer code tracing and existing tests.

Do NOT run destructive operations.

Do NOT create migrations.

Do NOT modify schema.

--------------------------------------------------
26. DOCUMENTATION
--------------------------------------------------

Because this is an audit, you MAY create only:

`docs/prompts/prompt-52.md`

and:

`docs/final-reports/final-report-52.md`

following the repository's existing naming/style convention.

Do not modify application code.

If creating those two documentation files makes the working tree dirty, that is expected.

No other files should change.

--------------------------------------------------
27. GIT
--------------------------------------------------

Do NOT commit automatically.

This audit should end with the report available for review.

At the end report:

- git status
- exactly which files changed
- confirm application source code unchanged
- confirm Prisma schema unchanged
- confirm no migration created

We will decide whether to commit the audit documentation after reviewing it.

--------------------------------------------------
28. REQUIRED FINAL REPORT
--------------------------------------------------

Return a structured Final Report containing:

1. Executive summary

2. Direct answer:
   "How far can the current AI administrator take a real Telegram customer today?"

3. READY / PARTIAL / MISSING / DISABLED capability map

4. Exact runtime path:
   Telegram → Conversation → AI → domain actions

5. Scenario A result

6. Scenario B result

7. Scenario C result

8. Scenario D result

9. Scenario E result

10. Operator dependency map

11. AI availability integration result

12. AI Appointment creation result

13. Outbound Telegram result

14. Escalation/handoff result

15. Security findings

16. Existing test coverage

17. P0 blockers

18. P1 gaps

19. P2 gaps

20. Smallest coherent next implementation

21. Files inspected

22. Files changed

23. Git status

24. Explicit confirmation:
    - no application code modified
    - no Prisma schema modified
    - no migration created
    - no Supabase production/business data modified

--------------------------------------------------
29. STOP CONDITION
--------------------------------------------------

STOP after the audit and Final Report.

DO NOT IMPLEMENT ANY FIX.

DO NOT proceed to Prompt 53.

DO NOT:
- enable AI
- add AI tools
- create appointment tools
- change Telegram integration
- modify Conversation behavior
- change availability
- change capacity
- change ServiceFollowUp
- add CRM
- add CPBS
- add billing
- add outbound campaigns
- change the launch screen
- change authentication
- refactor unrelated code

Wait for review.
