/**
 * The pages the Team Shell serves.
 *
 * Server-rendered, with no script and no external reference. The shared shell
 * gives every administrative capability one visible home without giving the
 * browser a second API or trusting client-side authorization.
 * @module @deepseek-ai/dsh-team-shell/pages
 */

import type { AccountUser, Organization } from '@deepseek-ai/dsh-account-store'
import type { Permission, Role, RoleGrant } from '@deepseek-ai/dsh-access-control'
import type { Device, PendingTransaction } from '@deepseek-ai/dsh-device-authorization'
import type { ModelEntry } from '@deepseek-ai/dsh-model-gateway'

/** Counts displayed on the administrative overview. */
export interface AdminMetrics {
  readonly members: number
  readonly activeMembers: number
  readonly roles: number
  readonly devices: number
  readonly activeDevices: number
  readonly models: number
  readonly activeModels: number
}

/** Escape text for insertion into HTML. */
function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

const STYLE = `
:root{color-scheme:light;--ink:#172033;--muted:#667085;--line:#e6e9f0;--brand:#635bff;--brand2:#8b5cf6;--good:#067647;--warn:#b54708;--bad:#b42318;--sidebar:#101828}
*{box-sizing:border-box}body{margin:0;background:#f7f8fc;color:var(--ink);font:14px/1.5 Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}a{color:inherit}button,input,select{font:inherit}button{cursor:pointer}.auth{min-height:100vh;display:grid;place-items:center;padding:32px;background:radial-gradient(circle at 15% 10%,#ebe9ff 0,transparent 36%),radial-gradient(circle at 90% 90%,#e0f2fe 0,transparent 34%),#f7f8fc}.auth-card{width:min(100%,440px);padding:34px;background:#fff;border:1px solid rgba(99,91,255,.13);border-radius:24px;box-shadow:0 24px 64px rgba(16,24,40,.12)}.brand-mark{display:grid;place-items:center;width:42px;height:42px;border-radius:13px;background:linear-gradient(135deg,var(--brand),var(--brand2));color:#fff;font-weight:800;box-shadow:0 10px 24px rgba(99,91,255,.28)}h1,h2,h3,p{margin-top:0}h1{font-size:28px;line-height:1.2;letter-spacing:-.03em}h2{font-size:18px;letter-spacing:-.01em}h3{font-size:15px}.muted{color:var(--muted)}.field{display:grid;gap:7px;margin:16px 0}.field>span{font-weight:650;color:#344054}.input,.select{width:100%;height:42px;padding:0 12px;border:1px solid #d0d5dd;border-radius:10px;background:#fff;color:var(--ink);outline:none}.input:focus,.select:focus{border-color:var(--brand);box-shadow:0 0 0 3px rgba(99,91,255,.12)}.btn{display:inline-flex;align-items:center;justify-content:center;min-height:40px;padding:0 14px;border:1px solid transparent;border-radius:10px;background:var(--brand);color:#fff;font-weight:700;text-decoration:none;box-shadow:0 4px 12px rgba(99,91,255,.18)}.btn:hover{filter:brightness(.97)}.btn-secondary{background:#fff;border-color:#d0d5dd;color:#344054;box-shadow:0 1px 2px rgba(16,24,40,.04)}.btn-danger{background:#fff;border-color:#fecdca;color:var(--bad);box-shadow:none}.btn-small{min-height:32px;padding:0 10px;font-size:12px}.full{width:100%}.alert{padding:11px 13px;border-radius:10px;background:#fff4ed;color:#9c2a10;border:1px solid #ffd6ae}.layout{min-height:100vh;display:grid;grid-template-columns:244px 1fr}.sidebar{position:sticky;top:0;height:100vh;padding:26px 18px;background:var(--sidebar);color:#fff}.sidebar-brand{display:flex;align-items:center;gap:12px;padding:0 8px 27px}.sidebar-brand strong{display:block;font-size:15px}.sidebar-brand span{display:block;color:#98a2b3;font-size:12px}.nav{display:grid;gap:5px}.nav a{display:flex;align-items:center;gap:11px;padding:10px 12px;border-radius:10px;color:#cbd5e1;text-decoration:none;font-weight:600}.nav a:hover{background:#1d2939;color:#fff}.nav a.active{background:linear-gradient(100deg,rgba(99,91,255,.34),rgba(139,92,246,.18));color:#fff}.nav-icon{display:grid;place-items:center;width:24px;height:24px;border-radius:7px;background:rgba(255,255,255,.08);font-size:11px;font-weight:800}.sidebar-foot{position:absolute;left:18px;right:18px;bottom:20px}.sidebar-foot form{margin:0}.sidebar-foot .btn{width:100%;background:#1d2939;border-color:#344054;color:#eaecf0;box-shadow:none}.main{min-width:0}.topbar{height:72px;display:flex;align-items:center;justify-content:space-between;padding:0 34px;background:rgba(255,255,255,.92);border-bottom:1px solid var(--line);backdrop-filter:blur(12px)}.topbar .crumb{color:var(--muted)}.org-pill{display:flex;align-items:center;gap:9px;padding:7px 11px;border:1px solid var(--line);border-radius:999px;background:#fff;font-weight:650}.org-dot{width:8px;height:8px;border-radius:999px;background:#12b76a;box-shadow:0 0 0 3px #d1fadf}.content{max-width:1440px;margin:auto;padding:34px}.hero{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;margin-bottom:26px}.eyebrow{margin-bottom:6px;color:var(--brand);font-size:12px;font-weight:800;letter-spacing:.09em;text-transform:uppercase}.hero p{max-width:720px;margin-bottom:0;color:var(--muted)}.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;margin-bottom:22px}.metric,.panel{background:#fff;border:1px solid var(--line);border-radius:16px;box-shadow:0 1px 2px rgba(16,24,40,.03)}.metric{padding:19px}.metric-label{color:var(--muted);font-weight:650}.metric-value{margin-top:7px;font-size:28px;font-weight:780;letter-spacing:-.04em}.metric-note{margin-top:3px;color:var(--muted);font-size:12px}.grid-2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.panel{overflow:hidden;margin-bottom:18px}.panel-head{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;padding:19px 20px;border-bottom:1px solid var(--line)}.panel-head h2{margin-bottom:3px}.panel-head p{margin:0;color:var(--muted);font-size:13px}.panel-body{padding:20px}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse}th{padding:11px 14px;background:#f9fafb;color:#667085;font-size:11px;letter-spacing:.06em;text-align:left;text-transform:uppercase;white-space:nowrap}td{padding:13px 14px;border-top:1px solid var(--line);vertical-align:middle}tbody tr:hover{background:#fcfcfd}.primary{font-weight:700}.secondary{color:var(--muted);font-size:12px}.mono{font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace}.badge{display:inline-flex;align-items:center;min-height:24px;padding:2px 8px;border:0;border-radius:999px;background:#eef4ff;color:#3538cd;font-size:11px;font-weight:750}.badge.good{background:#ecfdf3;color:var(--good)}.badge.warn{background:#fff6ed;color:var(--warn)}.badge.bad{background:#fef3f2;color:var(--bad)}.chips{display:flex;flex-wrap:wrap;gap:6px}.chips form{margin:0}.actions{display:flex;align-items:center;flex-wrap:wrap;gap:7px}.actions form{margin:0}.stack{display:grid;gap:14px}.form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 14px}.form-grid .span-2{grid-column:1/-1}.empty{padding:36px;text-align:center;color:var(--muted)}.role-card{padding:17px;border:1px solid var(--line);border-radius:13px;background:#fcfcfd}.role-title{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.role-title h3{margin-bottom:3px}.grant{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 10px;border-radius:9px;background:#f2f4f7}.grant code{font-size:12px}.permission-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.permission{padding:9px 10px;border:1px solid var(--line);border-radius:9px;background:#fff}.pair-code{margin:24px 0;padding:18px;border-radius:14px;background:#f4f3ff;color:#42307d;font:800 32px/1 ui-monospace,monospace;letter-spacing:.14em;text-align:center}.notice-actions{margin-top:24px}.kicker{margin:14px 0 24px;color:var(--muted)}
@media(max-width:1000px){.metrics{grid-template-columns:repeat(2,1fr)}.grid-2{grid-template-columns:1fr}.permission-grid{grid-template-columns:1fr}}
@media(max-width:760px){.layout{display:block}.sidebar{position:static;height:auto;padding:14px}.sidebar-brand{padding:3px 6px 14px}.nav{grid-template-columns:repeat(3,1fr)}.nav a{justify-content:center;padding:9px 6px;font-size:12px}.nav-icon{display:none}.sidebar-foot{position:static;margin-top:12px}.topbar{display:none}.content{padding:22px 14px}.hero{display:block}.metrics{grid-template-columns:1fr 1fr;gap:10px}.metric{padding:15px}.metric-value{font-size:23px}.form-grid{grid-template-columns:1fr}.form-grid .span-2{grid-column:auto}.panel-head{display:block}}
`

