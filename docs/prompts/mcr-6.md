# MCR-6 — Recovery Channel Router & SMS→WhatsApp Bridge

> Verbatim — reproduced exactly as provided in the development
> conversation for this project (not reconstructed, not paraphrased).

---

# MCR-6 — RECOVERY CHANNEL ROUTER & SMS→WHATSAPP BRIDGE

You are working in the existing AUTOSERVISE repository.

This stage follows completed MCR-5.

Expected baseline:

    f71a002
    feat: add automatic ai conversation recovery

Expected baseline tests:

    1986 / 1986

MCR-6 must build the provider-neutral decision layer that decides HOW
AUTOSERVISE may recover a missed call.

IMPORTANT:

This prompt DOES NOT connect a real SMS provider.
This prompt DOES NOT connect real WhatsApp.
This prompt DOES NOT connect real telephony.

It builds the production-grade routing/domain foundation first.

==================================================
0. PRODUCT THESIS
==================================================

AUTOSERVISE's primary job:

    customer calls
    → workshop misses the call
    → AUTOSERVISE immediately chooses the best permitted recovery path
    → customer enters a conversation
    → MCR-5 AI continues the useful dialogue
    → visit / booking / human handoff

Product principle:

    Мастер занят машиной —
    AUTOSERVISE занят клиентом.

Customer principle:

    Клиенту — простота.
    Бизнесу — система.

A customer must NOT need:

- AUTOSERVISE account;
- AUTOSERVISE application;
- Telegram;
- special installation.

Telegram must not be required in the recovery journey.

==================================================
1. WHY MCR-6 EXISTS
==================================================

Do NOT assume:

    missed phone call
    =
    permission to initiate WhatsApp

WhatsApp business-initiated communication has channel-specific
eligibility / consent / template requirements.

Therefore MCR-4's current simple:

    READY
    → Channel Router
    → WhatsApp

must evolve into:

                         MISSED CALL
                              ↓
                      Recovery Router
                              ↓
                ┌─────────────┴─────────────┐
                ↓                           ↓
        WhatsApp initiation          WhatsApp initiation
        currently permitted          not permitted/unknown
                ↓                           ↓
        WhatsApp template                  SMS
                                            ↓
                                  "Вы звонили нам..."
                                            ↓
                                     WhatsApp link
                                            ↓
                                    customer clicks
                                            ↓
                                    customer sends
                                            ↓
                                     WhatsApp inbound
                                            ↓
                                        MCR-5 AI

MCR-6 builds this decision system.

==================================================
2. HARD SCOPE
==================================================

IMPLEMENT:

- provider-neutral recovery channel router;
- durable channel eligibility/consent model where genuinely needed;
- explicit distinction between:
    capability,
    consent,
    customer-service window,
    approved-template availability;
- SMS recovery path;
- deterministic SMS recovery template;
- SMS → WhatsApp bridge link;
- safe bridge token / attribution mechanism;
- recovery channel decision/audit;
- adapter capability contract;
- mock SMS adapter;
- mock WhatsApp eligibility;
- integration with existing MCR-4 Recovery Engine;
- correct recovery state semantics;
- idempotency/concurrency protection;
- tenant isolation;
- operator-visible recovery channel/result where appropriate;
- tests;
- docs;
- Git workflow.

DO NOT IMPLEMENT:

- Twilio production integration;
- Mobizon production integration;
- Bird production integration;
- real SMS sending;
- real WhatsApp sending;
- Meta Cloud API;
- WhatsApp Embedded Signup;
- real WhatsApp templates;
- real SMS sender registration;
- real telephony;
- Telegram recovery;
- MCR-7;
- MCR-8;
- autonomous Appointment creation;
- billing;
- CRM integration;
- landing page;
- unrelated UI redesign.

==================================================
3. BASELINE AUDIT FIRST
==================================================

Before coding:

1. verify branch = master;
2. verify HEAD = f71a002;
3. verify origin/master matches;
4. verify clean working tree;
5. verify baseline tests approximately 1986;
6. inspect MCR-1 through MCR-5 architecture;
7. inspect current Recovery Engine;
8. inspect current ChannelAdapter abstraction;
9. inspect ChannelConnection if it already exists;
10. inspect ChannelDelivery;
11. inspect Conversation/Message channel representation;
12. inspect current mock WhatsApp recovery adapter;
13. inspect MCR-4 template mapping;
14. inspect MCR-4.1 queue;
15. inspect MCR-5 inbound AI path;
16. inspect Business/Customer phone identity;
17. inspect current consent/opt-out fields, if any.

