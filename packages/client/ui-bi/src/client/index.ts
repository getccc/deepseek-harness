/**
 * BI analysis plugin, browser half — the composer control choosing which BI
 * project this conversation analyzes.
 *
 * The control sits over one Host fold: it writes a `bi/scope` event through
 * the Team-only `bi` Remote, and reads the projection of that same event.
 * Nothing about the choice is kept here, so a second browser, a reload, and
 * the model all see the same project.
 *
 * The `bi` namespace is mounted here rather than in the shared Client assembly
 * because only a Team Host serves it: a build without BI analysis does not
 * mount this plugin, and never grows a namespace whose every call would fail.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import biRemote from '@deepseek-ai/dsh-api-bi-controller/remote'
// Type-only: the assembled Client Remote face this plugin extends.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-bi-controller/remote'
// Type-only: pulls the ui-conversation SlotMap merge (the composer left zone).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { BiSelect, type BiDirectoryView, type BiSelectInjected } from './BiSelect.tsx'
import { en, zh, type BiKey } from './locales.ts'

export type { BiKey } from './locales.ts'
export type { BiDirectoryView, BiSelectInjected, BiSelectProps } from './BiSelect.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The composer BI-analysis control's copy. */
    bi: BiKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'bi'

/** Required services: the control's slot registry, the locale registry, and the Remote mount. */
export const inject = ['locale', 'remote', 'slots']

/**
 * Client plugin body: mount the BI Remote namespace, then register the
 * composer control over it.
 *
 * The mount is an effect like every other contribution, so the namespace is
 * taken back down by the fiber that raised it however that fiber ends. The
 * control parks on `remote.bi`, the service the mount provides, so it never
 * exists before the namespace it calls.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.remote.$mount(biRemote), 'ui-bi: bi Remote namespace')
  ctx.inject(['locale', 'remote.bi', 'slots'], registerUi)
}

/** Register the composer control over a live `bi` namespace. */
function registerUi(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-bi: dictionaries')

  /** What one Session may choose from, and whether what it chose is still there. */
  const view = async (sessionId: SessionId): Promise<BiDirectoryView> => {
    const result = await ctx.remote.bi.scope(sessionId)
    // Failure strings stay English (error-surface policy: not localized).
    if (!result.ok) throw new Error(`${result.error.message} (${result.error.code})`)
    return { choices: result.value.choices, unavailable: result.value.unavailable }
  }

  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: NS,
    // After the office chip at 110: BI analysis is the next choice a Team
    // deployment adds to the work composer, and a member reads it where the
    // design puts it, to the right of 办公.
    order: 120,
    locale: NS,
    inject: (sessionId: SessionId): BiSelectInjected => ({
      choices: () => view(sessionId),
      // Every declared argument travels, the trailing one as undefined when
      // there is no project: the generated Remote client counts them.
      apply: async (projectRef) => {
        const result = await ctx.remote.bi.choose(sessionId, projectRef === undefined ? 'off' : 'selected', projectRef)
        if (!result.ok) throw new Error(`${result.error.message} (${result.error.code})`)
      },
    }),
  }, BiSelect))
}
