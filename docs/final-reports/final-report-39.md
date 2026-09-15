## Final Report — Prompt 39: Client Service History & Retention Flow Audit

### 1. Audit Result

**Outcome B — small UX gap.** The overall flow (Client → Vehicle → Appointment → Completed Service → ServiceRecord → Service History → Recommendations) was already coherent and tenant-safe end to end (re-confirmed, unchanged since Prompts 30/38). Two real, concrete display gaps were found in the compact "История обслуживания" rows and fixed.

### 2. Existing Flow

Confirmed by reading the current code:

- `GET /api/customers/:id?includeVehicles=true` already returns a client's vehicles in one call; Client Detail already lists them and links to Vehicle Detail (`?open=`).
- `GET /api/service-history?customerId=`/`?vehicleId=` already power Client Detail's and Vehicle Detail's own compact history sections, each already deep-linking to the originating appointment when one exists (`/appointments?open=`, a Prompt 30 fix) — none of this needed to change.
- `serviceCompletionState()` (Prompt 33) and the "Рекомендовано: ..." line (Prompt 38) were both confirmed present and unmodified.
- Loading/error/empty states were already correctly distinguished in all three panels before this prompt (`historyError` never renders as a false "История обслуживания пока отсутствует" — the error branch is checked first).
- Post-service continuity already existed via multiple already-built paths: the recommendation itself, links back to client/vehicle/appointment, "Создать запись" on Request Detail (Prompt 31), and Operations' own request-based follow-up queue (Prompt 25) — none needed to be added.

### 3. Findings

Two real gaps, both confirmed against a live `ServiceRecord` in the dev database via a direct, read-only query (customer "Иван Иванов", vehicle "Subaru Legasy Legasy (1997)", service "Покраска капота", mileage `3`, `99999.97 RUB`):

1. **Client Detail never showed which vehicle a history row belonged to** (spec §1 item 2, and explicitly flagged as a risk by spec §6: a client with more than one vehicle would have no way to tell which car a given service entry was for). `vehicles` was already fetched on that same panel for its "Автомобили" section — the data was one line away, just unused for this purpose.
2. **None of the three compact renderers (Client/Vehicle/Appointment Detail) showed the catalog Service name, recorded mileage, or total price/currency** (spec §1 items 3/5/7, spec §2's own "which service was performed"/"what mileage was recorded"). All three fields were already returned by `GET /api/service-history` (`toServiceRecordDto` in `server/lib/dto.ts` already includes `serviceId`/`mileage`/`totalPrice`/`currency`) and already shown on the separate `/settings/service-history` management list — they simply never reached the point-of-care views, because the frontend's own narrowed `ServiceRecordDto` type didn't declare `serviceId`/`mileage` at all.

(Note: the live customer currently owns only one vehicle, so the multi-vehicle ambiguity itself isn't exercised by today's data — but the fix is correct and applies the moment a second vehicle exists, and showing the vehicle even for a single-vehicle client is harmless, accurate information.)

No other real gaps — navigation (`?open=` everywhere), tenant isolation, and empty/error states were all already correct.

### 4. Implementation

- `src/components/clients/shared.ts` — widened `ServiceRecordDto` to declare `serviceId: string` and `mileage: number | null` (both already always returned by the API; `recommendations` was already added in Prompt 38).
- `src/components/clients/ClientDetailPanel.tsx` — added one more parallel `GET /api/services?activeOnly=false` fetch to the existing `Promise.allSettled` batch (same reference-data-fetch-once convention already used everywhere else in this app), and a compact meta line per history row: vehicle (resolved from the *already-fetched* `vehicles` state — zero extra request) · service name · mileage · price.
- `src/components/vehicles/VehicleDetailPanel.tsx` — the same `services` fetch, and the same meta line minus vehicle attribution (this view is already scoped to one vehicle, so it isn't needed here).
- `src/components/appointments/AppointmentDetailPanel.tsx` — the same meta line, using the `services` prop this panel already receives (no new fetch) — added for row-shape consistency across all three panels rendering the same `ServiceRecordDto`.

Reused APIs/helpers: `GET /api/service-history?vehicleId=`/`?customerId=`, `GET /api/services?activeOnly=false` (already used by `AppointmentsSettingsPage`/`RequestDetailPanel`), `serviceName()`/`vehicleLabel()` (existing helpers). No new endpoint, no new component, no new query pattern.

Prisma/schema changes: **none** — every field involved already existed as a database column and was already returned by the API; this was purely a frontend declaration-and-render gap.

### 5. Security

No server-side code was touched. The new `services` fetches are the exact same `GET /api/services?activeOnly=false` call already used elsewhere in this app (tenant-scoped server-side, unchanged). No new query was introduced against `Client`/`Vehicle`/`Appointment`/`ServiceRecord`/`CustomerRequest` — only a frontend type widened to read fields the already-tenant-scoped service-history endpoint already sent.

### 6. Regression Check

- Prompt 33 (`serviceCompletionState()`): **intact** — not touched.
- Prompt 34 (Appointment creation): **intact** — not touched.
- Prompt 35 (date navigation/URL state): **intact** — `AppointmentsSettingsPage.tsx` not touched.
- Prompt 36 (Operations daily queue): **intact** — `OperationsPage.tsx` not touched.
- Prompt 37 (Request ↔ Appointment navigation): **intact** — `RequestDetailPanel.tsx` not touched.
- Prompt 38 (ServiceRecord recommendations visibility): **intact and extended** — the same "Рекомендовано: ..." line remains, unmodified, alongside the new meta line.

### 7. Validation

TypeScript: **PASS**
Build: **PASS**
Tests: **1260/1260** passed (actual result, run both before and after — unchanged count, as expected: this is a pure, framework-free JSX rendering change with no extractable pure logic, consistent with the same convention followed in Prompt 38).
Manual validation: performed via a direct, read-only database query against the one real `ServiceRecord` in the dev database (see Findings) rather than a browser click-through — that record's tenant ("Torque") is the user's own login, which this session does not hold (same limitation noted in Prompts 37 and 38's own Final Reports). The query confirmed the exact real values (`serviceId` → "Покраска капота", `mileage: 3`, `totalPrice: 99999.97`, `currency: RUB`) that the fixed rows will now display; a visual confirmation would take under a minute with your own login.

### 8. Git

Branch: `master`
Commit(s):
- `cde631d` — `fix: attribute vehicle and surface service/mileage/price in service history`
- (this Final Report + verbatim prompt, committed separately as docs, per this project's established convention)

Push: **nothing pushed** — per this prompt's explicit instruction.
Working tree: clean immediately before the docs commit; `.mcp.json` and `marketing/` remain untouched throughout.

STOP.
