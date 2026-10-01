# Prompt 57 — Customer-First / Missed Call Recovery Architecture Audit

> Verbatim — reproduced exactly as provided in the development
> conversation for this project (not reconstructed, not paraphrased).

---

# PROMPT 57 — CUSTOMER-FIRST / MISSED CALL RECOVERY ARCHITECTURE AUDIT

You are working in the existing AUTOSERVISE repository.

IMPORTANT:
This is an ARCHITECTURE / PRODUCT READINESS AUDIT.

Do NOT implement telephony.
Do NOT implement WhatsApp.
Do NOT change the Prisma schema.
Do NOT create migrations.
Do NOT change application behavior.
Do NOT refactor production code.
Do NOT modify the launch screen.

The goal is to inspect the REAL repository after Prompt 56 and produce the architecture and implementation plan for the next phase of AUTOSERVISE.

Do not rely only on old documentation.
Inspect the actual code, Prisma schema, API routes, services, adapters, UI and tests.

==================================================
0. BASELINE
==================================================

First verify the repository state.

Expected baseline:

- branch: master
- HEAD: c618533
- origin/master: c618533
- Prompt 56 complete
- working tree clean
- 1686 tests passing

If the repository differs, report the difference before proceeding.

Read the relevant existing documentation, especially:

- PRODUCT_BLUEPRINT or equivalent product architecture docs
- prompts/final reports for Prompts 47–56
- current Prisma schema
- Conversations
- Customers
- Vehicles
- CustomerRequests
- Services
- Knowledge
- Business Rules
- Business Hours
- Appointments
- Availability / Capacity
- Operations
- Escalations
- Service History
- Follow-ups
- channel adapters / Telegram implementation
- AI provider / AI tools / AI context
- CRMAdapter if present
- any channel identity or external identity implementation

==================================================
1. PRODUCT DIRECTION — THIS OVERRIDES OLD ASSUMPTIONS
==================================================

AUTOSERVISE is NOT primarily another auto-service CRM.

There are already many systems for managing an auto service.

The existing business-side system remains valuable and should be preserved.

But the primary MVP customer value is now:

    DO NOT LOSE A CUSTOMER BECAUSE THE AUTO SERVICE
    COULD NOT ANSWER THE PHONE FAST ENOUGH.

The customer may be calling several auto services.

Example:

The customer needs a hood and roof painted.

They find an auto service online and call.

The technician may be:
- under a car,
- working with dirty hands,
- speaking with another customer,
- away from the phone.

If nobody answers, the customer may immediately call the next competitor.

AUTOSERVISE must recover that moment.

The desired customer journey is:

    customer has a car problem
    ↓
    calls the auto service
    ↓
    nobody answers / missed call
    ↓
    AUTOSERVISE detects the event as quickly as technically possible
    ↓
    customer receives a useful message
    ↓
    preferably through WhatsApp
    ↓
    "Здравствуйте! Вы только что звонили в автосервис.
     Мастер сейчас занят и не смог ответить.
     Подскажите, пожалуйста, чем можем помочь?"
    ↓
    short useful dialogue
    ↓
    understand vehicle + required work
    ↓
    answer using REAL business-specific services/prices/knowledge
    ↓
    give indicative/base/from-price where configured
    ↓
    explain when final price requires inspection
    ↓
    give hours/address/location/directions/contact information
    ↓
    offer visit / authoritative free time where appropriate
    ↓
    customer books or agrees to come
    OR
    conversation is handed to a human with full context

Core product principle:

    "Мастер может не ответить на звонок.
     AUTOSERVISE не должен оставить клиента без реакции."

Another useful product shorthand:

    "Позвонил → узнал → приехал → остался."

And:

    "Клиенту — простота.
     Бизнесу — система."

==================================================
2. CUSTOMER EXPERIENCE MUST BE EXTREMELY SIMPLE
==================================================

The customer must NOT need:

- an AUTOSERVISE account
- an AUTOSERVISE app
- a customer dashboard
- Telegram
- a complicated form
- knowledge of our internal CRM
- knowledge of CustomerRequest / Appointment / Conversation concepts

