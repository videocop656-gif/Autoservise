# MCR-8A — Production Telephony / Kcell Virtual PBX

> Verbatim — reproduced exactly as provided in the development
> conversation for this project (not reconstructed, not paraphrased).

---

# MCR-8A — PRODUCTION TELEPHONY / KCELL VIRTUAL PBX

You are working in the existing AUTOSERVISE repository.

This stage follows completed MCR-7B1.

Expected baseline:

    ef8eab5
    feat: add production twilio whatsapp transport

Expected baseline tests:

    2090 / 2090

==================================================
0. OBJECTIVE
==================================================

Implement the first real production telephony adapter for AUTOSERVISE:

    Kcell Virtual PBX (Kazakhstan)

This closes the missing beginning of the core product journey:

    customer calls workshop
        ↓
    workshop does not answer
        ↓
    Kcell Virtual PBX detects the call result
        ↓
    authenticated Kcell webhook
        ↓
    AUTOSERVISE CallInteraction
        ↓
    MISSED
        ↓
    durable recovery queue
        ↓
    Recovery Engine
        ↓
    MCR-6 Channel Router
        ↓
    Mobizon SMS bridge or permitted WhatsApp
        ↓
    customer enters conversation
        ↓
    MCR-5 AI

MCR-8A must integrate Kcell into the EXISTING provider-neutral
TelephonyAdapter from MCR-2.

Do NOT build a second call engine.

==================================================
1. PRODUCT THESIS
==================================================

AUTOSERVISE exists to recover economic value from unanswered inbound
phone calls.

Primary product promise:

    Мастер занят машиной —
    AUTOSERVISE занят клиентом.

The core success condition is:

    real missed call
    → detected automatically
    → recovery starts without operator action.

==================================================
2. OFFICIAL KCELL CONTRACT
==================================================

Use current official Kcell Virtual PBX REST API documentation as the
authority.

The documented CRM integration currently includes:

Kcell → CRM:

    history (POST)
    event (POST)
    contact (POST)

Relevant call event types include:

    INCOMING
    ACCEPTED
    COMPLETED
    CANCELLED
    OUTGOING
    TRANSFERRED

Relevant history statuses include:

    Success
    Missed
    Cancel
    Busy
    NotAvailable
    NotAllowed
    NotFound

Relevant documented fields include concepts such as:

    cmd
    type / direction
    phone
    diversion
    user
    ext
    telnum
    groupRealName
    start
    duration
    callid
    status
    link
    crm_token

Verify all current details against official Kcell docs before coding.

If current documentation differs from this prompt:

follow official documentation and report the difference.

Do NOT invent Kcell fields.

==================================================
3. HARD SCOPE
==================================================

IMPLEMENT:

- KcellTelephonyAdapter;
- authenticated public Kcell CRM webhook;
- parsing Kcell event POST requests;
- parsing Kcell history POST requests;
- Kcell call ID → provider call ID;
- safe Business routing by called workshop number;
- canonical caller normalization;
- mapping Kcell events into existing provider-neutral telephony events;
- final missed-call detection;
- answered-call protection;
- duplicate/idempotent webhook handling;
- out-of-order event handling;
- Kcell CRM token verification;
- provider/business connection configuration;
- integration with MCR-2 CallInteraction;
- automatic MCR-4.1 recovery queue trigger;
- pilot-safe configuration;
- Settings status;
- tests;
- documentation;
- Git workflow.

DO NOT IMPLEMENT:

- voice AI receptionist;
- call recording transcription;
- outbound calling;
- click-to-call;
- callback robot;
- speech analytics;
- real Mobizon activation;
- real Twilio activation;
- Beeline adapter;
- Embedded Signup;
- CRM integration unrelated to telephony events;
- billing;
- MCR-9 analytics.

==================================================
4. BASELINE AUDIT FIRST
==================================================

Before coding:

