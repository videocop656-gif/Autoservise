# MCR-2 — Missed Call Intake Foundation

> Verbatim — reproduced exactly as provided in the development
> conversation for this project (not reconstructed, not paraphrased).

---

# MCR-2 — MISSED CALL INTAKE FOUNDATION

You are working in the existing AUTOSERVISE repository.

This is the SECOND implementation step after:

- Prompt 57 — Missed Call Recovery Architecture Audit
- MCR-1 — Phone Identity Foundation

MCR-1 established canonical E.164 customer phone identity.

Expected current baseline:

    6e7493a
    feat: add canonical phone identity foundation

The product direction remains:

    missed phone call
    → immediate recovery
    → useful customer dialogue
    → visit / booking / human handoff

MCR-2 builds the durable, provider-neutral CALL INTAKE FOUNDATION.

This prompt must allow AUTOSERVISE to reliably understand:

    a phone call happened
    → which business received it
    → who called
    → whether it was answered or missed
    → whether this call has already been processed
    → whether an existing customer can be identified

But MCR-2 MUST NOT contact the customer yet.

==================================================
0. HARD SCOPE BOUNDARY
==================================================

IMPLEMENT:

- business phone identity/routing foundation;
- durable call interaction storage;
- provider-neutral telephony event contract;
- MOCK telephony provider/adapter;
- secure mock webhook/inbound endpoint;
- event idempotency;
- out-of-order event handling;
- missed/answered outcome calculation;
- customer resolution using MCR-1;
- recovery eligibility/state preparation;
- timestamps needed for future latency measurement;
- tests;
- documentation;
- Git commit + push.

DO NOT IMPLEMENT:

- real Kcell integration;
- any other real telephony provider;
- WhatsApp;
- SMS;
- Telegram recovery;
- Channel Router;
- sending the first recovery message;
- AI auto-replies;
- automatic Customer creation;
- CustomerRequest creation from calls;
- Appointment creation;
- owner notifications;
- dashboard redesign;
- Operations redesign;
- background queue infrastructure unless strictly required for safe call ingestion;
- voice AI;
- STT/TTS;
- call recording;
- MCR-3 or later work.

The STOP condition is a correctly persisted missed-call event.

==================================================
1. BASELINE / SAFETY CHECK
==================================================

Before changing anything:

1. Inspect actual repository state.
2. Verify branch is `master`.
3. Verify expected HEAD and origin/master:

       6e7493a

4. Verify working tree is clean.

5. Read the actual implementation and docs for:

   - Prompt 57 audit;
   - MCR-1;
   - Prisma schema;
   - Business;
   - Customer;
   - phone normalization;
   - customer phone resolution;
   - ChannelConnection;
   - ChannelDelivery;
   - Telegram webhook architecture;
   - webhook secret verification;
   - inbound message idempotency;
   - tenant isolation;
   - AuditLog;
   - Conversations;
   - serverless API conventions;
   - tests.

Do not copy the Telegram implementation mechanically.

Reuse patterns only where they make sense for telephony.

If the repository materially differs from the expected baseline, STOP and report before implementation.

==================================================
2. ARCHITECTURAL GOAL
==================================================

The future real flow may look like:

    Public phone network
        ↓
    Telephony provider
        ↓
    provider webhook
        ↓
    AUTOSERVISE telephony adapter
        ↓
    Business phone identity
        ↓
    CallInteraction
        ↓
    missed / answered
        ↓
    existing Customer resolution
        ↓
    future Recovery Engine

MCR-2 implements everything through CallInteraction.

It stops BEFORE the Recovery Engine sends anything.

Provider-specific payloads must NOT leak into core domain logic.

==================================================
3. BUSINESS PHONE IDENTITY
==================================================

MCR-1 found that:

    Business.phone

is free text and is not sufficient for future:

    called number → Business

routing.

Implement the smallest durable business-phone identity model appropriate to the existing architecture.

Prefer a dedicated entity rather than turning Business.phone into a telephony routing key.

Conceptually something like:

    BusinessPhoneNumber

Possible required fields:

- id
- tenantId
- businessId
- phoneE164
- displayLabel / label if useful
- isActive
- createdAt
- updatedAt

Do NOT blindly use this exact schema if the repository suggests a better minimal design.

Requirements:

- canonical E.164;
- tenant-owned;
- business-owned;
- indexed;
- usable for inbound called-number routing;
- active/inactive lifecycle;
- preserve Business.phone as existing display/contact data;
- no accidental cross-tenant reassignment.

IMPORTANT:

