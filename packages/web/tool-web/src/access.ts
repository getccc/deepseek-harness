/**
 * The per-session web switch: the `/web` command that logs a `web/access`
 * event, the `webAccess` projection that folds it for clients, and the live
 * restriction that withholds this composition's web tools from an agent
 * whose Session has the switch off. The log owns the state: a fresh log gets
 * the deployment's initial value recorded when its agent is created, so a
 * resumed or forked Session is offered exactly what its log says.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import zod, { type ZodType } from 'zod'
import type {} from '@deepseek-ai/dsh-commands'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-session-projection'
import type { WebAccessProjection } from './types.ts'
import type {} from './types.ts'

/** The command that flips the switch: `/web`, `/web on`, `/web off`. */
export const WEB_ACCESS_COMMAND = 'web'

/**
 * Recover the Session's switch state from its log.
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

/** The projection value, validated before a persisted cache row seeds a fold. */
const webAccessSchema: ZodType<WebAccessProjection> = zod.object({
  enabled: zod.boolean().nullable(),
}).strict()

/**
 * The `webAccess` projection: the last logged `web/access` value, `null`
 * until one is logged. Registered by every `tool-web` row that mounts a
 * `sessionSwitch`; the registry shares one key across those rows.
 */
export const webAccessProjectionDefinition = {
  key: 'webAccess',
  stateVersion: 1,
  stateSchema: webAccessSchema,
  init: () => ({ enabled: null }),
  apply: (state, event) => event.type === 'web/access' ? { enabled: event.data.enabled } : state,
  wire: { viewSchema: webAccessSchema, view: state => state },
} satisfies ProjectionDefinition<'webAccess', WebAccessProjection>

/**
 * Mount the switch over the web tools this composition registered.
 *
 * The projection registers when a projection registry is composed and the
 * command when a command registry is; the restriction needs the agent
 * registry to find the agent driving a Session whose log just changed.
 * Listeners are registered through the mounting context, so a row inside an
 * agent preset observes exactly the agents joined under that preset.
 * @param ctx - the mounting context.
 * @param initial - the value a log without a `web/access` event receives when its agent is created.
 * @param names - the web tool names this composition registered; every one is withheld while the switch is off.
 */
export function installSessionSwitch(ctx: Context, initial: boolean, names: readonly string[]): void {
  ctx.inject(['sessionProjections'], (projectionCtx) => {
    projectionCtx.sessionProjections.register(webAccessProjectionDefinition)
  })

  ctx.inject(['commands'], (commandCtx) => {
    commandCtx.commands.register({
      name: WEB_ACCESS_COMMAND,
      description: 'Turn web search and page fetching on or off for this session',
      input: { hint: '[on|off]' },
      handler: ({ agent, rawInput }) => {
        const word = rawInput.trim()
        const current = foldWebAccess(agent.session.snapshotEvents()) ?? initial
        const wanted = word === '' ? !current : word === 'on' ? true : word === 'off' ? false : undefined
        if (wanted === undefined) return { kind: 'error', text: 'Usage: /web [on|off]' }
        if (wanted === current) {
          return { kind: 'success', text: wanted ? 'Web access is already on.' : 'Web access is already off.' }
        }
        agent.session.append('web/access', { enabled: wanted })
        return {
          kind: 'success',
          text: wanted
            ? 'Web access on: web search and page fetching are offered from the next step.'
            : 'Web access off: web search and page fetching are withheld from the next step.',
        }
      },
    })
  })

  ctx.inject(['agents'], (agentCtx) => {
    const lifted = new Map<Session, () => void>()

    /** Bring one agent's tool visibility in line with its Session's log, recording the initial value into a log without one. */
    const settle = (agent: Agent): void => {
      let enabled = foldWebAccess(agent.session.snapshotEvents())
      if (enabled === null) {
        enabled = initial
        agent.session.append('web/access', { enabled })
      }
      const masked = lifted.get(agent.session)
      if (enabled) {
        if (masked === undefined) return
        masked()
        lifted.delete(agent.session)
        return
      }
      if (masked !== undefined) return
      lifted.set(agent.session, agent.ctx.tools.restrict({ deny: [...names] }))
    }

    agentCtx.effect(() => agentCtx.on('agent/created', ({ agent }) => { settle(agent) }), 'tool-web: session switch at agent creation')
    agentCtx.effect(() => agentCtx.on('session/event', (session: Session, event: SessionEvent) => {
      if (event.type !== 'web/access') return
      const agent = agentCtx.agents.get(session.id)
      if (agent !== undefined) settle(agent)
    }), 'tool-web: session switch on a logged change')
    agentCtx.effect(() => agentCtx.on('agent/disposed', ({ agent }) => {
      // Lifted rather than merely forgotten: disposing the agent usually takes
      // its scope and every registration on it, but a forgotten handle over a
      // scope that outlived its agent would be a restriction nothing removes.
      lifted.get(agent.session)?.()
      lifted.delete(agent.session)
    }), 'tool-web: release a disposed agent')
  })
}
