# MCR-3 — Pricing & Business Location Foundation

> Verbatim — reproduced exactly as provided in the development
> conversation for this project (not reconstructed, not paraphrased).

---

# MCR-3 — PRICING & BUSINESS LOCATION FOUNDATION

You are working in the existing AUTOSERVISE repository.

This is the THIRD implementation step after:

- Prompt 57 — Missed Call Recovery Architecture Audit
- MCR-1 — Phone Identity Foundation
- MCR-2 — Missed Call Intake Foundation

Expected current baseline:

    b8a21eb
    feat: add missed call intake foundation

MCR-2 established:

    inbound call
    → called-number routing
    → CallInteraction
    → MISSED / ANSWERED
    → Customer resolution
    → READY for future recovery

MCR-3 does NOT send recovery messages.

MCR-3 strengthens the BUSINESS KNOWLEDGE required for the future customer conversation.

The goal is that AUTOSERVISE can safely answer practical questions such as:

    "Сколько стоит?"
    "Это окончательная цена?"
    "Нужно сначала приехать на осмотр?"
    "Где вы находитесь?"
    "Как к вам приехать?"
    "Можно прислать адрес?"
    "Сколько примерно занимает эта работа?"

without inventing information.

==================================================
0. HARD SCOPE BOUNDARY
==================================================

IMPLEMENT:

- audit and improve structured Service pricing semantics;
- explicit support for indicative/from/range/fixed pricing as required by the real current schema;
- pricing notes/conditions where needed;
- explicit inspection-required semantics;
- business location/contact data required for customer answers;
- map/location link support if appropriate;
- AI context exposure of these authoritative fields;
- AI safety wording/contract updates;
- minimal existing Settings UI changes needed to manage the fields;
- API validation;
- tenant isolation;
- migrations;
- tests;
- documentation;
- commit + push.

DO NOT IMPLEMENT:

- MCR-4 recovery orchestration;
- sending any customer message;
- WhatsApp;
- SMS;
- real telephony;
- Channel Router;
- automatic AI replies;
- CallInteraction changes unless strictly required by a compile-time/shared-type consequence;
- customer portal;
- maps SDK;
- Google Maps API;
- geocoding service;
- route calculation;
- voice AI;
- payment processing;
- CRM integration;
- dashboard redesign;
- Operations redesign;
- landing page changes.

==================================================
1. BASELINE / SAFETY CHECK
==================================================

Before changing anything:

1. Inspect actual repository state.
2. Verify branch is `master`.
3. Verify expected HEAD and origin/master:

       b8a21eb

4. Verify working tree is clean.
5. Verify MCR-2 Final Report exists.
6. Read the real implementation of:

   - Prisma Service model;
   - Business model;
   - Services Settings;
   - Business Settings;
   - Knowledge;
   - BusinessRule;
   - business hours;
   - AI context builder;
   - AI system prompt / safety contract;
   - AI draft mode from Prompt 53;
   - qualification mode from Prompt 55;
   - appointment/availability service;
   - service DTOs/validation;
   - business DTOs/validation;
   - tenant isolation tests;
   - currency handling;
   - existing address/contact fields.

Also read:

   docs/audits/missed-call-recovery-architecture-audit.md
   docs/PRODUCT_BLUEPRINT.md
   docs/final-reports/final-report-mcr-1.md
   docs/final-reports/final-report-mcr-2.md

Do NOT rely on old reports where actual code differs.

If repository state differs materially from baseline, STOP and report before implementation.

==================================================
2. PRODUCT GOAL
==================================================

The future missed-call recovery conversation must become useful quickly.

Example:

Customer:
    "Хочу покрасить капот и крышу BMW X5."

AUTOSERVISE should eventually be able to say something like:

    "Да, такую работу выполняем.
     Покраска капота — от 40 000 ₸.
     Точная стоимость зависит от состояния детали
     и подтверждается после осмотра.

     Мы находимся по адресу ...
     Если хотите, могу подобрать время для осмотра."

But ONLY if these facts are actually configured.

AUTOSERVISE must never fabricate:

- price;
- discount;
- warranty;
- duration;
- service availability;
- inspection requirement;
- address;
- location;
- payment methods;
- business policy.

MCR-3 creates the authoritative structured data for PRICE and LOCATION.

==================================================
3. FIRST AUDIT THE EXISTING SERVICE MODEL
==================================================

Do not blindly add fields.

