/**
 * Host Remote owner for private knowledge: the authorized directory a browser
 * reads, the documents in one of its knowledge bases and what one of those
 * holds, the Session scope choice it records, and the retrieval a member runs
 * for themselves.
 *
 * The browser cannot reach `ctx.knowledge` directly — the knowledge service
 * lives on the Host, and its provider is what holds the device token — so the
 * `/knowledge` picker and the knowledge panels ask here instead. This is a
 * Team-only namespace: a composition without private knowledge does not mount
 * it, which is why it is its own package rather than more surface on the
 * session controller, where an absent service would have to read as an empty
 * directory.
 * @module @deepseek-ai/dsh-api-knowledge-controller
 */

import { Context } from '@deepseek-ai/cordis'
import {
  isKnowledgeDocRef,
  isKnowledgeRef,
  KnowledgeDocRef,
  KnowledgeRef,
  KnowledgeError,
  parseKnowledgeDocRef,
  foldKnowledgeScope,
  type KnowledgeScope,
  type KnowledgeScopeSelection,
} from '@deepseek-ai/dsh-knowledge'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import type {
  KnowledgeChoice, KnowledgeDocumentContentView, KnowledgeDocumentsView,
  KnowledgeScopeView, KnowledgeSearchView,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** A `selected` choice named no knowledge base. */
    'knowledge/empty-selection': {}
    /** The reference is not a knowledge base this member may use. */
    'knowledge/not-available': { readonly knowledgeRef: string }
    /** Private knowledge could not be read from the Control Plane. */
    'knowledge/unavailable': { readonly reason: string }
    /** The addressed Session is not open in this process. */
    'knowledge/session-not-open': {}
  }
}

const sessionRequestSchema = z.object({ sessionId: z.string().min(1) })

const chooseRequestSchema = z.object({
  sessionId: z.string().min(1),
  mode: z.union([z.literal('off'), z.literal('all'), z.literal('selected'), z.literal('documents')]),
  knowledgeRefs: z.array(z.string()).optional(),
})

const documentsRequestSchema = z.object({
  knowledgeRef: z.string().min(1),
  page: z.number().int().min(1).optional(),
})

// Every request names its subject and nothing else. How much may come back is
// the gateway's and the provider's to decide, and a second opinion here would
// refuse requests the Control Plane would serve.
const documentRequestSchema = z.object({
  docRef: z.string().min(1),
})

const searchRequestSchema = z.object({
  query: z.string().min(1),
  mode: z.union([z.literal('all'), z.literal('selected')]),
  knowledgeRefs: z.array(z.string()).optional(),
})

/**
 * Read one request, refusing what no call could act on.
 *
 * A malformed request is the caller's mistake and answers `bad-request`; it
 * never becomes an authorization outcome, which is the Control Plane's to
 * decide.
 */
function parseRequest<T>(method: string, schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value)
  if (parsed.success) return parsed.data
  throw new RemoteError('gateway/bad-request', `invalid payload for ${method}`, { issues: parsed.error.issues })
}

/** Host service backing the generated `ctx.remote.knowledge` namespace. */
export class KnowledgeController extends TypertRemoteService {
  static inject = ['agents', 'knowledge', 'typert']

  /** @param ctx - Host context carrying the knowledge service and the agent registry. */
  constructor(ctx: Context) {
    super(ctx, 'knowledgeController', { namespace: 'knowledge' })
  }

  /**
   * What one Session may choose from, and what it has chosen.
   *
   * The directory is read on every open rather than cached: a grant revoked
   * since the last look should narrow the picker, and a knowledge base an
   * administrator switched off should leave it.
   * @param sessionId - the Session whose scope is being read.
   * @returns the authorized choices, the current scope, and any stale selection.
   * @throws RemoteError when the Session is unknown or knowledge cannot be reached.
   */
  @Remote('scope')
  async scope(sessionId: string): Promise<KnowledgeScopeView> {
    const request = parseRequest('knowledge.scope', sessionRequestSchema, { sessionId })
    const scope = this.scopeOf(request.sessionId)
    const choices = await this.directory()
    const known = new Set(choices.map(choice => choice.knowledgeRef))
    return {
      choices,
      scope,
      unavailable: scope.mode === 'selected'
        ? scope.bases.filter(base => !known.has(base.ref)).map(base => base.ref)
        : [],
    }
  }