1. verify branch = master;
2. verify HEAD = ef8eab5;
3. verify origin/master matches;
4. verify clean working tree;
5. verify baseline tests approximately 2090;
6. inspect MCR-1 phone identity;
7. inspect MCR-2 TelephonyAdapter;
8. inspect MockTelephonyAdapter;
9. inspect CallInteraction;
10. inspect CallEvent;
11. inspect BusinessPhoneNumber;
12. inspect MCR-4 Recovery Engine;
13. inspect MCR-4.1 queue trigger;
14. inspect MCR-6 Channel Router;
15. inspect Mobizon adapter;
16. inspect Twilio adapter;
17. inspect webhook security patterns;
18. inspect Settings → Channels;
19. inspect current environment/config strategy.

Read:

    docs/PRODUCT_BLUEPRINT.md
    docs/audits/missed-call-recovery-architecture-audit.md
    docs/final-reports/final-report-mcr-2.md
    docs/final-reports/final-report-mcr-4.md
    docs/final-reports/final-report-mcr-4.1.md
    docs/final-reports/final-report-mcr-7a.md
    docs/final-reports/final-report-mcr-7b1.md

If baseline materially differs:

STOP and report.

==================================================
5. PROVIDER BOUNDARY
==================================================

Implement:

    KcellTelephonyAdapter

behind existing:

    TelephonyAdapter

Conceptually:

    TelephonyAdapter
        ├ MockTelephonyAdapter
        └ KcellTelephonyAdapter

The rest of the system must consume only normalized events.

Recovery Engine must never import Kcell code.

CallInteraction service must not become Kcell-specific.

Future:

    BeelineTelephonyAdapter
    SIPTelephonyAdapter
    TwilioVoiceAdapter

must remain possible.

==================================================
6. KCELL CONNECTION MODEL
==================================================

Do NOT model Kcell as one global tenant-independent PBX.

Each configured Kcell PBX integration must belong to a Business.

Audit existing provider/channel connection models first.

Add the smallest provider-neutral telephony connection model if needed.

Conceptually:

    TelephonyConnection
        businessId
        provider = KCELL
        status
        externalAccountId optional
        connectedAt
        disabledAt

The CRM token is a SECRET.

Do not expose it to frontend.

Prefer server-side secret/config storage compatible with the current
pilot architecture.

For first pilot, environment-backed credentials are acceptable if
clearly mapped to one Business and designed so multi-business provider
credentials can later be added.

==================================================
7. BUSINESS ROUTING — CRITICAL
==================================================

A Kcell webhook must never choose a tenant based on:

    caller phone
    tenantId
    businessId
    user-supplied payload hint.

Route Business using the workshop's called number.

Kcell documentation exposes concepts including:

    diversion
    telnum

Audit which field reliably represents the business number for each
inbound event/history call.

Normalize it to E.164 and resolve through existing:

    BusinessPhoneNumber

or a safely connected telephony-number mapping.

Expected principle:

    called business number
        ↓
    active BusinessPhoneNumber
        ↓
    Business
        ↓
    Tenant

Unknown business number:

    no CallInteraction
    safe error/ack according to Kcell retry semantics
    no tenant information leakage.

==================================================
8. EXISTING NUMBERS
==================================================

Do NOT assume businesses must obtain a new Kcell number.

Architecture must support:

- Kcell virtual number;
- existing external number connected to Kcell via SIP;
- existing number forwarded into Kcell where applicable.

AUTOSERVISE identity is based on the canonical called business number,
not whether Kcell originally issued it.

Document this.

==================================================
9. CRM TOKEN VERIFICATION
==================================================

Official Kcell CRM integration uses a configured token sent in the
request body as:

    crm_token

Verify token BEFORE state mutation.

Use constant-time comparison where applicable.

Never log token.

Never return it.

Do not store it in plaintext database if current secret architecture
offers a safer location.

Tests:

- correct token;
- wrong token;
- missing token;
- modified payload;
- token for another Business/connection.

==================================================
10. PUBLIC WEBHOOK
==================================================

Create one repository-consistent public endpoint, conceptually:

    POST /api/webhooks/telephony/kcell