Read:

    docs/PRODUCT_BLUEPRINT.md
    docs/audits/missed-call-recovery-architecture-audit.md
    docs/final-reports/final-report-mcr-4.md
    docs/final-reports/final-report-mcr-4.1.md
    docs/final-reports/final-report-mcr-5.md

If baseline materially differs:

STOP and report before broad implementation.

==================================================
4. DO NOT HARD-CODE PROVIDERS
==================================================

MCR-6 is about CHANNELS, not Twilio/Mobizon/Bird.

The core must understand concepts like:

    WHATSAPP
    SMS

not:

    TWILIO_IS_ALLOWED

Keep provider-specific details behind adapters.

Conceptually:

    RecoveryChannelRouter

        ├── WhatsApp capability/eligibility
        └── SMS capability/eligibility

Future:

    TwilioWhatsAppAdapter
    MetaWhatsAppAdapter
    MobizonSmsAdapter
    BirdSmsAdapter

must be replaceable without rewriting Recovery Engine.

==================================================
5. THREE DIFFERENT CONCEPTS — DO NOT MERGE THEM
==================================================

Model these concepts separately.

A. TECHNICAL CAPABILITY

Example:

    Is a WhatsApp sender configured for this Business?
    Is an SMS sender configured?

B. PERMISSION / CONSENT

Example:

    Do we have recorded permission to initiate WhatsApp communication?

C. SESSION / CUSTOMER SERVICE WINDOW

Example:

    Has this customer sent a WhatsApp message recently so free-form
    WhatsApp conversation is currently allowed?

These are not the same thing.

Do not create a single ambiguous boolean such as:

    canWhatsApp = true

without preserving why.

==================================================
6. CHANNEL ELIGIBILITY RESULT
==================================================

Create a centralized deterministic eligibility result.

Conceptually:

    {
      channel: "WHATSAPP",
      technicallyAvailable: true,
      initiationPermitted: false,
      sessionOpen: false,
      approvedRecoveryTemplateAvailable: true,
      reason: "NO_RECORDED_CONSENT"
    }

Exact types should fit the repository.

Use stable machine-readable reason codes.

Examples:

    NOT_CONFIGURED
    INVALID_DESTINATION
    NO_RECORDED_CONSENT
    OPTED_OUT
    SESSION_OPEN
    TEMPLATE_AVAILABLE
    TEMPLATE_UNAVAILABLE
    PROVIDER_UNAVAILABLE

Do not expose internal provider details to customers.

==================================================
7. CONSENT MODEL
==================================================

Audit whether an existing model can safely represent communication
permission.

If not, add the smallest provider-neutral durable model.

Do NOT make it WhatsApp-specific if avoidable.

Conceptually it needs to answer:

    business
    customer/canonical destination
    channel
    status
    source
    recordedAt
    revokedAt

Possible statuses:

    UNKNOWN
    OPTED_IN
    OPTED_OUT

Do not invent consent automatically from:

- a missed phone call;
- existence of Customer;
- existence of phone number;
- old Telegram conversation.

A missed call alone must NOT set WhatsApp OPTED_IN.

If no explicit consent exists:

    UNKNOWN

is correct.

==================================================
8. CUSTOMER-SERVICE WINDOW
==================================================

Do not pretend we know a WhatsApp session is open merely because a
Conversation exists.

Create/reuse a durable way to know the latest inbound customer activity
for a channel.

Prefer deriving from authoritative inbound Message timestamps where
safe rather than duplicating state unnecessarily.

The domain API should be able to answer conceptually:

    isCustomerServiceWindowOpen(
      business,
      destination,
      channel,
      now
    )

For WhatsApp MVP semantics:

    customer inbound
    → window opens

Do not make the core depend on the literal 24-hour constant scattered
through code.

Centralize policy/configuration.

==================================================
9. ROUTING POLICY
==================================================

Create ONE centralized RecoveryChannelRouter.

Initial policy:

1. Evaluate WhatsApp.

2. If WhatsApp is technically available AND initiation is permitted
   under our recorded state/policy AND the required recovery mechanism
   is available:

       select WHATSAPP

3. Otherwise evaluate SMS.

