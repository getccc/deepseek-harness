/**
 * The closed vocabulary of questions a member may ask of a result, and the
 * readers that prove an unknown value is one.
 *
 * Both ends of the protocol read a question with the same code: the Runner's
 * tools refuse a malformed one before anything leaves the computer, and the
 * Control Plane refuses one that arrives anyway. A key this build does not
 * define is an error rather than being ignored, because a caller that believes
 * a filter was applied and a callee that dropped it would produce a confident
 * wrong answer. Whether a column exists, filters that way, and holds such
 * values is the source's to decide against the result itself.
 * @module @deepseek-ai/dsh-gmo/query
 */

import type { GmoFilters, GmoQuery, GmoWidget } from './types.ts'

/** The most characters a free-text field of a question may carry, so it stays a keyword. */
const MAX_TEXT_CHARS = 200
/** The most characters a column name may carry. */
const MAX_COLUMN_CHARS = 64
/** The most columns, values, or entries one filter section may list. */
const MAX_FILTER_ENTRIES = 50
/** The most values one multi-select filter column may list. */
const MAX_FILTER_VALUES = 200
/** The largest count a question may ask for; the deployment's own bound still applies. */
const MAX_COUNT = 10_000

/** What a column name may be: the identifiers the source's own columns use. */
const COLUMN = /^[A-Za-z_][A-Za-z0-9_]*$/u
/** An inclusive filter date, in the one spelling the source reads. */
const DAY = /^\d{4}-\d{2}-\d{2}$/u

const WIDGETS: ReadonlySet<string> = new Set<GmoWidget>([
  'kpi', 'timeline', 'ranking', 'flow', 'heatmap', 'structure', 'quality', 'balance', 'balance_analysis', 'balance_material',
])

/**
 * Read a whole page number, page size, or row bound, when the field carries one.
 *
 * Absent is a valid request, the gateway supplies its own default, so the
 * answer distinguishes "not given" from "not a number this build accepts",
 * which is a protocol error rather than an authorization outcome.
 * @param value - the decoded field.
 * @returns the number, `undefined` when the field is absent, or `'invalid'`.
 */
export function readGmoCount(value: unknown): number | undefined | 'invalid' {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > MAX_COUNT) return 'invalid'
  return value
}

/**
 * What a private reader answers for a value it refuses. A symbol rather than
 * the word `'invalid'`, because a column named `invalid` and a filter value
 * `invalid` are legal and must not read as a refusal.
 */
const REFUSED = Symbol('refused')

/** One column name, or `REFUSED`. */
function readColumn(value: unknown): string | typeof REFUSED {
  return typeof value === 'string' && value.length <= MAX_COLUMN_CHARS && COLUMN.test(value) ? value : REFUSED
}

/** One line of bounded free text, or `REFUSED`. */
function readText(value: unknown): string | typeof REFUSED {
  return typeof value === 'string' && value.length <= MAX_TEXT_CHARS && !/[\r\n]/u.test(value) ? value : REFUSED
}

/** Whether a decoded value is a plain JSON object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Read the filters a question carries.
 *
 * The four sections are the source's own and nothing else is accepted, so a
 * question cannot smuggle a field the source never defined. Column names must
 * look like column names and every list is bounded; whether a column exists,
 * filters that way, and holds such values is the source's to decide against
 * the result itself.
 * @param value - the decoded field.
 * @returns the filters, an empty set when absent, or `'invalid'`.
 */
export function readGmoFilters(value: unknown): GmoFilters | 'invalid' {
  if (value === undefined) return {}
  if (!isRecord(value)) return 'invalid'
  const out: { -readonly [K in keyof GmoFilters]: GmoFilters[K] } = {}
  for (const [section, body] of Object.entries(value)) {
    switch (section) {
      case 'multi': {
        const read = readMulti(body)
        if (read === 'invalid') return 'invalid'
        out.multi = read
        break
      }
      case 'search': {
        const read = readSearch(body)
        if (read === 'invalid') return 'invalid'
        out.search = read
        break
      }
      case 'range': {
        const read = readRange(body)
        if (read === 'invalid') return 'invalid'
        out.range = read
        break
      }
      case 'empty': {
        const read = readColumns(body, MAX_FILTER_ENTRIES)
        if (read === 'invalid') return 'invalid'
        out.empty = read
        break
      }
      default:
        return 'invalid'
    }
  }
  return out
}

