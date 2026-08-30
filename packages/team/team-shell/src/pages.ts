/**
 * The pages the Team Shell serves.
 *
 * Server-rendered, no script, no external reference. A member reaches the
 * sign-in and confirmation pages before anything else has loaded, and an
 * administrator should be able to read an audit-relevant page without trusting
 * a bundle.
 * @module @deepseek-ai/dsh-team-shell/pages
 */

import type { AccountUser } from '@deepseek-ai/dsh-account-store'
import type { Role } from '@deepseek-ai/dsh-access-control'
import type { Device, PendingTransaction } from '@deepseek-ai/dsh-device-authorization'

/** Escape text for insertion into HTML. */
function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

const STYLE = 'font: 16px/1.5 system-ui, sans-serif; margin: 3rem auto; max-width: 48rem; padding: 0 1rem'
const TABLE = 'border-collapse: collapse; width: 100%'
const CELL = 'border-bottom: 1px solid #ccc; padding: 0.4rem 0.6rem; text-align: left'

/** Wrap a page body in the shared document. */
function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${escape(title)}</title></head>
<body style="${STYLE}">
${body}
</body>
</html>
`
}

/** One role, as an option in a binding form. */
function roleOption(role: Role): string {
  return `<option value="${escape(role.id)}">${escape(role.name)}</option>`
}

/** The revoke form for a device, or nothing when it is already revoked. */
function revokeForm(device: Device, csrf: string): string {
  if (device.status === 'revoked') return ''
  return `<form method="post" action="/team/admin/devices/revoke">${csrfField(csrf)}
<input type="hidden" name="deviceId" value="${escape(device.id)}">
<button type="submit">Revoke</button></form>`
}

/** The hidden field every write form carries. */
function csrfField(csrf: string): string {
  return `<input type="hidden" name="csrf" value="${escape(csrf)}">`
}

/**
 * The sign-in page.
 * @param message - what to tell the member above the form, when anything.
 * @param next - where to send them after signing in.
 * @returns the page body.
 */
export function loginPage(message: string | undefined, next: string): string {
  return page('Sign in', `<h1>Sign in</h1>
${message === undefined ? '' : `<p>${escape(message)}</p>`}
<form method="post" action="/team/login">
<input type="hidden" name="next" value="${escape(next)}">
<p><label>Member <input name="loginName" autocomplete="username"></label></p>
<p><label>Password <input name="secret" type="password" autocomplete="current-password"></label></p>
<p><button type="submit">Sign in</button></p>
</form>`)
}

/**
 * The device confirmation page: what the member compares before confirming.
 * @param transaction - the pending transaction, as the seam describes it.
 * @param state - the Runner's local state, carried through the form.
 * @param csrf - the token this session's forms must echo.
 * @returns the page body.
 */
export function confirmPage(transaction: PendingTransaction, state: string, csrf: string): string {
  return page('Connect a computer', `<h1>Connect a computer</h1>
<p>A computer is asking to connect to your team account. Check that it shows this
same code before you confirm.</p>
<p style="font: 700 2rem/1 ui-monospace, monospace; letter-spacing: 0.1em">${escape(transaction.pairingCode)}</p>
<table style="${TABLE}">
<tr><th style="${CELL}">Platform</th><td style="${CELL}">${escape(transaction.platform)}</td></tr>
<tr><th style="${CELL}">Runner version</th><td style="${CELL}">${escape(transaction.runnerVersion)}</td></tr>
<tr><th style="${CELL}">Key fingerprint</th><td style="${CELL}"><code>${escape(transaction.publicKeyDigest)}</code></td></tr>
</table>
<form method="post" action="/team/confirm/${escape(transaction.transactionId)}">
${csrfField(csrf)}
<input type="hidden" name="state" value="${escape(state)}">
<p><button type="submit">Confirm this computer</button></p>
</form>
<p>If you did not start this, close this page and confirm nothing.</p>`)
}

/**
 * A page that says why something cannot continue.
 * @param title - the page title.
 * @param message - what happened, in terms the reader can act on.
 * @returns the page body.
 */
export function noticePage(title: string, message: string): string {
  return page(title, `<h1>${escape(title)}</h1>\n<p>${escape(message)}</p>`)
}

/** The navigation shared by the administrative pages. */
function adminNav(): string {
  return `<p><a href="/team/admin/members">Members</a> ·