4. If SMS is technically available:

       select SMS_BRIDGE

5. Otherwise:

       NO_ELIGIBLE_CHANNEL

Do not select Telegram.

Do not silently fall back to an unpermitted WhatsApp send.

==================================================
10. IMPORTANT — UNKNOWN CONSENT
==================================================

For MCR-6:

    WhatsApp consent UNKNOWN

must NOT be treated as permission for a business-initiated WhatsApp
recovery.

The safe route is:

    SMS_BRIDGE

when SMS is available.

This policy may later be adapted to a verified provider/legal model,
but the core must fail safe now.

==================================================
11. SMS RECOVERY MESSAGE
==================================================

Create a deterministic template, not AI-generated.

Conceptual Russian text:

    "Здравствуйте! Вы только что звонили в автосервис «{{businessName}}».
     Мастер сейчас занят и не смог ответить.
     Чтобы быстро продолжить в WhatsApp:
     {{bridgeUrl}}"

Keep SMS length in mind.

Do not blindly use this exact wording if it creates excessive SMS
segments.

Create a compact production-oriented version.

Requirements:

- business name only from configured Business;
- no customer name required;
- no diagnosis;
- no price;
- no invented availability;
- no AUTOSERVISE branding required;
- one clear CTA;
- bridge URL.

Template must be deterministic and testable.

==================================================
12. SMS SEGMENT AWARENESS
==================================================

SMS cost depends on segmentation/encoding.

Add a small provider-neutral utility capable of reporting at least:

    encoding:
      GSM7 / UCS2 / equivalent

    estimatedSegments

Do not build telecom billing.

The purpose is:

- avoid accidentally creating a 3–4 segment recovery SMS;
- make future provider integration observable;
- test Russian text behavior.

If Russian Cyrillic causes UCS-2 segmentation, account for it.

Prefer a concise recovery template.

Do not transliterate Russian merely to save money unless explicitly
configured later.

==================================================
13. SMS ADAPTER
==================================================

Introduce/reuse provider-neutral SMS capability.

Conceptually:

    SmsAdapter

or use existing ChannelAdapter if it already cleanly supports SMS.

It must support:

    send(...)
    capability/availability check
    provider idempotency key

For MCR-6 implement:

    MockSmsAdapter

only.

Do not install a real SMS SDK.

==================================================
14. MOCK SMS SAFETY
==================================================

Mock SMS must never accidentally run as a production provider.

Require explicit test/development enablement.

Follow the same safety philosophy as mock telephony/mock WhatsApp.

Do not add secrets to Git.

==================================================
15. SMS → WHATSAPP BRIDGE
==================================================

The SMS CTA should not contain a raw arbitrary URL supplied by an
external provider.

AUTOSERVISE should create a safe bridge URL.

Conceptually:

    https://<public-app>/r/<opaque-token>

The token must NOT expose:

- tenantId;
- businessId;
- customerId;
- phone number;
- callInteractionId;
- secrets.

Do not use predictable sequential IDs.

==================================================
16. BRIDGE TOKEN
==================================================

Implement a secure, durable bridge attribution mechanism.

Requirements:

- opaque high-entropy token OR cryptographically signed equivalent;
- tied server-side to the intended recovery/call/business;
- expiration;
- one business only;
- cannot be modified to target another tenant;
- no phone/PII in URL;
- safe repeated clicks;
- revocable/invalid once inappropriate;
- never grants authenticated business access.

Prefer the smallest schema compatible with this.

Do not use JWT merely because it is convenient if a random opaque token
stored hashed server-side is safer/simpler for revocation.

Document the choice.

==================================================
17. BRIDGE DESTINATION
==================================================

When bridge is opened:

AUTOSERVISE should redirect to the configured WhatsApp customer-entry
URL for THAT business.

Conceptually:

    https://wa.me/<business-whatsapp-number>?text=<encoded text>

or the correct configured customer-entry URI abstraction.

Do not hard-code a business number globally.

Do not generate a destination if WhatsApp entry configuration is absent.

==================================================
18. PRE-FILLED CUSTOMER MESSAGE
==================================================

Use a short deterministic pre-filled message, conceptually:

    "Здравствуйте! Я только что звонил в автосервис."

Do not include:

- phone number;
- internal call ID;
- tenant ID;
- tracking token;
- diagnosis;
- sensitive data.

