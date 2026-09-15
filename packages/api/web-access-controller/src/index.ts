/**
 * Host Remote owner for the Session web switch.
 *
 * The browser cannot append a Session event directly, so the composer's web
 * chip asks here to read and set whether one conversation's agent is offered
 * the web tools. Both reads ask the web service whether the deployment
 * permits this member to search at all, so a member it does not permit is
 * refused and sees no switch. Setting the switch records the same `web/access` event the
 * `/web` command does, without a command node in the transcript, so a chip
 * clicked ten times leaves ten log-only events and nothing on screen.
 * @module @deepseek-ai/dsh-api-web-access-controller
 */

import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
// Type-only: pulls the `web/access` SessionEventMap merge the fold reads.
import type {} from '@deepseek-ai/dsh-tool-web/types'
// Type-only: pulls the web service merge (ctx.web) the permission check reads.
import type {} from '@deepseek-ai/dsh-web'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import type { WebAccessView } from './types.ts'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /**
     * No switch for this Session: the deployment does not permit this member
     * to search, or the composition records no `web/access` event.
     */
    'web-access/unavailable': {}
    /** The addressed Session is not open in this process. */
    'web-access/session-not-open': {}
  }
}

export type { WebAccessView } from './types.ts'

const stateRequestSchema = z.object({ sessionId: z.string().min(1) })
const setRequestSchema = z.object({ sessionId: z.string().min(1), enabled: z.boolean() })

/**
 * The Session's switch as its log states it.
 * @param events - the Session's committed events, in order.
 * @returns the last recorded value, or `null` when the log records none.
 */
function foldWebAccess(events: readonly SessionEvent[]): boolean | null {
  let enabled: boolean | null = null
  for (const event of events) {
    if (event.type === 'web/access') enabled = event.data.enabled
  }
  return enabled
}

/** Host service backing the generated `ctx.remote.webAccess` namespace. */
export class WebAccessController extends TypertRemoteService {
  static inject = ['agents', 'typert', 'web']

  /** @param ctx - Host context carrying the agent registry. */
  constructor(ctx: Context) {
    super(ctx, 'webAccessController', { namespace: 'webAccess' })
  }

  /**
   * The Session's current switch.
   * @param sessionId - the Session whose switch is read.
   * @returns the switch as the log states it.
   * @throws RemoteError when the Session is not open here or its composition offers no switch.
   */
  @Remote('state')
  async state(sessionId: string): Promise<WebAccessView> {
    const request = stateRequestSchema.safeParse({ sessionId })
    if (!request.success) throw new RemoteError('gateway/bad-request', 'invalid payload for webAccess.state', { issues: request.error.issues })
    const agent = this.agentOf(request.data.sessionId)
    await this.assertPermitted()
    return { enabled: this.enabledOf(agent) }
  }

  /**
   * Set one Session's switch. A value the log already states records nothing.
   * @param sessionId - the Session to set the switch on.
   * @param enabled - whether the agent is offered the web tools from the next step.
   * @returns the switch as it now stands.
   * @throws RemoteError when the request is invalid, the Session is not open here, or its composition offers no switch.
   */
  @Remote('set')
  async set(sessionId: string, enabled: boolean): Promise<WebAccessView> {
    const request = setRequestSchema.safeParse({ sessionId, enabled })
    if (!request.success) throw new RemoteError('gateway/bad-request', 'invalid payload for webAccess.set', { issues: request.error.issues })
    const agent = this.agentOf(request.data.sessionId)
    await this.assertPermitted()
    if (this.enabledOf(agent) !== request.data.enabled) {
      // Synchronous: the log is the durable source of truth, so a bad event
      // fails here rather than during a later flush.
      agent.session.append('web/access', { enabled: request.data.enabled })
    }
    return { enabled: request.data.enabled }
  }

  /** The deployment's decision for this member, asked fresh so a revoked grant hides the switch on the next read. */
  private async assertPermitted(): Promise<void> {
    if (await this.ctx.web.searchPermitted()) return
    throw new RemoteError('web-access/unavailable', 'this account is not allowed to search the web', {})
  }

  /** The live agent driving one Session, or the refusal that it is not open here. */
  private agentOf(sessionId: string): Agent {
    const agent = this.ctx.agents.get(SessionId(sessionId))
    if (agent === undefined) {
      throw new RemoteError('web-access/session-not-open', 'that conversation is not open', {})
    }
    return agent
  }

  /** The switch the log states, or the refusal that this composition offers none. */
  private enabledOf(agent: Agent): boolean {
    const enabled = foldWebAccess(agent.session.snapshotEvents())
    if (enabled === null) {
      throw new RemoteError('web-access/unavailable', 'this conversation has no web switch', {})
    }
    return enabled
  }
}

export default WebAccessController
