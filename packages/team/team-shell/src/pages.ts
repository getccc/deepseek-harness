/**
 * The pages this package serves.
 *
 * Server-rendered, with no script and no external reference. A member arrives
 * here from a link their own Runner served, to compare a code and press one
 * button; there is nothing for a browser application to do here that this
 * cannot do before one would have loaded.
 * @module @deepseek-ai/dsh-team-shell/pages
 */

import type { PendingTransaction } from '@deepseek-ai/dsh-device-authorization'

/** Escape text for insertion into HTML. */
function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

const STYLE = `
:root{color-scheme:light;--ink:#172033;--muted:#667085;--brand:#1677ff;--brand2:#8b5cf6}
*{box-sizing:border-box}body{margin:0;color:var(--ink);font:14px/1.5 Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}button{cursor:pointer;font:inherit}
.auth{min-height:100vh;display:grid;place-items:center;padding:32px;background:radial-gradient(circle at 15% 10%,#ebe9ff 0,transparent 36%),radial-gradient(circle at 90% 90%,#e0f2fe 0,transparent 34%),#f7f8fc}
.auth-card{width:min(100%,440px);padding:34px;background:#fff;border:1px solid rgba(22,119,255,.13);border-radius:24px;box-shadow:0 24px 64px rgba(16,24,40,.12)}
.brand-mark{display:grid;place-items:center;width:42px;height:42px;border-radius:13px;background:linear-gradient(135deg,var(--brand),var(--brand2));color:#fff;font-weight:800}
h1{margin:0 0 14px;font-size:28px;line-height:1.2;letter-spacing:-.03em}
.eyebrow{margin:0 0 6px;color:var(--brand);font-size:12px;font-weight:800;letter-spacing:.09em;text-transform:uppercase}
.kicker{margin:14px 0 24px;color:var(--muted)}
.stack{display:grid;gap:14px}.primary{font-weight:700}.secondary{color:var(--muted);font-size:12px}
.mono{font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}
.pair-code{margin:24px 0;padding:18px;border-radius:14px;background:#f4f3ff;color:#42307d;font:800 32px/1 ui-monospace,monospace;letter-spacing:.14em;text-align:center}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:40px;padding:0 14px;border:1px solid transparent;border-radius:10px;background:var(--brand);color:#fff;font-weight:700;text-decoration:none}
.btn:hover{filter:brightness(.97)}.btn-secondary{background:#fff;border-color:#d0d5dd;color:#344054}.full{width:100%}
.notice-actions{margin-top:24px}
`

/** Wrap an authentication or notice page in the shared document. */
function simplePage(title: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(title)} · DSH Team</title><style>${STYLE}</style></head>
<body><main class="auth"><section class="auth-card"><div class="brand-mark">DS</div>${body}</section></main></body></html>
`
}

/** The hidden field every write form carries. */
function csrfField(csrf: string): string {
  return `<input type="hidden" name="csrf" value="${escape(csrf)}">`
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
