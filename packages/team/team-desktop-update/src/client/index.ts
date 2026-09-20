/**
 * Desktop update control, browser half: one action in the sidebar's
 * `team.account.action` list, beside the member row.
 *
 * Checking, downloading, and installing belong to the desktop shell, which
 * exposes them on `window.dshTeamDesktop`. This plugin registers nothing when
 * that bridge is absent — a page opened in a plain browser, a source launch,
 * or a shell older than this protocol — so the sidebar foot is unchanged
 * wherever no shell can act on an update.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the team.account.action slot declaration into this program.
import type {} from '@deepseek-ai/dsh-team-local-login/client'
import { desktopUpdateBridge } from './desktop-bridge.ts'
import { UpdateAction, type UpdateActionInjected } from './UpdateAction.tsx'
import { en, zh, type DesktopUpdateKey } from './locales.ts'

export type { DesktopUpdateKey } from './locales.ts'
export type { UpdateActionInjected, UpdateActionProps } from './UpdateAction.tsx'
export {
  DESKTOP_UPDATE_PROTOCOL, desktopUpdateBridge,
  type DesktopUpdateBridge, type DesktopUpdatePhase, type DesktopUpdateState,
} from './desktop-bridge.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The sidebar update control's copy. */
    'team.update': DesktopUpdateKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'team.update'

/** Required services: the action's slot registry and the locale registry. */
export const inject = ['locale', 'slots']

/**
 * Client plugin body: register the control when a desktop shell offers the bridge.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const bridge = desktopUpdateBridge()
  if (bridge === undefined) return

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'team-desktop-update: dictionaries')

  ctx.slots.inject('team.account.action', () => ctx.slots.register({
    name: 'team.account.action',
    id: NS,
    // The only action in this list today; the order leaves room below it for
    // a deployment that adds its own.
    order: 100,
    locale: NS,
    inject: (): UpdateActionInjected => ({
      subscribe: listener => bridge.subscribe(listener),
      check: () => bridge.check(),
      install: () => bridge.install(),
    }),
  }, UpdateAction))
}
