/**
 * Office deliverable plugin, browser half — the composer chip choosing which
 * office document this conversation should produce.
 *
 * The chip sits over one Host fold: it writes an `office/kind` event through
 * the Team-only `office` Remote, and reads the projection of that same event.
 * Nothing about the choice is kept here, so a second browser, a reload, and
 * the model all see the same choice.
 *
 * The `office` namespace is mounted here rather than in the shared Client
 * assembly because only a Team Host serves it: a build without the office tool
 * does not mount this plugin, and never grows a namespace whose every call
 * would fail.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import officeRemote from '@deepseek-ai/dsh-api-office-controller/remote'
import type { OfficeKind } from '@deepseek-ai/dsh-office'
// Type-only: the assembled Client Remote face this plugin extends.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-office-controller/remote'
// Type-only: pulls the ui-conversation SlotMap merge (the composer left zone).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { OfficeSelect, type OfficeSelectInjected } from './OfficeSelect.tsx'
import { en, zh, type OfficeKey } from './locales.ts'

export type { OfficeKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The composer office-deliverable chip's copy. */
    office: OfficeKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'office'

/** Required services: the chip's slot registry, locale, the Remote mount, and the produced-files vocabulary. */
export const inject = ['locale', 'remote', 'slots']

/**
 * Client plugin body: mount the office Remote namespace, teach the
 * produced-files row the office export, then register the composer chip.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.remote.$mount(officeRemote), 'ui-office: office Remote namespace')
  ctx.inject(['locale', 'remote.office', 'slots'], registerUi)
}

/** Register the composer chip over a live `office` namespace. */
function registerUi(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-office: dictionaries')

  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: NS,
    // After the shipped composer controls and the knowledge chip; office is
    // another choice a deployment adds.
    order: 110,
    locale: NS,
    inject: (sessionId: SessionId): OfficeSelectInjected => ({
      apply: async (kind: OfficeKind) => {
        const result = await ctx.remote.office.choose(sessionId, kind)
        if (!result.ok) throw new Error(`${result.error.message} (${result.error.code})`)
      },
    }),
  }, OfficeSelect))
}
