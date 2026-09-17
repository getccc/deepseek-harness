import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import {
  BI_CHART_ID_MAX_LENGTH,
  BI_REF_MAX_LENGTH,
  BI_SOURCE_CODE_MAX_LENGTH,
  Bi,
  BiChartRef,
  BiError,
  BiProjectRef,
  DEFAULT_BI_SCOPE,
  InvalidBiRefError,
  foldBiScope,
  formatBiChartRef,
  formatBiProjectRef,
  isBiChartRef,
  isBiProjectRef,
  parseBiChartRef,
  parseBiProjectRef,
  parseBiScope,
  projectOf,
  projectRefOf,
  upstreamChartIdOf,
  type BiChartPage,
  type BiChartsRequest,
  type BiProjectEntry,
  type BiQueryRequest,
  type BiQueryResult,
  type BiScope,
} from '@deepseek-ai/dsh-bi'

const PROJECT_UUID = '55d61de1-ed86-4ad4-b96e-205114de5245'
const CHART_UUID = 'aa064703-8940-4ada-9ef0-3fff1905faa2'

/** The reference a well-formed webi project mints. */
function ref(sourceCode = 'prod', upstreamId = PROJECT_UUID): string {
  return formatBiProjectRef({ providerKind: 'webi', sourceCode, upstreamId })
}

/** One committed scope event, as a Session log holds it. */
function scopeEvent(scope: BiScope, seq: number): SessionEvent {
  return { seq, type: 'bi/scope', data: scope } as SessionEvent
}

/** A committed event this capability ignores. */
function otherEvent(seq: number): SessionEvent {
  return { seq, type: 'turn/start', data: { turn: seq } } as SessionEvent
}

describe('project references', () => {
  it('assembles and reads back the three segments', () => {
    const value = ref()
    expect(value).toBe(`webi:prod:${PROJECT_UUID}`)
    expect(parseBiProjectRef(value)).toEqual({ providerKind: 'webi', sourceCode: 'prod', upstreamId: PROJECT_UUID })
    expect(isBiProjectRef(value)).toBe(true)
  })

  it('brands without validating, so a parsed value is the one that proves the grammar', () => {
    expect(BiProjectRef('anything at all')).toBe('anything at all')
    expect(isBiProjectRef('anything at all')).toBe(false)
  })

  it.each([
    ['an empty provider kind', { providerKind: '', sourceCode: 'prod', upstreamId: PROJECT_UUID }],
    ['an empty source code', { providerKind: 'webi', sourceCode: '', upstreamId: PROJECT_UUID }],
    ['an empty upstream id', { providerKind: 'webi', sourceCode: 'prod', upstreamId: '' }],
    ['a space', { providerKind: 'webi', sourceCode: 'a b', upstreamId: PROJECT_UUID }],
    ['a slash', { providerKind: 'webi', sourceCode: 'a/b', upstreamId: PROJECT_UUID }],
    ['an embedded separator', { providerKind: 'webi', sourceCode: 'a:b', upstreamId: PROJECT_UUID }],
  ])('refuses %s', (_label, parts) => {
    expect(() => formatBiProjectRef(parts)).toThrow(InvalidBiRefError)
  })

  it('refuses a source code past the shared maximum', () => {
    const longest = 'a'.repeat(BI_SOURCE_CODE_MAX_LENGTH)
    expect(ref(longest)).toContain(longest)
    expect(() => formatBiProjectRef({ providerKind: 'webi', sourceCode: `${longest}a`, upstreamId: PROJECT_UUID }))
      .toThrow(/source code is 20 characters, over the maximum of 19/u)
  })

  it('refuses a reference past the audit token maximum even when each segment is legal', () => {
    expect(() => formatBiProjectRef({ providerKind: 'webi', sourceCode: 'prod', upstreamId: 'u'.repeat(BI_REF_MAX_LENGTH) }))
      .toThrow(/over the audit token maximum of 64/u)
  })

  it('keeps every minted reference inside the audit token rule', () => {
    const auditToken = /^[A-Za-z0-9._:@-]{1,64}$/u
    expect(auditToken.test(ref('a'.repeat(BI_SOURCE_CODE_MAX_LENGTH)))).toBe(true)
  })

  it.each([
    ['too few segments', `webi:${PROJECT_UUID}`],
    ['too many segments', `webi:prod:${PROJECT_UUID}:extra`],
    ['no segments', ''],
    ['three segments with an empty one', `webi::${PROJECT_UUID}`],
    ['three segments over the length maximum', `webi:prod:${'u'.repeat(BI_REF_MAX_LENGTH)}`],
  ])('reads %s back as undefined', (_label, value) => {
    expect(parseBiProjectRef(value)).toBeUndefined()
    expect(isBiProjectRef(value)).toBe(false)
  })
})

