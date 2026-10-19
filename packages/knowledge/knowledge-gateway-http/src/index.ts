/**
 * The Control Plane's Runner-facing knowledge endpoints.
 *
 * Every route is arranged around one fact: a request must not be able to say
 * who is asking or where the answer comes from. The
 * principal is recovered from a verified device token and never read from a
 * body; the source is resolved from the catalog and has no place in a request
 * at all.
 *
 * The protocol version is checked before any other field is decoded, so a
 * Runner this build cannot speak to is told to update rather than having its
 * fields interpreted under a grammar it did not mean.
 * @module @deepseek-ai/dsh-knowledge-gateway-http
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-device-authorization'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import {
  KnowledgeDocRef,
  KnowledgeError,
  KnowledgeRef,
  isKnowledgeDocRef,
  isKnowledgeRef,
  parseKnowledgeDocRef,
  type KnowledgeFailureReason,
  type KnowledgeScopeSelection,
} from '@deepseek-ai/dsh-knowledge'
import type {} from '@deepseek-ai/dsh-knowledge-gateway'
import {
  COMMON_REFUSAL_STATUS,
  governedHandler,
  readCount,
  type GovernedProtocol,
  type ParseRoute,
} from '@deepseek-ai/dsh-team-governed-wire'
import {
  KNOWLEDGE_CATALOG_PATH,
  KNOWLEDGE_DOCUMENTS_PATH,
  KNOWLEDGE_DOCUMENT_PATH,
  KNOWLEDGE_PROTOCOL_VERSION,
  KNOWLEDGE_SEARCH_PATH,
  MINIMUM_KNOWLEDGE_PROTOCOL_VERSION,
} from './protocol.ts'

export { readCount } from '@deepseek-ai/dsh-team-governed-wire'
export {
  ACCESS_TOKEN_HEADER,
  KNOWLEDGE_CATALOG_PATH,
  KNOWLEDGE_CATALOG_VERSION,
  KNOWLEDGE_DOCUMENTS_PATH,
  KNOWLEDGE_DOCUMENTS_VERSION,
  KNOWLEDGE_DOCUMENT_PATH,
  KNOWLEDGE_DOCUMENT_VERSION,
  KNOWLEDGE_PROTOCOL_VERSION,
  KNOWLEDGE_SEARCH_DOCUMENTS_VERSION,
  KNOWLEDGE_SEARCH_PATH,
  KNOWLEDGE_SEARCH_VERSION,
  MINIMUM_KNOWLEDGE_PROTOCOL_VERSION,
  type CatalogBody,
  type DocumentBody,
  type DocumentContentBody,
  type DocumentsBody,
  type KnowledgeProtocolRefusal,
  type KnowledgeRefusal,
  type SearchBody,
} from './protocol.ts'

/** Cordis plugin name. */
export const name = 'knowledge-gateway-http'
/** Services required before the endpoints may register. */
export const inject = ['webServer', 'knowledgeGateway', 'deviceAuthorization']

/** Plugin config: how much of a request the endpoints read. */
export interface Config {
  /** Largest request body accepted, in bytes. */
  maxRequestBodyBytes?: number
}

/** The largest request body accepted when a deployment names no bound. */
const DEFAULT_MAX_REQUEST_BODY_BYTES = 64 * 1024

/** Plugin config schema. */
export const Config: z<Config> = z.object({
  maxRequestBodyBytes: z.natural().min(1).default(DEFAULT_MAX_REQUEST_BODY_BYTES),
})

/** {@link Config} once schemastery has filled every defaulted field. */
type ResolvedConfig = Required<Config>

/** The HTTP status one closed refusal reason answers with; the shared words keep the governed wire's statuses. */
const STATUS_BY_REASON: Readonly<Record<KnowledgeFailureReason, number>> = {
  ...COMMON_REFUSAL_STATUS,
  'document-unavailable': 409,
  'scope-incompatible': 409,
}

/** The wire facts this Control Plane answers knowledge requests under. */
const PROTOCOL: GovernedProtocol<KnowledgeFailureReason> = {
  scope: 'knowledge',
  minimum: MINIMUM_KNOWLEDGE_PROTOCOL_VERSION,
  current: KNOWLEDGE_PROTOCOL_VERSION,
  statusByReason: STATUS_BY_REASON,
}

/**
 * Read the scope a search names, refusing anything that is not one.
 *
 * A malformed reference is refused here rather than passed on: the gateway
 * would refuse it too, but a request whose grammar this build does not
 * recognize is a protocol error, not an authorization outcome.
 * @param value - the decoded `scope` field.
 * @returns the selection, or undefined when the field is not a scope.
 */
export function readScope(value: unknown): KnowledgeScopeSelection | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  if (record['mode'] === 'all') return { mode: 'all' }
  if (record['mode'] === 'documents') return readDocumentScope(record)
  if (record['mode'] !== 'selected') return undefined
  const refs = record['refs']
  if (!Array.isArray(refs) || refs.length === 0) return undefined
  const parsed: KnowledgeRef[] = []
  for (const ref of refs as unknown[]) {
    if (typeof ref !== 'string' || !isKnowledgeRef(ref)) return undefined
    parsed.push(KnowledgeRef(ref))
  }
  return { mode: 'selected', refs: parsed }
}

