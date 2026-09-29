import { cn } from '../../lib/utils'

export interface CarSilhouetteProps {
  /** The car begins to emerge from darkness. */
  revealed: boolean
  /** A short one-shot "engine alive" settle on the body, in sync with the sound. */
  engineOn: boolean
  /** The near headlight powers on. */
  firstLightOn: boolean
  /** The far headlight powers on a beat later — a tiny, believable stagger. */
  secondLightOn: boolean
  /** The headlights reveal a faint haze in front of the car. */
  hazeOn: boolean
  /** A single thin gold reflection travels along the shoulder line, then settles. */
  goldOn: boolean
  className?: string
}

/**
 * A deliberately abstract premium car seen from a ~22° 3/4-front angle —
 * never a real photo, never a manufacturer shape, grille pattern or emblem
 * (Prompt 45/46: a visual metaphor for "the system has started", not a car
 * advert). Inline SVG: zero network requests, crisp at any size.
 *
 * Colors: the body stays dark graphite/navy; the gold reflection uses the
 * existing --primary token; the warm headlight temperature comes from the
 * scoped --launch-headlight* properties in launchScreen.css.
 *
 * Every light/haze/reflection layer is drawn inside the viewBox with
 * gradients that fade to zero before its edge, so nothing gets clipped
 * when the SVG scales down on small screens.
 */