<a href="/team/admin/roles">Roles</a> ·
<a href="/team/admin/devices">Devices</a></p>`
}

/**
 * The members page: who is in the organization, and the form that adds one.
 * @param members - the organization's accounts, in creation order.
 * @param roles - the roles that may be bound, for the binding form.
 * @param csrf - the token this session's forms must echo.
 * @returns the page body.
 */
export function membersPage(members: readonly AccountUser[], roles: readonly Role[], csrf: string): string {
  const rows = members.map(member => `<tr>
<td style="${CELL}">${escape(member.loginName)}</td>
<td style="${CELL}">${escape(member.displayName)}</td>
<td style="${CELL}">${escape(member.status)}</td>
<td style="${CELL}">
<form method="post" action="/team/admin/members/suspend">${csrfField(csrf)}
<input type="hidden" name="userId" value="${escape(member.id)}">
<button type="submit">Suspend</button></form>
<form method="post" action="/team/admin/members/bind">${csrfField(csrf)}
<input type="hidden" name="userId" value="${escape(member.id)}">
<select name="roleId">${roles.map(roleOption).join('')}</select>
<button type="submit">Bind role</button></form>
</td></tr>`).join('\n')
  return page('Members', `<h1>Members</h1>
${adminNav()}
<table style="${TABLE}">
<tr><th style="${CELL}">Login</th><th style="${CELL}">Name</th><th style="${CELL}">Status</th><th style="${CELL}">Actions</th></tr>
${rows}
</table>
<h2>Add a member</h2>
<form method="post" action="/team/admin/members/create">
${csrfField(csrf)}
<p><label>Login <input name="loginName"></label></p>
<p><label>Name <input name="displayName"></label></p>
<p><button type="submit">Add</button></p>
</form>`)
}

/**
 * The roles page: what roles exist, and the form that adds one.
 * @param roles - the organization's roles, in creation order.
 * @param csrf - the token this session's forms must echo.
 * @returns the page body.
 */
export function rolesPage(roles: readonly Role[], csrf: string): string {
  const rows = roles.map(role => `<tr>
<td style="${CELL}">${escape(role.name)}</td>
<td style="${CELL}">${escape(role.kind)}</td>
<td style="${CELL}">${escape(role.description)}</td>
</tr>`).join('\n')
  return page('Roles', `<h1>Roles</h1>
${adminNav()}
<table style="${TABLE}">
<tr><th style="${CELL}">Name</th><th style="${CELL}">Kind</th><th style="${CELL}">Description</th></tr>
${rows}
</table>
<h2>Add a role</h2>
<form method="post" action="/team/admin/roles/create">
${csrfField(csrf)}
<p><label>Name <input name="name"></label></p>
<p><label>Description <input name="description"></label></p>
<p><button type="submit">Add</button></p>
</form>`)
}

/**
 * The devices page: which computers are bound, and the form that revokes one.
 * @param devices - the organization's devices, in binding order.
 * @param csrf - the token this session's forms must echo.
 * @returns the page body.
 */
export function devicesPage(devices: readonly Device[], csrf: string): string {
  const rows = devices.map(device => `<tr>
<td style="${CELL}">${escape(device.platform)}</td>
<td style="${CELL}">${escape(device.runnerVersion)}</td>
<td style="${CELL}"><code>${escape(device.publicKeyDigest.slice(0, 16))}</code></td>
<td style="${CELL}">${escape(device.status)}</td>
<td style="${CELL}">${escape(new Date(device.lastSeenAt).toISOString())}</td>
<td style="${CELL}">${revokeForm(device, csrf)}</td>
</tr>`).join('\n')
  return page('Devices', `<h1>Devices</h1>
${adminNav()}
<table style="${TABLE}">
<tr><th style="${CELL}">Platform</th><th style="${CELL}">Runner</th><th style="${CELL}">Key</th>
<th style="${CELL}">Status</th><th style="${CELL}">Last seen</th><th style="${CELL}">Actions</th></tr>
${rows}
</table>`)
}
