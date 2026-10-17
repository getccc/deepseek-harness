/**
 * GMO supply-chain analysis, as a Team Runner reaches it: an outbound request
 * to the company Control Plane carrying the current device token and nothing
 * else.
 *
 * What this sends is a governed reference, a page, or a question from a closed
 * vocabulary, and nothing more. What it does not send, and could not, because
 * the protocol has no place for it, is a GMO address, a credential, an
 * upstream id, or a statement of its own. The decision about who may ask what
 * is made on the other side, on every call.
 * @module @deepseek-ai/dsh-gmo-team
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  Gmo,
  GmoCategoryRef,
  GmoError,
  GmoResultRef,
  isGmoCategoryRef,
  isGmoResultRef,
  type GmoAnswer,
  type GmoAskRequest,
  type GmoCategoryEntry,
  type GmoDashboard,
  type GmoDescribeRequest,
  type GmoDescription,
  type GmoFailureReason,
  type GmoField,
  type GmoJson,
  type GmoResultPage,
  type GmoResultSummary,
  type GmoResultsRequest,
  type GmoStage,
} from '@deepseek-ai/dsh-gmo'
import {
  GMO_ASK_PATH,
  GMO_CATALOG_PATH,
  GMO_DESCRIBE_PATH,
  GMO_PROTOCOL_VERSION,
  GMO_RESULTS_PATH,
} from '@deepseek-ai/dsh-gmo-gateway-http'
import {
  controlPlaneConfigFields,
  controlPlaneFetch,
} from '@deepseek-ai/dsh-team-account-client'
import {
  COMMON_REFUSAL_REASONS,
  governedClient,
  type GovernedClient,
} from '@deepseek-ai/dsh-team-governed-wire'

/** Every reason the Control Plane may answer with, for decoding one back: the shared words and this capability's own. */
const KNOWN_REASONS: readonly GmoFailureReason[] = [...COMMON_REFUSAL_REASONS, 'result-unavailable', 'unsupported', 'invalid-query', 'too-large']

/** Plugin config: which Control Plane this Runner belongs to. */
export interface Config {
  /**
   * Origin of the company Control Plane, such as `https://dsh.company.com`.
   *
   * Carried per row rather than read from the account client, matching the
   * company model transport. The desktop installer's generated profile patch
   * writes every row from one deployment fact, which is where a single source
   * of truth belongs.
   */
  controlPlaneUrl: string
  /**
   * Path to a PEM file whose certificates are the only ones this Runner
   * accepts for the Control Plane, carried per row for the same reason
   * `controlPlaneUrl` is.
   */
  controlPlaneCa?: string
}

/** Cordis plugin name. */
export const name = 'gmo-team'

/**
 * The Team GMO provider.
 *
 * The access token is read per call rather than held, because the account
 * client refreshes it and a cached one would be the stale copy, the same
 * reason no GMO credential comes here at all.
 */
export default class TeamGmo extends Gmo {
  static inject = ['teamAccountClient']

  static Config: z<Config> = z.object({ ...controlPlaneConfigFields })

  /** One call to this capability's Control Plane endpoints, carrying this deployment's trust. */
  private readonly call: GovernedClient

  constructor(ctx: Context, public config: Config) {
    super(ctx)
    this.call = governedClient({
      fail: (reason, message) => new GmoError(reason, message),
      reasons: KNOWN_REASONS,
      fetch: controlPlaneFetch(ctx, config.controlPlaneCa),
      baseUrl: config.controlPlaneUrl,
      account: ctx.teamAccountClient,
    })
  }

  async catalog(signal?: AbortSignal): Promise<readonly GmoCategoryEntry[]> {
    const body = await this.call(GMO_CATALOG_PATH, GMO_PROTOCOL_VERSION, {}, signal)
    const entries = body['entries']
    if (!Array.isArray(entries)) throw new GmoError('upstream-invalid', 'directory is not a list')
    return entries.map(entry => readEntry(entry))
  }

  async results(request: GmoResultsRequest): Promise<GmoResultPage> {
    const body = await this.call(GMO_RESULTS_PATH, GMO_PROTOCOL_VERSION, {
      ref: request.ref,
      ...(request.page === undefined ? {} : { page: request.page }),
      ...(request.pageSize === undefined ? {} : { pageSize: request.pageSize }),
    }, request.signal)
    const results = body['results']
    const page = body['page']
    const pageSize = body['pageSize']
    const total = body['total']
    if (!Array.isArray(results) || typeof page !== 'number' || typeof pageSize !== 'number') {
      throw new GmoError('upstream-invalid', 'result page is missing its fields')
    }
    return {
      ref: request.ref,
      results: results.map(result => readResult(result)),
      page,
      pageSize,
      total: count(total) ?? 0,
    }
  }