/** A multi-select section: column to a bounded list of text values. */
function readMulti(value: unknown): Record<string, readonly string[]> | 'invalid' {
  if (!isRecord(value) || Object.keys(value).length > MAX_FILTER_ENTRIES) return 'invalid'
  const out: Record<string, readonly string[]> = {}
  for (const [column, list] of Object.entries(value)) {
    if (readColumn(column) === REFUSED || !Array.isArray(list) || list.length > MAX_FILTER_VALUES) return 'invalid'
    const values: string[] = []
    for (const item of list as unknown[]) {
      const text = readText(item)
      if (text === REFUSED) return 'invalid'
      values.push(text)
    }
    out[column] = values
  }
  return out
}

/** A keyword section: column to one bounded line of text. */
function readSearch(value: unknown): Record<string, string> | 'invalid' {
  if (!isRecord(value) || Object.keys(value).length > MAX_FILTER_ENTRIES) return 'invalid'
  const out: Record<string, string> = {}
  for (const [column, text] of Object.entries(value)) {
    const read = readText(text)
    if (readColumn(column) === REFUSED || read === REFUSED) return 'invalid'
    out[column] = read
  }
  return out
}

/** A date-range section: column to inclusive `YYYY-MM-DD` bounds. */
function readRange(value: unknown): Record<string, { readonly from?: string; readonly to?: string }> | 'invalid' {
  if (!isRecord(value) || Object.keys(value).length > MAX_FILTER_ENTRIES) return 'invalid'
  const out: Record<string, { readonly from?: string; readonly to?: string }> = {}
  for (const [column, bounds] of Object.entries(value)) {
    if (readColumn(column) === REFUSED || !isRecord(bounds)) return 'invalid'
    const entry: { from?: string; to?: string } = {}
    for (const [key, day] of Object.entries(bounds)) {
      if ((key !== 'from' && key !== 'to') || typeof day !== 'string' || !DAY.test(day)) return 'invalid'
      entry[key] = day
    }
    out[column] = entry
  }
  return out
}

/** A list of column names. */
function readColumns(value: unknown, max: number): readonly string[] | 'invalid' {
  if (!Array.isArray(value) || value.length > max) return 'invalid'
  const out: string[] = []
  for (const item of value as unknown[]) {
    const column = readColumn(item)
    if (column === REFUSED) return 'invalid'
    out.push(column)
  }
  return out
}

/** A closed word, or `'invalid'`. */
function readWord<T extends string>(value: unknown, words: readonly T[]): T | 'invalid' {
  return typeof value === 'string' && (words as readonly string[]).includes(value) ? value as T : 'invalid'
}

/**
 * Read the question a Runner asks.
 *
 * A closed vocabulary: three kinds, each with the keys it defines and no
 * others. A key this build does not know is a protocol error rather than being
 * ignored, because a Runner that believes a filter was applied and a Control
 * Plane that dropped it would produce a confident wrong answer.
 * @param value - the decoded field.
 * @returns the question, or `'invalid'`.
 */
