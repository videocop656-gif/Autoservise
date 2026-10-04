# MCR-7A — Production SMS Transport / Mobizon Kazakhstan

> Verbatim — reproduced exactly as provided in the development
> conversation for this project (not reconstructed, not paraphrased).

---

# MCR-7A — PRODUCTION SMS TRANSPORT / MOBIZON KAZAKHSTAN

You are working in the existing AUTOSERVISE repository.

This stage follows completed MCR-6.

Expected baseline:

    6033f17
    feat: add recovery channel routing and sms bridge

Expected baseline tests:

    2014 / 2014

==================================================
0. OBJECTIVE
==================================================

Implement the first REAL production outbound transport for
AUTOSERVISE missed-call recovery:

    Mobizon Kazakhstan SMS API

Architecture already exists:

    Missed Call
       ↓
    Recovery Engine
       ↓
    RecoveryChannelRouter
       ↓
    WhatsApp permitted?
       ├ YES → existing WhatsApp path
       └ NO  → SMS_BRIDGE
                   ↓
              SmsAdapter
                   ↓
             MOBIZON API
                   ↓
            customer phone

MCR-7A replaces only the SMS mock transport with an optional
production Mobizon adapter.

Do NOT rewrite Recovery Engine.

==================================================
1. PRODUCT RULE
==================================================

The customer journey remains:

    customer calls
    → call missed
    → AUTOSERVISE selects permitted recovery channel
    → SMS when WhatsApp initiation is not permitted
    → SMS contains secure /r/<token>
    → customer taps
    → WhatsApp opens for that workshop
    → customer sends real message
    → MCR-5 AI

The customer needs:

- no AUTOSERVISE account;
- no AUTOSERVISE app;
- no Telegram.

==================================================
2. HARD SCOPE
==================================================

IMPLEMENT:

- production MobizonSmsAdapter;
- Mobizon outbound API integration;
- secure credentials/configuration;
- provider response mapping;
- provider idempotency protection on our side;
- delivery-status webhook;
- webhook signature verification according to Mobizon's documented
  current protocol;
- webhook event idempotency;
- mapping provider delivery statuses into existing ChannelDelivery;
- provider message ID persistence;
- segment/cost observability where safely available;
- production-vs-mock adapter selection;
- concise production SMS template optimization;
- Settings status;
- tests;
- documentation;
- Git workflow.

DO NOT IMPLEMENT:

- real WhatsApp;
- Meta API;
- Twilio WhatsApp;
- inbound/two-way SMS;
- real telephony;
- Telegram recovery;
- billing;
- external CRM;
- marketing campaigns;
- bulk SMS UI;
- contact imports;
- arbitrary operator-created SMS;
- MCR-7B;
- MCR-8.

==================================================
3. BASELINE AUDIT
==================================================

Before coding:

1. verify branch = master;
2. verify HEAD = 6033f17;
3. verify origin/master matches;
4. verify clean working tree;
5. run/verify baseline tests ~2014;
6. inspect MCR-4, MCR-4.1, MCR-5 and MCR-6;
7. inspect RecoveryChannelRouter;
8. inspect SmsAdapter / MockSmsAdapter;
9. inspect ChannelDelivery;
10. inspect CallInteraction recovery fields;
11. inspect bridge token generation;
12. inspect SMS segment utility;
13. inspect existing webhook verification patterns;
14. inspect Settings → Channels;
15. inspect env validation/configuration architecture.

Read:

    docs/PRODUCT_BLUEPRINT.md
    docs/audits/missed-call-recovery-architecture-audit.md
    docs/final-reports/final-report-mcr-6.md

If baseline materially differs:

STOP and report.

==================================================
4. MOBIZON DOCUMENTATION
==================================================

Use current official Mobizon Kazakhstan API documentation as the
authority.

Do NOT invent API fields/endpoints/signature algorithms.

Relevant concepts to verify against current official documentation:

- API base URL;
- Message.SendSmsMessage;
- API key authentication;
- sender parameter;
- response/message ID;
- delivery webhook;
- sms-delivery-report;
- eventId;
- eventType;
- messageId;
- segNum;
- status;
- to;
- sign;
- webhook retry semantics;
- webhook signature verification.

If official documentation differs from assumptions in this prompt,
follow the official documentation and document the difference.

Do not scrape Mobizon HTML at runtime.

==================================================
5. ADAPTER
==================================================

Implement:

    MobizonSmsAdapter

behind the existing provider-neutral SMS/Channel adapter boundary.

Recovery Engine must NOT import Mobizon-specific code.

Conceptually:

    Recovery Engine
        ↓
    SmsAdapter
        ├ MockSmsAdapter
        └ MobizonSmsAdapter

Future providers must remain replaceable.

==================================================
6. CREDENTIALS
==================================================

Never commit credentials.

Support production configuration through the repository's existing
secret/env strategy.

Expected conceptual configuration:

    MOBIZON_API_KEY
    MOBIZON_API_BASE_URL
    MOBIZON_SENDER
    MOBIZON_WEBHOOK_SECRET / verification material
    SMS_PROVIDER=mobizon

But DO NOT blindly create these exact variables if Mobizon's current
API or the repository architecture requires a better structure.

Use the minimum necessary configuration.

API base URL should have a safe official default if appropriate.

Secrets must never be returned through frontend APIs.

==================================================
7. MULTI-TENANT BOUNDARY
==================================================

Audit MCR-6's channel configuration.

Do NOT accidentally make one global Mobizon sender appear to be a
tenant-specific sender.

For the first pilot it is acceptable to have one AUTOSERVISE-owned
Mobizon account/provider connection if clearly documented.

However:

- Business routing remains tenant-safe;
- CallInteraction determines Business;
- destination is the caller belonging to that CallInteraction;
- frontend cannot choose arbitrary tenant;
- webhook provider message ID must map back to our stored delivery,
  never to a tenant ID supplied by provider payload.

Prepare architecture so future per-business SMS provider credentials
can be added without rewriting Recovery Engine.

Do not build per-business Mobizon onboarding yet unless existing
ChannelConnection makes it trivial.

==================================================
8. OUTBOUND SEND
==================================================

For SMS_BRIDGE recovery:

    Recovery Engine
        ↓
    MobizonSmsAdapter.send(...)

Use:

- canonical E.164 destination from MCR-1;
- deterministic MCR-6 SMS template;
- configured sender;
- existing provider idempotency key.

Never send to:

- invalid phone;
- anonymous/private caller;
- missing canonical destination.

Never use raw user-entered number if canonical E.164 is available.

==================================================
9. HTTP CLIENT
==================================================

Use repository-native HTTP/fetch facilities.

Do not add a heavy SDK unless genuinely required.

Requirements:

- HTTPS;
- explicit timeout;
- abort support;
- bounded response parsing;
- no API key in logs;
- no full customer phone in logs;
- no SMS body in error logs if avoidable;
- classify timeout/network/4xx/5xx errors.

==================================================
10. PROVIDER RESPONSE
==================================================

Map Mobizon response into the existing adapter result.

Persist provider message ID on ChannelDelivery using existing fields
where possible.

Do not store entire raw provider response.

The adapter must distinguish:

    ACCEPTED
    REJECTED
    TRANSIENT_FAILURE
    PERMANENT_FAILURE
    UNCERTAIN

or the closest existing repository semantics.

Do not collapse all errors into generic FAILED.

==================================================
11. RECOVERY SENT SEMANTICS
==================================================

Preserve:

    CallInteraction recovery SENT

means:

    provider accepted outbound recovery SMS

It does NOT mean:

    delivered
    read
    bridge clicked
    WhatsApp opened
    customer replied.

Delivery status is separate.

==================================================
12. DELIVERY WEBHOOK
==================================================

Create a dedicated public Mobizon webhook endpoint.

Conceptually:

    POST /api/webhooks/channels/mobizon

or repository-consistent equivalent.

It receives Mobizon delivery reports.

Do not require AUTOSERVISE user authentication.

