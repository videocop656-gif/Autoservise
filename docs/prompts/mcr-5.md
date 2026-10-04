# MCR-5 — Automatic AI Conversation After Missed-Call Recovery

> Verbatim — reproduced exactly as provided in the development
> conversation for this project (not reconstructed, not paraphrased).

---

# MCR-5 — AUTOMATIC AI CONVERSATION AFTER MISSED-CALL RECOVERY

You are working in the existing AUTOSERVISE repository.

This is the next product stage after MCR-4.1.

Expected baseline:

    f1bc1ff
    feat: add durable recovery queue trigger

Expected baseline tests:

    1913 / 1913

MCR-5 must implement the first SAFE automatic AI conversation after
the customer replies to a missed-call recovery message.

==================================================
0. PRODUCT THESIS
==================================================

AUTOSERVISE is NOT primarily another auto-service CRM.

Its primary job:

    customer calls
    → workshop misses the call
    → AUTOSERVISE immediately starts recovery
    → customer replies
    → AI administrator continues the useful conversation
    → gives grounded commercial/practical information
    → moves customer toward visit / booking
    → or hands the conversation to a human

Product principle:

    Мастер занят машиной —
    AUTOSERVISE занят клиентом.

Customer-facing flow:

    Позвонил → узнал → приехал → остался.

MCR-4/MCR-4.1 already implement:

    missed call
    → READY
    → durable queue
    → Recovery Engine
    → deterministic first SYSTEM message
    → Conversation
    → customer can reply in same Conversation

MCR-5 starts ONLY after the customer has replied.

==================================================
1. TARGET VERTICAL SLICE
==================================================

Target:

    missed call
        ↓
    deterministic recovery message
        ↓
    customer:
    "Нужно покрасить капот и крышу BMW X5"
        ↓
    inbound Message persisted
        ↓
    automatic AI eligibility check
        ↓
    AI receives authoritative business context
        ↓
    AI generates safe response
        ↓
    response passes safety/grounding checks
        ↓
    SYSTEM/AI-origin outbound Message
        ↓
    existing ChannelDelivery pipeline
        ↓
    customer receives response

Example desired answer when business data supports it:

    "Да, кузовной покраской занимаемся.
     Стоимость начинается от 40 000 ₸ за элемент.
     Точная стоимость зависит от состояния детали
     и определяется после осмотра.

     Подскажите, пожалуйста, BMW X5 какого года?"

The exact wording is NOT hard-coded.

The factual content MUST come from business data.

==================================================
2. HARD SCOPE
==================================================

IMPLEMENT:

- automatic AI processing after eligible inbound customer messages;
- business-level AI automation kill switch;
- Conversation-level human takeover / automation pause;
- safe AI eligibility policy;
- existing AI core reuse;
- MCR-3 pricing/location grounding reuse;
- Services / Knowledge / Rules / hours context reuse;
- customer/vehicle context reuse when known;
- conversation history reuse;
- AI safety contract;
- human handoff/escalation;
- automatic outbound AI response through existing delivery core;
- race/idempotency protection;
- loop prevention;
- reply limits;
- failure-safe behavior;
- operator visibility;
- tests;
- docs;
- Git workflow.

DO NOT IMPLEMENT:

- real WhatsApp;
- Meta Cloud API;
- real SMS;
- real telephony provider;
- MCR-7;
- MCR-8;
- autonomous diagnosis;
- autonomous repair estimates not present in Service data;
- autonomous Customer creation;
- autonomous Vehicle creation;
- autonomous CustomerRequest creation unless it already exists and
  an existing safe path specifically requires update;
- autonomous Appointment creation;
- autonomous booking confirmation;
- payment;
- CRM integration;
- voice AI;
- landing page;
- unrelated dashboard redesign.

MCR-5 is AI CONVERSATION, not full autonomous business execution.

==================================================
3. BASELINE AUDIT FIRST
==================================================

Before coding:

1. verify branch:

       master

2. verify HEAD:

       f1bc1ff

3. verify origin/master matches;

4. verify clean working tree;

5. inspect current test count;

6. inspect MCR-4 and MCR-4.1 implementation;

7. inspect inbound Message creation paths;

8. inspect all existing channel webhooks;

9. inspect Conversation model and status fields;