The user must still perform the WhatsApp user action/send.

Do not represent the redirect itself as an inbound WhatsApp message.

==================================================
19. BRIDGE CLICK IS NOT WHATSAPP CONSENT
==================================================

Important:

Opening/clicking the bridge does NOT by itself mean:

    WhatsApp OPTED_IN

and does NOT open a customer-service window.

Only authoritative channel events should change those states.

For future real WhatsApp:

    actual inbound WhatsApp message
    → update appropriate channel interaction/session state.

Do not fake that in MCR-6.

==================================================
20. BRIDGE ATTRIBUTION
==================================================

Track useful non-sensitive funnel timestamps:

    smsRecoveryAcceptedAt
    bridgeOpenedAt
    whatsappInboundAt   [future/when authoritative inbound exists]

or equivalent normalized events.

Do not duplicate fields unnecessarily if an existing recovery event
model is better.

We eventually need metrics:

    missed
    → recovery attempted
    → SMS accepted
    → bridge opened
    → WhatsApp inbound
    → AI conversation
    → booked

MCR-6 does not need full analytics UI.

==================================================
21. PRIVACY
==================================================

Bridge logs must not contain raw customer phone numbers.

Do not put PII in:

- URL path;
- query string;
- queue payload;
- log messages.

Reuse existing phone masking where relevant.

==================================================
22. RECOVERY ENGINE INTEGRATION
==================================================

Refactor MCR-4 only as much as needed.

Current durable recovery properties must survive:

    READY
    → CLAIMED
    → SENT / FAILED / SUPPRESSED

and:

- atomic claim;
- anti-spam;
- late-answer handling;
- retry behavior;
- DELIVERY_UNCERTAIN handling;
- idempotency;
- one recovery per call.

The Recovery Engine asks the router:

    selectRecoveryChannel(...)

The router returns the decision.

Recovery Engine then uses the selected adapter.

Do not build a second Recovery Engine.

==================================================
23. WHAT DOES SENT MEAN?
==================================================

Preserve the existing meaning:

    recovery SENT

means:

    selected provider accepted the outbound recovery message

NOT:

    delivered
    read
    clicked
    replied

For SMS_BRIDGE:

    SENT

means mock/real SMS provider accepted it.

Bridge opening is a separate event.

==================================================
24. CHANNEL DECISION AUDIT
==================================================

Persist enough information to answer later:

    Why was SMS selected instead of WhatsApp?

For example:

    selectedChannel = SMS
    routeReason = WHATSAPP_NO_RECORDED_CONSENT

Do not rely only on transient logs.

This is important for debugging and future metrics.

Avoid storing large provider payloads.

==================================================
25. EXISTING MCR-4 TEMPLATE
==================================================

Do not delete:

    MISSED_CALL_RECOVERY_V1

It remains the deterministic WhatsApp recovery concept.

Add a separate deterministic SMS bridge template, e.g.:

    MISSED_CALL_SMS_BRIDGE_V1

Do not use AI to generate either first recovery message.

==================================================
26. EXISTING MCR-5
==================================================

MCR-5 must remain unchanged in principle.

MCR-6 does NOT make AI respond to an SMS bridge click.

MCR-5 starts only from a genuine supported inbound customer Message.

Future real WhatsApp inbound:

    customer sends WhatsApp message
    → Message INBOUND
    → MCR-5

Do not fake inbound Message creation from redirect.

==================================================
27. OPTIONAL TWO-WAY SMS FUTURE
==================================================

Design SMS adapter/channel abstractions so that future:

    inbound SMS
    → Conversation
    → MCR-5
    → outbound SMS

is possible.

But DO NOT implement two-way SMS in MCR-6.

The current MVP bridge is:

    outbound SMS
    → WhatsApp user entry

Document this distinction.

==================================================
28. WHATSAPP ENTRY CONFIGURATION
==================================================

We need a provider-neutral way for each Business to define the
customer-entry WhatsApp destination.

Audit existing ChannelConnection/config first.

Do not prematurely implement Twilio credentials.

The minimum configuration should support generating the correct
business-specific customer entry URI.

If schema change is necessary, make it additive.

Do not make one global WhatsApp number serve all tenants implicitly.

==================================================
29. OPERATOR SETTINGS UI
==================================================

Add only the minimum UI needed to inspect/configure MCR-6 concepts.

Prefer existing Settings → Channels.

