/** Browser account launcher for the Team Runner sidebar. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls ctx.locale and ctx.slots into the client Context.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the settings.launcher slot declaration into this program.
import type {} from '@deepseek-ai/dsh-client-ui-settings-general/client'
// Type-only: pulls the conversation.hero.headline slot declaration into this program.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls ctx.sessions into the client Context.
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import { ACCOUNT_PATH, LOGOUT_PATH, SIGNED_IN_PARAM } from '../paths.ts'
import { HeroGreeting } from './HeroGreeting.tsx'
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

/** Required browser services for the localized Settings launcher and the sign-in landing. */
export const inject = ['slots', 'locale', 'sessions']

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

/**
 * Land a member who has just signed in on an empty conversation.
 *
 * The selection is persisted per browser while the conversations belong to
 * this computer, so a second member signing in would otherwise arrive inside
 * the first member's conversation. The parameter is removed from the address
 * as it is consumed, so a reload keeps whatever they have opened since.
 * @param ctx - client root context carrying the Session selection.
 */
function landOnEmptyConversation(ctx: ClientContext): void {
  const url = new URL(window.location.href)
  if (!url.searchParams.has(SIGNED_IN_PARAM)) return
  ctx.sessions.clear()
  url.searchParams.delete(SIGNED_IN_PARAM)
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
}

/** Register the localized account launcher into the Settings shell. */
export function apply(ctx: ClientContext): void {
  landOnEmptyConversation(ctx)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'team-local-login: account dictionaries')
  const operations = (): TeamAccountLauncherInjected => ({
    loadAccount,
    signOut: () => { window.location.assign(LOGOUT_PATH) },
  })

  ctx.slots.inject('settings.launcher', () => ctx.slots.register({
    name: 'settings.launcher',
    locale: NS,
    inject: operations,
  }, TeamAccountLauncher))

  // The blank-session headline greets whoever is signed in; a composition
  // without an account keeps the shell's own line.
  ctx.slots.inject('conversation.hero.headline', () => ctx.slots.register({
    name: 'conversation.hero.headline',
    locale: NS,
    inject: operations,
  }, HeroGreeting))
}