10. inspect Message sender/origin types;

11. inspect ChannelDelivery;

12. inspect existing AI core;

13. inspect Prompt 53 AI Draft implementation;

14. inspect Prompt 55 AI Qualification implementation;

15. inspect AI tools and tool safety modes;

16. inspect AiLog;

17. inspect Escalation;

18. inspect Business / AI settings;

19. inspect Services / Knowledge / Rules / hours context;

20. inspect MCR-3 pricing/location implementation.

Read:

    docs/final-reports/final-report-mcr-4.md
    docs/final-reports/final-report-mcr-4.1.md
    docs/PRODUCT_BLUEPRINT.md
    docs/audits/missed-call-recovery-architecture-audit.md

Also inspect existing Prompt 53 and Prompt 55 reports if present.

If baseline materially differs from this prompt:

STOP and report before making broad changes.

==================================================
4. REUSE EXISTING AI CORE
==================================================

DO NOT create:

    MissedCallAI
    RecoveryAI
    WhatsAppAI

as separate AI implementations.

AUTOSERVISE should have one AI administrator core with explicit modes.

Reuse/refactor the existing AI core used by:

- Prompt 53 AI Draft;
- Prompt 55 Request Qualification.

Introduce an automatic-conversation mode only if needed.

Conceptually:

    AI mode:
      DRAFT
      QUALIFICATION
      AUTO_CONVERSATION

Each mode must have explicit capabilities.

AUTO_CONVERSATION must NOT inherit write capabilities merely because
another mode has them.

==================================================
5. BUSINESS KILL SWITCH
==================================================

There MUST be an explicit business-level setting controlling automatic
AI replies.

Conceptually:

    Business.aiAutoReplyEnabled

Default MUST be:

    false

This is important.

Deploying MCR-5 must NOT suddenly cause existing businesses to begin
sending AI messages.

Owner/admin can enable it deliberately.

Manager may view the state but must not change it unless existing role
policy clearly allows comparable business settings.

Expose it in the appropriate existing Settings UI.

Russian UI wording should be clear, for example:

    Автоматические ответы AI

with explanation:

    AI может автоматически отвечать клиентам
    после их входящих сообщений.

Do not use vague wording suggesting AI has unrestricted autonomy.

If schema change is needed:

- additive migration;
- default false;
- apply safely;
- never edit old migrations.

==================================================
6. CONVERSATION-LEVEL HUMAN TAKEOVER
==================================================

We need a way to stop AI for one Conversation.

Prefer an explicit durable state rather than inferring everything from
the last message.

Conceptually:

    aiAutomationPausedAt
    aiAutomationPausedReason

or an equivalent repository-consistent representation.

Required behavior:

- operator can pause AI on a Conversation;
- operator can resume AI deliberately;
- when paused, new inbound messages do NOT trigger AI auto replies;
- existing manual AI Draft remains usable only if consistent with
  current product behavior;
- pause survives refresh/redeploy;
- UI clearly shows:

      AI отвечает автоматически

  or

      AI приостановлен

Do not create a second Conversation implementation.

==================================================
7. HUMAN TAKEOVER RULE
==================================================

When a staff member manually sends a customer-facing reply in a
Conversation where automatic AI is active:

AUTOMATIC AI MUST PAUSE for that Conversation.

Reason:

    HUMAN_TAKEOVER

This prevents:

    employee replies
    +
    AI replies at the same time.

Do not rely only on timing.

Persist the takeover state.

Operator may later explicitly resume automatic AI.

SYSTEM messages generated by AUTOSERVISE itself must NOT count as
human takeover.

AI-generated automatic messages must NOT count as human takeover.

==================================================
8. WHICH INBOUND MESSAGES MAY TRIGGER AI
==================================================

Create one centralized eligibility policy.

An inbound message may trigger automatic AI only if ALL are true:

- business AI auto-reply enabled;
- Conversation automation not paused;
- Conversation is active/open;
- message is genuinely inbound from customer;
- supported customer-facing channel;
- message has usable text;
- message has not already been processed for auto-reply;
- no active human takeover;
- no unresolved AI safety stop requiring human;
- conversation is not otherwise closed;
- message is not an internal/system message.

For MCR-5 tests, existing mock recovery channel may be supported.