export function CarSilhouette({
  revealed,
  engineOn,
  firstLightOn,
  secondLightOn,
  hazeOn,
  goldOn,
  className,
}: CarSilhouetteProps) {
  return (
    <div className={cn('launch-car w-full', revealed && 'is-revealed', engineOn && 'is-engine-on', className)}>
      <svg viewBox="30 110 800 310" role="img" aria-hidden="true" className="h-auto w-full">
        <defs>
          <linearGradient id="launch-body-gradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style={{ stopColor: 'hsl(var(--muted))' }} />
            <stop offset="40%" style={{ stopColor: 'hsl(var(--card))' }} />
            <stop offset="100%" style={{ stopColor: 'hsl(var(--background))' }} />
          </linearGradient>
          <linearGradient id="launch-side-gradient" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" style={{ stopColor: 'hsl(var(--card))' }} stopOpacity="0" />
            <stop offset="100%" style={{ stopColor: 'hsl(var(--background))' }} stopOpacity="0.7" />
          </linearGradient>
          <radialGradient id="launch-ground-shadow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" style={{ stopColor: 'hsl(var(--background))' }} stopOpacity="0.95" />
            <stop offset="100%" style={{ stopColor: 'hsl(var(--background))' }} stopOpacity="0" />
          </radialGradient>
          <radialGradient id="launch-headlight-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" style={{ stopColor: 'hsl(var(--launch-headlight-core))' }} stopOpacity="0.9" />
            <stop offset="45%" style={{ stopColor: 'hsl(var(--launch-headlight))' }} stopOpacity="0.35" />
            <stop offset="100%" style={{ stopColor: 'hsl(var(--launch-headlight))' }} stopOpacity="0" />
          </radialGradient>
          <radialGradient id="launch-haze-gradient" cx="50%" cy="50%" r="50%">
            <stop offset="0%" style={{ stopColor: 'hsl(var(--launch-headlight))' }} stopOpacity="0.28" />
            <stop offset="55%" style={{ stopColor: 'hsl(var(--launch-headlight))' }} stopOpacity="0.08" />
            <stop offset="100%" style={{ stopColor: 'hsl(var(--launch-headlight))' }} stopOpacity="0" />
          </radialGradient>
          <linearGradient id="launch-gold-gradient" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" style={{ stopColor: 'hsl(var(--primary))' }} stopOpacity="0" />
            <stop offset="40%" style={{ stopColor: 'hsl(var(--primary))' }} stopOpacity="0.9" />
            <stop offset="100%" style={{ stopColor: 'hsl(var(--primary))' }} stopOpacity="0" />
          </linearGradient>
          <filter id="launch-soft-blur" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="10" />
          </filter>
          <filter id="launch-haze-blur" x="-30%" y="-60%" width="160%" height="220%">
            <feGaussianBlur stdDeviation="18" />
          </filter>
        </defs>

        {/* Atmospheric haze — invisible in the dark, only "lit" once the
            headlights are on. Beams fall toward the viewer's lower left. */}
        <g filter="url(#launch-haze-blur)" className={cn('launch-haze', hazeOn && 'is-on')}>
          <ellipse cx="300" cy="338" rx="250" ry="60" fill="url(#launch-haze-gradient)" />
          <ellipse cx="180" cy="324" rx="140" ry="42" fill="url(#launch-haze-gradient)" />
        </g>

        {/* Ground contact shadow. */}
        <ellipse cx="480" cy="390" rx="360" ry="22" fill="url(#launch-ground-shadow)" />

        {/* Warm light pooling on the ground under each headlight. */}
        <ellipse
          cx="400"
          cy="394"
          rx="120"
          ry="8"
          fill="url(#launch-headlight-glow)"
          className={cn('launch-light-pool', firstLightOn && 'is-on')}
        />
        <ellipse
          cx="192"
          cy="386"
          rx="70"
          ry="6"
          fill="url(#launch-headlight-glow)"
          className={cn('launch-light-pool', secondLightOn && 'is-on')}
        />

        <g className="launch-car__body">
          {/* Wheels first so the body overlaps their tops. The far front
              wheel is barely visible under the bumper; the near side shows
              both wheels foreshortened into ellipses. */}
          <ellipse cx="210" cy="364" rx="20" ry="22" style={{ fill: 'hsl(var(--background))' }} />
          <ellipse cx="570" cy="350" rx="32" ry="42" style={{ fill: 'hsl(var(--background))', stroke: 'hsl(var(--border))' }} strokeWidth="2" />
          <ellipse cx="748" cy="342" rx="26" ry="38" style={{ fill: 'hsl(var(--background))', stroke: 'hsl(var(--border))' }} strokeWidth="2" />

          {/* Body silhouette: front fascia on the left, near side receding right. */}
          <path
            d="M152,352
               L148,300
               C146,282 148,272 158,266
               C190,250 230,232 262,222
               C290,200 324,178 360,166
               C450,150 580,148 650,152
               C720,158 770,200 800,238
               C808,268 806,304 798,336
               L782,342
               C778,318 766,300 748,300
               C730,300 716,318 714,344
               L612,356
               C610,328 594,304 570,304
               C546,304 530,328 528,360
               L486,372
               C400,370 260,364 152,352
               Z"
            fill="url(#launch-body-gradient)"
            style={{ stroke: 'hsl(var(--foreground))' }}
            strokeOpacity="0.07"
            strokeWidth="1.5"
          />

          {/* Near side panel, a touch darker than the front — reads as a
              turned corner, which is what sells the 3/4 perspective. */}
          <path
            d="M486,272 C600,258 700,250 802,246 C807,276 805,306 798,336 L782,342 C778,318 766,300 748,300 C730,300 716,318 714,344 L612,356 C610,328 594,304 570,304 C546,304 530,328 528,360 L486,372 C492,340 492,300 486,272 Z"
            fill="url(#launch-side-gradient)"
          />

          {/* Glass: windshield + side window. */}
          <path d="M262,222 L360,168 C450,158 560,156 648,164 L566,214 C470,214 360,218 262,222 Z" style={{ fill: 'hsl(var(--background))' }} fillOpacity="0.8" />
          <path d="M578,214 L652,168 C704,170 744,188 774,218 C704,216 640,214 578,214 Z" style={{ fill: 'hsl(var(--background))' }} fillOpacity="0.8" />

          {/* Panel lines: hood leading edge, near fender, near corner
              crease, side character line. Barely-there, like edges
              catching ambient light. */}
          <g fill="none" style={{ stroke: 'hsl(var(--foreground))' }} strokeOpacity="0.08" strokeWidth="1.5" strokeLinecap="round">
            <path d="M158,266 C260,260 400,262 486,272" />
            <path d="M486,272 C520,246 546,226 566,214" />
            <path d="M486,272 C492,300 492,340 486,372" />
            <path d="M500,316 C600,308 700,302 796,298" />
          </g>

          {/* Lower intake — a plain dark shape, intentionally no emblem. */}
          <path d="M262,312 C310,308 370,310 420,316 L416,344 C366,340 310,338 266,340 Z" style={{ fill: 'hsl(var(--background))' }} fillOpacity="0.85" />

          {/* Headlight housings — visible (unlit) as soon as the car emerges. */}
          <path d="M398,278 C432,278 462,280 482,284 L480,294 C454,292 426,290 400,290 Z" style={{ fill: 'hsl(var(--background))', stroke: 'hsl(var(--foreground))' }} strokeOpacity="0.1" />
          <path d="M164,274 C188,272 212,272 232,274 L230,283 C210,283 188,283 166,285 Z" style={{ fill: 'hsl(var(--background))', stroke: 'hsl(var(--foreground))' }} strokeOpacity="0.1" />

          {/* Gold reflection — one thin highlight along the near shoulder. */}
          <path
            d="M500,270 C600,257 700,250 796,247"
            fill="none"
            stroke="url(#launch-gold-gradient)"
            strokeWidth="2"
            strokeLinecap="round"
            pathLength={640}
            strokeDasharray={640}
            className={cn('launch-gold-line', goldOn && 'is-on')}
          />

          {/* Near headlight: bloom, then the lit element itself. */}
          <ellipse
            cx="440"
            cy="286"
            rx="70"
            ry="34"
            fill="url(#launch-headlight-glow)"
            filter="url(#launch-soft-blur)"
            className={cn('launch-headlight', firstLightOn && 'is-on')}
          />
          <path
            d="M402,282 C432,282 458,284 476,287 L475,291 C452,289 428,288 404,287 Z"
            style={{ fill: 'hsl(var(--launch-headlight-core))' }}
            className={cn('launch-headlight', firstLightOn && 'is-on')}
          />

          {/* Far headlight: smaller, dimmer by perspective. */}
          <ellipse
            cx="197"
            cy="278"
            rx="46"
            ry="24"
            fill="url(#launch-headlight-glow)"
            filter="url(#launch-soft-blur)"
            className={cn('launch-headlight', secondLightOn && 'is-on')}
          />
          <path
            d="M168,277 C190,276 210,276 227,277 L226,281 C208,281 190,281 169,282 Z"
            style={{ fill: 'hsl(var(--launch-headlight-core))' }}
            className={cn('launch-headlight', secondLightOn && 'is-on')}
          />
        </g>
      </svg>
    </div>
  )
}