/** Wrap an authentication or notice page in the shared document. */
function simplePage(title: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(title)} · DSH Team</title><style>${STYLE}</style></head>
<body><main class="auth"><section class="auth-card"><div class="brand-mark">DS</div>${body}</section></main></body></html>
`
}

const NAV = [
  ['overview', 'OV', 'Overview', '/team/admin'],
  ['organization', 'OR', 'Organization', '/team/admin/organization'],
  ['members', 'US', 'Users', '/team/admin/members'],
  ['roles', 'RB', 'Roles & access', '/team/admin/roles'],
  ['devices', 'DV', 'Devices', '/team/admin/devices'],
  ['models', 'AI', 'Models', '/team/admin/models'],
] as const

/** Wrap an administrative page in the persistent control-console shell. */
function adminPage(
  title: string,
  active: typeof NAV[number][0],
  organizationName: string,
  csrf: string,
  intro: { eyebrow: string; heading: string; description: string },
  body: string,
): string {
  const nav = NAV.map(([key, icon, label, href]) =>
    `<a${key === active ? ' class="active"' : ''} href="${href}"><span class="nav-icon">${icon}</span>${label}</a>`).join('')
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(title)} · DSH Team</title><style>${STYLE}</style></head><body>
<div class="layout"><aside class="sidebar"><div class="sidebar-brand"><div class="brand-mark">DS</div><div><strong>DSH Team</strong><span>Control plane</span></div></div>
<nav class="nav" aria-label="Administration">${nav}</nav><div class="sidebar-foot"><form method="post" action="/team/logout">${csrfField(csrf)}<button class="btn" type="submit">Sign out</button></form></div></aside>
<div class="main"><header class="topbar"><div class="crumb">Administration / ${escape(title)}</div><div class="org-pill"><span class="org-dot"></span>${escape(organizationName)}</div></header>
<main class="content"><section class="hero"><div><div class="eyebrow">${escape(intro.eyebrow)}</div><h1>${escape(intro.heading)}</h1><p>${escape(intro.description)}</p></div></section>${body}</main></div></div></body></html>
`
}