Do not hard-code the architecture to WhatsApp.

Telegram behavior must NOT accidentally change merely because it uses
the same Message model.

Decide explicitly which existing channels are eligible and document it.

==================================================
9. IDEMPOTENCY — ONE INBOUND → AT MOST ONE AI ACTION
==================================================

Provider webhooks can retry.

Queue/event execution can retry.

Serverless functions can race.

For one inbound Message:

    at most one automatic AI response/handoff decision.

Implement durable idempotency.

Do not use only:

    "check latest message"

because two workers can race.

Prefer a durable DB ownership/processing marker or another
transaction-safe mechanism.

Required cases:

    same inbound webhook twice
    two workers concurrently
    retry after AI generation failure
    retry after provider accepted outbound message
    process restart

must not produce duplicate customer-facing AI messages.

==================================================
10. TRIGGER ARCHITECTURE
==================================================

Inspect the current inbound channel pipeline.

Do NOT make an inbound webhook wait for:

- OpenAI;
- long AI generation;
- outbound provider delivery.

Inbound webhook should:

    verify
    → persist inbound Message
    → durably schedule/mark AI work
    → return

Then automatic AI processing occurs outside the webhook critical path.

Since MCR-4.1 already introduced Vercel Queues, reuse that infrastructure
if appropriate.

Prefer a second narrowly scoped queue topic such as:

    ai-conversation-reply

rather than mixing different payload semantics into
`missed-call-recovery`.

Payload should contain the minimum durable identifier, preferably:

    {
      messageId: "..."
    }

No raw message text, phone number, customer data or secrets in queue
payload.

If current queue infrastructure cannot be reused safely, STOP and
explain before adding another queue provider.

==================================================
11. DB ↔ QUEUE CONSISTENCY
==================================================

Same principle as MCR-4.1:

DATABASE IS THE SOURCE OF TRUTH.

If:

    inbound Message commits
    ↓
    queue publish fails

the inbound customer message must not disappear.

Keep enough durable state for reconciliation/retry.

Do not mark an inbound message "AI processed" merely because a queue
job was published.

Document the reconciliation strategy.

Do not add an in-memory timer.

==================================================
12. AUTOMATIC AI MODE
==================================================

Add a narrowly defined AUTO_CONVERSATION mode.

Its purpose:

    answer useful customer questions
    using authoritative business data
    and move toward the next simple step.

It must NOT behave like an unrestricted agent.

The AI's job is NOT:

    diagnose the car
    solve the whole repair remotely
    invent a price
    invent availability
    promise a booking
    negotiate discounts
    create arbitrary records
    make legal/safety guarantees

The AI's job IS:

    understand the customer's immediate intent
    answer what can be answered safely
    use configured business information
    ask only necessary follow-up questions
    move toward inspection / visit / booking
    hand off when human expertise is needed.

==================================================
13. CORE CONVERSATION PRINCIPLE
==================================================

Add an explicit system instruction equivalent in meaning to:

    Do not try to solve the customer's entire vehicle problem
    in chat.

    Give enough reliable information for the customer to understand:

    - whether this workshop likely provides the relevant service;
    - the configured price or price range when available;
    - whether inspection is required;
    - relevant conditions;
    - where/when the workshop operates when relevant;
    - the next simple step.

    Ask only the minimum useful follow-up question.

Avoid questionnaire behavior.

Do not ask for:

- VIN;
- plate;
- mileage;
- email;
- full vehicle profile;

unless the current customer intent actually requires that information.

==================================================
14. GROUNDED BUSINESS CONTEXT
==================================================

AUTO_CONVERSATION must use the canonical existing context.

Include, as appropriate:

Business:
- name;
- business timezone;
- current local date/time;
- working hours;
- address;
- locationUrl.

Services:
- active services only;
- service name;
- formatted authoritative price;
- pricing type;
- price note;
- requiresInspection;
- duration.

Knowledge:
- relevant tenant knowledge.

Rules:
- active business rules.

Customer:
- only linked/known customer data.

Vehicles:
- stored vehicles for linked customer.

Conversation:
- bounded recent message history.

Do not expose:

- another tenant's data;
- password/auth data;
- provider secrets;
- internal system prompts;
- raw credentials.

