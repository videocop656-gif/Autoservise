# Prompt 46 — Cinematic Automotive Launch Refinement

> Verbatim — reproduced exactly as provided in the development
> conversation for this project (not reconstructed, not paraphrased).

---

# Prompt 46 — Cinematic Automotive Launch Refinement

## CONTEXT

This is the existing `Autoservise` project.

Repository/project:

* Product: AI-administrator for auto-service businesses
* Technical name: `autoservise`
* Stack: Vite + React + TypeScript
* Styling: Tailwind + shadcn/ui + lucide
* Existing authentication and `/login` flow are already implemented
* `AppLaunchScreen` was implemented in Prompt 45

Prompt 45 already introduced a cinematic launch sequence on `/login`:

* darkness
* abstract automotive silhouette
* synthesized deep engine-start sound
* headlights turning on
* warm light
* subtle gold sweep
* brand
* existing CTA

The goal of Prompt 46 is **NOT to rebuild `/login` or authentication**.

The goal is to refine the visual language of the existing launch screen using the new automotive visual reference direction.

---

# PRIMARY OBJECTIVE

Upgrade the existing `AppLaunchScreen` into a more premium, restrained cinematic automotive startup experience.

The visual metaphor must communicate:

> **"The system has started."**

Not:

> "A sports car commercial."

The launch should feel like a premium automotive technology product becoming active.

---

# IMPORTANT: PRESERVE EXISTING FUNCTIONALITY

Do NOT rewrite or replace the authentication system.

Do NOT modify:

* login API behavior
* session handling
* cookies
* authentication state
* redirects
* protected routes
* existing form validation
* user roles
* tenant logic
* API contracts
* database
* Prisma
* migrations
* backend architecture

Do NOT introduce a new authentication mechanism.

Do NOT add dependencies unless absolutely necessary.

Before changing anything, inspect the existing implementation of:

* `AppLaunchScreen`
* `/login`
* existing login components
* existing design tokens
* any launch-related CSS
* any existing audio implementation

Reuse the current architecture wherever possible.

---

# VISUAL REFERENCE DIRECTION

The visual reference is a cinematic automotive scene:

* premium automobile
* subtle 3/4 front perspective
* approximately 20–25 degrees from frontal view
* dark navy / graphite environment
* very subtle atmospheric fog
* almost-black surroundings
* warm amber headlights
* restrained illumination
* subtle gold reflection on the body
* no flashy supercar aesthetic
* no bright white headlights
* no neon
* no colorful futuristic effects

The car should feel premium and modern, but NOT like a recognizable real-world automotive advertisement.

Avoid strong branding or recognizable manufacturer emblems.

The automobile is a visual metaphor for the application startup.

---

# TARGET EXPERIENCE

The launch sequence should remain approximately 2.3–2.7 seconds.

Do not extend it into an 8-second video-like intro.

The application must feel fast.

The user should never feel that the launch screen is delaying access to the product.

Recommended sequence:

### 0.00–0.35s — DARKNESS

Screen starts in deep graphite/navy darkness.

Not pure black.

Use the existing Autoservise dark design tokens.

The background should have an extremely subtle navy atmospheric gradient.

No visible UI yet.

---

### 0.35–0.80s — AUTOMOTIVE SILHOUETTE

A subtle premium automotive silhouette begins to emerge.

The visual should suggest:

* front of a car
* slight 3/4 angle
* hood
* windshield
* front light shapes
* subtle side body line

Do NOT create a detailed photographic car.

Do NOT use a generic obvious SVG car icon.

The silhouette should feel abstract, cinematic and premium.

If the current inline SVG silhouette from Prompt 45 is reusable, refine it rather than replacing the entire architecture.

The silhouette should remain dark graphite/navy with very subtle reflected light.

---

### 0.80–1.25s — ENGINE START

Trigger the existing synthesized engine-start sound.

Keep the existing Web Audio approach if possible.

