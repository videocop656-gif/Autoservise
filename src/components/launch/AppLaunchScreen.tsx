import { useEffect, useMemo, useRef, useState } from 'react'
import { Volume2, VolumeX } from 'lucide-react'
import { Button } from '../ui/button'
import { cn } from '../../lib/utils'
import { CarSilhouette } from './CarSilhouette'
import { useEngineSound } from './useEngineSound'
import './launchScreen.css'

/**
 * Everything about the scene that should be replaceable later (final brand
 * name, a real hero photo, a real engine-start recording, different copy)
 * without touching the staging/animation logic itself (Prompt 45 spec
 * §"Конфигурируемые параметры").
 */
export interface AppLaunchScreenConfig {
  brandName: string
  brandTagline?: string
  /** A real hero photo URL. Omit to use the built-in generic car silhouette. */
  heroImage?: string
  /** A real audio file URL. Omit to use the built-in synthesized engine-start sound. */
  engineSound?: string
  ctaLabel: string
  ctaAction: () => void
  /** Total scene duration in ms, end to end. Every stage's timing scales proportionally. Default 2300ms. */
  animationDuration?: number
}

const DEFAULT_ANIMATION_DURATION = 2300

// Fractions of animationDuration at which each stage begins, derived from
// the spec's own 0–2.3s reference timeline (§"Предлагаемый timing") so a
// shorter/longer animationDuration scales every stage proportionally
// instead of only stretching the last one.
const STAGE_FRACTIONS = {
  reveal: 300 / DEFAULT_ANIMATION_DURATION,
  engineSound: 550 / DEFAULT_ANIMATION_DURATION,
  engineAlive: 850 / DEFAULT_ANIMATION_DURATION,
  headlights: 1100 / DEFAULT_ANIMATION_DURATION,
  gold: 1450 / DEFAULT_ANIMATION_DURATION,
  brand: 1700 / DEFAULT_ANIMATION_DURATION,
  cta: 2100 / DEFAULT_ANIMATION_DURATION,
} as const

type StageKey = keyof typeof STAGE_FRACTIONS

const ALL_STAGES_REACHED: Record<StageKey, boolean> = {
  reveal: true,
  engineSound: true,
  engineAlive: true,
  headlights: true,
  gold: true,
  brand: true,
  cta: true,
}

const NO_STAGES_REACHED: Record<StageKey, boolean> = {
  reveal: false,
  engineSound: false,
  engineAlive: false,
  headlights: false,
  gold: false,
  brand: false,
  cta: false,
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * The product's cinematic first-run moment (Prompt 45): darkness → a car
 * emerges → the engine starts → headlights cut it out of the dark → a thin
 * gold accent → brand → CTA. Purely a presentational/staging component —
 * it owns no auth/routing logic; the caller decides when to render it and
 * what `ctaAction` does (see LoginPage, which gates it on a per-session
 * flag and uses the CTA to reveal the real login form).
 */
export function AppLaunchScreen({
  brandName,
  brandTagline,
  heroImage,
  engineSound,
  ctaLabel,
  ctaAction,
  animationDuration = DEFAULT_ANIMATION_DURATION,
}: AppLaunchScreenConfig) {
  const reducedMotion = useMemo(prefersReducedMotion, [])
  const [reached, setReached] = useState<Record<StageKey, boolean>>(
    reducedMotion ? ALL_STAGES_REACHED : NO_STAGES_REACHED
  )
  const { muted, toggleMuted, play } = useEngineSound({ src: engineSound })
  const timerIdsRef = useRef<number[]>([])
  const ctaButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (reducedMotion) return // Static final frame already rendered — no timers, no sound.

    const stageOrder: StageKey[] = ['reveal', 'engineSound', 'engineAlive', 'headlights', 'gold', 'brand', 'cta']
    for (const key of stageOrder) {
      const delay = STAGE_FRACTIONS[key] * animationDuration
      const id = window.setTimeout(() => {
        setReached((prev) => ({ ...prev, [key]: true }))
        if (key === 'engineSound') {
          // Never awaited/blocking — if the browser blocks autoplay this
          // silently no-ops and the visual timeline is entirely unaffected.
          play()
        }
      }, delay)
      timerIdsRef.current.push(id)
    }

    return () => {
      timerIdsRef.current.forEach((id) => window.clearTimeout(id))
      timerIdsRef.current = []
    }
    // `play` is intentionally not a dependency here: the schedule must be
    // built exactly once per mount, never re-armed on every render.
  }, [reducedMotion, animationDuration])

  useEffect(() => {
    if (reached.cta) {
      ctaButtonRef.current?.focus()
    }
  }, [reached.cta])

  function skipToEnd() {
    timerIdsRef.current.forEach((id) => window.clearTimeout(id))
    timerIdsRef.current = []
    setReached(ALL_STAGES_REACHED)
  }

  return (
    <div
      className="relative flex min-h-screen w-full flex-col overflow-hidden bg-background lg:flex-row"
      onClick={(event) => {
        if ((event.target as HTMLElement).closest('[data-launch-sound-toggle]')) return
        if (!reached.cta) skipToEnd()
      }}
    >
      {/* Stage 0 — near-total darkness, with just enough graphite gradient
          that the screen never reads as an empty black rectangle. Always
          present, independent of stage. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_35%,hsl(222_20%_10%)_0%,hsl(var(--background))_72%)]"
      />

      <button
        type="button"
        data-launch-sound-toggle
        onClick={(event) => {
          event.stopPropagation()
          toggleMuted()
        }}
        aria-label={muted ? 'Включить звук' : 'Выключить звук'}
        aria-pressed={!muted}
        className="absolute right-4 top-4 z-20 flex h-9 w-9 items-center justify-center rounded-full border border-border/60 bg-card/60 text-muted-foreground backdrop-blur transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {muted ? <VolumeX className="h-4 w-4" aria-hidden="true" /> : <Volume2 className="h-4 w-4" aria-hidden="true" />}
      </button>

      <div className="relative z-10 flex flex-1 flex-col justify-center gap-8 px-6 py-16 sm:px-12 lg:w-1/2 lg:px-16">
        <div className={cn('launch-brand max-w-md', reached.brand && 'is-visible')}>
          <p className="text-xs font-medium uppercase tracking-[0.35em] text-primary/80">AI-администратор</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">{brandName}</h1>
          {brandTagline && <p className="mt-4 text-base text-muted-foreground">{brandTagline}</p>}
        </div>

        <div className={cn('launch-cta', reached.cta && 'is-visible')}>
          <Button ref={ctaButtonRef} size="lg" className="px-8" onClick={ctaAction}>
            {ctaLabel}
          </Button>
        </div>
      </div>

      <div className="relative z-10 flex flex-1 items-center justify-center px-6 pb-12 pt-4 lg:w-1/2 lg:scale-110 lg:px-4 lg:py-0">
        {heroImage ? (
          <img
            src={heroImage}
            alt=""
            aria-hidden="true"
            className={cn('launch-car w-full max-w-2xl lg:max-w-none', reached.reveal && 'is-revealed')}
          />
        ) : (
          <CarSilhouette
            revealed={reached.reveal}
            engineOn={reached.engineAlive}
            headlightsOn={reached.headlights}
            goldOn={reached.gold}
          />
        )}
      </div>
    </div>
  )
}
