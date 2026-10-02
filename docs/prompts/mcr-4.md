# MCR-4 — Missed Call Recovery Engine

> Verbatim — reproduced exactly as provided in the development
> conversation for this project (not reconstructed, not paraphrased).

---

# MCR-4 — MISSED CALL RECOVERY ENGINE

You are working in the existing AUTOSERVISE repository.

This is the FOURTH implementation step after:

- Prompt 57 — Missed Call Recovery Architecture Audit
- MCR-1 — Phone Identity Foundation
- MCR-2 — Missed Call Intake Foundation
- MCR-3 — Pricing & Business Location Foundation

Expected current baseline:

    fc3b435
    feat: add customer pricing and location context

Current product chain:

    inbound phone call
    → called-number business routing
    → CallInteraction
    → MISSED / ANSWERED
    → Customer resolution
    → READY

MCR-4 starts from READY and implements the first recovery action.

TARGET FLOW:

    missed call
    → CallInteraction READY
    → safely claim recovery
    → anti-spam decision
    → choose an available/permitted channel
    → create/reuse Conversation
    → send ONE deterministic first recovery message
    → persist delivery/recovery state
    → measure recovery latency

IMPORTANT:

MCR-4 DOES NOT implement automatic AI conversation after the customer replies.

That belongs to MCR-5.

==================================================
0. PRODUCT PRINCIPLE
==================================================

The core AUTOSERVISE promise is:

    Мастер занят машиной —
    AUTOSERVISE занят клиентом.

The customer should not need:

- an AUTOSERVISE account;
- an AUTOSERVISE app;
- Telegram;
- a dashboard;
- a form.

The future real experience is:

    customer calls
    → nobody answers
    → AUTOSERVISE contacts them quickly
    → useful dialogue begins

MCR-4 implements the recovery-engine side of that promise.

==================================================
1. HARD SCOPE BOUNDARY
==================================================

IMPLEMENT:

- recovery claim/state machine;
- race-safe READY claiming;
- anti-spam suppression;
- recovery orchestration;
- provider-neutral recovery channel selection;
- reuse of existing ChannelAdapter architecture where appropriate;
- MOCK recovery channel sufficient for full vertical testing;
- Conversation creation/reuse for recovered calls;
- deterministic first recovery message;
- ChannelDelivery / Message persistence through existing delivery architecture;
- recovery timestamps;
- failure/retry-safe state;
- system actor/system-origin semantics where required;
- no fake owner identity;
- tests;
- Supabase verification;
- documentation;
- commit + push.

DO NOT IMPLEMENT:

- real WhatsApp integration;
- Meta onboarding;
- WhatsApp templates approval;
- Twilio/360dialog/WABA provider integration;
- real SMS provider;
- real Kcell integration;
- automatic AI replies;
- AI-generated first message;
- voice AI;
- CustomerRequest creation from the missed call;
- Appointment creation;
- automatic qualification;
- dashboard redesign;
- Operations redesign;
- customer portal;
- landing page changes;
- MCR-5.

==================================================
2. BASELINE / REPOSITORY AUDIT
==================================================

Before changing anything:

1. Inspect actual repository state.
2. Verify branch `master`.
3. Verify HEAD and origin/master:

       fc3b435

4. Verify working tree clean.

Read the actual implementation of:

- MCR-1 phone identity;
- MCR-2 BusinessPhoneNumber;
- CallInteraction;
- CallEvent;
- recovery state;
- telephony state machine;
- MCR-3;
- Conversation;
- Message;
- ChannelConnection;
- ChannelDelivery;
- ChannelAdapter;
- Telegram adapter;
- mock channel adapter;
- outbound delivery lifecycle;
- retry handling;
- webhook architecture;
- escalation architecture;
- Operations;
- role/auth model;
- AI logs;
- existing actor/user requirements;
- Prisma schema;
- tenant isolation tests.

Also read:

    docs/audits/missed-call-recovery-architecture-audit.md
    docs/PRODUCT_BLUEPRINT.md
    docs/final-reports/final-report-mcr-2.md
    docs/final-reports/final-report-mcr-3.md

Do not blindly follow conceptual field names below if the repository already has a cleaner compatible abstraction.

If repository state materially differs from baseline, STOP and report.