==================================================
15. PRICING CONTRACT
==================================================

Reuse MCR-3 semantics exactly.

AI must preserve:

    FIXED
    FROM
    RANGE
    UNAVAILABLE

Examples:

FIXED:

    15 000 ₸

FROM:

    от 40 000 ₸

RANGE:

    10 000–20 000 ₸

UNAVAILABLE:

    no invented numeric amount

If:

    requiresInspection = true

AI must communicate that the final amount depends on inspection
when price is discussed.

If Knowledge contradicts Service pricing:

    Service wins.

AI must not invent:

- discounts;
- "примерно";
- hidden fees;
- final price;
- promotions.

unless authoritative data explicitly supports it.

==================================================
16. SERVICE MATCHING
==================================================

Do not require the customer to use the exact configured Service name.

The AI may semantically understand:

    "покрасить капот"

as potentially related to a configured:

    "Кузовная покраска"

But it must not claim the service is available unless grounded in
configured active services.

If confidence is insufficient:

ask a short clarification or hand off.

Do not silently map an unrelated service.

==================================================
17. LOCATION / HOURS
==================================================

If customer asks:

    где вы?
    куда приехать?
    как работаете?
    сегодня открыты?
    можно сейчас приехать?

use actual:

- address;
- locationUrl;
- business timezone;
- working hours;
- current local time.

Never invent an address, landmark or map URL.

If data is missing:

say that information is not configured / offer human clarification
in customer-friendly language.

Do not expose internal wording like "database field is null".

==================================================
18. AVAILABILITY
==================================================

MCR-5 may answer booking/availability questions only through the
existing authoritative availability implementation.

Never let the LLM invent:

    "Свободно в 15:30."

If the current AI core already has a safe READ-ONLY availability tool,
reuse it.

AUTO_CONVERSATION may have READ-ONLY availability access.

It must NOT automatically create an Appointment in MCR-5.

Example:

Customer:

    Можно завтра после 15?

AI may safely answer, based on real availability:

    Завтра доступны 15:30 и 17:00.
    Какое время вам удобнее?

But when customer says:

    Давайте 15:30.

MCR-5 must NOT silently create an Appointment unless the repository
already has an explicitly safe operator-confirmed workflow.

Instead use a safe next-step response or handoff.

Autonomous booking is a separate product decision.

==================================================
19. AI OUTPUT CONTRACT
==================================================

Do not use arbitrary free-form output as the only AI contract.

Use a structured response.

Conceptually:

    {
      action:
        "REPLY"
        | "HANDOFF"
        | "NO_REPLY",

      replyText?: string,

      handoffReason?: string,

      confidence?: ...,

      referencedServiceIds?: ...
    }

Exact schema may adapt to existing AI architecture.

Validate it server-side with Zod or repository-standard validation.

Do not allow model-supplied:

- tenantId;
- businessId;
- customerId;
- vehicleId;
- appointmentId;
- arbitrary database IDs

to become authoritative.

Server resolves all entities from current tenant context.

==================================================
20. REPLY
==================================================

If action = REPLY:

validate before sending.

Required:

- non-empty;
- reasonable maximum length;
- no unsupported diagnosis;
- no unsupported numeric price;
- no unsupported address/location;
- no unsupported appointment confirmation;
- no internal/system text;
- no secret/tool leakage.

If validation fails:

DO NOT send the unsafe reply.

Create/escalate a human handoff instead.

Fail closed.

==================================================
21. HANDOFF
==================================================

If AI cannot safely continue:

    action = HANDOFF

Examples:

- diagnosis required;
- customer reports complex accident damage;
- AI cannot confidently map service;
- customer asks for price not configured;
- customer disputes price;
- complaint/conflict;
- refund/payment dispute;
- warranty dispute;
- safety-critical vehicle condition;
- customer explicitly asks for a person;
- repeated misunderstanding;
- unsupported booking commitment;
- AI safety validation failure.

Create/reuse existing Escalation.

Do not invent a second handoff model.

Conversation automation must pause durably.

Reason should be operator-readable.

Customer-facing response may say, when appropriate:

    "Здесь лучше подключить мастера.
     Я передам ему информацию из нашего диалога."

Do not promise an exact callback time unless configured.

==================================================
22. EXPLICIT HUMAN REQUEST
==================================================

