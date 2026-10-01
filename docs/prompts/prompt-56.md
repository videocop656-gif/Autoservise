# Prompt 56 — Booking Confirmation Flow

> Verbatim — reproduced exactly as provided in the development
> conversation for this project (not reconstructed, not paraphrased).
> The session limit was reached mid-implementation; the continuation
> prompt that resumed the work is appended verbatim at the end.

---

# PROMPT 56 — BOOKING CONFIRMATION FLOW
## Safely convert a qualified CustomerRequest into a real Appointment using authoritative availability

You are working in the existing project `Autoservise`.

This prompt continues directly from Prompt 55.

Prompts 50–51 already established:
- authoritative service capacity
- business-hours validation
- vehicle conflict protection
- race-safe appointment creation
- real free-slot generation
- booking availability UX

Prompts 53–55 established:
- real Conversation AI reply drafts
- trusted Customer + Vehicle intake
- AI-assisted structured CustomerRequest qualification

Prompt 56 now closes the next lifecycle gap:

Conversation
→ CustomerRequest
→ authoritative free slots
→ operator selects a concrete slot
→ operator explicitly confirms booking
→ real Appointment
→ CustomerRequest becomes converted according to existing lifecycle rules

This is NOT autonomous AI booking.

--------------------------------------------------
0. VERIFIED BASELINE
--------------------------------------------------

Repository:
- Project: Autoservise
- Branch: master
- Prompt 55 commit:
  `1e951d6 feat: add ai request qualification`
- Prompt 55 has been pushed to origin/master.
- Repository is clean and synchronized.

Stack:
- React + TypeScript + Vite
- Tailwind
- shadcn/ui
- lucide-react
- Vercel-compatible Node/TypeScript REST API
- PostgreSQL / Supabase
- Prisma
- Zod
- Vitest
- custom auth
- Argon2id
- HttpOnly sessions
- multi-tenant architecture

Roles:
- owner
- admin
- manager

Current test baseline:
- 1638 tests passing

Current lifecycle:

Telegram inbound
→ Conversation
→ Customer
→ Vehicle
→ AI qualification
→ CustomerRequest
→ Appointment
→ ServiceRecord
→ ServiceFollowUp

Relevant existing behavior:

Prompt 49:
- Conversation → CustomerRequest bridge

Prompt 49.1:
- protected Conversation/Request linkage

Prompt 50:
- Business.serviceBayCapacity
- authoritative capacity enforcement
- active occupancy statuses:
  SCHEDULED
  CONFIRMED
  IN_PROGRESS
- vehicle conflicts
- transaction/locking protection
- 409 CAPACITY_EXCEEDED

Prompt 51:
- authoritative availability endpoint/service
- business timezone
- Business Hours
- Service duration
- free-slot picker
- create/reschedule flows
- manual time mode
- save-time race handling

Prompt 55:
- AI qualification proposes:
  - stored Vehicle
  - configured active Service
  - description
  - preferred date/time
- operator explicitly creates/updates CustomerRequest
- no Appointment is created by qualification
- request starts NEW
- AI does not automatically mark QUALIFIED
- CustomerRequest timing uses existing request fields
- no schema change

--------------------------------------------------
1. OBJECTIVE
--------------------------------------------------

Implement a clear booking-confirmation workflow from an existing CustomerRequest.

Target operator workflow:

CustomerRequest
→ prerequisites are complete
→ real free slots are shown
→ operator selects a concrete slot
→ operator explicitly clicks booking confirmation
→ Appointment is created through the canonical appointment service
→ Request is linked to that Appointment
→ Request lifecycle is updated using existing transition rules
→ Conversation/Request/Appointment now form one coherent chain

The same workflow should be accessible naturally from Conversation Detail when that Conversation already has a linked CustomerRequest.

Do NOT build a second appointment system.

--------------------------------------------------
2. FIRST — AUDIT BEFORE IMPLEMENTATION
--------------------------------------------------

Before changing code, inspect actual project architecture.

Audit:

1. CustomerRequest Prisma model
2. Appointment Prisma model
3. CustomerRequest ↔ Appointment relation
4. Request status enum/transitions
5. current `CONVERTED` semantics
6. Prompt 27/28 request lifecycle implementation
7. existing `create Appointment from Request` functionality
8. Request Detail current quick-create Appointment action
9. Appointment create service
10. Appointment repository
11. appointment API
12. Prompt 50 capacity transaction/locking
13. Prompt 51 availability service
14. Prompt 51 day-mode availability endpoint
15. Prompt 51 slot picker components/helpers
16. Request timing fields
17. Service duration handling
18. business timezone helpers
19. Business Hours
20. vehicle conflict rules
21. Appointment status transitions
22. Conversation Detail linked Request UI
23. Prompt 55 qualification UI
24. existing error codes/messages
25. tenant-isolation tests
26. relevant browser flows

Do not assume names/routes from this prompt.

Reuse actual architecture.

Briefly report audit findings before implementation.

--------------------------------------------------
3. DO NOT DUPLICATE EXISTING BOOKING LOGIC
--------------------------------------------------

This is critical.

Prompt 56 must reuse:

- canonical Appointment creation service
- canonical availability generator
- Business Hours validation
- Service duration
- serviceBayCapacity
- vehicle conflict protection
- Prompt 50 transaction/lock behavior
- Prompt 51 slot semantics

Do NOT implement availability calculations in:
- Conversation components
- Request components
- AI layer
- a new booking service

There must remain one authoritative booking path.

--------------------------------------------------
4. BOOKING PREREQUISITES
--------------------------------------------------

Before offering booking confirmation, determine actual prerequisites from the existing Appointment domain.

At minimum, likely:

- Customer
- Vehicle
- Service
- valid future date/time

But use actual domain rules.

The UI should clearly show whether the Request is booking-ready.

Conceptually:

ГОТОВНОСТЬ К ЗАПИСИ

Клиент        ✓
Автомобиль    ✓
Услуга        ✓
Дата          ✓

If something is missing:

`Для записи не хватает: автомобиль, услуга`

Do not invent requirements such as:
- VIN
- plate
- email

unless the actual Appointment domain requires them.

--------------------------------------------------
5. CUSTOMERREQUEST AS SOURCE CONTEXT
--------------------------------------------------

The booking flow must use the trusted persisted CustomerRequest.

Do NOT re-read values from the AI qualification proposal after the Request has been saved.

Appointment input must come from current persisted domain state:

- Request.customerId
- Request.vehicleId
- Request.serviceId
- Request timing fields where applicable

The AI proposal is not authority.

CustomerRequest is.

--------------------------------------------------
6. FREE SLOT SELECTION
--------------------------------------------------

When Request has:

- Customer
- Vehicle
- Service

allow operator to see real free slots.

Reuse Prompt 51's availability UX/service.

Preferred behavior:

Request contains preferred date:
→ initially show free slots for that date

If no preferred date:
→ operator chooses a date first

Then:
→ show real available slots

Use business timezone.

Do not use browser timezone as booking authority.

The slot grid should behave consistently with `/appointments`.

--------------------------------------------------
7. PREFERRED TIME IS NOT A RESERVATION
--------------------------------------------------

This distinction is mandatory.

CustomerRequest may say:

`завтра после 15:00`

That is a preference.

It does NOT reserve:
- 15:00
- 15:30
- any slot

The UI may use the preference to:
- choose initial date
- visually prioritize relevant slots

But availability must be fetched fresh.

Never display preferred time as confirmed unless an Appointment actually exists.

--------------------------------------------------
8. SLOT FILTERING / PREFERENCE
--------------------------------------------------

If Request contains a meaningful preference such as:

`after 15:00`

and the existing request timing model can represent it safely:

prefer showing matching slots first or visually emphasize them.

Do not hide all other valid slots unless the domain semantics explicitly mean a hard constraint.

If current request model only stores a single preferred start time rather than a range:
do not invent range semantics.

Document actual behavior.

--------------------------------------------------
9. EXPLICIT BOOKING CONFIRMATION
--------------------------------------------------

Selecting a slot must NOT immediately create Appointment.

Require a separate explicit action.

Russian UI concept:

`Подтвердить запись`

Before confirmation show a compact summary:

Клиент
Алексей Смирнов

Автомобиль
Kia Rio

Услуга
Замена масла

Дата
2 октября

Время
15:30

Длительность
60 минут

[Подтвердить запись]

Use actual fields and formatting.

This is the mutation boundary.

--------------------------------------------------
10. APPOINTMENT CREATION
--------------------------------------------------

On explicit confirmation:

use the existing canonical Appointment creation path.

Do not bypass Prompt 50 protections.

The server must revalidate:

- Customer ownership
- Vehicle ownership
- Service ownership/active status
- Business Hours
- service duration
- vehicle conflict
- serviceBayCapacity
- requested interval
- tenant ownership
- current Request state

The slot displayed in the browser may be stale.

The server remains authority.

--------------------------------------------------
11. ATOMIC REQUEST → APPOINTMENT CONVERSION
--------------------------------------------------

Audit existing conversion semantics.

Desired invariant:

A successful booking from Request must not leave:

Appointment created
BUT
Request still unlinked/unconverted

or:

Request marked CONVERTED
BUT
Appointment missing.

Prefer one transaction using existing services/repositories where architecture permits:

1. lock/revalidate Request
2. create Appointment using canonical booking rules
3. link Appointment to Request
4. transition Request according to existing valid lifecycle
5. commit

Do not weaken Prompt 50's locking/capacity guarantees.

If existing architecture already has a canonical conversion service:
reuse it.

Do not create a competing implementation.

--------------------------------------------------
12. REQUEST STATUS
--------------------------------------------------

Audit existing status transition matrix.

Prompt 55 deliberately did NOT auto-mark Request QUALIFIED.

For Prompt 56:

do not require a fake status transition merely to make booking work.

If existing lifecycle requires:

NEW / IN_PROGRESS / WAITING_CUSTOMER / QUALIFIED
→ CONVERTED

when Appointment is created, use existing legal transition rules.

Do not bypass transition validation.

After successful conversion:
the Request should reflect the existing meaning of `CONVERTED`.

Do not invent a new BOOKED request status.

--------------------------------------------------
13. EXISTING APPOINTMENT
--------------------------------------------------

If Request already has an Appointment:

do NOT show a create-another-booking flow.

Show the linked Appointment.

Provide the existing navigation:

`Открыть запись`

Do not create duplicate Appointments.

If Request is CONVERTED but its Appointment relation is missing due to inconsistent legacy/test data:

do not silently create another Appointment.

Surface a safe warning and document the inconsistency.

--------------------------------------------------
14. IDEMPOTENCY / DOUBLE CLICK
--------------------------------------------------

Protect against:

- double-click on `Подтвердить запись`
- browser retry
- two tabs
- two operators confirming the same Request

The same Request must not produce two Appointments.

Audit existing Prompt 49/Appointment behavior.

Implement the smallest robust protection.

Prefer server-side Request locking/current-state recheck.

UI button disabling alone is insufficient.

Expected:
one Appointment maximum for a Request conversion.

If another confirmation already succeeded:
return/show the existing Appointment rather than creating another one where practical.

--------------------------------------------------
15. SLOT RACE
--------------------------------------------------

Important real-world scenario:

Operator sees:

15:30 free.

Another booking takes the final bay.

Operator clicks:

`Подтвердить запись`

Expected:

- no overbooking
- Prompt 50 returns authoritative conflict
- Request remains unconverted
- no partial Appointment
- slot list refreshes
- stale selected slot clears
- operator sees a concise Russian message

Concept:

`Это время уже занято. Выберите другое свободное время.`

Then show fresh slots.

Do not automatically choose another time.

--------------------------------------------------
16. VEHICLE CONFLICT
--------------------------------------------------

Same principle.

If the same Vehicle gets another overlapping Appointment before confirmation:

- booking rejected
- Request unchanged
- refresh availability
- operator chooses another slot

Use existing error semantics where possible.

--------------------------------------------------
17. SERVICE CHANGED / DEACTIVATED
--------------------------------------------------

If Service becomes inactive between Request qualification and booking:

do not book it.

Show:

`Услуга больше недоступна для записи. Выберите другую услугу.`

Use actual project wording/conventions.

