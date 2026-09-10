/**
 * The browser half on a real cordis Context with fake Remote, command, and
 * slot faces: the plugin mounts the Team-only `knowledge` namespace, offers
 * the picker over the authorized directory, records what a member ticked, and
 * gives all three back on teardown (HMR safety).
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { KnowledgeRef } from '@deepseek-ai/dsh-knowledge'
import type { KnowledgeScopeView } from '@deepseek-ai/dsh-api-knowledge-controller/types'
import type { CommandContribution, SelectOption } from '@deepseek-ai/dsh-client-ui-commands/client'
import { KnowledgeSelect, type KnowledgeSelectInjected } from '../src/client/KnowledgeSelect.tsx'
import { ALL_ROW_ID } from '../src/client/scope.ts'
import { apply, inject } from '../src/client/index.ts'
import { apply as nodeApply } from '../src/index.ts'

const SID = 's-knowledge' as SessionId
const REF = 'weknora:prod:690c0727' as KnowledgeRef

/** The directory one bench answers with. */
const DIRECTORY: KnowledgeScopeView = {
  choices: [{ knowledgeRef: REF, displayName: '临港知识库', description: '' }],
  scope: { version: 1, mode: 'off' },
  unavailable: [],
}

/** One picker settlement, as the Remote received it. */
interface Recorded {
  sessionId: string
  mode: string
  knowledgeRefs?: string[]
}

/** Boot the plugin over fake Remote, command, and slot faces. */
async function bench(scope: KnowledgeScopeView | Error = DIRECTORY) {
  const ctx = new Context()
  const recorded: Recorded[] = []
  let mounted = 0
  let refusal: string | undefined
  const knowledge = {
    scope: () => Promise.resolve(scope instanceof Error
      ? { ok: false as const, error: { code: 'unavailable', message: scope.message, details: {} } }
      : { ok: true as const, value: scope }),
    choose: (sessionId: string, mode: string, knowledgeRefs?: string[]) => {
      if (refusal !== undefined) {
        const message = refusal
        refusal = undefined
        return Promise.resolve({ ok: false as const, error: { code: 'bad-request', message, details: {} } })
      }
      recorded.push({ sessionId, mode, ...knowledgeRefs === undefined ? {} : { knowledgeRefs } })
      return Promise.resolve({ ok: true as const, value: DIRECTORY })
    },
  }
  ctx.provide('remote', {
    knowledge,
    $mount: () => {
      mounted += 1
      return Promise.resolve(() => {
        mounted -= 1
        return Promise.resolve()
      })
    },
  })
  // The real mount provides this namespace service, which is what the
  // surfaces park on; the double stands it up so they can register at all.
  ctx.provide('remote.knowledge', knowledge)
  let contribution: CommandContribution | undefined
  ctx.provide('commandUi', {
    register(c: CommandContribution) {
      contribution = c
      return () => { contribution = undefined }
    },
  })
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({
    name: 'root',
    children: { 'conversation.input.left': { kind: 'list', scope: 'session' } },
  } as never, () => null)
  const locale = new LocaleRuntime(ctx)
  // No jsdom `window` in this lane, so browser-language detection never runs:
  // state the asserted locale explicitly.
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return {
    ctx,
    fiber,
    recorded,
    slots,
    mounts: () => mounted,
    contribution: () => contribution,
    refuseNextChoice: (message: string) => { refusal = message },
  }
}

/** The rows one picker offers for a Session. */
async function rows(contribution: CommandContribution): Promise<readonly SelectOption[]> {
  if (contribution.ui.kind !== 'popupMultiSelect') throw new Error('the picker is not a multi-choice one')
  return contribution.ui.options({ sessionId: SID }, new AbortController().signal)
}

/** Settle one ticked set through the contribution. */
async function submit(contribution: CommandContribution, ticked: readonly SelectOption[]): Promise<void> {
  if (contribution.ui.kind !== 'popupMultiSelect') throw new Error('the picker is not a multi-choice one')
  await contribution.ui.onApply(ticked, { sessionId: SID })
}

