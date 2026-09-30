# Prompt 49.1 — Protect Conversation → CustomerRequest Link Invariant

> Verbatim — reproduced exactly as provided in the development
> conversation for this project (not reconstructed, not paraphrased).

---

# PROMPT 49.1 — Protect Conversation → CustomerRequest Link Invariant

## CONTEXT

Prompt 49 is complete and visually validated.

Current expected state:

- branch: master
- HEAD: 082fcc2
- origin/master: 054398a
- master is exactly 1 commit ahead of origin/master
- tests: 1402/1402 PASS
- Prompt 49 is NOT pushed yet
- Supabase schema is up to date
- no Prompt 50 work has started

Prompt 49 implemented the operational bridge:

Conversation → CustomerRequest

The existing schema already contains:

Conversation.customerRequestId

Prompt 49 added the safe/idempotent bridge endpoint and guarantees:

- one primary CustomerRequest per Conversation;
- repeated calls return the same request;
- concurrent calls create exactly one request;
- tenant isolation;
- transactional linkage.

Visual validation is accepted.

One remaining integrity gap was identified in the Prompt 49 Final Report:

the older generic Conversation PATCH path can still modify/reassign `customerRequestId` directly.

That can bypass the new bridge invariant.

Prompt 49.1 closes ONLY this gap.

DO NOT redesign UI.
DO NOT add product functionality.
DO NOT start Prompt 50.
DO NOT push.

---

## 1. GOAL

Make the Conversation → CustomerRequest relationship writable only through the safe Prompt 49 bridge workflow.

The generic Conversation PATCH endpoint must NOT be able to:

- attach a CustomerRequest;
- replace customerRequestId;
- unlink customerRequestId;
- reassign the Conversation to another CustomerRequest.

Existing legitimate Conversation PATCH behavior must continue working.

Examples may include existing status or other editable Conversation fields.

Do not break those.

---

## 2. AUDIT FIRST

Before changing code inspect:

- Conversation PATCH route;
- its request validation schema;
- Conversation service;
- Conversation repository;
- Conversation DTOs/types;
- Prompt 49 bridge service/route;
- all call sites that update Conversation;
- tests for Conversation PATCH;
- tests added in Prompt 49.

Determine exactly how `customerRequestId` can currently enter the generic PATCH path.

Also search the repository for all writes to:

customerRequestId

Classify each write as:

A. legitimate Prompt 49 bridge/internal write;

B. generic/user-controlled write;

C. test/setup write;

D. other internal lifecycle write.

Do not remove legitimate internal writes.

---

## 3. GIT BASELINE

Run:

git status
git log --oneline -n 10

Expected:

HEAD = 082fcc2

origin/master = 054398a

working tree clean

master exactly 1 commit ahead of origin/master

If materially different:

STOP and report.

---

## 4. DESIRED INVARIANT

After Prompt 49.1:

`customerRequestId` must NOT be mutable through the public/general Conversation PATCH API.

The only production workflow allowed to establish the relationship is the safe Conversation → CustomerRequest bridge from Prompt 49.

Once linked:

generic Conversation PATCH must not replace or clear that relationship.

The Prompt 49 bridge must continue to work unchanged.

---

## 5. PREFERRED IMPLEMENTATION

Prefer preventing `customerRequestId` from entering the generic PATCH update at the validation/service boundary.

Do not rely only on the frontend hiding a field.

The server must enforce the invariant.

Preferred outcome:

the public PATCH schema simply does not accept `customerRequestId`.

If the existing API convention rejects unknown/protected fields:

return the normal validation error.

If the current validation layer strips unknown fields silently, determine whether silently ignoring `customerRequestId` would be dangerous.

Prefer explicit rejection for attempts to mutate protected relationship fields if this fits the existing API conventions.

Do not expose internal implementation details.

User-facing error should be Russian if surfaced to an operator.

---

## 6. INTERNAL WRITE PATH

The Prompt 49 bridge still needs to write the relationship internally.

Do NOT break it.

If the current repository method is too broad, introduce the smallest internal method necessary, for example conceptually:

linkCustomerRequest(...)

rather than allowing arbitrary public update payloads to carry `customerRequestId`.

Use the existing architecture and naming conventions.

Do not create a new abstraction layer.

---

## 7. DO NOT OVERCORRECT

Do NOT make `customerRequestId` immutable at a database level if doing so would prevent the legitimate Prompt 49 bridge from setting it.

Do NOT add triggers.

Do NOT add another model.

Do NOT create another relation.

Do NOT create a Prisma migration unless the audit unexpectedly proves one is necessary.

Expected result:

NO schema change
NO migration

---

## 8. TENANT ISOLATION

Preserve all existing Prompt 49 tenant protections.

The hardening must not create any new way to:

- probe another tenant's request IDs;
- link foreign requests;
- reveal whether a foreign CustomerRequest exists.

Use existing 404/error conventions.

---

## 9. TESTS

Baseline expected:

1402 tests.

Add focused regression tests.

At minimum verify:

1. generic Conversation PATCH cannot attach `customerRequestId`;

2. generic Conversation PATCH cannot replace an existing `customerRequestId`;

3. generic Conversation PATCH cannot clear an existing `customerRequestId`;

4. normal allowed Conversation PATCH fields still work;

5. Prompt 49 bridge still creates and links the request;