describe('chart references', () => {
  it('carries its project and the upstream chart id, and reads back into both', () => {
    const chartRef = formatBiChartRef({ ref: BiProjectRef(ref()), upstreamChartId: CHART_UUID })
    expect(chartRef).toBe(`${ref()}/${CHART_UUID}`)
    expect(parseBiChartRef(chartRef)).toEqual({ ref: ref(), upstreamChartId: CHART_UUID })
    expect(isBiChartRef(chartRef)).toBe(true)
    expect(projectRefOf(chartRef)).toBe(ref())
    expect(upstreamChartIdOf(chartRef)).toBe(CHART_UUID)
  })

  it('is longer than an audit token, which is why it is its own brand', () => {
    // A project and a chart UUID do not fit BI_REF_MAX_LENGTH together. A
    // chart is never the audited resource, so the audit bound does not apply.
    const chartRef = formatBiChartRef({ ref: BiProjectRef(ref()), upstreamChartId: CHART_UUID })
    expect(chartRef.length).toBeGreaterThan(BI_REF_MAX_LENGTH)
    expect(isBiChartRef(chartRef)).toBe(true)
  })

  it.each([
    ['a project that is not a reference', 'webi:prod', 'chart-1'],
    ['an empty chart id', ref(), ''],
    ['a chart id holding the separator', ref(), 'a/b'],
    ['a chart id holding a colon', ref(), 'a:b'],
    ['a chart id over the maximum', ref(), 'c'.repeat(BI_CHART_ID_MAX_LENGTH + 1)],
  ])('refuses %s', (_label, project, upstreamChartId) => {
    expect(() => formatBiChartRef({ ref: BiProjectRef(project), upstreamChartId })).toThrow(InvalidBiRefError)
  })

  it.each([
    ['a value with no separator', `webi:prod:${PROJECT_UUID}`],
    ['a value whose project is not one', 'webi:prod/chart-1'],
    ['a value with nothing after the separator', `${ref()}/`],
  ])('reads %s as not a chart reference', (_label, value) => {
    expect(parseBiChartRef(value)).toBeUndefined()
    expect(isBiChartRef(value)).toBe(false)
  })

  it('brands a raw string without checking it, for a caller that already proved the grammar', () => {
    expect(BiChartRef('anything')).toBe('anything')
  })
})

describe('session scope fold', () => {
  const selected: BiScope = {
    version: 1,
    mode: 'selected',
    project: { ref: BiProjectRef(ref()), displayName: 'Demo YH' },
  }

  it('folds an empty log to off', () => {
    expect(foldBiScope([])).toEqual(DEFAULT_BI_SCOPE)
    expect(foldBiScope([otherEvent(0)])).toEqual({ version: 1, mode: 'off' })
  })

  it('takes the last recorded scope', () => {
    const events = [scopeEvent(selected, 0), otherEvent(1), scopeEvent({ version: 1, mode: 'off' }, 2), scopeEvent(selected, 3)]
    expect(foldBiScope(events)).toEqual(selected)
  })

  it('folds a prefix, so rewind and fork read what the log said then', () => {
    const events = [scopeEvent(selected, 0), scopeEvent({ version: 1, mode: 'off' }, 1)]
    expect(foldBiScope(events, 1)).toEqual(selected)
    expect(foldBiScope(events, 0)).toEqual(DEFAULT_BI_SCOPE)
    expect(foldBiScope(events)).toEqual({ version: 1, mode: 'off' })
  })
})

