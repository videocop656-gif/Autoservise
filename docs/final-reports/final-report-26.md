# Final Report — Prompt 26: Vehicle Context v1

## 1. Audit Result

`Vehicle` (`prisma/schema.prisma`) is a real, fully-fledged domain model
with a complete existing CRUD API. It has direct relations to `Customer`
(owner), `CustomerRequest[]`, `ServiceRecord[]`, `Lead[]`, and
`Appointment[]` — but **no relation to `Conversation` at all**
(`Conversation` has no `vehicleId` field; it only relates to `Customer`
and `CustomerRequest`). Before this prompt, Vehicle appeared only as a
flat, unpromoted CRUD list at `/settings/vehicles`, and as a small,
non-clickable context card inside Client Detail (Prompt 23) and Request
Detail (Prompt 24) — both of those prompts' own Final Reports already
flagged "no vehicle-detail route exists" as a known limitation.

## 2. Vehicle Data Model

Real fields (`prisma/schema.prisma`, `model Vehicle`):

```
id, tenantId, businessId, customerId,
make, model, year?, licensePlate?, vin?, mileage?, notes?,
isActive, createdAt, updatedAt
```

No `status` field beyond `isActive` (boolean) exists. No health, score,
or diagnostic field of any kind exists.

## 3. Relations

```
Vehicle  →  Customer           many-to-one   (customerId FK, required)
Vehicle  →  CustomerRequest[]  one-to-many   (CustomerRequest.vehicleId FK, optional)
Vehicle  →  ServiceRecord[]    one-to-many   (ServiceRecord.vehicleId FK, required)
Vehicle  →  Lead[]             one-to-many   (out of this prompt's scope — Lead is a
                                              separate, pre-conversion CRM concept not
                                              part of the Requests/Conversations/Clients/
                                              Operations trail)
Vehicle  →  Appointment[]      one-to-many   (out of scope — spec STEP 17 explicitly
                                              forbids adding scheduling/appointments here)
Vehicle  →  Conversation       NONE          (no vehicleId field exists on Conversation
                                              at all; only reachable indirectly via
                                              Conversation.customerRequestId →
                                              CustomerRequest.vehicleId, a two-hop chain,
                                              not a real relation)
```

## 4. Existing API

- `GET /api/vehicles` — list, `page/pageSize/search/customerId/includeInactive` (unchanged)
- `POST /api/vehicles` — create (owner/admin only, unchanged)
- `GET /api/vehicles/:id` — single detail, bare vehicle, no embedded relations (unchanged)
- `PATCH /api/vehicles/:id` — update (owner/admin only, unchanged)
- `DELETE /api/vehicles/:id` — deactivate (owner/admin only, unchanged)
- `GET /api/customer-requests?vehicleId=` — real FK filter, confirmed in `customerRequestService.ts` (unchanged)
- `GET /api/service-history?vehicleId=` — real FK filter, confirmed in `serviceRecordService.ts` (unchanged); also supports `customerId`, `serviceId`, `dateFrom/dateTo`, `includeArchived`, and its own pagination
- `GET /api/customers` — reference data (unchanged)

**No Vehicle or ServiceHistory API was modified.**

## 5. Product Decision

**A. Separate Vehicle Detail justified.**

The data model supports a real, meaningful operational view — identity,
owner, current requests, and service history — that no existing screen
aggregated. Client Detail only ever showed a compact vehicle *card*, one
customer's worth at a time; Request Detail only ever showed the *one*
vehicle tied to that specific request. Neither let an administrator ask
"what has happened with this specific car, across every request and
every service visit?" — a real, recurring operational question for an
auto-service admin, answerable entirely from data that already exists.

## 6. Implementation

- Promoted `/settings/vehicles` (the existing flat CRUD page) to the
  canonical `/vehicles` route, with a legacy redirect and a new "Автомобили"
  sidebar item — the same pattern already used for Conversations/Clients/
  Requests.
- Added a real debounced (300ms) search box to the list, wired to the
  backend's pre-existing (but previously unused by this page's UI)
  make/model/plate/VIN search.
- Converted list rows to open a new `VehicleDetailPanel` (full-screen
  swap, same pattern as every other Detail screen in this app) instead of
  inline edit/deactivate buttons.
- `VehicleDetailPanel`: header + Owner (→ Client Detail) + Requests (→
  Request Detail) + a compact Service History slice with a link to the
  existing, untouched full history page. Edit/Deactivate/Reactivate reuse
  the exact existing endpoints.
- Made the previously-static vehicle cards in Client Detail, Request
  Detail, and Conversation Detail clickable, linking into the new
  `/vehicles?open=<id>`.

## 7. Files Changed