For an inbound public telephone number used as a routing identity, two active businesses cannot safely claim the same number simultaneously.

Design and enforce the appropriate invariant.

Consider whether uniqueness should be:

    active canonical business number globally

rather than tenant-only.

If partial uniqueness is required and Prisma cannot express it cleanly, use an explicit SQL migration/index where appropriate and document it.

Do not build number porting UI.

Do not build telephony provisioning.

==================================================
4. NUMBER OWNERSHIP / SAFE ROUTING
==================================================

Future webhook processing must NEVER trust a tenantId or businessId supplied by the provider payload.

The provider supplies a CALLED NUMBER.

AUTOSERVISE resolves:

    called phoneE164
        →
    one active business phone identity
        →
    tenantId + businessId

This must be the source of tenant routing.

If:

- no active business number matches:
    reject/do not ingest into a tenant.

- routing is ambiguous:
    fail closed.

Never guess the tenant.

Never use caller phone to determine tenant.

Add tests proving this.

==================================================
5. TELEPHONY PROVIDER ABSTRACTION
==================================================

Create a provider-neutral telephony boundary.

Do not couple the core to Kcell.

Conceptually evaluate an interface such as:

    TelephonyAdapter

with responsibilities such as:

- authenticate/verify inbound event;
- parse provider payload;
- return normalized provider-neutral call event.

The normalized event should contain only domain-relevant data.

Possible shape:

    provider
    providerEventId
    providerCallId
    eventType
    direction
    callerPhone
    calledPhone
    occurredAt
    providerStatus / normalized status

Do not persist arbitrary provider JSON unless there is a concrete audit/debug reason.

If raw payload persistence is needed, explicitly justify:
- privacy;
- retention;
- size;
- secrets;
- PII.

Prefer minimal storage.

==================================================
6. MOCK TELEPHONY PROVIDER
==================================================

Implement a MOCK telephony adapter so the entire call intake flow can be tested before choosing a real provider.

The mock must be realistic enough to simulate:

- incoming call started/ringing;
- call answered;
- call completed after answer;
- call missed/unanswered;
- duplicate webhook;
- webhook retry;
- events arriving out of order;
- unknown business number;
- invalid caller number;
- repeated calls from same caller;
- two different calls from same caller.

Do not make the mock a production backdoor.

It must follow the repository's existing environment/testing conventions.

If a mock webhook is exposed in development, secure it using the same philosophy as existing webhook endpoints.

==================================================
7. CALL INTERACTION DOMAIN MODEL
==================================================

Create ONE durable domain record per real phone call.

Use a name such as:

    CallInteraction

if that remains the best fit after inspecting the repository.

Do NOT create one record per webhook event.

At minimum evaluate storage for:

IDENTITY
- id
- tenantId
- businessId
- businessPhoneNumberId
- provider
- providerCallId

CALLER
- callerPhoneE164 if valid
- customerId nullable

CALL STATE
- direction
- status/outcome
- startedAt
- answeredAt nullable
- endedAt nullable

RECOVERY PREPARATION
- whether the call is eligible for recovery;
- recovery state;
- recovery claim/sent state only if needed now for future idempotency.

LATENCY
- detectedAt / missedDetectedAt or equivalent;
- timestamps that will later allow:

      missed call detected
          →
      recovery message sent

AUDIT
- createdAt
- updatedAt

Do not over-model fields that are not needed yet.

==================================================
8. CALL STATUS / OUTCOME STATE MACHINE
==================================================

Real telephony webhooks can arrive as several events.

Design a monotonic state machine that can safely interpret:

    ringing
    answered
    completed
    missed / no-answer

The system must distinguish at least:

- call still in progress / unknown final outcome;
- answered call;
- missed/unanswered call.

CRITICAL RULE:

Once there is reliable evidence that the call was ANSWERED,
a late/retried "ringing" event must never turn it into MISSED.

Likewise:

events arriving out of order must not regress final truth.

Do not assume webhook delivery order.

Document the transition rules.

==================================================
9. PROVIDER EVENT IDEMPOTENCY
==================================================

Providers retry webhooks.

MCR-2 must be safe under:

    same providerEventId delivered repeatedly

and under:

    multiple distinct events for the same providerCallId.

Implement durable idempotency.

Requirements:

- exact duplicate provider event does not create duplicate side effects;
- one provider call produces one CallInteraction;
- retries are safe;
- concurrency is safe;
- no duplicate call record under simultaneous delivery.

Use database constraints/transactions/locking where appropriate.

Do not rely only on "check then insert" in application memory.

==================================================
10. OUT-OF-ORDER EVENTS
==================================================