describe('scope validation', () => {
  it('accepts off', () => {
    expect(parseBiScope({ version: 1, mode: 'off' })).toEqual({ version: 1, mode: 'off' })
  })

  it('accepts a selection and keeps the recorded display name', () => {
    const parsed = parseBiScope({ version: 1, mode: 'selected', project: { ref: ref(), displayName: '销售分析' } })
    expect(parsed).toEqual({ version: 1, mode: 'selected', project: { ref: ref(), displayName: '销售分析' } })
  })

  it.each([
    ['a non-object', 'off'],
    ['null', null],
    ['an unknown version', { version: 2, mode: 'off' }],
    ['an unknown mode', { version: 1, mode: 'all' }],
    ['a selection with no project', { version: 1, mode: 'selected' }],
    ['a null project', { version: 1, mode: 'selected', project: null }],
    ['a non-object project', { version: 1, mode: 'selected', project: 'x' }],
    ['a malformed reference', { version: 1, mode: 'selected', project: { ref: 'webi', displayName: 'n' } }],
    ['a non-string reference', { version: 1, mode: 'selected', project: { ref: 7, displayName: 'n' } }],
    ['a missing display name', { version: 1, mode: 'selected', project: { ref: ref() } }],
    ['an empty display name', { version: 1, mode: 'selected', project: { ref: ref(), displayName: '' } }],
  ])('refuses %s', (_label, value) => {
    expect(parseBiScope(value)).toBeUndefined()
  })
})

describe('the scoped project', () => {
  it('names no project while the scope is off', () => {
    expect(projectOf({ version: 1, mode: 'off' })).toBeUndefined()
  })

  it('answers the recorded project, name included', () => {
    const project = { ref: BiProjectRef(ref()), displayName: 'Demo YH' }
    expect(projectOf({ version: 1, mode: 'selected', project })).toEqual(project)
  })
})

describe('failures', () => {
  it('carries a closed reason, with and without developer detail', () => {
    const bare = new BiError('not-allowed')
    expect(bare.reason).toBe('not-allowed')
    expect(bare.message).toBe('not-allowed')
    expect(bare.name).toBe('BiError')
    expect(new BiError('upstream-invalid', 'missing results').message).toBe('upstream-invalid: missing results')
  })
})

describe('the seam', () => {
  /** The smallest provider that satisfies the seam, for a mount test. */
  class StubBi extends Bi {
    catalog(): Promise<readonly BiProjectEntry[]> {
      return Promise.resolve([{ ref: BiProjectRef(ref()), displayName: 'Demo YH' }])
    }

    charts(request: BiChartsRequest): Promise<BiChartPage> {
      return Promise.resolve({
        ref: request.ref,
        charts: [{
          chartRef: BiChartRef(`${request.ref}/${CHART_UUID}`),
          ref: request.ref,
          name: '销售总览',
          spaceName: '销售分析',
          description: '',
          kind: 'vertical_bar',
          updatedAt: undefined,
        }],
        page: request.page ?? 1,
        pageSize: 20,
        total: 1,
      })
    }

    query(request: BiQueryRequest): Promise<BiQueryResult> {
      return Promise.resolve({
        chartRef: request.chartRef,
        ref: projectRefOf(request.chartRef),
        name: '销售总览',
        kind: 'vertical_bar',
        description: '',
        fields: [
          { id: 'orders_region', label: '区域', role: 'dimension', type: 'string' },
          { id: 'orders_total', label: '销售额', role: 'metric', type: 'number' },
        ],
        filters: '',
        rows: [['华东', 1280.5], ['华北', null]],
        rowCount: 2,
        truncated: false,
        cellsTruncated: false,
      })
    }
  }

  it('mounts under ctx.bi and answers every operation', async () => {
    const ctx = new Context()
    await ctx.plugin(StubBi)
    const entries = await ctx.bi.catalog()
    expect(entries.map(entry => entry.displayName)).toEqual(['Demo YH'])
    const page = await ctx.bi.charts({ ref: BiProjectRef(ref()) })
    expect(page.charts.map(chart => chart.chartRef)).toEqual([`${ref()}/${CHART_UUID}`])
    const result = await ctx.bi.query({ chartRef: BiChartRef(`${ref()}/${CHART_UUID}`) })
    expect(result.rows).toEqual([['华东', 1280.5], ['华北', null]])
  })
})
