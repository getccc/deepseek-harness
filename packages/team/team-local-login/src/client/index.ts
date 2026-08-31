/** Browser account launcher for the Team Runner sidebar. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls ctx.locale and ctx.slots into the client Context.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the settings.launcher slot declaration into this program.
import type {} from '@deepseek-ai/dsh-client-ui-settings-general/client'
import { ACCOUNT_PATH, LOGOUT_PATH } from '../paths.ts'
import {
  TeamAccountLauncher, type TeamAccountLauncherInjected, type TeamMemberIdentity,
} from './TeamAccountLauncher.tsx'
import { en, zh, type TeamAccountKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Team member launcher copy. */
    'team.account': TeamAccountKey
  }
}

/** Dictionary namespace owned by the Team account launcher. */
export const NS = 'team.account'

/** Required browser services for the localized Settings launcher. */
export const inject = ['slots', 'locale']

/** Validate the intentionally small identity response from the local Host. */
function isMemberIdentity(value: unknown): value is TeamMemberIdentity {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<TeamMemberIdentity>
  return typeof candidate.loginName === 'string' && typeof candidate.displayName === 'string'
}

/** Read the account belonging to the current local browser session. */
async function loadAccount(): Promise<TeamMemberIdentity> {
  const response = await fetch(ACCOUNT_PATH, {
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
  })
  if (!response.ok) throw new Error(`team account endpoint refused with ${String(response.status)}`)
  const body: unknown = await response.json()
  if (!isMemberIdentity(body)) throw new Error('team account endpoint returned an invalid identity')
  return body
}

/** Register the localized account launcher into the Settings shell. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'team-local-login: account dictionaries')
  ctx.slots.inject('settings.launcher', () => ctx.slots.register({
    name: 'settings.launcher',
    locale: NS,
    inject: (): TeamAccountLauncherInjected => ({
      loadAccount,
      signOut: () => { window.location.assign(LOGOUT_PATH) },
    }),
  }, TeamAccountLauncher))
}