==================================================
3. CRITICAL REAL-WORLD CHANNEL RULE
==================================================

AUTOSERVISE's preferred future customer channel is WhatsApp.

However:

MCR-4 MUST NOT pretend that a real WhatsApp message can always be sent after a missed phone call.

The architecture must distinguish:

    preferred channel

from:

    currently available/permitted channel.

Do not hard-code:

    missed call → WhatsApp

Instead implement:

    missed call
    → Recovery Channel Router
    → best eligible configured channel
    → delivery

For MCR-4 the actual vertical slice may use a MOCK recovery channel.

Real WhatsApp comes later.

==================================================
4. RECOVERY STATE MACHINE
==================================================

Audit the recovery enum/state created in MCR-2.

Implement the smallest truthful durable lifecycle.

Conceptually it may need states such as:

    PENDING
    READY
    CLAIMED
    SENT
    FAILED
    SUPPRESSED
    NOT_ELIGIBLE

Do NOT use these exact names if current schema differs.

Required semantics:

READY:
    missed call is eligible for future recovery.

CLAIMED:
    one worker/process owns this recovery attempt.

SENT:
    initial recovery message was successfully accepted
    by the selected outbound channel according to the
    existing delivery semantics.

FAILED:
    recovery attempt failed in a retryable or terminal
    way, represented clearly.

SUPPRESSED:
    recovery intentionally not sent because anti-spam
    or another explicit recovery policy blocked it.

NOT_ELIGIBLE:
    call cannot enter recovery.

State transitions must be explicit and tested.

Do not silently overload Call outcome with Recovery outcome.

==================================================
5. RACE-SAFE CLAIMING
==================================================

This is critical.

Two concurrent processes must never both send the initial recovery message for the same CallInteraction.

Implement a database-backed atomic claim.

Conceptually:

    READY → CLAIMED

using:

- transaction;
- conditional update;
- SELECT ... FOR UPDATE;
- compare-and-set;

or another repository-consistent database-safe mechanism.

Do NOT use:

    read READY
    → send
    → update SENT

without an atomic claim.

Tests must simulate concurrent claims.

Expected:

    one winner
    all others no-op / already claimed

==================================================
6. LATE ANSWER RACE
==================================================

MCR-2 explicitly identified:

    a late ANSWERED event can upgrade a call
    that had temporarily been MISSED/READY.

MCR-4 must handle the race:

    missed detected
    → recovery claim starts
    → late answered event arrives

We must avoid sending:

    "Вы только что звонили, мастер не смог ответить"

when reliable evidence now says the call was actually answered.

Required:

Before irreversible outbound send, re-check authoritative CallInteraction outcome.

If outcome is now ANSWERED:

    do not send;
    transition recovery to an appropriate non-send state;
    document why.

Design concurrency so this is as safe as reasonably possible.

Test the race.

==================================================
7. ANTI-SPAM WINDOW
==================================================

Scenario:

    14:00 customer calls → missed
    14:01 calls again → missed
    14:02 calls again → missed

These are three legitimate CallInteractions.

But AUTOSERVISE should normally not send three identical:

    "Вы только что звонили..."

messages.

Implement a simple deterministic anti-spam window.

Key should be based on:

    tenant
    business
    caller canonical phone

and authoritative recovery/call timestamps.

Choose a reasonable initial default and centralize it as configuration/constant.

Do not bury a magic number throughout code.

A practical initial window may be something like 10–15 minutes,
but inspect repository conventions and document the exact chosen value.

Within the window:

- first eligible missed call may recover;
- later missed calls are preserved;
- later calls become SUPPRESSED for initial recovery;
- they must NOT be deleted or merged.

IMPORTANT:

A failed recovery should not necessarily suppress a later call forever.

Define this carefully.

Test boundary conditions.

==================================================
8. FIRST RECOVERY MESSAGE — DETERMINISTIC
==================================================

The FIRST message after a missed call must NOT be AI-generated.

Use a deterministic template.

Russian MVP example:

    "Здравствуйте! Вы только что звонили в автосервис.
     Мастер сейчас занят и не смог ответить.
     Подскажите, пожалуйста, с каким вопросом обращаетесь?"

Exact punctuation may follow existing product voice.

Requirements:

- short;
- natural;
- no invented facts;
- no diagnosis;
- no price;
- no fake availability;
- no customer name unless identity is safely known and product intentionally chooses to use it;
- no AI call;
- no requirement to install another app.

Prefer business name only if configured and if doing so improves clarity.

Do not include AUTOSERVISE branding unless product architecture already requires it.

From the customer's perspective, they are talking to the auto-service.

==================================================
9. TEMPLATE / FUTURE WHATSAPP READINESS
==================================================

The deterministic first message should be represented so that future real WhatsApp integration can map it to an approved business-initiated template.

Do NOT build Meta templates now.

But avoid burying the text in random orchestration code.

Use an explicit template abstraction / template key / message builder appropriate to the repository.

Conceptually:

    MISSED_CALL_RECOVERY_V1

Future provider integrations should be able to map:

    internal template key
        →
    provider-approved template identifier

Do not implement provider IDs now.

==================================================
10. RECOVERY CHANNEL ROUTER
==================================================

Create a small provider-neutral router.

Its responsibility:

Given:

    Business
    caller phone
    configured channel connections
    channel capability/eligibility

select the best available recovery channel.

The architecture must support future priority conceptually:

    WhatsApp
    → SMS
    → optional other channel

But do NOT pretend unavailable integrations exist.

For MCR-4:

- use existing mock channel infrastructure if appropriate;
- otherwise implement a minimal MockRecoveryChannel adapter.

Do NOT route missed-call recovery to Telegram merely because Telegram already exists.

Telegram must not become the default customer channel accidentally.

==================================================
11. CHANNEL CAPABILITY CONTRACT
==================================================

A channel must be able to answer:

    Can I initiate a business-first recovery message
    to this destination right now?

Do not model only:

    "channel configured = true"

because future WhatsApp has policy/template/consent constraints.

Design a small capability result conceptually like:

    eligible
    not configured
    invalid destination
    business initiation not permitted
    template unavailable
    provider unavailable

Do not implement WhatsApp policy logic yet.

Just make the abstraction capable of expressing it later.

==================================================
12. NO ELIGIBLE CHANNEL
==================================================

If CallInteraction is READY but no recovery channel is eligible:

DO NOT:

- fake success;
- create SENT state;
- send Telegram by accident;
- discard the call.

Persist a truthful recovery outcome.

Choose whether this should be:

    FAILED
    or
    a specific blocked/no-channel state

based on the existing state model.

The record must remain visible/retryable for future Operations work.

Document the decision.

==================================================
13. CONVERSATION CREATION
==================================================

When an outbound recovery is actually going to be attempted:

create/reuse the appropriate Conversation using existing domain architecture.

Requirements:

- tenant/business scoped;
- channel-specific;
- customer linked if CallInteraction already resolved one;
- unknown caller allowed;
- destination tied to canonical caller phone;
- no fake Customer required.

Do not create Conversation merely when CallInteraction becomes READY if no channel can be used.

Prefer creation as part of actual recovery orchestration.

==================================================
14. CALL ↔ CONVERSATION LINK
==================================================

The future system must know:

    this conversation began because of this missed call.

Implement the smallest durable relation appropriate to the schema.

Possible approaches:

    CallInteraction.conversationId

or a more appropriate existing relation.

Do not invent a generic attribution framework.

Requirements:

- tenant consistency;
- business consistency;
- one initial recovery conversation per recovered call;
- idempotent retries reuse the same relation.

This will later allow:

    missed call
    → reply
    → AI dialogue
    → request
    → booking

to be measured end-to-end.

==================================================
15. MESSAGE PERSISTENCE
==================================================

Reuse existing Message architecture.

The first recovery message must be persisted as a real outbound/system message only when the existing delivery lifecycle says it should be.

Do not create a staff-authored fake message.

Clearly represent its origin.

If Message currently requires a staff/user sender, fix the model minimally so system-generated outbound messages can be represented truthfully.

Do not impersonate owner/admin.

==================================================
16. SYSTEM ACTOR / SYSTEM ORIGIN
==================================================

Prompt 57 and MCR-2 identified this gap.

MCR-4 is the first stage that performs a real automated business action.

Therefore implement the smallest truthful system-origin model.

Do NOT create a fake User such as:

    "AUTOSERVISE Bot"

unless the existing architecture has a formally supported service-account concept.

