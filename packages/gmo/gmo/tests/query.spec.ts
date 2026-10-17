/**
 * The question readers both ends of the protocol share: what they accept,
 * what they refuse, and that a legal value spelled like the refusal word is
 * still a value.
 */
import { describe, expect, it } from 'vitest'
import { readGmoCount, readGmoFilters, readGmoQuery } from '../src/index.ts'

describe('readGmoCount', () => {
  it('reads an absent field as absent and a whole positive number as itself', () => {
    expect(readGmoCount(undefined)).toBeUndefined()
    expect(readGmoCount(1)).toBe(1)
    expect(readGmoCount(10_000)).toBe(10_000)
  })

  it('refuses zero, a fraction, a string, and a number past the bound', () => {
    for (const value of [0, -1, 1.5, '3', null, 10_001, Number.NaN]) expect(readGmoCount(value)).toBe('invalid')
  })
})

describe('readGmoFilters', () => {
  it('reads an absent field as no filters', () => {
    expect(readGmoFilters(undefined)).toEqual({})
  })

  it('reads the four sections', () => {
    const filters = {
      multi: { supplier: ['HUNGO', '__null__'] },
      search: { pn: '713-00041' },
      range: { next: { from: '2026-12-07', to: '2026-12-13' } },
      empty: ['adj_date'],
    }
    expect(readGmoFilters(filters)).toEqual(filters)
  })

  it('reads a column named invalid and a value spelled invalid as data, not as a refusal', () => {
    const filters = { multi: { invalid: ['invalid'] }, search: { invalid: 'invalid' }, range: { invalid: { from: '2026-01-01' } }, empty: ['invalid'] }
    expect(readGmoFilters(filters)).toEqual(filters)
  })

  it('refuses a section this build does not define', () => {
    expect(readGmoFilters({ regex: { pn: '.*' } })).toBe('invalid')
  })

  it('refuses a body that is not an object', () => {
    for (const value of ['x', 3, null, ['multi']]) expect(readGmoFilters(value)).toBe('invalid')
  })

  it('refuses a column that is not an identifier, in every section', () => {
    expect(readGmoFilters({ multi: { 'a b': ['x'] } })).toBe('invalid')
    expect(readGmoFilters({ search: { '1a': 'x' } })).toBe('invalid')
    expect(readGmoFilters({ range: { 'a-b': { from: '2026-01-01' } } })).toBe('invalid')
    expect(readGmoFilters({ empty: ['a b'] })).toBe('invalid')
  })

  it('refuses a malformed multi, search, or range body', () => {
    expect(readGmoFilters({ multi: [] })).toBe('invalid')
    expect(readGmoFilters({ multi: { supplier: 'HUNGO' } })).toBe('invalid')
    expect(readGmoFilters({ multi: { supplier: [1] } })).toBe('invalid')
    expect(readGmoFilters({ multi: { supplier: ['two\nlines'] } })).toBe('invalid')
    expect(readGmoFilters({ search: { pn: 7 } })).toBe('invalid')
    expect(readGmoFilters({ search: [] })).toBe('invalid')
    expect(readGmoFilters({ range: { next: 'soon' } })).toBe('invalid')
    expect(readGmoFilters({ range: { next: { from: '12/07/2026' } } })).toBe('invalid')
    expect(readGmoFilters({ range: { next: { until: '2026-12-07' } } })).toBe('invalid')
    expect(readGmoFilters({ range: [] })).toBe('invalid')
    expect(readGmoFilters({ empty: 'adj_date' })).toBe('invalid')
  })

  it('bounds every list', () => {
    const many = Object.fromEntries(Array.from({ length: 51 }, (_, index) => [`c${index}`, ['x']]))
    expect(readGmoFilters({ multi: many })).toBe('invalid')
    expect(readGmoFilters({ multi: { supplier: Array.from({ length: 201 }, () => 'x') } })).toBe('invalid')
    expect(readGmoFilters({ search: Object.fromEntries(Array.from({ length: 51 }, (_, index) => [`c${index}`, 'x'])) })).toBe('invalid')
    expect(readGmoFilters({ range: Object.fromEntries(Array.from({ length: 51 }, (_, index) => [`c${index}`, { from: '2026-01-01' }])) })).toBe('invalid')
    expect(readGmoFilters({ empty: Array.from({ length: 51 }, (_, index) => `c${index}`) })).toBe('invalid')
    expect(readGmoFilters({ search: { pn: 'x'.repeat(201) } })).toBe('invalid')
    expect(readGmoFilters({ multi: { ['c'.repeat(65)]: ['x'] } })).toBe('invalid')
  })
})

