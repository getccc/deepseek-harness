/**
 * GMO supply-chain analysis plugin, browser half — the composer control choosing which GMO
 * category this conversation analyzes.
 *
 * The control sits over one Host fold: it writes a `gmo/scope` event through
 * the Team-only `gmo` Remote, and reads the projection of that same event.
 * Nothing about the choice is kept here, so a second browser, a reload, and
 * the model all see the same category.
 *
 * The `gmo` namespace is mounted here rather than in the shared Client assembly
 * because only a Team Host serves it: a build without GMO supply-chain analysis does not
 * mount this plugin, and never grows a namespace whose every call would fail.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import gmoRemote from '@deepseek-ai/dsh-api-gmo-controller/remote'
// Type-only: the assembled Client Remote face this plugin extends.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-gmo-controller/remote'
// Type-only: pulls the ui-conversation SlotMap merge (the composer left zone).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { GmoSelect, type GmoDirectoryView, type GmoSelectInjected } from './GmoSelect.tsx'
import { en, zh, type GmoKey } from './locales.ts'

export type { GmoKey } from './locales.ts'
export type { GmoDirectoryView, GmoSelectInjected, GmoSelectProps } from './GmoSelect.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The composer GMO supply-chain control's copy. */
    gmo: GmoKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'gmo'

/** Required services: the control's slot registry, the locale registry, and the Remote mount. */
export const inject = ['locale', 'remote', 'slots']

/**
 * Client plugin body: mount the GMO Remote namespace, then register the
 * composer control over it.
 *
 * The mount is an effect like every other contribution, so the namespace is
 * taken back down by the fiber that raised it however that fiber ends. The
 * control parks on `remote.gmo`, the service the mount provides, so it never
 * exists before the namespace it calls.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.remote.$mount(gmoRemote), 'ui-gmo: gmo Remote namespace')
  ctx.inject(['locale', 'remote.gmo', 'slots'], registerUi)
}

/** Register the composer control over a live `gmo` namespace. */
function registerUi(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-gmo: dictionaries')

  /** What one Session may choose from, and whether what it chose is still there. */
  const view = async (sessionId: SessionId): Promise<GmoDirectoryView> => {
    const result = await ctx.remote.gmo.scope(sessionId)
    // Failure strings stay English (error-surface policy: not localized).
    if (!result.ok) throw new Error(`${result.error.message} (${result.error.code})`)
    return { choices: result.value.choices, unavailable: result.value.unavailable }
  }

  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: NS,
    // After the BI chip at 120: GMO supply-chain analysis is the next choice a
    // Team deployment adds to the work composer, to the right of BI分析.
    order: 130,
    locale: NS,
    inject: (sessionId: SessionId): GmoSelectInjected => ({
      choices: () => view(sessionId),
      // Every declared argument travels, the trailing one as undefined when
      // there is no category: the generated Remote client counts them.
      apply: async (categoryRef) => {
        const result = await ctx.remote.gmo.choose(sessionId, categoryRef === undefined ? 'off' : 'selected', categoryRef)
        if (!result.ok) throw new Error(`${result.error.message} (${result.error.code})`)
      },
    }),
  }, GmoSelect))
}