It must handle documented Kcell CRM callback commands.

At minimum:

    cmd=event
    cmd=history

Do not require AUTOSERVISE user authentication.

Provider authentication is required.

Unknown cmd:

    safe 400 or provider-compatible response.

==================================================
11. KCELL EVENT → NORMALIZED EVENT
==================================================

Map Kcell event callbacks to existing provider-neutral events.

Conceptual mapping:

    INCOMING
        → RINGING / STARTED

    ACCEPTED
        → ANSWERED

    COMPLETED
        → COMPLETED / answered completion

    CANCELLED
        → call ended without this leg answering

But DO NOT blindly equate every CANCELLED callback to final MISSED.

Kcell documentation warns that for group calls a CANCELLED event for
one manager may occur because another manager answered.

This is critical.

The final call outcome must be derived safely from the whole call and/or
authoritative history status.

==================================================
12. GROUP CALL SAFETY
==================================================

This is a critical requirement.

Kcell documentation states that CANCELLED can mean:

- customer stopped waiting;
- OR another member of a manager group answered.

Therefore:

    CANCELLED ≠ automatically MISSED

for the entire call.

Use callid and authoritative final history where possible.

If:

    one leg CANCELLED
    another ACCEPTED

the CallInteraction must become ANSWERED, never MISSED.

Test this explicitly.

==================================================
13. HISTORY AS FINAL OUTCOME
==================================================

Kcell history POST includes a final status such as:

    Success
    Missed

Use it as authoritative final call outcome when appropriate.

Mapping:

    inbound + status=Success
        → ANSWERED

    inbound + status=Missed
        → MISSED

Other statuses:

map carefully according to direction and documented meaning.

Do not classify outbound failures as inbound missed leads.

==================================================
14. CALL ID
==================================================

Use Kcell:

    callid

as provider call ID.

Existing uniqueness should remain conceptually:

    provider + providerCallId

Duplicate callbacks for the same Kcell call must converge on one
CallInteraction.

Do not create a new call for each employee/leg.

==================================================
15. CALL EVENTS
==================================================

Persist normalized provider event identity safely.

If Kcell does not provide a unique event ID, derive a deterministic
idempotency fingerprint from stable documented fields.

Do NOT use current timestamp/randomness as event identity.

Document the collision assumptions.

A repeated HTTP delivery must not create duplicate logical event
effects.

==================================================
16. OUT-OF-ORDER EVENTS
==================================================

Kcell callbacks may arrive in unexpected order.

Existing MCR-2 monotonic rules remain authoritative.

Examples:

    history Missed
    then delayed INCOMING

must remain MISSED.

    CANCELLED
    then ACCEPTED / final Success

must become ANSWERED if authoritative evidence says answered.

    ANSWERED
    must never regress to MISSED.

Test permutations.

==================================================
17. RECOVERY TRIGGER
==================================================

Only when the call reaches eligible:

    inbound
    + final MISSED
    + valid caller number

should existing MCR-2 state become:

    READY

and MCR-4.1 publish the existing:

    missed-call-recovery

job.

Do NOT create another queue/topic unless absolutely necessary.

Do NOT run Recovery Engine synchronously inside Kcell webhook.

Webhook should persist/transition/enqueue and return promptly.

==================================================
18. ANSWERED CALL
==================================================

If the workshop answered:

    no recovery.

Expected:

    CallInteraction outcome = ANSWERED
    recovery = NOT_ELIGIBLE / equivalent

No:

- SMS;
- WhatsApp recovery;
- AI;
- Customer creation;
- Request;
- Appointment.

==================================================
19. VALID CALLER
==================================================

Use MCR-1 phone normalization.

Kcell caller:

    phone

must be normalized in the resolved Business region.

Valid canonical phone:

    may become recovery eligible.

Anonymous/invalid:

    CallInteraction may be preserved
    recovery ineligible
    no SMS/WhatsApp.

Do not fabricate phone identity.

==================================================
20. CUSTOMER LINKING
==================================================

