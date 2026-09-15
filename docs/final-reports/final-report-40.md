## Final Report — Prompt 40: Dashboard Operational Truth Audit

### 1. Audit Result

**Outcome C — real data/logic gap** (one confirmed, fixed), plus an **Outcome B — small UX gap** (fixed), plus one item investigated and confirmed as **not a gap** (Outcome A for that specific comparison).

### 2. Dashboard Inventory

Every KPI/card/list on `/dashboard`, traced to its actual source by reading `DashboardPage.tsx`, `api/dashboard.ts`, `analyticsService.ts`, and `analyticsRepository.ts`:

| Block | Source | Date field | Status semantics | Timezone | Tenant scope |
|---|---|---|---|---|---|
| Новые обращения (KPI) | `GET /api/dashboard` → `conversations.total` | `createdAt` | none (all channels/statuses) | Business (via `computePeriodBounds`) | `withTenant` |
| Обработано AI (KPI) | `GET /api/dashboard` → `ai.totalAnalyses`/`successRate` | `createdAt` (AiLog) | `AI_ANALYZE` operation only | Business | `withTenant` |
| Записи (KPI) | `GET /api/dashboard` → `appointments.total` | **`startAt`** (fixed this prompt — was `createdAt`) | all 6 statuses, broken down | Business | `withTenant` |
| Требует внимания (KPI) | `GET /api/escalations?status=OPEN`/`IN_PROGRESS` (direct, bypasses `/api/dashboard` entirely) | n/a — current snapshot | `OPEN`+`IN_PROGRESS` only | n/a (no date filter) | server-side auth-scoped |
| Последние обращения (list) | `GET /api/conversations?pageSize=5` | default sort `lastMessageAt` desc | all statuses | n/a | server-side |
| Ближайшие записи (list) | `GET /api/appointments?dateFrom=now&pageSize=5` | `startAt`, default sort asc | all non-cancelled-by-default statuses (existing endpoint default) | n/a | server-side |
| Требует внимания (list) | same two `/api/escalations` calls, merged client-side | `createdAt` for sort only | `OPEN`+`IN_PROGRESS` | n/a | server-side |
| AI-администратор status | derived from `GET /api/channels` + the KPI's own `ai.totalAnalyses` | n/a | any `ACTIVE` channel connection | n/a | server-side |
| Быстрые действия | pure navigation shortcuts, no data | n/a | n/a | n/a | n/a |

