# Prompt 19 — Frontend Foundation + App Shell

> Historical reconstruction based on the recorded implementation state.
> This file is not a verbatim transcript of the original ChatGPT prompt/report.

The original prompt was pasted in full in an earlier development session
whose exact text is not available in current working context or in the
repository. This document reconstructs the task's actual scope from the
recorded implementation state and from the real, detailed commit message
of `672c0cb`, which describes what was requested and built at the time.

## Objective

Establish a product-wide **"Dark Graphite + Premium Gold"** design system
and a real, shared authenticated **App Shell** (Sidebar + Header),
applied to the entire application — not just to new pages — while
leaving the backend completely untouched.

## Required components

`AppShell`, `Sidebar`, `SidebarNav`, `Header`, `MobileNav`,
`PageContainer`, `PageHeader`, `UserMenu`, plus a single
`navigation.ts` source of truth for nav items and page titles, and a new
`SettingsHubPage` linking out to every settings page not promoted to
primary navigation.

## Design system

Dark-only palette expressed as CSS custom properties: background,
foreground, card, primary (gold accent), muted, destructive, border,
radius, plus semantic-only `success`/`warning`/`info` tokens reserved for
system states (never brand/nav color). Gold usage was explicitly
restrained: active-nav indicator, primary CTA, selected state, focus ring
— never a full sidebar/background fill, never every icon or badge.

## Routing and migration scope

- New top-level routes: `/dashboard`, `/conversations`, `/clients`,
  `/appointments`, `/ai-admin`, `/escalations`, `/channels`, `/settings`.
- Legacy `/settings/*` URLs for the five pages promoted to primary nav
  redirect to their new home (one source of truth, never two parallel
  copies of the same feature).
- The eleven remaining `/settings/*` pages keep their existing URLs,
  reachable via the new `SettingsHubPage`.
- The old flat `Nav.tsx` component is removed, since every page migrates
  to the new shell.
- `/ai-admin` maps to the existing `/settings/ai` test tool as a
  temporary, explicitly-flagged best fit (no clean 1:1 page existed).
- The Dashboard is deliberately reset to a placeholder at this stage — a
  conscious decision to rebuild it in the new visual system in a later
  prompt, not an accidental side effect. `analyticsService.ts` and
  `GET /api/dashboard` are left completely untouched.

## Constraints

- No backend, schema, or migration changes.
- No new npm dependencies (design tokens and layout only — no new UI
  library).
- No fake statistics, customers, conversations, or appointments anywhere.
- No business logic implemented or changed on any page during migration
  — every existing page's data-fetching and functionality must remain
  byte-for-byte unchanged, only its wrapper markup replaced.
- Responsive behavior (single `lg` breakpoint consistently separating
  desktop sidebar from mobile drawer) and accessibility (landmarks,
  `aria-label` on icon-only controls, real focusable elements, visible
  focus rings, Escape closes the mobile drawer) required throughout.

## Validation expected

TypeScript clean, production build clean, full existing backend test
suite passing unchanged (confirming zero backend regression), and an
explicit `git diff --stat` check proving nothing under `src/server/`,
`api/`, or `prisma/` was touched.
