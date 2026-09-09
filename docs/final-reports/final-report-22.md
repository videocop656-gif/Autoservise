# Final Report 22 — Conversation Detail v1

## 1. Summary

The Conversation Detail experience was rebuilt into a real operational
screen on top of the existing backend and the existing inline-detail
architecture from Prompt 21. When a conversation is opened, it now takes
over the full `/conversations` screen (header with back/status/close-
reopen/attention, a message thread, a composer, and a right-hand
customer/context panel) instead of appearing as a small inline card below
the list. No new route was created and no second implementation exists —
the audit confirmed the existing architecture was an inline panel within
`/conversations`, and that architecture was preserved and improved.

## 2. Files Changed

- `src/components/conversations/shared.ts` (new) — shared DTO types,
  labels, and helpers used by both the inbox and the detail panel.
- `src/components/conversations/ConversationDetailPanel.tsx` (new) — the
  Conversation Detail screen itself.
- `src/pages/settings/ConversationsSettingsPage.tsx` (rewritten) — now
  delegates to `ConversationDetailPanel` when a conversation is open, and
  fetches two additional reference lists (`vehicles`, `services`) needed
  by the detail panel's context section.

No other files were touched.

## 3. Existing Architecture Reused

- `GET /api/conversations/:id` (unchanged) — header, message thread,
  status, channel, customer/customerRequest summaries.
- `PATCH /api/conversations/:id` (unchanged) — close/reopen.
- `POST /api/conversations/:id/messages` (unchanged) — message creation.
- `POST /api/channels/:id/messages/:messageId/send` (unchanged) — the
  existing channel-delivery send action, reused exactly, chained
  automatically from the composer (see §4).
- `GET /api/escalations?conversationId=` (existing filter, confirmed via
  audit of `escalation.schemas.ts`/the escalation route/repository) —
  attention indicator and Escalation context section.
- `GET /api/ai-logs?conversationId=` (existing filter, confirmed via
  audit of the ai-logs route) — AI status context section.
- `GET /api/customers`, `/api/vehicles`, `/api/services`,
  `/api/customer-requests` (all existing, `pageSize=100`/unpaginated) —
  the same reference-data-fetch-and-lookup pattern already established by
  the Dashboard and the Conversations inbox, reused for the context panel.
- `PageContainer`, `Card`, `Button`, `Badge`, `Textarea`, `Input`, `Label`
  — all pre-existing UI primitives, no new component library.

## 4. Conversation Detail

- **Header**: back-to-list action (client-side, since there is no
  separate route), client name, subject, channel, real conversation
  status (`Badge`), close/reopen (existing API, role-gated exactly as
  before), and an attention indicator sourced from a real active
  escalation.
- **Messages**: rendered from the conversation's own `messages` array
  (already returned by the single-GET detail call — no per-message
  fetch). Distinguished by the real `senderType` field only
  (CUSTOMER/STAFF/SYSTEM) — both visually (alignment + bubble style) and
  textually (a label: "Клиент"/"Сотрудник"/"Система"), never by color
  alone. No "AI message" category was invented: the schema has no field
  that marks a message as AI-authored, so none is shown.
- **Sender distinction**: see above — an honest three-way distinction
  based on real data, not a guessed AI/Admin split.
- **Composer**: simplified from the previous manual
  direction/senderType picker (a Prompt-08-era testing affordance) to a
  single text input + Send button — the realistic "reply as staff"
  action an operational screen needs. Same underlying
  `POST /messages` call; on success, if the conversation has a
  `channelConnectionId`, the composer automatically chains the existing
  `POST /channels/:id/messages/:id/send` call so a staff reply reaches
  Telegram without a second manual click. If that second call fails, the
  message itself was still created — its own row keeps the pre-existing
  per-message retry button, so nothing is silently lost.
- **Status**: real `Conversation.status`, enforced server-side; the
  composer is hidden client-side when `CLOSED` (server independently
  returns `409 CONVERSATION_CLOSED` if bypassed).