describe('readGmoQuery', () => {
  it('reads an aggregation with every key it defines', () => {
    const query = {
      kind: 'aggregate', metric: 'sum', field: 'remaining_gap', groupBy: ['supplier', 'next'], dateGrain: 'week',
      orderBy: 'value_desc', limit: 20, filters: { multi: { supplier: ['HUNGO'] } },
    }
    expect(readGmoQuery(query)).toEqual(query)
  })

  it('reads a bare aggregation with empty filters', () => {
    expect(readGmoQuery({ kind: 'aggregate', metric: 'count' })).toEqual({ kind: 'aggregate', metric: 'count', filters: {} })
  })

  it('reads an overview with every key it defines', () => {
    const query = {
      kind: 'overview', widget: 'timeline', filters: {}, dateField: 'next', stack: 'supplier', sub: 'project',
      grain: 'month', metric: 'qty', dim: 'supplier', top: 10, search: 'bracket', material: '713-00041',
    }
    expect(readGmoQuery(query)).toEqual(query)
  })

  it('reads a rows question with a sort and a page', () => {
    const query = { kind: 'rows', filters: {}, sort: { field: 'remaining_gap', dir: 'desc' }, page: 2, pageSize: 50 }
    expect(readGmoQuery(query)).toEqual(query)
  })

  it('reads a bare rows question', () => {
    expect(readGmoQuery({ kind: 'rows' })).toEqual({ kind: 'rows', filters: {} })
  })

  it('reads a column named invalid as a column', () => {
    expect(readGmoQuery({ kind: 'aggregate', metric: 'sum', field: 'invalid', groupBy: ['invalid'] }))
      .toEqual({ kind: 'aggregate', metric: 'sum', field: 'invalid', groupBy: ['invalid'], filters: {} })
    expect(readGmoQuery({ kind: 'rows', sort: { field: 'invalid', dir: 'asc' } }))
      .toEqual({ kind: 'rows', filters: {}, sort: { field: 'invalid', dir: 'asc' } })
  })

  it('refuses a value that is not an object, a missing or unknown kind, and an unknown key of a known kind', () => {
    for (const value of [undefined, null, 'rows', 7, [], {}, { kind: 'delete' }]) expect(readGmoQuery(value)).toBe('invalid')
    expect(readGmoQuery({ kind: 'aggregate', metric: 'sum', sql: 'select 1' })).toBe('invalid')
    expect(readGmoQuery({ kind: 'overview', widget: 'kpi', sql: 'select 1' })).toBe('invalid')
    expect(readGmoQuery({ kind: 'rows', sql: 'select 1' })).toBe('invalid')
  })

  it('refuses a word outside its closed set', () => {
    expect(readGmoQuery({ kind: 'aggregate', metric: 'avg' })).toBe('invalid')
    expect(readGmoQuery({ kind: 'aggregate', metric: 'sum', dateGrain: 'year' })).toBe('invalid')
    expect(readGmoQuery({ kind: 'aggregate', metric: 'sum', orderBy: 'random' })).toBe('invalid')
    expect(readGmoQuery({ kind: 'overview', widget: 'secrets' })).toBe('invalid')
    expect(readGmoQuery({ kind: 'overview', widget: 'kpi', grain: 'day' })).toBe('invalid')
    expect(readGmoQuery({ kind: 'overview', widget: 'kpi', metric: 'avg' })).toBe('invalid')
    expect(readGmoQuery({ kind: 'rows', sort: { field: 'x', dir: 'sideways' } })).toBe('invalid')
  })

  it('refuses a malformed column, text, count, filter, or sort', () => {
    expect(readGmoQuery({ kind: 'aggregate', metric: 'sum', field: 'a b' })).toBe('invalid')
    expect(readGmoQuery({ kind: 'aggregate', metric: 'sum', groupBy: 'supplier' })).toBe('invalid')
    expect(readGmoQuery({ kind: 'aggregate', metric: 'sum', groupBy: ['a', 'b', 'c'] })).toBe('invalid')
    expect(readGmoQuery({ kind: 'aggregate', metric: 'sum', groupBy: ['a b'] })).toBe('invalid')
    expect(readGmoQuery({ kind: 'aggregate', metric: 'sum', limit: 0 })).toBe('invalid')
    expect(readGmoQuery({ kind: 'aggregate', metric: 'sum', filters: 'x' })).toBe('invalid')
    expect(readGmoQuery({ kind: 'overview', widget: 'kpi', search: 'two\nlines' })).toBe('invalid')
    expect(readGmoQuery({ kind: 'overview', widget: 'kpi', dateField: 'a b' })).toBe('invalid')
    expect(readGmoQuery({ kind: 'overview', widget: 'kpi', top: 1.5 })).toBe('invalid')
    expect(readGmoQuery({ kind: 'rows', sort: 'remaining_gap' })).toBe('invalid')
    expect(readGmoQuery({ kind: 'rows', sort: { field: 'x', dir: 'asc', extra: 1 } })).toBe('invalid')
    expect(readGmoQuery({ kind: 'rows', sort: { field: 'a b', dir: 'asc' } })).toBe('invalid')
    expect(readGmoQuery({ kind: 'rows', page: 0 })).toBe('invalid')
  })
})