Test realistic sequences such as:

A:

    ringing
    → missed

B:

    ringing
    → answered
    → completed

C:

    missed
    → delayed ringing

D:

    completed(answered)
    → delayed answered

E:

    duplicate missed
    → duplicate missed

F:

    two events arrive concurrently

The final CallInteraction must remain factually correct.

==================================================
11. CALLER PHONE NORMALIZATION
==================================================

Reuse MCR-1.

Do NOT implement a second phone parser.

Incoming caller number:

    provider value
        →
    normalizePhone(...)
        →
    canonical E.164 if valid

If caller number is:

- hidden;
- anonymous;
- invalid;
- unavailable;

the call itself may still be stored.

But:

- do not create Customer;
- do not attempt customer linking;
- future recovery eligibility should reflect that there is no usable destination.

Document this clearly.

==================================================
12. EXISTING CUSTOMER RESOLUTION
==================================================

Reuse MCR-1's canonical customer lookup.

After the business has been securely resolved from the CALLED number:

    tenantId
    + businessId
    + callerPhoneE164
        →
    customer resolution

Rules:

- exactly one active match → link customer;
- zero → customerId remains null;
- multiple → customerId remains null;
- never auto-create;
- never merge;
- never cross tenant boundaries.

A missed call from an unknown caller is still valuable.

It must remain persisted even without Customer.

==================================================
13. MISSED CALL ELIGIBILITY
==================================================

Define a conservative domain concept for whether a call can eventually enter recovery.

For MCR-2, determine eligibility but DO NOT send anything.

Conceptually:

Eligible may require:

- inbound call;
- final outcome = missed/unanswered;
- valid caller E.164;
- valid active BusinessPhoneNumber;
- not already suppressed by obvious safety rule.

Not eligible examples:

- answered call;
- outbound call;
- anonymous caller;
- invalid caller phone;
- unresolved business number.

Do not add WhatsApp-specific eligibility.

MCR-2 does not know whether WhatsApp can be used.

That belongs to future Recovery/Channel routing.

==================================================
14. RECOVERY STATE — PREPARE, DON'T SEND
==================================================

We need future MCR-4 to guarantee:

    one missed call
        →
    at most one initial recovery workflow

Prepare a minimal durable state.

For example conceptually:

    NOT_ELIGIBLE
    ELIGIBLE
    CLAIMED
    SENT
    FAILED

But do NOT introduce states that MCR-2 cannot truthfully produce.

At the end of MCR-2, an eligible missed call should simply be clearly and durably identifiable as:

    ready for future recovery

No ChannelDelivery should be created.

No Conversation should be created merely because a call was missed unless the existing architecture proves that early creation is necessary.

Prefer delaying channel-specific Conversation creation until a channel is actually chosen.

==================================================
15. ANTI-SPAM / REPEATED CALLS
==================================================

Prompt 57 identified a future anti-spam window.

Do NOT build a complicated suppression engine now.

But analyze and prepare for this case:

    same caller calls 3 times in 2 minutes
    because nobody answered

These are three real calls, so they should not be collapsed into one CallInteraction.

However, future MCR-4 must not necessarily send three identical recovery messages.

Therefore:

- preserve each call;
- do not implement outbound suppression yet;
- document what key/timestamps MCR-4 will use to apply an anti-spam recovery window.

Do not incorrectly deduplicate different providerCallIds.

==================================================
16. LATENCY TIMESTAMPS
==================================================

This product wins on SPEED.

MCR-2 must make future measurement possible.

We eventually need:

    call ended / missed detected
        →
    recovery workflow begins
        →
    outbound accepted
        →
    delivered
        →
    customer replies

MCR-2 owns only the call side.

Persist the smallest authoritative timestamps needed for later latency calculations.

Distinguish where appropriate:

- provider event time;
- AUTOSERVISE receipt/detection time.

Do not fabricate provider precision that the event does not provide.

==================================================
17. WEBHOOK SECURITY
==================================================

Follow the secure pattern already used by AUTOSERVISE.

The future real provider will require provider-specific verification.

For MOCK:

- use an explicit mock secret or equivalent safe testing mechanism;
- verify authentication BEFORE tenant/business data access where possible;
- reject invalid authentication;
- do not accept tenantId/businessId as routing authority;
- do not expose secrets in logs/errors;
- protect against replay through durable idempotency.

Document exactly what MCR-8 must replace/add for real provider signature verification.

==================================================
18. API / WEBHOOK RESPONSE BEHAVIOR
==================================================

Webhook endpoints should be retry-friendly.

