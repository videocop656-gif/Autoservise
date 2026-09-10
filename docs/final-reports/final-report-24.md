# Final Report 24 — Customer Requests v1

## 1. Summary

Customer Requests was rebuilt from a flat CRUD list into a real operational
screen at the new canonical route `/requests`: a searchable/filterable/
paginated list, and a full Request Detail view (status, customer, vehicle,
service, linked conversation, derived escalation, status history, edit) —
all on the existing, unmodified backend.

## 2. Audit Findings

The real `CustomerRequest` Prisma model (unchanged):

- **Fields**: `id, tenantId, businessId, customerId, vehicleId?, serviceId?,
  appointmentId?, source, status, subject, description?, requestedDate?,
  requestedTimeFrom?, requestedTimeTo?, notes?, createdAt, updatedAt`
- **Relations**: `customer` (Customer, restrict), `vehicle?` (Vehicle,
  restrict), `service?` (Service, restrict), `appointment?` (Appointment,
  restrict), `statusHistory[]` (CustomerRequestStatusHistory), and a
  reverse `conversations[]` (Conversation.customerRequestId) — this last
  one is the real link used for the Conversation context block.
- **`CustomerRequestStatus` enum** (real, confirmed in
  `prisma/schema.prisma`): `NEW, IN_PROGRESS, WAITING_CUSTOMER, QUALIFIED,
  CONVERTED, CLOSED, CANCELLED` — **not** the placeholder set
  (`NEW/IN_PROGRESS/WAITING/CONFIRMED/COMPLETED/CANCELLED`) suggested as
  an example in the prompt itself; the real enum was used throughout.
- **`CustomerRequestSource` enum**: `PHONE, WEBSITE, MANUAL, OTHER`.
- **API operations**: `GET/POST /api/customer-requests` (list/create,
  `page/pageSize/status/source/customerId/vehicleId/serviceId/
  appointmentId/search` filters), `GET/PATCH /api/customer-requests/:id`
  (detail with `statusHistory`/update). **No DELETE** — confirmed by
  reading `api/customer-requests/[id].ts`'s own comment: a request's
  lifecycle is status-only (`PATCH {status: "CLOSED"/"CANCELLED"}`), by
  design, not an oversight. None was added.

## 3. Files Changed

- `src/components/requests/shared.ts` (new)
- `src/components/requests/RequestDetailPanel.tsx` (new)
- `src/pages/settings/CustomerRequestsSettingsPage.tsx` (rewritten)
- `src/App.tsx` (new `/requests` route + updated legacy redirect)
- `src/components/layout/navigation.ts` (new "Заявки" nav item + page title)
- `src/pages/SettingsHubPage.tsx` (removed the now-redundant
  `/settings/customer-requests` card)
- `src/pages/settings/CustomersSettingsPage.tsx` (small addition:
  `?open=<id>` handler, needed for the Request Detail's Customer context
  to navigate into the existing Client Detail flow)

## 4. Existing Architecture Reused