Instead require provider authenticity verification.

==================================================
13. WEBHOOK AUTHENTICITY
==================================================

Verify Mobizon's current official webhook signature exactly as
documented.

Never accept an unsigned/invalid webhook if the production protocol
provides signature verification.

Verification occurs BEFORE state mutation.

Use constant-time comparison where applicable.

Do not invent HMAC if Mobizon uses another documented mechanism.

Add tests using documented-format fixtures.

==================================================
14. WEBHOOK ROUTING
==================================================

Never trust:

    tenantId
    businessId
    userId

from webhook input.

Route by stored provider message ID:

    provider message ID
       ↓
    ChannelDelivery
       ↓
    Message / CallInteraction / Business

Unknown provider message ID:

- acknowledge or reject according to safe provider retry semantics;
- no tenant probing;
- no information leakage.

==================================================
15. WEBHOOK IDEMPOTENCY
==================================================

Mobizon webhook retries are expected.

Use provider eventId and/or the strongest stable provider identifier
available.

Same delivery report may arrive multiple times.

Expected:

    one logical state transition.

No duplicate:

- Message;
- Delivery;
- CallInteraction;
- bridge;
- AI event.

==================================================
16. DELIVERY STATUS MAPPING
==================================================

Inspect official Mobizon delivery status values.

Create centralized mapping into existing AUTOSERVISE delivery states.

Examples may include provider concepts such as:

    delivered
    expired
    rejected
    undeliverable

but use current documented values.

Unknown future provider status:

- must not crash;
- must not incorrectly mark DELIVERED;
- should remain observable.

==================================================
17. OUT-OF-ORDER STATUS EVENTS
==================================================

Protect against:

    DELIVERED
    then late weaker status

regressing delivery state.

Create explicit monotonic/status-transition rules.

Test out-of-order delivery webhook events.

==================================================
18. SMS TEMPLATE OPTIMIZATION
==================================================

MCR-6 currently produced approximately:

    125 Cyrillic characters
    → 2 UCS-2 segments

For production recovery this is unnecessarily expensive.

Use existing segment calculator and optimize the deterministic Russian
template.

Target:

    1 UCS-2 SMS segment

WHEN feasible with the actual bridge URL.

Remember concatenated UCS-2 SMS limits.

Do not:

- remove critical meaning;
- transliterate Russian;
- use deceptive wording;
- use public third-party URL shorteners;
- expose PII;
- break /r/<token> security.

A candidate style:

    "Вы звонили в «{{name}}». Мастер занят.
     Напишите нам в WhatsApp: {{url}}"

But determine actual shortest clear version through tests.

==================================================
19. URL LENGTH PROBLEM
==================================================

Audit MCR-6 bridge URL:

    https://<APP_URL>/r/<token>

If production APP_URL makes one UCS-2 segment impossible, DO NOT weaken
token entropy.

Do NOT shorten the secure token merely to save SMS cost.

Document:

- message character count;
- encoding;
- segment count;
- contribution from business name;
- contribution from APP_URL/token.

If needed, prepare support for a dedicated short first-party recovery
domain later.

Do not integrate Bitly or third-party shorteners.

==================================================
20. BUSINESS NAME LENGTH
==================================================

A very long workshop name must not unexpectedly turn recovery into many
segments.

Implement deterministic safe truncation for SMS presentation only if
needed.

Do not modify the actual Business name.

Test:

- short name;
- long Cyrillic name;
- long Latin name.

Prefer clear bounded output.

==================================================
21. SENDER ID
==================================================

Mobizon Kazakhstan may use:

- shared sender;
- registered personal sender.

Treat sender as provider configuration.

Do not assume each workshop already owns an approved Sender ID.

For first pilot, architecture must allow a shared approved Mobizon
sender.

Settings should clearly distinguish:

    SMS provider connected

from:

    workshop has its own branded Sender ID.

Do not claim branded sender if not configured/approved.

==================================================
22. DELIVERY UI
==================================================

Reuse existing Conversation/Delivery UI.