/** The hidden field every write form carries. */
function csrfField(csrf: string): string {
  return `<input type="hidden" name="csrf" value="${escape(csrf)}">`
}

/** Format a timestamp for a compact administrative table. */
function date(value: number): string {
  return new Date(value).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
}

/**
 * A status badge with stable visual semantics.
 *
 * Every status this console renders — a member's, a device's, a model's —
 * either says the thing is in service or says it is not, so the badge has the
 * two tones those words carry and no third one nothing can reach.
 */
function status(value: string): string {
  return `<span class="badge ${value === 'active' ? 'good' : 'bad'}">${escape(value)}</span>`
}

/** The sign-in page. */
export function loginPage(message: string | undefined, next: string): string {
  return simplePage('Sign in', `<p class="eyebrow" style="margin-top:20px">Secure team access</p><h1>Welcome back</h1><p class="kicker">Sign in to manage your organization and connect this account to a local Runner.</p>
${message === undefined ? '' : `<p class="alert">${escape(message)}</p>`}
<form method="post" action="/team/login"><input type="hidden" name="next" value="${escape(next)}">
<label class="field"><span>Member</span><input class="input" name="loginName" autocomplete="username" required></label>
<label class="field"><span>Password</span><input class="input" name="secret" type="password" autocomplete="current-password" required></label>
<button class="btn full" type="submit">Sign in</button></form>`)
}