  /**
   * Record one Session's knowledge choice.
   *
   * The display names are taken from the authorized directory as it stands
   * now and written into the event, because the prompt names them and a
   * model-visible name has to be reconstructable from the log. A reference the
   * directory does not hold is refused rather than recorded: the Control Plane
   * would refuse it at search time anyway, and recording it would put a
   * promise in the log that no search can keep.
   * @param sessionId - the Session to record the choice in.
   * @param mode - `off`, `all`, `selected`, or `documents`.
   * @param knowledgeRefs - the chosen references: knowledge bases for `selected`,
   *   documents for `documents`, required and non-empty for both.
   * @returns the Session's scope as it now stands.
   * @throws RemoteError when the request is invalid, the Session is unknown, or a reference is not currently authorized.
   */
  @Remote('choose')
  async choose(sessionId: string, mode: string, knowledgeRefs?: string[]): Promise<KnowledgeScopeView> {
    const request = parseRequest('knowledge.choose', chooseRequestSchema, { sessionId, mode, knowledgeRefs })
    const agent = this.agentOf(request.sessionId)
    const scope = await this.buildScope(request.mode, request.knowledgeRefs ?? [])
    // Synchronous: the log is the durable source of truth, so a bad event
    // fails here rather than during a later flush.
    agent.session.append('knowledge/scope', scope)
    return this.scope(request.sessionId)
  }

  /**
   * One page of the documents in one authorized knowledge base.
   *
   * Needs no Session, for the same reason the directory does not: what a
   * member may browse is a current authorization question, not a property of a
   * conversation. The knowledge base is authorized on this call.
   * @param knowledgeRef - the knowledge base to list.
   * @param page - which page, counting from one; the first page when absent.
   * @returns the page, empty when the knowledge base holds no document.
   * @throws RemoteError when the request is invalid, the knowledge base is refused, or knowledge cannot be reached.
   */
  @Remote('documents')
  async documents(knowledgeRef: string, page?: number): Promise<KnowledgeDocumentsView> {
    const request = parseRequest('knowledge.documents', documentsRequestSchema, { knowledgeRef, page })
    const ref = this.refOf(request.knowledgeRef)
    let result
    try {
      result = await this.ctx.knowledge.documents({
        ref,
        ...(request.page === undefined ? {} : { page: request.page }),
      })
    } catch (error) {
      throw this.unavailable(error)
    }
    return {
      knowledgeRef: result.ref,
      documents: result.documents.map(document => ({
        docRef: document.docRef,
        knowledgeRef: document.ref,
        title: document.title,
        description: document.description,
        fileName: document.fileName,
        fileType: document.fileType,
        byteSize: document.byteSize,
        state: document.state,
        // Absent rather than undefined: the Remote boundary carries JSON, and
        // a field whose value is undefined is a field that is not there.
        ...(document.updatedAt === undefined ? {} : { updatedAt: document.updatedAt }),
      })),
      page: result.page,
      pageSize: result.pageSize,
      ...(result.total === undefined ? {} : { total: result.total }),
    }
  }

  /**
   * One document's content: the original file, or the source's parsed text
   * when the file is over the bound or the source holds none.
   *
   * The bytes are transient UI input. Nothing here writes them anywhere, and
   * the browser that decodes them holds them for as long as it draws them.
   * @param docRef - the document to read.
   * @returns the content, saying which of the two it is.
   * @throws RemoteError when the request is invalid, the document is refused, or knowledge cannot be reached.
   */
  @Remote('documentContent')
  async documentContent(docRef: string): Promise<KnowledgeDocumentContentView> {
    const request = parseRequest('knowledge.documentContent', documentRequestSchema, { docRef })
    if (!isKnowledgeDocRef(request.docRef)) {
      throw new RemoteError('knowledge/not-available', 'that document is not available to this member', { knowledgeRef: request.docRef })
    }
    let content
    try {
      content = await this.ctx.knowledge.documentContent({ docRef: KnowledgeDocRef(request.docRef) })
    } catch (error) {
      throw this.unavailable(error)
    }
    return content.kind === 'bytes'
      ? {
        kind: 'bytes',
        docRef: content.docRef,
        fileName: content.fileName,
        contentType: content.contentType,
        base64: Buffer.from(content.bytes).toString('base64'),
      }
      : {
        kind: 'text',
        docRef: content.docRef,
        fileName: content.fileName,
        text: content.text,
        truncated: content.truncated,
      }
  }

