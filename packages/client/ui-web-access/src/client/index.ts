/**
 * Web access control plugin, browser half: a switch chip in the composer's
 * `conversation.input.left` zone over the `webAccess` projection. The chip
 * renders for a Session whose composition offers the switch (the projection
 * carries a boolean) and executes `/web on` or `/web off` through the command
 * channel; zero client-side switch state.
 */
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
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

/** Required services: the chip's slot registry, commands Remote, and locale registry. */
export const inject = ['slots', 'remote', 'remote.commands', 'locale']

/**
 * Client plugin body: register the web switch chip over the command channel.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-web-access: dictionaries')

  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: NS,
    // Before the deployment-added knowledge and office chips: the switch is a
    // shipped composer control of the chat composition.
    order: 50,
    locale: NS,
    inject: (sessionId: SessionId): WebAccessChipInjected => ({
      // Failure strings stay English (error-surface policy: not localized).
      setEnabled: async (enabled) => {
        const line = enabled ? '/web on' : '/web off'
        const result = await ctx.remote.commands.execute(sessionId, line, [])
        if (!result.ok) return `${result.error.message} (${result.error.code})`
        if (result.value === undefined) return `unknown command: ${line}`
        return result.value.result.kind === 'error' ? result.value.result.text : null
      },
    }),
  }, WebAccessChip))
}
