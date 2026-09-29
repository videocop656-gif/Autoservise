# Prompt 48.3 — Database Connection Performance Audit & Safe Configuration

> Verbatim — reproduced exactly as provided in the development
> conversation for this project (not reconstructed, not paraphrased).

---

# PROMPT 48.3 — Database Connection Performance Audit & Safe Configuration

## CONTEXT

Autoservise currently has these completed local commits:

- ff88d90 — Service Follow-up / Retention Loop
- b741d90 — Production Hardening
- b3bb42f — Retention UI / Russian Localization

Current regression state after Prompt 48.2:

- Typecheck PASS
- Build PASS
- Tests: 1368/1368 PASS
- Supabase migration applied
- Browser validation PASS
- Nothing pushed yet
- master is 3 commits ahead of origin/master

Known infrastructure issue:

The current DATABASE_URL uses the Supabase transaction pooler on port 6543.

Observed measurements during Prompt 48.1:

- DATABASE_URL / port 6543: approximately 1.1 s per DB query
- DIRECT_URL / port 5432: approximately 0.2 s per DB query
- some page requests take 5–6 seconds
- /operations can approach or exceed a 10-second timeout

Prompt 48.1 temporarily ran the dev server through the faster port-5432 connection using process configuration only.

.env was NOT changed.

This prompt is an infrastructure/configuration audit and safe performance fix.

Do NOT start Prompt 49.
Do NOT push.

---

## 1. PRIMARY GOAL

Determine the correct PostgreSQL / Supabase connection strategy for:

A. local development;

B. Prisma migrations;

C. future Vercel/serverless production.

Then make only the minimal safe configuration/code/documentation changes necessary to avoid the current severe database latency and connection-pool problems.

Do NOT blindly replace port 6543 with 5432.

First audit and measure.

---

## 2. READ SOURCE OF TRUTH

Inspect:

- package.json
- prisma/schema.prisma
- Prisma client initialization
- all database/client singleton code
- .env.example if present
- Vercel configuration if present
- API/serverless architecture
- README / deployment documentation
- relevant docs/prompts and final reports for Prompts 48–48.2

Inspect environment variable NAMES and connection topology.

Never print passwords, tokens or full connection strings.

Redact secrets in all reports.

---

## 3. GIT BASELINE

Run:

git status
git log --oneline -n 10

Expected HEAD:

b3bb42f

Expected working tree:

clean

Expected branch:

master

If this is materially different, report it before modifying anything.

---

## 4. DO NOT DAMAGE THE DATABASE

Supabase is now restored and contains existing data.

Absolutely forbidden:

prisma migrate reset
prisma db push --force-reset
DROP DATABASE
DROP SCHEMA
TRUNCATE

Do not delete tenants or production/user data.

Do not change Supabase region.

Do not create another Supabase project.

Do not recreate the database.

Do not apply a new Prisma migration unless schema changes unexpectedly become necessary.

This prompt should normally require NO Prisma migration.

---

## 5. AUDIT CURRENT CONNECTION ARCHITECTURE

Determine exactly:

1. what DATABASE_URL currently represents;
2. what DIRECT_URL currently represents;
3. whether DATABASE_URL is transaction pooler, session pooler or direct connection;
4. which hostname/port is used by each;
5. how Prisma uses them;
6. whether Prisma `directUrl` is configured;
7. whether local dev and runtime use the same connection strategy;
8. how many PrismaClient instances can exist during development;
9. how Vite/server/API hot reload affects PrismaClient;
10. how this architecture will behave when deployed to Vercel/serverless.

Do not expose credentials.

Report only sanitized topology, for example:

DATABASE_URL → Supabase transaction pooler :6543
DIRECT_URL → Supabase session/direct connection :5432

if that is what is actually found.

---

## 6. CHECK CURRENT SUPABASE RECOMMENDATIONS

Use the current Supabase connection information available from the project/configuration and the actual architecture.

Determine which Supabase connection mode is appropriate for:

- persistent/local development;
- Prisma migrations;
- serverless runtime.

Do not assume that the fastest local connection is automatically the correct production connection.

The final recommendation must distinguish:

LOCAL DEV
MIGRATIONS
VERCEL / SERVERLESS

---

## 7. PERFORMANCE BASELINE