Do not silently substitute another Service.

--------------------------------------------------
18. BUSINESS HOURS CHANGED
--------------------------------------------------

If Business Hours change after slot display:

server revalidation wins.

Do not create outside-hours Appointment.

Refresh availability.

--------------------------------------------------
19. CAPACITY CHANGED
--------------------------------------------------

If `serviceBayCapacity` changes:

server uses current capacity.

No stale client-side assumption may override it.

--------------------------------------------------
20. CONVERSATION DETAIL INTEGRATION
--------------------------------------------------

The operator should not need to navigate blindly across the application.

If Conversation has linked CustomerRequest:

show booking state in Conversation Detail.

Conceptually:

ЗАПИСЬ

If not ready:
`Для записи не хватает: ...`

If ready:
`Подобрать время`

If booked:
`2 октября · 15:30`
`Открыть запись →`

Reuse Request booking components/logic.

Do not implement a separate Conversation booking engine.

If a shared component is appropriate:
extract/reuse it.

--------------------------------------------------
21. REQUEST DETAIL
--------------------------------------------------

Request Detail should remain the canonical full booking surface.

Improve/replace the existing quick-create Appointment action where necessary so it uses the same Prompt 56 confirmation flow.

Do not leave two inconsistent ways to create an Appointment from Request.

If current quick-create already does most of this:
refactor it rather than adding another button beside it.

--------------------------------------------------
22. AI ROLE IN PROMPT 56
--------------------------------------------------

AI does NOT confirm booking.

AI does NOT create Appointment.

AI does NOT interpret customer:

`Да`

as permission to book.

AI does NOT monitor Telegram confirmation.

AI may have helped populate CustomerRequest in Prompt 55.

From this point onward Prompt 56 uses persisted Request data and authoritative booking services.

Do not add AI calls to booking confirmation.

--------------------------------------------------
23. NO CUSTOMER-FACING CONFIRMATION YET
--------------------------------------------------

After Appointment creation:

do NOT automatically send:

`Вы записаны на 15:30`

to Telegram.

That customer-facing confirmation belongs to a later controlled messaging step.

Prompt 56 creates the operational Appointment only.

The UI should clearly show success to the operator.

--------------------------------------------------
24. SUCCESS UX
--------------------------------------------------

After successful confirmation:

show clear success state.

Concept:

`Запись создана`

2 октября · 15:30
Toyota/Kia...
Замена масла

[Открыть запись]

The Request should refresh and display:
- linked Appointment
- correct status
- no second create button

Conversation Detail should also reflect the booking when applicable.

--------------------------------------------------
25. CANCELLED APPOINTMENT / REQUEST RELATION
--------------------------------------------------

Audit existing semantics for a Request whose linked Appointment is later CANCELLED or NO_SHOW.

Do NOT redesign that lifecycle unless Prompt 56 exposes a direct correctness bug.

At minimum:
- do not automatically create replacement Appointment
- do not silently revert Request status
- preserve existing behavior
- document what happens

If a severe invariant violation is discovered:
report before broad redesign.

--------------------------------------------------
26. API DESIGN
--------------------------------------------------

Prefer existing Request/Appointment endpoints.

If a focused conversion endpoint is needed, use project conventions.

Conceptually it could resemble:

POST /api/requests/:id/appointment

with:
{
  startAt: ...
}

But do NOT blindly create this route.

First inspect existing API.

The server should derive from Request:
- Customer
- Vehicle
- Service

Do not trust browser-supplied IDs if the Request already owns those canonical values.

The client should ideally provide only the booking choice necessary for confirmation, e.g. selected start time / interval according to existing architecture.

--------------------------------------------------
27. SECURITY / TENANT ISOLATION
--------------------------------------------------

Prove:

- unauthenticated confirmation rejected
- foreign Request rejected
- foreign Customer cannot be used
- foreign Vehicle cannot be used
- foreign Service cannot be used
- foreign Appointment cannot be linked
- Request's canonical IDs cannot be overridden with crafted browser IDs
- Conversation from another tenant cannot expose booking state

Never trust client tenantId.

--------------------------------------------------
28. TRANSACTION / CONCURRENCY
--------------------------------------------------