Detect obvious requests such as:

    Позовите человека
    Соедините с мастером
    Хочу поговорить с администратором
    Позвоните мне
    Нужен мастер

Do not force AI to keep chatting.

Pause automation and escalate.

This should preferably have deterministic safeguards in addition to
model judgment for obvious phrases.

==================================================
23. HUMAN TAKEOVER AFTER AI
==================================================

Scenario:

    customer
    → AI
    → customer
    → AI
    → staff manually replies

Expected:

    conversation AI auto mode pauses immediately.

Next inbound customer message:

    no automatic AI response.

Operator can resume explicitly.

Test this.

==================================================
24. LOOP PREVENTION
==================================================

AI must never respond automatically to:

- its own outbound message;
- SYSTEM recovery message;
- staff outbound message;
- delivery-status webhook;
- queue retry without new inbound;
- another AI-generated message.

Only genuine eligible inbound customer Messages may start one AI turn.

==================================================
25. RATE / TURN LIMIT
==================================================

Add a conservative safety limit.

We do not want endless autonomous conversations.

Use a centralized policy, for example:

- maximum N consecutive automatic AI turns per Conversation
  without human intervention;

or an equivalent safer repository-consistent mechanism.

Choose a conservative MVP value and document it.

When exceeded:

    pause AI
    → Escalation
    → human takeover.

Do not silently continue forever.

==================================================
26. KILL SWITCH DURING IN-FLIGHT WORK
==================================================

Race:

    inbound arrives
    → queue job starts
    → owner disables AI
    → AI finishes generation

Before sending, re-check:

- Business.aiAutoReplyEnabled;
- Conversation pause/takeover state;
- Conversation still active;
- inbound message still eligible.

If disabled/paused:

    do not send.

The kill switch must work even against an already-running job.

==================================================
27. STAFF REPLY DURING IN-FLIGHT AI
==================================================

Race:

    customer inbound
    → AI job starts
    → employee replies manually
    → AI generation finishes

Expected:

    AI response MUST NOT send.

Re-check human takeover immediately before irreversible outbound
delivery.

Test this race.

==================================================
28. CUSTOMER SENDS TWO QUICK MESSAGES
==================================================

Example:

    "Нужно покрасить капот"
    immediately:
    "BMW X5 2018 года"

Avoid two contradictory AI replies racing each other.

Design a safe serialization/coalescing strategy.

At minimum:

- serialize AI work per Conversation;
- before generation/send, load current relevant conversation state;
- do not let two AI turns concurrently send for adjacent inbound
  messages in the same Conversation.

Prefer answering using the newest available context.

Do not add arbitrary long delays just to debounce.

Document exact behavior.

==================================================
29. AI FAILURE
==================================================

If OpenAI/provider fails:

- customer must not receive garbage;
- inbound message remains durable;
- no duplicate replies;
- processing state must remain diagnosable;
- retry only according to explicit bounded policy;
- after bounded failure, escalate or leave actionable state.

Do not create infinite retries.

Do not tell customer:

    OpenAI failed
    API error
    model unavailable.

==================================================
30. DELIVERY FAILURE
==================================================

AI generation success is NOT delivery success.

Use existing ChannelDelivery semantics.

If outbound provider rejects/fails:

- do not claim customer received AI response;
- preserve delivery state;
- follow existing retry/idempotency rules;
- do not regenerate different AI text on each delivery retry.

Generate once → retry same outbound Message.

This is critical.

==================================================
31. AI MESSAGE ORIGIN
==================================================

Inspect current Message sender model.

Automatic AI response must be distinguishable from:

- customer;
- staff;
- deterministic SYSTEM recovery message.

Prefer the smallest schema-compatible approach.

If an AI sender/origin already exists, reuse it.

If not, add the smallest explicit durable origin needed.

UI should make clear:

    Ответ AI

not:

    Иван Иванов

and not confuse it with:

    Автоматическое сообщение

from the deterministic recovery template.

Do not impersonate a staff member.

==================================================
32. AI LOGGING
==================================================

Reuse AiLog.

Record enough to audit:

- mode AUTO_CONVERSATION;
- Conversation;
- triggering inbound Message;
- outcome REPLY/HANDOFF/NO_REPLY;
- model/provider metadata as already allowed;
- tool use;
- failure category;
- timestamps.

