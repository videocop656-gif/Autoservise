import { useCallback, useEffect, useRef, useState } from 'react'

type WindowWithWebkitAudio = typeof window & { webkitAudioContext?: typeof AudioContext }

export interface UseEngineSoundOptions {
  /**
   * Optional URL to a real audio file (the `engineSound` config slot on
   * AppLaunchScreen). When omitted, a short "premium engine start" sound is
   * synthesized at runtime via the Web Audio API — this ships with zero
   * bytes of audio asset and has no licensing/copyright surface at all,
   * while still being trivially replaceable later by passing a real file.
   */
  src?: string
}

export interface UseEngineSoundResult {
  muted: boolean
  toggleMuted: () => void
  /** Fire-and-forget: never throws, never rejects visibly, safe to call
   *  whether or not the browser's autoplay policy allows it. */
  play: () => void
}

function getAudioContextCtor(): typeof AudioContext | undefined {
  if (typeof window === 'undefined') return undefined
  return window.AudioContext ?? (window as WindowWithWebkitAudio).webkitAudioContext
}

/**
 * Synthesizes a short, deep, premium engine-start sound: a low sine sweep
 * (the "starter" turning over) layered with a filtered triangle wave for
 * texture, both routed through a low-pass filter so the result stays
 * muffled/premium rather than buzzy — deliberately never a loud/racing
 * engine roar (Prompt 45 spec). Total duration ~0.55s.
 */
function playSynthesizedEngineStart(ctx: AudioContext): void {
  const now = ctx.currentTime
  const duration = 0.55

  const master = ctx.createGain()
  master.gain.setValueAtTime(0.0001, now)
  master.gain.linearRampToValueAtTime(0.5, now + 0.04)
  master.gain.exponentialRampToValueAtTime(0.0001, now + duration)
  master.connect(ctx.destination)

  const lowpass = ctx.createBiquadFilter()
  lowpass.type = 'lowpass'
  lowpass.frequency.value = 420
  lowpass.connect(master)

  const rumble = ctx.createOscillator()
  rumble.type = 'sine'
  rumble.frequency.setValueAtTime(42, now)
  rumble.frequency.exponentialRampToValueAtTime(88, now + 0.28)
  rumble.frequency.exponentialRampToValueAtTime(58, now + duration)
  rumble.connect(lowpass)

  const texture = ctx.createOscillator()
  texture.type = 'triangle'
  texture.frequency.setValueAtTime(84, now)
  texture.frequency.exponentialRampToValueAtTime(150, now + 0.28)
  const textureGain = ctx.createGain()
  textureGain.gain.value = 0.35
  texture.connect(textureGain)
  textureGain.connect(lowpass)

  rumble.start(now)
  texture.start(now)
  rumble.stop(now + duration)
  texture.stop(now + duration)
}

export function useEngineSound({ src }: UseEngineSoundOptions = {}): UseEngineSoundResult {
  const [muted, setMuted] = useState(false)
  // Mirrors `muted`, but updated synchronously (not via a state-sync effect)
  // so a scheduled play() call always sees the latest mute preference even
  // if it was toggled a moment earlier in the same tick — a plain `muted`
  // closure captured once when the stage timers are scheduled would
  // otherwise go stale for the lifetime of that schedule.
  const mutedRef = useRef(false)
  const audioContextRef = useRef<AudioContext | null>(null)
  const audioElementRef = useRef<HTMLAudioElement | null>(null)
  const hasPlayedRef = useRef(false)

  const playInternal = useCallback((bypassMuteCheck: boolean) => {
    if (hasPlayedRef.current) return // a one-shot sonic logo — never repeats.
    if (mutedRef.current && !bypassMuteCheck) return

    if (src) {
      const audio = audioElementRef.current ?? new Audio(src)
      audioElementRef.current = audio
      audio.volume = 0.5
      audio
        .play()
        .then(() => {
          hasPlayedRef.current = true
        })
        .catch(() => {
          // Autoplay blocked (or the file failed to load) — the visual
          // timeline never depends on this, so there is nothing else to do.
        })
      return
    }

    const Ctor = getAudioContextCtor()
    if (!Ctor) return
    if (!audioContextRef.current) {
      audioContextRef.current = new Ctor()
    }
    const ctx = audioContextRef.current
    ctx
      .resume()
      .then(() => {
        if (ctx.state !== 'running') return
        playSynthesizedEngineStart(ctx)
        hasPlayedRef.current = true
      })
      .catch(() => {
        // Autoplay/gesture policy blocked resume() — visuals proceed alone.
      })
  }, [src])

  const play = useCallback(() => playInternal(false), [playInternal])

  const toggleMuted = useCallback(() => {
    if (!hasPlayedRef.current) {
      // Nothing has actually played yet — almost always because the
      // browser's autoplay policy silently blocked the automatic attempt.
      // This click is a real user gesture, so use it to unlock and play
      // right now (spec §"ВАЖНО: autoplay" — "включить звук после первого
      // взаимодействия пользователя") rather than literally toggling an
      // "on" state to "off" the first time the button is ever pressed.
      mutedRef.current = false
      setMuted(false)
      playInternal(true)
      return
    }
    setMuted((prevMuted) => {
      const nextMuted = !prevMuted
      mutedRef.current = nextMuted
      return nextMuted
    })
  }, [playInternal])

  useEffect(() => {
    return () => {
      audioContextRef.current?.close().catch(() => {})
      audioElementRef.current?.pause()
    }
  }, [])

  return { muted, toggleMuted, play }
}
