import { describe, it, expect } from 'vitest'
import {
  intakeErrorMessage,
  phoneMatchesFrom,
  personName,
  canChangeCustomer,
  identityMismatch,
  vehicleTitle,
} from '../src/components/conversations/intake'

// Prompt 54 — pure helpers behind the "Клиент и автомобиль" section (no
// component-test stack in the project; the section itself is browser-validated).

describe('intakeErrorMessage', () => {
  it('passes through the server’s Russian messages for intake codes', () => {
    expect(intakeErrorMessage('link', 'CUSTOMER_REQUEST_CONFLICT', 'Нельзя изменить клиента: связанное обращение принадлежит другому клиенту.')).toBe(
      'Нельзя изменить клиента: связанное обращение принадлежит другому клиенту.'
    )
    expect(intakeErrorMessage('link', 'CONVERSATION_CHANGED', 'Данные изменились. Обновите диалог и попробуйте ещё раз.')).toBe(
      'Данные изменились. Обновите диалог и попробуйте ещё раз.'
    )
    expect(intakeErrorMessage('create-customer', 'CUSTOMER_PHONE_EXISTS', 'Клиент с таким номером уже существует.')).toBe('Клиент с таким номером уже существует.')
  })

  it('translates the existing English customer/role/validation errors', () => {
    expect(intakeErrorMessage('create-customer', 'CUSTOMER_EMAIL_EXISTS', 'An active customer with this email already exists')).toBe('Клиент с таким email уже существует.')
    expect(intakeErrorMessage('create-vehicle', 'FORBIDDEN', 'You do not have permission')).toBe('Недостаточно прав для этого действия.')
    expect(intakeErrorMessage('create-vehicle', 'VALIDATION_ERROR', 'Invalid request data')).toBe('Проверьте заполненные поля.')
  })

  it('anything else gets the action’s own fallback, never raw text', () => {
    expect(intakeErrorMessage('link', 'INTERNAL_ERROR', 'Prisma P2002 …')).toBe('Не удалось связать клиента.')
    expect(intakeErrorMessage('create-customer', undefined, undefined)).toBe('Не удалось создать клиента.')
    expect(intakeErrorMessage('create-vehicle', undefined, undefined)).toBe('Не удалось добавить автомобиль.')
  })
})

describe('phoneMatchesFrom', () => {
  it('reads the server’s matches and ignores anything malformed', () => {
    const details = { matches: [{ id: 'c1', firstName: 'Алиса', lastName: null, phone: '+7900' }, { nope: true }, null] }
    expect(phoneMatchesFrom(details)).toEqual([{ id: 'c1', firstName: 'Алиса', lastName: null, phone: '+7900' }])
    expect(phoneMatchesFrom(undefined)).toEqual([])
    expect(phoneMatchesFrom({ matches: 'x' })).toEqual([])
  })
})

describe('relink rules', () => {
  it('without a linked request the customer may be changed (with confirmation in the UI)', () => {
    expect(canChangeCustomer({ customerRequestId: null, customerId: 'a' })).toEqual({ allowed: true, reason: null })
  })

  it('with a linked request the customer is fixed by it', () => {
    expect(canChangeCustomer({ customerRequestId: 'r1', customerId: 'a' })).toEqual({
      allowed: false,
      reason: 'Клиент определён связанным обращением — сменить его нельзя.',
    })
  })

  it('a conversation/request customer mismatch (legacy data) is detected, never auto-fixed', () => {
    expect(identityMismatch({ customerRequestId: 'r1', customerId: 'a', requestCustomerId: 'b' })).toBe(true)
    expect(identityMismatch({ customerRequestId: 'r1', customerId: 'a', requestCustomerId: 'a' })).toBe(false)
    expect(identityMismatch({ customerRequestId: null, customerId: 'a', requestCustomerId: null })).toBe(false)
  })
})

describe('labels', () => {
  it('person and vehicle titles', () => {
    expect(personName({ firstName: 'Алексей', lastName: 'Смирнов' })).toBe('Алексей Смирнов')
    expect(personName({ firstName: 'Алексей', lastName: null })).toBe('Алексей')
    expect(vehicleTitle({ make: 'Toyota', model: 'Camry', year: 2021 })).toBe('Toyota Camry · 2021')
    expect(vehicleTitle({ make: 'Kia', model: 'Rio', year: null })).toBe('Kia Rio')
  })
})
