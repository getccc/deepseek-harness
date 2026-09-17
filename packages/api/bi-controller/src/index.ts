/**
 * Host Remote owner for BI analysis: the authorized project directory a
 * browser reads, and the Session project choice it records.
 *
 * The browser cannot reach `ctx.bi` directly — the BI service lives on the
 * Host, and its provider is what holds the device token — so the composer
 * control asks here instead. This is a Team-only namespace: a composition
 * without BI analysis does not mount it, which is why it is its own package
 * rather than more surface on the session controller, where an absent service
 * would have to read as an empty directory.
 * @module @deepseek-ai/dsh-api-bi-controller
 */

import { Context } from '@deepseek-ai/cordis'
import { BiError, BiProjectRef, foldBiScope, isBiProjectRef, type BiScope } from '@deepseek-ai/dsh-bi'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import type { BiChoice, BiScopeView, BiScopeWire } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** A `selected` choice named no project. */
    'bi/no-project': {}
    /** The reference is not a project this member may analyze. */
    'bi/not-available': { readonly projectRef: string }
    /** The project directory could not be read from the Control Plane. */
    'bi/unavailable': { readonly reason: string }
    /** The addressed Session is not open in this process. */
    'bi/session-not-open': {}
  }
}

const sessionRequestSchema = z.object({ sessionId: z.string().min(1) })

const chooseRequestSchema = z.object({
  sessionId: z.string().min(1),
  mode: z.union([z.literal('off'), z.literal('selected')]),
  projectRef: z.string().optional(),
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
function wireOf(scope: BiScope): BiScopeWire {
  return scope.mode === 'off'
    ? { version: 1, mode: 'off' }
    : { version: 1, mode: 'selected', project: { ref: scope.project.ref, displayName: scope.project.displayName } }
}

/** Host service backing the generated `ctx.remote.bi` namespace. */
export class BiController extends TypertRemoteService {
  static inject = ['agents', 'bi', 'typert']

  /** @param ctx - Host context carrying the BI service and the agent registry. */
  constructor(ctx: Context) {
    super(ctx, 'biController', { namespace: 'bi' })
  }

  /**
   * What one Session may choose from, and what it has chosen.
   *
   * The directory is read on every open rather than cached: a grant revoked
   * since the last look should narrow the control, and a project an
   * administrator switched off should leave it.
   * @param sessionId - the Session whose scope is being read.
   * @returns the authorized choices, the current scope, and whether that scope has gone stale.
   * @throws RemoteError when the Session is unknown or the directory cannot be reached.
   */
  @Remote('scope')
  async scope(sessionId: string): Promise<BiScopeView> {
    const request = parseRequest('bi.scope', sessionRequestSchema, { sessionId })
    const scope = this.scopeOf(request.sessionId)
    const choices = await this.directory()
    return {
      choices,
      scope: wireOf(scope),
      unavailable: scope.mode === 'selected' && !choices.some(choice => choice.projectRef === scope.project.ref),
    }
  }

  /**
   * Record one Session's project choice.
   *
   * The display name is taken from the authorized directory as it stands now
   * and written into the event, because the prompt names it and a
   * model-visible name has to be reconstructable from the log. A reference the
   * directory does not hold is refused rather than recorded: the Control Plane
   * would refuse it at run time anyway, and recording it would put a promise
   * in the log that no run can keep.
   * @param sessionId - the Session to record the choice in.
   * @param mode - `off` or `selected`.
   * @param projectRef - the chosen project, required for `selected`.
   * @returns the Session's scope as it now stands.
   * @throws RemoteError when the request is invalid, the Session is unknown, or the project is not currently authorized.
   */
  @Remote('choose')
  async choose(sessionId: string, mode: string, projectRef?: string): Promise<BiScopeView> {
    const request = parseRequest('bi.choose', chooseRequestSchema, { sessionId, mode, projectRef })
    const agent = this.agentOf(request.sessionId)
    const scope = await this.buildScope(request.mode, request.projectRef)
    // Synchronous: the log is the durable source of truth, so a bad event
    // fails here rather than during a later flush.
    agent.session.append('bi/scope', scope)
    return this.scope(request.sessionId)
  }

  /** Turn one requested mode into the scope value a Session records. */
  private async buildScope(mode: 'off' | 'selected', projectRef: string | undefined): Promise<BiScope> {
    if (mode === 'off') return { version: 1, mode }
    if (projectRef === undefined || projectRef === '') {
      throw new RemoteError('bi/no-project', 'a project choice names a project', {})
    }
    const displayName = (await this.directory()).find(choice => choice.projectRef === projectRef)?.displayName
    if (!isBiProjectRef(projectRef) || displayName === undefined) {
      throw new RemoteError('bi/not-available', 'that BI project is not available to this member', { projectRef })
    }
    return { version: 1, mode: 'selected', project: { ref: BiProjectRef(projectRef), displayName } }
  }

  /**
   * The projects this member may analyze right now.
   *
   * The closed reason travels with a failure so a control can say "sign in
   * again" or "the Control Plane is unreachable" rather than showing an empty
   * list, which would read as "you have access to nothing".
   */
  private async directory(): Promise<readonly BiChoice[]> {
    try {
      return (await this.ctx.bi.catalog()).map(entry => ({ projectRef: entry.ref, displayName: entry.displayName }))
    } catch (error) {
      throw new RemoteError('bi/unavailable', 'the BI project directory could not be read', {
        reason: error instanceof BiError ? error.reason : 'control-plane-unreachable',
      })
    }
  }

  /** One Session's folded scope, or the refusal that it is not open here. */
  private scopeOf(sessionId: string): BiScope {
    // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
    return foldBiScope(this.agentOf(sessionId).session.snapshotEvents())
  }

  /** The live agent driving one Session. */
  private agentOf(sessionId: string): Agent {
    const agent = this.ctx.agents.get(SessionId(sessionId))
    if (agent === undefined) {
      throw new RemoteError('bi/session-not-open', 'that conversation is not open', {})
    }
    return agent
  }
}

export default BiController