Inspect exactly how Service currently stores:

- price;
- price minimum;
- price maximum;
- currency;
- duration;
- active state;
- name/description.

Prompt 57 reported that the model already supports some form of:

    fixed / from / range

pricing.

Verify this against current code.

Then choose the SMALLEST extension that accurately represents:

A. FIXED

    "Замена масла — 15 000 ₸"

B. FROM / STARTING PRICE

    "Покраска капота — от 40 000 ₸"

C. RANGE

    "Диагностика — 10 000–20 000 ₸"

D. NO CONFIGURED PRICE

    "Стоимость уточнит мастер."

Do NOT create a complex pricing engine.

Do NOT add dynamic formulas.

Do NOT add vehicle-specific pricing tables.

Do NOT add parts catalogs.

We need reliable customer communication, not an ERP.

==================================================
4. PRICE SEMANTICS
==================================================

Create or formalize one deterministic server-side interpretation of Service pricing.

The application should be able to derive a semantic result conceptually like:

    FIXED
    FROM
    RANGE
    UNAVAILABLE

based on authoritative structured data.

Do not let individual UI components or AI prompts independently guess what min/max values mean.

Create a shared server-side pricing representation/helper if appropriate.

Examples:

priceMin = 15000
priceMax = 15000
    → FIXED 15 000 ₸

priceMin = 40000
priceMax = null
    → FROM 40 000 ₸

priceMin = 40000
priceMax = 60000
    → RANGE 40 000–60 000 ₸

no price
    → UNAVAILABLE

If the current schema uses different semantics, preserve compatibility and document the canonical interpretation.

Do not silently turn malformed pricing data into a customer-facing claim.

==================================================
5. PRICE NOTE / CONDITIONS
==================================================

Add a minimal structured/free-text field only if it does not already exist for pricing conditions.

Conceptually:

    priceNote

Examples:

    "Цена зависит от состояния детали."
    "Без стоимости запчастей."
    "Для точной оценки нужен осмотр."
    "Цена указана за одну деталь."

This field is NOT the price itself.

Service structured numeric fields remain the source of numeric pricing.

Knowledge must NOT override a structured Service price.

Requirements:

- optional;
- business/tenant-owned through Service;
- reasonable max length;
- sanitized/validated according to existing API philosophy;
- exposed to AI as authoritative business-configured context.

Do not add rich HTML.

==================================================
6. INSPECTION REQUIRED
==================================================

Add an explicit field if not already represented:

    requiresInspection

Boolean is likely sufficient unless real code proves otherwise.

Purpose:

The AI must know whether it should say:

    "Точная стоимость подтверждается после осмотра."

Do NOT infer inspection requirement merely because:

    priceMin != priceMax

Some businesses may have a range without requiring physical inspection.

Likewise a "from" price does not automatically prove inspection is required.

The business must configure this explicitly.

Default must preserve existing behavior safely.

Do not suddenly claim all existing services require inspection.

==================================================
7. CUSTOMER-FACING PRICE FORMATTER
==================================================

Create/reuse one deterministic formatter for customer-facing price information.

It should respect the business/service currency architecture already in the repository.

Examples conceptually:

    15000 KZT
        → "15 000 ₸"

    from 40000 KZT
        → "от 40 000 ₸"

    40000–60000 KZT
        → "40 000–60 000 ₸"

No configured price:
        → no invented number

Do not hard-code KZT if the application already supports currencies.

Kazakhstan display should be natural.

Keep formatting separate from AI reasoning.

The AI should receive semantic facts rather than being asked to infer price semantics from raw nullable numbers.

==================================================
8. BUSINESS LOCATION AUDIT
==================================================

Inspect exactly what Business currently stores.

Prompt 57 reported:

    text address exists
    no map link / coordinates

Verify.

For the MVP we need to answer:

    "Где вы?"
    "Как к вам приехать?"
    "Пришлите адрес."

Implement the smallest useful location model.

Prefer something conceptually like:

    address        // existing human-readable address
    locationUrl    // optional configured maps/location link

Only add:

    latitude
    longitude

if there is a concrete immediate product reason.

Do NOT add coordinates merely because maps systems often have them.

A configured map/location URL may be enough for the first MVP.

Do NOT add:

- Maps API;
- geocoding;
- map rendering SDK;
- directions API;
- automatic address lookup.

The business should configure its own authoritative location.