Reuse MCR-2 behavior.

After Business is known:

    caller E.164
        ↓
    tenant/business scoped active Customer lookup

Exactly one match:

    link Customer.

Zero/multiple:

    leave unlinked.

Do not create Customer automatically.

==================================================
21. START / DURATION / TIMESTAMPS
==================================================

Parse documented Kcell timestamps carefully.

Preserve distinction between:

- provider call time;
- AUTOSERVISE receivedAt;
- outcomeDetectedAt;
- recovery claimed;
- provider recovery accepted.

This is necessary for our future primary KPI:

    missed call → first recovery latency.

Do not use webhook receive time as call start if provider time exists.

==================================================
22. MISSED DETECTION LATENCY
==================================================

Instrument enough durable timestamps to later calculate:

    outcomeDetectedAt - providerCallEnd/start
    recoveryAcceptedAt - missedDetectedAt

Do not build analytics dashboard yet.

MCR-9 will expose metrics.

==================================================
23. RECORDING LINK
==================================================

Kcell history may include:

    link

to call recording.

Do NOT download call recordings.

Do NOT send recordings to AI.

Do NOT build transcription.

If existing CallInteraction has an appropriate safe provider metadata
field, store only if necessary; otherwise ignore.

Avoid expanding scope.

==================================================
24. PRIVACY
==================================================

Do not log:

- crm_token;
- full caller phone;
- recording URL;
- raw webhook body;
- customer PII.

Use masking.

Queue payload:

    callInteractionId only

or the existing minimal identifier.

==================================================
25. WEBHOOK RESPONSE
==================================================

Follow current Kcell official response requirements.

Documentation currently indicates JSON responses and typical:

    200
    400 invalid parameters
    401 invalid token

Implement exact compatible behavior.

Do not leak whether a particular Business exists.

==================================================
26. RETRIES
==================================================

Research official Kcell webhook retry behavior if documented.

Regardless of retry guarantees:

AUTOSERVISE must be idempotent.

A repeated:

    event
    history

must not:

- create duplicate CallInteraction;
- produce duplicate recovery;
- send duplicate SMS;
- enqueue multiple logical recovery attempts.

==================================================
27. FINAL OUTCOME CONFLICT
==================================================

If event callbacks imply missed but later authoritative history says:

    Success

the call must end ANSWERED and must not newly recover.

If recovery was already irreversibly sent before contradictory provider
data arrives:

do not attempt to undo/send another message.

Record conflict observably for future investigation.

Do not create dangerous compensation behavior.

==================================================
28. WEBHOOK / QUEUE RACE
==================================================

Test:

    final Missed callback arrives
    READY created
    queue publish starts
    late Success/ACCEPTED arrives

Existing late-answer safety in MCR-4 must still prevent send when the
call becomes ANSWERED before irreversible recovery send.

Do not weaken MCR-4 locks.

==================================================
29. TELEPHONY SETTINGS UI
==================================================

Add minimal status to existing Settings → Channels / integrations area.

Conceptually:

    Телефония
    Provider: Kcell Виртуальная АТС
    Status: подключено / не настроено
    Номер: masked
    Missed call events: enabled

Do not show:

- CRM token;
- SIP password;
- provider credentials.

Do not build a Kcell PBX administration UI.

==================================================
30. CONNECTION CONFIGURATION
==================================================

For MCR-8A provide a controlled server-side pilot configuration.

It should be possible to associate:

    Business
    ↔ Kcell integration
    ↔ one or more BusinessPhoneNumber records
    ↔ CRM token/secret configuration.

Do not allow ordinary browser input to set arbitrary provider secrets.

Owner/admin may activate a prepared connection only if that matches
existing pilot patterns.

==================================================
31. MULTI-TENANT FUTURE
==================================================

Pilot may use one Kcell account/business.

But architecture must permit:

    Workshop A → Kcell PBX A
    Workshop B → Kcell PBX B

with distinct tokens/numbers.

Do not make one global token the permanent domain model.