/** The device confirmation page: what the member compares before confirming. */
export function confirmPage(transaction: PendingTransaction, state: string, csrf: string): string {
  return simplePage('Connect a computer', `<p class="eyebrow" style="margin-top:20px">Device authorization</p><h1>Connect this computer</h1><p class="kicker">Compare this code with the one displayed by your local Runner before you approve access.</p>
<div class="pair-code">${escape(transaction.pairingCode)}</div><div class="stack">
<div><div class="secondary">Platform</div><div class="primary">${escape(transaction.platform)}</div></div>
<div><div class="secondary">Runner version</div><div class="primary">${escape(transaction.runnerVersion)}</div></div>
<div><div class="secondary">Key fingerprint</div><div class="mono">${escape(transaction.publicKeyDigest)}</div></div></div>
<form method="post" action="/team/confirm/${escape(transaction.transactionId)}">${csrfField(csrf)}<input type="hidden" name="state" value="${escape(state)}"><button class="btn full" style="margin-top:24px" type="submit">Confirm this computer</button></form>
<p class="secondary" style="margin:14px 0 0">If you did not start this request, close this page.</p>`)
}

/** A page that says why something cannot continue. */
export function noticePage(title: string, message: string): string {
  return simplePage(title, `<p class="eyebrow" style="margin-top:20px">DSH Team</p><h1>${escape(title)}</h1><p class="kicker">${escape(message)}</p><div class="notice-actions"><a class="btn btn-secondary" href="/team/admin">Return to administration</a></div>`)
}

/** The administrative overview. */
export function dashboardPage(org: Organization, metrics: AdminMetrics, csrf: string): string {
  const cards = [
    ['Users', String(metrics.members), `${metrics.activeMembers} active`],
    ['Roles', String(metrics.roles), 'RBAC roles'],
    ['Devices', String(metrics.devices), `${metrics.activeDevices} active`],
    ['Models', String(metrics.models), `${metrics.activeModels} available`],
  ].map(([label, value, note]) => `<div class="metric"><div class="metric-label">${label}</div><div class="metric-value">${value}</div><div class="metric-note">${note}</div></div>`).join('')
  return adminPage('Overview', 'overview', org.name, csrf, {
    eyebrow: 'Control center', heading: `Good to see you, ${org.name}`,
    description: 'Manage identities, RBAC, connected devices, and company models from one place.',
  }, `<div class="metrics">${cards}</div><div class="grid-2"><section class="panel"><div class="panel-head"><div><h2>Access model</h2><p>Authorization is default-deny and evaluated from role grants.</p></div><span class="badge good">RBAC active</span></div><div class="panel-body"><div class="stack"><div><div class="primary">Policy revision</div><div class="secondary">${escape(org.policyRevision.toString())}</div></div><div><div class="primary">Permission catalog</div><div class="secondary">Code-registered actions only; administrators cannot invent policy strings.</div></div></div></div></section><section class="panel"><div class="panel-head"><div><h2>Data locality</h2><p>Company administration stays separate from member work.</p></div><span class="badge">Local execution</span></div><div class="panel-body"><p class="muted" style="margin:0">Workspace files and complete sessions stay on each member's Runner. This Control Plane stores identities, authorization, devices, model catalog entries, quota, and audit events.</p></div></section></div>`)
}