  /**
   * Run one retrieval for the member, outside any Session.
   *
   * The panel calling this starts no model turn and appends no Session event:
   * nothing here reaches a model, so nothing here has to be reconstructable
   * from a log. Authorization is untouched — the Control Plane evaluates every
   * knowledge base this names, on this call, exactly as it does for the tool.
   * @param query - the natural-language question.
   * @param mode - `all` for every currently authorized knowledge base, or `selected`.
   * @param knowledgeRefs - the chosen references, required and non-empty for `selected`.
   * @returns the ranked passages and the knowledge bases actually searched.
   * @throws RemoteError when the request is invalid, a named reference is refused, or knowledge cannot be reached.
   */
  @Remote('search')
  async search(query: string, mode: string, knowledgeRefs?: string[]): Promise<KnowledgeSearchView> {
    const request = parseRequest('knowledge.search', searchRequestSchema, { query, mode, knowledgeRefs })
    const scope: KnowledgeScopeSelection = request.mode === 'all'
      ? { mode: 'all' }
      : { mode: 'selected', refs: this.refsOf(request.knowledgeRefs ?? []) }
    let result
    try {
      // No caller-set bound: the deployment's own maximum is the only one a
      // browser surface has ever wanted, and a knob nothing sets is a knob
      // that only shows up as a wrong argument count at the generated client.
      result = await this.ctx.knowledge.search({ query: request.query, scope })
    } catch (error) {
      throw this.unavailable(error)
    }
    // Names come from what was searched rather than from a second directory
    // read: `all` expands on the Control Plane, so this is the only answer
    // that names the knowledge bases this retrieval actually reached.
    const names = new Map(result.searched.map(entry => [entry.ref as string, entry.displayName]))
    return {
      query: result.query,
      searched: result.searched.map(entry => ({
        knowledgeRef: entry.ref,
        displayName: entry.displayName,
        description: entry.description,
      })),
      passages: result.passages.map(passage => ({
        knowledgeRef: passage.ref,
        ...(passage.docRef === undefined ? {} : { docRef: passage.docRef }),
        knowledgeName: names.get(passage.ref) ?? '',
        title: passage.title,
        text: passage.text,
        truncated: passage.truncated,
        score: passage.score,
      })),
      truncated: result.truncated,
    }
  }

  /**
   * Read the references one retrieval names, refusing what no call could use.
   *
   * Syntax alone is checked here. Whether a well-formed reference is one this
   * member may search is the Control Plane's decision, made on the call that
   * follows; anticipating it would cost a directory read per keystroke and
   * could still disagree with the answer that matters.
   */
  private refsOf(refs: readonly string[]): readonly KnowledgeRef[] {
    if (refs.length === 0) {
      throw new RemoteError('knowledge/empty-selection', 'a knowledge selection names at least one knowledge base', {})
    }
    return refs.map(ref => this.refOf(ref))
  }

  /** One reference, refused as unavailable when it is not one at all. */
  private refOf(value: string): KnowledgeRef {
    if (!isKnowledgeRef(value)) {
      throw new RemoteError('knowledge/not-available', 'that knowledge base is not available to this member', { knowledgeRef: value })
    }
    return KnowledgeRef(value)
  }

  /** Turn one requested mode into the scope value a Session records. */
  private async buildScope(
    mode: 'off' | 'all' | 'selected' | 'documents',
    refs: readonly string[],
  ): Promise<KnowledgeScope> {
    if (mode === 'documents') return this.buildDocumentScope(refs)
    if (mode !== 'selected') return { version: 1, mode }
    if (refs.length === 0) {
      throw new RemoteError('knowledge/empty-selection', 'a knowledge selection names at least one knowledge base', {})
    }
    const authorized = new Map((await this.directory()).map(choice => [choice.knowledgeRef, choice.displayName]))
    const bases = refs.map((ref) => {
      const displayName = authorized.get(ref)
      if (!isKnowledgeRef(ref) || displayName === undefined) {
        throw new RemoteError('knowledge/not-available', 'that knowledge base is not available to this member', { knowledgeRef: ref })
      }
      return { ref: KnowledgeRef(ref), displayName }
    })
    return { version: 1, mode: 'selected', bases }
  }

