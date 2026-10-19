/** Deterministic supply-chain results for the assembled report snapshot. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import {
  Gmo, GmoCategoryRef, GmoError, GmoResultRef,
  type GmoAnswer, type GmoAskRequest, type GmoCategoryEntry, type GmoDescribeRequest,
  type GmoDescription, type GmoJson, type GmoResultPage, type GmoResultsRequest,
} from '@deepseek-ai/dsh-gmo'

const CATEGORY = GmoCategoryRef('exceltools:gmo:gb')
const RESULT = GmoResultRef(`${CATEGORY}/00000000000000000000000000000001`)
const NAME = 'GB / GL 分配 · 2026-W43'
const BUCKETS = [
  { key: '2026-10-19', label: 'W43', sub: '2026-10-19 ~ 2026-10-25', start: '2026-10-19', end: '2026-10-25', current: true },
  { key: '2026-10-26', label: 'W44', sub: '2026-10-26 ~ 2026-11-01', start: '2026-10-26', end: '2026-11-01' },
]
const VIEWS: Record<string, { readonly [key: string]: GmoJson }> = {
  kpi: {
    total: 100, rows: 4, items: 2, projects: 1, overdue_qty: 0, overdue_rows: 0,
    this_week_qty: 30, next4_qty: 100, next12_qty: 100, next24_qty: 100, next48_qty: 100, no_date_rows: 0,
    week: 'W43', week_range: '2026-10-19 ~ 2026-10-25', overdue_before: '2026-10-19',
    this_week_to: '2026-10-25', next4_to: '2026-11-15', next12_to: '2027-01-10',
    next24_to: '2027-04-04', next48_to: '2027-09-19',
  },
  timeline: {
    buckets: BUCKETS, stack_label: '来源（GB/GL Vendor）', sub_label: null, no_date: 0,
    series: [{ name: 'Fujikin', values: [10, 30] }, { name: 'UCT', values: [20, 40] }],
  },
  ranking: {
    dim_label: '料号', total: 100, count: 2, others: { count: 0, value: 0 },
    items: [
      { key: 'PN-A', label: 'PN-A', sub: null, value: 60, rows: 2, share: 0.6, cum: 0.6 },
      { key: 'PN-B', label: 'PN-B', sub: null, value: 40, rows: 2, share: 0.4, cum: 1 },
    ],
  },
  flow: {
    levels: [{ field: 'gb_vendor', label: '来源' }, { field: 'brand', label: '子件品牌' }, { field: 'supplier', label: '子件供应商' }],
    nodes: [
      { id: 'source:f', name: 'Fujikin', level: 0, field: 'gb_vendor', other: false, value: 40 },
      { id: 'source:u', name: 'UCT', level: 0, field: 'gb_vendor', other: false, value: 60 },
      { id: 'brand:f', name: 'FUJIKIN', level: 1, field: 'brand', other: false, value: 100 },
      { id: 'supplier:f', name: 'FUJIKIN', level: 2, field: 'supplier', other: false, value: 100 },
    ],
    links: [
      { source: 'source:f', target: 'brand:f', value: 40 },
      { source: 'source:u', target: 'brand:f', value: 60 },
      { source: 'brand:f', target: 'supplier:f', value: 100 },
    ],
  },
  heatmap: {
    buckets: BUCKETS, dim_label: '料号',
    rows: [
      { key: 'PN-A', label: 'PN-A', total: 60, values: [20, 40] },
      { key: 'PN-B', label: 'PN-B', total: 40, values: [10, 30] },
    ],
  },
  quality: { checks: [{ label: '无日期', count: 0, filter: null }], issues: [] },
}

/** Read-only GMO provider with no credentials or live source dependency. */
export default class ReportSource extends Gmo {
  constructor(ctx: Context) {
    super(ctx)
    ctx.effect(() => ctx.on('agent/created', ({ agent }) => {
      agent.session.append('gmo/scope', {
        version: 1, mode: 'selected', category: { ref: CATEGORY, displayName: 'GB / GL 分配' },
      })
    }), 'report fixture: selected category')
  }

  catalog(): Promise<readonly GmoCategoryEntry[]> {
    return Promise.resolve([{ ref: CATEGORY, displayName: 'GB / GL 分配' }])
  }

  results(request: GmoResultsRequest): Promise<GmoResultPage> {
    return Promise.resolve({
      ref: request.ref, page: 1, pageSize: 20, total: 1,
      results: [{ resultRef: RESULT, ref: CATEGORY, name: NAME, toolName: 'GB / GL 分配',
        period: '2026-W43', rows: 4, createdAt: '2026-10-19T00:00:00Z', stages: [] }],
    })
  }

  describe(request: GmoDescribeRequest): Promise<GmoDescription> {
    return Promise.resolve({
      resultRef: request.resultRef, ref: CATEGORY, categoryLabel: 'GB / GL 分配', name: NAME,
      toolName: 'GB / GL 分配', period: '2026-W43', rows: 4, createdAt: '2026-10-19T00:00:00Z',
      today: '2026-10-19', weekStart: '2026-10-19', stages: [], sources: [],
      fields: [
        { key: 'gap', label: '净缺口', type: 'number', filter: '', description: '需求扣除自有库存后的缺口' },
        { key: 'date', label: '需求时间', type: 'date', filter: 'range', description: '' },
        { key: 'gb_vendor', label: '来源', type: 'string', filter: 'multi', description: '' },
        { key: 'pn', label: '料号', type: 'string', filter: 'search', description: '' },
      ],
      dashboard: {
        measure: 'gap', measureLabel: '净缺口', dateFields: [{ key: 'date', label: '需求时间' }],
        dims: { gb_vendor: '来源', pn: '料号' }, stackDims: ['gb_vendor'], rankDims: ['pn'], heatDims: ['pn'],
        flow: ['gb_vendor', 'brand', 'supplier'], subDim: '', balance: false, structure: false,
      },
      glossary: '净缺口以已处理结果为准。',
    })
  }

  ask(request: GmoAskRequest): Promise<GmoAnswer> {
    if (request.query.kind !== 'overview') return Promise.reject(new GmoError('unsupported', 'this fixture serves overview views'))
    const data = VIEWS[request.query.widget]
    if (data === undefined) return Promise.reject(new GmoError('unsupported', 'this result has no such view'))
    return Promise.resolve({ resultRef: request.resultRef, ref: CATEGORY, kind: 'overview', data })
  }
}
