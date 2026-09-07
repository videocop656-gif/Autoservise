import { describe, it, expect } from 'vitest'
import { parsePagination, buildPaginatedResult } from '../src/server/lib/pagination'

describe('parsePagination', () => {
  it('defaults to page 1, pageSize 20 when absent', () => {
    expect(parsePagination({})).toEqual({ page: 1, pageSize: 20 })
  })

  it('parses valid string query values', () => {
    expect(parsePagination({ page: '3', pageSize: '50' })).toEqual({ page: 3, pageSize: 50 })
  })

  it('rejects page below 1', () => {
    expect(() => parsePagination({ page: '0' })).toThrow()
  })

  it('rejects pageSize above 100', () => {
    expect(() => parsePagination({ pageSize: '101' })).toThrow()
  })

  it('rejects pageSize below 1', () => {
    expect(() => parsePagination({ pageSize: '0' })).toThrow()
  })

  it('rejects a non-numeric page', () => {
    expect(() => parsePagination({ page: 'abc' })).toThrow()
  })
})

describe('buildPaginatedResult', () => {
  it('computes totalPages from total and pageSize', () => {
    const result = buildPaginatedResult(['a', 'b'], 1, 20, 45)
    expect(result).toEqual({ items: ['a', 'b'], page: 1, pageSize: 20, total: 45, totalPages: 3 })
  })

  it('reports 0 total pages for an empty result set', () => {
    const result = buildPaginatedResult([], 1, 20, 0)
    expect(result.totalPages).toBe(0)
  })
})
