/**
 * Private knowledge, as a Team Runner reaches it: an outbound request to the
 * company Control Plane carrying the current device token and nothing else.
 *
 * What this sends is a query, or a governed reference, and nothing more.
 * What it does not send — and could not, because the protocol has no place for
 * it — is a knowledge address, a credential, a tenant, or an upstream id. The
 * decision about who may read what is made on the other side, on every call.
 * @module @deepseek-ai/dsh-knowledge-team
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  Knowledge,
  KnowledgeDocRef,
  KnowledgeError,
  KnowledgeRef,
  isKnowledgeDocRef,
  isKnowledgeRef,
  type KnowledgeBaseEntry,
  type KnowledgeDocument,
  type KnowledgeDocumentContent,
  type KnowledgeDocumentPage,
  type KnowledgeDocumentRequest,
  type KnowledgeDocumentState,
  type KnowledgeDocumentsRequest,
  type KnowledgeFailureReason,
  type KnowledgeKind,
  type KnowledgePassage,
  type KnowledgeSearchRequest,
  type KnowledgeSearchResult,
} from '@deepseek-ai/dsh-knowledge'
import {
  ACCESS_TOKEN_HEADER,
  KNOWLEDGE_CATALOG_PATH,
  KNOWLEDGE_DOCUMENTS_PATH,
  KNOWLEDGE_DOCUMENT_PATH,
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
  'unauthenticated', 'not-allowed', 'document-unavailable', 'scope-unavailable',
  'scope-incompatible', 'upstream-unavailable', 'upstream-invalid',
  'control-plane-unreachable', 'update-required', 'cancelled',
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

  async documents(request: KnowledgeDocumentsRequest): Promise<KnowledgeDocumentPage> {
    const body = await this.call(KNOWLEDGE_DOCUMENTS_PATH, {
      ref: request.ref,
      ...(request.page === undefined ? {} : { page: request.page }),
      ...(request.pageSize === undefined ? {} : { pageSize: request.pageSize }),
    }, request.signal)
    const documents = body['documents']
    const page = body['page']
    const pageSize = body['pageSize']
    if (!Array.isArray(documents) || typeof page !== 'number' || typeof pageSize !== 'number') {
      throw new KnowledgeError('upstream-invalid', 'document page is missing its fields')
    }
    const total = body['total']
    return {
      ref: request.ref,
      documents: documents.map(document => readDocument(document)),
      page,
      pageSize,
      // A total this build cannot read is reported as unknown rather than as
      // zero: a member must not be told the list ends where it does not.
      total: typeof total === 'number' && Number.isSafeInteger(total) && total >= 0 ? total : undefined,
    }
  }

  async documentContent(request: KnowledgeDocumentRequest): Promise<KnowledgeDocumentContent> {
    const body = await this.call(KNOWLEDGE_DOCUMENT_PATH, {
      docRef: request.docRef,
      ...(request.maxBytes === undefined ? {} : { maxBytes: request.maxBytes }),
    }, request.signal)
    const fileName = typeof body['fileName'] === 'string' ? body['fileName'] : ''
    if (body['kind'] === 'text') {
      const text = body['text']
      if (typeof text !== 'string') {
        throw new KnowledgeError('upstream-invalid', 'document text is missing')
      }
      return { kind: 'text', docRef: request.docRef, fileName, text, truncated: body['truncated'] === true }
    }
    const base64 = body['base64']
    const contentType = body['contentType']
    if (body['kind'] !== 'bytes' || typeof base64 !== 'string' || typeof contentType !== 'string') {
      throw new KnowledgeError('upstream-invalid', 'document content is missing its fields')
    }
    // No decode guard: `Buffer.from(…, 'base64')` accepts any string, dropping
    // what is not base64. Bytes that decode to nonsense are a file the Control
    // Plane encoded wrongly, which a renderer reports the same way it reports
    // any corrupt file — there is nothing a reason word here would add.
    const bytes = Uint8Array.from(Buffer.from(base64, 'base64'))
    return { kind: 'bytes', docRef: request.docRef, fileName, contentType, bytes }
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

/** Every document state the Control Plane may answer with, for decoding one back. */
const KNOWN_DOCUMENT_STATES: readonly string[] = ['ready', 'processing', 'unavailable']

/** Validate one document at the wire. */
function readDocument(value: unknown): KnowledgeDocument {
  const row = asRecord(value)
  const docRef = row['docRef']
  const ref = row['ref']
  if (typeof docRef !== 'string' || !isKnowledgeDocRef(docRef) || typeof ref !== 'string' || !isKnowledgeRef(ref)) {
    throw new KnowledgeError('upstream-invalid', 'a document is missing its reference')
  }
  const state = row['state']
  return {
    docRef: KnowledgeDocRef(docRef),
    ref: KnowledgeRef(ref),
    title: typeof row['title'] === 'string' ? row['title'] : '',
    fileName: typeof row['fileName'] === 'string' ? row['fileName'] : '',
    fileType: typeof row['fileType'] === 'string' ? row['fileType'] : '',
    byteSize: typeof row['byteSize'] === 'number' && Number.isSafeInteger(row['byteSize']) && row['byteSize'] >= 0
      ? row['byteSize']
      : 0,
    // A state this build does not know is read as unavailable, the reading
    // that promises least, rather than as the one it happens to resemble.
    state: typeof state === 'string' && KNOWN_DOCUMENT_STATES.includes(state)
      ? state as KnowledgeDocumentState
      : 'unavailable',
    updatedAt: typeof row['updatedAt'] === 'number' && Number.isFinite(row['updatedAt'])
      ? row['updatedAt']
      : undefined,
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