This deserves focused tests.

Test at least:

A.
capacity = 1
two Requests
same final slot
parallel confirmation

Expected:
one succeeds
one receives conflict
one Appointment occupies slot

B.
same Request
two parallel confirmations

Expected:
one Appointment total

C.
same Vehicle
two Requests
overlapping interval

Expected:
one succeeds
one rejected by vehicle conflict

Use real transaction behavior where current test architecture supports it.

Do not weaken existing Prompt 50 race tests.

--------------------------------------------------
29. ERROR UX
--------------------------------------------------

Use concise Russian operator-facing errors.

Examples conceptually:

`Это время уже занято. Выберите другое свободное время.`

`Для записи не хватает данных.`

`Автомобиль уже записан на это время.`

`Услуга больше недоступна для записи.`

`Данные заявки изменились. Обновите страницу и попробуйте ещё раз.`

Do not expose:
- SQL
- Prisma errors
- stack traces
- internal tenant IDs

--------------------------------------------------
30. MOBILE
--------------------------------------------------

Validate at 390px.

Must work:

- booking readiness
- date selection
- free-slot grid
- selected slot
- confirmation summary
- confirm button
- success state

No horizontal overflow.

Reuse Prompt 51 responsive slot grid where possible.

--------------------------------------------------
31. TESTS
--------------------------------------------------

Keep all 1638 existing tests passing.

Add focused tests.

READINESS:
1. complete Request is booking-ready
2. missing Customer not ready
3. missing Vehicle not ready
4. missing Service not ready
5. missing date behavior matches actual domain
6. VIN/plate not incorrectly required

AVAILABILITY:
7. uses canonical Prompt 51 availability
8. business timezone respected
9. Business Hours respected
10. Service duration respected
11. capacity respected
12. vehicle conflicts respected
13. preferred timing does not reserve slot

CONFIRMATION:
14. selecting slot causes no mutation
15. explicit confirmation creates Appointment
16. Appointment uses Request Customer
17. Appointment uses Request Vehicle
18. Appointment uses Request Service
19. no browser-supplied alternate IDs accepted
20. Request linked to Appointment
21. Request transitions correctly
22. no customer-facing Message created
23. no ChannelDelivery created
24. no Telegram call

IDEMPOTENCY / RACES:
25. double confirm creates one Appointment
26. two parallel confirms same Request create one Appointment
27. capacity=1 parallel Requests allow one booking
28. same-Vehicle parallel conflict safe
29. stale slot leaves Request unconverted
30. failed conversion leaves no orphan Appointment
31. failed conversion leaves no false CONVERTED Request

STATE CHANGES:
32. inactive Service rejected
33. changed Business Hours respected
34. changed capacity respected
35. already-booked Request does not create second Appointment
36. existing Appointment displayed

SECURITY:
37. unauthenticated rejected
38. foreign Request rejected
39. foreign IDs cannot override Request context
40. tenant isolation preserved

REGRESSION:
41. Prompt 51 appointment create/reschedule still works
42. Prompt 53 AI draft still works
43. Prompt 54 intake still works
44. Prompt 55 qualification still works
45. Request lifecycle tests still pass
46. ServiceRecord lifecycle unaffected

Add more focused tests if architecture reveals important invariants.

--------------------------------------------------
32. MANUAL / BROWSER VALIDATION
--------------------------------------------------

Use test tenant/data only.

Scenario A — normal booking:

- Conversation
- linked Customer
- stored Vehicle
- qualified Request
- configured active Service
- preferred tomorrow after 15:00
- open booking
- real free slots appear
- select one
- verify nothing created yet
- click `Подтвердить запись`
- exactly one Appointment created
- Request linked/converted correctly
- Conversation shows booking
- no Telegram message sent

Scenario B — slot race:

- display free slot
- consume final capacity through test/admin path
- confirm stale selection
- booking rejected
- Request unchanged
- slots refresh
- stale selection cleared

Scenario C — double confirm:

- trigger two confirmations as closely as practical
- exactly one Appointment exists

Scenario D — already booked:

- reopen Request
- no create-another flow
- linked Appointment shown

Scenario E — incomplete Request:

- remove/miss one real prerequisite
- readiness explains exactly what is missing
- confirmation unavailable

Scenario F — Prompt 55 regression:

- run `Разобрать обращение`
- qualification still works
- saving Request still creates no Appointment

Scenario G — 390px:

- complete booking flow usable
- no horizontal overflow

Do NOT message a real customer.

--------------------------------------------------
33. TEST DATA
--------------------------------------------------

Use clearly marked test records only.

Do not alter real tenant data.

After validation:
- deactivate temporary mock channels
- list test data left behind
- do not perform broad destructive cleanup

--------------------------------------------------
34. DO NOT ADD
--------------------------------------------------

Do NOT add:

- autonomous AI booking
- interpreting customer `Да` as booking permission
- webhook → AI
- automatic Telegram confirmation
- automatic outbound Message
- AI Customer creation
- AI Vehicle creation
- CRM
- CPBS
- WhatsApp
- SMS
- email
- billing
- payment
- technician scheduling
- individual bay entities
- voice transcription
- photo understanding
- launch screen changes
- landing page work

--------------------------------------------------
35. DATABASE
--------------------------------------------------

Expected:

NO Prisma schema change.
NO migration.

Reuse existing:
- CustomerRequest
- Appointment
- existing relation
- existing status model

If a schema change appears necessary:

STOP BEFORE changing Prisma.

Explain:
1. what invariant cannot currently be represented
2. exact proposed change
3. migration impact
4. alternatives
5. lifecycle consequences

Wait for approval.

--------------------------------------------------
36. QUALITY GATES
--------------------------------------------------

Run:

- full test suite
- TypeScript/typecheck
- build
- Prisma validate
- relevant lint/check scripts if present

Report exact counts.

--------------------------------------------------
37. DOCUMENTATION
--------------------------------------------------

Create:

`docs/prompts/prompt-56.md`

`docs/final-reports/final-report-56.md`

Document:

- booking readiness rules
- Request as booking source of truth
- availability reuse
- preference semantics
- confirmation mutation boundary
- transaction/conversion behavior
- Request status transition
- idempotency
- concurrency results
- slot-race behavior
- Conversation integration
- remaining gaps

--------------------------------------------------
38. GIT
--------------------------------------------------

Before work verify:

- branch = master
- clean working tree
- HEAD = `1e951d6`
- origin/master = `1e951d6`

If baseline differs unexpectedly:
STOP and report.

After successful implementation and validation:

create ONE local commit:

`feat: add request booking confirmation`

Do NOT push automatically.

Do NOT force push.

--------------------------------------------------
39. REQUIRED FINAL REPORT
--------------------------------------------------

Return:

1. Audit findings
2. Existing booking architecture reused
3. Booking readiness rules
4. Request source-of-truth behavior
5. Preferred-time semantics
6. Availability UX
7. Explicit confirmation UX
8. Appointment creation path
9. Atomic conversion behavior
10. Request status transition
11. Existing-Appointment behavior
12. Idempotency / double-submit protection
13. Capacity race behavior
14. Vehicle-conflict behavior
15. Service/hours/capacity stale-state behavior
16. Conversation Detail integration
17. Request Detail integration
18. Customer-facing messaging behavior
19. Security / tenant isolation
20. Database/schema status
21. Tests:
    - baseline
    - added
    - final
22. Concurrency test results
23. TypeScript/build/Prisma results
24. Browser validation
25. 390px validation
26. Test data left behind
27. Files changed
28. Commit hash
29. Git status
30. Remaining gaps explicitly NOT solved

--------------------------------------------------
40. STOP CONDITION
--------------------------------------------------

STOP after Prompt 56 is:

- implemented
- tested
- concurrency-validated
- browser-validated
- documented
- committed locally

DO NOT PUSH.

DO NOT proceed to Prompt 57.

DO NOT enable autonomous AI.

DO NOT send automatic booking confirmations.

Wait for review.

---

## Continuation prompt (verbatim)

Continue Prompt 56 from the current working tree.

The previous session stopped only because the Claude Code session limit was reached.

Do not restart the implementation from scratch.
Do not discard, revert, reset, or overwrite any existing Prompt 56 changes.