Operator should be able to understand:

    WhatsApp
      configured / not configured

    SMS recovery
      configured / not configured

    Recovery fallback:
      WhatsApp when permitted
      otherwise SMS bridge

Do not expose legal jargon-heavy UI.

Do not redesign Settings.

390px mobile must remain usable.

==================================================
30. CALL / CONVERSATION UI
==================================================

Where existing UI already shows recovery information, expose useful
route information such as:

    Канал восстановления: SMS
    Причина: WhatsApp пока недоступен для первого сообщения

Do not add a giant new screen.

Do not show:

    NO_RECORDED_CONSENT

raw enum to operators.

Use Russian human-readable labels.

==================================================
31. CONSENT UI
==================================================

Do NOT build a complex consent-management CRM.

If consent state needs to be visible, keep it minimal.

Never provide a UI button:

    "Mark customer opted in"

without recording an authoritative source.

Consent must have provenance.

==================================================
32. IDEMPOTENCY
==================================================

Required:

One CallInteraction may produce at most one first recovery send for the
winning recovery attempt.

Queue retries must not produce:

    one WhatsApp +
    one SMS

for the same recovery.

Channel selection must become stable once irreversible sending begins.

Do not re-route a retry to another channel after provider acceptance.

For a failed attempt before acceptance, document whether rerouting is
allowed and implement it deterministically.

==================================================
33. CONCURRENCY
==================================================

Test:

    five concurrent Recovery Engine workers

with:

    WhatsApp UNKNOWN consent
    SMS available

Expected:

    exactly one SMS recovery Message/Delivery.

Also test:

    consent becomes OPTED_IN while workers race.

There must still be one deterministic winning recovery path.

==================================================
34. LATE ANSWER
==================================================

MCR-4 late-answer protection remains authoritative.

If the phone call becomes ANSWERED before irreversible recovery send:

    no SMS
    no WhatsApp.

Test this.

==================================================
35. ANTI-SPAM
==================================================

Existing 15-minute anti-spam logic remains channel-independent.

Do not allow:

    call #1 → SMS
    call #2 two minutes later → WhatsApp

to bypass anti-spam merely because the selected channel differs.

Anti-spam protects the customer, not the adapter.

==================================================
36. FAILURE POLICY
==================================================

Examples:

A.

    WhatsApp not permitted
    SMS available

→ SMS_BRIDGE.

B.

    WhatsApp permitted
    WhatsApp adapter unavailable
    SMS available

Decide explicitly whether fallback is allowed BEFORE provider
acceptance.

Prefer safe fallback if no WhatsApp customer-facing message was
accepted.

C.

    WhatsApp provider accepted
    DB confirmation uncertain

→ DO NOT send SMS fallback.

Preserve DELIVERY_UNCERTAIN semantics.

D.

    no eligible channel

→ FAILED / NO_ELIGIBLE_CHANNEL.

==================================================
37. MOCK VERTICAL SLICE
==================================================

Build an integration test:

Business:

    WhatsApp entry configured
    mock SMS enabled
    WhatsApp consent UNKNOWN

Customer:

    valid canonical phone

Flow:

    missed call
    → READY
    → Queue/processor
    → router evaluates WhatsApp
    → UNKNOWN consent
    → selects SMS_BRIDGE
    → deterministic SMS generated
    → mock SMS provider accepts
    → recovery SENT
    → bridge URL exists
    → open bridge
    → redirect targets correct business WhatsApp entry
    → prefilled customer text exists

Assert:

- no WhatsApp business-initiated send occurred;
- no AI call occurred;
- no Customer created;
- no Vehicle created;
- no Request created;
- no Appointment created;
- no fake inbound WhatsApp Message created;
- bridge click tracked;
- no PII in bridge URL.

==================================================
38. SECOND VERTICAL SLICE
==================================================

Business:

    WhatsApp configured
    initiation permitted by recorded authoritative state
    approved recovery mechanism available
    SMS available

Flow:

    missed call
    → router selects WHATSAPP
    → existing deterministic recovery path

Assert:

    SMS is NOT sent.

Do not require real WhatsApp.

Use existing mock adapter.

==================================================
39. THIRD VERTICAL SLICE
==================================================

Business:

    WhatsApp unavailable/not permitted
    SMS unavailable