==================================================
9. LOCATION URL SAFETY
==================================================

If a location/map URL is added:

- validate it as a URL;
- allow only appropriate safe HTTP(S) URLs;
- reject javascript/data/etc.;
- reasonable max length;
- do not fetch the URL server-side;
- do not attempt URL previewing;
- do not trust it as HTML.

It may point to:

- Google Maps;
- 2GIS;
- Yandex Maps;
- another legitimate maps/location service.

Do NOT unnecessarily lock the schema to one provider.

==================================================
10. BUSINESS CONTACT INFORMATION
==================================================

Audit current business contact fields.

Determine whether the AI already has authoritative access to:

- business name;
- phone;
- address;
- hours.

Expose existing authoritative values consistently.

Do not add duplicate fields if the data already exists.

MCR-3 should not become a generic business-profile redesign.

==================================================
11. KNOWLEDGE RESPONSIBILITY
==================================================

Establish/document a clean boundary:

STRUCTURED SERVICE DATA owns:

- service name;
- active status;
- numeric price;
- price semantics;
- duration;
- price conditions;
- requiresInspection.

STRUCTURED BUSINESS DATA owns:

- business name;
- address;
- location URL;
- working hours;
- contact details that already exist.

KNOWLEDGE owns explanatory/unstructured information such as:

- warranty policy;
- payment methods;
- preparation instructions;
- FAQ;
- service limitations not modeled structurally;
- general customer information.

IMPORTANT:

Knowledge must not become a second source of truth for numeric prices.

If Knowledge says one price and Service says another, future AI must treat Service as authoritative.

Document this rule.

Do not attempt automatic conflict resolution in MCR-3 unless existing AI context makes it necessary to prevent unsafe pricing.

==================================================
12. AI CONTEXT
==================================================

Update the canonical AI context so the AI receives structured, explicit facts.

For each relevant active Service, provide semantics conceptually equivalent to:

    name
    pricingType
    formattedPrice
    priceMin
    priceMax
    currency
    priceNote
    requiresInspection
    duration

Do not expose unnecessary internal database details.

For Business provide:

    business name
    address
    locationUrl if configured
    working hours
    existing relevant contact info

The AI should not need to infer:

    whether price is fixed/from/range
    whether inspection is required
    whether a map link exists

Give these as explicit facts.

==================================================
13. AI SAFETY CONTRACT
==================================================

Strengthen the AI system contract.

Required rules:

PRICE:

1. Never invent a price.
2. Never infer a numeric price from general Knowledge.
3. Use only configured structured Service price.
4. Preserve semantics:
   - fixed = fixed;
   - from = say "от";
   - range = communicate range;
   - unavailable = say price needs confirmation.
5. Never turn indicative/from/range into a guaranteed final price.
6. If `requiresInspection = true`, explicitly explain that final price is confirmed after inspection.
7. If `priceNote` exists and is relevant, preserve its meaning.
8. Never invent discounts.

LOCATION:

1. Use only configured Business address/location.
2. Never invent an address.
3. Never invent directions.
4. If locationUrl exists, it may be shared.
5. If it does not exist, do not fabricate a map link.

DIAGNOSIS:

Preserve existing rule:
    do not present remote diagnosis as fact.

BOOKING:

Preserve Prompt 56:
    never promise availability without authoritative availability.

==================================================
14. DO NOT TURN AI INTO A LONG QUESTIONNAIRE
==================================================

Add/document this conversational rule for future customer-facing behavior:

    Give useful information as early as possible.

If the customer asks:

    "Сколько стоит покрасить капот BMW X5?"

and configured Service information is sufficient to provide a safe starting price, the AI should not unnecessarily ask five questions before giving it.

It may say:

    "Покраска капота — от X.
     Точная стоимость после осмотра.
     Подскажите год автомобиля..."

if year is genuinely useful.

The purpose is:

    useful answer
    → minimal clarification
    → visit/booking

not:

    questionnaire
    → questionnaire
    → questionnaire.

Do not implement MCR auto-conversation yet.

This rule belongs in the canonical AI behavior contract so future MCR-5 can reuse it.

==================================================
15. SETTINGS — SERVICES
==================================================

Update the existing Services Settings UI minimally so owner/admin can configure the new semantics.

Reuse the current design system.

Possible fields depending on actual schema:

- price from/min;
- price to/max;
- price note;
- requires inspection;
- duration;
- active.

Do NOT create a separate pricing page.

