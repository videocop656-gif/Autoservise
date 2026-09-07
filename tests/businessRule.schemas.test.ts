import { describe, it, expect } from 'vitest'
import {
  createBusinessRuleSchema,
  updateBusinessRuleSchema,
  businessRuleCategoryFilterSchema,
  businessRuleIdParamSchema,
} from '../src/server/validation/businessRule.schemas'

describe('createBusinessRuleSchema', () => {
  it('accepts a valid payload and defaults category/priority', () => {
    const result = createBusinessRuleSchema.parse({ name: 'Оплата перед выдачей', description: 'Машина выдаётся после оплаты.' })
    expect(result.category).toBe('GENERAL')
    expect(result.priority).toBe(50)
  })

  it('accepts an explicit category and priority', () => {
    const result = createBusinessRuleSchema.parse({
      name: 'Оплата перед выдачей',
      description: 'Машина выдаётся после оплаты.',
      category: 'PAYMENT',
      priority: 10,
    })
    expect(result.category).toBe('PAYMENT')
    expect(result.priority).toBe(10)
  })

  it('rejects a name that is too short', () => {
    expect(() => createBusinessRuleSchema.parse({ name: 'A', description: 'Some description.' })).toThrow()
  })

  it('rejects empty description', () => {
    expect(() => createBusinessRuleSchema.parse({ name: 'Rule name', description: '' })).toThrow()
  })

  it('rejects a negative priority', () => {
    expect(() =>
      createBusinessRuleSchema.parse({ name: 'Rule name', description: 'Description here.', priority: -1 })
    ).toThrow()
  })

  it('rejects a priority over 100', () => {
    expect(() =>
      createBusinessRuleSchema.parse({ name: 'Rule name', description: 'Description here.', priority: 101 })
    ).toThrow()
  })

  it('rejects a fractional priority', () => {
    expect(() =>
      createBusinessRuleSchema.parse({ name: 'Rule name', description: 'Description here.', priority: 10.5 })
    ).toThrow()
  })

  it('accepts boundary priorities 0 and 100', () => {
    expect(() =>
      createBusinessRuleSchema.parse({ name: 'Rule name', description: 'Description here.', priority: 0 })
    ).not.toThrow()
    expect(() =>
      createBusinessRuleSchema.parse({ name: 'Rule name', description: 'Description here.', priority: 100 })
    ).not.toThrow()
  })

  it('rejects an invalid category', () => {
    expect(() =>
      createBusinessRuleSchema.parse({ name: 'Rule name', description: 'Description here.', category: 'NOT_REAL' })
    ).toThrow()
  })
})

describe('updateBusinessRuleSchema', () => {
  it('accepts a partial update', () => {
    expect(() => updateBusinessRuleSchema.parse({ priority: 5 })).not.toThrow()
  })

  it('rejects an empty body', () => {
    expect(() => updateBusinessRuleSchema.parse({})).toThrow()
  })

  it('rejects an invalid priority in a partial update', () => {
    expect(() => updateBusinessRuleSchema.parse({ priority: 200 })).toThrow()
  })
})

describe('businessRuleCategoryFilterSchema', () => {
  it('accepts a valid category', () => {
    expect(() => businessRuleCategoryFilterSchema.parse('PAYMENT')).not.toThrow()
  })

  it('rejects an unknown category', () => {
    expect(() => businessRuleCategoryFilterSchema.parse('UNKNOWN')).toThrow()
  })
})

describe('businessRuleIdParamSchema', () => {
  it('accepts a valid UUID', () => {
    expect(() => businessRuleIdParamSchema.parse('123e4567-e89b-12d3-a456-426614174000')).not.toThrow()
  })

  it('rejects a non-UUID string', () => {
    expect(() => businessRuleIdParamSchema.parse('not-a-uuid')).toThrow()
  })
})