  async describe(request: GmoDescribeRequest): Promise<GmoDescription> {
    const body = await this.call(GMO_DESCRIBE_PATH, GMO_PROTOCOL_VERSION, { resultRef: request.resultRef }, request.signal)
    const ref = body['ref']
    if (typeof ref !== 'string' || !isGmoCategoryRef(ref)) {
      throw new GmoError('upstream-invalid', 'description is missing its category')
    }
    const dashboard = body['dashboard'] === undefined ? undefined : readDashboard(asRecord(body['dashboard']))
    return {
      resultRef: request.resultRef,
      ref: GmoCategoryRef(ref),
      categoryLabel: text(body['categoryLabel']),
      name: text(body['name']),
      toolName: text(body['toolName']),
      period: text(body['period']),
      rows: count(body['rows']) ?? 0,
      createdAt: text(body['createdAt']),
      today: text(body['today']),
      weekStart: text(body['weekStart']),
      stages: list(body['stages']).map(stage => readStage(stage)),
      fields: list(body['fields']).map(field => readField(field)),
      ...(dashboard === undefined ? {} : { dashboard }),
      sources: list(body['sources']).map((source) => {
        const row = asRecord(source)
        return { name: text(row['name']), slot: text(row['slot']), rows: count(row['rows']) }
      }),
      glossary: text(body['glossary']),
    }
  }

  async ask(request: GmoAskRequest): Promise<GmoAnswer> {
    const body = await this.call(GMO_ASK_PATH, GMO_PROTOCOL_VERSION, { resultRef: request.resultRef, query: request.query }, request.signal)
    const ref = body['ref']
    const data = body['data']
    if (typeof ref !== 'string' || !isGmoCategoryRef(ref) || !isRecord(data)) {
      throw new GmoError('upstream-invalid', 'answer is missing its fields')
    }
    return {
      resultRef: request.resultRef,
      ref: GmoCategoryRef(ref),
      kind: request.query.kind,
      data: data as { readonly [key: string]: GmoJson },
    }
  }
}

/** Validate one directory entry at the wire. */
function readEntry(value: unknown): GmoCategoryEntry {
  const row = asRecord(value)
  const ref = row['ref']
  const displayName = row['displayName']
  if (typeof ref !== 'string' || !isGmoCategoryRef(ref) || typeof displayName !== 'string') {
    throw new GmoError('upstream-invalid', 'a category is missing its reference or name')
  }
  return { ref: GmoCategoryRef(ref), displayName }
}

/** Validate one stage at the wire. */
function readStage(value: unknown): GmoStage {
  const row = asRecord(value)
  const resultRef = row['resultRef']
  if (typeof resultRef !== 'string' || !isGmoResultRef(resultRef)) {
    throw new GmoError('upstream-invalid', 'a stage is missing its reference')
  }
  return { key: text(row['key']), label: text(row['label']), resultRef: GmoResultRef(resultRef) }
}

/** Validate one result summary at the wire. */
function readResult(value: unknown): GmoResultSummary {
  const row = asRecord(value)
  const resultRef = row['resultRef']
  const ref = row['ref']
  if (typeof resultRef !== 'string' || !isGmoResultRef(resultRef) || typeof ref !== 'string' || !isGmoCategoryRef(ref)) {
    throw new GmoError('upstream-invalid', 'a result is missing its reference')
  }
  return {
    resultRef: GmoResultRef(resultRef),
    ref: GmoCategoryRef(ref),
    name: text(row['name']),
    toolName: text(row['toolName']),
    period: text(row['period']),
    rows: count(row['rows']) ?? 0,
    createdAt: text(row['createdAt']),
    stages: list(row['stages']).map(stage => readStage(stage)),
  }
}

/** Validate one column at the wire. */
function readField(value: unknown): GmoField {
  const row = asRecord(value)
  const key = row['key']
  if (typeof key !== 'string' || key === '') throw new GmoError('upstream-invalid', 'a field is missing its key')
  return {
    key,
    label: text(row['label']) || key,
    type: text(row['type']),
    filter: text(row['filter']),
    description: text(row['description']),
  }
}

/** Validate the dashboard summary at the wire. */
function readDashboard(row: Record<string, unknown>): GmoDashboard {
  const strings = (value: unknown): readonly string[] => list(value).map(item => text(item))
  const dims = isRecord(row['dims']) ? row['dims'] : {}
  return {
    measure: text(row['measure']),
    measureLabel: text(row['measureLabel']),
    dateFields: list(row['dateFields']).map((entry) => {
      const field = asRecord(entry)
      return { key: text(field['key']), label: text(field['label']) }
    }),
    dims: Object.fromEntries(Object.entries(dims).map(([key, label]) => [key, text(label)])),
    stackDims: strings(row['stackDims']),
    rankDims: strings(row['rankDims']),
    heatDims: strings(row['heatDims']),
    flow: strings(row['flow']),
    subDim: text(row['subDim']),
    balance: row['balance'] === true,
    structure: row['structure'] === true,
  }
}

/** A wire string, empty when the answer supplies none. */
function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** A wire whole number, or undefined when the answer supplies none this build can read. */
function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

/** A wire list, empty when the answer supplies none. */
function list(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value as readonly unknown[] : []
}

/** Whether a decoded value is a plain JSON object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Narrow one decoded array element to string-keyed fields. */
function asRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new GmoError('upstream-invalid', 'an entry is not an object')
  return value
}
