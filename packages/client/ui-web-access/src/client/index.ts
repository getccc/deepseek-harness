/**
 * Web access control plugin, browser half: a switch chip in the composer's
 * `conversation.input.left` zone over the `webAccess` projection. The chip
 * renders for a Session the Host offers the switch to (the `webAccess` Remote
 * answers its state, and the projection carries a boolean) and sets it
 * through the same Remote, which
 * records the same `web/access` event the `/web` command does without a
 * command node in the transcript; zero client-side switch state.
 *
 * The `webAccess` namespace is mounted here rather than in the shared Client
 * assembly because only a Host composing the switch serves it.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import webAccessRemote from '@deepseek-ai/dsh-api-web-access-controller/remote'
// Type-only: the assembled Client Remote face this plugin extends.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-web-access-controller/remote'
// Type-only: pulls the ui-conversation SlotMap merge (the composer left zone).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { WebAccessChip, type WebAccessChipInjected } from './WebAccessChip.tsx'
import { en, zh, type WebAccessKey } from './locales.ts'

export type { WebAccessKey } from './locales.ts'
export type { WebAccessChipInjected, WebAccessChipProps } from './WebAccessChip.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The composer web switch's copy. */
    webAccess: WebAccessKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'webAccess'

/** Required services: the chip's slot registry, the Remote mount, and the locale registry. */
export const inject = ['locale', 'remote', 'slots']

/**
 * Client plugin body: mount the webAccess Remote namespace, then register the chip.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.remote.$mount(webAccessRemote), 'ui-web-access: webAccess Remote namespace')
  ctx.inject(['locale', 'remote.webAccess', 'slots'], registerUi)
}

/** Register the composer chip over a live `webAccess` namespace. */
function registerUi(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-web-access: dictionaries')

  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: NS,
    // Before the deployment-added knowledge and office chips: the switch is a
    // shipped composer control of the chat composition.
    order: 50,
    locale: NS,
    inject: (sessionId: SessionId): WebAccessChipInjected => ({
      // The Host refuses a member it does not permit to search, and a Session
      // whose composition offers no switch; either way there is nothing to show.
      offered: async () => (await ctx.remote.webAccess.state(sessionId)).ok,
      // Failure strings stay English (error-surface policy: not localized).
      setEnabled: async (enabled) => {
        const result = await ctx.remote.webAccess.set(sessionId, enabled)
        return result.ok ? null : `${result.error.message} (${result.error.code})`
      },
    }),
  }, WebAccessChip))
}