export function readGmoQuery(value: unknown): GmoQuery | 'invalid' {
  if (!isRecord(value)) return 'invalid'
  const filters = readGmoFilters(value['filters'])
  if (filters === 'invalid') return 'invalid'
  const keys = Object.keys(value)
  const only = (allowed: readonly string[]): boolean => keys.every(key => allowed.includes(key))
  switch (value['kind']) {
    case 'aggregate': {
      if (!only(['kind', 'metric', 'field', 'groupBy', 'dateGrain', 'orderBy', 'limit', 'filters'])) return 'invalid'
      const metric = readWord(value['metric'], ['sum', 'count', 'distinct'] as const)
      const field = value['field'] === undefined ? undefined : readColumn(value['field'])
      const groupBy = value['groupBy'] === undefined ? undefined : readColumns(value['groupBy'], 2)
      const dateGrain = value['dateGrain'] === undefined ? undefined : readWord(value['dateGrain'], ['day', 'week', 'month'] as const)
      const orderBy = value['orderBy'] === undefined ? undefined : readWord(value['orderBy'], ['value_desc', 'value_asc', 'group_asc'] as const)
      const limit = readGmoCount(value['limit'])
      if ([metric, groupBy, dateGrain, orderBy, limit].includes('invalid') || field === REFUSED) return 'invalid'
      return {
        kind: 'aggregate',
        metric: metric as 'sum' | 'count' | 'distinct',
        ...(field === undefined ? {} : { field }),
        ...(groupBy === undefined ? {} : { groupBy: groupBy as readonly string[] }),
        ...(dateGrain === undefined ? {} : { dateGrain: dateGrain as 'day' | 'week' | 'month' }),
        ...(orderBy === undefined ? {} : { orderBy: orderBy as 'value_desc' | 'value_asc' | 'group_asc' }),
        ...(limit === undefined ? {} : { limit: limit as number }),
        filters,
      }
    }
    case 'overview': {
      if (!only(['kind', 'widget', 'filters', 'dateField', 'stack', 'sub', 'grain', 'metric', 'dim', 'top', 'search', 'material'])) return 'invalid'
      const widget = readWord(value['widget'], [...WIDGETS] as GmoWidget[])
      const dateField = value['dateField'] === undefined ? undefined : readColumn(value['dateField'])
      const stack = value['stack'] === undefined ? undefined : readColumn(value['stack'])
      const sub = value['sub'] === undefined ? undefined : readColumn(value['sub'])
      const grain = value['grain'] === undefined ? undefined : readWord(value['grain'], ['week', 'month'] as const)
      const metric = value['metric'] === undefined ? undefined : readWord(value['metric'], ['qty', 'rows'] as const)
      const dim = value['dim'] === undefined ? undefined : readColumn(value['dim'])
      const top = readGmoCount(value['top'])
      const search = value['search'] === undefined ? undefined : readText(value['search'])
      const material = value['material'] === undefined ? undefined : readText(value['material'])
      if ([widget, grain, metric, top].includes('invalid') || [dateField, stack, sub, dim, search, material].includes(REFUSED)) return 'invalid'
      return {
        kind: 'overview',
        widget: widget as GmoWidget,
        filters,
        ...(dateField === undefined ? {} : { dateField: dateField as string }),
        ...(stack === undefined ? {} : { stack: stack as string }),
        ...(sub === undefined ? {} : { sub: sub as string }),
        ...(grain === undefined ? {} : { grain: grain as 'week' | 'month' }),
        ...(metric === undefined ? {} : { metric: metric as 'qty' | 'rows' }),
        ...(dim === undefined ? {} : { dim: dim as string }),
        ...(top === undefined ? {} : { top: top as number }),
        ...(search === undefined ? {} : { search: search as string }),
        ...(material === undefined ? {} : { material: material as string }),
      }
    }
    case 'rows': {
      if (!only(['kind', 'filters', 'sort', 'page', 'pageSize'])) return 'invalid'
      const sort = readSort(value['sort'])
      const page = readGmoCount(value['page'])
      const pageSize = readGmoCount(value['pageSize'])
      if ([sort, page, pageSize].includes('invalid')) return 'invalid'
      return {
        kind: 'rows',
        filters,
        ...(sort === undefined ? {} : { sort: sort as { field: string; dir: 'asc' | 'desc' } }),
        ...(page === undefined ? {} : { page: page as number }),
        ...(pageSize === undefined ? {} : { pageSize: pageSize as number }),
      }
    }
    default:
      return 'invalid'
  }
}

/** A sort: one column and a direction. */
function readSort(value: unknown): { readonly field: string; readonly dir: 'asc' | 'desc' } | undefined | 'invalid' {
  if (value === undefined) return undefined
  if (!isRecord(value) || !Object.keys(value).every(key => key === 'field' || key === 'dir')) return 'invalid'
  const field = readColumn(value['field'])
  const dir = readWord(value['dir'], ['asc', 'desc'] as const)
  return field === REFUSED || dir === 'invalid' ? 'invalid' : { field, dir }
}
