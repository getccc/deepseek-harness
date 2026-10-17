import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import {
  DEFAULT_GMO_SCOPE,
  GMO_REF_MAX_LENGTH,
  GMO_RESULT_ID_MAX_LENGTH,
  GMO_SOURCE_CODE_MAX_LENGTH,
  Gmo,
  GmoCategoryRef,
  GmoError,
  GmoResultRef,
  InvalidGmoRefError,
  categoryOf,
  categoryRefOf,
  foldGmoScope,
  formatGmoCategoryRef,
  formatGmoResultRef,
  isGmoCategoryRef,
  isGmoResultRef,
  parseGmoCategoryRef,
  parseGmoResultRef,
  parseGmoScope,
  upstreamResultIdOf,
  type GmoAnswer,
  type GmoAskRequest,
  type GmoCategoryEntry,
  type GmoDescribeRequest,
  type GmoDescription,
  type GmoResultPage,
  type GmoResultsRequest,
  type GmoScope,
} from '@deepseek-ai/dsh-gmo'

const RESULT_ID = '09032da5fb1e43968cb0d3ef422f90e2'

/** The reference a well-formed GMO category mints. */
function ref(sourceCode = 'gmo', upstreamId = 'gb'): string {
  return formatGmoCategoryRef({ providerKind: 'exceltools', sourceCode, upstreamId })
}

/** One committed scope event, as a Session log holds it. */
function scopeEvent(scope: GmoScope, seq: number): SessionEvent {
  return { seq, type: 'gmo/scope', data: scope } as SessionEvent
}

/** A committed event this capability ignores. */
function otherEvent(seq: number): SessionEvent {
  return { seq, type: 'turn/start', data: { turn: seq } } as SessionEvent
}

describe('category references', () => {
  it('assembles and reads back the three segments', () => {
    const value = ref()
    expect(value).toBe('exceltools:gmo:gb')
    expect(parseGmoCategoryRef(value)).toEqual({ providerKind: 'exceltools', sourceCode: 'gmo', upstreamId: 'gb' })
    expect(isGmoCategoryRef(value)).toBe(true)
  })

  it('brands without validating, so a parsed value is the one that proves the grammar', () => {
    expect(GmoCategoryRef('anything at all')).toBe('anything at all')
    expect(isGmoCategoryRef('anything at all')).toBe(false)
  })

  it.each([
    ['an empty provider kind', { providerKind: '', sourceCode: 'gmo', upstreamId: 'gb' }],
    ['an empty source code', { providerKind: 'exceltools', sourceCode: '', upstreamId: 'gb' }],
    ['an empty upstream id', { providerKind: 'exceltools', sourceCode: 'gmo', upstreamId: '' }],
    ['a space', { providerKind: 'exceltools', sourceCode: 'a b', upstreamId: 'gb' }],
    ['a slash', { providerKind: 'exceltools', sourceCode: 'a/b', upstreamId: 'gb' }],
    ['an embedded separator', { providerKind: 'exceltools', sourceCode: 'a:b', upstreamId: 'gb' }],
  ])('refuses %s', (_label, parts) => {
    expect(() => formatGmoCategoryRef(parts)).toThrow(InvalidGmoRefError)
  })

  it('refuses a source code past the shared maximum', () => {
    const longest = 'a'.repeat(GMO_SOURCE_CODE_MAX_LENGTH)
    expect(ref(longest)).toContain(longest)
    expect(() => formatGmoCategoryRef({ providerKind: 'exceltools', sourceCode: `${longest}a`, upstreamId: 'gb' }))
      .toThrow(/source code is 20 characters, over the maximum of 19/u)
  })

  it('refuses a reference past the audit token maximum even when each segment is legal', () => {
    expect(() => formatGmoCategoryRef({ providerKind: 'exceltools', sourceCode: 'gmo', upstreamId: 'u'.repeat(GMO_REF_MAX_LENGTH) }))
      .toThrow(/over the audit token maximum of 64/u)
  })

  it('keeps every minted reference inside the audit token rule', () => {
    const auditToken = /^[A-Za-z0-9._:@-]{1,64}$/u
    expect(auditToken.test(ref('a'.repeat(GMO_SOURCE_CODE_MAX_LENGTH), 'c'.repeat(20)))).toBe(true)
  })

  it.each([
    ['too few segments', 'exceltools:gb'],
    ['too many segments', 'exceltools:gmo:gb:extra'],
    ['no segments', ''],
    ['three segments with an empty one', 'exceltools::gb'],
    ['three segments over the length maximum', `exceltools:gmo:${'u'.repeat(GMO_REF_MAX_LENGTH)}`],
  ])('reads %s back as undefined', (_label, value) => {
    expect(parseGmoCategoryRef(value)).toBeUndefined()
    expect(isGmoCategoryRef(value)).toBe(false)
  })
})

