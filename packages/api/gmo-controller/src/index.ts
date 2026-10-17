/**
 * Host Remote owner for GMO supply-chain analysis: the authorized category directory a
 * browser reads, and the Session category choice it records.
 *
 * The browser cannot reach `ctx.gmo` directly — the GMO service lives on the
 * Host, and its provider is what holds the device token — so the composer
 * control asks here instead. This is a Team-only namespace: a composition
 * without GMO supply-chain analysis does not mount it, which is why it is its own package
 * rather than more surface on the session controller, where an absent service
 * would have to read as an empty directory.
 * @module @deepseek-ai/dsh-api-gmo-controller
 */

import { Context } from '@deepseek-ai/cordis'
import { GmoError, GmoCategoryRef, foldGmoScope, isGmoCategoryRef, type GmoScope } from '@deepseek-ai/dsh-gmo'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import type { GmoChoice, GmoScopeView, GmoScopeWire } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** A `selected` choice named no category. */
    'gmo/no-category': {}
    /** The reference is not a category this member may analyze. */
    'gmo/not-available': { readonly categoryRef: string }
    /** The category directory could not be read from the Control Plane. */
    'gmo/unavailable': { readonly reason: string }
    /** The addressed Session is not open in this process. */
    'gmo/session-not-open': {}
  }
}

const sessionRequestSchema = z.object({ sessionId: z.string().min(1) })

const chooseRequestSchema = z.object({
  sessionId: z.string().min(1),
  mode: z.union([z.literal('off'), z.literal('selected')]),
  categoryRef: z.string().optional(),
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

/** The scope as the wire carries it: the same value, with its reference a plain string. */
function wireOf(scope: GmoScope): GmoScopeWire {
  return scope.mode === 'off'
    ? { version: 1, mode: 'off' }
    : { version: 1, mode: 'selected', category: { ref: scope.category.ref, displayName: scope.category.displayName } }
}

/** Host service backing the generated `ctx.remote.gmo` namespace. */
export class GmoController extends TypertRemoteService {
  static inject = ['agents', 'gmo', 'typert']

  /** @param ctx - Host context carrying the GMO service and the agent registry. */
  constructor(ctx: Context) {
    super(ctx, 'gmoController', { namespace: 'gmo' })
  }

  /**
   * What one Session may choose from, and what it has chosen.
   *
   * The directory is read on every open rather than cached: a grant revoked
   * since the last look should narrow the control, and a category an
   * administrator switched off should leave it.
   * @param sessionId - the Session whose scope is being read.
   * @returns the authorized choices, the current scope, and whether that scope has gone stale.
   * @throws RemoteError when the Session is unknown or the directory cannot be reached.
   */
  @Remote('scope')
  async scope(sessionId: string): Promise<GmoScopeView> {
    const request = parseRequest('gmo.scope', sessionRequestSchema, { sessionId })
    const scope = this.scopeOf(request.sessionId)
    const choices = await this.directory()
    return {
      choices,
      scope: wireOf(scope),
      unavailable: scope.mode === 'selected' && !choices.some(choice => choice.categoryRef === scope.category.ref),
    }
  }

  /**
   * Record one Session's category choice.
   *
   * The display name is taken from the authorized directory as it stands now
   * and written into the event, because the prompt names it and a
   * model-visible name has to be reconstructable from the log. A reference the
   * directory does not hold is refused rather than recorded: the Control Plane
   * would refuse it at run time anyway, and recording it would put a promise
   * in the log that no run can keep.
   * @param sessionId - the Session to record the choice in.
   * @param mode - `off` or `selected`.
   * @param categoryRef - the chosen category, required for `selected`.
   * @returns the Session's scope as it now stands.
   * @throws RemoteError when the request is invalid, the Session is unknown, or the category is not currently authorized.
   */
  @Remote('choose')
  async choose(sessionId: string, mode: string, categoryRef?: string): Promise<GmoScopeView> {
    const request = parseRequest('gmo.choose', chooseRequestSchema, { sessionId, mode, categoryRef })
    const agent = this.agentOf(request.sessionId)
    const scope = await this.buildScope(request.mode, request.categoryRef)
    // Synchronous: the log is the durable source of truth, so a bad event
    // fails here rather than during a later flush.
    agent.session.append('gmo/scope', scope)
    return this.scope(request.sessionId)
  }

  /** Turn one requested mode into the scope value a Session records. */
  private async buildScope(mode: 'off' | 'selected', categoryRef: string | undefined): Promise<GmoScope> {
    if (mode === 'off') return { version: 1, mode }
    if (categoryRef === undefined || categoryRef === '') {
      throw new RemoteError('gmo/no-category', 'a category choice names a category', {})
    }
    const displayName = (await this.directory()).find(choice => choice.categoryRef === categoryRef)?.displayName
    if (!isGmoCategoryRef(categoryRef) || displayName === undefined) {
      throw new RemoteError('gmo/not-available', 'that GMO category is not available to this member', { categoryRef })
    }
    return { version: 1, mode: 'selected', category: { ref: GmoCategoryRef(categoryRef), displayName } }
  }

  /**
   * The categories this member may analyze right now.
   *
   * The closed reason travels with a failure so a control can say "sign in
   * again" or "the Control Plane is unreachable" rather than showing an empty
   * list, which would read as "you have access to nothing".
   */
  private async directory(): Promise<readonly GmoChoice[]> {
    try {
      return (await this.ctx.gmo.catalog()).map(entry => ({ categoryRef: entry.ref, displayName: entry.displayName }))
    } catch (error) {
      throw new RemoteError('gmo/unavailable', 'the GMO category directory could not be read', {
        reason: error instanceof GmoError ? error.reason : 'control-plane-unreachable',
      })
    }
  }

  /** One Session's folded scope, or the refusal that it is not open here. */
  private scopeOf(sessionId: string): GmoScope {
    // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
    return foldGmoScope(this.agentOf(sessionId).session.snapshotEvents())
  }

  /** The live agent driving one Session. */
  private agentOf(sessionId: string): Agent {
    const agent = this.ctx.agents.get(SessionId(sessionId))
    if (agent === undefined) {
      throw new RemoteError('gmo/session-not-open', 'that conversation is not open', {})
    }
    return agent
  }
}

export default GmoController
