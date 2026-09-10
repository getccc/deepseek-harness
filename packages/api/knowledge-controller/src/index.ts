/**
 * Host Remote owner for private knowledge: the authorized directory a browser
 * reads, and the Session scope choice it records.
 *
 * The browser cannot reach `ctx.knowledge` directly — the knowledge service
 * lives on the Host, and its provider is what holds the device token — so a
 * `/knowledge` picker asks here instead. This is a Team-only namespace: a
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
} from '@deepseek-ai/dsh-knowledge'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import type { KnowledgeChoice, KnowledgeScopeView } from './types.ts'

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

  /** The knowledge bases this member may search right now. */
  private async directory(): Promise<readonly KnowledgeChoice[]> {
    try {
      return (await this.ctx.knowledge.catalog()).map(entry => ({
        knowledgeRef: entry.ref,
        displayName: entry.displayName,
        description: entry.description,
      }))
    } catch (error) {
      // The closed reason travels so a picker can say "sign in again" or "the
      // Control Plane is unreachable" rather than showing an empty list, which
      // would read as "you have access to nothing".
      throw new RemoteError('knowledge/unavailable', 'private knowledge could not be read', { reason: error instanceof KnowledgeError ? error.reason : 'control-plane-unreachable' })
    }
  }

  /** One Session's folded scope, or the refusal that it is not open here. */
  private scopeOf(sessionId: string): KnowledgeScope {
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
