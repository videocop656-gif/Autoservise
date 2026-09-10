# Final Report 23 — Clients v1

## 1. Summary

`/clients` was rebuilt from a flat list-with-inline-edit-form into a real
operational screen: a searchable, paginated client list with real
vehicle/request counts and status, and a full Client Detail view (contact
info, vehicles, requests, conversations, service history, and quick
actions to create each) — all on the existing, unmodified backend.

## 2. Files Changed

- `src/components/clients/shared.ts` (new)
- `src/components/clients/ClientDetailPanel.tsx` (new)
- `src/pages/settings/CustomersSettingsPage.tsx` (rewritten)
- `src/pages/settings/ConversationsSettingsPage.tsx` (small addition: an
  `?open=<id>` query-param handler, needed so a conversation linked from
  Client Detail opens in the existing Conversation Detail flow)

## 3. Existing Architecture Reused

- `GET/POST/PATCH/DELETE /api/customers`, `GET /api/customers/:id?includeVehicles=true`
  (unchanged since Prompt 04/customerService.ts)
- `GET/POST /api/vehicles` (`customerId` filter, unchanged since Prompt 04)
- `GET/POST /api/customer-requests` (`customerId` filter, unchanged since Prompt 07)
- `GET /api/conversations` (`customerId` filter, unchanged since Prompt 08) +
  `POST /api/conversations`
- `GET /api/service-history` (`customerId` filter, unchanged since Prompt 06)
- `PageContainer`, `PageHeader`, `Card`, `Button`, `Badge`, `Input`,
  `Label`, `Textarea`, `Pagination` — all pre-existing, no new UI library
- The exact full-screen-detail-swap pattern established for Conversation
  Detail (Prompt 22) — reused for Client Detail rather than inventing a
  second pattern

## 4. Client List

- **Search**: real server-side (`GET /api/customers?search=`, matches
  first name/last name/phone/email — confirmed via
  `customerRepository.ts`'s `buildSearchOr`), debounced 300ms.
- **Pagination**: the existing page/pageSize contract, unchanged.
- **Filters**: the existing "Показать неактивных" (includeInactive)
  checkbox, preserved. No artificial filters added.
- **Columns/cards**: name, phone/email, real vehicle count, real request
  count (both computed client-side — see §8), and the real `isActive`
  field as an Active/Inactive badge — never a fabricated "Active" status.

## 5. Client Detail

- **Customer information**: name, phone, email, notes (shown only when
  present) — all real fields from `GET /api/customers/:id`.
- **Vehicles**: from the same single-GET call
  (`?includeVehicles=true`) — make/model/year/plate/VIN, only when
  present; "Автомобилей у клиента пока нет" when empty; a mini
  "Добавить" form (`POST /api/vehicles`, customerId pre-filled).
- **Requests**: `GET /api/customer-requests?customerId=`, subject + real
  status label; "Заявок пока нет" when empty; a mini "Новая" form
  (`POST /api/customer-requests`).
- **Conversations**: `GET /api/conversations?customerId=`, subject + last
  activity; clicking one navigates to `/conversations?open=<id>`, which
  opens the exact existing Conversation Detail (Prompt 22) — no new
  messaging UI; "Обращений пока нет" when empty; a mini "Новое" form
  (`POST /api/conversations`).
- **Service history**: `GET /api/service-history?customerId=`, date +
  work description; "История обслуживания пока отсутствует" when empty.
  (The API supports this cleanly via `customerId`, so the "insufficient
  API" fallback copy from the spec's §18 does not apply here.)
- **Actions**: Edit (existing `PATCH`), Deactivate/Reactivate (existing
  `DELETE` / `PATCH {isActive:true}` — the latter exercises an
  already-supported schema field the old UI never wired up, not a new
  backend capability).

## 6. Responsive

- **Desktop**: a 2-column grid (Vehicles/Requests/Conversations/Service
  history), header actions inline.
- **Tablet**: same grid narrows naturally via Tailwind's default `grid`
  behavior; falls back to single column below `lg`.
- **Mobile**: list rows stack vertically (name/phone above, counts+status
  below) below the `sm` breakpoint instead of squeezing a wide row; detail
  sections are a single column; no horizontal overflow anywhere.

## 7. Data Sources

See §3. Every field traces to a real, already-existing endpoint.

## 8. N+1 Review

- **List**: vehicle/request counts are computed from exactly two bulk
  requests (`GET /api/vehicles?pageSize=100&includeInactive=true`,
  `GET /api/customer-requests?pageSize=100`), fetched once per page load
  (not per row), then reduced into `Map<customerId, count>` client-side —
  the same reference-data-fetch-once pattern already used by the
  Dashboard and Conversations pages, not a new pattern.
- **Detail**: exactly four requests per opened client, run together via
  `Promise.allSettled` — `GET /api/customers/:id?includeVehicles=true`
  (which alone covers both customer AND vehicles), plus one
  customerId-scoped call each for requests, conversations, and service
  history. None are nested, none run inside `.map()`, and this is a
  detail view for exactly one record, not a list — a small fixed number
  of parallel requests here is not an N+1 pattern.

## 9. Backend Changes

```text
No backend changes.
```

Confirmed via `git diff --stat -- src/server prisma api` (empty).

## 10. Database

```text
No Prisma schema changes.
No migrations.
```

## 11. AI Isolation

```text
No AI behavior changes.
```

## 12. Validation

- TypeScript (`tsc --noEmit`): **PASS**
- Production build (`npm run build`): **PASS**
- Existing test suite: **1221/1221 passed** (60 files), unchanged

## 13. Git

- Commit hash: `2f87828`
- Commit message: `feat: build clients v1`
- Push status: pushed to `origin/master` successfully (no force)
- Working tree: clean after commit and push

## 14. Limitations / Technical Debt

- Vehicle/request **counts on the list** are capped at the backend's own
  `pageSize=100` maximum per reference fetch — a tenant with more than
  100 total vehicles or more than 100 total requests across all customers
  would see undercounted (never overcounted, never fake) numbers for
  whichever customers fall past that cap. Same accepted trade-off already
  documented in Prompts 20/21/22 for reference-data lookups.
  Counts inside an opened client's own **Detail** view are not affected —
  those come from customerId-scoped queries, not the capped bulk list.
- No existing per-vehicle or per-request detail route/screen was found
  during the audit, so vehicle cards and request rows are display-only
  (no click-through) — adding one was out of scope ("не создавай новый
  vehicle backend" / no objective architectural need existed for this
  prompt).
- The quick-action mini-forms are intentionally minimal (fewer fields
  than the full standalone forms on `/settings/vehicles` or
  `/settings/customer-requests`) — enough for the common "quickly log
  this from the client's page" case, not a replacement for those pages.
- No live browser screenshot validation was performed for this prompt
  (visual verification deferred, consistent with Prompts 19–22).
