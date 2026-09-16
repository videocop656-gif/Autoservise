# Final Report — Prompt 45: Premium Automotive App Launch Screen

## 1. Result

Built a self-contained cinematic launch screen (`AppLaunchScreen`) that plays once per new browser session on `/login`, before the existing login form: darkness → a stylized premium car silhouette emerges → a synthesized engine-start sound (with a fully graceful autoplay fallback) → headlights ignite and bloom → a thin gold accent line sweeps the body → the brand name fades in → a CTA appears and is auto-focused. The whole sequence runs ~2.3s, matches the project's existing dark-graphite-and-gold design system exactly (no new colors introduced), adds zero new npm dependencies, and ships zero binary asset bytes (the car is inline SVG, the engine sound is synthesized at runtime via the Web Audio API). Clicking or pressing Enter on the CTA reveals the real, completely unchanged login form in place — no routing, auth, or session logic was touched.

## 2. Visual

- **Автомобиль**: a hand-built, deliberately abstract inline SVG (`CarSilhouette.tsx`) — a low coupe silhouette in profile, rendered with the project's own graphite gradient tokens, never a photo, never a manufacturer shape or logo. Chosen over a stock/AI-generated photo specifically to satisfy "no copyrighted branded car imagery," "no manufacturer logos," and the performance constraint against adding heavy image/video assets — an SVG costs nothing beyond this one file and stays crisp at any size.
- **Темнота**: Stage 0 is a `radial-gradient` from a slightly lighter graphite center to the design system's own `--background` — never a flat, dead-black rectangle, per spec.
- **Engine start**: see §3.
- **Headlights**: a two-layer treatment on the car's single visible headlight — a blurred radial-gradient "bloom" circle (SVG `feGaussianBlur` filter) fading in first, then a sharp bright core ellipse, both driven by a CSS class toggle (`.launch-headlight-glow`/`.launch-headlight-core` + `.is-on`) with an eased opacity transition — no strobe, no flash.
- **Gold accent**: a single thin gold-gradient stroke (`hsl(var(--primary))`, the project's existing gold token — no new color) traces the car's beltline, "drawn on" via an SVG `stroke-dashoffset` transition rather than a plain fade, for a subtle premium reveal rather than a static line popping in.
- **Branding**: `AUTOSERVISE` (the specified temporary placeholder) as a large, minimal `<h1>`, with an "AI-администратор" gold micro-label above it and an optional tagline below — plain fade + slight upward motion + blur-to-sharp, no flashy text effects.
- **CTA**: reuses the existing `Button` component (`size="lg"`) completely unmodified — same radius, gold `primary` variant, hover, and focus-visible ring already defined in the design system. No new button style was created.

## 3. Sound

`useEngineSound.ts` exposes `{ muted, toggleMuted, play }`. By default (no `engineSound` URL passed), it synthesizes a short (~0.55s) "premium engine start" entirely with the Web Audio API — a low sine sweep (42→88Hz, the "starter turning over") layered with a filtered triangle-wave texture, both routed through a low-pass filter (420Hz cutoff) so it stays deep and muffled rather than buzzy or racing-loud, with a fast-attack/exponential-decay gain envelope. This ships with **zero audio asset bytes** and has no licensing surface at all. If a real recording is ever wanted, passing `engineSound="/path/to/file.mp3"` on `AppLaunchScreen` switches to playing that file via a plain `<audio>` element instead — no other code changes needed.

**Autoplay fallback**: the attempt to play happens on a fire-and-forget basis at the scheduled "engine sound" stage (~550ms); if the browser's autoplay policy blocks `AudioContext.resume()` (confirmed via live testing — Chromium logs `The AudioContext was not allowed to start...` as a benign console *warning*, never a thrown error), the promise rejection is caught silently and the visual timeline is completely unaffected — it was never awaited or gated on audio in the first place. A small circular Sound/Mute button (top-right, `Volume2`/`VolumeX` from lucide-react, `aria-pressed` + `aria-label`) lets the user retry: clicking it while nothing has played yet treats the click as the required user gesture and attempts playback immediately (rather than just flipping a "muted" flag the wrong way); after a successful play, the button becomes a plain, cosmetic mute/unmute toggle for the rest of that one-shot session (the sound never repeats). Verified live in headless Chromium: zero uncaught page errors in any of the desktop/mobile/reduced-motion runs.

## 4. UX

The screen is mounted *inside* `LoginPage.tsx`, not as a new route — `ProtectedRoute`/auth/session logic is completely untouched. A `sessionStorage` flag (`autoservise:launch-seen`) gates it: unset → show the intro; the CTA sets the flag and swaps to the existing login form in place. Because `sessionStorage` (not `localStorage`) is used, it naturally reappears on a genuinely new browser session but never repeats on a same-tab reload/return, matching the spec's "new session" framing without needing any new auth concept. Since an already-authenticated user never renders `LoginPage` at all (they land directly on a protected route), they are never shown this screen — satisfying "не мешать быстрому возвращению авторизованного пользователя" for free, with no extra logic required. `sessionStorage` access is wrapped in try/catch and fails open to the plain form if storage is unavailable (private browsing, etc.), so the intro can never trap a user.

## 5. Responsive

Verified in headless Chromium at both sizes (screenshots captured, see below):
- **Desktop (1440×900)**: a two-column layout (`flex-row` at `lg:`) — brand/tagline/CTA on the left, the car filling most of the right column (confirmed via computed styles: the SVG renders at ~704px, ~95% of its 739px column) with a `lg:scale-110` bleed so it visually exceeds its column slightly, per spec ("автомобиль может частично выходить за пределы контейнера").
- **Mobile (390×844)**: `flex-col` stacks the car on top (large) with brand/CTA below; confirmed via `document.documentElement.scrollWidth > clientWidth` returning `false` — no horizontal overflow at any point in the sequence.

## 6. Accessibility

- **Keyboard**: verified live — after the intro completes, the CTA button receives focus automatically (`ctaButtonRef.current?.focus()`), and pressing `Enter` with no mouse interaction at all successfully reveals the login form (confirmed: `document.activeElement` was the CTA, `Enter` triggered it).
- **Reduced motion**: `window.matchMedia('(prefers-reduced-motion: reduce)')` is checked once on mount; when true, every stage is marked "reached" immediately (no timers scheduled at all, no sound attempted) so the user sees the final, static, fully-branded frame instantly — verified live (`CTA visible almost immediately: true`). A matching `@media (prefers-reduced-motion: reduce)` block in `launchScreen.css` is a belt-and-braces backstop that also disables all transitions/animations at the CSS level.
- **ARIA/screen readers**: the brand name is a real `<h1>`; the car SVG is `aria-hidden="true"` (purely decorative); the sound button has `aria-label` (Russian, state-aware) and `aria-pressed`; the CTA is a real, native `<button>` with visible text, so a screen reader announces exactly the meaningful title and action the spec asks for.
- **Focus visibility**: the sound button and CTA both use the design system's existing `focus-visible:ring-ring` treatment — no new focus style was invented.

## 7. Performance

No new npm dependency was added (build/runtime dependency-free): production bundle grew from 913.80 kB to 911.53 kB JS (net *smaller*, from the same prompt's unrelated Lead-retirement work landing first) and CSS grew by ~4 kB (the new keyframes/classes) — no measurable bundle bloat. Every visual effect is a one-shot CSS `transition`/`animation` triggered by a class toggle — there is no `requestAnimationFrame` loop anywhere, so nothing keeps running or needs cancelling once the intro finishes. All stage timers are `setTimeout` ids collected in a ref array and cleared both in the effect's cleanup function and via an explicit `skipToEnd()` path (clicking anywhere before the CTA appears jumps straight to the final frame and cancels the rest of the schedule). `useEngineSound`'s cleanup effect closes the `AudioContext` and pauses any `<audio>` element on unmount. No layout shift: the scene occupies `min-h-screen` from the first paint, and the two-column grid never changes shape as stages progress — only opacity/transform/filter change.

## 8. Validation

- TypeScript: **PASS** (`npm run typecheck` — clean, no errors)
- Build: **PASS** (`npm run build` — `tsc --noEmit && vite build` succeeded, 1641 modules)
- Tests: **PASS** — 62 test files, **1229/1229** passing, unchanged from before this prompt (no existing test was touched or needed updating, since nothing about routing/auth/API surfaces changed)
- Manual/live verification (headless Chromium via Playwright, dev server, screenshots inspected): intro renders correctly at both viewports; clicking/pressing-Enter on the CTA reveals the real login form; no horizontal overflow on mobile; `prefers-reduced-motion` skips straight to the static final frame; the only console output during the whole flow was the expected benign AudioContext-autoplay-blocked *warning* (not an error) plus this app's own pre-existing `401` on the unauthenticated `/api/auth/me` check (unrelated, pre-existing behavior) — zero uncaught page errors in every run.

## 9. Files changed

New:
- `src/components/launch/AppLaunchScreen.tsx` — orchestrator: stage timing, sound button, layout, config props (`brandName`, `brandTagline`, `heroImage`, `engineSound`, `ctaLabel`, `ctaAction`, `animationDuration`)
- `src/components/launch/CarSilhouette.tsx` — the inline SVG car visual
- `src/components/launch/useEngineSound.ts` — Web Audio synthesis + mute state + autoplay-fallback logic
- `src/components/launch/launchScreen.css` — scoped keyframes/transition classes for the stage sequence

Modified:
- `src/pages/LoginPage.tsx` — gates `AppLaunchScreen` behind a `sessionStorage` flag before the existing (unmodified) login form

Nothing else was touched — no changes to `App.tsx`, routing, `AuthContext`, `ProtectedRoute`, the design tokens in `src/index.css`, or `tailwind.config.js`.

## 10. Git

- Branch: `master`
- Commit: the new `src/components/launch/` module, the `LoginPage.tsx` integration, `docs/prompts/prompt-45.md`, and this report are committed together as a single commit, following this project's established one-commit-per-prompt convention (see the commit hash in this repository's log immediately following this report's own commit).
- Push status: **nothing pushed** — per this prompt's explicit instruction, no `git push` was performed or will be performed automatically.
- Working tree: clean immediately before this commit (confirmed via `git status`), with only the pre-existing, unrelated `.mcp.json` and `marketing/` untracked — both predate this work and were left untouched.
