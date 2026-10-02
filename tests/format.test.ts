import { describe, expect, it } from 'vitest'
import { formatDays, formatMoney, pluralRu } from '../src/lib/format'

// Prompt 48.2 — display-only formatters for the Russian UI. Intl's ru-RU
// grouping separator and our symbol separator are no-break spaces, so the
// expectations normalise them to plain spaces for readability.
const plain = (s: string | null) => (s === null ? null : s.replace(/[\u00A0\u202F]/g, ' '))

describe('formatMoney', () => {
  it('groups thousands Russian-style and uses the ₽ sign', () => {
    expect(plain(formatMoney('4800.00', 'RUB'))).toBe('4 800 ₽')
    expect(plain(formatMoney('1250000.00', 'RUB'))).toBe('1 250 000 ₽')
  })

  it('shows kopecks only when they are not zero', () => {
    expect(plain(formatMoney('4800.50', 'RUB'))).toBe('4 800,50 ₽')
    expect(plain(formatMoney('99.99', 'RUB'))).toBe('99,99 ₽')
  })

  it('never lets the amount and the currency sign wrap apart', () => {
    expect(formatMoney('4800.00', 'RUB')).toContain('\u00A0₽')
  })

  it('maps the other supported currencies to their signs and falls back to the code', () => {
    expect(plain(formatMoney('100.00', 'KZT'))).toBe('100 ₸')
    expect(plain(formatMoney('100.00', 'USD'))).toBe('100 $')
    expect(plain(formatMoney('100.00', 'EUR'))).toBe('100 €')
    expect(plain(formatMoney('100.00', 'GBP'))).toBe('100 GBP')
  })

  it('accepts numbers and leaves unparseable input visible instead of printing NaN', () => {
    expect(plain(formatMoney(3000, 'RUB'))).toBe('3 000 ₽')
    expect(plain(formatMoney('abc', 'RUB'))).toBe('abc ₽')
  })
})

describe('pluralRu / formatDays', () => {
  it.each([
    [1, '1 день'],
    [2, '2 дня'],
    [4, '4 дня'],
    [5, '5 дней'],
    [11, '11 дней'],
    [12, '12 дней'],
    [14, '14 дней'],
    [21, '21 день'],
    [22, '22 дня'],
    [25, '25 дней'],
    [101, '101 день'],
    [111, '111 дней'],
    [180, '180 дней'],
    [365, '365 дней'],
  ])('%i → %s', (n, expected) => {
    expect(plain(formatDays(n))).toBe(expected)
  })

  it('uses a no-break space between the number and the word', () => {
    expect(formatDays(180)).toBe('180\u00A0дней')
  })

  it('pluralRu works for any word forms', () => {
    expect(pluralRu(3, ['месяц', 'месяца', 'месяцев'])).toBe('месяца')
  })
})