/** The single-organization settings page. */
export function organizationPage(org: Organization, metrics: AdminMetrics, csrf: string): string {
  return adminPage('Organization', 'organization', org.name, csrf, {
    eyebrow: 'Organization', heading: org.name,
    description: 'This deployment serves one organization. Its identity anchors every account, grant, device, and company resource.',
  }, `<div class="grid-2"><section class="panel"><div class="panel-head"><div><h2>Organization profile</h2><p>Change the name shown throughout the administration console.</p></div></div><div class="panel-body"><form method="post" action="/team/admin/organization/update">${csrfField(csrf)}<label class="field"><span>Display name</span><input class="input" name="name" value="${escape(org.name)}" required></label><button class="btn" type="submit">Save organization</button></form></div></section><section class="panel"><div class="panel-head"><div><h2>Deployment identity</h2><p>Stable identifiers are read-only in the administration console.</p></div></div><div class="panel-body stack"><div><div class="secondary">Organization ID</div><div class="mono">${escape(org.id)}</div></div><div><div class="secondary">Policy revision</div><div class="primary">${escape(org.policyRevision.toString())}</div></div><div><div class="secondary">Created</div><div class="primary">${date(org.createdAt)}</div></div><div><div class="secondary">Managed inventory</div><div class="primary">${metrics.members} users · ${metrics.devices} devices · ${metrics.models} models</div></div></div></section></div>`)
}

/** One member and the roles bound to them. */
export interface MemberRow {
  readonly member: AccountUser
  /** The roles this member holds, already narrowed to this organization's. */
  readonly held: readonly Role[]
}

/** The members page: identities, status, and role bindings. */
export function membersPage(
  org: Organization,
  directory: readonly MemberRow[],
  roles: readonly Role[],
  csrf: string,
): string {
  const rows = directory.map(({ member, held }) => {
    const heldIds = new Set(held.map(role => role.id))
    const available = roles.filter(role => !heldIds.has(role.id))
    const roleChips = held.length === 0 ? '<span class="secondary">No roles</span>' : held.map(role => `<form method="post" action="/team/admin/members/unbind"><input type="hidden" name="userId" value="${escape(member.id)}"><input type="hidden" name="roleId" value="${escape(role.id)}">${csrfField(csrf)}<button class="badge" title="Remove role" type="submit">${escape(role.name)} ×</button></form>`).join('')
    const bind = available.length === 0 ? '' : `<form method="post" action="/team/admin/members/bind">${csrfField(csrf)}<input type="hidden" name="userId" value="${escape(member.id)}"><select class="select" style="width:auto;height:32px" name="roleId">${available.map(role => `<option value="${escape(role.id)}">${escape(role.name)}</option>`).join('')}</select><button class="btn btn-secondary btn-small" type="submit">Add role</button></form>`
    const nextStatus = member.status === 'active' ? 'suspended' : 'active'
    return `<tr><td><div class="primary">${escape(member.displayName)}</div><div class="secondary">@${escape(member.loginName)}${member.email === undefined ? '' : ` · ${escape(member.email)}`}</div></td><td>${status(member.status)}</td><td><div class="chips">${roleChips}</div></td><td><div class="actions">${bind}<form method="post" action="/team/admin/members/status">${csrfField(csrf)}<input type="hidden" name="userId" value="${escape(member.id)}"><input type="hidden" name="status" value="${nextStatus}"><button class="btn ${nextStatus === 'suspended' ? 'btn-danger' : 'btn-secondary'} btn-small" type="submit">${nextStatus === 'suspended' ? 'Suspend' : 'Reactivate'}</button></form></div></td></tr>`
  }).join('')
  return adminPage('Users', 'members', org.name, csrf, {
    eyebrow: 'Identity', heading: 'Users', description: 'Create member identities, control sign-in status, and bind RBAC roles.',
  }, `<section class="panel"><div class="panel-head"><div><h2>Member directory</h2><p>${directory.length} accounts in this organization</p></div></div><div class="table-wrap"><table><thead><tr><th>User</th><th>Status</th><th>Roles</th><th>Actions</th></tr></thead><tbody>${rows || '<tr><td class="empty" colspan="4">No users yet.</td></tr>'}</tbody></table></div></section><section class="panel"><div class="panel-head"><div><h2>Add a user</h2><p>The new account starts without a usable password and must complete enrollment.</p></div></div><div class="panel-body"><form class="form-grid" method="post" action="/team/admin/members/create">${csrfField(csrf)}<label class="field"><span>Login name</span><input class="input" name="loginName" required></label><label class="field"><span>Display name</span><input class="input" name="displayName" required></label><label class="field span-2"><span>Email <span class="secondary">optional</span></span><input class="input" type="email" name="email"></label><div class="span-2"><button class="btn" type="submit">Create user</button></div></form></div></section>`)
}

