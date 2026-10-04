# MCR-7B1 — Production WhatsApp Transport / Twilio Pilot

> Verbatim — reproduced exactly as provided in the development
> conversation for this project (not reconstructed, not paraphrased).

---

# MCR-7B1 — PRODUCTION WHATSAPP TRANSPORT / TWILIO PILOT

You are working in the existing AUTOSERVISE repository.

This stage follows completed MCR-7A.

Expected baseline:

    fdf206b
    feat: add production mobizon sms transport

Expected baseline tests:

    2054 / 2054

==================================================
0. OBJECTIVE
==================================================

Implement the first REAL production WhatsApp transport for AUTOSERVISE
using Twilio WhatsApp Business Platform APIs.

This stage is intentionally a PILOT production integration.

Primary real customer journey:

    Customer calls
        ↓
    missed call
        ↓
    Recovery Engine
        ↓
    SMS_BRIDGE via Mobizon
        ↓
    secure /r/<token>
        ↓
    customer opens WhatsApp
        ↓
    customer SENDS a real WhatsApp message
        ↓
    Twilio inbound webhook
        ↓
    AUTOSERVISE Conversation / Message
        ↓
    MCR-5 automatic AI
        ↓
    Twilio outbound WhatsApp reply

This is the first intended end-to-end real conversational path.

Do NOT require a business-initiated WhatsApp template in order to make
this user-initiated pilot path work.

==================================================
1. PRODUCT RULE
==================================================

Customer experience:

    phone call
    → missed
    → SMS
    → one tap
    → WhatsApp
    → useful dialogue

Customer must NOT need:

- AUTOSERVISE account;
- AUTOSERVISE application;
- Telegram.

Telegram remains optional and irrelevant to this flow.

==================================================
2. IMPORTANT ARCHITECTURAL DECISION
==================================================

MCR-7B1 is NOT yet full SaaS WhatsApp onboarding.

Do NOT implement:

    Meta Embedded Signup
    automatic Twilio subaccount creation
    Tech Provider onboarding UI
    hundreds-of-business onboarding

Those belong to:

    MCR-7B2 — Multi-tenant WhatsApp Embedded Signup

MCR-7B1 must nevertheless avoid architecture that would prevent
MCR-7B2 later.

==================================================
3. HARD SCOPE
==================================================

IMPLEMENT:

- TwilioWhatsAppAdapter;
- real WhatsApp outbound messages;
- real inbound WhatsApp webhook;
- Twilio webhook authenticity verification;
- tenant-safe routing by configured WhatsApp sender;
- provider message SID persistence;
- inbound Message persistence;
- Conversation resolution/creation;
- canonical customer phone identity integration;
- genuine inbound → MCR-5 queue trigger;
- 24-hour customer-service-window semantics using authoritative inbound;
- delivery status webhook;
- status mapping;
- duplicate webhook protection;
- out-of-order event protection;
- outbound AI replies through Twilio;
- support for deterministic recovery template IF explicitly configured;
- safe pilot configuration;
- Settings status;
- tests;
- docs;
- Git.

DO NOT IMPLEMENT:

- Meta Embedded Signup;
- Twilio Tech Provider onboarding;
- customer Twilio subaccounts;
- automated Meta app review;
- full template-management UI;
- marketing messages;
- bulk WhatsApp;
- real telephony;
- inbound/two-way SMS;
- CRM integration;
- billing;
- landing page;
- MCR-8.

==================================================
4. BASELINE AUDIT FIRST
==================================================

Before coding:

1. verify branch = master;
2. verify HEAD = fdf206b;
3. verify origin/master matches;
4. verify clean working tree;
5. verify baseline tests approximately 2054;
6. inspect MCR-4 through MCR-7A;
7. inspect ChannelAdapter;
8. inspect existing mock WhatsApp adapter;
9. inspect ChannelConnection/channel configuration;
10. inspect RecoveryChannelRouter;
11. inspect consent/session logic from MCR-6;
12. inspect Conversation inbound APIs;
13. inspect Message uniqueness/idempotency;
14. inspect MCR-5 inbound AI queue trigger;
15. inspect Vercel Queue consumers;
16. inspect ChannelDelivery;
17. inspect customer phone identity;
18. inspect existing Telegram inbound flow for reusable architecture only;
19. inspect Mobizon webhook security patterns;
20. inspect Settings → Channels.