If environment-backed pilot mapping is used, isolate it behind the
connection abstraction.

==================================================
32. MOCK TELEPHONY
==================================================

Keep existing MockTelephonyAdapter.

Automated tests must NOT contact Kcell.

Production:

    explicit provider = kcell

requires valid Kcell connection.

Missing secret/config:

    telephony unavailable / fail closed.

Never silently use mock in production.

==================================================
33. SUCCESSFUL VERTICAL SLICE
==================================================

Build a production-adapter integration test with simulated authenticated
Kcell HTTP callbacks:

    Kcell event INCOMING
        ↓
    one CallInteraction

    Kcell event CANCELLED
        ↓
    no premature customer recovery if final outcome uncertain

    Kcell history:
        type=in
        status=Missed
        same callid
        caller phone
        business number
        ↓
    CallInteraction = MISSED
        ↓
    recovery = READY
        ↓
    MCR-4.1 queue publish
        ↓
    Recovery Engine
        ↓
    MCR-6 router
        ↓
    SMS_BRIDGE
        ↓
    mock/production transport boundary

Assert:

- one call;
- correct tenant;
- correct caller;
- correct provider call ID;
- one recovery logical attempt;
- no duplicate.

==================================================
34. ANSWERED VERTICAL SLICE
==================================================

Simulate:

    INCOMING
    CANCELLED for employee #1
    ACCEPTED for employee #2
    COMPLETED
    history Success

Expected:

    CallInteraction ANSWERED
    recovery NOT_ELIGIBLE
    zero recovery messages.

This is a critical acceptance test.

==================================================
35. PURE MISSED SLICE
==================================================

Simulate:

    INCOMING
    CANCELLED
    history Missed

Expected:

    MISSED
    READY
    one recovery job.

==================================================
36. DUPLICATE CALLBACK SLICE
==================================================

Send identical event/history callbacks:

    5 times concurrently.

Expected:

    one logical CallInteraction state
    one logical recovery
    one first recovery send maximum.

==================================================
37. OUT-OF-ORDER SLICE
==================================================

Test:

A.

    history Missed
    then INCOMING

→ remain MISSED.

B.

    CANCELLED
    then ACCEPTED
    then history Success

→ ANSWERED.

C.

    ACCEPTED
    then delayed history Missed

Investigate correct provider semantics.

Safety rule:

    credible ANSWERED evidence must not be downgraded into automated
    missed-call recovery.

Document decision.

==================================================
38. WRONG TOKEN
==================================================

Authenticated routing must fail safely.

Test:

- missing token;
- wrong token;
- correct token for another configured Kcell connection;
- unknown called number.

Expected:

    no DB mutation
    no recovery
    no tenant leak.

==================================================
39. WRONG DIRECTION
==================================================

Outbound calls must not trigger missed-call recovery.

Test outbound:

    status Missed / failure equivalent

if Kcell can emit it.

Expected:

    preserved call/audit if appropriate
    never eligible recovery lead.

==================================================
40. UNKNOWN/INVALID CALLER
==================================================

Test:

- anonymous;
- malformed number;
- caller not valid in business region.

Expected:

    call can be stored if useful
    recovery INELIGIBLE / NO_CALLER_PHONE
    no external customer message.

==================================================
41. BUSINESS NUMBER ROUTING
==================================================

Test two Businesses with different numbers.

Same caller calls both.

Expected:

    two independent CallInteractions
    each routed by called business number
    no cross-tenant contamination.

Caller number must never select tenant.

==================================================
42. EXISTING NUMBER VIA SIP
==================================================

No SIP implementation is needed inside AUTOSERVISE.

But document deployment support:

Existing workshop number can be connected to Kcell VATS via:

- SIP registration;
- SIP URI forwarding;
- traditional forwarding where necessary.

AUTOSERVISE only consumes the resulting Kcell call events.

==================================================
43. WEBHOOK SECURITY LIMITATION
==================================================

Kcell documented CRM callbacks use shared token authentication rather
than modern signed-request authentication.