describe('result references', () => {
  it('carries its category and the upstream result id, and reads back into both', () => {
    const resultRef = formatGmoResultRef({ ref: GmoCategoryRef(ref()), upstreamResultId: RESULT_ID })
    expect(resultRef).toBe(`${ref()}/${RESULT_ID}`)
    expect(parseGmoResultRef(resultRef)).toEqual({ ref: ref(), upstreamResultId: RESULT_ID })
    expect(isGmoResultRef(resultRef)).toBe(true)
    expect(categoryRefOf(resultRef)).toBe(ref())
    expect(upstreamResultIdOf(resultRef)).toBe(RESULT_ID)
  })

  it('carries a stage suffix inside the alphabet, which is why the upstream joins it with a dot', () => {
    const stage = `${RESULT_ID}.net-gap`
    const resultRef = formatGmoResultRef({ ref: GmoCategoryRef(ref()), upstreamResultId: stage })
    expect(upstreamResultIdOf(resultRef)).toBe(stage)
    // The upstream's own `~` separator is outside the alphabet, so a provider must translate it.
    expect(isGmoResultRef(`${ref()}/${RESULT_ID}~net-gap`)).toBe(false)
  })

  it.each([
    ['a category that is not a reference', 'exceltools:gmo', 'r1'],
    ['an empty result id', ref(), ''],
    ['a result id holding the separator', ref(), 'a/b'],
    ['a result id holding a colon', ref(), 'a:b'],
    ['a result id over the maximum', ref(), 'c'.repeat(GMO_RESULT_ID_MAX_LENGTH + 1)],
  ])('refuses %s', (_label, category, upstreamResultId) => {
    expect(() => formatGmoResultRef({ ref: GmoCategoryRef(category), upstreamResultId })).toThrow(InvalidGmoRefError)
  })

  it.each([
    ['a value with no separator', 'exceltools:gmo:gb'],
    ['a value whose category is not one', 'exceltools:gmo/r1'],
    ['a value with nothing after the separator', `${ref()}/`],
  ])('reads %s as not a result reference', (_label, value) => {
    expect(parseGmoResultRef(value)).toBeUndefined()
    expect(isGmoResultRef(value)).toBe(false)
  })

  it('brands a raw string without checking it, for a caller that already proved the grammar', () => {
    expect(GmoResultRef('anything')).toBe('anything')
  })
})

describe('session scope fold', () => {
  const selected: GmoScope = {
    version: 1,
    mode: 'selected',
    category: { ref: GmoCategoryRef(ref()), displayName: 'GB / GL 分配' },
  }

  it('folds an empty log to off', () => {
    expect(foldGmoScope([])).toEqual(DEFAULT_GMO_SCOPE)
    expect(foldGmoScope([otherEvent(0)])).toEqual({ version: 1, mode: 'off' })
  })

  it('takes the last recorded scope', () => {
    const events = [scopeEvent(selected, 0), otherEvent(1), scopeEvent({ version: 1, mode: 'off' }, 2), scopeEvent(selected, 3)]
    expect(foldGmoScope(events)).toEqual(selected)
  })

  it('folds a prefix, so rewind and fork read what the log said then', () => {
    const events = [scopeEvent(selected, 0), scopeEvent({ version: 1, mode: 'off' }, 1)]
    expect(foldGmoScope(events, 1)).toEqual(selected)
    expect(foldGmoScope(events, 0)).toEqual(DEFAULT_GMO_SCOPE)
    expect(foldGmoScope(events)).toEqual({ version: 1, mode: 'off' })
  })
})