Read:

    docs/PRODUCT_BLUEPRINT.md
    docs/audits/missed-call-recovery-architecture-audit.md
    docs/final-reports/final-report-mcr-6.md
    docs/final-reports/final-report-mcr-7a.md

If baseline materially differs:

STOP and report before broad implementation.

==================================================
5. OFFICIAL TWILIO DOCUMENTATION
==================================================

Use current official Twilio documentation as authority.

Verify before implementation:

- WhatsApp addressing format;
- Messages API;
- inbound WhatsApp webhook fields;
- webhook signature validation;
- status callback fields;
- MessageSid;
- SmsStatus / MessageStatus or current equivalent;
- WaId/profile fields if present;
- template/ContentSid behavior;
- 24-hour customer-service-window behavior;
- error codes;
- media handling;
- retry/webhook behavior.

Do not invent Twilio fields or algorithms.

If current documentation differs from this prompt:

follow current official documentation and explain the difference.

==================================================
6. PROVIDER BOUNDARY
==================================================

Implement:

    TwilioWhatsAppAdapter

behind the existing provider-neutral channel boundary.

Conceptually:

    ChannelAdapter
        ├ MockWhatsAppAdapter
        └ TwilioWhatsAppAdapter

Recovery Engine must NOT import Twilio-specific code.

MCR-5 must NOT import Twilio-specific code.

Future MetaCloudWhatsAppAdapter must remain possible.

==================================================
7. PILOT CREDENTIAL MODEL
==================================================

For MCR-7B1 it is acceptable to use one AUTOSERVISE-controlled Twilio
account for a controlled pilot.

Expected conceptual secrets:

    TWILIO_ACCOUNT_SID
    TWILIO_AUTH_TOKEN

and configuration identifying the WhatsApp sender.

But audit repository conventions first.

Never commit secrets.

Never send Auth Token to frontend.

Never log it.

If credentials are absent:

    Twilio WhatsApp must be unavailable.

Never silently fall back to mock in production.

==================================================
8. BUSINESS-SPECIFIC CONNECTION
==================================================

Do NOT make the WhatsApp sender merely a global environment variable
with no Business ownership.

Each usable WhatsApp sender must map durably to exactly one Business.

Reuse existing ChannelConnection if suitable.

Otherwise add the smallest provider-neutral connection model.

Conceptually:

    Business
      ↓
    ChannelConnection
      provider = TWILIO
      channel = WHATSAPP
      senderPhoneE164
      externalSenderId / metadata
      status
      connectedAt

Secrets should remain outside ordinary database fields where practical.

The sender phone may be metadata.

==================================================
9. INBOUND ROUTING — CRITICAL
==================================================

Inbound Twilio webhook must NEVER trust:

    tenantId
    businessId
    customerId
    conversationId

from external input.

Route using the receiving WhatsApp sender:

    webhook To
        ↓
    canonical WhatsApp sender number
        ↓
    active ChannelConnection
        ↓
    Business
        ↓
    Tenant

If:

- no matching active connection;
- multiple matching active connections;

fail safely.

No tenant guessing.

==================================================
10. FROM / TO NORMALIZATION
==================================================

Twilio commonly uses:

    whatsapp:+<E164>

Normalize safely.

Use MCR-1 phone identity utilities where appropriate.

Inbound:

    From = customer
    To = workshop WhatsApp sender

Outbound:

    From = configured Business sender
    To = customer's canonical phone.

Never use a raw arbitrary browser-supplied destination.

==================================================
11. WEBHOOK AUTHENTICITY
==================================================

Use Twilio's documented request-signature validation.

Do not invent custom HMAC.

Important:

Twilio signature validation can depend on:

- complete external URL;
- parameters/body;
- Auth Token.

Handle Vercel/proxy/public URL correctly.

Do not trust Host/X-Forwarded-* blindly if repository has a canonical
public URL configuration.

Verification MUST happen before database mutation.

Tests:

- valid signature;
- invalid signature;
- missing signature;
- modified payload;
- wrong URL;
- wrong Auth Token.

==================================================
12. INBOUND MESSAGE IDEMPOTENCY
==================================================

Use Twilio's stable provider MessageSid.

A duplicated/retried inbound webhook must produce:

    one inbound Message

not two.

Persist provider identity with a unique constraint/index where
appropriate.