The sound should feel:

* deep
* low-frequency
* restrained
* mechanical
* premium

Avoid:

* loud racing engine
* aggressive revving
* motorcycle sound
* cartoon sound
* obvious stock sound

The sound must not prevent the page from functioning if browser autoplay/audio restrictions apply.

Preserve the existing fallback behavior.

Do not introduce external audio files unless absolutely necessary.

---

### 1.05–1.45s — FIRST HEADLIGHT

The first headlight begins to glow.

Use a warm amber/golden temperature.

The transition should be smooth.

It should feel like a real automotive light powering on.

Avoid instant full brightness.

---

### 1.30–1.70s — SECOND HEADLIGHT

The second headlight activates shortly after the first.

The two headlights should not necessarily turn on at exactly the same frame.

A tiny stagger creates a more believable startup sequence.

Keep the difference subtle.

---

### 1.45–1.95s — LIGHT THROUGH FOG

The warm headlights softly illuminate a very subtle atmospheric haze.

Important:

The fog is NOT a large smoke effect.

It should only become visible because of the headlights.

Use opacity and blur carefully.

The effect should remain sophisticated and restrained.

---

### 1.70–2.10s — SUBTLE GOLD REFLECTION

Introduce one very subtle gold reflection across part of the automotive body.

This is NOT a golden light explosion.

It is a thin controlled highlight.

The purpose is to connect the automotive scene with the Autoservise gold brand accent.

Use the existing primary gold token.

Do not introduce a new unrelated gold color.

The reflection should disappear/settle quickly.

---

### 2.05–2.35s — BRAND REVEAL

Reveal the Autoservise brand/name using the existing project typography/design system.

Do not generate text inside an image.

The brand must remain HTML/CSS text so it is crisp and controllable.

Animation:

* subtle fade
* very slight upward movement or opacity transition
* no dramatic scaling
* no spinning
* no flashy effects

If the actual product name is already defined in the existing application, use that existing source of truth.

Do not invent a new product name.

---

### 2.25–2.70s — LOGIN UI

Reveal/focus the existing login CTA/form.

The existing login interface must remain functional.

The CTA should feel like the natural continuation of the launch:

**car starts → system becomes active → user enters application**

Do not create a second login screen.

Do not duplicate controls.

Do not change authentication behavior.

---

# VISUAL DESIGN

Use the existing Autoservise design tokens.

Primary atmosphere:

* deep graphite
* deep navy
* warm amber
* subtle gold

The visual hierarchy should be:

1. darkness
2. silhouette
3. headlights
4. subtle gold reflection
5. brand
6. login

Do not use:

* pure white backgrounds
* bright green
* neon blue
* purple cyberpunk effects
* excessive orange
* excessive gold
* glossy UI everywhere
* heavy glassmorphism

The application should remain visually consistent with the existing premium automotive SaaS design.

---

# IMPORTANT RESPONSIVE BEHAVIOR

The launch must work on:

* desktop
* laptop
* tablet
* mobile

On smaller screens:

* do not crop the headlights
* do not allow the automotive visual to cover the login controls
* preserve the brand hierarchy
* reduce visual scale where necessary
* maintain the same cinematic sequence

The login form must remain usable.

---

# PERFORMANCE

This is an application launch screen, not a marketing video.

Do NOT:

* add large video assets
* add heavy image libraries
* add external animation frameworks
* load large binary assets
* block application startup
* make the login screen dependent on network-loaded media

Prefer:

* CSS
* existing SVG
* existing React structure
* CSS transforms
* opacity
* blur
* gradients
* pseudo-elements
* existing Web Audio implementation

Use GPU-friendly properties where appropriate:

* transform
* opacity

Avoid unnecessarily expensive continuous animations.

---

# ACCESSIBILITY

Respect:

`prefers-reduced-motion`

For users who prefer reduced motion:

* skip or dramatically shorten the cinematic animation
* avoid large moving effects
* show the login interface quickly
* do not prevent access to the application