Expected:

    FAILED
    NO_ELIGIBLE_CHANNEL
    no Conversation if no actual send attempt requires it
    no fake SENT.

==================================================
40. TEST PLAN
==================================================

At minimum test:

A. missed call alone does not create WhatsApp consent.

B. unknown WhatsApp consent ≠ opted-in.

C. opted-out never selects WhatsApp initiation.

D. explicit valid opted-in state may select WhatsApp when technically
   configured.

E. WhatsApp unavailable + SMS available → SMS bridge.

F. WhatsApp unknown consent + SMS available → SMS bridge.

G. no WhatsApp/no SMS → NO_ELIGIBLE_CHANNEL.

H. Telegram never selected.

I. bridge token contains no PII.

J. random/invalid token fails safely.

K. expired token fails safely.

L. token cannot cross tenant.

M. repeated bridge click safe.

N. bridge click does not create consent.

O. bridge click does not create inbound Message.

P. bridge targets correct Business WhatsApp entry.

Q. no global business number leak.

R. prefilled message properly URL encoded.

S. Russian SMS segment estimation correct.

T. deterministic SMS template bounded.

U. duplicate queue delivery → one SMS.

V. five concurrent processors → one SMS.

W. anti-spam works across channels.

X. late ANSWERED → no recovery.

Y. provider accepted WhatsApp → never SMS fallback.

Z. DELIVERY_UNCERTAIN → no second-channel send.

AA. WhatsApp failure before acceptance + SMS available follows the
    explicitly documented fallback policy.

AB. tenant isolation.

AC. recovery decision audit persists.

AD. MCR-4 regression.

AE. MCR-4.1 queue regression.

AF. MCR-5 AI regression.

AG. Prompt 53 Draft regression.

AH. Prompt 55 Qualification regression.

AI. Prompt 56 Booking regression.

==================================================
41. SCHEMA
==================================================

Use the minimum additive schema necessary.

Likely concepts MAY include:

- channel consent/permission;
- recovery selected channel/reason;
- bridge token/bridge event;
- business WhatsApp customer-entry configuration.

But audit existing models first.

Do not create redundant tables if current ChannelConnection,
CallInteraction, ChannelDelivery or Conversation can safely own the
state.

Never edit applied migrations.

==================================================
42. SECURITY
==================================================

Bridge endpoint is public by nature.

Therefore:

- token high entropy;
- no auth session required for redirect;
- token does not grant data access;
- endpoint returns only redirect/error;
- no customer/business details in error response;
- rate-limit or otherwise cheaply reject abuse if current architecture
  supports it;
- no open redirect;
- destination derived only from trusted Business configuration;
- http/javascript arbitrary redirect destinations forbidden;
- log masked/minimal data.

==================================================
43. URL CONFIGURATION
==================================================

Do not hard-code localhost or production domain.

Reuse existing public app/base URL configuration if present.

If a new environment setting is genuinely necessary:

- document it;
- validate it;
- do not commit a real production value;
- tests override safely.

==================================================
44. REAL PROVIDER READINESS
==================================================

At the end MCR-6 should make MCR-7 provider integration small.

Future real SMS adapter should only need roughly:

    capability/config
    send
    delivery webhook

Future real WhatsApp adapter:

    capability/config
    consent/session/template eligibility
    send
    inbound webhook
    delivery webhook

Core Recovery Engine should not need another rewrite.

==================================================
45. VALIDATION
==================================================

Run:

- focused MCR-6 tests;
- recovery engine tests;
- queue tests;
- MCR-5 tests;
- tenant isolation;
- full test suite;
- TypeScript typecheck;
- production build;
- Prisma validate;
- migrate status.

If schema changes:

- apply migration using current repository workflow;
- verify Supabase state;
- verify existing businesses safely default.

If UI changes:

- desktop check;
- 390px check;
- Settings;
- recovery status display.

If browser tooling is unavailable, state it honestly.

Do not block correctness on screenshots.

==================================================
46. DOCUMENTATION
==================================================

Create:

    docs/prompts/mcr-6.md
    docs/final-reports/final-report-mcr-6.md

Update materially:

    docs/PRODUCT_BLUEPRINT.md
    docs/audits/missed-call-recovery-architecture-audit.md

Document:

- routing policy;
- consent semantics;
- session semantics;
- SMS bridge;
- bridge security;
- SMS segment behavior;
- fallback policy;
- idempotency;
- anti-spam;
- what remains mock;
- why Telegram is not required;
- readiness for MCR-7.

