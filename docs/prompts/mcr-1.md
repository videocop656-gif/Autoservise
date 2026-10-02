# MCR-1 — Phone Identity Foundation

> Verbatim — reproduced exactly as provided in the development
> conversation for this project (not reconstructed, not paraphrased).
> Context: work on MCR-1 had already started from the Prompt 57 audit plan
> (after the user's «начинаем работать» and approval of a schema delta)
> when this prompt arrived; the user then instructed «новый промт используй»,
> and the implementation was brought in line with this prompt.

---

# MCR-1 — PHONE IDENTITY FOUNDATION

You are working in the existing AUTOSERVISE repository.

This is the FIRST implementation step after Prompt 57 / Missed Call Recovery Architecture Audit.

The product direction established in Prompt 57 is authoritative:

    missed phone call
    → immediate recovery
    → useful customer dialogue
    → visit / booking / human handoff

This prompt builds ONLY the phone identity foundation required for that future flow.

DO NOT implement telephony.
DO NOT implement WhatsApp.
DO NOT implement SMS.
DO NOT implement missed-call recovery.
DO NOT implement automatic AI replies.
DO NOT implement CallInteraction yet.
DO NOT redesign UI.
DO NOT modify the launch screen.
DO NOT proceed to MCR-2.

==================================================
0. BASELINE / SAFETY CHECK
==================================================

Before changing anything:

1. Inspect the real repository state.
2. Verify branch is `master`.
3. Expected HEAD / origin/master:

   42ff6f2

   `docs: redefine mvp around missed call recovery`

4. Verify working tree is clean.
5. Read:
   - docs/audits/missed-call-recovery-architecture-audit.md
   - docs/PRODUCT_BLUEPRINT.md
   - docs/final-reports/final-report-57.md
   - current Prisma schema
   - current Customer model
   - current Business model
   - current phone matching / customer resolution code
   - Conversation customer intake from Prompt 54
   - channel inbound/customer resolution logic
   - tenant isolation tests
   - existing phone validation/normalization helpers, if any

Do not assume Prompt 57's proposed implementation details are automatically correct.

Verify them against the real code first.

If repository state differs materially from the expected baseline, STOP and report before implementing.

==================================================
1. GOAL
==================================================

Make phone numbers a reliable first-class identity input for the future:

    missed call
    → caller phone
    → tenant/business
    → existing customer lookup
    → safe linking

Current behavior based on free-text phone / last-digit matching is not strong enough for telephony events.

MCR-1 must provide:

1. one canonical phone normalization implementation;
2. canonical customer phone storage;
3. indexed lookup;
4. safe migration/backfill of existing customer data;
5. deterministic tenant-scoped customer resolution;
6. business-level default phone country/region configuration if actually required by the existing data;
7. safe phone masking for logs;
8. preservation of existing customer intake behavior;
9. no cross-tenant identity leakage.

==================================================
2. IMPORTANT DESIGN RULE — USE A REAL PHONE LIBRARY IF APPROPRIATE
==================================================

Do NOT create a fragile custom international phone parser if a mature, lightweight, actively maintained library already fits the existing Node/TypeScript stack.

First inspect current dependencies.

If an appropriate phone-number parsing/normalization library is already installed, reuse it.

If not, evaluate adding a minimal dependency such as a libphonenumber-based package.

Requirements:

- works server-side in Node/TypeScript;
- supports Kazakhstan correctly;
- supports Russia correctly;
- supports international E.164 numbers;
- can parse local/national input when a default region is supplied;
- does not require a large unrelated framework;
- does not expose phone numbers externally.

Document the choice.

Do NOT implement normalization using only:

    remove non-digits
    + take last 10 digits
    + prepend +7

That heuristic must no longer be the canonical identity algorithm.

==================================================
3. PHONE NORMALIZATION CONTRACT
==================================================

Create ONE shared server-side normalization contract.

Conceptually:

    normalizePhone(input, defaultRegion?)

Result should distinguish at least:

- valid canonical E.164 number;
- empty/no phone;
- invalid/unparseable phone.

Examples that should be considered for Kazakhstan:

    +7 701 123 45 67
    87011234567
    8 (701) 123-45-67
    7011234567

When the configured default region is Kazakhstan, valid equivalent forms should resolve to the same canonical value:

    +77011234567

But:

- do not blindly reinterpret arbitrary international numbers as Kazakhstan;
- preserve correct international numbers;
- do not silently invent digits;
- invalid input must not become an identity.

Create focused unit tests for normalization.

Include Kazakhstan and Russia cases, plus at least several non-+7 international cases to ensure the abstraction is not hard-coded to one numbering plan.

==================================================
4. DEFAULT REGION / BUSINESS CONFIGURATION
==================================================

Prompt 57 suggested a default country per business.

Verify whether Business or Tenant already contains a suitable country/locale field.

Prefer reusing existing configuration.

Only add a new field if there is no authoritative existing source.

The goal is NOT to build country management.

The goal is simply to make inputs such as:

    87011234567

unambiguous for the business.

For the current launch context, Kazakhstan must be supported cleanly.

If adding a field, prefer a stable machine-readable region/country representation rather than localized display text.

Examples conceptually:

    KZ
    RU

Do not use timezone as a substitute for country.

Document fallback behavior.

Do not silently assume KZ for every future tenant unless the product explicitly has that default at creation time.

==================================================
5. CUSTOMER CANONICAL PHONE STORAGE
==================================================

Audit the current Customer phone field.

Preserve the original/display phone if it is useful for UI/backward compatibility.

Add a canonical normalized field only if necessary.

Conceptually:

    phone             // existing display/original value
    phoneNormalized   // canonical E.164 identity value

Requirements:

- nullable where Customer phone is optional;
- indexed for tenant/business-scoped lookup;
- canonical E.164 when valid;
- invalid legacy values must NOT cause migration failure;
- invalid values may remain with normalized field NULL;
- do NOT overwrite the user's original display value unnecessarily.

Do NOT add a global unique constraint on phoneNormalized.

Do NOT assume one phone number can belong to only one tenant.

A customer may legitimately exist in multiple auto-service businesses.

==================================================
6. TENANT-SCOPED LOOKUP
==================================================

Replace the current last-10-digits / regex/full-table-scan heuristic in identity resolution with indexed canonical lookup.

Resolution must remain tenant/business scoped.

Required behavior:

    canonical incoming phone
    +
    tenant/business scope
    →
    matching active customer(s)

Preserve the important safety rule from the existing architecture:

    link automatically ONLY when the match is unambiguous.

If exactly one valid matching customer exists in the relevant scope:
    resolve it.

If zero:
    return no customer.

If more than one:
    return ambiguous / do not auto-link.

Do NOT merge customers automatically.

Do NOT auto-create a Customer just because a phone number appeared.

Unknown future callers must be allowed to remain unlinked.

==================================================
7. CUSTOMER CREATE / UPDATE CONSISTENCY
==================================================

Every relevant server-side Customer create/update path must keep canonical phone identity consistent.

Audit all paths, including:

- normal customer CRUD;
- Conversation customer intake from Prompt 54;
- any tests/helpers/seed paths that exercise production services.

When phone changes:

    recompute canonical value.

When phone is removed:

    clear canonical value.

When invalid phone is submitted:

Follow the existing product validation philosophy.

Do not introduce surprising behavior.

If the current UI permits free-form phone values, decide carefully whether this prompt should reject invalid NEW values or preserve them with normalized NULL.

Prefer identity correctness without breaking unrelated legacy behavior.

Document the decision.

==================================================
8. DUPLICATE HANDLING
==================================================

Prompt 54 already performs duplicate-phone protection.

Refactor it to use canonical phone identity rather than the old heuristic.

Within the same business/tenant:

- if canonical phone clearly matches an existing customer, preserve the existing "link existing customer" behavior;
- do not create a silent duplicate where current product rules already prevent it.

However:

Do NOT add a database UNIQUE constraint unless the real domain and existing code prove it is safe.

Prompt 57 explicitly recommended indexed, not globally unique, canonical phone storage.

Preserve tenant isolation.

==================================================
9. BACKFILL / MIGRATION
==================================================

Create a safe Prisma migration for the required schema changes.

Backfill existing Customer records.

Requirements:

- valid existing numbers become canonical E.164;
- malformed/unknown legacy phone strings must not abort migration;
- invalid values should result in NULL canonical identity;
- preserve original phone;
- tenant isolation unaffected.

IMPORTANT:

Prisma SQL migrations cannot automatically execute arbitrary TypeScript normalization logic.

Choose a safe migration strategy.

Do NOT write a fake SQL normalizer that pretends to understand international phone formats.

If robust normalization requires application code, implement a safe explicit backfill strategy appropriate to this repository.

Document exactly how it works.

The migration and backfill must be repeatable/safe enough for development and deployment.

==================================================
10. EXISTING DATA / COLLISION AUDIT
==================================================

Before enforcing assumptions, inspect existing development data safely.

Determine:

- how many Customers have phone numbers;
- how many normalize successfully;
- how many fail normalization;
- whether canonical duplicates exist inside the same business;
- whether the same canonical number appears across different tenants/businesses.

Do NOT expose full phone numbers in the Final Report.

Use counts and masked examples only if examples are necessary.

Do NOT modify real customer records outside the intended migration/backfill.

==================================================
11. PHONE MASKING
==================================================

Add a shared helper for safe logging/debug output.

Example concept:

    +77011234567
    →
    +7******4567

Exact format may follow repository conventions.

Requirements:

- useful enough for debugging;
- never exposes the full number;
- handles short/invalid input safely;
- unit tested.

Audit new code added in this prompt and ensure full phone numbers are not unnecessarily written to logs.

Do NOT attempt a repository-wide logging rewrite outside scope.

==================================================
12. BUSINESS PHONE / FUTURE TELEPHONY READINESS
==================================================

MCR-1 is primarily about CUSTOMER phone identity.

However, inspect how the business's own phone number is currently stored.

The future MCR-2 flow will need:

    called business number
    →
    tenant/business

Do NOT implement telephony routing now.

But document whether the existing Business phone field is sufficient for future canonical routing or whether MCR-2 will need a normalized business-number representation / dedicated business-number entity.

Do not add speculative telephony models in MCR-1.

==================================================
13. SECURITY / PRIVACY
==================================================

Treat phone numbers as PII.

Verify:

- all lookups are tenant/business scoped;
- no endpoint allows cross-tenant discovery by phone;
- errors do not expose another tenant's customer;
- logs added in this prompt use masking;
- API responses remain consistent with existing authorization rules.

Add or update tenant isolation tests where appropriate.

==================================================
14. TESTS
==================================================

Add focused tests for at least:

A. Normalization
- KZ +7 format
- KZ 8-prefix format
- KZ local/national format with KZ default
- RU examples with RU default
- already-canonical international number
- non-+7 international number
- invalid string
- empty/null behavior

B. Customer resolution
- one match
- zero matches
- ambiguous matches
- same phone in another tenant does not match
- invalid incoming phone does not match

C. Customer lifecycle
- create computes normalized phone
- update recomputes normalized phone
- clearing phone clears normalized phone
- duplicate protection uses canonical form

D. Conversation intake
- formatted variants of the same phone resolve consistently
- existing Prompt 54 behavior remains correct

E. Masking
- canonical phone
- short/invalid input
- no full phone leak

F. Migration/backfill behavior
Test where practical without creating brittle migration tests.

==================================================
15. VALIDATION
==================================================

Run the repository's normal validation appropriate for a schema/backend change.

At minimum:

- Prisma format/validate
- migration status / migration verification
- TypeScript typecheck
- relevant focused tests
- full test suite
- production build

If the repository has additional standard checks, run them.

If a failure is caused by your changes, fix it.

Do not suppress failures.

If a failure is clearly unrelated and pre-existing, document evidence.

==================================================
16. DATABASE / SUPABASE
==================================================

This project uses Supabase PostgreSQL + Prisma.

Follow the repository's established migration procedure.

If the development Supabase database is available through the existing configured environment and applying the migration is part of the established workflow, apply and verify it safely.

Do NOT:

- reset the database;
- delete real data;
- run destructive cleanup;
- change Supabase Auth;
- expose secrets;
- alter unrelated tables.

After migration/backfill, verify the intended columns/indexes/data state.

Report counts only; do not dump customer PII.

==================================================
17. NO UI REDESIGN
==================================================

This is infrastructure.

Do not redesign:

- Customers
- Conversations
- Dashboard
- Operations
- Settings
- login
- launch screen

If a tiny UI adjustment is strictly necessary because a new Business default-region field must be configurable, keep it minimal and within existing Settings patterns.

Do not create a new settings architecture.

==================================================
18. DOCUMENTATION
==================================================

Follow the repository's existing documentation conventions.

Create/update:

- docs/prompts/... for MCR-1
- docs/final-reports/... for MCR-1
- relevant architecture/product docs only where the implementation materially changes documented behavior

The Final Report must clearly state:

1. baseline;
2. schema changes;
3. normalization library/approach;
4. exact normalization contract;
5. default-region behavior;
6. Customer storage behavior;
7. lookup behavior;
8. duplicate behavior;
9. migration/backfill result;
10. collision audit counts;
11. masking behavior;
12. tenant-isolation verification;
13. business-phone readiness for MCR-2;
14. tests;
15. build/typecheck/Prisma result;
16. database migration result;
17. files changed;
18. known limitations;
19. git result.

Do not claim that telephony or WhatsApp is implemented.

==================================================
19. GIT — COMPLETE THE WORKFLOW YOURSELF
==================================================

The user must NOT need to run Git or PowerShell commands manually.

You are responsible for the complete Git workflow.

After implementation and validation:

1. inspect `git status`;
2. inspect the final diff;
3. ensure no unrelated files were changed;
4. ensure secrets/env files are not committed;
5. commit all intended MCR-1 changes;
6. use a clear commit message, for example:

   feat: add canonical phone identity foundation

7. push to:

   origin/master

8. DO NOT force-push;
9. verify local `master` and `origin/master` point to the same commit;
10. verify working tree is clean.

If there are legitimate generated migration files, include them.

Do not commit unrelated local artifacts.

==================================================
20. STOP CONDITION
==================================================

STOP when MCR-1 is fully complete:

- canonical phone normalization exists;
- Customer canonical phone identity exists;
- required default-region behavior exists;
- indexed tenant-scoped lookup exists;
- old last-digit heuristic is removed from identity resolution where superseded;
- duplicate handling uses canonical identity;
- backfill/migration is complete and verified;
- masking helper exists;
- tenant isolation is verified;
- tests pass;
- build/typecheck/Prisma checks pass;
- documentation is complete;
- intended changes are committed;
- commit is pushed to origin/master;
- local and remote are synchronized;
- working tree is clean.

DO NOT proceed to:

- MCR-2
- CallInteraction
- telephony webhook
- WhatsApp
- SMS
- recovery orchestration
- automatic AI replies

Return the complete MCR-1 Final Report and STOP.