Where useful show Russian statuses:

    Отправляется
    Принято оператором
    Доставлено
    Не доставлено
    Ошибка доставки

Do not expose raw Mobizon status codes as primary UI.

Raw code may be available in technical/debug context if repository
already supports it.

==================================================
23. SETTINGS UI
==================================================

Settings → Channels should show:

    SMS
    Provider: Mobizon
    Status: configured / not configured
    Sender: configured value or safe label
    Mode: mock / production

Never show API key.

Do not build a Mobizon admin panel.

Do not let normal frontend users edit server environment secrets.

==================================================
24. MOCK / PRODUCTION SEPARATION
==================================================

Existing MockSmsAdapter must remain.

Tests must not call Mobizon internet API.

Adapter selection:

    test/dev explicit mock
    production explicit Mobizon

There must be no accidental production fallback to mock.

If production says:

    SMS_PROVIDER=mobizon

but credentials are missing:

    fail closed / channel unavailable.

Do not silently use mock.

==================================================
25. RETRY POLICY
==================================================

Coordinate provider errors with existing MCR-4/MCR-6 retry semantics.

Before provider acceptance:

    safe retry according to existing rules.

After provider acceptance:

    do not send another SMS merely because local confirmation is
    uncertain.

Preserve DELIVERY_UNCERTAIN semantics.

Do not send WhatsApp fallback after provider acceptance.

==================================================
26. TIMEOUT / UNKNOWN OUTCOME
==================================================

Important case:

    HTTP request sent
    ↓
    Mobizon may have accepted it
    ↓
    connection times out before response

Do NOT blindly retry in a way that can duplicate the SMS.

Use the strongest provider/API idempotency capability if Mobizon
supports one.

If Mobizon does NOT support an outbound idempotency key, document the
limitation and map ambiguous post-send timeout to DELIVERY_UNCERTAIN
rather than unsafe automatic resend.

This is critical.

==================================================
27. PROVIDER IDEMPOTENCY RESEARCH
==================================================

Explicitly verify whether Mobizon SendSmsMessage supports:

- client reference;
- idempotency key;
- campaign/message external ID;
- any duplicate-prevention primitive.

If supported:

use it.

If not:

state clearly in Final Report and rely on AUTOSERVISE pre-send atomic
claim + DELIVERY_UNCERTAIN protection.

Do not invent provider idempotency.

==================================================
28. DELIVERY REPORT SEGMENTS
==================================================

Mobizon delivery webhook may report segNum.

Persist/use it only where it improves observability and fits current
schema.

Do not create billing accounting.

Compare provider-reported segment count with our estimator in tests
where possible.

A mismatch must not break delivery processing.

==================================================
29. PRIVACY
==================================================

Never log:

- API key;
- raw full destination phone;
- full webhook payload if it contains phone;
- bridge token;
- customer PII.

Reuse phone masking.

Webhook responses must not reveal:

- tenant;
- business;
- customer;
- call.

==================================================
30. SSRF / CONFIG SAFETY
==================================================

If API base URL is configurable:

- production must default/allow only official HTTPS Mobizon endpoint;
- tests may inject a local/mock transport through dependency injection;
- do not permit arbitrary tenant-controlled provider URL.

==================================================
31. TEST TRANSPORT
==================================================

Do not require live Mobizon credentials for automated tests.

Build an injectable HTTP transport/fetch mock.

Tests must inspect:

- exact outbound request;
- auth placement;
- sender;
- canonical destination;
- text;
- timeout behavior;
- provider response parsing.

==================================================
32. PROVIDER CONTRACT TESTS
==================================================

Create fixtures based on official Mobizon documentation for:

- successful SendSmsMessage;
- API rejection;
- malformed response;
- rate limit if documented;
- server failure;
- timeout;
- valid delivery webhook;
- invalid signature;
- duplicate webhook;
- delivered;
- failed/undeliverable;
- unknown future status.

==================================================
33. END-TO-END MOCKED PRODUCTION SLICE
==================================================