Define clear behavior for:

- accepted event;
- duplicate event;
- invalid secret/signature;
- malformed payload;
- unknown called business number;
- invalid provider event;
- transient internal error.

Do not leak tenant/customer data in webhook responses.

Provider retries should not create duplicate records.

==================================================
19. AUDIT LOGGING
==================================================

Inspect existing AuditLog architecture.

Use it only if appropriate.

Do not create noisy audit rows for every ringing retry if that would make the audit log unusable.

Important domain transitions worth auditing may include:

- missed call detected;
- customer linked/unlinked if appropriate;
- call final outcome.

If existing AuditLog requires a real user actor and cannot truthfully represent system/webhook actions, DO NOT fake an owner user.

Prompt 57 identified this as an existing architectural gap.

If system identity is required to use AuditLog correctly:

- implement the smallest safe system-actor approach only if necessary for MCR-2;
- otherwise keep call-domain timestamps as the authoritative audit trail and document system identity as a future requirement.

Never impersonate an owner.

==================================================
20. NO CUSTOMER CONTACT
==================================================

This boundary is critical.

When a missed call is received:

MCR-2 may:

    persist CallInteraction
    resolve Business
    resolve Customer
    mark recovery eligibility

MCR-2 MUST NOT:

    send WhatsApp
    send SMS
    send Telegram
    create ChannelDelivery
    send email
    invoke AI
    create AI draft
    create Appointment
    create CustomerRequest
    contact owner
    contact customer

Tests must prove no outbound channel adapter is invoked.

==================================================
21. MINIMAL OPERATOR VISIBILITY
==================================================

This is primarily backend infrastructure.

Do NOT build the final missed-call UI.

However, developers/operators need a safe way to verify the vertical slice.

Prefer:

- tests;
- development/mock verification;
- existing API patterns.

If a minimal authenticated read endpoint for CallInteraction is necessary for future work, it may be added following existing tenant-scoped API conventions.

Do not redesign Dashboard or Operations.

Do not create a large Calls page in MCR-2.

==================================================
22. DATABASE MIGRATION
==================================================

Create safe Prisma migration(s) for the required models/enums/indexes.

Requirements:

- additive where possible;
- no destructive reset;
- preserve existing data;
- explicit constraints for idempotency;
- explicit constraints/indexes for routing;
- tenant isolation supported by schema/indexes;
- providerCallId uniqueness scoped correctly;
- providerEvent idempotency enforced durably.

If Prisma cannot express a required partial/conditional unique index, use explicit migration SQL and document it.

Do NOT edit an already-applied migration from MCR-1.

New schema changes must be NEW migration(s).

==================================================
23. DEV DATABASE / SUPABASE
==================================================

Follow established AUTOSERVISE Prisma + Supabase workflow.

If the configured development Supabase database is available:

- apply the new migration safely;
- verify tables/indexes/constraints;
- perform mock live verification using the existing test tenant;
- do not alter real tenants;
- do not reset database;
- do not delete real data.

Test data must be clearly identifiable.

If cleanup is safe, clean up MCR-2 test records after verification.

Do not clean unrelated historical test data unless necessary.

Report any remaining test records.

==================================================
24. LIVE MOCK VERIFICATION
==================================================

Using only the MOCK telephony provider, verify a realistic scenario.

At minimum:

CASE 1 — MISSED KNOWN CUSTOMER

    incoming call
    known called business number
    known caller phone
    ringing
    missed

Expected:

    one CallInteraction
    correct tenant/business
    correct canonical caller
    existing Customer linked
    final outcome missed
    recovery eligible
    no outbound message

CASE 2 — MISSED UNKNOWN CUSTOMER

Expected:

    CallInteraction stored
    customerId null
    recovery eligible if caller phone valid
    no Customer auto-created

CASE 3 — ANSWERED

    ringing
    answered
    completed

Expected:

    final answered
    not recovery eligible

CASE 4 — DUPLICATE WEBHOOK

Expected:

    one provider event effect
    one CallInteraction

CASE 5 — OUT-OF-ORDER

    missed
    delayed ringing

Expected:

    remains missed

CASE 6 — ANSWER EVIDENCE

Ensure an answered call cannot become missed because of a late event.

CASE 7 — UNKNOWN BUSINESS NUMBER

Expected:

    fail closed
    no tenant data mutation

CASE 8 — ANONYMOUS/INVALID CALLER

Expected:

    call may be stored
    no customer
    not recovery eligible

CASE 9 — SAME CALLER, DIFFERENT CALL IDS

Expected:

    separate CallInteractions
    no accidental deduplication