Same MessageSid routed to another tenant/business must fail safely.

==================================================
13. GENUINE INBOUND MESSAGE
==================================================

Only after valid authenticated Twilio webhook:

create/store the genuine customer inbound Message.

This event MAY:

- open/update WhatsApp customer-service window;
- link phone identity;
- wake MCR-5.

A bridge click does NOT.

A missed call does NOT.

An SMS delivery does NOT.

==================================================
14. CONVERSATION RESOLUTION
==================================================

For authenticated WhatsApp inbound:

1. resolve Business from receiving sender;
2. normalize customer From;
3. find existing appropriate WhatsApp Conversation for that
   Business/customer;
4. otherwise create one;
5. use MCR-1 customer identity lookup;
6. if exactly one active matching Customer exists, link it;
7. ambiguous customer matches must remain unlinked;
8. do not auto-merge customers;
9. do not auto-create Customer merely from WhatsApp inbound unless
   existing architecture already explicitly requires that behavior.

Reuse Prompt 54 rules.

==================================================
15. SMS BRIDGE ATTRIBUTION
==================================================

MCR-6 bridge records:

    bridgeOpenedAt

but click itself is not authoritative WhatsApp inbound.

When genuine inbound arrives from the same canonical caller/business:

attempt safe attribution to the recent relevant missed-call recovery.

Do not require hidden token in WhatsApp message.

Use server-side facts:

    Business
    canonical caller number
    recent bridge/recovery
    timing

If exactly one safe recent candidate exists:

record conceptually:

    whatsappInboundAt

or equivalent attribution.

If ambiguous:

do not guess.

Do not block normal inbound Conversation.

==================================================
16. SERVICE WINDOW
==================================================

MCR-6 already has customer-service-window semantics.

Real Twilio inbound must become the authoritative event that opens/
refreshes that window.

Centralize policy.

Do not scatter literal 24-hour checks.

Tests should use injected clock/time.

Opening bridge URL must not open it.

==================================================
17. MCR-5 TRIGGER
==================================================

Once genuine inbound customer Message and AI-turn marker are saved
transactionally:

publish existing:

    ai-conversation-reply

job using the MCR-5 mechanism.

Do NOT create a second AI pipeline.

Queue payload should contain only the minimal existing identifier.

No PII in queue payload.

==================================================
18. AI OUTBOUND WHATSAPP
==================================================

MCR-5 automatic reply should send through the configured
TwilioWhatsAppAdapter for a real Twilio WhatsApp Conversation.

Preserve:

- kill switch;
- staff pause;
- handoff;
- max auto replies;
- pricing grounding;
- address/location grounding;
- availability read-only;
- no autonomous booking;
- no autonomous Customer/Vehicle/Request/Appointment creation.

==================================================
19. OUTBOUND WITHIN OPEN SESSION
==================================================

If the customer-service window is genuinely open:

support normal free-form WhatsApp reply through Twilio.

This covers the primary pilot flow:

    user sends
    → AI answers.

Do not require a template for this path if current Twilio/Meta rules do
not require one.

==================================================
20. BUSINESS-INITIATED TEMPLATE
==================================================

MCR-6 may select WhatsApp directly when initiation is permitted and an
approved recovery template exists.

MCR-7B1 should support this path ONLY if safely practical.

If implemented:

- use Twilio's current approved Content Template mechanism;
- map internal:
      MISSED_CALL_RECOVERY_V1
  to configured provider ContentSid;
- never treat arbitrary free-form text as a business-initiated message;
- require explicit configured approved template;
- fail closed if missing.

Do NOT build template creation/approval UI.

If template sending cannot be safely completed without actual provider
configuration, implement the adapter contract and mark production
template path unavailable until configured.

The SMS→user-initiated WhatsApp pilot must still work.

==================================================
21. CONSENT
==================================================

Do not change:

    missed call ≠ WhatsApp consent
    bridge click ≠ WhatsApp consent

A genuine inbound WhatsApp message proves that a current customer
service conversation exists.

Do NOT automatically convert that fact into unrestricted permanent
marketing consent.

Keep:

    channel session/window

and:

    durable opt-in/opt-out

separate.

==================================================
22. OPT-OUT
==================================================

If MCR-6 already has durable OPTED_OUT:

respect it for business-initiated recovery.

For customer-initiated inbound:

store/process the inbound message safely, but do not silently rewrite a
recorded durable marketing/business-initiation opt-out unless product
rules explicitly define an authoritative re-consent event.

Document the semantics.

==================================================
23. TWILIO SEND REQUEST
==================================================

Use current documented Twilio Messages API.

Requirements:

- HTTPS;
- Basic Auth/current official auth mechanism;
- explicit timeout;
- abort support;
- canonical destination;
- configured Business sender;
- no Auth Token in logs;
- no full customer phone in logs;
- no full customer message in error logs unless existing redacted
  logging policy safely permits it.

Persist returned MessageSid.

Do not store full raw provider response.

==================================================
24. TWILIO IDEMPOTENCY
==================================================

Explicitly research current Twilio outbound idempotency support for
Messages API.

Do not invent an Idempotency-Key if Messages API does not support it.

If an outbound request may have reached Twilio but response is lost:

preserve existing:

    DELIVERY_UNCERTAIN

safety.

Do not blindly regenerate/send another customer message.

Document provider limitation.

==================================================
25. STATUS CALLBACK
==================================================

Configure/support Twilio delivery status callback.

The callback must update existing ChannelDelivery.

Route by provider MessageSid.

Never trust tenant/business IDs from callback.

Verify Twilio signature before mutation.

==================================================
26. DELIVERY STATUS MAPPING
==================================================

Use current official Twilio WhatsApp message statuses.

Map centrally into AUTOSERVISE states.

Examples may include:

    queued
    sent
    delivered
    read
    failed
    undelivered

but use actual documented states.

If current AUTOSERVISE model cannot represent READ:

decide whether to add it or preserve provider-specific observability
without unnecessary schema expansion.

Unknown future status must not crash or falsely mark delivery complete.

==================================================
27. MONOTONIC DELIVERY
==================================================

Protect against out-of-order callbacks.

Examples:

    delivered → sent

must not regress.

    read → delivered

must not regress if READ is modeled as stronger.

Final failure should not overwrite already authoritative delivered/read
unless Twilio semantics specifically require it.

Centralize transition rules.

==================================================
28. INBOUND MEDIA
==================================================

Do not build full media processing.

If inbound WhatsApp contains:

- text → normal supported path;
- image/audio/document without meaningful text → persist enough
  provider/message metadata safely and create an operator handoff or a
  deterministic unsupported-media response according to current
  Conversation architecture.

Do not send image bytes to AI in MCR-7B1.

Do not crash.

Do not invent content from media.

==================================================
29. LOCATION MESSAGES
==================================================

If Twilio supports inbound WhatsApp location payloads:

do not build full location intelligence.

Safely preserve only minimal supported information if architecture
already supports it, otherwise hand off.

Do not expand scope.

==================================================
30. UNKNOWN CUSTOMER
==================================================

A new WhatsApp user may have no Customer record.

This must not block conversation.

Expected:

    Conversation exists
    customer nullable
    inbound Message stored
    AI may answer using general Business context
    later operator can use Prompt 54 intake/link flow.

Do not automatically create Customer if not needed.

==================================================
31. HUMAN HANDOFF
==================================================

Existing MCR-5 handoff behavior remains authoritative.

When AI pauses/escalates:

- automatic WhatsApp replies stop;
- Conversation remains visible;
- operator can answer through existing composer;
- operator reply uses Twilio transport for real WhatsApp conversation.

Do not make operator switch to Twilio Console.

==================================================
32. STAFF REPLY
==================================================

Existing staff send path must work through TwilioWhatsAppAdapter.

Staff reply:

    Conversation
       ↓
    ChannelAdapter
       ↓
    Twilio
       ↓
    customer

This should pause MCR-5 according to existing rules.

No duplicate alternate send implementation.

==================================================
33. BUSINESS CONNECTION UI
==================================================

Settings → Channels:

show minimal WhatsApp connection state.

Conceptually:

    WhatsApp
    Provider: Twilio
    Status: connected / not configured
    Sender: masked number
    Mode: mock / production
    Customer messages: enabled
    Recovery template: configured / not configured

Never show:

- Auth Token;
- full credentials.

Do NOT implement Facebook Embedded Signup yet.

==================================================
34. CONNECTION ACTIVATION
==================================================

MCR-7B1 should provide a controlled server-side way to associate an
already provisioned Twilio WhatsApp sender with a Business.