Test:

    missed call
    → Recovery Engine
    → router
    → WhatsApp not permitted
    → SMS_BRIDGE
    → MobizonSmsAdapter
    → mocked Mobizon HTTP 200/accepted
    → provider message ID stored
    → CallInteraction recovery SENT
    → delivery report webhook
    → ChannelDelivery DELIVERED
    → bridge opened
    → correct business WhatsApp redirect

Assert:

- one SMS send;
- no WhatsApp business-initiated send;
- no AI before real inbound;
- no fake inbound;
- no Customer creation;
- no Vehicle;
- no Request;
- no Appointment;
- no PII in URL/logs.

==================================================
34. FAILURE SLICE
==================================================

Test:

    Mobizon rejects SMS before acceptance

Expected:

- recovery failure according to existing retry rules;
- no fake SENT;
- no bridge-open event;
- no WhatsApp fallback after an irreversible attempt unless MCR-6
  explicitly allows safe pre-acceptance rerouting.

Preserve documented MCR-6 policy.

==================================================
35. UNCERTAIN SLICE
==================================================

Test:

    outbound request may have reached Mobizon
    but response is lost/times out

Expected:

    DELIVERY_UNCERTAIN

and:

    NO automatic duplicate SMS
    NO WhatsApp fallback.

==================================================
36. WEBHOOK SECURITY TESTS
==================================================

At minimum:

- valid signature accepted;
- invalid signature rejected before DB write;
- missing signature rejected;
- modified payload fails;
- duplicate event idempotent;
- unknown message ID safe;
- cross-tenant spoof impossible;
- old/out-of-order status cannot regress delivery.

==================================================
37. REGRESSION
==================================================

Run relevant regression for:

- MCR-1 phone identity;
- MCR-2 call intake;
- MCR-4 Recovery Engine;
- MCR-4.1 Vercel Queue;
- MCR-5 automatic AI;
- MCR-6 router;
- Prompt 53 AI draft;
- Prompt 55 qualification;
- Prompt 56 booking;
- tenant isolation.

==================================================
38. DATABASE
==================================================

Prefer existing ChannelDelivery fields.

Only add schema when required for durable provider correctness, such as:

- provider message ID;
- provider event idempotency;
- provider segment count;
- final provider delivery status.

Audit first.

If schema changes:

- additive migration only;
- never edit old applied migration;
- apply using current Supabase workflow;
- verify migrate status;
- verify safe defaults.

==================================================
39. REAL NETWORK SAFETY
==================================================

DO NOT send a real SMS during implementation unless real credentials
are already deliberately configured AND there is an explicit
repository test destination intended for paid provider testing.

Automated tests must never send paid SMS.

If credentials are absent:

production adapter code must still be fully implemented and tested
against mocked HTTP.

Final Report must say:

    real paid SMS sent: YES / NO

Expected now:

    NO

unless an explicitly configured safe test environment exists.

==================================================
40. DOCUMENTATION
==================================================

Create:

    docs/prompts/mcr-7a.md
    docs/final-reports/final-report-mcr-7a.md

Update materially:

    docs/PRODUCT_BLUEPRINT.md
    docs/audits/missed-call-recovery-architecture-audit.md

Document:

- why Mobizon selected for first Kazakhstan SMS transport;
- adapter boundary;
- credential model;
- sender model;
- webhook verification;
- delivery status mapping;
- retry semantics;
- uncertain-delivery semantics;
- provider idempotency capability;
- SMS segment result;
- shared vs branded sender;
- what remains mock;
- real deployment checklist;
- readiness for MCR-7B.

==================================================
41. DEPLOYMENT CHECKLIST
==================================================

Final Report must give the exact manual provider-side steps that the
user will eventually need to perform in Mobizon.

Keep them separate from code work.

Examples:

1. create Mobizon account;
2. choose appropriate Kazakhstan tariff;
3. create API key;
4. choose shared sender for pilot OR register branded sender;
5. configure webhook URL;
6. obtain required webhook verification material;
7. add secrets to Vercel;
8. deploy;
9. send one controlled test SMS;
10. verify delivery webhook.