- **Escalation**: the most recent real `AiEscalation` for this
  conversation (if any) — status, priority, reason, and summary shown
  as-is; "Эскалаций не было" shown honestly when none exists.
- **Context**: Customer (name, phone, email — all real, from the
  already-loaded reference list), Vehicle (make/model/year/plate/VIN,
  resolved via the customer request's `vehicleId`), Request/Service
  (subject, linked service name, real status label), Escalation (as
  above), AI status (only rendered when a real `AiLog` row exists for
  this conversation — operation + outcome + intent, translated to
  Russian, never invented).

## 5. Responsive

- **Desktop** (`lg:` and up): CSS Grid — header spans full width, message
  thread and context panel sit side by side (each independently
  scrollable, capped at `60vh`), composer spans full width beneath both.
- **Tablet**: same grid at `lg`, single column below it — the layout
  degrades to the mobile pattern before content would feel cramped.
- **Mobile**: single column, in DOM order header → messages → composer →
  context (exactly the order the spec asked for), achieved by having the
  desktop grid placement (`lg:col-start`/`lg:row-start`) apply only at
  `lg` and above — no horizontal overflow, no fixed-width elements,
  message bubbles capped at 85% width and wrap normally.

## 6. Data Sources

See §3. Every field in the header, thread, composer, and context panel
traces to a real, already-existing API response — none is computed from
a guess or hardcoded.

## 7. N+1 Review

Opening one conversation triggers exactly three requests, run together
via `Promise.allSettled` (not sequential, not nested, not inside a
`.map()`): `GET /api/conversations/:id`, `GET /api/escalations?conversationId=`,
`GET /api/ai-logs?conversationId=`. All customer/vehicle/service/request
context data is resolved from the four reference lists the parent page
already fetches once (`pageSize=100`/unpaginated) for the inbox's own
name resolution — zero additional per-field or per-message requests.
This is a detail view for exactly one record, not a list, so a small
fixed number of parallel requests here does not constitute an N+1
pattern.

## 8. Backend Changes

```text
No backend changes.
```

Confirmed via `git status`/`git diff --stat` — only
`src/components/conversations/*` and
`src/pages/settings/ConversationsSettingsPage.tsx` were touched.

## 9. Database

```text
No Prisma schema changes.
No migrations.
```

## 10. AI Isolation

```text
No AI behavior changes.
```

The AI status shown is a **read-only** display of an existing `AiLog`
row; nothing in this prompt calls, triggers, or modifies AI analysis,
tool execution, or escalation logic.

## 11. Validation

- TypeScript (`tsc --noEmit`): **PASS**
- Production build (`npm run build`): **PASS**
- Existing test suite: **1221/1221 passed** (60 files), unchanged

## 12. Git

- Commit hash: `19dc2f5`
- Commit message: `feat: build conversation detail v1`
- Push status: pushed to `origin/master` successfully (no force)
- Working tree: clean after commit and push

## 13. Limitations / Technical Debt

- The composer's earlier ability to manually create an INBOUND/CUSTOMER
  or SYSTEM message (a Prompt-08-era testing affordance) was removed
  from the visible UI in favor of a realistic single "reply as staff"
  action. The underlying API still supports arbitrary
  direction/senderType, so this is a UI simplification, not a backend
  capability change — flagged here for transparency since it does reduce
  what this screen can manually author compared to the previous version.
- The context panel's Vehicle/Service resolution depends on the
  conversation's linked `CustomerRequest` having a `vehicleId`/`serviceId`
  — a conversation with no linked request, or a request with neither
  field set, shows the honest "not specified" state rather than any
  fallback guess.
- Reference-data lookups (customers/vehicles/services/customer-requests)
  remain capped at the backend's own `pageSize=100` maximum, same
  limitation already noted in Prompts 20/21.
- AI status reflects only the single most recent `AiLog` row for the
  conversation, not a full AI activity history — sufficient for a v1
  "what's AI's current read on this conversation" signal, but not a log
  viewer (the existing `/settings/ai-logs` page already serves that
  purpose).
- No live browser screenshot validation was performed for this prompt
  (visual verification was deferred, consistent with Prompts 19–21).