Period selector (`Сегодня`/`7 дней`/`30 дней`/`90 дней`) drives only the `/api/dashboard` KPIs (Новые обращения/Обработано AI/Записи) — confirmed deliberate: "Требует внимания" and both list blocks are explicitly documented (in `DashboardPage.tsx`'s own module comment) as current-state/recent/upcoming views that intentionally ignore the period. The period is not persisted in the URL — an existing, pre-Prompt-40 limitation shared with every other detail-open/filter state in this app (documented since Prompt 30), not something newly introduced or newly in scope here.

### 3. Findings

1. **Real gap (Outcome C)**: `appointmentsByStatus`/`appointmentsByDay` (`analyticsRepository.ts`) filtered by `createdAt` (when the appointment was booked), while every other appointment-facing screen in this app — `AppointmentsSettingsPage`'s date presets, Prompt 35's own `appointmentDateRangeBounds()`, and Operations' "Сегодняшние записи" (Prompt 36) — defines "which appointments belong to period X" by `startAt` (when the appointment happens). This was the one function in `analyticsRepository.ts` with no doc comment explaining its date-field choice, unlike every sibling query (e.g. `serviceRecordCount`'s explicit "count of ServiceRecords CREATED in the period" comment, `customerRequestConversion`'s explicit cohort-rate rationale) — a real, accidental inconsistency, not a documented, deliberate one. Concretely: an appointment booked today for next month would inflate today's Dashboard "Записи" KPI while never appearing in `/appointments?range=today` or Operations' "Сегодняшние записи"; the reverse mismatch also holds.
2. **Small UX gap (Outcome B)**: none of the three Dashboard list sections had their individual rows wired to open anything — only each section's own "Все обращения"/"Все записи"/"Все эскалации" link worked. The rows already carried `hover:bg-muted` styling implying they were meant to be clickable. The local `EscalationDto` type on this page also didn't declare `conversationId`, even though `GET /api/escalations` always returns it — the same "narrow local type omitting an already-returned field" pattern found and fixed in Prompts 38/39.
3. **Investigated, confirmed not a gap**: Dashboard's "Требует внимания" KPI counts only `OPEN`+`IN_PROGRESS` escalations, while Operations' own "Требует внимания" section (Prompt 25) additionally merges in `NEW` customer requests under the same Russian label. Not fixed: Dashboard's card links specifically to `/escalations`, not `/operations` — "escalations needing attention" is its own coherent, correctly-scoped definition, and Operations' broader merged concept is a deliberately different, already-documented design (Prompt 25's own Final Report). Two screens using the same natural label for two legitimately different, individually-correct scopes is not the "double-counting" or "undercounting" failure mode spec §7 warns about — no request/escalation is silently dropped or duplicated within either screen's own definition. Left unchanged, documented here rather than forced into artificial sameness, per spec §8's own "the goal is semantic consistency, not identical numbers everywhere."

No other real gaps: the Request KPI (`customerRequests.total`, `createdAt`-scoped) has no equally strong, already-established alternate date field the way Appointment does (Requests has no date-range filter of its own to contradict), so its "created in period" semantics is internally consistent, not an outlier. The Revenue-adjacent field (`serviceHistory.revenueByCurrency`) is explicitly, deliberately scoped to non-archived `ServiceRecord.totalPrice` grouped by currency (never summed across currencies) and is not labeled "revenue" anywhere in the UI or schema (`serviceHistory.total`/`revenueByCurrency` — a service-value metric, correctly named as such) — no semantic overreach found there.

### 4. Implementation

- `src/server/repositories/analyticsRepository.ts` — added `startAtInRange()` (parallel to the existing `createdAtInRange()`), used only by `appointmentsByStatus` (Prisma `groupBy`) and `appointmentsByDay` (the raw day-bucketing SQL query, `"startAt"` instead of `"createdAt"` in both the `SELECT`'s timezone conversion and the `WHERE` clause). Every other repository function's `createdAt` scoping is untouched.
- `src/server/services/analyticsService.ts` — added a doc comment above the `appointments:` block in the response, explaining the `startAt` scoping and why it differs from the rest of the response. No logic change here — `computePeriodBounds`'s `range` object is unchanged and passed through as before; only which column the two appointment queries compare it against changed.
- `src/pages/DashboardPage.tsx` — widened the local `EscalationDto` to declare `conversationId: string`; wrapped each row in "Последние обращения", "Ближайшие записи", and "Требует внимания" in a `<Link>` to `/conversations?open=<id>`, `/appointments?open=<id>`, and `/conversations?open=<conversationId>` respectively — the exact existing cross-navigation convention used everywhere else in this app, reused verbatim.

Reused APIs/helpers: `GET /api/dashboard`, `GET /api/conversations`, `GET /api/appointments`, `GET /api/escalations` — all unchanged endpoints. No new endpoint, no new Prisma field, no schema migration, no new KPI, no new component.

### 5. Cross-Screen Consistency

- **Requests**: Dashboard's request-related count (`customerRequests.total`) is `createdAt`-scoped; `/requests` has no date-range filter of its own to compare against, so no contradiction exists (unlike Appointments). Consistent.
- **Appointments**: now consistent — Dashboard's "Записи" KPI and `/appointments`' own date presets (Prompt 35) both define "belongs to period X" by `startAt`.
- **Operations**: "Сегодняшние записи" (Prompt 36, `startAt`-scoped) and the Dashboard "Записи" KPI now agree on the date field, though they remain intentionally different views (Operations shows only today's active-status rows; Dashboard shows a period-wide status breakdown) — a difference in *scope*, not in *semantics*, which is the correct outcome per spec §8. The "Требует внимания" label/scope difference is documented above as investigated-and-not-a-gap.
- **Clients / Service History**: untouched by this prompt; Prompt 39's fixes remain intact and unrelated to Dashboard's own aggregate queries.

### 6. Security

No new query was introduced. `startAtInRange()` is folded into the exact same `withTenant(tenantId, { businessId, ... })` wrapper every other `analyticsRepository` function already uses — confirmed by reading the diff, tenant/business scoping is identical to before, just comparing a different column. The Dashboard's list-row navigation change is pure frontend routing (`<Link to=...>`) with no new query of any kind. `requireRole(ctx, 'owner', 'admin', 'manager')` in `getDashboard()` is unchanged.

### 7. Regression Check

- Prompt 33 (`serviceCompletionState()`): **intact** — not touched.
- Prompt 34 (Appointment creation): **intact** — not touched.
- Prompt 35 (Appointment date navigation): **intact** — `AppointmentsSettingsPage.tsx` not touched; its own `appointmentDateRangeBounds()` is reused as documentation reference only, not modified.
- Prompt 36 (Operations daily queue): **intact** — `OperationsPage.tsx` not touched.
- Prompt 37 (Request ↔ Appointment navigation): **intact** — not touched.
- Prompt 38 (ServiceRecord recommendations): **intact** — not touched.
- Prompt 39 (Client/Vehicle/Appointment service-history context): **intact** — not touched.

### 8. Validation

TypeScript: **PASS**
Build: **PASS**
Tests: **1260/1260** passed (actual result, run both before and after — unchanged count). No new tests were added: `tests/analyticsService.test.ts` mocks `analyticsRepository`'s functions entirely (confirmed by reading it), so the service-level aggregation logic those tests exercise is unaffected by a change scoped entirely to the repository's own `where`-clause construction; and this project has no repository-level test file for any entity (confirmed again, consistent with the same finding in Prompts 34/35/38/39) — introducing one just for this fix would be a new testing pattern, not a focused test for changed behavior. The Dashboard row-navigation fix is pure, framework-free JSX with no extractable pure logic, matching the same convention followed in Prompts 38/39.

Manual validation: performed against the running dev server via Playwright.
- `/dashboard` loads without errors (only the expected pre-login 401 on `/api/auth/me`, no other console/network errors).
- Switching to "Сегодня" correctly re-triggers the KPI fetch; "Записи" resolves to `0` — the actual, correct count for a tenant with zero appointments, now genuinely `startAt`-scoped rather than `createdAt`-scoped.
- "Последние обращения" correctly resolves to its true empty state ("Пока нет новых обращений") rather than a stuck skeleton or false error.
- Could not verify: a non-zero, populated Appointment/Conversation/Escalation KPI or list row (and therefore could not click through a populated row to confirm its `?open=` destination visually) — the seed/demo tenant used for this check has zero appointments, zero conversations, and zero escalations. The real appointment/service-history data referenced in this prompt's own Step 9 belongs to the user's "Torque" tenant, whose login this session does not hold (the same limitation reported in Prompts 37, 38, and 39). The navigation code itself was verified by direct source review — it reuses the identical `?open=<id>` pattern already exercised and working on every other screen in this app.

### 9. Git

Branch: `master`
Commit(s):
- `2589621` — `fix: scope Dashboard appointment KPI by startAt, wire up list-row navigation`
- (this Final Report + verbatim prompt, committed separately as docs, per this project's established convention)

Push: **nothing pushed** — per this prompt's explicit instruction.
Working tree: clean immediately before the docs commit; `.mcp.json` and `marketing/` remain untouched throughout.

STOP.
