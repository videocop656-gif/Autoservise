# Prompt 20 — Operational Dashboard v1

> Historical reconstruction based on the recorded implementation state.
> This file is not a verbatim transcript of the original ChatGPT prompt/report.

The original prompt was pasted in full in an earlier development session
whose exact text is not available in current working context. This
document reconstructs the task's actual scope from the recorded
implementation state and the real commit message of `e53d601`.

## Objective

Replace the Prompt 19 Dashboard placeholder at `/dashboard` with a real
operational panel, built strictly on already-existing backend APIs — an
absolute prohibition on fake or invented metrics, with no backend,
schema, migration, new endpoint, or new npm dependency involved.

## Required structure

Page Header → KPI row (4 cards) → Main Operations Area (Recent
Conversations / Upcoming Appointments) → Attention Area (Escalations /
AI status) → Quick Actions.

## KPI cards

- **Новые обращения**, **Обработано AI**, **Записи** — period-scoped
  (`today`/`7d`/`30d`/`90d`), sourced from the existing
  `GET /api/dashboard` aggregate.
- **Требует внимания** — explicitly a *current-state* question, not
  period-scoped; required to use the live `GET /api/escalations` list
  endpoint directly rather than the dashboard aggregate's own
  period-filtered escalation counts (which would undercount an
  older-but-still-open escalation).

## Main operations area

- Recent Conversations, sourced from the existing
  `GET /api/conversations` list (its own default "most recent first"
  sort reused as-is).
- Upcoming Appointments, sourced from the existing
  `GET /api/appointments?dateFrom=<now>` (its own default
  ascending-start-time sort reused as-is).
- Customer/vehicle/service names resolved via the same reference-data
  fetch-and-lookup pattern already used elsewhere in the app
  (`GET /api/customers`, `/api/vehicles`, `/api/services`, capped at the
  backend's own `pageSize=100` maximum).

## Attention area

- Escalations block, using the same live escalation endpoint as the KPI
  card above.
- AI-administrator status block, derived purely on the frontend from
  `GET /api/channels` (any `ACTIVE` connection?) plus the dashboard
  aggregate's own AI-analysis signal — no new backend logic.

## Constraints

- **No fake metrics anywhere** — every value is either real data
  (including a real `0`, never hidden) or an honest empty/loading state.
- No new backend endpoints "just for the dashboard."
- No new data-fetching library or architecture — reuse the existing
  plain `apiFetch`/`useState`/`useEffect` pattern used by every other
  page in the app.
- Per-block error isolation: one block's failure must not blank or break
  the rest of the page.
- Responsive: KPI row 1/2/4 columns at mobile/tablet/desktop; paired
  blocks stack to one column below the `lg` breakpoint.
- No changes to existing routes, the AppShell/Sidebar, or the
  `/ai-admin` → `/settings/ai` mapping established in Prompt 19 (declared
  fixed and explicitly out of scope for this prompt).

## Validation expected

TypeScript clean, production build clean, full existing backend test
suite passing unchanged, and confirmation that only the Dashboard page
file was touched.