/** One role and the grants composing it. */
export interface RoleRow {
  readonly role: Role
  readonly grants: readonly RoleGrant[]
}

/** The roles page: roles, grants, and the closed permission catalog. */
export function rolesPage(
  org: Organization,
  composition: readonly RoleRow[],
  permissions: readonly Permission[],
  csrf: string,
): string {
  const permissionOptions = permissions.map(permission => `<option value="${escape(permission.resourceType)}|${escape(permission.action)}">${escape(permission.resourceType)} · ${escape(permission.action)}</option>`).join('')
  const cards = composition.map(({ role, grants }) => {
    const rendered = grants.length === 0 ? '<p class="secondary">No permissions. Default deny applies.</p>' : grants.map(grant => `<div class="grant"><div><code>${escape(grant.action)}</code><div class="secondary">${grant.kind === 'type' ? `All ${escape(grant.resourceType)} resources` : `${escape(grant.resourceType)} · ${escape(grant.resourceDisplayName)}`}</div></div><form method="post" action="/team/admin/roles/grants/revoke">${csrfField(csrf)}<input type="hidden" name="grantId" value="${escape(grant.id)}"><button class="btn btn-danger btn-small" type="submit">Revoke</button></form></div>`).join('')
    return `<article class="role-card"><div class="role-title"><div><h3>${escape(role.name)}</h3><p class="secondary">${escape(role.description || 'No description')}</p></div><span class="badge">${escape(role.kind)}</span></div><div class="stack">${rendered}</div><form class="actions" style="margin-top:13px" method="post" action="/team/admin/roles/grants/add">${csrfField(csrf)}<input type="hidden" name="roleId" value="${escape(role.id)}"><select class="select" style="flex:1" name="permission">${permissionOptions}</select><button class="btn btn-small" type="submit">Add permission</button></form></article>`
  }).join('')
  const catalog = permissions.map(permission => `<div class="permission"><div class="primary">${escape(permission.action)}</div><div class="secondary">${escape(permission.resourceType)}</div></div>`).join('')
  return adminPage('Roles & access', 'roles', org.name, csrf, {
    eyebrow: 'Authorization', heading: 'Roles & access', description: 'Compose roles from the registered permission catalog. Grants allow; absent grants deny.',
  }, `<div class="grid-2"><section class="panel"><div class="panel-head"><div><h2>Roles</h2><p>${composition.length} named access bundles</p></div></div><div class="panel-body stack">${cards || '<div class="empty">No roles yet.</div>'}</div></section><div><section class="panel"><div class="panel-head"><div><h2>Create a role</h2><p>Use a role to group permissions before binding it to users.</p></div></div><div class="panel-body"><form method="post" action="/team/admin/roles/create">${csrfField(csrf)}<label class="field"><span>Name</span><input class="input" name="name" required></label><label class="field"><span>Description</span><input class="input" name="description"></label><button class="btn" type="submit">Create role</button></form></div></section><section class="panel"><div class="panel-head"><div><h2>Permission catalog</h2><p>These are the only actions this build accepts in a grant.</p></div></div><div class="panel-body permission-grid">${catalog}</div></section></div></div>`)
}