Do not pretend token-in-body equals signed webhook.

Mitigations:

- HTTPS only;
- strong random token;
- constant-time comparison;
- per-connection token;
- never log token;
- rotateable token;
- optionally document network/IP restriction if Kcell provides stable
  source IPs officially.

Do not invent source IP allowlist if undocumented.

Final Report must explicitly state the security boundary.

==================================================
44. TESTS
==================================================

At minimum:

- config detection;
- missing config fail closed;
- event parser;
- history parser;
- valid token;
- invalid token;
- missing token;
- business routing;
- caller normalization;
- callid identity;
- duplicate event;
- duplicate history;
- concurrent duplicates;
- group CANCELLED safety;
- ACCEPTED;
- COMPLETED;
- history Success;
- history Missed;
- outbound ignored for recovery;
- invalid caller;
- unknown business number;
- two-business isolation;
- out-of-order events;
- late answer;
- queue trigger once;
- Recovery Engine integration;
- anti-spam regression;
- MCR-1;
- MCR-2;
- MCR-4;
- MCR-4.1;
- MCR-5;
- MCR-6;
- MCR-7A;
- MCR-7B1;
- tenant isolation.

==================================================
45. REAL NETWORK SAFETY
==================================================

Automated tests must never contact Kcell.

Do NOT require live Kcell credentials to build/test.

Expected during MCR-8A:

    real Kcell call received: NO

unless deliberately configured already.

The adapter must be production-capable through mocked HTTP webhook
fixtures and repository integration tests.

==================================================
46. DATABASE
==================================================

Prefer existing:

    BusinessPhoneNumber
    CallInteraction
    CallEvent

Add only minimal additive schema if required for:

- Kcell connection;
- provider event fingerprint;
- provider-specific final status metadata.

Never modify applied migrations.

If migration added:

- apply through existing Supabase workflow;
- verify migrate status;
- verify defaults/current rows.

==================================================
47. VALIDATION
==================================================

Run:

- focused MCR-8A tests;
- telephony tests;
- recovery tests;
- queue tests;
- channel tests;
- tenant isolation;
- full suite;
- TypeScript typecheck;
- production build;
- Prisma validate;
- migrate status.

If UI changed:

- desktop;
- 390px.

If browser tooling unavailable:

state it honestly.

==================================================
48. DOCUMENTATION
==================================================

Create:

    docs/prompts/mcr-8a.md
    docs/final-reports/final-report-mcr-8a.md

Update materially:

    docs/PRODUCT_BLUEPRINT.md
    docs/audits/missed-call-recovery-architecture-audit.md

Document:

- why Kcell was selected;
- API contract;
- event vs history semantics;
- group CANCELLED danger;
- final Missed logic;
- auth/token model;
- called-number routing;
- existing-number/SIP support;
- provider-neutral boundary;
- latency timestamps;
- idempotency;
- privacy;
- limitations;
- exact pilot activation checklist;
- readiness for MCR-8B live test;
- readiness for Beeline adapter later.

==================================================
49. MCR-8B ACTIVATION CHECKLIST
==================================================

Final Report must include exact current provider-side steps for a live
Kcell pilot.

Derive them from official Kcell documentation.

Likely categories:

1. obtain Kcell Virtual PBX / trial;
2. choose or connect workshop number;
3. if keeping existing number:
      SIP registration / SIP URI / forwarding;
4. enable CRM REST API integration;
5. set AUTOSERVISE HTTPS webhook URL;
6. generate strong CRM token;
7. configure the same secret in AUTOSERVISE/Vercel;
8. connect the Business phone number;
9. deploy;
10. place answered test call;
11. verify no recovery;
12. place intentionally unanswered test call;
13. verify CallInteraction MISSED;
14. measure missed → recovery latency;
15. verify SMS/WhatsApp path;
16. verify duplicate/retry behavior.

Do not ask user to perform activation during MCR-8A coding.

==================================================
50. ACCEPTANCE QUESTIONS
==================================================

