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
  type KnowledgeScopeSelection,
  type KnowledgeSearchRequest,
  type KnowledgeSearchResult,
} from '@deepseek-ai/dsh-knowledge'
import {
  KNOWLEDGE_CATALOG_PATH,
  KNOWLEDGE_CATALOG_VERSION,
  KNOWLEDGE_DOCUMENTS_PATH,
  KNOWLEDGE_DOCUMENTS_VERSION,
  KNOWLEDGE_DOCUMENT_PATH,
  KNOWLEDGE_DOCUMENT_VERSION,
  KNOWLEDGE_SEARCH_DOCUMENTS_VERSION,
  KNOWLEDGE_SEARCH_PATH,
  KNOWLEDGE_SEARCH_VERSION,
} from '@deepseek-ai/dsh-knowledge-gateway-http'
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
const KNOWN_REASONS: readonly KnowledgeFailureReason[] = [...COMMON_REFUSAL_REASONS, 'document-unavailable', 'scope-incompatible']

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

  /**
   * One call to this capability's Control Plane endpoints, carrying this deployment's trust.
   *
   * The version is the operation's own, not this build's newest: a deployment
   * that predates one route keeps serving the others, so a Runner updated
   * first still reads its directory and still searches ([rule](../../knowledge-gateway-http/README.md#the-version-is-decided-first)).
   */
  private readonly call: GovernedClient

  constructor(ctx: Context, public config: Config) {
    super(ctx)
    this.call = governedClient({
      fail: (reason, message) => new KnowledgeError(reason, message),
      reasons: KNOWN_REASONS,
      fetch: controlPlaneFetch(ctx, config.controlPlaneCa),
      baseUrl: config.controlPlaneUrl,
      account: ctx.teamAccountClient,
    })
  }

  async catalog(signal?: AbortSignal): Promise<readonly KnowledgeBaseEntry[]> {
    const body = await this.call(KNOWLEDGE_CATALOG_PATH, KNOWLEDGE_CATALOG_VERSION, {}, signal)
    const entries = body['entries']
    if (!Array.isArray(entries)) throw new KnowledgeError('upstream-invalid', 'directory is not a list')
    return entries.map(entry => readEntry(entry))
  }

  async documents(request: KnowledgeDocumentsRequest): Promise<KnowledgeDocumentPage> {
    const body = await this.call(KNOWLEDGE_DOCUMENTS_PATH, KNOWLEDGE_DOCUMENTS_VERSION, {
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
    const body = await this.call(KNOWLEDGE_DOCUMENT_PATH, KNOWLEDGE_DOCUMENT_VERSION, {
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
    const version = request.scope.mode === 'documents' ? KNOWLEDGE_SEARCH_DOCUMENTS_VERSION : KNOWLEDGE_SEARCH_VERSION
    const body = await this.call(KNOWLEDGE_SEARCH_PATH, version, {
      query: request.query,
      scope: scopeOf(request.scope),
      ...(request.maxResults === undefined ? {} : { maxResults: request.maxResults }),
      ...(request.maxDocuments === undefined ? {} : { maxDocuments: request.maxDocuments }),
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
}

/** Validate one directory entry at the wire. */
function readEntry(value: unknown): KnowledgeBaseEntry {
  const row = asRecord(value)
  const ref = row['ref']
  const displayName = row['displayName']
  if (typeof ref !== 'string' || !isKnowledgeRef(ref) || typeof displayName !== 'string') {
    throw new KnowledgeError('upstream-invalid', 'a knowledge base is missing its reference or name')
  }
  const documentCount = row['documentCount']
  const createdAt = row['createdAt']
  return {
    ref: KnowledgeRef(ref),
    displayName,
    description: typeof row['description'] === 'string' ? row['description'] : '',
    kind: row['kind'] === 'faq' ? 'faq' satisfies KnowledgeKind : 'document',
    // Both are absent from a Control Plane older than them, and a value this
    // build cannot read is reported as absent rather than as zero: a member
    // must not be told a knowledge base is empty because a field was odd.
    ...(typeof documentCount === 'number' && Number.isSafeInteger(documentCount) && documentCount >= 0
      ? { documentCount }
      : {}),
    ...(typeof createdAt === 'number' && Number.isSafeInteger(createdAt) && createdAt > 0
      ? { createdAt }
      : {}),
  }
}

/**
 * The scope one search request carries on the wire.
 *
 * Built by hand rather than forwarded, so a field this protocol does not have
 * cannot reach the Control Plane by riding along inside a selection.
 * @param scope - the selection this operation resolved to.
 * @returns the wire scope.
 */
function scopeOf(scope: KnowledgeScopeSelection): Record<string, unknown> {
  switch (scope.mode) {
    case 'all':
      return { mode: 'all' }
    case 'selected':
      return { mode: 'selected', refs: [...scope.refs] }
    case 'documents':
      return { mode: 'documents', ref: scope.ref, docRefs: [...scope.docRefs] }
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
    // Absent from a Control Plane older than the field, which reads as a
    // document the source has no summary for.
    description: typeof row['description'] === 'string' ? row['description'] : '',
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
  const docRef = row['docRef']
  return {
    ref: KnowledgeRef(ref),
    // A document reference this build cannot read is dropped, not refused: the
    // passage still names its knowledge base, and only "open it" is lost.
    ...(typeof docRef === 'string' && isKnowledgeDocRef(docRef) ? { docRef: KnowledgeDocRef(docRef) } : {}),
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