Before changing configuration, measure the current connections.

Use safe read-only queries.

At minimum measure:

A. connection/query latency using current DATABASE_URL;

B. connection/query latency using current DIRECT_URL;

C. representative API latency for:
- dashboard or equivalent lightweight endpoint;
- operations;
- follow-ups if practical.

Run enough samples to avoid drawing conclusions from one request.

Report approximately:

median
min
max

Do not benchmark by mutating real user data.

---

## 8. CHECK CONNECTION POOL PARAMETERS

Inspect the current DATABASE_URL query parameters.

Determine whether configuration such as:

connection_limit
pool_timeout
pgbouncer-related parameters
prepared statement behavior

is appropriate for the installed Prisma version and Supabase connection mode.

Do not invent parameters.

Do not increase pool sizes blindly.

Explain in the report why any changed parameter is appropriate.

---

## 9. PRISMA CLIENT LIFECYCLE

Audit PrismaClient initialization.

For local development, ensure hot reload does not create unnecessary PrismaClient instances.

If an existing singleton/global caching pattern is already correct:

leave it alone.

If there is a real defect:

fix it minimally.

Do not introduce a new database abstraction layer.

---

## 10. LOCAL DEVELOPMENT STRATEGY

Choose and implement the safest performant local-development connection strategy based on the audit.

Goal:

local development should not take ~1 second for every trivial DB query.

Possible result may be use of a session/direct connection for local development, but only if supported by the actual Supabase topology and Prisma configuration.

Do not hardcode credentials.

Use environment variables.

If a new environment-variable convention is needed, document it in `.env.example` without secrets.

Do not overwrite the user's real `.env` unless absolutely necessary.

If `.env` must change to complete the local fix:

- create a backup first;
- change only connection topology/parameters;
- never print secrets;
- report exactly which variable NAME changed, not its secret value.

Prefer avoiding permanent `.env` mutation when a safer documented setup is possible.

---

## 11. MIGRATION STRATEGY

Ensure Prisma migrations use the appropriate non-transaction-pooler connection.

Verify:

npx prisma migrate status
npx prisma validate

Do NOT run a new migration merely for testing.

If `DIRECT_URL` is already the correct migration path, preserve it.

Document the expected migration connection mode.

---

## 12. VERCEL / SERVERLESS STRATEGY

Autoservise is intended to be Vercel-compatible/serverless.

Do not optimize only for the current Windows local machine.

Determine the correct production strategy for Vercel.

Consider:

- connection pooling;
- number of concurrent functions;
- Prisma connection behavior;
- Supabase transaction/session poolers;
- connection limits;
- cold starts;
- region latency.

Do not deploy to Vercel in this prompt.

Do not change Vercel project settings.

If production will require specific environment variables or connection mode, document them clearly.

---

## 13. REGION LATENCY

Supabase database is currently in:

ap-northeast-1 / Tokyo.

Do not move it.

Measure or reason separately about:

A. database connection/pool overhead;

B. geographical network latency.

Do not attribute all latency to geography without evidence.

The report should distinguish the two.

For future deployment, document that the application runtime should preferably be located geographically close to the database when platform configuration allows it.

Do not make deployment changes now.

---

## 14. IMPLEMENTATION RULE

Only implement changes that are supported by the audit.

Preferred outcome:

minimal configuration/lifecycle fix,
not architecture rewrite.

Do not touch:

- ServiceFollowUp logic;
- ServiceRecord logic;
- CustomerRequest lifecycle;
- Appointment lifecycle;
- retention UI;
- localization;
- launch screen;
- authentication;
- Prisma data model;
- migrations;
- CRM;
- CPBS;
- email;
- messaging;
- billing;
- capacity.

No new product functionality.

No new npm dependencies unless absolutely required.

The expected solution should not require a dependency.

---

## 15. POST-FIX PERFORMANCE TEST

After the safe local configuration/fix:

repeat the same benchmark.

Compare:

BEFORE
vs
AFTER

At minimum report representative latency for:

- simple DB query;
- Operations API/page;
- Follow-ups API if available.

Do not claim improvement without actual measurements.

---

## 16. OPERATIONS PAGE

Specifically verify `/operations`.

The known issue was that it could approach/exceed a 10-second timeout.

