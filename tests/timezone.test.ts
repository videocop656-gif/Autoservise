import { describe, it, expect } from 'vitest'
import { isValidTimeZone, toBusinessLocalDateTime } from '../src/server/lib/timezone'

describe('isValidTimeZone', () => {
  it('accepts a real IANA identifier', () => {
    expect(isValidTimeZone('Europe/Moscow')).toBe(true)
  })

  it('rejects a free-form string', () => {
    expect(isValidTimeZone('GMT+5')).toBe(false)
  })
})

describe('toBusinessLocalDateTime', () => {
  it('converts UTC to a fixed-offset zone (Europe/Moscow, UTC+3, no DST)', () => {
    const result = toBusinessLocalDateTime(new Date('2026-06-15T10:00:00Z'), 'Europe/Moscow')
    expect(result.timeKey).toBe('13:00')
    expect(result.dateKey).toBe('2026-06-15')
  })

  it('converts UTC to America/New_York in winter (EST, UTC-5)', () => {
    const result = toBusinessLocalDateTime(new Date('2026-01-15T14:00:00Z'), 'America/New_York')
    expect(result.timeKey).toBe('09:00')
    expect(result.dateKey).toBe('2026-01-15')
  })

  it('converts UTC to America/New_York in summer (EDT, UTC-4) — DST applied', () => {
    const result = toBusinessLocalDateTime(new Date('2026-07-15T14:00:00Z'), 'America/New_York')
    expect(result.timeKey).toBe('10:00')
    expect(result.dateKey).toBe('2026-07-15')
  })

  it('the same UTC instant maps to a different local hour across the DST boundary — proves this is timezone-aware, not fixed-offset arithmetic', () => {
    const winter = toBusinessLocalDateTime(new Date('2026-01-15T14:00:00Z'), 'America/New_York')
    const summer = toBusinessLocalDateTime(new Date('2026-07-15T14:00:00Z'), 'America/New_York')
    expect(winter.timeKey).not.toBe(summer.timeKey)
  })

  it('re-checking the same appointment instant after a hypothetical Business timezone change yields a different local time', () => {
    const instant = new Date('2026-06-15T12:00:00Z')
    const inMoscow = toBusinessLocalDateTime(instant, 'Europe/Moscow')
    const inAlmaty = toBusinessLocalDateTime(instant, 'Asia/Almaty')
    expect(inMoscow.timeKey).not.toBe(inAlmaty.timeKey)
  })

  it('handles midnight correctly (no stray "24:00")', () => {
    const result = toBusinessLocalDateTime(new Date('2026-06-15T00:00:00Z'), 'UTC')
    expect(result.timeKey).toBe('00:00')
  })

  it('detects a local-midnight crossing via differing dateKey', () => {
    const start = toBusinessLocalDateTime(new Date('2026-06-15T21:30:00Z'), 'Europe/Berlin') // 23:30 local, same day
    const end = toBusinessLocalDateTime(new Date('2026-06-15T22:30:00Z'), 'Europe/Berlin') // 00:30 local, next day
    expect(start.dateKey).toBe('2026-06-15')
    expect(end.dateKey).toBe('2026-06-16')
  })

  it('maps the weekday correctly', () => {
    // 2026-09-07 is a Monday.
    const result = toBusinessLocalDateTime(new Date('2026-09-07T12:00:00Z'), 'UTC')
    expect(result.dayOfWeek).toBe('MONDAY')
  })

  it('timeKey is directly comparable as a string against HH:mm openTime/closeTime', () => {
    const result = toBusinessLocalDateTime(new Date('2026-09-07T05:00:00Z'), 'UTC')
    expect(result.timeKey >= '09:00').toBe(false)
    expect(result.timeKey < '09:00').toBe(true)
  })
})