- `src/components/vehicles/shared.ts` (new)
- `src/components/vehicles/VehicleDetailPanel.tsx` (new)
- `src/pages/settings/VehiclesSettingsPage.tsx` (rewritten)
- `src/App.tsx` (+`/vehicles` route, redirect updated)
- `src/components/layout/navigation.ts` (+nav item, +page title, removed old `/settings/vehicles` title)
- `src/pages/SettingsHubPage.tsx` (removed the now-redundant vehicles card)
- `src/components/clients/ClientDetailPanel.tsx` (vehicle card → clickable)
- `src/components/requests/RequestDetailPanel.tsx` (vehicle card → clickable)
- `src/components/conversations/ConversationDetailPanel.tsx` (vehicle card → clickable)
- `src/components/conversations/shared.ts` (widened `CustomerRequestRefDto` with the already-real `createdAt` field, needed to show a request's date in Vehicle Detail's Requests list)

## 8. Backend

```text
backend changed: NO
Prisma changed: NO
migrations: NO
```

## 9. N+1 Audit

**List**: one `GET /api/vehicles` call per page load, plus the existing
bulk `GET /api/customers` reference fetch (used for name resolution) —
unchanged pattern, not per-row.

**Detail**: exactly 3 requests, run together via `Promise.allSettled`
(`GET /api/vehicles/:id`, `GET /api/customer-requests?vehicleId=`,
`GET /api/service-history?vehicleId=`) — never nested, never per-row.
Owner name resolution costs zero extra requests (reused from the parent
list page's already-loaded customers reference array).

## 10. Cross-navigation

| Link | Status |
|---|---|
| Client → Vehicle | ✅ implemented (this prompt) |
| Request → Vehicle | ✅ implemented (this prompt) |
| Conversation → Vehicle | ✅ implemented (this prompt) — via the same indirect `customerRequestId → vehicleId` data Conversation Detail already resolved since Prompt 22, now made clickable |
| Vehicle → Client | ✅ implemented |
| Vehicle → Request | ✅ implemented |
| Vehicle → Conversation | ❌ **not implemented** — no direct relation exists; see §3 and §14 |

## 11. Service History

`ServiceRecord` is a real, direct child of `Vehicle` (`vehicleId` is a
required FK, not optional) — it is a genuine historical log of completed
work (`performedAt`, `workDescription`, `totalPrice`, `mileage`, etc.),
not a generic event journal, and it is also linked to `Customer` and
`Service` directly, with an optional link to `Appointment`. It is
correctly and cheaply filterable by `vehicleId` through the existing,
unmodified `GET /api/service-history` endpoint. Vehicle Detail shows a
compact recent slice (5 records) and links out to the existing, fully
functional `/settings/service-history?vehicleId=` page (create/edit/
archive all remain there, unduplicated).

## 12. Validation

- **TypeScript** (`npx tsc --noEmit`): **PASS**
- **Build** (`npm run build`): **PASS** (858.82 kB main chunk, gzip
  189.87 kB — the pre-existing chunk-size warning, unrelated to this change)
- **Tests** (`npm test -- --run`): **1221/1221 passed**, 60 test files, unchanged

## 13. Git

- Commit hash: `c9846db`
- Commit message: `feat: add vehicle context v1`
- Pushed to `origin/master` successfully, no force push

## 14. Limitations

- **No Vehicle → Conversation section.** No direct relation exists. A
  two-hop derived join (fetch the vehicle's requests, then fetch the
  customer's conversations and client-side-filter to those whose
  `customerRequestId` matches one of the vehicle's request ids) was
  considered and deliberately **not** built — it would work, but presents
  a chain of two foreign keys as if it were a first-class relation, which
  felt like exactly the kind of fragile inference the prompt's own STEP 2
  and STEP 12 warn against. Documented here instead of silently built or
  silently omitted.
- **Conversation Detail's Customer section remains non-clickable.** Only
  the Vehicle card was wired to its new detail screen in this prompt,
  per the explicit Vehicle-only scope (STEP 17); fixing the Customer link
  there as well would be a one-line follow-up but was left out to avoid
  "заодно" scope creep.
- **No per-request-type/vehicle-type filtering** was added to the Vehicle
  list beyond what already existed (customer filter + the newly-added
  search) — not requested, and no additional real field would justify it.
- **Reference-data cap**: the customers reference list is still capped at
  the backend's own `pageSize=100` maximum, the same already-documented
  limitation from Prompts 20–25.
- **Vehicle Detail's Requests list is capped at 20** and Service History
  at 5 (with a link to the full, paginated history) — explicit, disclosed
  caps, not hidden data loss.

## 15. Screenshot

No screenshot validation performed.