Audio must never be required for login.

The login controls must remain keyboard accessible.

Do not introduce focus traps.

---

# AUDIO

Keep the existing Prompt 45 Web Audio implementation if it works correctly.

Refine it only if necessary.

Desired sound characteristics:

* low
* deep
* short
* restrained
* approximately 0.4–0.6 seconds
* subtle mechanical startup character

Do not use speech.

Do not use music.

Do not use a long cinematic soundtrack.

Do not make audio replay repeatedly during the same launch.

If browser audio restrictions prevent playback, the visual experience must still work perfectly.

---

# SESSION / REPLAY BEHAVIOR

Preserve the Prompt 45 behavior:

The cinematic launch should play approximately once per new browser session, rather than on every internal navigation.

Do not make the launch replay every time the user:

* submits the login form
* receives a validation error
* refreshes an internal application route
* navigates between authenticated pages

Inspect the current implementation and preserve its existing session-level behavior unless there is a clear bug.

---

# CODE QUALITY

Before editing:

1. Inspect the current `AppLaunchScreen`.
2. Inspect the `/login` implementation.
3. Identify existing launch state/timing logic.
4. Identify existing SVG/car silhouette implementation.
5. Identify existing Web Audio implementation.
6. Identify existing design tokens.
7. Identify any existing animation CSS.

Then make the smallest coherent change necessary.

Do not duplicate components.

Do not create parallel launch implementations.

Do not leave dead code from the previous version.

Do not create unused imports.

Keep the component readable.

If timing values are currently scattered, consolidate them into clearly named constants where practical.

Example:

```ts
const LAUNCH_TIMING = {
  silhouetteStart: ...,
  engineStart: ...,
  firstHeadlight: ...,
  secondHeadlight: ...,
  goldReflection: ...,
  brandReveal: ...,
  loginReveal: ...,
}
```

Use the actual architecture of the project rather than blindly copying this example.

---

# DO NOT OVERENGINEER

This is a visual refinement.

Do not turn the task into a major frontend refactor.

Do not redesign the entire login page.

Do not change the sidebar, dashboard, conversations, clients, requests, operations, services or settings.

Only touch code directly related to the launch/login experience.

---

# VALIDATION

After implementation run:

1. TypeScript check
2. Production build
3. Existing test suite

Verify:

* `/login` loads correctly
* launch animation plays
* login remains usable
* login submission still works
* authentication behavior is unchanged
* launch does not replay incorrectly
* no console errors
* no broken imports
* no hydration/runtime issues if applicable
* reduced-motion behavior works
* mobile layout remains usable

If tests already exist for `AppLaunchScreen`, update them only where the intended timing/visual state behavior genuinely changed.

Do not weaken or delete tests just to make them pass.

---

# GIT / SCOPE

Do not modify unrelated files.

At the end provide a concise implementation report containing:

### 1. Files changed

List exact files.

### 2. What changed

Describe the launch visual changes.

### 3. What was preserved

Explicitly confirm authentication and existing `/login` behavior were not changed.

### 4. Validation

Report:

* TypeScript: PASS/FAIL
* Build: PASS/FAIL
* Tests: X/X

### 5. Git

Report the resulting commit hash if a commit was created.

Do not modify unrelated untracked files such as:

* `.mcp.json`
* `marketing/`

unless they are directly required by this task.

---

# SUCCESS CRITERIA

Prompt 46 is successful when opening `/login` feels like this:

**darkness → automotive silhouette → deep startup → warm headlights → subtle fog illumination → thin gold reflection → Autoservise brand → login**

The result should feel:

**premium**
**quiet**
**technological**
**automotive**
**fast**
**confident**

It should NOT feel:

**flashy**
**cyberpunk**
**supercar advertisement**
**game intro**
**generic SaaS animation**

The final experience should communicate one simple idea:

> **Autoservise is starting.**