The customer's primary interface is their PHONE.

Ideal experience:

    call
    → missed call
    → WhatsApp response
    → answer a few relevant questions
    → get useful information
    → get approximate/base price if configured
    → know where to go
    → know when to go
    → visit/book

Do not design a customer-facing CRM portal unless the audit proves one is necessary.

Mobile simplicity is a core product requirement.

==================================================
3. WHATSAPP-FIRST — NOT TELEGRAM-FIRST
==================================================

The current Telegram integration must NOT define the future architecture.

Telegram is an optional/secondary channel.

The preferred customer-facing channel for the target MVP is:

    WhatsApp

because many customers already use WhatsApp as their normal phone-based communication channel.

However:

DO NOT assume that WhatsApp allows arbitrary outbound messages after a missed phone call.

The future implementation must comply with the actual official WhatsApp Business Platform rules.

For this audit:

- identify exactly what we need to research/verify before implementation;
- identify architectural constraints;
- identify template-message / consent / conversation-window issues that may matter;
- identify provider/API questions;
- identify fallback requirements.

Possible fallback channels may include:

- SMS
- Telegram
- other compliant channels

But do NOT choose a provider or invent capabilities without evidence.

The architecture should remain channel-adapter based.

Conceptually evaluate something like:

    Telephony Event
        ↓
    Missed Call Recovery
        ↓
    Contact / Identity Resolution
        ↓
    Channel Router
        ↓
    WhatsApp preferred
        ↓
    fallback channel if needed
        ↓
    Conversation
        ↓
    AI / Human

Do not implement this now.

==================================================
4. THE FIRST 30–60 SECONDS ARE THE PRODUCT
==================================================

Audit the architecture specifically around this question:

"What must happen technically in the first 30–60 seconds after an unanswered inbound phone call?"

Break the flow into concrete events.

For example:

1. inbound phone call begins
2. business does not answer
3. telephony provider determines missed/unanswered call
4. webhook/event reaches AUTOSERVISE
5. tenant/business is identified
6. caller phone number is normalized
7. existing customer/channel identity is searched
8. customer/lead/contact context is created or linked safely
9. recovery event is deduplicated
10. best outbound channel is determined
11. WhatsApp eligibility is checked
12. appropriate first message/template is selected
13. outbound message is sent
14. delivery state is recorded
15. Conversation is created or reused
16. customer replies
17. AI begins qualification
18. human handoff remains available

Audit whether the existing code supports each step.

Classify each step:

- READY
- PARTIAL
- MISSING
- NEEDS EXTERNAL PROVIDER / RESEARCH

==================================================
5. DO NOT BUILD A PHONE VOICE AI RECEPTIONIST YET
==================================================

The MVP is NOT necessarily a full AI voice receptionist.

Do not assume we need:

- live AI voice answering
- STT/TTS phone conversations
- streaming voice AI
- complex call routing

The first MVP hypothesis is simpler:

    missed/unanswered phone call
    → immediate digital recovery message
    → useful AI-assisted text conversation

Explain whether the current architecture supports this simpler approach.

==================================================
6. AI CONVERSATION BEHAVIOR
==================================================

The AI should behave like a good auto-service administrator.

It must NOT behave like:

- a diagnostic expert pretending certainty
- a long questionnaire
- a generic chatbot
- a sales bot
- a system that invents prices

Example:

Customer:
"Хочу покрасить капот и крышу BMW X5."

Good behavior:

- acknowledge the request;
- ask only missing/relevant vehicle information;
- confirm whether the business offers the service;
- provide configured base/from/range pricing where available;
- explain that final price may require inspection;
- offer a visit / real free time;
- provide location/hours;
- hand off if the answer requires a technician.

Bad behavior:

- asking 10 questions before giving useful information;
- diagnosing damage remotely;
- inventing a final price;
- claiming a service exists when it is not configured;
- promising an appointment without authoritative availability;
- forcing the customer into Telegram.

Audit the existing AI architecture from Prompts 53–56 against this desired behavior.

Identify what is reusable and what is missing.