Do not store secrets.

Avoid unnecessary duplication of full PII if existing logs do not
require it.

==================================================
33. OPERATOR UI
==================================================

Conversation Detail should show:

- AI auto status;
- pause/resume control;
- clear origin for AI replies;
- handoff/escalation status;
- existing Message thread;
- existing manual composer.

Keep current graphite/gold design.

Do not redesign the application.

390px mobile must remain usable.

==================================================
34. SETTINGS UI
==================================================

Add the business kill switch to the appropriate existing settings area.

Russian UI.

Suggested concept:

    Автоматические ответы AI

    [toggle]

    Когда функция включена, AI может автоматически
    отвечать на входящие сообщения клиентов.
    При ответе сотрудника AI в этом диалоге
    автоматически приостанавливается.

Default OFF.

Do not imply that enabling this activates real WhatsApp if only mock
channel is configured.

==================================================
35. EXISTING AI DRAFT MUST SURVIVE
==================================================

Prompt 53:

    Предложить ответ AI

must continue to work.

Do not remove it.

It remains useful when automatic AI is disabled or paused.

Manual draft generation must NOT automatically resume auto mode.

==================================================
36. EXISTING QUALIFICATION MUST SURVIVE
==================================================

Prompt 55:

    Разобрать обращение

must continue to work.

MCR-5 must not silently create/update Request just because AI
conversation understood an intent.

Qualification remains its existing explicit workflow unless current
architecture safely shares read-only understanding.

==================================================
37. EXISTING BOOKING MUST SURVIVE
==================================================

Prompt 56 booking flow remains unchanged.

MCR-5 does not bypass:

    Подобрать время
    → выбрать slot
    → Подтвердить запись.

Do not create an autonomous Appointment path in this prompt.

==================================================
38. CHANNEL BOUNDARY
==================================================

MCR-5 must remain channel-neutral.

The conversation engine should work conceptually for:

    WhatsApp
    SMS
    other supported customer channels

without AI knowing provider-specific details.

Channel adapter decides delivery.

Do not put WhatsApp-specific logic inside AI prompt/core.

Real WhatsApp remains MCR-7.

==================================================
39. TEST PLAN
==================================================

Add focused tests for at least:

A. business kill switch default OFF.

B. OFF → inbound produces no AI reply.

C. enable → eligible inbound schedules AI work.

D. duplicate inbound webhook → one AI action.

E. duplicate queue delivery → one AI response.

F. five concurrent workers → one AI response.

G. AI reply uses configured Service pricing.

H. FROM remains FROM.

I. RANGE remains RANGE.

J. FIXED remains FIXED.

K. UNAVAILABLE never invents price.

L. requiresInspection caveat preserved.

M. conflicting Knowledge price does not override Service.

N. configured address/location only.

O. missing address/location not invented.

P. working hours use business timezone/current time.

Q. read-only availability uses real availability.

R. AI cannot create Appointment.

S. AI cannot create Customer.

T. AI cannot create Vehicle.

U. AI cannot create CustomerRequest.

V. AI cannot mutate Request status.

W. explicit "хочу поговорить с человеком" → handoff.

X. unsafe/complex diagnosis → handoff.

Y. safety validation failure → no unsafe send + handoff.

Z. staff manual reply pauses AI.

AA. next inbound after human takeover → no AI.

AB. operator resume → AI can answer later inbound.

AC. owner disables kill switch while AI in flight → no send.

AD. staff replies while AI in flight → no AI send.

AE. AI does not answer its own outbound Message.

AF. AI does not answer SYSTEM recovery Message.

AG. delivery-status update does not trigger AI.

AH. two rapid inbound messages cannot cause concurrent contradictory
    replies.

AI. provider generation failure is bounded and safe.

AJ. outbound delivery failure retries same generated Message rather
    than regenerating.

AK. automatic-turn limit → pause + escalation.

AL. tenant isolation.

AM. malformed queue payload safe.

AN. nonexistent Message safe.

AO. queue payload cannot choose tenant/business.

AP. Prompt 53 Draft regression.

AQ. Prompt 55 Qualification regression.

AR. Prompt 56 Booking regression.

AS. MCR-4 Recovery regression.

