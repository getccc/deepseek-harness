/**
 * Host Remote owner for private knowledge: the authorized directory a browser
 * reads, the Session scope choice it records, and the retrieval a member runs
 * for themselves.
 *
 * The browser cannot reach `ctx.knowledge` directly — the knowledge service
 * lives on the Host, and its provider is what holds the device token — so the
 * `/knowledge` picker and the knowledge panels ask here instead. This is a Team-only namespace: a
 * composition without private knowledge does not mount it, which is why it is
 * its own package rather than more surface on the session controller, where an
 * absent service would have to read as an empty directory.
 * @module @deepseek-ai/dsh-api-knowledge-controller
 */

import { Context } from '@deepseek-ai/cordis'
import {
  isKnowledgeRef,
  KnowledgeRef,
  KnowledgeError,
  foldKnowledgeScope,
  type KnowledgeScope,
  type KnowledgeScopeSelection,
} from '@deepseek-ai/dsh-knowledge'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import type { KnowledgeChoice, KnowledgeScopeView, KnowledgeSearchView } from './types.ts'

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
  mode: z.union([z.literal('off'), z.literal('all'), z.literal('selected')]),
  knowledgeRefs: z.array(z.string()).optional(),
})

// The same bounds the Control Plane's own request parser applies: a non-empty
// query and, when given, a positive whole maximum. Everything else about how
// much may come back is the gateway's and the provider's to decide, and a
// second opinion here would refuse requests the Control Plane would serve.
const searchRequestSchema = z.object({
  query: z.string().min(1),
  mode: z.union([z.literal('all'), z.literal('selected')]),
  knowledgeRefs: z.array(z.string()).optional(),
  maxResults: z.number().int().min(1).optional(),
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
   * @param mode - `off`, `all`, or `selected`.
   * @param knowledgeRefs - the chosen references, required and non-empty for `selected`.
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
   * Run one retrieval for the member, outside any Session.
   *
   * The panel calling this starts no model turn and appends no Session event:
   * nothing here reaches a model, so nothing here has to be reconstructable
   * from a log. Authorization is untouched — the Control Plane evaluates every
   * knowledge base this names, on this call, exactly as it does for the tool.
   * @param query - the natural-language question.
   * @param mode - `all` for every currently authorized knowledge base, or `selected`.
   * @param knowledgeRefs - the chosen references, required and non-empty for `selected`.
   * @param maxResults - at most this many passages; the provider's own maximum still applies.
   * @returns the ranked passages and the knowledge bases actually searched.
   * @throws RemoteError when the request is invalid, a named reference is refused, or knowledge cannot be reached.
   */
  @Remote('search')
  async search(query: string, mode: string, knowledgeRefs?: string[], maxResults?: number): Promise<KnowledgeSearchView> {
    const request = parseRequest('knowledge.search', searchRequestSchema, { query, mode, knowledgeRefs, maxResults })
    const scope: KnowledgeScopeSelection = request.mode === 'all'
      ? { mode: 'all' }
      : { mode: 'selected', refs: this.refsOf(request.knowledgeRefs ?? []) }
    let result
    try {
      result = await this.ctx.knowledge.search({
        query: request.query,
        scope,
        ...(request.maxResults === undefined ? {} : { maxResults: request.maxResults }),
      })
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
    return refs.map((ref) => {
      if (!isKnowledgeRef(ref)) {
        throw new RemoteError('knowledge/not-available', 'that knowledge base is not available to this member', { knowledgeRef: ref })
      }
      return KnowledgeRef(ref)
    })
  }

  /** Turn one requested mode into the scope value a Session records. */
  private async buildScope(
    mode: 'off' | 'all' | 'selected',
    refs: readonly string[],
  ): Promise<KnowledgeScope> {
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
      return (await this.ctx.knowledge.catalog()).map(entry => ({
        knowledgeRef: entry.ref,
        displayName: entry.displayName,
        description: entry.description,
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
