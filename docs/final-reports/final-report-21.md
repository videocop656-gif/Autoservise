# Final Report 21 — Conversations Inbox v1

> Verbatim — reproduced exactly as delivered in the development
> conversation for this project (not reconstructed, not paraphrased).

---

## 1. Implemented

`/conversations` is now a real operational inbox instead of a bare list card: search + status/channel/attention filters in a toolbar, a compact row-per-conversation list with client identity, channel, status, last activity and an attention indicator, loading skeletons, three distinct empty/error states, and pagination. Clicking a row opens the existing conversation-detail panel (messages, send message, close/reopen, send-via-channel) — all of that was already working and is preserved unchanged, just restyled with `Badge`.

## 2. Existing API Used

- `GET /api/conversations` — `page`, `pageSize`, `status`, `channel`, `search` (all pre-existing params)
- `GET /api/conversations/:id` — detail panel (unchanged)
- `POST /api/conversations`, `PATCH /api/conversations/:id`, `POST /api/conversations/:id/messages`, `POST /api/channels/:id/messages/:id/send` — all pre-existing, unchanged
- `GET /api/customers?pageSize=100`, `GET /api/customer-requests?pageSize=100` — reference-data name resolution
- `GET /api/escalations?status=OPEN&pageSize=100` and `?status=IN_PROGRESS&pageSize=100` — attention derivation (same pattern as the Dashboard)

## 3. Data Mapping

| UI field | Source |
|---|---|
| Client name | `Conversation.customerId` → looked up against `GET /api/customers`; "Неизвестный клиент" fallback |
| Channel | `Conversation.channel` (real enum) |
| Status | `Conversation.status` (OPEN/CLOSED) |
| Last activity | `lastMessageAt ?? createdAt`, formatted "N мин назад" / "Сегодня, HH:MM" / "Вчера, HH:MM" / absolute date |
| Attention | derived: conversation id present in currently OPEN/IN_PROGRESS `AiEscalation`s |
| Message preview | **not shown** — list endpoint never returns `messages`; fetching it per row would be N+1 |
| AI/human state | **not shown** — no honest per-row signal exists without an extra request per row |

## 4. Search / Filters

- Search: real server-side, matches `Conversation.subject` only (debounced 300ms client-side)
- Status/Channel: real server-side filters, real enum values only
- "Требует внимания": client-side only (no backend join exists for this) — when active, fetches the max allowed page (100) under the current filters and filters client-side; a note appears if more than 100 matching conversations exist

## 5. Pagination

Standard page/pageSize controls reused from the existing `Pagination` component and `GET /api/conversations`'s own page/pageSize/total/totalPages contract. Hidden while the attention filter is active (see above).

## 6. Empty / Loading / Error States

Skeleton rows while loading; "Обращений пока нет" when genuinely empty; "Ничего не найдено" + "Сбросить фильтры" when filters/search yield nothing; "Не удалось загрузить обращения" + "Повторить" on fetch failure. No stack traces or raw errors shown.

## 7. Files Changed

- `src/pages/settings/ConversationsSettingsPage.tsx` (only file — routed at `/conversations` since Prompt 19, filename kept as-is per that prompt's own convention)

## 8. Backend

```
backend files changed: no
database changed: no
migrations: no
API contracts changed: no
```

## 9. Dependencies

```
new dependencies: no
```

## 10. Validation

- TypeScript (`tsc --noEmit`): PASS
- Build (`npm run build`): PASS
- Tests: **1221/1221 passed** (60 files), unchanged

## 11. Known Limitations

- Search matches conversation **subject only** (backend limitation, not new)
- No message preview in the list (list endpoint doesn't return messages)
- No AI/human-handled indicator per row (no cheap real signal without N+1 fetches)
- "Требует внимания" filter is client-side and capped at the first 100 matching conversations under current filters — not a true server-side filter across all pages
- Conversation Detail remains the existing inline panel, not a dedicated screen/route (explicitly out of scope for this prompt)

## 12. Commit

`ad7355e` — "feat: build conversations inbox v1"