BUT derive the exact steps from current official Mobizon documentation.

Do not ask the user to do these steps during MCR-7A implementation.

==================================================
42. CRITICAL ACCEPTANCE QUESTIONS
==================================================

Answer YES / PARTIAL / NO with evidence.

A.
Can AUTOSERVISE now send an SMS_BRIDGE through the real Mobizon API
when production credentials are configured?

Expected YES.

B.
With no credentials, can the application/test suite run without
calling Mobizon?

Expected YES.

C.
Can a Mobizon delivery webhook update the correct ChannelDelivery
without trusting tenantId/businessId from webhook input?

Expected YES.

D.
Can an invalid webhook signature mutate state?

Expected NO.

E.
Can a duplicate delivery webhook create duplicate domain events or
messages?

Expected NO.

F.
Can a timeout after a possibly accepted provider request cause an
automatic duplicate SMS?

Expected NO.

G.
Can a delivery failure cause unsafe WhatsApp fallback after SMS
acceptance?

Expected NO.

H.
Does a real Mobizon integration require rewriting Recovery Engine?

Expected NO.

I.
Does MCR-5 still start only from genuine supported inbound customer
messages?

Expected YES.

J.
Can another SMS provider replace Mobizon later behind the same
adapter boundary?

Expected YES.

==================================================
43. FINAL REPORT
==================================================

Include:

1. baseline;
2. files changed;
3. schema/migration;
4. Mobizon API endpoint used;
5. authentication method;
6. adapter architecture;
7. credentials;
8. multi-tenant boundary;
9. sender model;
10. outbound request;
11. response mapping;
12. provider message ID;
13. timeout;
14. idempotency;
15. DELIVERY_UNCERTAIN;
16. retry policy;
17. webhook endpoint;
18. webhook verification;
19. webhook idempotency;
20. delivery status mapping;
21. out-of-order protection;
22. SMS template before/after;
23. character count;
24. encoding;
25. estimated segments;
26. provider-reported segments;
27. long business name handling;
28. Settings UI;
29. Conversation UI;
30. privacy/logging;
31. tenant isolation;
32. successful vertical slice;
33. failure slice;
34. uncertain slice;
35. webhook security tests;
36. MCR regressions;
37. total tests before/after;
38. typecheck;
39. build;
40. Prisma;
41. Supabase migration status;
42. browser/mobile verification;
43. real paid SMS sent YES/NO;
44. exact Mobizon activation checklist;
45. known limitations;
46. MCR-7B readiness;
47. answers A–J;
48. Git result + commit hash.

==================================================
44. GIT — DO EVERYTHING YOURSELF
==================================================

The user must not manually run Git, Prisma, tests or PowerShell.

After implementation:

1. inspect git status;
2. inspect diff;
3. verify only intended MCR-7A changes;
4. verify no credentials/.env/secrets committed;
5. run all validation;
6. commit.

Suggested commit:

    feat: add production mobizon sms transport

7. git push origin master;
8. never force push;
9. verify local master == origin/master;
10. verify clean working tree;
11. report commit hash.

If there are legitimately no code changes, do not create an empty
commit.

==================================================
45. STOP
==================================================

MCR-7A is complete when:

- MobizonSmsAdapter exists;
- Recovery Engine remains provider-neutral;
- production SMS uses Mobizon when explicitly configured;
- mock SMS remains for tests/dev;
- missing production credentials fail closed;
- canonical E.164 destination is used;
- provider message ID is persisted;
- delivery webhook is authenticated;
- duplicate webhooks are idempotent;
- statuses cannot regress;
- ambiguous post-send timeout cannot create automatic duplicate SMS;
- no unsafe second-channel fallback occurs;
- SMS template/segments are measured;
- no secrets or PII leak;
- full regression passes;
- docs are complete;
- commit is pushed;
- master == origin/master;
- working tree is clean.

DO NOT START MCR-7B.

DO NOT CONNECT REAL WHATSAPP.

DO NOT CONNECT REAL TELEPHONY.

Return the complete MCR-7A Final Report and STOP.