First:
1. Inspect git status and git diff.
2. Determine exactly what Prompt 56 work is already complete.
3. Inspect the current requestBooking tests and implementation.
4. Continue from the last unfinished step.

Prompt 56 goal:
Complete the Booking Confirmation Flow from a qualified CustomerRequest to a real Appointment.

The canonical flow must be:

CustomerRequest
→ authoritative availability
→ operator selects a real free slot
→ explicit "Подтвердить запись"
→ Appointment is created
→ CustomerRequest is linked to that Appointment and converted.

Important rules:

- CustomerRequest is the source of truth for customer, vehicle, service and requested/preferred timing.
- Preferred time is only a preference, never a reservation.
- Reuse the existing Prompt 50–51 availability/capacity infrastructure.
- Do not create a second booking engine.
- Do not let AI create the Appointment.
- Do not send any customer-facing Telegram/WhatsApp confirmation in this prompt.
- Do not add telephony, WhatsApp, missed-call recovery, or other future channel work here.
- Do not modify the launch screen.
- No new Prisma schema/migration is expected unless an actual unavoidable integrity requirement is discovered.

Server-side booking confirmation must revalidate:
- tenant ownership/isolation
- CustomerRequest state
- customer
- vehicle
- active service
- business working hours
- service duration
- vehicle conflict
- service-bay capacity
- selected slot availability

The conversion must be race-safe.

Prevent:
- double-click creating two Appointments
- two browser tabs creating two Appointments
- two operators simultaneously converting the same CustomerRequest
- stale availability creating an invalid Appointment

Where possible, Appointment creation + CustomerRequest linking/conversion must be atomic.

If the selected slot becomes unavailable:
- return the appropriate conflict response
- do NOT convert the CustomerRequest
- do NOT leave a partial Appointment
- refresh/reload authoritative availability in the UI
- let the operator choose another slot

UI:
- integrate the booking confirmation flow into Request Detail as the canonical booking surface
- integrate it appropriately into Conversation Detail when the linked request is ready for booking
- show authoritative free slots
- require an explicit operator action "Подтвердить запись"
- provide clear loading, conflict, success and stale-state behavior
- prevent accidental duplicate submission
- after success, show/open the canonical Appointment and linked/converted Request state

Do not duplicate existing appointment creation logic if a shared service can be reused or safely extracted.

Testing must include at minimum:
- happy-path Request → Appointment conversion
- tenant isolation
- invalid/missing customer
- invalid/missing vehicle
- inactive/invalid service
- outside working hours
- vehicle conflict
- capacity conflict
- stale slot
- double submission/idempotent or conflict-safe behavior
- concurrent booking attempts for the same CustomerRequest
- no partial conversion on failure
- correct Request → Appointment linkage
- correct converted state after success
- Conversation Detail integration
- Request Detail integration

The previous session was working on:
tests/requestBooking.test.ts

Inspect that file and all current Prompt 56 changes before editing anything.
Preserve valid work already completed.

Then finish Prompt 56 completely.

Validation before finishing:
1. Run the focused Prompt 56 tests.
2. Run the full test suite.
3. Run TypeScript/typecheck.
4. Run build.
5. Run Prisma validate.
6. Perform browser validation of the Request Detail booking flow.
7. Perform browser validation of the Conversation Detail integration.
8. Validate the UI at 390px width.
9. Check git diff for accidental unrelated changes.

Documentation:
- update the appropriate Prompt 56 documentation/final report following the existing docs/prompts and docs/final-reports conventions.

Git:
- create ONE local commit for completed Prompt 56:
  feat: add request booking confirmation
- Do NOT push.
- Do NOT proceed to Prompt 57.
- Do NOT implement WhatsApp, telephony, missed-call recovery, or the new product-direction work yet.

Return a complete Prompt 56 Final Report containing:
- implementation summary
- files changed
- API/booking behavior
- concurrency/race-safety behavior
- Request Detail UX
- Conversation Detail UX
- tests and exact final test count
- typecheck/build/Prisma results
- browser + 390px validation
- schema/migration status
- git commit hash
- any remaining limitations

STOP after the Final Report.
