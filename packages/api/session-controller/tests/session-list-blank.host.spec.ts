/**
 * Two bits, two questions. `blank` means "conversation not started" (no turn
 * has run), so standalone plugin events — command lifecycle records,
 * plan/mode, permission knob events, session titles — never flip it and a
 * fresh session running /plan stays list-hidden until the first accepted
 * prompt's turn/start. `pristine` means "nobody set it up", which those same
 * events do end: a conversation someone set up is not the one New Session
 * hands back. The facts the composition pins on every fresh Session
 * (permission preset, sandbox mode, approval policy, agent preset) are not
 * anyone's setup and leave it pristine. The host/session-added frame shares
 * the blank predicate function (covered by the workspace spec's frame
 * assertion).
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import { CommandId } from '@deepseek-ai/dsh-commands/brand'
// Side-effect type imports: the configuration-event SessionEventMap merges.
import type {} from '@deepseek-ai/dsh-permission-presets'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import { createSessionTestRemote, type TestSessionRemote } from './test-remote.ts'

async function harness(): Promise<{ ctx: Context; remote: TestSessionRemote; attach: (session: Session) => void }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  return {
    ctx,
    remote: createSessionTestRemote(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' }),
    attach: (session) => {
      ctx.agents.register({ id: session.id, session, status: 'idle', ctx } as Agent)
    },
  }
}

/** Append the standalone (non-conversation) event family a fresh session can accumulate. */
function appendStandalone(session: Session): void {
  session.append('command/run', {
    commandId: CommandId('blank-cmd-1'), name: 'plan', args: '', source: { kind: 'user' },
  })
  session.append('plan/mode', { active: true })
  session.append('command/done', { commandId: CommandId('blank-cmd-1'), kind: 'success', text: 'Plan mode on.' })
  session.append('session/title', {
    title: 'standalone title', messageSeqs: [], source: { kind: 'fallback' },
  })
  // Permission configuration events from a /permission switch on a fresh session.
  session.append('permission/preset', { preset: 'danger-full-access' })
  session.append('sandbox/mode', { mode: 'danger-full-access' })
}

async function listBlank(remote: TestSessionRemote, id: string): Promise<boolean | undefined> {
  const result = await remote.list({})
  if (!result.ok) throw new Error('list failed')
  return result.value.items.find(item => item.sessionId === id)?.blank
}

async function listPristine(remote: TestSessionRemote, id: string): Promise<boolean | undefined> {
  const result = await remote.list({})
  if (!result.ok) throw new Error('list failed')
  return result.value.items.find(item => item.sessionId === id)?.pristine
}

describe('summary blank = conversation not started', () => {
  it('standalone events (command lifecycle, plan/mode, title) keep the session blank', async () => {
    const { ctx, remote, attach } = await harness()
    const session = ctx.sessions.create()
    attach(session)
    expect(await listBlank(remote, session.id)).toBe(true)
    appendStandalone(session)
    expect(await listBlank(remote, session.id)).toBe(true)
  })

  it('those same events end pristine, so New Session does not hand the setup back', async () => {
    const { ctx, remote, attach } = await harness()
    const session = ctx.sessions.create()
    attach(session)
    expect(await listPristine(remote, session.id)).toBe(true)
    appendStandalone(session)
    expect(await listPristine(remote, session.id)).toBe(false)
    // Still blank: the conversation has not started, it has only been set up.
    expect(await listBlank(remote, session.id)).toBe(true)
  })

  it('the facts pinned at creation leave pristine alone', async () => {
    const { ctx, remote, attach } = await harness()
    const session = ctx.sessions.create()
    attach(session)
    session.append('permission/preset', { preset: 'workspace-write' })
    session.append('sandbox/mode', { mode: 'workspace-write' })
    session.append('approval/policy', { policy: 'ask' })
    session.append('agent-preset/selected', { agentPreset: 'standard' })
    expect(await listPristine(remote, session.id)).toBe(true)
    expect(await listBlank(remote, session.id)).toBe(true)
  })

  it('the first turn clears blank', async () => {
    const { ctx, remote, attach } = await harness()
    const session = ctx.sessions.create()
    attach(session)
    appendStandalone(session)
    session.append('turn/start', { turn: 0 })
    expect(await listBlank(remote, session.id)).toBe(false)
  })
})
