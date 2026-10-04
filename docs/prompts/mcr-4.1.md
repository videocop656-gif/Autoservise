# MCR-4.1 — Durable Recovery Trigger with Vercel Queues

> Verbatim — reproduced exactly as provided in the development
> conversation for this project (not reconstructed, not paraphrased).

---

# MCR-4.1 — DURABLE RECOVERY TRIGGER WITH VERCEL QUEUES

You are working in the existing AUTOSERVISE repository.

This is a narrow infrastructure hardening step after MCR-4.

Expected baseline:

    baf8874
    feat: add missed call recovery engine

MCR-4 already implements and MUST preserve:

    missed call
    → CallInteraction READY
    → atomic claim
    → anti-spam
    → recovery channel router
    → deterministic MISSED_CALL_RECOVERY_V1
    → Conversation
    → SYSTEM Message
    → ChannelDelivery
    → SENT / FAILED / SUPPRESSED

MCR-4 tests:

    1878 / 1878

MCR-4 deliberately left one production gap:

    READY records are processed by
    POST /api/internal/recovery/process

but production currently has no durable automatic trigger.

MCR-4.1 closes ONLY that gap.

==================================================
0. PRODUCT GOAL
==================================================

AUTOSERVISE's core promise is speed after a missed call:

    Мастер занят машиной —
    AUTOSERVISE занят клиентом.

We cannot require a human to invoke the recovery processor.

Target production architecture:

    telephony webhook
        ↓
    CallInteraction becomes READY
        ↓
    publish durable recovery job
        ↓
    webhook can return promptly
        ↓
    Vercel Queue consumer
        ↓
    existing MCR-4 Recovery Engine
        ↓
    READY → CLAIMED → SENT / FAILED / SUPPRESSED

Use Vercel Queues as the preferred production durable trigger
IF the current repository/runtime is compatible with the current
official Vercel Queues SDK and configuration.

IMPORTANT:

Vercel Queues provides at-least-once delivery.

Therefore queue delivery itself MUST NOT be treated as exactly once.

MCR-4's existing atomic claim, idempotency and delivery protections
remain the source of truth for duplicate prevention.

==================================================
1. HARD SCOPE
==================================================

IMPLEMENT:

- Vercel Queues integration for recovery triggering;
- durable publish when a CallInteraction becomes recovery-ready;
- queue consumer that invokes/reuses existing MCR-4 Recovery Engine;
- publish idempotency;
- queue delivery idempotency;
- safe handling of publish failure;
- safe handling of consumer retry;
- observability-safe structured logs/metadata;
- local/test fallback or test abstraction;
- preserve internal recovery processor as reconciliation/backstop;
- tests;
- docs;
- Git workflow.

DO NOT IMPLEMENT:

- MCR-5;
- automatic AI replies;
- real WhatsApp;
- Meta integration;
- real SMS;
- real telephony provider;
- Vercel Workflow unless Queues is proven incompatible;
- Redis;
- BullMQ;
- RabbitMQ;
- Kafka;
- external queue provider;
- new dashboard;
- Calls UI;
- Operations redesign;
- CustomerRequest creation;
- Appointment creation;
- landing page changes.

==================================================
2. VERIFY CURRENT VERCEL QUEUES API FIRST
==================================================

Before coding, inspect the CURRENT official Vercel Queues documentation
and SDK API available at implementation time.

Do not rely on stale examples or guessed package APIs.

Expected current conceptual API is based on:

    @vercel/queue

with producer/consumer concepts such as:

    send(...)
    handleCallback(...)

and Vercel function queue triggers.

But VERIFY the exact current API, package version and configuration
before implementing.

Use official Vercel documentation as the source of truth.

If the current official SDK materially differs from this prompt,
adapt implementation to the official API and document the difference.

Do NOT invent APIs.

==================================================
3. BASELINE AUDIT
==================================================

Before changes:

1. verify branch master;
2. verify HEAD:

       baf8874

3. verify origin/master matches;
4. verify clean working tree;
5. inspect package.json;
6. inspect Vercel configuration;
7. inspect current API/function layout;
8. inspect MCR-2 call intake;
9. inspect MCR-4 recovery service/repository;
10. inspect:

       POST /api/internal/recovery/process

11. inspect current env validation;
12. inspect test architecture;
13. inspect existing deployment assumptions.