/** The devices page: computers bound to team accounts. */
export function devicesPage(org: Organization, devices: readonly Device[], csrf: string): string {
  const rows = devices.map(device => `<tr><td><div class="primary">${escape(device.platform)}</div><div class="secondary mono">${escape(device.publicKeyDigest.slice(0, 16))}…</div></td><td><span class="badge">${escape(device.runnerVersion)}</span></td><td>${status(device.status)}</td><td>${date(device.lastSeenAt)}</td><td>${device.status === 'revoked' ? '<span class="secondary">No actions</span>' : `<form method="post" action="/team/admin/devices/revoke">${csrfField(csrf)}<input type="hidden" name="deviceId" value="${escape(device.id)}"><button class="btn btn-danger btn-small" type="submit">Revoke</button></form>`}</td></tr>`).join('')
  return adminPage('Devices', 'devices', org.name, csrf, {
    eyebrow: 'Runner inventory', heading: 'Devices', description: 'Review computers bound to member accounts and revoke credentials immediately.',
  }, `<section class="panel"><div class="panel-head"><div><h2>Connected computers</h2><p>${devices.filter(device => device.status !== 'revoked').length} active device credentials</p></div></div><div class="table-wrap"><table><thead><tr><th>Device</th><th>Runner</th><th>Status</th><th>Last seen</th><th>Actions</th></tr></thead><tbody>${rows || '<tr><td class="empty" colspan="5">No computers are connected.</td></tr>'}</tbody></table></div></section>`)
}

/** The model catalog page: company endpoints and availability. */
export function modelsPage(org: Organization, models: readonly ModelEntry[], csrf: string): string {
  const rows = models.map(model => `<tr><td><div class="primary">${escape(model.displayName)}</div><div class="secondary mono">${escape(model.modelRef)}</div></td><td><div class="primary">${escape(model.providerRef)}</div><div class="secondary mono">${escape(model.upstreamModel)}</div></td><td><div class="mono">${escape(model.endpoint)}</div><div class="secondary">Credential: ${escape(model.credentialRef)}</div></td><td>${model.maxOutputTokens.toLocaleString()}</td><td>${status(model.status)}</td><td><form method="post" action="/team/admin/models/status">${csrfField(csrf)}<input type="hidden" name="modelRef" value="${escape(model.modelRef)}"><input type="hidden" name="status" value="${model.status === 'active' ? 'retired' : 'active'}"><button class="btn ${model.status === 'active' ? 'btn-danger' : 'btn-secondary'} btn-small" type="submit">${model.status === 'active' ? 'Retire' : 'Activate'}</button></form></td></tr>`).join('')
  return adminPage('Models', 'models', org.name, csrf, {
    eyebrow: 'Company AI', heading: 'Model catalog', description: 'Configure company-owned model routes. Runners receive stable model references, never endpoints or credentials.',
  }, `<section class="panel"><div class="panel-head"><div><h2>Available models</h2><p>${models.filter(model => model.status === 'active').length} active catalog entries</p></div></div><div class="table-wrap"><table><thead><tr><th>Model</th><th>Provider</th><th>Route</th><th>Output ceiling</th><th>Status</th><th>Actions</th></tr></thead><tbody>${rows || '<tr><td class="empty" colspan="6">No company models are registered.</td></tr>'}</tbody></table></div></section><section class="panel"><div class="panel-head"><div><h2>Register a model</h2><p>The credential field stores a reference to the server-side secret, not the secret itself.</p></div></div><div class="panel-body"><form class="form-grid" method="post" action="/team/admin/models/register">${csrfField(csrf)}<label class="field"><span>Stable model ref</span><input class="input" name="modelRef" placeholder="deepseek-chat" required></label><label class="field"><span>Display name</span><input class="input" name="displayName" placeholder="DeepSeek Chat" required></label><label class="field"><span>Provider ref</span><input class="input" name="providerRef" placeholder="deepseek" required></label><label class="field"><span>Upstream model</span><input class="input" name="upstreamModel" placeholder="deepseek-chat" required></label><label class="field span-2"><span>Provider endpoint</span><input class="input" type="url" name="endpoint" placeholder="https://api.example.com" required></label><label class="field"><span>Credential reference</span><input class="input" name="credentialRef" placeholder="COMPANY_DEEPSEEK_KEY" required></label><label class="field"><span>Maximum output tokens</span><input class="input" type="number" min="1" step="1" name="maxOutputTokens" value="8192" required></label><div class="span-2"><button class="btn" type="submit">Register model</button></div></form></div></section>`)
}