/**
 * Read a document-narrowed scope, which is one knowledge base and the
 * documents inside it.
 *
 * Every document reference has to sit in the knowledge base the scope names:
 * the knowledge base is what gets authorized, so a document from elsewhere
 * would be searched under an admission that was never asked for.
 * @param record - the decoded `scope` object.
 * @returns the selection, or undefined when the field is not a document scope.
 */
function readDocumentScope(record: Record<string, unknown>): KnowledgeScopeSelection | undefined {
  const ref = record['ref']
  const docRefs = record['docRefs']
  if (typeof ref !== 'string' || !isKnowledgeRef(ref)) return undefined
  if (!Array.isArray(docRefs) || docRefs.length === 0) return undefined
  const parsed: KnowledgeDocRef[] = []
  for (const docRef of docRefs as unknown[]) {
    if (typeof docRef !== 'string' || !isKnowledgeDocRef(docRef)) return undefined
    if (parseKnowledgeDocRef(docRef)?.ref !== ref) return undefined
    parsed.push(KnowledgeDocRef(docRef))
  }
  return { mode: 'documents', ref: KnowledgeRef(ref), docRefs: parsed }
}

/**
 * Register the Runner-facing knowledge endpoints.
 * @param ctx - Host plugin context carrying the web server, the gateway, and device authorization.
 * @param config - resolved plugin config (schema defaults applied).
 */
export function apply(ctx: Context, config: Config): void {
  // schemastery (Config) has already filled every defaulted field.
  const { maxRequestBodyBytes: limit } = config as ResolvedConfig

  /** Serve one route under this capability's protocol. */
  const serve = (parse: ParseRoute) => governedHandler({
    reasonOf: error => error instanceof KnowledgeError ? error.reason : undefined,
    protocol: PROTOCOL,
    limit,
    verify: token => ctx.deviceAuthorization.verifyAccessToken(token),
  }, parse)

  const catalog: WebRoute = {
    kind: 'exact',
    path: KNOWLEDGE_CATALOG_PATH,
    handler: serve(opened => async () => ({ entries: await ctx.knowledgeGateway.directory(opened.principal) })),
  }

  const documents: WebRoute = {
    kind: 'exact',
    path: KNOWLEDGE_DOCUMENTS_PATH,
    handler: serve((opened) => {
      const ref = opened.body['ref']
      const page = readCount(opened.body['page'])
      const pageSize = readCount(opened.body['pageSize'])
      if (typeof ref !== 'string' || !isKnowledgeRef(ref) || page === 'invalid' || pageSize === 'invalid') return undefined
      return () => ctx.knowledgeGateway.documents({
        ...opened.principal,
        ref: KnowledgeRef(ref),
        ...(page === undefined ? {} : { page }),
        ...(pageSize === undefined ? {} : { pageSize }),
      })
    }),
  }

  const document: WebRoute = {
    kind: 'exact',
    path: KNOWLEDGE_DOCUMENT_PATH,
    handler: serve((opened) => {
      const docRef = opened.body['docRef']
      const maxBytes = readCount(opened.body['maxBytes'])
      if (typeof docRef !== 'string' || !isKnowledgeDocRef(docRef) || maxBytes === 'invalid') return undefined
      return async () => {
        const content = await ctx.knowledgeGateway.documentContent({
          ...opened.principal,
          docRef: KnowledgeDocRef(docRef),
          ...(maxBytes === undefined ? {} : { maxBytes }),
        })
        return content.kind === 'bytes'
          ? {
            kind: 'bytes',
            docRef: content.docRef,
            fileName: content.fileName,
            contentType: content.contentType,
            base64: Buffer.from(content.bytes).toString('base64'),
          }
          : content
      }
    }),
  }

  const search: WebRoute = {
    kind: 'exact',
    path: KNOWLEDGE_SEARCH_PATH,
    handler: serve((opened) => {
      const query = opened.body['query']
      const scope = readScope(opened.body['scope'])
      const maxResults = readCount(opened.body['maxResults'])
      const maxDocuments = readCount(opened.body['maxDocuments'])
      if (typeof query !== 'string' || query === '' || scope === undefined || maxResults === 'invalid' || maxDocuments === 'invalid') {
        return undefined
      }
      return () => ctx.knowledgeGateway.search({
        ...opened.principal,
        scope,
        query,
        ...(maxResults === undefined ? {} : { maxResults }),
        ...(maxDocuments === undefined ? {} : { maxDocuments }),
      })
    }),
  }

  ctx.effect(() => ctx.webServer.register(catalog), 'knowledge-gateway-http: catalog route')
  ctx.effect(() => ctx.webServer.register(documents), 'knowledge-gateway-http: documents route')
  ctx.effect(() => ctx.webServer.register(document), 'knowledge-gateway-http: document content route')
  ctx.effect(() => ctx.webServer.register(search), 'knowledge-gateway-http: search route')
}
