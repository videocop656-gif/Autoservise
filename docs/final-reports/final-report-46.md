# Final Report — Prompt 46: Cinematic Automotive Launch Refinement

## 1. Files changed

- `src/components/launch/CarSilhouette.tsx`: the car was redrawn as a ~22° 3/4-front view with two headlights, a headlight-lit haze, ground light pools and a gold shoulder reflection.
- `src/components/launch/AppLaunchScreen.tsx`: the stage timeline was consolidated into `LAUNCH_TIMING`, the new stages were added, and the mobile ordering was changed.
- `src/components/launch/launchScreen.css`: adds scoped amber headlight properties, the ignition, haze and gold-settle animations, and the atmosphere background. It animates only transform and opacity.
- `docs/prompts/prompt-46.md` and `docs/final-reports/final-report-46.md`

`useEngineSound.ts` and `LoginPage.tsx` were **not** changed.

## 2. What changed

**Timeline.** The stages now use named start times in ms at a 2700ms default. Each keeps the old proportional scaling via `animationDuration`.

| Stage | Start |
|---|---|
| silhouette | 350 |
| engineStart (sound + 1px body settle) | 800 |
| firstHeadlight (near) | 1050 |
| secondHeadlight (far) | 1300 |
| haze | 1450 |
| goldReflection | 1700 |
| brand | 2050 |
| login (CTA, auto-focused) | 2250 → settled ≈ 2.7s |

The scattered `STAGE_FRACTIONS` and the two hand-written all-true/all-false records were replaced by a single `LAUNCH_TIMING` table.

**Silhouette.** The Prompt 45 car was a side-profile coupe with one cold white/blue headlight. It is now a low 3/4-front car. The visible parts are the front fascia, hood leading edge, raked windshield, side glass, near-corner crease, side character line and foreshortened wheels. It is abstract, with no emblem and no grille pattern. Colors come from the existing tokens (`--muted`, `--card`, `--background`, `--border`, `--foreground` at 7–10% for the edges that catch light).

**Headlights.** The lamps use a warm amber (`--launch-headlight`, same hue family as `--primary`). These properties are scoped to `.launch-scene`, so the global palette in `index.css` is unchanged. Each lamp powers on with a short surge, a small dip, then a smooth climb, so there is never a frame at instant full brightness. The near lamp comes on first; the far lamp follows 250ms later and is smaller because of perspective.

**Haze.** Two soft, blurred amber ellipses sit in front of the car, plus faint light pools on the ground. The haze stays invisible until the lights are on, and every gradient fades to zero inside the viewBox, so nothing is clipped on small screens.

**Gold reflection.** One 2px `--primary` stroke sweeps along the near shoulder, then settles to 35% opacity.

**Brand and CTA.** These are the same HTML elements as before, with a fade and a small upward move. The blur-to-sharp filter from Prompt 45 was removed.

**Performance and cross-browser.** The car reveal no longer transitions `filter: blur()`, and the 60px CSS drop-shadow on the SVG was removed. Colors built on token `var()` values moved from SVG presentation attributes into `style`, because presentation attributes don't resolve `var()` in every browser.

**Responsive.** On narrow screens the car renders first, then the brand, then the CTA. It is a separate flex item, so it cannot overlap the controls. The SVG is capped at `max-w-xl` below `lg`.

## 3. What was preserved

- Authentication, the login API, cookies and sessions, redirects, `ProtectedRoute`, validation, roles and tenant logic are untouched. `LoginPage.tsx` has no diff.
- The per-session `sessionStorage` gate (`autoservise:launch-seen`) is unchanged. The intro does not replay after the CTA, after a failed submit, or after a reload.
- The CTA still reveals the one existing login form. No second login screen was added.
- The Web Audio engine start (~0.55s, low-passed, one-shot, autoplay-safe, with a Sound/Mute retry) is unchanged. It already matched the spec.
- Click-to-skip, reduced-motion rendering of the static final frame, and CTA auto-focus behave as before.
- No new dependencies, assets, or network-loaded media.

## 4. Validation

- TypeScript: **PASS** (`npm run typecheck`)
- Build: **PASS** (`npm run build`)
- Tests: **1229/1229** passing across 62 files. There are no `AppLaunchScreen` tests; none were changed.
- Live headless Chromium run against the Vite dev server:
  - Desktop frames at 0.3, 0.9, 1.2, 1.5, 1.9 and 2.9s show darkness → silhouette → near lamp → far lamp → haze → gold → brand → CTA.
  - The CTA auto-focuses, and Enter reveals the login form.
  - Submitting the form sends `POST /api/auth/login`, and the form stays in place after the error.
  - After a reload the form shows directly, with no intro.
  - Mobile (375×667) and tablet (820×1180): no horizontal scroll, the CTA is within the viewport, and both headlights are uncropped.
  - Reduced motion: the CTA is visible immediately.
  - No page errors. The only console entries were:
    - the pre-existing `401` from `/api/auth/me` for an unauthenticated user;
    - the `400` from the deliberately wrong test credentials;
    - a `404` for `/favicon.ico` (the project has no favicon; this predates this prompt).

## 5. Git

- Branch: `master`. One commit, following the one-commit-per-prompt convention. Nothing was pushed.
- The untracked `.mcp.json` and `marketing/` were not touched.