6. repeated bridge call still returns the same request;

7. tenant isolation remains intact;

8. protected-field attempts do not mutate the database.

If relevant, include a test that sends:

customerRequestId: null

and another that sends a different request ID.

Do not weaken Prompt 49 concurrency tests.

Run full suite:

npm run typecheck
npm run build
npm test

Report actual final count.

---

## 10. SUPABASE VALIDATION

Use the existing Supabase environment.

Do not alter real user data.

Use existing Prompt 49 test data where practical.

Verify:

A. generic PATCH attempt cannot change linked request;

B. generic PATCH attempt cannot unlink request;

C. ordinary allowed Conversation PATCH still works;

D. Prompt 49 bridge still works/idempotently returns the existing request.

No new tenant is needed unless technically necessary.

---

## 11. BROWSER REGRESSION

This is primarily backend hardening, so do not perform a large UI project.

Quickly verify:

1. open a Prompt 49 conversation;
2. linked request still displays;
3. “Открыть обращение” still works;
4. normal Conversation action such as existing status handling still works;
5. no new browser-console errors.

No redesign.

---

## 12. STRICTLY OUT OF SCOPE

Do NOT change:

- Conversation → CustomerRequest UI;
- CustomerRequest UI;
- Appointment lifecycle;
- ServiceRecord;
- ServiceFollowUp;
- retention;
- Dashboard;
- launch screen;
- localization generally;
- DATABASE_URL;
- DIRECT_URL;
- Supabase region;
- Prisma schema unless absolutely unavoidable;
- CRM;
- CPBS;
- AI behavior;
- Telegram delivery;
- WhatsApp;
- SMS;
- email;
- billing;
- capacity;
- technicians;
- inventory.

Do NOT start Prompt 50.

No new npm dependencies.

---

## 13. PRISMA / DATABASE SAFETY

Run:

npx prisma validate
npx prisma migrate status

Expected:

schema valid
database up to date

Do not run:

prisma migrate reset
db push --force-reset
DROP
TRUNCATE

Expected migration count change:

ZERO.

---

## 14. DOCUMENTATION

Create:

docs/prompts/prompt-49-1.md

docs/final-reports/final-report-49-1.md

Final Report must contain:

1. Initial state
2. Vulnerable write path found
3. Repository-wide `customerRequestId` write audit
4. Fix implemented
5. Public PATCH behavior after fix
6. Internal Prompt 49 bridge behavior
7. Tenant isolation
8. Tests before/after
9. Typecheck
10. Build
11. Prisma validation/migration status
12. Supabase validation
13. Browser regression
14. Files changed
15. Existing-data safety
16. Remaining limitations
17. Git state
18. Push status
19. LOCAL APP URL

---

## 15. GIT

Before commit inspect:

git status
git diff
git log --oneline -n 10

Create exactly ONE local commit:

fix: protect conversation request linkage

DO NOT PUSH.

Do not amend Prompt 49 commit.

Do not force push.

Do not touch main.

Expected history after completion:

054398a  ← origin/master
082fcc2  ← Prompt 49
NEW       ← Prompt 49.1 / HEAD

Therefore local master should be exactly 2 commits ahead of origin/master.

---

## 16. ACCEPTANCE CRITERIA

Prompt 49.1 is complete only if:

AC1. Generic Conversation PATCH cannot attach customerRequestId.

AC2. Generic Conversation PATCH cannot replace customerRequestId.

AC3. Generic Conversation PATCH cannot clear customerRequestId.

AC4. Enforcement is server-side.

AC5. Normal Conversation PATCH behavior remains functional.

AC6. Prompt 49 bridge still creates the relationship.

AC7. Prompt 49 idempotency remains intact.

AC8. Prompt 49 concurrency protection remains intact.

AC9. Tenant isolation remains intact.

AC10. Existing linked Conversations remain linked.

AC11. No schema change.

AC12. No new migration.

AC13. No database configuration changes.

AC14. Typecheck PASS.

AC15. Build PASS.

AC16. All tests PASS.

AC17. Prisma validate PASS.

AC18. Migration status clean.

AC19. Supabase validation PASS.

AC20. Browser regression PASS.

AC21. Exactly one new local Prompt 49.1 commit.

AC22. Nothing pushed.

---

## 17. STOP CONDITIONS

STOP and report before implementing if:

- `customerRequestId` is required by another legitimate public Conversation PATCH workflow;
- removing it from generic PATCH would break a documented existing product workflow;
- the bridge currently depends on the public PATCH endpoint itself;
- a schema migration appears necessary;
- git baseline differs materially from expected.

Do not improvise around an architecture conflict.

---

## 18. EXECUTION ORDER

1. Git baseline
2. Audit generic PATCH
3. Search all customerRequestId writes
4. Classify legitimate vs unsafe write paths
5. Implement smallest server-side protection
6. Preserve dedicated Prompt 49 bridge write
7. Add focused tests
8. Run Prisma validation/status
9. Typecheck
10. Build
11. Full tests
12. Supabase validation
13. Quick browser regression
14. Existing-data safety check
15. Documentation
16. Git review
17. One local commit
18. Final Report
19. STOP

Do NOT push.
Do NOT start Prompt 50.

At the end provide:

LOCAL APP URL: http://localhost:...

Then STOP.