Prefer existing settings/repository architecture.

Do not let arbitrary manager users attach someone else's sender.

Use owner/admin permissions as appropriate.

Ensure one active sender cannot route to two Businesses.

If a global pilot account is used:

document that limitation.

==================================================
35. SECURITY — WEBHOOK URL
==================================================

Webhook endpoints are public.

Requirements:

- Twilio signature validation first;
- bounded body parsing;
- request size limit where supported;
- no auth cookies required;
- no tenant enumeration;
- generic safe response;
- no raw provider secrets;
- safe error handling.

==================================================
36. WEBHOOK ACKNOWLEDGEMENT
==================================================

Do not keep Twilio waiting for OpenAI.

Inbound webhook path should:

1. authenticate;
2. persist inbound/message marker;
3. enqueue MCR-5;
4. acknowledge promptly.

AI runs asynchronously.

No OpenAI call in the webhook request.

==================================================
37. WEBHOOK RETRIES
==================================================

Twilio may retry.

A retry must not:

- create duplicate Message;
- create duplicate Conversation unnecessarily;
- enqueue duplicate logical AI reply;
- refresh consent/session incorrectly;
- create duplicate recovery attribution.

Use MessageSid/idempotency constraints.

==================================================
38. RECOVERY ENGINE REGRESSION
==================================================

MCR-4 / MCR-6 direct WhatsApp recovery remains:

    eligible
    → approved template configured
    → Twilio WhatsApp send

otherwise:

    SMS bridge.

New caller UNKNOWN consent must still go to SMS.

Do not regress this.

==================================================
39. PRIMARY PRODUCTION-LIKE VERTICAL SLICE
==================================================

Build an integration test with mocked Twilio HTTP but production
adapter code:

    missed call
    → WhatsApp UNKNOWN
    → Mobizon SMS bridge
    → bridge opened
    → authenticated Twilio inbound webhook:
         "Здравствуйте! Я только что звонил в автосервис."
    → correct Business routed by To sender
    → inbound Message stored
    → customer service window opened
    → recent call/bridge safely attributed
    → existing MCR-5 job created
    → mock AI generates grounded reply
    → TwilioWhatsAppAdapter sends outbound
    → Twilio returns MessageSid
    → ChannelDelivery persisted
    → Twilio status callback DELIVERED
    → delivery shown delivered

Assert:

- no fake consent created by call/click;
- AI triggered only by genuine inbound;
- exactly one inbound Message;
- exactly one AI reply;
- no Customer/Vehicle/Request/Appointment auto-created;
- correct tenant;
- correct sender.

==================================================
40. DUPLICATE INBOUND SLICE
==================================================

Deliver same authenticated Twilio MessageSid five times concurrently.

Expected:

    one Message
    one logical AI response
    one Conversation turn

No duplicates.

==================================================
41. CROSS-TENANT SPOOF TEST
==================================================

Attempt:

    valid customer From
    but To sender belonging to Business B
    with data suggesting Business A

Expected:

    routing solely follows trusted configured To sender.

No payload tenant hint may override it.

==================================================
42. UNKNOWN SENDER
==================================================

Authenticated Twilio webhook to an unconfigured receiving WhatsApp
number:

- no Business guessed;
- no Message written;
- no AI;
- safe response;
- no tenant information leaked.

==================================================
43. SESSION WINDOW TESTS
==================================================

Test with injected clock:

T0 genuine inbound
    → open

T0 + 23h59
    → open

T0 + policy boundary
    → verify exact intended semantics

after boundary
    → closed

Bridge click alone:
    → closed

Missed call alone:
    → closed

==================================================
44. OUTBOUND SAFETY TEST
==================================================

If free-form AI reply attempts to send outside allowed customer-service
window:

fail closed.

Do not attempt a free-form Twilio send.

If approved template is configured and product explicitly chooses a
template path, use that distinct path.

Do not silently transform free-form AI text into a template.

==================================================
45. DELIVERY_UNCERTAIN
==================================================

Test:

    outbound Twilio HTTP request may have reached provider
    but response is lost.

Expected:

    DELIVERY_UNCERTAIN
    no automatic duplicate
    no SMS fallback
    no second AI generation.

==================================================
46. REAL PROVIDER NETWORK TESTING
==================================================

Automated tests MUST NOT contact Twilio.

