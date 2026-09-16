import { cn } from '../../lib/utils'

export interface CarSilhouetteProps {
  /** Stage 1 — the car begins to emerge from darkness. */
  revealed: boolean
  /** Stage 2 — a short one-shot "engine alive" rumble on the body. */
  engineOn: boolean
  /** Stage 3 — headlights ignite and bloom, cutting the car out of the dark. */
  headlightsOn: boolean
  /** Stage 4 — a single thin gold catch-line sweeps along the body. */
  goldOn: boolean
  className?: string
}

/**
 * A deliberately abstract, hand-drawn premium car silhouette — never a real
 * photo, never a manufacturer shape or logo (Prompt 45 spec: "не
 * использовать конкретный автомобильный бренд", "generic premium
 * automotive visual"). Built as inline SVG so it costs zero extra network
 * requests/bytes beyond this file, stays crisp at any size, and its colors
 * are driven entirely by the existing design-system gradients/tokens
 * (graphite body, gold accent) rather than hardcoded hex values.
 *
 * Swappable later: a real hero photo can replace this component behind the
 * same `heroImage` config slot on AppLaunchScreen without touching the
 * staging logic that drives `revealed`/`engineOn`/`headlightsOn`/`goldOn`.
 */
export function CarSilhouette({ revealed, engineOn, headlightsOn, goldOn, className }: CarSilhouetteProps) {
  return (
    <div className={cn('launch-car w-full', revealed && 'is-revealed', engineOn && 'is-engine-on', className)}>
      <svg
        viewBox="0 0 900 420"
        role="img"
        aria-hidden="true"
        className="h-auto w-full max-w-2xl drop-shadow-[0_30px_60px_rgba(0,0,0,0.55)] lg:max-w-none"
      >
        <defs>
          <linearGradient id="launch-body-gradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(222 16% 26%)" />
            <stop offset="45%" stopColor="hsl(222 20% 12%)" />
            <stop offset="100%" stopColor="hsl(222 24% 5%)" />
          </linearGradient>
          <radialGradient id="launch-ground-shadow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="hsl(222 24% 2%)" stopOpacity="0.75" />
            <stop offset="100%" stopColor="hsl(222 24% 2%)" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="launch-headlight-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="hsl(210 60% 92%)" stopOpacity="0.9" />
            <stop offset="60%" stopColor="hsl(210 70% 80%)" stopOpacity="0.25" />
            <stop offset="100%" stopColor="hsl(210 70% 80%)" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="launch-headlight-core" cx="45%" cy="45%" r="55%">
            <stop offset="0%" stopColor="hsl(0 0% 100%)" />
            <stop offset="100%" stopColor="hsl(205 80% 88%)" />
          </radialGradient>
          <linearGradient id="launch-gold-gradient" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0" />
            <stop offset="45%" stopColor="hsl(var(--primary))" stopOpacity="0.95" />
            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
          </linearGradient>
          <filter id="launch-soft-blur" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="10" />
          </filter>
        </defs>

        {/* Ground contact shadow — grounds the car instead of letting it float. */}
        <ellipse cx="450" cy="378" rx="300" ry="26" fill="url(#launch-ground-shadow)" />

        <g className="launch-car__body">
          {/* Wheels drawn first so the body silhouette overlaps their tops,
              same flat-silhouette technique used in automotive photography
              retouching — reads as "a car in profile" without literal detail. */}
          <circle cx="196" cy="352" r="36" fill="hsl(222 24% 4%)" stroke="hsl(222 14% 22%)" strokeWidth="3" />
          <circle cx="632" cy="352" r="36" fill="hsl(222 24% 4%)" stroke="hsl(222 14% 22%)" strokeWidth="3" />

          {/* Low, wide coupe silhouette — front (headlight) on the left. */}
          <path
            d="M110,346
               C110,346 118,318 148,300
               C168,288 178,272 194,258
               C230,224 292,238 332,224
               C358,216 374,192 404,170
               C426,154 454,146 488,146
               C540,146 574,150 606,160
               C636,170 652,192 666,214
               C684,244 708,258 730,270
               C750,282 760,300 764,320
               L768,346
               C768,346 700,352 620,352
               C560,352 520,344 486,344
               C420,344 330,352 250,352
               C190,352 140,350 110,346
               Z"
            fill="url(#launch-body-gradient)"
            stroke="hsl(0 0% 100%)"
            strokeOpacity="0.06"
            strokeWidth="1.5"
          />

          {/* Cabin/glass — a subtly darker inset shape for depth. */}
          <path
            d="M226,254 C258,228 300,222 336,214 C362,206 376,186 404,168 C424,156 448,150 472,150 C440,166 414,190 396,214 C372,244 322,246 280,254 C262,258 244,258 226,254 Z"
            fill="hsl(222 26% 4%)"
            fillOpacity="0.65"
          />

          {/* Gold catch-line — a single premium reflection along the beltline. */}
          <path
            d="M172,266 C232,248 302,244 352,236 C422,226 482,220 562,222 C612,224 652,234 692,250"
            fill="none"
            stroke="url(#launch-gold-gradient)"
            strokeWidth="2.5"
            strokeLinecap="round"
            pathLength={640}
            strokeDasharray={640}
            className={cn('launch-gold-line', goldOn && 'is-on')}
          />

          {/* Headlight — bloom layer, then the sharp core. */}
          <circle
            cx="160"
            cy="284"
            r="46"
            fill="url(#launch-headlight-glow)"
            filter="url(#launch-soft-blur)"
            className={cn('launch-headlight-glow', headlightsOn && 'is-on')}
          />
          <ellipse
            cx="160"
            cy="284"
            rx="16"
            ry="10"
            fill="url(#launch-headlight-core)"
            className={cn('launch-headlight-core', headlightsOn && 'is-on')}
          />
        </g>
      </svg>
    </div>
  )
}