AT. MCR-4.1 Queue regression.

==================================================
40. REALISTIC VERTICAL-SLICE TEST
==================================================

Create a realistic local/integration test using existing mock
telephony + mock recovery channel + AI mock.

Business configuration example:

    service:
      Кузовная покраска
      price: от 40 000 ₸
      requiresInspection: true
      priceNote:
        Точная стоимость зависит от состояния детали
        и объёма подготовительных работ

    address:
      configured test address

Flow:

    missed call
    → READY
    → recovery
    → first deterministic SYSTEM message
    → customer replies:
      "Нужно покрасить капот и крышу BMW X5"
    → AI auto mode
    → grounded AI response

Assert response:

- says service is available only if configured;
- preserves "от 40 000 ₸";
- communicates inspection condition;
- does not invent final price;
- does not create Customer;
- does not create Vehicle;
- does not create Request;
- does not create Appointment;
- does not diagnose;
- asks at most a small relevant next question.

Then:

    customer:
      "А завтра после трех можно?"

AI may use real read-only availability.

Then:

    customer:
      "Позовите лучше мастера"

Expected:

    escalation
    + auto mode paused
    + no further automatic AI replies.

==================================================
41. LIVE OPENAI BOUNDARY
==================================================

Do not require a live OpenAI call for deterministic CI tests.

Use the existing AI provider abstraction/mock.

If a real OpenAI key is already safely configured and existing project
practice supports a live smoke test, it may be performed separately.

Clearly report:

    mock AI verified
    vs
    real OpenAI verified/not verified.

Do not expose API keys.

==================================================
42. DATABASE
==================================================

Determine the minimum schema changes.

Likely required durable concepts:

- business AI auto-reply enablement;
- conversation pause/takeover state;
- inbound AI processing/idempotency state or equivalent.

Do NOT create a huge workflow schema.

Use existing AiLog/Message/Escalation where possible.

New migration must be additive.

Never edit applied migrations.

Apply safely to Supabase if this repository's current workflow and
credentials allow it.

Verify migration status afterwards.

==================================================
43. SECURITY / TENANT ISOLATION
==================================================

Every automatic AI operation must derive:

    tenant
    business
    conversation
    customer
    services
    knowledge
    rules
    availability

from authoritative server-side relationships.

Never trust queue payload for tenant/business.

Queue payload should preferably contain only Message ID.

Cross-tenant Message lookup must fail safely.

Add tenant isolation tests.

==================================================
44. COST CONTROL
==================================================

Automatic AI creates variable cost.

Add basic MVP protections without building billing:

- bounded context;
- bounded output;
- automatic-turn limit;
- no AI on SYSTEM/staff messages;
- no AI when disabled/paused;
- no duplicate generation for same inbound;
- no AI for unsupported/empty messages.

Document where future per-tenant usage limits can attach.

Do not implement billing in MCR-5.

==================================================
45. VALIDATION
==================================================

Run:

- focused MCR-5 tests;
- MCR-4 regression;
- MCR-4.1 regression;
- Prompt 53 regression;
- Prompt 55 regression;
- Prompt 56 regression;
- tenant isolation suite;
- full test suite;
- TypeScript typecheck;
- production build;
- Prisma validate;
- migrate status.

If browser/UI changed:

- verify Conversation Detail;
- verify Settings;
- verify desktop;
- verify 390px mobile;
- verify toggle/pause/resume;
- verify AI/human/system visual distinction.

The pre-existing unrelated `prisma format --check` issue may remain
if unchanged.

Do not fix unrelated legacy formatting in this prompt.

==================================================
46. DOCUMENTATION
==================================================

Create:

    docs/prompts/mcr-5.md
    docs/final-reports/final-report-mcr-5.md

Update materially:

    docs/PRODUCT_BLUEPRINT.md
    docs/audits/missed-call-recovery-architecture-audit.md

Document clearly:

- AI activation boundary;
- kill switch;
- human takeover;
- handoff;
- grounding;
- pricing authority;
- availability authority;
- idempotency;
- queue semantics;
- turn limit;
- AI failure;
- delivery failure;
- what AI may NOT mutate;
- real WhatsApp still not implemented.

==================================================
47. FINAL REPORT
==================================================

Final Report must include:

1. baseline commit;
2. schema changes;
3. migration;
4. business kill switch;
5. Conversation pause/takeover model;
6. AI trigger point;
7. queue/topic;
8. queue payload;
9. DB↔Queue consistency;
10. inbound idempotency;
11. concurrent processing protection;
12. AI mode architecture;
13. context supplied to AI;
14. pricing grounding;
15. Knowledge precedence;
16. hours/location grounding;
17. availability behavior;
18. structured AI output;
19. reply safety validation;
20. handoff policy;
21. explicit human-request handling;
22. staff takeover behavior;
23. in-flight kill-switch race;
24. in-flight staff-reply race;
25. rapid-message behavior;
26. automatic-turn limit;
27. AI failure behavior;
28. delivery failure behavior;
29. Message origin;
30. AiLog;
31. Conversation UI;
32. Settings UI;
33. Prompt 53 regression;
34. Prompt 55 regression;
35. Prompt 56 regression;
36. MCR-4/MCR-4.1 regression;
37. tenant isolation;
38. vertical-slice result;
39. mock AI vs real OpenAI;
40. tests before/after;
41. build/typecheck/Prisma;
42. files changed;
43. known limitations;
44. readiness for real WhatsApp MCR-7;
45. Git result.

==================================================
48. CRITICAL ACCEPTANCE QUESTIONS
==================================================

Answer YES / PARTIAL / NO with evidence.

QUESTION A

Given:

    customer calls
    → missed
    → recovery message sent
    → customer replies:
      "Нужно покрасить капот и крышу BMW X5"

Can AUTOSERVISE automatically generate and send a useful grounded
response WITHOUT an operator pressing a button?

QUESTION B

Can it do this without inventing:

- service availability;
- price;
- inspection conditions;
- address;
- opening hours;
- free appointment slots?

QUESTION C

If a human employee starts replying, does automatic AI reliably stop
for that Conversation?

QUESTION D

If the owner disables automatic AI while a response is being generated,
can that response still accidentally be sent?

Expected:

    NO.

Prove it.

QUESTION E

Can one inbound customer Message cause two automatic customer-facing
AI replies because of webhook retry, queue retry or concurrency?

Expected:

    NO.

Prove it.

QUESTION F

Can MCR-5 autonomously create:

    Customer
    Vehicle
    CustomerRequest
    Appointment

Expected:

    NO.

Prove it.

==================================================
49. GIT — COMPLETE EVERYTHING YOURSELF
==================================================

The user must not run Git or PowerShell manually.

After implementation:

1. inspect git status;
2. inspect diff;
3. ensure only intended MCR-5 changes;
4. ensure no secrets/.env committed;
5. run validation;
6. commit intended changes.

Suggested commit:

    feat: add automatic ai conversation recovery

7. push:

    origin/master

8. never force push;
9. verify local master == origin/master;
10. verify clean working tree;
11. include commit hash in Final Report.

If no legitimate changes are needed, do not create an empty commit.

==================================================
50. STOP CONDITION
==================================================

MCR-5 is complete only when:

- business AI kill switch exists and defaults OFF;
- eligible customer inbound can trigger automatic AI;
- AI work is outside inbound webhook critical path;
- duplicate/retried inbound cannot duplicate replies;
- concurrent workers cannot duplicate replies;
- AI uses authoritative business context;
- Service remains price authority;
- availability is read-only and authoritative;
- AI cannot autonomously create Appointment;
- AI cannot create Customer/Vehicle/Request;
- human request causes handoff;
- staff reply pauses AI;
- operator can resume AI;
- kill switch is rechecked before send;
- staff takeover is rechecked before send;
- automatic conversation is bounded;
- unsafe output fails closed;
- AI/provider failure is safe;
- delivery retry reuses same generated Message;
- existing Draft/Qualification/Booking still work;
- MCR-4/MCR-4.1 still work;
- tenant isolation passes;
- tests pass;
- build/typecheck/Prisma pass;
- docs are complete;
- intended changes committed and pushed;
- master == origin/master;
- working tree clean.

DO NOT START REAL WHATSAPP.

DO NOT START REAL TELEPHONY.

DO NOT START MCR-7 OR MCR-8.

Return the complete MCR-5 Final Report and STOP.