Do not send a paid/live WhatsApp message during implementation unless
deliberate real credentials and a safe test destination already exist.

Expected for this run:

    real WhatsApp message sent: NO

unless explicitly configured.

==================================================
47. CURRENT TWILIO / META ONBOARDING NOTES
==================================================

Document separately:

MCR-7B1 pilot:
- one provisioned WhatsApp sender can be connected manually;
- server-side Twilio credentials;
- controlled Business association.

MCR-7B2 future:
- Meta Tech Provider;
- Embedded Signup;
- one Twilio subaccount per customer/WABA where required;
- self-service sender onboarding;
- Meta App Review;
- Business verification;
- template management.

Do NOT implement MCR-7B2.

==================================================
48. DATABASE
==================================================

Prefer existing models.

Add only additive fields/models necessary for:

- Twilio sender connection;
- provider MessageSid;
- inbound provider idempotency;
- delivery statuses;
- recovery attribution.

Never modify already-applied migrations.

Apply new migration to current Supabase workflow.

Verify existing rows/defaults.

==================================================
49. PRIVACY
==================================================

Never log:

- Auth Token;
- raw credentials;
- full customer phone;
- bridge token;
- full inbound message unnecessarily;
- full webhook body.

Reuse phone masking.

Queue payload must not contain PII.

==================================================
50. TESTS
==================================================

At minimum cover:

- production adapter configuration;
- missing credentials fail closed;
- exact Twilio outbound request;
- canonical From/To;
- provider MessageSid persistence;
- successful inbound webhook;
- valid signature;
- invalid signature;
- modified request rejection;
- unknown sender;
- duplicate inbound;
- concurrent duplicate inbound;
- Conversation resolution;
- ambiguous Customer;
- unknown Customer;
- customer service window;
- bridge does not open window;
- missed call does not create consent;
- SMS bridge attribution;
- ambiguous attribution safely ignored;
- MCR-5 queue trigger;
- AI reply outbound;
- staff reply outbound;
- staff pause;
- handoff;
- delivery callbacks;
- duplicate callback;
- out-of-order callback;
- unknown provider status;
- timeout / DELIVERY_UNCERTAIN;
- free-form outside session fails closed;
- template unavailable fails closed;
- cross-tenant spoof;
- tenant isolation;
- MCR-4;
- MCR-4.1;
- MCR-5;
- MCR-6;
- MCR-7A;
- Prompt 53;
- Prompt 54;
- Prompt 55;
- Prompt 56.

==================================================
51. VALIDATION
==================================================

Run:

- focused MCR-7B1 tests;
- all channel tests;
- recovery tests;
- queue tests;
- AI tests;
- tenant isolation;
- full suite;
- TypeScript typecheck;
- production build;
- Prisma validate;
- migrate status.

If UI changed:

- desktop check;
- 390px check.

If browser tooling unavailable:

state it honestly.

Do not block correctness on screenshots.

==================================================
52. DOCUMENTATION
==================================================

Create:

    docs/prompts/mcr-7b1.md
    docs/final-reports/final-report-mcr-7b1.md

Update materially:

    docs/PRODUCT_BLUEPRINT.md
    docs/audits/missed-call-recovery-architecture-audit.md

Document:

- why Twilio selected for pilot;
- pilot vs Embedded Signup distinction;
- inbound routing;
- webhook security;
- service-window semantics;
- user-initiated primary flow;
- direct template recovery behavior;
- sender configuration;
- provider MessageSid idempotency;
- outbound ambiguity;
- delivery mapping;
- bridge attribution;
- MCR-5 integration;
- security/privacy;
- what remains mock;
- exact provider activation checklist;
- readiness for MCR-7B2/MCR-8.

==================================================
53. PROVIDER ACTIVATION CHECKLIST
==================================================

Final Report must give the exact CURRENT manual steps for the user to
activate a real Twilio WhatsApp pilot.

Derive them from current official Twilio documentation.

Expected categories:

1. create/upgrade Twilio account;
2. establish Meta Business Portfolio requirements;
3. register/self-sign-up WhatsApp sender;
4. verify number ownership if required;
5. obtain Account SID/Auth Token;
6. configure inbound webhook;
7. configure status callback;
8. configure AUTOSERVISE Business connection;
9. add Vercel secrets;
10. deploy;
11. send one controlled user-initiated test message;
12. verify inbound → AI → outbound → delivered.