  /**
   * Turn a document selection into the scope value a Session records.
   *
   * Every document has to sit in one knowledge base, and that knowledge base
   * has to be one the directory holds now — the same rule a knowledge-base
   * selection follows, for the same reason: the recorded name reaches a
   * prompt, so it has to have been earned at the moment of choice.
   */
  private async buildDocumentScope(docRefs: readonly string[]): Promise<KnowledgeScope> {
    const [head] = docRefs
    if (head === undefined) {
      throw new RemoteError('knowledge/empty-selection', 'a document selection names at least one document', {})
    }
    const ref = parseKnowledgeDocRef(head)?.ref
    if (ref === undefined) {
      throw new RemoteError('knowledge/not-available', 'that document is not available to this member', { knowledgeRef: head })
    }
    const chosen = docRefs.map((docRef) => {
      // Every document has to be in the knowledge base the first one named:
      // that knowledge base is what gets authorized, and a document from
      // elsewhere would ride an admission nobody asked for.
      if (parseKnowledgeDocRef(docRef)?.ref !== ref) {
        throw new RemoteError('knowledge/not-available', 'that document is not available to this member', { knowledgeRef: docRef })
      }
      return KnowledgeDocRef(docRef)
    })
    const displayName = (await this.directory()).find(choice => choice.knowledgeRef === ref)?.displayName
    if (displayName === undefined) {
      throw new RemoteError('knowledge/not-available', 'that knowledge base is not available to this member', { knowledgeRef: ref })
    }
    // Recorded as a one-knowledge-base selection carrying its documents: an
    // optional field is a same-version persistence addition, where a mode of
    // its own would have been a format-version bump.
    return { version: 1, mode: 'selected', bases: [{ ref, displayName, docRefs: chosen }] }
  }

  /**
   * The knowledge bases this member may search right now.
   *
   * Read on every call rather than cached: a grant revoked since the last look
   * should narrow what a panel shows, and a knowledge base an administrator
   * switched off should leave it.
   * @returns the authorized directory, empty when the member holds nothing.
   * @throws RemoteError when knowledge cannot be reached or the member cannot be established.
   */
  @Remote('directory')
  async directory(): Promise<readonly KnowledgeChoice[]> {
    try {
      // Conditional spreads, not `?? undefined`: a Remote boundary carries
      // JSON, where an absent field and one set to undefined are not the same.
      return (await this.ctx.knowledge.catalog()).map(entry => ({
        knowledgeRef: entry.ref,
        displayName: entry.displayName,
        description: entry.description,
        ...(entry.documentCount === undefined ? {} : { documentCount: entry.documentCount }),
        ...(entry.createdAt === undefined ? {} : { createdAt: entry.createdAt }),
      }))
    } catch (error) {
      throw this.unavailable(error)
    }
  }

  /**
   * The refusal a failed knowledge operation reaches the browser as.
   *
   * The closed reason travels so a surface can say "sign in again" or "the
   * Control Plane is unreachable" rather than showing an empty list, which
   * would read as "you have access to nothing".
   */
  private unavailable(error: unknown): RemoteError<'knowledge/unavailable'> {
    return new RemoteError('knowledge/unavailable', 'private knowledge could not be read', { reason: error instanceof KnowledgeError ? error.reason : 'control-plane-unreachable' })
  }

  /** One Session's folded scope, or the refusal that it is not open here. */
  private scopeOf(sessionId: string): KnowledgeScope {
    // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
    return foldKnowledgeScope(this.agentOf(sessionId).session.snapshotEvents())
  }

  /** The live agent driving one Session. */
  private agentOf(sessionId: string): Agent {
    const agent = this.ctx.agents.get(SessionId(sessionId))
    if (agent === undefined) {
      throw new RemoteError('knowledge/session-not-open', 'that conversation is not open', {})
    }
    return agent
  }
}

export default KnowledgeController
