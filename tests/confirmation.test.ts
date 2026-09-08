import { describe, it, expect } from 'vitest'
import { isExplicitConfirmation } from '../src/server/ai/confirmation'

describe('isExplicitConfirmation', () => {
  it.each([
    'Да, записывайте',
    'Да, записывайте на 10:00.',
    'Да, это подходит',
    'Да, на 10:00',
    'Подтверждаю',
    'подтверждаю запись',
    'Да',
    'да.',
    'yes',
    'Confirm',
    'ok',
    'okay, go ahead',
    'that works',
    'sounds good',
    'book it',
  ])('treats %j as an explicit confirmation', (message) => {
    expect(isExplicitConfirmation(message)).toBe(true)
  })

  it.each([
    'А можно на 10:00?',
    'Есть ли свободное время завтра?',
    'Хочу записаться',
    'можно?',
    'Давайте запишемся', // starts with "Да" but is a different word — must not false-positive
    'Дальше что?',
    'Я не смогу прийти.',
    '',
    '   ',
    'Перенесите мою запись на завтра.',
  ])('does NOT treat %j as a confirmation', (message) => {
    expect(isExplicitConfirmation(message)).toBe(false)
  })
})