CASE 10 — CONCURRENT DUPLICATES

Expected:

    race-safe single call/event result

==================================================
25. TESTS
==================================================

Add focused automated tests for at least:

A. Business number routing
- valid route
- unknown number
- inactive number
- cross-tenant safety
- duplicate active number invariant

B. Adapter normalization
- ringing
- answered
- completed
- missed
- malformed event

C. CallInteraction lifecycle
- one call / multiple events
- final missed
- final answered
- out-of-order
- duplicate
- concurrent duplicate

D. Customer resolution
- known customer
- unknown customer
- ambiguous customer
- invalid caller
- same caller another tenant

E. Eligibility
- missed inbound valid caller
- answered
- outbound
- anonymous
- invalid caller

F. Security
- invalid mock secret
- tenant/business IDs in payload cannot override called-number routing
- webhook response does not expose customer data

G. No side effects
- no outbound ChannelAdapter
- no ChannelDelivery
- no AI invocation
- no Appointment
- no CustomerRequest

H. Tenant isolation
Extend the existing tenant isolation suite where appropriate.

==================================================
26. VALIDATION
==================================================

Run all normal validation for a schema/backend change.

At minimum:

- Prisma format where appropriate;
- Prisma validate;
- migration status;
- TypeScript typecheck;
- focused MCR-2 tests;
- tenant isolation tests;
- full test suite;
- production build.

MCR-1 reported a pre-existing repository-wide:

    prisma format --check

issue.

Do not silently claim it is fixed.

If it still exists unchanged:
- document it as pre-existing;
- do not reformat the entire schema solely for this prompt unless required by your own schema edits.

But ensure YOUR additions are correctly formatted and valid.

==================================================
27. DOCUMENTATION
==================================================

Follow existing repository conventions.

Create:

    docs/prompts/mcr-2.md

and:

    docs/final-reports/final-report-mcr-2.md

Update architecture/Product Blueprint only where MCR-2 materially changes the documented architecture.

The Final Report must include:

1. baseline;
2. schema changes;
3. BusinessPhoneNumber design;
4. routing invariant;
5. TelephonyAdapter contract;
6. mock provider behavior;
7. CallInteraction design;
8. call state machine;
9. provider-event idempotency;
10. concurrency behavior;
11. out-of-order behavior;
12. caller normalization;
13. customer resolution;
14. recovery eligibility;
15. latency timestamps;
16. webhook security;
17. audit/system actor decision;
18. explicit proof that no customer contact occurs;
19. live mock verification results;
20. test counts;
21. Prisma/typecheck/build results;
22. Supabase migration result;
23. files changed;
24. remaining test data;
25. known limitations;
26. exact readiness/gaps for MCR-3/MCR-4;
27. Git result.

==================================================
28. GIT — HANDLE THE COMPLETE WORKFLOW YOURSELF
==================================================

The user must NOT need to run Git or PowerShell manually.

You are responsible for the complete Git workflow.

After implementation and validation:

1. inspect git status;
2. inspect final diff;
3. ensure only intended MCR-2 changes exist;
4. ensure no secrets or `.env` files are committed;
5. include legitimate migration files;
6. commit the intended changes.

Use a clear commit message such as:

    feat: add missed call intake foundation

7. push to:

    origin/master

8. DO NOT force-push;
9. verify local master and origin/master point to the same commit;
10. verify working tree is clean.

If there are no legitimate changes, do not create an empty commit.

==================================================
29. STOP CONDITION
==================================================

MCR-2 is complete only when:

- business phone routing identity exists;
- routing is based on called number, not payload tenantId;
- provider-neutral telephony boundary exists;
- mock telephony provider exists;
- authenticated mock webhook works;
- one durable CallInteraction exists per call;
- provider events are idempotent;
- concurrent duplicates are safe;
- out-of-order events cannot corrupt final truth;
- answered calls cannot become missed;
- caller phone uses MCR-1 normalization;
- existing customer can be safely linked;
- unknown caller remains unlinked;
- eligible missed call is durably identifiable;
- answered/anonymous/ineligible calls are not recovery eligible;
- latency timestamps exist;
- no customer message is sent;
- no AI runs;
- no Appointment/CustomerRequest is created;
- migration is applied/verified;
- tests pass;
- build/typecheck/Prisma checks pass;
- documentation is complete;
- changes are committed;
- commit is pushed to origin/master;
- local/remote are synchronized;
- working tree is clean.

DO NOT proceed to MCR-3 or MCR-4.

Return the complete MCR-2 Final Report and STOP.