==================================================
7. SERVICES AND PRICING ARE CRITICAL
==================================================

One of the most common customer questions is:

    "Сколько стоит?"

Audit the existing Service model and related APIs/UI.

Determine whether the current data model can safely represent:

- fixed price
- "from" / starting price
- min/max range
- service duration
- pricing notes/conditions
- inspection required
- active/inactive
- business-specific currency

Do NOT change the schema in this audit.

Report exactly what exists now and what is missing.

Important safety rule for future AI:

    AI must NEVER invent a price.

If a price is not configured:

    say that the price needs to be confirmed by the technician/manager
    and offer human handoff.

If a configured price is only indicative:

    clearly state that it is a starting/base/approximate price
    and final price is confirmed after inspection.

Determine whether structured Service data and Knowledge should have separate responsibilities.

Avoid unnecessary duplication.

==================================================
8. BUSINESS KNOWLEDGE
==================================================

Audit what the current Knowledge / Business Rules / Business configuration can provide to AI.

Future customer questions may include:

- What services do you provide?
- How much does it cost?
- What cars do you work with?
- Do you paint body parts?
- How long does it take?
- Are you open today?
- Where are you?
- How do I get there?
- Send me the address.
- Send me the location.
- What payment methods do you accept?
- Is there a guarantee?
- Do I need an inspection first?
- Can I come today?
- Do you have a free time tomorrow?

Determine what is already modeled and what is missing.

Specifically audit:

- business address
- coordinates / map link / geolocation support
- phone/contact information
- business hours
- service restrictions
- payment information
- warranty information
- directions
- FAQ / free-form knowledge

==================================================
9. IDENTITY — PHONE NUMBER MUST BECOME FIRST-CLASS
==================================================

The missed-call flow begins with a PHONE NUMBER.

Audit the current Customer / Conversation / channel identity architecture.

We already know from Prompt 54 that:

- phone duplicate checking exists in some form;
- phone normalization is not fully database-enforced;
- Telegram identity is not a good general identity model.

Determine the correct future architecture for:

    phone number
    ↔ customer
    ↔ telephony caller
    ↔ WhatsApp identity
    ↔ Conversation
    ↔ CustomerRequest

Consider whether a general ChannelIdentity / ContactPoint concept is needed.

Do NOT implement it.

Identify:

- duplicate risks
- tenant isolation requirements
- normalization requirements
- uniqueness requirements
- privacy/security implications
- multi-channel identity linking
- existing-customer matching

==================================================
10. MISSED CALL EVENT / IDEMPOTENCY
==================================================

Telephony providers may:

- retry webhooks
- send multiple call events
- send ringing + completed + missed events
- deliver events out of order

Design the conceptual idempotency model.

Determine whether we likely need a durable entity such as:

- CallEvent
- CallInteraction
- MissedCallRecovery

or another better design.

Do not pick a name merely for convenience.

Explain what information would likely need to be persisted:

- provider event id
- tenant/business
- caller phone
- called business number
- startedAt
- endedAt
- disposition
- answered/missed
- recovery state
- outbound channel
- Conversation
- Customer
- timestamps
- failure/retry state

Audit how this fits existing architecture.

==================================================
11. SPEED / LATENCY
==================================================

Speed is a PRIMARY product requirement.

The architecture should measure:

    missed-call detected
        →
    recovery message accepted/sent

and ideally:

    missed-call detected
        →
    customer reply

Propose metrics such as:

- missedCallDetectedAt
- recoveryQueuedAt
- recoverySentAt
- recoveryDeliveredAt
- customerRepliedAt
- humanHandoffAt
- bookedAt

Do not prematurely add fields.

Determine where these metrics belong conceptually.

Identify likely latency bottlenecks:

- telephony provider webhook delay
- serverless cold start
- database latency
- WhatsApp provider/API latency
- AI latency
- unnecessary synchronous work

Important:

The FIRST recovery message should not necessarily wait for a full AI generation if that would make response slower.

Evaluate whether the initial acknowledgement should be deterministic/template-based and AI should enter after the customer replies.

==================================================
12. CUSTOMER → REQUEST → APPOINTMENT
==================================================