Read:

    docs/final-reports/final-report-mcr-4.md
    docs/prompts/mcr-4.md
    docs/PRODUCT_BLUEPRINT.md
    docs/audits/missed-call-recovery-architecture-audit.md

If baseline materially differs, STOP and report.

==================================================
4. DO NOT REWRITE MCR-4
==================================================

This is critical.

Do not create:

    QueueRecoveryEngine

as a second recovery implementation.

The queue consumer must call the SAME domain/application service
used by the existing recovery processor.

There must remain ONE implementation of:

- atomic claiming;
- late-answer protection;
- anti-spam;
- channel selection;
- Conversation creation;
- SYSTEM message creation;
- ChannelDelivery;
- retry rules;
- recovery state transitions.

Queue is only a trigger/transport.

==================================================
5. QUEUE TOPIC
==================================================

Create one narrowly scoped recovery topic.

Use a stable explicit name, for example:

    missed-call-recovery

or another repository-consistent equivalent.

Centralize it.

Do not dynamically create a topic per tenant/business.

Queue message should contain the minimum safe identifier required
to locate the durable database record.

Prefer conceptually:

    {
      callInteractionId: "..."
    }

Do NOT put into the queue payload unless strictly necessary:

- customer name;
- raw phone number;
- message text;
- tenant secrets;
- provider credentials;
- raw webhook body;
- full Conversation;
- full CallInteraction.

The database remains the source of truth.

==================================================
6. PUBLISH POINT
==================================================

Find the authoritative point where MCR-2 transitions an eligible
CallInteraction to READY.

Publish the queue job only after the database state making the call
eligible has committed successfully.

Do NOT publish a job for:

- ANSWERED;
- outbound calls;
- invalid/anonymous caller;
- NOT_ELIGIBLE;
- PENDING;
- calls that never become READY.

Be careful about the DB transaction / queue publish boundary.

We cannot atomically commit PostgreSQL and Vercel Queue in one
distributed transaction.

Design explicitly for this.

==================================================
7. DB ↔ QUEUE CONSISTENCY
==================================================

This is one of the main goals of MCR-4.1.

Failure scenario:

    DB commits READY
    ↓
    queue publish fails

The call MUST NOT be lost forever.

The existing:

    POST /api/internal/recovery/process

must remain as reconciliation/backstop for READY/FAILED/stale records.

Do not delete it.

Implement the smallest reliable approach consistent with the repository.

Possible acceptable design:

A. commit READY;
B. publish queue message with deterministic idempotency key;
C. if publish fails:
       keep durable READY state;
       log safely;
       return/handle according to webhook retry semantics;
D. reconciliation processor can later find the READY record.

Do not mark the CallInteraction SENT/CLAIMED merely because a queue
message was published.

Queue publication is NOT recovery success.

==================================================
8. PUBLISH IDEMPOTENCY
==================================================

Telephony providers retry webhooks.

MCR-2 already deduplicates call events.

Queue publishing must also tolerate repeated attempts.

Use Vercel Queue's current official idempotency/deduplication facility
if available.

Use a deterministic key based on the durable recovery identity,
for example conceptually:

    missed-call-recovery:<callInteractionId>

Do not use random UUID as the only publish dedupe key.

Even if the same queue message is published/delivered twice,
MCR-4 must still prevent duplicate customer messages.

Test this.

==================================================
9. QUEUE CONSUMER
==================================================

Create the Vercel Queue consumer using the CURRENT official SDK/API.

Consumer receives only the durable identifier.

Then:

1. validate payload;
2. load CallInteraction from DB;
3. invoke existing MCR-4 recovery processing;
4. rely on existing atomic claim/idempotency;
5. acknowledge/succeed only according to correct queue semantics.

Do NOT trust tenantId/businessId supplied by queue payload.

Resolve ownership from the database record.

Malformed payload must not cause cross-tenant access.

==================================================
10. AT-LEAST-ONCE DELIVERY
==================================================

Explicitly test Vercel Queue semantics conceptually:

same callInteractionId delivered:

    once
    twice
    five times concurrently

Expected:

    exactly one customer-facing initial recovery message.

Do not claim exactly-once queue delivery.

Correct statement:

    Queue delivery is at-least-once.
    Customer-facing effect is protected by MCR-4 idempotency.

==================================================
11. CONSUMER FAILURE / RETRY
==================================================

Test:

    queue consumer starts
    → recovery processing throws before irreversible send

Expected:

- queue retry can happen;
- durable CallInteraction remains recoverable;
- MCR-4 rules decide whether retry is allowed.

Also test:

    provider accepted message
    → queue callback fails afterwards

Expected:

- no duplicate customer message on redelivery;
- existing ChannelDelivery/idempotency semantics remain authoritative.

Respect MCR-4's DELIVERY_UNCERTAIN behavior.

Do not weaken it.

==================================================
12. LATE ANSWER MUST STILL WIN
==================================================

Scenario:

    call becomes MISSED
    → READY
    → queue job published
    → before consumer executes, ANSWERED arrives

Expected:

queue consumer invokes existing recovery engine,
which re-checks CallInteraction and does NOT send.

Do not assume:

    queue message exists = must send.

Database state is authoritative.

Test this path.

==================================================
13. ANTI-SPAM MUST STILL WORK
==================================================

Queue integration must not bypass MCR-4's 15-minute anti-spam rule.

Three missed calls may generate three queue jobs.

That is acceptable.

Recovery engine must still produce:

    first → recovery sent
    second → suppressed
    third → suppressed

Do not implement anti-spam in the queue producer.

Keep business policy in MCR-4.

==================================================
14. INTERNAL PROCESSOR REMAINS
==================================================

Keep:

    POST /api/internal/recovery/process

It now serves as:

- reconciliation;
- operational backstop;
- recovery of READY records whose queue publish failed;
- recovery of stale CLAIMED/FAILED records according to existing rules.

Do not make normal production flow depend on a human calling it.

Update its documentation to clarify its new role.

Do not weaken its Bearer-secret protection.

==================================================
15. PRODUCTION ENABLEMENT
==================================================

Queue publishing/consuming must be explicitly production-safe.

Do not require:

    RECOVERY_MOCK_CHANNEL_ENABLED

for the queue itself.

Queue trigger and recovery channel are separate concerns.

For local development/test:

do not require a real Vercel Queue account just to run unit tests.

Introduce a small queue publisher abstraction if necessary:

    RecoveryJobPublisher

with:

    Vercel implementation
    test/mock implementation

Do not overbuild a general event bus.

==================================================
16. ENV / SECRETS
==================================================

Audit current official Vercel Queue configuration.

Do not invent or manually commit secrets that Vercel manages
automatically.

Do not commit `.env`.

If local development requires environment values, document them in
the existing env example/documentation pattern without real secrets.

Validate optional/required env values appropriately.

No secret may appear in:

- Git;
- logs;
- queue payload;
- API response;
- Final Report.

==================================================
17. VERCEL CONFIGURATION
==================================================

Configure the consumer according to the CURRENT official Vercel
Queues deployment model.

If current Vercel requires a function trigger configuration in
`vercel.json`, add the minimal configuration.

Do not break existing Vercel serverless routes.

Verify:

- Vite frontend build remains correct;
- existing `/api/*` functions remain correct;
- queue consumer is deployable;
- no Next.js assumptions are introduced into this Vite project.

This project is Vite + React frontend with Vercel serverless Node/TS API.

Adapt official examples to THIS architecture.

==================================================
18. WEBHOOK RESPONSE LATENCY
==================================================

Do not make the telephony webhook wait for the actual recovery send.

Target:

    telephony event
    → DB intake
    → durable queue publish
    → webhook response

Recovery send happens independently in consumer.

Measure/verify conceptually that:

    channel provider latency
    AI latency
    Conversation send latency

are not on the telephony webhook critical path.

AI is not involved anyway.

==================================================
19. OBSERVABILITY
==================================================

Add minimal safe observability.

Useful fields:

- queue message id;
- callInteractionId;
- processing result category;
- queue attempt metadata if available;
- recovery state.

Do NOT log:

- full phone numbers;
- raw webhook payload;
- customer message contents;
- secrets;
- provider credentials.

Use existing phone masking helper if any phone is ever logged.

Do not build an observability dashboard.

==================================================
20. QUEUE PAYLOAD VALIDATION
==================================================

Validate the consumer payload.

Reject/no-op malformed messages safely.

Examples:

- missing callInteractionId;
- invalid identifier shape;
- nonexistent record.

Do not let malformed queue payloads trigger arbitrary database queries
or cross-tenant behavior.

==================================================
21. NO BUSINESS LOGIC IN QUEUE LAYER
==================================================

The queue layer must NOT decide:

- whether the call is still missed;
- anti-spam;
- channel choice;
- customer identity;
- template text;
- Conversation reuse;
- delivery retry policy.

Those remain in MCR-4.

Queue layer only:

    publish durable work
    → consume durable work
    → invoke recovery service

==================================================
22. NO AI
==================================================

MCR-4.1 must not invoke AI.

Add/retain test traps proving:

- queue publish does not call AI;
- queue consumer does not call AI directly;
- recovery remains deterministic;
- inbound customer reply still does not trigger automatic AI.

MCR-5 remains untouched.

==================================================
23. NO EXTRA DOMAIN CREATION
==================================================

Queue processing must NOT automatically create:

- Customer;
- Vehicle;
- CustomerRequest;
- Appointment;
- ServiceRecord.

Conversation/System Message behavior remains exactly MCR-4.

==================================================
24. TEST PLAN
==================================================

Add focused tests for at least:

A. READY publishes recovery job.

B. ANSWERED does not publish.

C. NOT_ELIGIBLE does not publish.

D. duplicate telephony event does not cause harmful duplicate effect.

E. repeated publish uses deterministic idempotency.

F. duplicate queue delivery:
       one customer message.

G. five concurrent queue deliveries:
       one customer message.

H. late ANSWERED after publish:
       no customer message.

I. three calls inside anti-spam window:
       jobs may exist;
       only first recovery sends.

J. publish failure:
       CallInteraction remains durable/recoverable.

K. reconciliation processor later recovers READY record.

L. consumer failure before send:
       retry safe.

M. consumer failure/redelivery after provider acceptance:
       no duplicate send.

N. malformed queue payload:
       safe failure/no cross-tenant access.

O. nonexistent callInteractionId:
       safe behavior.

P. queue payload cannot choose tenant/business.

Q. no AI.

R. no Customer auto-create.

S. no CustomerRequest.

T. no Appointment.

U. existing internal processor still works.

V. existing MCR-4 mock vertical slice still works.

==================================================
25. LIVE / INTEGRATION VERIFICATION
==================================================

Where possible without requiring unsafe production changes:

verify the vertical path:

    mock telephony MISSED
    → CallInteraction READY
    → recovery job publisher
    → queue consumer/test equivalent
    → MCR-4 Recovery Engine
    → mock recovery channel
    → Conversation
    → SYSTEM Message
    → ChannelDelivery SENT

If a real Vercel Queue cannot be executed locally without deployment,
do NOT fake a claim that it was tested against Vercel infrastructure.

Instead clearly distinguish:

    local integration test
    vs
    real deployed Vercel Queue verification.

If deployment credentials/project are already safely available and
the repository workflow supports preview deployment without user
manual work, you may verify it.

Do not require the user to configure Vercel manually during this prompt.

==================================================
26. IMPORTANT BETA BOUNDARY
==================================================

Vercel Queues is currently a beta product.

Document this fact.

Do not hide it.

Architecture should keep:

    RecoveryJobPublisher

small enough that another durable queue implementation could replace
Vercel Queues later without rewriting MCR-4.

Do NOT implement another provider now.

==================================================
27. FALLBACK DECISION
==================================================

If CURRENT official Vercel Queues proves incompatible with this
Vite + Vercel Functions repository:

STOP before introducing another infrastructure provider.

Do NOT silently switch to:

- Redis;
- Upstash;
- BullMQ;
- Workflow;
- Cron-only.

Instead document:

- exact incompatibility;
- evidence;
- smallest alternatives.

But only do this if genuine incompatibility is found.

==================================================
28. REGRESSION
==================================================

Verify existing functionality remains intact:

- MCR-1 Phone Identity;
- MCR-2 Call Intake;
- MCR-3 Pricing/Location;
- MCR-4 Recovery Engine;
- staff outbound delivery;
- Telegram existing behavior;
- Conversation Detail;
- Prompt 53 AI Draft;
- Prompt 54 customer intake;
- Prompt 55 qualification;
- Prompt 56 booking.

Do not change their behavior.

==================================================
29. DATABASE
==================================================

First determine whether MCR-4.1 actually requires schema changes.

Prefer NO new Prisma model if queue durability itself is provided by
Vercel and current CallInteraction already contains enough durable
state.

Do not add a duplicate Jobs table merely because queues exist.

If a schema change is genuinely necessary:

- explain why;
- create a NEW additive migration;
- never edit applied migrations;
- apply safely to Supabase.

If no schema change is needed, explicitly say so.

==================================================
30. VALIDATION
==================================================

Run:

- TypeScript typecheck;
- production build;
- Prisma validate;
- migrate status;
- focused MCR-4.1 tests;
- MCR-4 regression tests;
- tenant isolation tests;
- full test suite.

The existing unrelated `prisma format --check` legacy issue may remain
if unchanged.

Do not reformat unrelated legacy schema solely for this task.

==================================================
31. DOCUMENTATION
==================================================

Create:

    docs/prompts/mcr-4.1.md
    docs/final-reports/final-report-mcr-4.1.md

Update as materially required:

    docs/PRODUCT_BLUEPRINT.md
    docs/audits/missed-call-recovery-architecture-audit.md

Document:

- why Queue rather than Cron as primary trigger;
- at-least-once semantics;
- idempotency boundary;
- DB↔Queue publish gap;
- reconciliation role of internal processor;
- beta status;
- production deployment requirements;
- local vs real Vercel verification.

==================================================
32. FINAL REPORT
==================================================

Final Report must include:

1. baseline commit;
2. current official Vercel Queue API verified;
3. package/version added;
4. topic name;
5. producer implementation;
6. exact READY publish point;
7. queue payload;
8. publish idempotency strategy;
9. DB↔Queue consistency strategy;
10. consumer implementation;
11. how existing MCR-4 service is reused;
12. at-least-once handling;
13. duplicate delivery proof;
14. concurrent delivery proof;
15. late-answer proof;
16. anti-spam regression;
17. publish failure behavior;
18. consumer retry behavior;
19. provider-accepted/redelivery behavior;
20. reconciliation processor behavior;
21. Vercel configuration;
22. environment/secrets;
23. webhook critical-path effect;
24. observability;
25. tenant/security validation;
26. proof AI is not called;
27. proof no Customer/Request/Appointment is auto-created;
28. local integration verification;
29. whether REAL Vercel Queue was tested;
30. tests before/after;
31. build/typecheck/Prisma result;
32. migration result or explicit "no migration";
33. files changed;
34. known limitations;
35. beta-risk note;
36. readiness for MCR-5;
37. Git result.

==================================================
33. CRITICAL ACCEPTANCE TEST
==================================================

At the end answer YES / PARTIAL / NO:

Given:

    customer calls
    → call is missed
    → MCR-2 commits CallInteraction READY

Can AUTOSERVISE now, in a deployed Vercel environment with Queues
configured, automatically trigger MCR-4 recovery WITHOUT:

- operator pressing a button;
- Cron waiting for the next minute;
- an in-memory timer;
- AI generating the first message?

Explain precisely.

Also answer:

If queue publication fails immediately after READY is committed,
can the call still be recovered later?

Expected architectural answer should be YES via durable DB state +
reconciliation, but prove it from implementation.

==================================================
34. GIT — COMPLETE EVERYTHING YOURSELF
==================================================

The user must not run Git or PowerShell manually.

After implementation:

1. inspect git status;
2. inspect diff;
3. ensure only intended MCR-4.1 changes;
4. ensure no secrets/.env committed;
5. run validation;
6. commit intended changes.

Suggested commit:

    feat: add durable recovery queue trigger

7. push:

    origin/master

8. never force push;
9. verify local master == origin/master;
10. verify clean working tree;
11. include commit hash in Final Report.

If there are no legitimate code changes because official Vercel Queues
is incompatible, do not create a fake implementation or empty commit.

==================================================
35. STOP CONDITION
==================================================

MCR-4.1 is complete only when:

- durable recovery publication exists;
- READY calls enqueue work;
- queue consumer invokes existing MCR-4 engine;
- queue duplicates cannot duplicate customer messages;
- concurrent consumers cannot duplicate customer messages;
- late ANSWERED still prevents send;
- anti-spam still works;
- publish failure leaves call recoverable;
- internal processor remains as reconciliation;
- no in-memory queue/timer is used;
- no Cron is the primary trigger;
- no AI is invoked;
- no Customer/Request/Appointment is auto-created;
- tests pass;
- build/typecheck/Prisma pass;
- docs are complete;
- intended changes are committed and pushed;
- master and origin/master match;
- working tree is clean.

DO NOT START MCR-5.

Return the complete MCR-4.1 Final Report and STOP.