==================================================
47. CRITICAL ACCEPTANCE QUESTIONS
==================================================

Answer YES / PARTIAL / NO with evidence.

QUESTION A

If a NEW caller has no recorded WhatsApp permission but SMS recovery is
configured, will AUTOSERVISE choose SMS instead of attempting an
unpermitted WhatsApp initiation?

Expected:

    YES.

QUESTION B

Can the SMS contain a safe one-tap bridge to the correct workshop's
WhatsApp without exposing customer phone, tenantId, businessId or
CallInteraction ID?

Expected:

    YES.

QUESTION C

Does clicking that link falsely mark the customer as WhatsApp opted-in
or create a fake inbound WhatsApp Message?

Expected:

    NO.

QUESTION D

If WhatsApp initiation is genuinely permitted and available, can
AUTOSERVISE choose WhatsApp and avoid sending SMS?

Expected:

    YES.

QUESTION E

Can queue retries/concurrent workers cause both WhatsApp and SMS first
recovery messages to reach the customer for the same recovery?

Expected:

    NO.

QUESTION F

Does existing MCR-5 remain triggered only by a genuine inbound customer
Message rather than by an SMS bridge click?

Expected:

    YES.

QUESTION G

Can a real SMS provider and a real WhatsApp provider later be plugged
in without rewriting Recovery Engine?

Expected:

    YES / explain remaining boundary.

==================================================
48. FINAL REPORT
==================================================

Final Report must include:

1. baseline;
2. schema/migration;
3. routing architecture;
4. capability model;
5. consent model;
6. customer-service-window model;
7. WhatsApp eligibility;
8. SMS eligibility;
9. route reason codes;
10. deterministic SMS template;
11. SMS segment result;
12. SMS adapter;
13. mock SMS safety;
14. bridge architecture;
15. token security;
16. expiry;
17. repeated-click behavior;
18. WhatsApp destination;
19. prefilled message;
20. attribution;
21. privacy;
22. Recovery Engine integration;
23. SENT semantics;
24. route audit;
25. idempotency;
26. concurrency;
27. anti-spam;
28. late answer;
29. fallback policy;
30. DELIVERY_UNCERTAIN;
31. vertical slice #1;
32. vertical slice #2;
33. vertical slice #3;
34. tenant isolation;
35. UI changes;
36. MCR-4 regression;
37. MCR-4.1 regression;
38. MCR-5 regression;
39. total tests before/after;
40. typecheck/build/Prisma;
41. mock vs real providers;
42. known limitations;
43. MCR-7 readiness;
44. files changed;
45. Git result;
46. answers A–G.

==================================================
49. GIT — COMPLETE EVERYTHING YOURSELF
==================================================

The user must not run Git or PowerShell manually.

After implementation:

1. inspect git status;
2. inspect diff;
3. verify only intended MCR-6 changes;
4. verify no secrets/.env committed;
5. run all validation;
6. commit.

Suggested commit:

    feat: add recovery channel routing and sms bridge

7. push origin/master;
8. never force push;
9. verify local master == origin/master;
10. verify clean working tree;
11. include commit hash in Final Report.

==================================================
50. STOP
==================================================

MCR-6 is complete when:

- Recovery Engine has one provider-neutral channel router;
- missed call does not imply WhatsApp consent;
- UNKNOWN consent fails safe;
- eligible WhatsApp can win;
- otherwise configured SMS bridge can win;
- Telegram is not required;
- deterministic SMS bridge template exists;
- SMS segment awareness exists;
- bridge URL is secure and contains no PII;
- click redirects only to trusted business WhatsApp entry;
- click does not fake consent/session/inbound Message;
- routing decision is auditable;
- anti-spam remains channel-independent;
- retries/concurrency cannot double-send across channels;
- DELIVERY_UNCERTAIN cannot trigger dangerous fallback;
- MCR-5 still requires genuine inbound Message;
- tests pass;
- build/typecheck/Prisma pass;
- docs complete;
- commit pushed;
- master == origin/master;
- working tree clean.

DO NOT START MCR-7.

DO NOT CONNECT A REAL SMS PROVIDER.

DO NOT CONNECT REAL WHATSAPP.

DO NOT CONNECT REAL TELEPHONY.

Return the complete MCR-6 Final Report and STOP.
