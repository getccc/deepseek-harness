/**
 * The per-session web switch: the `/web` command that logs a `web/access`
 * event, the `webAccess` projection that folds it for clients, and the live
 * restriction that withholds this composition's web tools from an agent
 * whose Session has the switch off. The log owns the state: a fresh log gets
 * the deployment's initial value recorded when its agent is created, so a
 * resumed or forked Session is offered exactly what its log says. The switch
 * is offered only to a member the web service's search provider permits;
 * anyone else keeps the tools withheld with nothing logged and no command.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import zod, { type ZodType } from 'zod'
import type { CommandDefinition } from '@deepseek-ai/dsh-commands'
import type { CommandDefinitionId } from '@deepseek-ai/dsh-commands/brand'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createScope, scopeOf } from '@deepseek-ai/dsh-scope'
import type {} from '@deepseek-ai/dsh-web'
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
 * The projection registers when a projection registry is composed. The
 * restriction, the initial event, and the `/web` command are settled per
 * agent when it is created: the tools are withheld at once, then the web
 * service is asked whether the deployment permits this member to search at
 * all. A member it does not permit keeps the tools withheld, gets no `/web`
 * command, and has no `web/access` event logged, so no client offers the
 * switch; a permitted member gets the command on the agent's own scope, the
 * initial value logged into a log without one, and the restriction that the
 * log then implies. Listeners are registered through the mounting context, so
 * a row inside an agent preset observes exactly the agents joined under it.
 * @param ctx - the mounting context.
 * @param initial - the value a log without a `web/access` event receives when its agent is created.
 * @param names - the web tool names this composition registered; every one is withheld while the switch is off.
 */
export function installSessionSwitch(ctx: Context, initial: boolean, names: readonly string[]): void {
  ctx.inject(['sessionProjections'], (projectionCtx) => {
    projectionCtx.sessionProjections.register(webAccessProjectionDefinition)
  })

  /** The `/web` command, registered on each permitted agent's own scope. */
  const command: CommandDefinition = {
    definitionId: brandString<CommandDefinitionId>('@deepseek-ai/dsh-tool-web'),
    name: WEB_ACCESS_COMMAND,
    description: 'Turn web search and page fetching on or off for this session',
    input: { hint: '[on|off]' },
    handler: ({ agent, rawInput }) => {
      const word = rawInput.trim()
      // Registered only after the initial value was logged, so the fold never
      // comes back empty; an empty fold reads as off rather than as a guess.
      // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
      const current = foldWebAccess(agent.session.snapshotEvents()) === true
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
  }

  ctx.inject(['agents', 'web'], (agentCtx) => {
    // A context that declares the command registry, from which a per-agent
    // registration scope can be minted: the agent's own context declares no
    // such injection, and a scoped registration must come through one that does.
    let commandCtx: Context | undefined
    agentCtx.inject(['commands'], (inner) => {
      commandCtx = inner
      inner.effect(() => () => { commandCtx = undefined }, 'tool-web: command registry context')
    })

    /** What one live agent holds: its restriction while withheld, its command while offered. */
    interface Held {
      offered: boolean
      disposed: boolean
      lift?: () => void
      command?: () => void
    }
    const held = new Map<Session, Held>()

    const withhold = (agent: Agent, entry: Held): void => {
      entry.lift ??= agent.ctx.tools.restrict({ deny: [...names] })
    }
    const release = (entry: Held): void => {
      entry.lift?.()
      delete entry.lift
    }

    /** Bring one offered agent's visibility in line with its Session's log, recording the initial value into a log without one. */
    const settle = (agent: Agent, entry: Held): void => {
      // oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
      let enabled = foldWebAccess(agent.session.snapshotEvents())
      if (enabled === null) {
        enabled = initial
        agent.session.append('web/access', { enabled })
      }
      if (enabled) release(entry)
      else withhold(agent, entry)
    }

    /** Decide once per agent whether the switch is offered, then settle it. */
    const decide = async (agent: Agent, entry: Held): Promise<void> => {
      let permitted: boolean
      try {
        permitted = await agentCtx.web.searchPermitted()
      } catch {
        // A decision that cannot be reached is a refusal: the tools stay
        // withheld for this session rather than being offered on a guess.
        permitted = false
      }
      if (entry.disposed || !permitted) return
      entry.offered = true
      // The command is the member's way to flip the switch by typing,
      // registered on the agent's own scope so only this agent lists it; a
      // deployment without a command registry has only the chip.
      const key = scopeOf(agent.ctx)
      if (commandCtx !== undefined && key !== undefined) {
        const scope = createScope(commandCtx, key)
        const unregister = scope.ctx.commands.register(command)
        entry.command = () => {
          unregister()
          void scope.dispose()
        }
      }
      settle(agent, entry)
    }

    /** Forget one agent's holdings, giving back its restriction and its command. */
    const forget = (session: Session): void => {
      const entry = held.get(session)
      if (entry === undefined) return
      entry.disposed = true
      release(entry)
      entry.command?.()
      held.delete(session)
    }

    agentCtx.effect(() => agentCtx.on('agent/created', ({ agent }) => {
      // A Session announced again replaces what its earlier agent held.
      forget(agent.session)
      const entry: Held = { offered: false, disposed: false }
      held.set(agent.session, entry)
      // Withheld first: the decision may take a network round trip, and a
      // request assembled meanwhile must not carry tools the member may not have.
      withhold(agent, entry)
      decide(agent, entry).catch((error: unknown) => {
        // A failure past the decision (registering the command, logging the
        // initial value) leaves the tools withheld; say so rather than vanish.
        agentCtx.logger.warn(`tool-web: session switch for "${agent.id}" stays withheld: ${String(error)}`)
      })
    }), 'tool-web: session switch at agent creation')
    agentCtx.effect(() => agentCtx.on('session/event', (session: Session, event: SessionEvent) => {
      if (event.type !== 'web/access') return
      const agent = agentCtx.agents.get(session.id)
      const entry = held.get(session)
      if (agent !== undefined && entry?.offered === true) settle(agent, entry)
    }), 'tool-web: session switch on a logged change')
    // Lifted rather than merely forgotten: disposing the agent usually takes
    // its scope and every registration on it, but a forgotten handle over a
    // scope that outlived its agent would be a restriction nothing removes.
    agentCtx.effect(() => agentCtx.on('agent/disposed', ({ agent }) => { forget(agent.session) }), 'tool-web: release a disposed agent')
  })
}