Prefer domain semantics such as:

    senderType = SYSTEM

or equivalent.

Inspect the current Message / Delivery / audit architecture first.

Requirements:

- operator can distinguish staff message from automated recovery;
- API does not pretend owner sent it;
- future AI-generated messages can have a distinct origin if needed;
- existing staff sending remains backward compatible.

Do not overbuild a generic IAM system.

==================================================
17. DELIVERY LIFECYCLE
==================================================

Reuse existing ChannelDelivery lifecycle.

Do not create a parallel delivery system for missed calls.

Recovery orchestration should integrate with:

    Message
    ChannelDelivery
    ChannelAdapter

where appropriate.

Preserve existing retry-safe behavior.

Define exactly when CallInteraction recovery becomes:

    SENT

Prefer linking it to the authoritative existing delivery transition rather than merely "we called adapter.send()".

If existing semantics distinguish:

    queued
    accepted
    sent
    delivered

document which one MCR-4 uses.

Do not call something delivered unless provider confirms delivery.

==================================================
18. FAILURE HANDLING
==================================================

Handle at least:

- channel unavailable;
- adapter throws;
- delivery rejected;
- database failure before send;
- database failure after provider acceptance;
- retry after uncertain result.

The system must minimize duplicate customer messages.

Use existing delivery idempotency if available.

If a perfect exactly-once guarantee is impossible across DB + external provider, document the boundary and use provider idempotency keys / delivery records where possible.

The MOCK provider should support deterministic failure tests.

==================================================
19. RECOVERY LATENCY
==================================================

MCR-2 stored the moment the missed call was detected.

MCR-4 must store timestamps needed for:

    missedDetectedAt
        →
    recoveryClaimedAt
        →
    recoverySendAcceptedAt

Use names consistent with actual schema.

This will later feed:

    median recovery speed
    p90 recovery speed

Do not calculate Dashboard metrics yet.

But ensure the raw timestamps are trustworthy.

==================================================
20. CUSTOMER REPLY — DO NOT AUTO-AI YET
==================================================

If the mock channel supports simulating an inbound customer reply after the first recovery message:

it may enter the existing Conversation/message pipeline.

But MCR-4 MUST NOT automatically invoke AI.

Expected end state may be:

    system:
      first recovery message

    customer:
      "Нужно покрасить капот BMW X5"

    Conversation now contains customer reply

Then STOP.

MCR-5 will implement:

    inbound reply
    → grounded AI
    → automatic useful response / handoff

Do not implement it now.

==================================================
21. CUSTOMER / REQUEST / APPOINTMENT BOUNDARIES
==================================================

MCR-4 must NOT:

- auto-create Customer;
- auto-create Vehicle;
- auto-create CustomerRequest;
- auto-create Appointment.

Known Customer may be linked.

Unknown caller remains a phone-based Conversation.

Existing operator tools from Prompts 54–56 remain available later.

==================================================
22. SECURITY / TENANT ISOLATION
==================================================

Verify:

- CallInteraction tenant/business matches Conversation;
- destination comes from CallInteraction canonical caller;
- browser cannot supply another destination for recovery;
- channel connection belongs to same tenant/business;
- customer link cannot cross tenant;
- Message/Delivery cannot cross tenant;
- no endpoint exposes another tenant's recovery state;
- system-origin action does not bypass ownership boundaries.

Add tenant-isolation tests.

==================================================
23. RECOVERY TRIGGER
==================================================

MCR-2 ends synchronously after webhook intake.

We need a safe mechanism to run recovery after the call becomes READY.

Do not hold a telephony webhook open while performing slow outbound work unless the existing architecture strongly supports that pattern.

Evaluate the current Vercel/serverless architecture.

Implement the smallest safe MCR-4 trigger.

Possible approaches:

- explicit internal recovery endpoint;
- claim-and-process service invoked after intake;
- Vercel-compatible deferred mechanism already present;
- development/manual processor for now.

IMPORTANT:

Do not invent an in-memory background queue that disappears when a serverless function terminates.

If reliable automatic background execution requires infrastructure not currently present, do NOT fake durability.

In that case:

1. implement durable READY/claim/recovery processing;
2. expose a secure deterministic processor trigger appropriate for current architecture;
3. document the production scheduler/queue requirement.