Answer YES / PARTIAL / NO with evidence.

A.
Can an authenticated Kcell inbound missed call create/update the
correct CallInteraction without trusting tenantId/businessId?

Expected YES.

B.
Is Business chosen from the called workshop number, never caller?

Expected YES.

C.
Can one manager leg CANCELLED incorrectly classify a group call as
MISSED when another manager answered?

Expected NO.

D.
Does authoritative Kcell history Missed make an eligible inbound call
READY?

Expected YES.

E.
Does authoritative answered evidence prevent missed-call recovery?

Expected YES.

F.
Can duplicate Kcell callbacks produce two recovery messages?

Expected NO.

G.
Can an invalid/missing CRM token mutate state?

Expected NO.

H.
Can an outbound failed call trigger customer recovery?

Expected NO.

I.
Can an existing non-Kcell workshop number conceptually remain in use
through Kcell SIP/forwarding without changes to Recovery Engine?

Expected YES.

J.
Does READY still use the existing MCR-4.1 durable queue rather than a
new synchronous recovery path?

Expected YES.

K.
Can future Beeline/other telephony adapters be added without rewriting
CallInteraction/Recovery Engine?

Expected YES.

==================================================
51. FINAL REPORT
==================================================

Include:

1. baseline;
2. files changed;
3. schema/migration;
4. official Kcell contract used;
5. adapter architecture;
6. connection model;
7. credential/token model;
8. webhook endpoint;
9. authentication;
10. security limitation;
11. business routing;
12. caller normalization;
13. event mapping;
14. history mapping;
15. CANCELLED/group-call handling;
16. final missed detection;
17. callid idempotency;
18. event fingerprint;
19. duplicate handling;
20. out-of-order handling;
21. answered protection;
22. outbound-call behavior;
23. invalid caller;
24. customer linkage;
25. timestamps;
26. latency observability;
27. queue trigger;
28. recovery integration;
29. privacy/logging;
30. Settings UI;
31. successful missed slice;
32. answered/group slice;
33. duplicate/concurrency slice;
34. out-of-order slice;
35. wrong-token tests;
36. tenant isolation;
37. full MCR regressions;
38. tests before/after;
39. typecheck;
40. build;
41. Prisma;
42. Supabase status;
43. browser/mobile;
44. real Kcell call received YES/NO;
45. exact MCR-8B activation checklist;
46. current Kcell limitations;
47. future Beeline readiness;
48. answers A–K;
49. Git result + commit hash.

==================================================
52. GIT — DO EVERYTHING YOURSELF
==================================================

The user must not manually run Git, Prisma, tests or PowerShell.

After implementation:

1. inspect git status;
2. inspect diff;
3. verify only intended MCR-8A changes;
4. verify no secrets/.env committed;
5. run all validation;
6. commit.

Suggested commit:

    feat: add production kcell telephony transport

7. git push origin master;
8. never force push;
9. verify local master == origin/master;
10. verify clean working tree;
11. report commit hash.

==================================================
53. STOP
==================================================

MCR-8A is complete when:

- KcellTelephonyAdapter exists;
- authenticated Kcell event/history webhook exists;
- Business routing uses called workshop number;
- caller never selects tenant;
- callid maps to one CallInteraction;
- group CANCELLED cannot create a false missed call;
- authoritative Missed can make inbound call READY;
- ANSWERED cannot become missed recovery;
- duplicate callbacks are idempotent;
- out-of-order callbacks are safe;
- valid missed calls trigger existing durable recovery queue;
- no Kcell-specific logic leaks into Recovery Engine;
- existing numbers remain conceptually supported through SIP/forwarding;
- no secrets/PII leak;
- full regression passes;
- docs complete;
- commit pushed;
- master == origin/master;
- working tree clean.

DO NOT START MCR-8B LIVE ACTIVATION.

DO NOT IMPLEMENT BEELINE.

DO NOT IMPLEMENT VOICE AI.

DO NOT START MCR-9.

Return the complete MCR-8A Final Report and STOP.