describe('what the plugin installs', () => {
  it('declares every service it binds', () => {
    expect(inject).toEqual(['commandUi', 'locale', 'remote', 'slots'])
  })

  it('node-half apply is an intentional no-op', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })

  it('mounts the knowledge namespace, the picker, and the chip, and gives all three back', async () => {
    const b = await bench()
    expect(b.mounts()).toBe(1)
    expect(b.contribution()).toMatchObject({ name: 'knowledge' })
    expect(b.contribution()?.description()).toBe('选择本次对话可检索的知识库')
    const seat = b.slots.entries('conversation.input.left')[0]!
    expect(seat).toMatchObject({ locale: 'knowledge', options: { id: 'knowledge', order: 100 } })
    expect(seat.component).toBe(KnowledgeSelect)
    await b.fiber.dispose()
    expect(b.mounts()).toBe(0)
    expect(b.contribution()).toBeUndefined()
    expect(b.slots.entries('conversation.input.left')).toHaveLength(0)
  })

  it('offers the picker in every conversation, because every member may choose', async () => {
    const b = await bench()
    expect(b.contribution()?.available({ sessionId: SID })).toBe(true)
  })
})

describe('what a member reads and records', () => {
  it('draws the authorized directory, whole-set row first', async () => {
    const b = await bench()
    const contribution = b.contribution()!
    expect((await rows(contribution)).map(row => row.label)).toEqual(['全部已授权知识库', '临港知识库'])
  })

  it('records off, all, and a named selection through the same settlement', async () => {
    const b = await bench()
    const contribution = b.contribution()!
    await submit(contribution, [])
    await submit(contribution, [{ id: ALL_ROW_ID, label: '全部已授权知识库' }])
    await submit(contribution, [{ id: REF, label: '临港知识库' }])
    expect(b.recorded).toEqual([
      { sessionId: SID, mode: 'off', knowledgeRefs: [] },
      { sessionId: SID, mode: 'all', knowledgeRefs: [] },
      { sessionId: SID, mode: 'selected', knowledgeRefs: [REF] },
    ])
  })

  it('says why the directory could not be read, rather than showing an empty picker', async () => {
    const b = await bench(new Error('private knowledge could not be read'))
    await expect(rows(b.contribution()!))
      .rejects.toThrow('private knowledge could not be read (unavailable)')
  })

  it('surfaces a refused settlement to the shell that asked for it', async () => {
    const b = await bench()
    const contribution = b.contribution()!
    b.refuseNextChoice('that knowledge base is not available to this member')
    await expect(submit(contribution, [{ id: REF, label: '临港知识库' }]))
      .rejects.toThrow('that knowledge base is not available to this member (bad-request)')
  })
})

describe('what the composer control is given', () => {
  /** The control's injected face for one Session. */
  function face(b: Awaited<ReturnType<typeof bench>>): KnowledgeSelectInjected {
    const seat = b.slots.entries('conversation.input.left')[0]!
    return (seat.inject as unknown as (id: SessionId) => KnowledgeSelectInjected)(SID)
  }

  it('offers the same authorized directory the picker draws from', async () => {
    const b = await bench()
    expect((await face(b).choices()).map(choice => choice.displayName)).toEqual(['临港知识库'])
  })

  it('reads the choice in force at click time, so one click is one whole choice', async () => {
    // The control clicks a row; what that means depends on what is chosen now,
    // and the Control Plane's answer is the only copy of that both surfaces share.
    const b = await bench()
    await face(b).apply(REF)
    expect(b.recorded).toEqual([{ sessionId: SID, mode: 'selected', knowledgeRefs: [REF] }])
  })

  it('carries a refusal to the control that asked', async () => {
    const b = await bench()
    b.refuseNextChoice('that knowledge base is not available to this member')
    await expect(face(b).apply(REF))
      .rejects.toThrow('that knowledge base is not available to this member (bad-request)')
  })
})