The vertical slice must still be testable end-to-end.

==================================================
24. MOCK RECOVERY CHANNEL
==================================================

Provide a mock channel that can prove the complete recovery flow.

It should support:

- eligible destination;
- successful send;
- deterministic provider message ID;
- duplicate/idempotent send;
- simulated failure;
- optional simulated inbound customer reply if this fits existing mock channel infrastructure.

Never enable it in production accidentally.

Use explicit environment/testing controls.

No secret should be committed.

==================================================
25. LIVE VERTICAL-SLICE VERIFICATION
==================================================

Use the existing test tenant and mock telephony + mock recovery channel.

Verify at least:

CASE 1 — KNOWN CUSTOMER, MISSED CALL

    mock incoming call
    → MISSED
    → READY
    → recovery processor
    → CLAIMED
    → Conversation
    → deterministic first message
    → ChannelDelivery
    → SENT

Verify:

- customer linked;
- one conversation;
- one outbound message;
- one delivery;
- no AI;
- no request;
- no appointment.

CASE 2 — UNKNOWN CUSTOMER

Expected:

- no Customer auto-created;
- phone-based Conversation;
- first recovery message still works.

CASE 3 — ANSWERED CALL

Expected:

- no recovery.

CASE 4 — DUPLICATE PROCESSOR INVOCATION

Call recovery processor twice.

Expected:

- one customer message only.

CASE 5 — CONCURRENT PROCESSORS

Expected:

- one claim;
- one send.

CASE 6 — REPEATED MISSED CALLS

Three separate missed calls within anti-spam window.

Expected:

- all three CallInteractions preserved;
- only first sends recovery;
- later ones suppressed according to policy.

CASE 7 — OUTSIDE ANTI-SPAM WINDOW

Expected:

- later genuine missed call can become eligible for a new recovery.

CASE 8 — LATE ANSWER

    MISSED
    → READY
    → before irreversible send, ANSWERED arrives

Expected:

- no recovery message.

CASE 9 — NO ELIGIBLE CHANNEL

Expected:

- no message;
- truthful recovery state;
- no fake SENT.

CASE 10 — CHANNEL FAILURE

Expected:

- failure recorded;
- retry semantics correct;
- no uncontrolled duplicate.

CASE 11 — MOCK CUSTOMER REPLY

If mock inbound reply is supported:

    first recovery sent
    → customer replies

Expected:

- inbound message stored in same Conversation;
- NO automatic AI reply.

CASE 12 — TENANT ISOLATION

Expected:

- no cross-tenant Call/Conversation/Channel/Customer access.

==================================================
26. AUTOMATED TESTS
==================================================

Add focused tests for:

A. Recovery state machine
B. atomic claiming
C. concurrent claiming
D. late-answer cancellation
E. anti-spam
F. anti-spam boundary
G. failed recovery vs future call
H. channel routing
I. no-channel behavior
J. Conversation creation/reuse
K. Call ↔ Conversation relation
L. system-origin message
M. delivery integration
N. adapter failure
O. retry/idempotency
P. known customer
Q. unknown caller
R. tenant isolation
S. no AI invocation
T. no CustomerRequest
U. no Appointment
V. no customer auto-create

Avoid brittle assertions against unrelated UI text.

==================================================
27. MINIMAL OPERATOR VISIBILITY
==================================================

Do not redesign Dashboard or Operations.

If existing Conversation Detail naturally shows sender/origin, ensure the automated first message is understandable there.

For example it may visually distinguish:

    AUTOSERVISE
    Автоматическое сообщение

from:

    Администратор

Do not create a major new Calls page.

Do not redesign Conversations.

If no UI change is necessary for correctness, keep this backend-focused.

==================================================
28. EXISTING FEATURES MUST REMAIN INTACT
==================================================

Verify regressions for:

- normal staff outbound messages;
- Telegram existing behavior;
- Conversation detail;
- AI Draft Prompt 53;
- customer intake Prompt 54;
- qualification Prompt 55;
- booking Prompt 56;
- phone identity MCR-1;
- call intake MCR-2;
- pricing/location MCR-3.

Do not change existing product behavior outside recovery scope.

==================================================
29. DATABASE / SUPABASE
==================================================

Create NEW migration(s) only.

Do not edit applied migrations.

Requirements:

- additive where possible;
- no DB reset;
- no destructive cleanup;
- no modification of real tenant data;
- proper indexes for recovery lookup;
- proper constraints for Call ↔ Conversation if added;
- system-origin schema backward compatible.

Apply migration using established Supabase workflow.

Verify migration status.

==================================================
30. VALIDATION
==================================================

Run at minimum:

- Prisma validate;
- migration status;
- TypeScript typecheck;
- focused MCR-4 tests;
- tenant isolation tests;
- full test suite;
- production build.

The pre-existing repository-wide `prisma format --check`
issue may remain if unchanged.

Do not reformat unrelated legacy schema solely for this prompt.

==================================================
31. DOCUMENTATION
==================================================

Create:

    docs/prompts/mcr-4.md

    docs/final-reports/final-report-mcr-4.md

Update:

- PRODUCT_BLUEPRINT
- missed-call architecture audit
- relevant channel/delivery docs

only where materially required.

The Final Report must include:

1. baseline;
2. schema changes;
3. recovery state machine;
4. atomic claim design;
5. late-answer handling;
6. anti-spam rule and exact window;
7. first recovery template;
8. channel router design;
9. capability model;
10. no-channel behavior;
11. Conversation creation;
12. Call ↔ Conversation relation;
13. system-origin design;
14. Message/ChannelDelivery integration;
15. delivery success semantics;
16. failure/retry semantics;
17. recovery latency timestamps;
18. recovery trigger/background-execution decision;
19. mock recovery channel;
20. proof no AI auto-reply occurs;
21. proof no Customer/Request/Appointment auto-creation;
22. tenant isolation;
23. live vertical-slice verification;
24. tests count;
25. Prisma/typecheck/build;
26. Supabase migration result;
27. files changed;
28. remaining test data;
29. known limitations;
30. exact readiness for MCR-5 and real WhatsApp;
31. Git result.

==================================================
32. CRITICAL PRODUCT CHECK
==================================================

At the end explicitly answer:

Given:

    a customer calls the configured business number;
    nobody answers;
    the call becomes MISSED;
    caller phone is valid;
    a recovery-capable mock channel exists;

Can AUTOSERVISE now automatically produce:

    "Здравствуйте! Вы только что звонили в автосервис.
     Мастер сейчас занят и не смог ответить.
     Подскажите, пожалуйста, с каким вопросом обращаетесь?"

without:

- an operator pressing a button;
- AI generating the first message;
- duplicate sends;
- creating a fake customer;
- pretending an owner sent it?

Answer YES / PARTIAL / NO and explain precisely.

Also answer:

What remains before the same flow can happen through REAL WhatsApp?

Do not implement real WhatsApp in MCR-4.

==================================================
33. GIT — COMPLETE THE WORKFLOW YOURSELF
==================================================

The user must NOT need to run Git or PowerShell manually.

After implementation:

1. inspect git status;
2. inspect final diff;
3. ensure only intended MCR-4 changes;
4. ensure no secrets/.env committed;
5. include migration;
6. commit intended changes.

Suggested commit:

    feat: add missed call recovery engine

7. push:

    origin/master

8. no force push;
9. verify master == origin/master;
10. verify clean working tree.

==================================================
34. STOP CONDITION
==================================================

MCR-4 is complete only when:

- READY calls can be atomically claimed;
- concurrent processors cannot duplicate recovery;
- late ANSWERED state prevents inappropriate send;
- repeated calls are anti-spam protected;
- channel selection is provider-neutral;
- a mock recovery channel works;
- first message is deterministic;
- first message is NOT generated by AI;
- Conversation is created/reused safely;
- CallInteraction is linked to recovery Conversation;
- automated Message has truthful system origin;
- existing ChannelDelivery lifecycle is reused;
- recovery success/failure is durable;
- recovery latency timestamps exist;
- no AI auto-response occurs;
- no Customer is auto-created;
- no CustomerRequest is auto-created;
- no Appointment is auto-created;
- tenant isolation is preserved;
- live mock vertical slice passes;
- migration is applied;
- tests pass;
- build/typecheck/Prisma pass;
- documentation complete;
- commit pushed;
- local and remote synchronized;
- working tree clean.

DO NOT proceed to MCR-5.

Return the complete MCR-4 Final Report and STOP.
