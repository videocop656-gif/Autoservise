# Final Report 18 — Real Telegram Channel Integration

> Historical reconstruction based on the recorded implementation state.
> This file is not a verbatim transcript of the original ChatGPT prompt/report.

The original chat-formatted Final Report text is not stored in this
repository. This document is reconstructed from a verifiable primary
source: the full commit message of `5bfc9a8` (reproduced in substance
below), cross-checked against the current repository (test files,
service/repository files, and `grep` evidence for the concurrency fix
described). Facts below are either direct quotes/paraphrases of that
commit message or independently verified against the current codebase;
neither is fabricated.

## 1. Implementation completed

The real Telegram Bot API was connected to the existing Channel
Integration & Delivery Foundation (Prompts 16–17), in both directions,
with the AI layer still completely disabled for this channel.

- `TelegramChannelAdapter` (`src/server/channels/adapters/telegramAdapter.ts`)
  implements the existing `ChannelAdapter` interface only.
- `telegramApiClient.ts` (`src/server/channels/adapters/telegram/`) is the
  one place that calls `api.telegram.org` (`getMe`/`setWebhook`/
  `deleteWebhook`/`getWebhookInfo`/`sendMessage`), over the platform's
  native `fetch` — no new HTTP dependency was added.
- `channelAdapterRegistry.ts`'s `getChannelAdapter('TELEGRAM')` returns
  the real adapter only when `TELEGRAM_BOT_TOKEN` is configured
  server-side, otherwise the pre-existing mock adapter — verified: the
  entire pre-existing test suite needed zero changes to keep passing.

## 2. Security

- Webhook authentication: constant-time comparison
  (`src/server/lib/timingSafeCompare.ts`) of the
  `X-Telegram-Bot-Api-Secret-Token` header against `TELEGRAM_WEBHOOK_SECRET`.
- Bot identity uses the bot's immutable numeric id (`getMe()`) as
  `ChannelConnection.externalAccountId`, never the mutable `@username`.
- Setup refuses to activate the same bot for a second tenant.
- No token, secret, internal id, or raw config JSON is ever exposed to
  the frontend — `/settings/channels` shows only a safe
  `Bot: @username` / `Webhook: configured` status line.

## 3. Identity mapping and delivery lifecycle

- Customer identity: Telegram `from.id` → `externalCustomerId`.
- Conversation identity: Telegram `chat.id` → `externalConversationId`.
- Deterministic external message id: `telegram:{chatId}:{messageId}`.
- Outbound reuses the existing
  `POST /api/channels/:id/messages/:messageId/send` — no second send
  endpoint. `ChannelSendResult` gained one additive `errorCode` field
  (`TELEGRAM_AUTH_ERROR` / `TELEGRAM_BAD_REQUEST` / `TELEGRAM_NOT_FOUND` /
  `TELEGRAM_RATE_LIMITED` / `TELEGRAM_NETWORK_ERROR` /
  `TELEGRAM_PROVIDER_ERROR`), replacing the generic Prompt 17 fallback.
- The existing `PENDING → SENDING → SENT/FAILED` `ChannelDelivery`
  lifecycle was reused unchanged.
- A message over Telegram's 4096-character limit is rejected before ever
  calling Telegram — never silently truncated.

## 4. Concurrency bug found and fixed

A real concurrency bug in Prompts 16/17's own inbound-race recovery was
found via a live concurrent-webhook smoke test:
`channelInboundRepository.ts` caught a Conversation-level `P2002` and
tried to re-fetch the winning row **inside the same aborted Postgres
transaction**, which reliably threw a second, unrelated `25P02`
("current transaction is aborted") — Postgres aborts the whole
transaction on any statement error, and Prisma does not implicitly
savepoint each query.

Fix: let the `P2002` propagate and roll back cleanly; move recovery to
`channelMessageService.ts`'s `receiveIncoming()`, which already handles
the analogous ChannelMessage-level race the same way (check
`loadDuplicateResult()` first, retry `recordInboundMessage()` once in a
fresh transaction if the race was between two first messages for a
brand-new thread). Confirmed fixed live against Supabase.

*(Verified present in the current codebase: `P2002`/`25P02` handling and
the accompanying explanatory comments exist in
`src/server/repositories/channelInboundRepository.ts` and
`src/server/services/channelMessageService.ts`.)*

## 5. Testing

New test files: `telegramAdapter.test.ts` (16), `telegramSetupService.test.ts`
(13), `telegramWebhook.test.ts` (13), `telegramAiRegression.test.ts` (2).
Extended: `channelAdapters.test.ts` (+3), `channelDeliveryService.test.ts`
(+1), `channelMessageService.test.ts` (+1), `tenantIsolation.test.ts` (+2,
plus a corrected race-propagation test).

**1221 tests total, all passing** at the time of this commit.

## 6. Real Supabase smoke test

A full real-Supabase smoke test (two tenants, two distinct mocked-network
bot identities, **24 checks**) verified: independent Telegram setup per
tenant, the cross-tenant same-bot guard, a real inbound flow through the
actual webhook route, no automatic Customer/CustomerChannelIdentity
creation, duplicate and genuinely concurrent duplicate deliveries
converging on exactly one Conversation/Message (the run that caught the
`25P02` fix above), real outbound SENT/FAILED/retry lifecycle,
post-deactivation rejection, cross-tenant webhook isolation, and a
wrong-secret rejection. Full cleanup was performed, with a post-cleanup
re-count confirming zero rows remained.

## 7. Known limitation

**Real Telegram API smoke test: blocked by a missing server-side
credential.** No `TELEGRAM_BOT_TOKEN` / `TELEGRAM_WEBHOOK_SECRET` existed
in the environment, and none was invented, per the task's own
instruction. Verification against the real Telegram network was
therefore not possible at this stage — only the mocked-network smoke
test above could run.

**Architectural limitation:** a single server-side Telegram bot token is
supported; multi-bot-per-tenant is out of scope.

## 8. Backend / database / migrations

- Backend changed: yes (this prompt's entire purpose).
- Database schema changed: **no** — the existing Prompt 16/17 schema
  already covered every requirement.
- Migrations: **none**.
- Secrets in DB rows, logs, or DTOs: **none** found.

## 9. Commit

`5bfc9a8` — "feat: connect real Telegram Bot API to channel integration"