- `GET/POST/PATCH /api/customer-requests[/:id]` (unchanged since Prompt 07)
- `GET /api/conversations` (`customerRequestId` filter — the real relation,
  confirmed via `conversationRepository.ts`'s `ListOptions`)
- `GET /api/escalations` (`conversationId` filter)
- `GET /api/customers`, `/api/vehicles`, `/api/services`, `/api/appointments`
  (all pre-existing reference-data endpoints, already used by the original
  page for its create/edit dropdowns)
- `PageContainer`, `PageHeader`, `Card`, `Button`, `Badge`, `Input`,
  `Label`, `Textarea`, `Pagination`, `zonedTimeToUtc`/`utcToZonedParts`
  (business-timezone helpers) — all pre-existing
- The exact full-screen-detail-swap pattern from Conversation Detail
  (Prompt 22) / Client Detail (Prompt 23), and the `?open=` cross-navigation
  mechanism from Prompt 23 — both reused, not reinvented

## 5. Request List

- **Search**: real server-side (`GET /api/customer-requests?search=`,
  matches subject/description per the existing endpoint), now debounced
  300ms (the original page fired on every keystroke).
- **Filters**: real `status` (7 real enum values) and `source` (4 real
  enum values) filters — both pre-existing, preserved.
- **Pagination**: existing page/pageSize contract, unchanged.
- **Rows**: subject, customer name, vehicle, service, real status badge,
  real `createdAt` (labeled "Создано", never renamed to imply a different
  meaning) — click opens Detail.

## 6. Request Detail

- **Request information**: subject, description, real status (with an
  instant quick-change `<select>` via the existing `PATCH`), real
  `createdAt`, real source.
- **Customer**: name/phone/email; click navigates to `/clients?open=<id>`
  (existing Client Detail flow).
- **Vehicle**: make/model/year/plate/VIN when present; "Автомобиль не
  указан" otherwise. No vehicle-detail route exists (confirmed during
  Prompt 23's own audit), so no further click-through — display only.
- **Service**: name when present; "Услуга не указана" otherwise. No
  service-detail route exists either — display only.
- **Conversation**: `GET /api/conversations?customerRequestId=`, the real
  relation; click navigates to `/conversations?open=<id>` (existing
  Conversation Detail flow); "Обращений нет" when none exist.
- **Escalation**: derived — looked up only for the request's most recent
  linked conversation (no direct CustomerRequest→AiEscalation relation
  exists); shown as an attention badge in the header plus reason/summary
  when active; the section is absent entirely when no conversation link
  exists at all (per spec §20 — never a fabricated block).
- **Status history**: the existing `statusHistory` array from the
  single-GET response, shown verbatim.
- **Actions**: Edit — opens the full existing create/edit form (customer/
  vehicle/service/appointment cascading selects, timezone-aware
  requestedDate/time, source, status, notes), ported unchanged from the
  original page, still calling the same `PATCH` endpoint.

## 7. Create/Edit

Both implemented, both reusing the exact existing endpoints
(`POST`/`PATCH /api/customer-requests[/:id]`) and exact existing field
set — no new fields, no fake priority/estimate/AI score. Create lives on
the list (`+ Новая заявка`); Edit lives in Detail — the same split already
used for Conversations/Clients.

## 8. Cross-Navigation

- `Request → Client`: `/clients?open=<customerId>` ✅ (implemented this prompt)
- `Request → Conversation`: `/conversations?open=<conversationId>` ✅ (reused from Prompt 23)
- `Client → Request`, `Conversation → Request`: **not implemented** —
  neither Client Detail nor Conversation Detail currently link back to a
  CustomerRequest; adding that was out of file-scope for this prompt
  (§44 restricts changes to Requests-related files plus the one
  necessary `?open=` addition already made to Clients). Flagged as a
  natural follow-up, not done silently.
- `Request → Vehicle`, `Request → Service`: **not implemented** — no
  vehicle/service detail screens exist in the app at all yet.

## 9. Data Sources

See §4. Every field traces to a real, already-existing endpoint.

## 10. N+1 Review

- **List**: one request per page load (`GET /api/customer-requests`) plus
  the existing bulk reference-data fetch (`Promise.all` of customers/
  vehicles/services/appointments, each already used for name resolution
  in the list rows and the create form) — unchanged from the original
  page's own pattern, not per-row.
- **Detail**: two requests run in parallel via `Promise.allSettled`
  (`GET /api/customer-requests/:id`, `GET /api/conversations?customerRequestId=`),
  plus one *conditional* follow-up (`GET /api/escalations?conversationId=`)
  fired only if a linked conversation was found — a genuine two-step
  dependency (the conversation id isn't known until the first call
  resolves), not a per-row or per-list-item cascade. Customer/vehicle/
  service context costs zero extra requests — resolved from the
  reference lists already loaded by the parent list page. Total: 2–3
  requests for one opened request, never inside `.map()`.

## 11. Backend Changes

```text
No backend changes.
```

Confirmed via `git diff --stat -- src/server prisma api` (empty).

## 12. Database

```text
No Prisma schema changes.
No migrations.
```

## 13. AI Isolation

```text
No AI behavior changes.
```

The escalation lookup is read-only display of existing data; nothing
here creates, claims, resolves, or otherwise touches an escalation or
any AI analysis.

## 14. Validation

- TypeScript (`tsc --noEmit`): **PASS**
- Production build (`npm run build`): **PASS**
- Existing test suite: **1221/1221 passed** (60 files), unchanged

## 15. Git

- Commit hash: `d65e1c5`
- Commit message: `feat: build customer requests v1`
- Push status: pushed to `origin/master` successfully (no force)
- Working tree: clean after commit and push

## 16. Limitations / Technical Debt

- **API limitation**: `GET /api/customer-requests` has no bulk
  "conversation count" or aggregate endpoint — not needed here since
  Detail resolves conversations via the precise `customerRequestId`
  relation per opened request, not a list-wide count.
- **Missing relations**: no direct CustomerRequest→AiEscalation relation
  exists; the Escalation section is a best-effort derivation through the
  request's own linked conversation, and is honestly absent when no
  conversation link exists — not a guess.
- **Missing routes**: no per-vehicle or per-service detail screen exists
  anywhere in the app yet, so Vehicle/Service context in Request Detail
  is display-only (same limitation already documented in Prompt 23 for
  Client Detail).
- **Cross-navigation is one-directional** for now: Request links out to
  Client and Conversation, but neither of those screens links back to
  the originating Request — adding that was out of this prompt's file
  scope (§44) and is flagged as a natural next step, not silently skipped.
- No live browser screenshot validation was performed for this prompt
  (visual verification deferred, consistent with Prompts 19–23).
