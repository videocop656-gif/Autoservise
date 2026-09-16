# Final Report — Prompt 44: Lead vs CustomerRequest Domain Consolidation

## 1. Decision

**Strategy A — Retire Lead.** **`CustomerRequest` is the sole canonical customer-intake entity** in this product going forward.

Reason, based on repository evidence (not naming alone): `Lead` and `CustomerRequest` represent the same business concept ("a customer expressed interest, before any confirmed booking exists"). `Lead` was the *original* architecture (Prompt 04); `CustomerRequest` (Prompt 07) was explicitly built to supersede it — its own introducing commit states it exists "so a future AI administrator will have a safe, well-defined business entity to work through." Every feature built afterward (Conversations, Operations, Dashboard/analytics, AI booking tools) was wired to `CustomerRequest`, never `Lead`. `Lead` held **zero rows** in the live database at the time of this audit, had no meaningful field or behavior absent from `CustomerRequest`, and was reachable only through an orphaned Settings page with no cross-links from any other screen. This is historical duplication, not two genuine business concepts — retiring the superseded one was the correct, conservative choice, not a preference for less code.

## 2. Evidence

- **Git history**: `Lead` was introduced in commit `c8a258a` ("add customers, vehicles, and leads foundation", Prompt 04). `CustomerRequest` was introduced three commits later in `ea4e69c` ("add customer request foundation", Prompt 07), whose commit message explicitly frames it as the entity a *future AI administrator* will use "instead of touching operational data directly" — the richer status lifecycle (`WAITING_CUSTOMER`, `QUALIFIED`, `CONVERTED` vs. Lead's `WON`/`LOST`) and the addition of a full `CustomerRequestStatusHistory` audit trail (which `Lead` never got) are the concrete signs of an intentional, purpose-built successor.
- **Schema**: `Lead` (`customerId` required; `vehicleId`/`serviceId` optional; `LeadStatus` NEW→IN_PROGRESS→QUALIFIED→WON|LOST; `LeadSource` MANUAL/WEBSITE/PHONE/OTHER) was a strict subset of `CustomerRequest`'s shape and richer lifecycle/audit trail. No other model held a foreign key *to* `Lead` — it was a pure leaf node, safe to remove without cascading schema effects.
- **API/services**: `api/leads/*`, `leadService.ts`, `leadRepository.ts`, `lead.schemas.ts` were a complete, independently-working CRUD surface — not scaffolding — but entirely disconnected from `customerRequestService.ts`, `conversationService.ts`, `escalationService.ts`, `analyticsService.ts`, and every AI tool (`aiTools.ts`). Nothing outside Lead's own files ever called into it.
- **Frontend**: `LeadsSettingsPage.tsx` was reachable only via the Settings hub's "CRM" group and the `/settings/leads` route — no other Client/Vehicle/Request/Appointment detail panel linked to it, unlike the `?open=<id>` cross-navigation convention used everywhere `CustomerRequest` appears.
- **Tests**: `tests/leadService.test.ts` (17 tests), `tests/lead.schemas.test.ts` (23 tests), and a dedicated `tenantIsolation.test.ts` describe block (2 tests) gave `Lead` full, independent test coverage — proof it was a maintained, working feature, not dead scaffolding, which is exactly why this consolidation required a careful audit rather than an assumption.
- **Documentation**: `docs/PRODUCT_BLUEPRINT.md` (Section 5, which the document's own header states "must match the current codebase exactly") listed `Lead` as implemented; report 26 called it "a separate, pre-conversion CRM concept not part of the Requests/Conversations/Clients/Operations trail"; report 32 listed it only as a `Service` consumer, never wiring it into any newer feature. No final report across Prompts 18–43 ever traced `Lead` into the Request→Appointment→ServiceRecord pipeline every later prompt centers on.
- **Live data**: a direct, read-only query against the real Supabase dev database (run before any change) confirmed **0 `Lead` rows**, across 2 tenants, with 2 real `CustomerRequest` rows.

## 3. Implementation

**Database / Prisma**:
- Removed the `Lead` model and the `LeadStatus`/`LeadSource` enums from `prisma/schema.prisma`, along with the `leads Lead[]` relation field on `Tenant`, `Business`, `Customer`, `Vehicle`, and `Service`.
- `npx prisma migrate dev --create-only` could not be used to generate the migration: replaying the full migration history against a fresh shadow database failed with `P3006`/`P1014` on an unrelated, pre-existing migration-ordering defect (`channel_operations_delivery_foundation`, timestamped *before* `channel_integration_foundation` even though it depends on a table the latter creates — a folder-timestamp mislabeling from Prompts 16/17, not something this prompt touched or needed to fix). Since renaming already-applied historical migrations is unsafe, I hand-wrote a new migration instead: `prisma/migrations/20260916120000_retire_lead_model/migration.sql` (drops the 5 FK constraints on `leads`, the `leads` table, and the `LeadStatus`/`LeadSource` enum types) and applied it with `npx prisma migrate deploy`, which applies pending migrations directly without a shadow database. Verified via a direct SQL query afterward: the `leads` table and both enum types no longer exist in the live database; `CustomerRequest`/`Customer`/`Tenant` row counts are unchanged.
- Ran `npx prisma generate` to regenerate the Prisma Client without the `Lead` delegate.

**Backend removed**: `api/leads/index.ts`, `api/leads/[id].ts`, `src/server/services/leadService.ts`, `src/server/repositories/leadRepository.ts`, `src/server/validation/lead.schemas.ts`, and the `LeadDto`/`toLeadDto`/`Lead` import from `src/server/lib/dto.ts`.

**Frontend removed**: `src/pages/settings/LeadsSettingsPage.tsx`; the `/settings/leads` route and its import in `src/App.tsx` (replaced with a redirect to `/requests`, matching this app's existing pattern for retired URLs); the `/settings/leads` entry in `src/components/layout/navigation.ts`; the "Лиды" card (and now-unused `UserPlus` icon import) in `src/pages/SettingsHubPage.tsx`.

**Comments updated** (no behavior change) in `vehicle.schemas.ts`, `serviceRecord.schemas.ts`, `customerRequest.schemas.ts`, `customerRequestRepository.ts`, `conversationService.ts`, `serviceRecordService.ts`, and `customerRequestService.ts` — each previously referenced `Lead` only as a design-precedent comment (e.g. "matching the project's existing convention — see leadService"); updated to reference `CustomerRequest`/`ServiceRecord`/`appointmentService` instead so no comment points at a file that no longer exists.

**Tests**: deleted `tests/leadService.test.ts` and `tests/lead.schemas.test.ts`; removed the `Lead`-specific mocks, import, and describe block from `tests/tenantIsolation.test.ts`; updated `tests/customerService.test.ts`'s "never touches Vehicle or Lead records" test to reference `CustomerRequest` instead (same assertion, updated subject). Added `tests/leadRetirement.test.ts` (4 new tests) asserting: the Prisma DMMF no longer lists a `Lead` model or `LeadStatus`/`LeadSource` enums; no Lead API/service/repository/schema/page file remains on disk; `/settings/leads` is a redirect, not a page route; and the Settings navigation no longer lists it.

**Documentation updated** (living reference sections only): `README.md`'s "Leads" section, API table, permission table, multi-tenancy bullets, optional-field-semantics section, and Security section — all now describe `CustomerRequest` where they previously described `Lead`; the "## Leads" heading itself was kept (with a "retired, see Customer Requests" notice) specifically so existing `#leads` anchor links elsewhere in the same document keep resolving. `docs/PRODUCT_BLUEPRINT.md` Section 5 (Domain Model, which the doc's own rule requires to "match the current codebase exactly") and Section 6 (CRM Structure diagram) were updated to drop `Lead`, with a new paragraph documenting the Prompt 44 removal. Per this prompt's own instruction, **historical documentation was deliberately left untouched**: `docs/DEVELOPMENT_ROADMAP.md` (frozen as of Prompt 19, an accurate historical record that Prompt 04 did build `Lead`) and every existing `docs/final-reports/*.md` file were not modified — the historical fact that `Lead` was built in Prompt 04 remains an accurate part of the record.

## 4. Data Safety

- **Lead records existed?** No. A direct, read-only query against the live Supabase dev database (2 tenants) before any change confirmed **0 rows** in the `leads` table.
- **Migration required?** Yes, a schema migration (drop table + 2 enums) — but no *data* migration, since there was no data to move or preserve.
- **Any data removed?** Only the empty `leads` table structure and its two now-unused enum types. Zero rows, in this table or any other, were deleted.
- **How was existing data preserved?** Verified directly (not assumed): after applying the migration, `CustomerRequest` count (2), `Customer` count (1), and `Tenant` count (2) were re-queried and found unchanged from before the change.

## 5. AI Readiness Impact

This directly closes the gap Prompt 43 flagged as a prerequisite for autonomous AI intake: there is now **exactly one** entity a future AI layer (or a human operator) could create/update when a customer expresses interest — `CustomerRequest`. Before this change, an AI intake path would have had two undocumented, functionally-overlapping tables to choose from with no rule governing which one to use; a mistaken or inconsistent choice there would have fragmented customer history across two disconnected pipelines. The existing AI booking tools (`aiTools.ts`), `aiService.ts`'s context builder, and `analyticsService.ts` already exclusively read/write `CustomerRequest`, so no AI-facing code needed to change — this consolidation removes a distractor, not a dependency. No AI or LLM functionality was implemented or modified in this prompt.

## 6. Regression

All confirmed via the full test suite (see Validation) plus targeted reading, not assumption:

- **Conversations**: `conversationService.test.ts` (22 tests) unchanged and passing; the one `Lead`-referencing comment in `conversationService.ts` was a doc-only precedent note, updated, no logic touched.
- **Requests**: `customerRequestService.test.ts` (54 tests) and `customerRequest.schemas.test.ts` (34 tests) pass unchanged — `CustomerRequest`'s lifecycle, fields, and validation are untouched code, only comments were edited.
- **Appointments**: `appointmentService.test.ts` (71 tests), `appointmentDateRange.test.ts`, `appointmentServiceCompletionState.test.ts` all pass unchanged — no Appointment code was touched.
- **Operations**: `operationsAppointmentQueue.test.ts` passes unchanged — Operations was always a frontend-only aggregation with no Lead dependency.
- **Service History**: `serviceRecordService.test.ts` (43 tests) and `serviceRecord.schemas.test.ts` pass unchanged — only a comment was edited.
- **Telegram**: `telegramAdapter.test.ts`, `telegramWebhook.test.ts`, `telegramSetupService.test.ts`, `telegramAiRegression.test.ts` all pass unchanged — zero relation to Lead.
- **AI booking tools**: `aiTools.test.ts` (36 tests), `aiToolSchemas.test.ts`, `aiService.test.ts` (44 tests), `mockAiProvider.test.ts` all pass unchanged.
- **Tenant isolation**: `tenantIsolation.test.ts` now has 122 tests (124 minus the 2 removed Lead-specific tests), all passing — every other domain's isolation tests are untouched and green.
- **Prompts 33–43**: the regression-pinning tests those prompts added (`serviceCompletionState()`, `ServiceRecord.recommendations` display, service-history attribution, Dashboard `startAt`-scoped KPI, CANCELLED/NO_SHOW ServiceRecord-linkage guard, Client Detail navigation fixes) are all still present and passing in the full suite; none of their files were modified.

## 7. Validation

- TypeScript: **PASS** (`npm run typecheck` — clean)
- Build: **PASS** (`npm run build` — `tsc --noEmit && vite build` succeeded, 1637 modules, bundle size unchanged/slightly smaller)
- Prisma: **PASS** — `npx prisma validate` succeeds; `npx prisma migrate status` reports "Database schema is up to date!"; a direct SQL query against the live database confirms the `leads` table and `LeadStatus`/`LeadSource` enum types no longer exist, and `CustomerRequest`/`Customer`/`Tenant` data is unchanged
- Tests: **PASS** — 62 test files, **1229/1229** tests passing (1267 previously, minus 40 deleted Lead-specific tests, minus 2 removed tenant-isolation Lead tests, plus 4 new retirement-regression tests: 1267 − 40 − 2 + 4 = 1229, confirmed exactly)

## 8. Git

- Branch: `master`
- Commit(s): this prompt's changes (schema, migration, backend/frontend/test removal and updates, documentation updates) plus `docs/prompts/prompt-44.md` and this report are committed together as a single commit following this project's established convention.
- Push status: **nothing pushed** — commit is local only, consistent with every prior prompt in this sequence.
- Working tree: clean immediately before this commit (confirmed via `git status`), with only the pre-existing, unrelated `.mcp.json` and `marketing/` untracked — both predate this work and were left untouched.

STOP.