Do NOT ask the user to perform those steps during implementation.

==================================================
54. ACCEPTANCE QUESTIONS
==================================================

Answer YES / PARTIAL / NO with evidence.

A.
Can an authenticated real Twilio inbound WhatsApp message be routed to
the correct Business without trusting tenant/business IDs from the
webhook?

Expected YES.

B.
Does genuine inbound open/refresh the WhatsApp customer-service window?

Expected YES.

C.
Can bridge click or missed call open that window?

Expected NO.

D.
Can genuine inbound trigger the existing MCR-5 AI pipeline without an
operator button?

Expected YES.

E.
Can MCR-5 reply through Twilio during the open window?

Expected YES.

F.
Can a duplicated inbound webhook create two AI replies?

Expected NO.

G.
Can an invalid Twilio signature mutate data?

Expected NO.

H.
Can staff reply through the same Twilio transport?

Expected YES.

I.
Can a free-form AI message be sent outside the allowed session window?

Expected NO.

J.
Can a lost Twilio response automatically cause a duplicate WhatsApp
message?

Expected NO.

K.
Does unknown WhatsApp consent for a new missed caller still choose SMS
bridge rather than direct WhatsApp?

Expected YES.

L.
Can MCR-7B2 Embedded Signup later be added without rewriting Recovery
Engine or MCR-5?

Expected YES.

==================================================
55. FINAL REPORT
==================================================

Include:

1. baseline;
2. files changed;
3. schema/migration;
4. Twilio APIs used;
5. auth mechanism;
6. adapter architecture;
7. pilot credential model;
8. Business sender mapping;
9. inbound webhook endpoint;
10. signature verification;
11. inbound routing;
12. From/To normalization;
13. MessageSid idempotency;
14. Conversation resolution;
15. Customer linkage;
16. bridge attribution;
17. service window;
18. consent behavior;
19. MCR-5 trigger;
20. outbound AI flow;
21. staff outbound flow;
22. business-initiated template support;
23. status callback;
24. delivery mapping;
25. monotonic transitions;
26. inbound media behavior;
27. unknown customer behavior;
28. handoff;
29. timeout;
30. DELIVERY_UNCERTAIN;
31. provider idempotency findings;
32. privacy;
33. tenant isolation;
34. successful vertical slice;
35. duplicate inbound test;
36. cross-tenant test;
37. session-window tests;
38. MCR regressions;
39. total tests before/after;
40. typecheck;
41. build;
42. Prisma;
43. Supabase status;
44. UI/browser verification;
45. real WhatsApp message sent YES/NO;
46. exact activation checklist;
47. pilot limitations;
48. MCR-7B2 readiness;
49. MCR-8 readiness;
50. answers A–L;
51. Git result and commit hash.

==================================================
56. GIT — COMPLETE EVERYTHING YOURSELF
==================================================

The user must not manually run Git, Prisma, tests or PowerShell.

After implementation:

1. inspect git status;
2. inspect diff;
3. ensure only intended MCR-7B1 changes;
4. verify no secrets/.env committed;
5. run all validation;
6. commit.

Suggested commit:

    feat: add production twilio whatsapp transport

7. git push origin master;
8. never force push;
9. verify local master == origin/master;
10. verify clean working tree;
11. report commit hash.

==================================================
57. STOP
==================================================

MCR-7B1 is complete when:

- TwilioWhatsAppAdapter exists;
- real authenticated inbound webhook exists;
- receiving sender routes to exactly one Business;
- genuine inbound creates one Message;
- genuine inbound opens WhatsApp session;
- bridge click does not;
- genuine inbound triggers MCR-5;
- AI can send through Twilio inside allowed session;
- staff can send through same adapter;
- MessageSid protects inbound idempotency;
- delivery callback is authenticated/idempotent;
- delivery statuses are monotonic;
- outbound ambiguity cannot double-send;
- UNKNOWN new caller still safely uses SMS bridge;
- no secrets/PII leak;
- full regressions pass;
- docs complete;
- commit pushed;
- local master == origin/master;
- working tree clean.

DO NOT START MCR-7B2.

DO NOT IMPLEMENT EMBEDDED SIGNUP.

DO NOT START MCR-8.

Return the complete MCR-7B1 Final Report and STOP.
