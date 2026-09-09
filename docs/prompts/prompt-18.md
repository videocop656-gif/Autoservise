# Prompt 18 — Real Telegram Channel Integration

> Historical reconstruction based on the recorded implementation state.
> This file is not a verbatim transcript of the original ChatGPT prompt/report.

The original chat-formatted prompt text is not stored anywhere in this
repository or in currently available session context. This document
reconstructs the task's actual scope from two verifiable sources: the
list of known project facts recorded for this prompt, and the real,
detailed commit message of `5bfc9a8` (which describes, in the author's
own words at the time, exactly what was built and why). Nothing below is
invented beyond organizing those two sources into a readable brief.

## Context

Builds directly on the **Channel Integration & Delivery Foundation**
(Prompts 16–17): `ChannelConnection`, `ChannelDelivery`, the
`ChannelAdapter` interface, `NormalizedIncomingMessage` /
`NormalizedOutboundMessage`, `channelAdapterRegistry.ts`,
`channelMessageService.ts`, and `channelDeliveryService.ts` already
existed and already worked against a mock adapter. Prompt 18's job was
to connect the **real** Telegram Bot API to that existing foundation —
not to design a new channel architecture.

## Objective

Make `ChannelType.TELEGRAM` a real, working channel end-to-end:

- A real `TelegramChannelAdapter` implementing the existing
  `ChannelAdapter` interface (`parseIncoming()` / `sendMessage()` only —
  never touching Prisma or tenant/business scoping directly).
- A dedicated Telegram API client responsible for all `api.telegram.org`
  calls (`getMe`, `setWebhook`, `deleteWebhook`, `getWebhookInfo`,
  `sendMessage`).
- Bot identity resolution via `getMe()`.
- Customer identity from Telegram's `from.id`; conversation identity
  from `chat.id`; a deterministic, collision-safe external message id.
- A real inbound webhook endpoint, protected by Telegram secret-token
  validation, feeding the existing Conversation/Message/ChannelMessage
  pipeline without duplicating its logic.
- Outbound sending through the existing `ChannelDelivery` flow — no
  second send path.

## Explicit constraints

- **No AI auto-reply** — the AI layer stays completely disabled for
  Telegram-originated messages in this prompt.
- **No booking logic** — this prompt is transport only.
- **Server-side credentials only** — the bot token and webhook secret
  must never reach the client, logs, or any DTO.
- **Tenant isolation** — a Telegram bot identity must resolve to exactly
  one tenant/business; cross-tenant leakage is a hard failure.
- **Duplicate update protection** — Telegram may redeliver the same
  update; the same inbound message must never be recorded twice.
- **Inactive connection protection** — a deactivated `ChannelConnection`
  must reject inbound/outbound traffic.
- **"Optional credential → mock fallback"** — the same convention
  already established by `aiProviderFactory.ts` for `OPENAI_API_KEY`:
  without a configured `TELEGRAM_BOT_TOKEN`, the system falls back to the
  existing mock adapter, byte-identical to pre-Prompt-18 behavior.

## Known limitation going in

No real `TELEGRAM_BOT_TOKEN` / `TELEGRAM_WEBHOOK_SECRET` exists in this
environment. A full real-Telegram-API smoke test was expected to be
**blocked** by that missing credential — the implementation was required
to be correct and independently verifiable (via a real, credential-free
concurrent-webhook/Supabase smoke test) without ever inventing or
substituting a fake credential.
