/**
 * Host Remote owner for the Session office-deliverable choice.
 *
 * The browser cannot append a Session event directly, so the composer chip
 * asks here to read and record which document kind a conversation should
 * produce. This is a Team-only namespace mounted with the office tool: a build
 * without it never grows a namespace whose every call would fail.
 * @module @deepseek-ai/dsh-api-office-controller
 */

import { Context } from '@deepseek-ai/cordis'
import { parseOfficeChoice, foldOfficeChoice } from '@deepseek-ai/dsh-office'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import type { OfficeChoiceView } from './types.ts'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The requested office kind is not one this build ships. */
    'office/invalid-kind': { readonly kind: string }
    /** The addressed Session is not open in this process. */
    'office/session-not-open': {}
  }
}

export type { OfficeChoiceView } from './types.ts'

const sessionRequestSchema = z.object({ sessionId: z.string().min(1) })
const chooseRequestSchema = z.object({ sessionId: z.string().min(1), kind: z.string().min(1) })

/**
 * Read one request, refusing what no call could act on.
 * @param method - the method name, for the failure message.
 * @param schema - the request schema.
 * @param value - the candidate request.
 * @returns the parsed request.
 */
function parseRequest<T>(method: string, schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value)
  if (parsed.success) return parsed.data
  throw new RemoteError('gateway/bad-request', `invalid payload for ${method}`, { issues: parsed.error.issues })
}

/** Host service backing the generated `ctx.remote.office` namespace. */
export class OfficeController extends TypertRemoteService {
  static inject = ['agents', 'typert']

  /** @param ctx - Host context carrying the agent registry. */
  constructor(ctx: Context) {
    super(ctx, 'officeController', { namespace: 'office' })
  }

  /**
   * The Session's current office choice.
   * @param sessionId - the Session whose choice is read.
   * @returns the folded choice.
   * @throws RemoteError when the Session is not open here.
   */
  @Remote('scope')
  async scope(sessionId: string): Promise<OfficeChoiceView> {
    const request = parseRequest('office.scope', sessionRequestSchema, { sessionId })
    const choice = foldOfficeChoice(this.agentOf(request.sessionId).session.snapshotEvents())
    return Promise.resolve({ choice: { version: 1, kind: choice.kind } })
  }

  /**
   * Record one Session's office choice.
   * @param sessionId - the Session to record the choice in.
   * @param kind - the chosen kind, or `none` to impose no format.
   * @returns the Session's choice as it now stands.
   * @throws RemoteError when the request is invalid or the Session is not open here.
   */
  @Remote('choose')
  async choose(sessionId: string, kind: string): Promise<OfficeChoiceView> {
    const request = parseRequest('office.choose', chooseRequestSchema, { sessionId, kind })
    const choice = parseOfficeChoice({ version: 1, kind: request.kind })
    if (choice === undefined) {
      throw new RemoteError('office/invalid-kind', `unknown office kind ${JSON.stringify(request.kind)}`, { kind: request.kind })
    }
    const agent = this.agentOf(request.sessionId)
    // Synchronous: the log is the durable source of truth, so a bad event
    // fails here rather than during a later flush.
    agent.session.append('office/kind', choice)
    return Promise.resolve({ choice: { version: 1, kind: choice.kind } })
  }

  /** The live agent driving one Session, or the refusal that it is not open here. */
  private agentOf(sessionId: string): Agent {
    const agent = this.ctx.agents.get(SessionId(sessionId))
    if (agent === undefined) {
      throw new RemoteError('office/session-not-open', 'that conversation is not open', {})
    }
    return agent
  }
}

export default OfficeController