Use clear Russian labels.

Examples:

    Цена от
    Цена до
    Условия цены
    Требуется осмотр для точной стоимости

Add short helper text only where ambiguity exists.

Do not overload the form.

Preserve existing create/edit flows.

==================================================
16. SETTINGS — BUSINESS LOCATION
==================================================

Update the existing Business Settings minimally.

If address already exists, keep it.

Add only required missing location configuration.

Example:

    Адрес
    Ссылка на карту / геолокацию

Use Russian UI consistent with the rest of the application.

Do not add map widgets.

Do not add autocomplete.

Do not add third-party map SDKs.

==================================================
17. API / VALIDATION
==================================================

Update existing APIs rather than creating parallel ones.

Validate:

Pricing:
- non-negative values;
- min/max logical consistency;
- currency consistency with existing domain;
- priceNote length;
- boolean inspection flag.

Location:
- address according to existing validation;
- location URL safe HTTP(S);
- reasonable lengths.

Do not trust client-side validation alone.

Preserve role checks.

Preserve tenant ownership.

==================================================
18. BACKWARD COMPATIBILITY
==================================================

Existing services/businesses must remain valid after migration.

Choose safe defaults.

Existing price information must retain its current meaning.

Do not transform existing prices into different customer claims.

For new fields:

    priceNote
        → null

    requiresInspection
        → false

unless the real current domain proves a different default is necessary.

Existing Business address must remain unchanged.

Existing AI flows from Prompts 53 and 55 must continue working.

==================================================
19. TESTS — PRICING
==================================================

Add focused tests for at least:

A. Pricing semantics

- fixed
- from
- range
- unavailable
- malformed/inconsistent input rejected

B. Formatting

- KZT fixed
- KZT from
- KZT range
- another existing supported currency if applicable
- no configured price

C. Inspection

- false does not claim inspection required
- true produces explicit authoritative context
- price type does not automatically determine inspection

D. Price notes

- stored and returned
- max length validation
- tenant isolation
- AI context receives correct note

E. AI safety

Test deterministic context/prompt construction where possible:

- no price → no invented price fact
- FROM remains FROM
- RANGE remains RANGE
- inspection true is explicit
- Service price remains authoritative over Knowledge text

Do not write brittle tests against arbitrary full AI prose.

==================================================
20. TESTS — LOCATION
==================================================

Test at least:

- address preserved;
- valid HTTPS location URL;
- valid HTTP if product security policy permits it;
- javascript URL rejected;
- malformed URL rejected;
- clearing optional URL;
- another tenant cannot change/read private configuration through unauthorized endpoint;
- AI context gets address/location correctly;
- no configured URL does not produce a fake URL.

==================================================
21. EXISTING AI FLOWS REGRESSION
==================================================

Verify:

Prompt 53:
    Предложить ответ AI

Prompt 55:
    Разобрать обращение

continue to work.

MCR-3 must not accidentally allow mutation tools in draft/qualification modes.

MCR-3 must not introduce automatic sending.

If real OpenAI credentials are unavailable, test through existing mocks/contracts.

Do not require a paid external AI call for validation.

==================================================
22. MOBILE / UI CHECK
==================================================

Because Settings UI changes are included:

verify at least:

- desktop;
- approximately 390 px mobile width;
- no horizontal overflow;
- labels readable;
- forms usable;
- existing dark graphite/gold design preserved.

Do not redesign the UI.

==================================================
23. DATABASE MIGRATION / SUPABASE
==================================================

Create NEW migration(s).

Do NOT edit MCR-1 or MCR-2 applied migrations.

Requirements:

- additive where possible;
- safe defaults;
- no database reset;
- no destructive cleanup;
- no unrelated schema changes.

Use the established Supabase + Prisma workflow.

If configured dev Supabase is available:

- apply migration;
- verify columns/defaults/constraints;
- verify existing records remain intact;
- perform test-tenant live verification.

Do not modify real tenant data.

==================================================
24. LIVE VERIFICATION
==================================================

Use only the existing test tenant.

Create clearly identifiable MCR-3 test data.

Verify a realistic example such as:

SERVICE:

    Покраска капота
    price from: 40000 KZT
    price to: null
    price note:
        "Цена зависит от состояния детали."
    requiresInspection: true

BUSINESS:

    address:
        configured test address

    location URL:
        safe test maps URL

Verify through real application/API paths that:

1. Service settings save correctly.
2. Business location saves correctly.
3. AI context represents:

       price type = FROM
       from 40 000 ₸
       inspection required
       pricing condition
       address
       location URL

4. No price is invented for a service without price.
5. Another tenant cannot access/change these records.
6. Existing booking/availability still works.
7. No messages are automatically sent.
8. No CallInteraction is changed by MCR-3.

Clean up temporary test records where safely possible.

Report anything intentionally left behind.

==================================================
25. VALIDATION
==================================================

Run normal validation for schema/backend/UI changes.

At minimum:

- Prisma validate;
- migration status;
- TypeScript typecheck;
- focused MCR-3 tests;
- tenant isolation tests;
- full test suite;
- production build.

Regarding the existing repository-wide:

    prisma format --check

problem:

MCR-1 and MCR-2 both confirmed this predates these prompts.

Do not claim it is fixed unless you actually fix it.

Do not reformat unrelated legacy schema merely to make the check green.

Ensure your own schema additions are properly formatted/valid.

==================================================
26. DOCUMENTATION
==================================================

Follow repository conventions.

Create:

    docs/prompts/mcr-3.md

    docs/final-reports/final-report-mcr-3.md

Update Product Blueprint / AI contract / architecture docs only where the implementation materially changes documented behavior.

Final Report must include:

1. baseline;
2. existing pricing audit;
3. schema changes;
4. canonical pricing semantics;
5. price formatter;
6. priceNote behavior;
7. requiresInspection behavior;
8. business location design;
9. location URL security;
10. Knowledge vs structured-data responsibility;
11. AI context changes;
12. AI safety contract changes;
13. Settings changes;
14. API/validation changes;
15. backward compatibility;
16. tenant isolation;
17. Prompt 53/55 regression result;
18. live verification;
19. mobile UI verification;
20. tests count;
21. Prisma/typecheck/build results;
22. Supabase migration result;
23. files changed;
24. test data remaining;
25. known limitations;
26. readiness for MCR-4;
27. Git result.

==================================================
27. IMPORTANT MCR-4 READINESS QUESTION
==================================================

At the end of MCR-3 explicitly answer:

If tomorrow MCR-4 receives:

    CallInteraction READY
    caller: +7...
    customer: optional

and the customer later says:

    "Нужно покрасить капот BMW X5.
     Сколько стоит и где вы находитесь?"

Does the existing AUTOSERVISE authoritative context now contain enough information to safely answer:

- whether the configured service exists;
- fixed/from/range/no price;
- pricing conditions;
- whether inspection is required;
- duration if configured;
- business address;
- location link if configured;
- business hours;
- real free slots through existing availability;

WITHOUT inventing any of those facts?

Answer each item YES / PARTIAL / NO with explanation.

Do NOT implement MCR-4.

==================================================
28. GIT — HANDLE EVERYTHING YOURSELF
==================================================

The user must NOT need to run Git or PowerShell manually.

You are responsible for the full Git workflow.

After implementation and validation:

1. inspect git status;
2. inspect final diff;
3. ensure only intended MCR-3 changes exist;
4. ensure no `.env`, secrets or unrelated artifacts are committed;
5. include legitimate migration files;
6. commit all intended changes.

Use a clear commit message such as:

    feat: add customer pricing and location context

7. push to:

    origin/master

8. DO NOT force-push;
9. verify local master and origin/master point to the same commit;
10. verify working tree is clean.

Do not ask the user to perform these Git commands.

==================================================
29. STOP CONDITION
==================================================

MCR-3 is complete only when:

- authoritative pricing semantics exist;
- fixed/from/range/no-price are deterministic;
- AI does not need to guess price semantics;
- price conditions can be configured;
- inspection requirement can be configured;
- price display is deterministic;
- Knowledge is not a competing numeric-price source;
- authoritative business address is available;
- optional safe location URL is available;
- AI receives the structured price/location facts;
- AI safety contract forbids invented price/location;
- Service Settings can configure required fields;
- Business Settings can configure required location;
- existing AI flows still work;
- tenant isolation is preserved;
- migration is applied and verified;
- tests pass;
- build/typecheck/Prisma checks pass;
- documentation is complete;
- intended changes are committed;
- commit is pushed to origin/master;
- local/remote are synchronized;
- working tree is clean.

DO NOT proceed to MCR-4.

Return the complete MCR-3 Final Report and STOP.
