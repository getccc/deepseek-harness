/**
 * Private knowledge, as a Team Runner reaches it: an outbound request to the
 * company Control Plane carrying the current device token and nothing else.
 *
 * What this sends is a query and the references a Session scope resolved to.
 * What it does not send — and could not, because the protocol has no place for
 * it — is a knowledge address, a credential, a tenant, or an upstream id. The
 * decision about who may read what is made on the other side, on every call.
 * @module @deepseek-ai/dsh-knowledge-team
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  Knowledge,
  KnowledgeError,
  KnowledgeRef,
  isKnowledgeRef,
  type KnowledgeBaseEntry,
  type KnowledgeFailureReason,
  type KnowledgeKind,
  type KnowledgePassage,
  type KnowledgeSearchRequest,
  type KnowledgeSearchResult,
} from '@deepseek-ai/dsh-knowledge'
import {
  ACCESS_TOKEN_HEADER,
  KNOWLEDGE_CATALOG_PATH,
  KNOWLEDGE_PROTOCOL_VERSION,
  KNOWLEDGE_SEARCH_PATH,
} from '@deepseek-ai/dsh-knowledge-gateway-http'
import {
  controlPlaneConfigFields,
  controlPlaneFetch,
  type ControlPlaneFetch,
  type Response,
} from '@deepseek-ai/dsh-team-account-client'

/** Every reason the Control Plane may answer with, for decoding one back. */
const KNOWN_REASONS: readonly string[] = [
  'unauthenticated', 'not-allowed', 'scope-unavailable', 'scope-incompatible',
  'upstream-unavailable', 'upstream-invalid', 'control-plane-unreachable',
  'update-required', 'cancelled',
]

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
export const name = 'knowledge-team'

/**
 * The Team knowledge provider.
 *
 * The access token is read per call rather than held, because the account
 * client refreshes it and a cached one would be the stale copy — the same
 * reason no knowledge credential comes here at all.
 */
export default class TeamKnowledge extends Knowledge {
  static inject = ['teamAccountClient']

  static Config: z<Config> = z.object({ ...controlPlaneConfigFields })

  /** The fetch every Control Plane call goes through, carrying this deployment's trust. */
  private readonly fetch: ControlPlaneFetch

  constructor(ctx: Context, public config: Config) {
    super(ctx)
    this.fetch = controlPlaneFetch(ctx, config.controlPlaneCa)
  }

  async catalog(signal?: AbortSignal): Promise<readonly KnowledgeBaseEntry[]> {
    const body = await this.call(KNOWLEDGE_CATALOG_PATH, {}, signal)
    const entries = body['entries']
    if (!Array.isArray(entries)) throw new KnowledgeError('upstream-invalid', 'directory is not a list')
    return entries.map(entry => readEntry(entry))
  }

  async search(request: KnowledgeSearchRequest): Promise<KnowledgeSearchResult> {
    const body = await this.call(KNOWLEDGE_SEARCH_PATH, {
      query: request.query,
      scope: request.scope.mode === 'all'
        ? { mode: 'all' }
        : { mode: 'selected', refs: [...request.scope.refs] },
      ...(request.maxResults === undefined ? {} : { maxResults: request.maxResults }),
    }, request.signal)
    const searched = body['searched']
    const passages = body['passages']
    if (!Array.isArray(searched) || !Array.isArray(passages) || typeof body['truncated'] !== 'boolean') {
      throw new KnowledgeError('upstream-invalid', 'search answer is missing its fields')
    }
    return {
      query: request.query,
      searched: searched.map(entry => readEntry(entry)),
      passages: passages.map(passage => readPassage(passage)),
      truncated: body['truncated'],
    }
  }