Prompt 56 completed the authoritative:

    CustomerRequest
    → availability
    → explicit confirmation
    → Appointment

Audit how the missed-call customer journey can reuse:

- Customer intake
- Vehicle intake
- Request qualification
- Services
- Availability
- Capacity
- Booking confirmation
- Conversation
- Operations
- Escalations

Do not create parallel implementations.

The future missed-call architecture should feed the existing lifecycle wherever possible.

==================================================
13. HUMAN HANDOFF
==================================================

The AI must know when to stop.

Design the future handoff behavior conceptually.

Examples:

- exact price cannot be determined
- service is unclear
- damage needs inspection
- customer asks for technical diagnosis
- customer disputes price
- unusual vehicle/problem
- AI confidence insufficient
- customer explicitly asks for a person

Desired business-side result:

The technician/manager should see something like:

    Иван
    +7...
    Missed call 14:32

    BMW X5, 2020
    Wants hood + roof painting

    AI already told customer:
    - service available
    - hood from X
    - roof from Y
    - final price after inspection

    Customer:
    wants tomorrow after 15:00

    ACTION NEEDED:
    confirm inspection / answer pricing question

Audit whether current Escalations + Operations can support this or need extension.

==================================================
14. BUSINESS-SIDE MOBILE UX
==================================================

The customer side must be phone-simple.

But the auto-service owner/technician also often works from a phone.

Audit the existing business UI for mobile readiness.

Do NOT redesign it in this audit.

Identify which future mobile surfaces matter most:

- missed calls recovered
- conversations needing human response
- customer context
- vehicle
- requested service
- price already quoted
- requested time
- booking status
- today's visits
- follow-ups

The owner should not need to sit at a desktop to understand what happened.

==================================================
15. METRICS / DASHBOARD
==================================================

The current Dashboard metrics were designed before this product direction was fully understood.

Audit the current Dashboard.

Propose future metrics aligned with the real value proposition.

Examples:

- missed calls
- recovery attempts
- successfully contacted
- customer replied
- recovered into active dialogue
- handed to manager
- booked from missed call
- visited/completed if measurable
- median recovery response time
- conversion missed call → conversation
- conversion conversation → appointment

The most important business question is:

    "How many customers did AUTOSERVISE prevent us from losing?"

Do NOT implement dashboard changes now.

==================================================
16. SECURITY / PRIVACY / TENANT ISOLATION
==================================================

Audit security implications of:

- inbound telephony webhooks
- WhatsApp webhooks
- webhook signature verification
- replay attacks
- provider event idempotency
- phone-number PII
- tenant routing by called number
- cross-tenant phone collisions
- channel identity
- message content
- audit logging
- secrets/API credentials

Do not weaken existing tenant isolation.

==================================================
17. EXTERNAL RESEARCH BOUNDARY
==================================================

Do NOT invent current WhatsApp or telephony provider capabilities.

Repository inspection can tell us what AUTOSERVISE needs.

External facts must be verified separately before implementation.

Create an explicit research checklist covering:

A. WhatsApp Business Platform
- business-initiated messaging rules
- template requirements
- consent/opt-in implications
- conversation windows
- phone-number eligibility
- webhook behavior
- delivery states
- Kazakhstan availability
- target CIS/RF implications where relevant

B. Telephony
- providers suitable for Kazakhstan / target launch market
- missed/unanswered-call webhooks
- caller ID availability
- webhook latency
- virtual number requirements
- number porting/forwarding implications
- API/webhook reliability
- pricing
- legal/compliance considerations

C. Fallback
- SMS feasibility
- whether SMS can safely carry the first recovery message
- routing when WhatsApp is unavailable

Do NOT choose vendors in this repository audit unless the repository already contains a real configured provider.

==================================================
18. GAP MATRIX
==================================================

Produce a table with at least:

| Capability | Current state | Existing component | Gap | Priority | Recommended next step |

Include:

- missed call detection
- telephony webhook
- caller phone normalization
- identity resolution
- Customer creation/link
- WhatsApp outbound
- channel routing
- first recovery message
- Conversation creation
- AI qualification
- Service lookup
- base pricing
- business knowledge
- address/location
- availability
- booking
- human handoff
- Operations
- mobile owner UX
- analytics
- idempotency
- webhook security

Priority classification:

- P0 = required for core MVP
- P1 = important immediately after core flow
- P2 = useful later

==================================================
19. RECOMMEND THE NEW IMPLEMENTATION SEQUENCE
==================================================

Based on the REAL repository, propose the smallest safe implementation sequence.

Do NOT simply continue the old Prompt numbering.

We want the shortest route to a real vertical slice:

    missed call
    → immediate customer contact
    → useful dialogue
    → visit / booking / human handoff

Break the future work into small prompts.

For each proposed prompt include:

- goal
- why it exists
- exact scope
- what existing components it reuses
- schema impact
- external dependency
- tests required
- STOP condition

Clearly identify:

    FIRST IMPLEMENTATION PROMPT AFTER THIS AUDIT

But DO NOT implement it yet.

==================================================
20. PRODUCT BLUEPRINT UPDATE
==================================================

The existing Product Blueprint may reflect the older CRM-heavy framing.

Update the appropriate product/architecture documentation so that the repository records the new product direction.

Preserve useful existing architecture.

Do not erase the business-side lifecycle.

Document the two layers clearly:

CUSTOMER SIDE:
    problem
    → phone call
    → missed-call recovery
    → WhatsApp-first conversation
    → useful information
    → visit / booking / human

BUSINESS SIDE:
    call/contact
    → Customer
    → Vehicle
    → Conversation
    → CustomerRequest
    → Service
    → Appointment
    → Operations
    → ServiceRecord
    → History
    → Follow-up
    → Analytics

Core rule:

    Customer simplicity.
    Business structure.

==================================================
21. DELIVERABLES
==================================================

Create:

1. docs/audits/missed-call-recovery-architecture-audit.md
   or the repository's equivalent audit location.

2. Update PRODUCT_BLUEPRINT.md or equivalent relevant product document.

3. Save this prompt word-for-word using the existing prompt documentation convention.

4. Create a Final Report using the existing final-report convention.

The Final Report must include:

- executive summary
- what was inspected
- current architecture strengths
- critical gaps
- first-30–60-seconds flow
- WhatsApp-first implications
- telephony requirements
- identity architecture
- services/pricing readiness
- knowledge readiness
- AI readiness
- booking reuse
- handoff readiness
- mobile UX implications
- metrics
- security
- external research required
- P0/P1/P2 gap matrix
- recommended implementation sequence
- exact FIRST implementation prompt recommendation
- files changed
- tests/checks performed
- git result

==================================================
22. VALIDATION
==================================================

Because this is an audit/documentation task:

- do not modify production behavior;
- verify documentation accurately reflects real code;
- run appropriate lightweight validation if documentation-only changes do not require the full test suite;
- if any source code is accidentally changed, stop and inspect it before proceeding;
- verify git diff contains only intended audit/documentation changes.

==================================================
23. GIT — HANDLE EVERYTHING YOURSELF
==================================================

The user must NOT need to run Git or PowerShell commands manually.

You are responsible for the complete Git workflow for this task.

After the audit is complete:

1. inspect git status;
2. verify only intended documentation/audit files changed;
3. commit the audit/documentation changes;
4. use a clear commit message such as:

   docs: redefine mvp around missed call recovery

5. push the commit to origin/master;
6. DO NOT force-push;
7. verify local master and origin/master point to the same commit;
8. verify the working tree is clean.

If there are no legitimate file changes, do not create an empty commit.

==================================================
24. STOP CONDITION
==================================================

STOP after:

- repository audit complete
- architecture documented
- Product Blueprint updated
- Final Report created
- intended documentation committed
- commit pushed to origin/master
- working tree verified clean

DO NOT:

- implement telephony
- implement WhatsApp
- create migrations
- change Prisma schema
- build a customer portal
- redesign the application
- implement the first future prompt
- proceed automatically to another prompt

Return the complete Final Report and STOP.
