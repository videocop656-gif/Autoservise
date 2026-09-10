# Final Report — Prompt 25: Operational Work Queue v1

## 1. Result

A new screen, `/operations` ("Рабочая очередь"), was added as a canonical
cross-entity aggregation view. It does not introduce any new business
entity, status, or backend concept — it is a read-only, real-data view
that pulls together already-existing Customer Requests and Escalations
into one place, with every row linking into the already-existing
Request/Conversation/Client detail flows. A sidebar nav item ("Рабочая
очередь") was added right after Dashboard.

## 2. Operational Logic

| Section | Real data used | Rule |
|---|---|---|
| **Требует внимания** (headline) | `AiEscalation` rows with `status IN (OPEN, IN_PROGRESS)` + `CustomerRequest` rows with `status = NEW` | Merged, sorted by each record's own real `createdAt` desc. These are the only two states in the whole system with an unambiguous, pre-existing "needs a first look" meaning — an escalation exists because the AI itself flagged it; a `NEW` request exists because nobody has acted on it yet. Nothing here is inferred or scored. |
| **Новые заявки** | `CustomerRequest.status = 'NEW'` | Direct, real status value — no relabeling. |
| **Ожидают дальнейшего действия** | `CustomerRequest.status IN (IN_PROGRESS, WAITING_CUSTOMER)` | Both are real, pre-existing statuses (confirmed in `prisma/schema.prisma`'s `CustomerRequestStatus` enum). Sorted client-side by real `updatedAt` desc (most recently touched first) since the two statuses are fetched via two separate filtered calls and merged. |
| **Эскалации** | Same `AiEscalation` rows as the headline section | Shown with their real `reason`, `summary`, `priority`, and `status` — no fabricated fields. |

**Section not implemented, and why**: a "new/incoming conversations" bucket
was considered but deliberately **not** built. `Conversation` has no
sub-state analogous to `CustomerRequest.NEW` — only `OPEN`/`CLOSED`.
Objectively distinguishing "a conversation nobody has replied to yet"
from "a conversation that has been open and active for days" would
require reading each conversation's message list (to check whether the
last message is `INBOUND`/`CUSTOMER`), which is a per-row fetch across a
list — exactly the N+1 pattern spec STEP 7 forbids. Rather than invent an
approximate heuristic (e.g., "created in the last N hours"), this bucket
was left out entirely, per spec STEP 2's own instruction not to invent
signals the data doesn't objectively support.

## 3. Files Changed

- `src/pages/OperationsPage.tsx` (new) — the Work Queue screen itself.
- `src/App.tsx` — added the `/operations` route.
- `src/components/layout/navigation.ts` — added the "Рабочая очередь"
  nav item and its page title.
- `src/components/conversations/shared.ts` — widened the shared
  `EscalationDto` type with the already-real `customerId` field (it was
  already returned by `GET /api/escalations`, just not previously
  declared on this narrowed frontend type — needed here to resolve/link
  the escalating customer).
- `src/components/requests/shared.ts` — re-exports `EscalationStatus` and
  `ESCALATION_STATUS_LABELS` (already defined in `conversations/shared.ts`)
  for reuse on this page.

## 4. API Used

- `GET /api/customer-requests?status=NEW&pageSize=20`
- `GET /api/customer-requests?status=IN_PROGRESS&pageSize=20`
- `GET /api/customer-requests?status=WAITING_CUSTOMER&pageSize=20`
- `GET /api/escalations?status=OPEN&pageSize=20`
- `GET /api/escalations?status=IN_PROGRESS&pageSize=20`
- `GET /api/customers?pageSize=100&includeInactive=true` (reference data,
  name resolution only)
- `PATCH /api/customer-requests/:id` (the existing quick status-change
  action, identical to the one already on `/requests`)

**Backend changes: none.** All of the above are pre-existing, unmodified
endpoints.

## 5. Prisma

```text
No Prisma schema changes.
No migrations.
```

## 6. N+1 Audit

Exactly **6 independent GET requests** are issued on page load, all
together via `Promise.allSettled` — never nested, never inside `.map()`,
never one-per-row:

1. `customer-requests?status=NEW`
2. `customer-requests?status=IN_PROGRESS`
3. `customer-requests?status=WAITING_CUSTOMER`
4. `escalations?status=OPEN`
5. `escalations?status=IN_PROGRESS`
6. `customers` (reference list, resolves every customer name shown
   anywhere on the page — zero additional per-row requests)

The two request-status calls and two escalation-status calls exist only
because, like every other status filter in this codebase (confirmed
during the Prompt 21–24 audits), the backend's `*StatusFilterSchema`
accepts a single value at a time — the same two-call pattern already
used by the Dashboard (Prompt 20) and Conversations (Prompt 21) for
exactly this reason. Nothing here scales with the number of rows
rendered — a business with 500 open requests still costs the same 6
requests as one with 5.

## 7. Cross-navigation

- **Work Queue → Request**: `Link to="/requests?open=<id>"` — opens the
  existing Request Detail (Prompt 24). ✅
- **Work Queue → Conversation**: `Link to="/conversations?open=<id>"` —
  opens the existing Conversation Detail (Prompt 22), used for every
  escalation row (escalations always resolve to their `conversationId`). ✅
- **Work Queue → Client**: `Link to="/clients?open=<customerId>"` — the
  customer name under each row (attention feed, escalations list) is
  itself a link into the existing Client Detail (Prompt 23), whenever a
  `customerId` is present. ✅

All three reuse the exact `?open=` mechanism already established in
Prompts 23/24 — no new detail screen, no new routing concept.

## 8. Responsive

- **Desktop**: the headline "Требует внимания" section spans full width;
  "Новые заявки" and "Ожидают дальнейшего действия" sit side by side in a
  2-column grid (`lg:grid-cols-2`); "Эскалации" spans full width below.
- **Tablet/Mobile**: the 2-column grid collapses to a single column below
  `lg` (Tailwind's default behavior, the same breakpoint convention used
  throughout the app since Prompt 19). Every row is a vertically-stacked
  card with no horizontal scrolling — CTA buttons wrap naturally below
  the row's text content on narrow viewports.

## 9. Validation

- **TypeScript** (`npx tsc --noEmit`): **PASS**
- **Build** (`npm run build`): **PASS** (837.68 kB main chunk, gzip
  186.79 kB — the pre-existing chunk-size warning, unrelated to this change)
- **Tests** (`npm test -- --run`): **1221/1221 passed**, 60 test files,
  unchanged from before this prompt

## 10. Git

- Commit hash: `e036d3f`
- Commit message: `feat: add operational work queue v1`
- Pushed to `origin/master` successfully, no force push
- Working tree: clean (aside from a pre-existing untracked `.mcp.json`
  environment file, not created by this work and deliberately left
  untouched/unstaged)

## 11. Limitations

- **No "new conversations" section** — see §2's explanation; this was a
  deliberate omission, not an oversight, because no honest N+1-free
  signal exists for it.
- **Reference-data cap**: the customers reference list used for name
  resolution is capped at the backend's own `pageSize=100` maximum — the
  same already-documented limitation from Prompts 20–24. A tenant with
  more than 100 customers could see a raw id fallback for whichever
  customer falls past that cap.
- **Headline section cap**: the merged "Требует внимания" feed shows at
  most the 10 most recent items (escalations + new requests combined) —
  an explicit, disclosed cap to keep the headline section scannable, not
  a hidden data loss (the fuller lists remain visible in the two
  dedicated sections below).
- **No bulk actions** — by design, per spec STEP 10; each row's only
  available action is either navigation or the single existing
  status-change mutation, exactly as it already works on `/requests`.
- **Escalation rows show no vehicle/service context** — that information
  lives on Request Detail / Client Detail, which this screen already
  links to; duplicating it here was not required by the spec's own
  Section 4 description (reason/summary/conversation/time/status only).

## 12. Screenshot

No screenshot validation was performed.
