# Prompt 22 — Conversation Detail v1

> Note on provenance: unlike Prompts 19–21, this task was not pasted into
> the development conversation as a separate, free-form numbered
> specification. Its requirements were instead given directly, in this
> exact form, as part of the "preserve project prompts and final
> reports" documentation task. This file organizes those requirements
> into a readable brief and is a faithful transcription of what was
> specified — not a reconstruction of some other, unseen original
> document, and not yet an implemented/completed prompt.

**Status: planned / not yet executed.** No corresponding Final Report
exists in `docs/final-reports/`.

## Objective

Build `/conversations`'s conversation detail experience to v1, on top of
the existing backend and the existing inline detail panel introduced
(and preserved) in Prompt 21 — improving the existing implementation,
not creating a second, parallel one.

## Mandatory first step — audit

Before writing any code: audit the existing Conversation Detail UI and
the existing conversation/message/escalation/customer/vehicle APIs it
already uses. Preserve the current inline-detail architecture if that is
in fact the existing architecture (do not invent a new detail route or
split-screen layout unless the audit shows one is already expected/
supported).

## Backend constraint

No backend changes. This is a frontend-only prompt, same rule as every
prompt since 19.

## Desktop layout

- Header
- Message thread
- A right-hand customer/context panel

## Header requirements

- Back to conversations
- Subject
- Client name
- Status
- Close/reopen action
- Attention indicator

## Message thread requirements

- Customer vs. AI/admin distinction, derived only from real fields (no
  invented "AI" sender type where none exists)
- Timestamps
- Loading state
- Error state
- Empty state

## Composer / send flow

- Preserve the existing composer/send flow exactly as it already works.
- Never call the Telegram API (or any channel provider) directly from
  the frontend — all sending goes through the existing backend send
  endpoint(s).
- Preserve the existing closed-conversation business rule (no sending
  into a closed conversation without first reopening it).

## Context panel

Show, only where real data exists:

- Customer
- Vehicle
- Request / service
- Escalation
- AI status

No invented fields, and no per-row additional fetch that would introduce
an N+1 request pattern.

## Mobile layout

Single column: header → messages → composer → context, in that order,
with no horizontal overflow anywhere.

## Cross-cutting requirements

- Accessibility (semantic structure, keyboard operability, aria-labels
  on icon-only controls).
- Responsive behavior across desktop/tablet/mobile.
- No new npm dependencies.
- TypeScript clean, production build clean, full existing test suite
  passing unchanged.
- A Final Report is required on completion, in the same format
  established by Prompts 18–21.

## Intended commit message

```text
feat: build conversation detail v1
```

## Explicit stop condition

Per Prompt 21's own closing instruction and the audit-first task that
preceded this one, Prompt 22 has **not** been executed. It remains
queued until explicitly started.
