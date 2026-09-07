import { describe, it, expect } from 'vitest'
import {
  createKnowledgeItemSchema,
  updateKnowledgeItemSchema,
  knowledgeCategoryFilterSchema,
  knowledgeIdParamSchema,
} from '../src/server/validation/knowledge.schemas'

describe('createKnowledgeItemSchema', () => {
  it('accepts a valid payload and defaults category to GENERAL', () => {
    const result = createKnowledgeItemSchema.parse({ title: 'Оплата', content: 'Принимаем карты и наличные.' })
    expect(result.category).toBe('GENERAL')
  })

  it('accepts an explicit category', () => {
    const result = createKnowledgeItemSchema.parse({ title: 'Оплата', content: 'Принимаем карты.', category: 'PAYMENT' })
    expect(result.category).toBe('PAYMENT')
  })

  it('rejects a title that is too short', () => {
    expect(() => createKnowledgeItemSchema.parse({ title: 'A', content: 'Some content here.' })).toThrow()
  })

  it('rejects empty content', () => {
    expect(() => createKnowledgeItemSchema.parse({ title: 'Title', content: '' })).toThrow()
  })

  it('rejects content over the max length', () => {
    expect(() => createKnowledgeItemSchema.parse({ title: 'Title', content: 'a'.repeat(10001) })).toThrow()
  })

  it('rejects an invalid category', () => {
    expect(() => createKnowledgeItemSchema.parse({ title: 'Title', content: 'Content here.', category: 'NOT_REAL' })).toThrow()
  })

  it('rejects a missing title', () => {
    expect(() => createKnowledgeItemSchema.parse({ content: 'Content here.' })).toThrow()
  })
})

describe('updateKnowledgeItemSchema', () => {
  it('accepts a partial update', () => {
    expect(() => updateKnowledgeItemSchema.parse({ isActive: false })).not.toThrow()
  })

  it('rejects an empty body', () => {
    expect(() => updateKnowledgeItemSchema.parse({})).toThrow()
  })
})

describe('knowledgeCategoryFilterSchema', () => {
  it('accepts a valid category', () => {
    expect(() => knowledgeCategoryFilterSchema.parse('FAQ')).not.toThrow()
  })

  it('rejects an unknown category', () => {
    expect(() => knowledgeCategoryFilterSchema.parse('UNKNOWN')).toThrow()
  })
})

describe('knowledgeIdParamSchema', () => {
  it('accepts a valid UUID', () => {
    expect(() => knowledgeIdParamSchema.parse('123e4567-e89b-12d3-a456-426614174000')).not.toThrow()
  })

  it('rejects a non-UUID string', () => {
    expect(() => knowledgeIdParamSchema.parse('not-a-uuid')).toThrow()
  })
})