After the fix:

- page/API must load reliably;
- escalation list must load;
- follow-up queue must load;
- no timeout under normal test conditions;
- browser console must have no new errors.

If latency remains high, report where the time is spent rather than hiding it by simply increasing timeout values.

Do NOT solve the problem only by raising HTTP timeout.

---

## 17. REGRESSION

Run:

npm run typecheck
npm run build
npm test

Expected baseline before this prompt:

1368 tests.

All tests must pass.

Report actual final count.

Also run:

npx prisma validate
npx prisma migrate status

No schema divergence.

---

## 18. BROWSER VALIDATION

Run the application against the main Supabase using the selected local-development connection strategy.

Verify at minimum:

- Dashboard
- Рабочая очередь
- Повторный контакт
- Клиенты
- История обслуживания
- Услуги

Check:

- normal loading;
- no DB timeout;
- no new console errors;
- retention data still displays correctly.

Do not create new test tenants unless necessary.

Prefer existing Prompt 48.1 validation tenant.

---

## 19. CONFIGURATION SAFETY

Never commit real secrets.

Before commit inspect:

git diff
git status

Ensure none of the following is accidentally staged:

.env
database password
Supabase service-role key
access token
API key
full database connection URL containing credentials

If any secret appears in git diff:

STOP and remove it from the diff before committing.

---

## 20. DOCUMENTATION

Create:

docs/prompts/prompt-48-3.md

docs/final-reports/final-report-48-3.md

If useful, update `.env.example` and/or deployment documentation with sanitized examples.

Final Report must contain:

1. Initial state
2. Current connection topology
3. Root-cause analysis
4. Before benchmark
5. Local development recommendation
6. Migration connection recommendation
7. Vercel/serverless recommendation
8. Changes implemented
9. PrismaClient lifecycle audit
10. Pool configuration
11. Region-latency assessment
12. After benchmark
13. Operations validation
14. Browser validation
15. Typecheck
16. Build
17. Tests
18. Prisma validation/migration status
19. Files changed
20. Security/secrets check
21. Remaining limitations
22. Git status
23. Push status
24. LOCAL APP URL

---

## 21. GIT

After successful validation:

git status
git diff
git log --oneline -n 10

If code/config/docs changes were actually necessary, create ONE local commit:

fix: optimize database connection configuration

If the audit proves no repository change is appropriate and only external environment/deployment configuration is needed, do NOT create an empty commit.

In that case document the result and STOP.

DO NOT PUSH.

Do not modify:

- origin;
- GitHub default branch;
- remote branches;
- GitHub settings.

---

## 22. ACCEPTANCE CRITERIA

AC1. Current DATABASE_URL/DIRECT_URL topology is understood.

AC2. Local, migration and serverless strategies are distinguished.

AC3. No destructive database operation occurred.

AC4. No secrets are committed or printed.

AC5. Performance is measured before and after.

AC6. Local DB access no longer has the avoidable ~1 s/query overhead, if configuration is the cause.

AC7. /operations loads reliably without solving the issue merely by raising timeout.

AC8. PrismaClient lifecycle is verified.

AC9. Migration connection remains safe.

AC10. Vercel/serverless production strategy is documented.

AC11. Prisma schema unchanged unless an unexpected justified issue is found.

AC12. No new migration is created.

AC13. Retention behavior remains unchanged.

AC14. Typecheck PASS.

AC15. Build PASS.

AC16. All tests PASS.

AC17. Prisma validate PASS.

AC18. Migration status clean.

AC19. Browser validation against Supabase PASS.

AC20. Nothing pushed.

---

## 23. EXECUTION ORDER

1. Read source of truth
2. Git baseline
3. Audit connection topology
4. Audit PrismaClient lifecycle
5. Measure BEFORE
6. Analyze Supabase connection modes
7. Analyze pool parameters
8. Define separate local/migration/serverless strategy
9. Implement only justified minimal changes
10. Measure AFTER
11. Validate /operations
12. Prisma validate + migrate status
13. Typecheck
14. Build
15. Tests
16. Browser validation
17. Security/secrets audit
18. Documentation
19. Local commit only if repository changes exist
20. Final Report
21. STOP

Do NOT start Prompt 49.
Do NOT push.