describe('scope validation', () => {
  it('accepts off', () => {
    expect(parseGmoScope({ version: 1, mode: 'off' })).toEqual({ version: 1, mode: 'off' })
  })

  it('accepts a selection and keeps the recorded display name', () => {
    const parsed = parseGmoScope({ version: 1, mode: 'selected', category: { ref: ref(), displayName: 'GB / GL 分配' } })
    expect(parsed).toEqual({ version: 1, mode: 'selected', category: { ref: ref(), displayName: 'GB / GL 分配' } })
  })

  it.each([
    ['a non-object', 'off'],
    ['null', null],
    ['an unknown version', { version: 2, mode: 'off' }],
    ['an unknown mode', { version: 1, mode: 'all' }],
    ['a selection with no category', { version: 1, mode: 'selected' }],
    ['a null category', { version: 1, mode: 'selected', category: null }],
    ['a non-object category', { version: 1, mode: 'selected', category: 'x' }],
    ['a malformed reference', { version: 1, mode: 'selected', category: { ref: 'exceltools', displayName: 'n' } }],
    ['a non-string reference', { version: 1, mode: 'selected', category: { ref: 7, displayName: 'n' } }],
    ['a missing display name', { version: 1, mode: 'selected', category: { ref: ref() } }],
    ['an empty display name', { version: 1, mode: 'selected', category: { ref: ref(), displayName: '' } }],
  ])('refuses %s', (_label, value) => {
    expect(parseGmoScope(value)).toBeUndefined()
  })
})

describe('the scoped category', () => {
  it('names no category while the scope is off', () => {
    expect(categoryOf({ version: 1, mode: 'off' })).toBeUndefined()
  })

  it('answers the recorded category, name included', () => {
    const category = { ref: GmoCategoryRef(ref()), displayName: 'GB / GL 分配' }
    expect(categoryOf({ version: 1, mode: 'selected', category })).toEqual(category)
  })
})

describe('failures', () => {
  it('carries a closed reason, with and without developer detail', () => {
    const bare = new GmoError('not-allowed')
    expect(bare.reason).toBe('not-allowed')
    expect(bare.message).toBe('not-allowed')
    expect(bare.name).toBe('GmoError')
    expect(new GmoError('upstream-invalid', 'missing results').message).toBe('upstream-invalid: missing results')
  })
})

describe('the seam', () => {
  /** The smallest provider that satisfies the seam, for a mount test. */
  class StubGmo extends Gmo {
    catalog(): Promise<readonly GmoCategoryEntry[]> {
      return Promise.resolve([{ ref: GmoCategoryRef(ref()), displayName: 'GB / GL 分配' }])
    }

    results(request: GmoResultsRequest): Promise<GmoResultPage> {
      return Promise.resolve({
        ref: request.ref,
        results: [{
          resultRef: GmoResultRef(`${request.ref}/${RESULT_ID}`),
          ref: request.ref,
          name: 'GB / GL 一键分配 · 2026-W42 · #4',
          toolName: 'GB / GL 一键分配',
          period: '2026-W42',
          rows: 169_187,
          createdAt: '2026-10-16T14:50',
          stages: [],
        }],
        page: request.page ?? 1,
        pageSize: 20,
        total: 1,
      })
    }

    describe(request: GmoDescribeRequest): Promise<GmoDescription> {
      return Promise.resolve({
        resultRef: request.resultRef,
        ref: categoryRefOf(request.resultRef),
        categoryLabel: 'GB / GL 分配',
        name: 'GB / GL 一键分配 · 2026-W42 · #4',
        toolName: 'GB / GL 一键分配',
        period: '2026-W42',
        rows: 169_187,
        createdAt: '2026-10-16T14:50',
        today: '2026-10-16',
        weekStart: '2026-10-12',
        stages: [],
        fields: [{ key: 'remaining_gap', label: '剩余缺口', type: 'number', filter: '', description: '分配之后仍未满足的需求' }],
        sources: [],
        glossary: '',
      })
    }

    ask(request: GmoAskRequest): Promise<GmoAnswer> {
      return Promise.resolve({
        resultRef: request.resultRef,
        ref: categoryRefOf(request.resultRef),
        kind: request.query.kind,
        data: { total: 2_394_249.494, rows: 169_187 },
      })
    }
  }

  it('mounts under ctx.gmo and answers every operation', async () => {
    const ctx = new Context()
    await ctx.plugin(StubGmo)
    const entries = await ctx.gmo.catalog()
    expect(entries.map(entry => entry.displayName)).toEqual(['GB / GL 分配'])
    const page = await ctx.gmo.results({ ref: GmoCategoryRef(ref()) })
    expect(page.results.map(result => result.resultRef)).toEqual([`${ref()}/${RESULT_ID}`])
    const resultRef = GmoResultRef(`${ref()}/${RESULT_ID}`)
    expect((await ctx.gmo.describe({ resultRef })).fields[0]?.key).toBe('remaining_gap')
    const answer = await ctx.gmo.ask({ resultRef, query: { kind: 'aggregate', metric: 'sum' } })
    expect(answer).toMatchObject({ kind: 'aggregate', data: { rows: 169_187 } })
  })
})
