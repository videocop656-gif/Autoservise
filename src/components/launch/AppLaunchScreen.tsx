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
  /** Total scene duration in ms, end to end. Every stage's timing scales proportionally. Default 2700ms. */
  animationDuration?: number
}

/**
 * Reference timeline (Prompt 46 §"TARGET EXPERIENCE"): the moment, in ms,
 * at which each stage begins when the scene runs at its default duration.
 * The login stage's own ~450ms transition completes the scene at
 * DEFAULT_ANIMATION_DURATION. A custom `animationDuration` scales every
 * stage proportionally rather than only stretching the last one.
 */
const LAUNCH_TIMING = {
  silhouette: 350,
  engineStart: 800,
  firstHeadlight: 1050,
  secondHeadlight: 1300,
  haze: 1450,
  goldReflection: 1700,
  brand: 2050,
  login: 2250,
} as const

const DEFAULT_ANIMATION_DURATION = 2700

type StageKey = keyof typeof LAUNCH_TIMING
type StageState = Record<StageKey, boolean>

const STAGE_KEYS = Object.keys(LAUNCH_TIMING) as StageKey[]

function allStages(reached: boolean): StageState {
  return Object.fromEntries(STAGE_KEYS.map((key) => [key, reached])) as StageState
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * The product's cinematic first-run moment (Prompts 45–46): darkness → a car
 * emerges → the engine starts → headlights power on one after the other →
 * their light reveals a faint haze → one thin gold reflection → brand →
 * login CTA. "Autoservise is starting." Purely a presentational/staging
 * component — it owns no auth/routing logic; the caller decides when to
 * render it and what `ctaAction` does (see LoginPage, which gates it on a
 * per-session flag and uses the CTA to reveal the real login form).
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
  const [reached, setReached] = useState<StageState>(() => allStages(reducedMotion))
  const { muted, toggleMuted, play } = useEngineSound({ src: engineSound })
  const timerIdsRef = useRef<number[]>([])
  const ctaButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (reducedMotion) return // Static final frame already rendered — no timers, no sound.

    for (const key of STAGE_KEYS) {
      const delay = (LAUNCH_TIMING[key] / DEFAULT_ANIMATION_DURATION) * animationDuration
      const id = window.setTimeout(() => {
        setReached((prev) => ({ ...prev, [key]: true }))
        if (key === 'engineStart') {
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
    if (reached.login) {
      ctaButtonRef.current?.focus()
    }
  }, [reached.login])

  function skipToEnd() {
    timerIdsRef.current.forEach((id) => window.clearTimeout(id))
    timerIdsRef.current = []
    setReached(allStages(true))
  }

  return (
    <div
      className="launch-scene relative flex min-h-screen w-full flex-col justify-center overflow-hidden bg-background lg:flex-row"
      onClick={(event) => {
        if ((event.target as HTMLElement).closest('[data-launch-sound-toggle]')) return
        if (!reached.login) skipToEnd()
      }}
    >
      {/* Stage 0 — deep graphite/navy darkness, always present. */}
      <div aria-hidden="true" className="launch-atmosphere pointer-events-none absolute inset-0" />

      <button
        type="button"
        data-launch-sound-toggle
        onClick={(event) => {
          event.stopPropagation()
          toggleMuted()
        }}
        aria-label={muted ? 'Включить звук' : 'Выключить звук'}
        aria-pressed={!muted}
        className="absolute right-4 top-4 z-20 flex h-9 w-9 items-center justify-center rounded-full border border-border/60 bg-card/60 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {muted ? <VolumeX className="h-4 w-4" aria-hidden="true" /> : <Volume2 className="h-4 w-4" aria-hidden="true" />}
      </button>

      <div className="relative z-10 flex flex-col justify-center gap-8 px-6 pb-14 pt-2 sm:px-12 lg:w-1/2 lg:flex-1 lg:px-16 lg:py-16">
        <div className={cn('launch-brand max-w-md', reached.brand && 'is-visible')}>
          <p className="text-xs font-medium uppercase tracking-[0.35em] text-primary/80">AI-администратор</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">{brandName}</h1>
          {brandTagline && <p className="mt-4 text-base text-muted-foreground">{brandTagline}</p>}
        </div>

        <div className={cn('launch-cta', reached.login && 'is-visible')}>
          <Button ref={ctaButtonRef} size="lg" className="px-8" onClick={ctaAction}>
            {ctaLabel}
          </Button>
        </div>
      </div>

      {/* The car leads on narrow screens (darkness → car → brand → CTA,
          top to bottom) and sits to the right on wide ones. It is its own
          flex item, so it can never overlap the CTA. */}
      <div className="relative z-10 order-first flex items-center justify-center px-4 pb-2 pt-14 sm:px-10 lg:order-none lg:w-1/2 lg:flex-1 lg:py-0 lg:pl-4 lg:pr-16">
        {heroImage ? (
          <img
            src={heroImage}
            alt=""
            aria-hidden="true"
            className={cn('launch-car w-full max-w-xl lg:max-w-none', reached.silhouette && 'is-revealed')}
          />
        ) : (
          <CarSilhouette
            className="max-w-xl lg:max-w-none"
            revealed={reached.silhouette}
            engineOn={reached.engineStart}
            firstLightOn={reached.firstHeadlight}
            secondLightOn={reached.secondHeadlight}
            hazeOn={reached.haze}
            goldOn={reached.goldReflection}
          />
        )}
      </div>
    </div>
  )
}