  /**
   * Perform one Control Plane call and return its decoded object.
   *
   * Every failure that is not an answer this build can read becomes
   * `control-plane-unreachable`: from a member's seat, a DNS failure, a TLS
   * failure, a proxy that ate the request, and a Control Plane that is down
   * are the same fact, and none of them is something they can act on
   * differently.
   */
  private async call(
    path: string,
    fields: Record<string, unknown>,
    signal: AbortSignal | undefined,
  ): Promise<Record<string, unknown>> {
    const token = await this.accessToken()
    let response: Response
    try {
      response = await this.fetch(new URL(path, this.config.controlPlaneUrl), {
        method: 'POST',
        headers: {
          [ACCESS_TOKEN_HEADER]: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ protocolVersion: KNOWLEDGE_PROTOCOL_VERSION, ...fields }),
        ...(signal === undefined ? {} : { signal }),
      })
    } catch {
      // Includes the caller's own abort, which reaches the tool as a
      // cancellation through its execution signal rather than through here.
      throw new KnowledgeError('control-plane-unreachable', 'the Control Plane did not answer')
    }
    let decoded: unknown
    try {
      decoded = await response.json()
    } catch {
      // A reverse proxy error page rather than a Control Plane answer.
      throw new KnowledgeError('control-plane-unreachable', 'the answer was not a Control Plane answer')
    }
    if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) {
      throw new KnowledgeError('control-plane-unreachable', 'the answer was not an object')
    }
    const body = decoded as Record<string, unknown>
    if (response.ok) return body
    throw new KnowledgeError(refusalOf(body), `the Control Plane answered HTTP ${String(response.status)}`)
  }

  /** The Runner's current access token, or the reason there is none. */
  private async accessToken(): Promise<string> {
    try {
      return await this.ctx.teamAccountClient.accessToken()
    } catch {
      // Not bound and refused are the same to a knowledge caller: neither is a
      // knowledge failure, and both are answered by signing this computer in.
      throw new KnowledgeError('unauthenticated', 'this computer is not signed in')
    }
  }
}

/**
 * Read the reason out of a refusal.
 *
 * An unknown word is treated as unreachable rather than passed through: a
 * Control Plane speaking reasons this build does not know is one this build
 * cannot act on, and inventing a meaning would tell a member to do something
 * that may not help.
 */
function refusalOf(body: Record<string, unknown>): KnowledgeFailureReason {
  const reason = body['reason']
  return typeof reason === 'string' && KNOWN_REASONS.includes(reason)
    ? reason as KnowledgeFailureReason
    : 'control-plane-unreachable'
}

/** Validate one directory entry at the wire. */
function readEntry(value: unknown): KnowledgeBaseEntry {
  const row = asRecord(value)
  const ref = row['ref']
  const displayName = row['displayName']
  if (typeof ref !== 'string' || !isKnowledgeRef(ref) || typeof displayName !== 'string') {
    throw new KnowledgeError('upstream-invalid', 'a knowledge base is missing its reference or name')
  }
  return {
    ref: KnowledgeRef(ref),
    displayName,
    description: typeof row['description'] === 'string' ? row['description'] : '',
    kind: row['kind'] === 'faq' ? 'faq' satisfies KnowledgeKind : 'document',
  }
}

/** Validate one passage at the wire. */
function readPassage(value: unknown): KnowledgePassage {
  const row = asRecord(value)
  const ref = row['ref']
  const text = row['text']
  if (typeof ref !== 'string' || !isKnowledgeRef(ref) || typeof text !== 'string') {
    throw new KnowledgeError('upstream-invalid', 'a passage is missing its reference or text')
  }
  return {
    ref: KnowledgeRef(ref),
    title: typeof row['title'] === 'string' ? row['title'] : '',
    text,
    truncated: row['truncated'] === true,
    score: typeof row['score'] === 'number' && Number.isFinite(row['score']) ? row['score'] : 0,
  }
}

/** Narrow one decoded array element to string-keyed fields. */
function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    throw new KnowledgeError('upstream-invalid', 'an entry is not an object')
  }
  return value as Record<string, unknown>
}
