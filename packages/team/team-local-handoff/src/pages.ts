/**
 * The two pages the handoff serves a person.
 *
 * They are plain HTML with no script and no external reference: a member
 * reaches them while the application is not yet unlocked, so nothing here may
 * depend on the application's own assets loading.
 * @module @deepseek-ai/dsh-team-local-handoff/pages
 */

/** Escape text for insertion into HTML. */
function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

const STYLE = 'font: 16px/1.5 system-ui, sans-serif; margin: 4rem auto; max-width: 34rem; padding: 0 1rem'

/**
 * The local pairing page: the code to compare, and the link that carries the
 * member to the Control Plane to compare it.
 * @param pairingCode - the code the Control Plane will show alongside its own copy.
 * @param confirmUrl - the Control Plane address for this transaction, carrying the local state.
 * @param expiresAt - when the transaction lapses, in epoch milliseconds.
 * @returns the page body.
 */
export function pairingPage(pairingCode: string, confirmUrl: string, expiresAt: number): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Connect this computer</title></head>
<body style="${STYLE}">
<h1>Connect this computer</h1>
<p>This computer's pairing code is:</p>
<p style="font: 700 2rem/1 ui-monospace, monospace; letter-spacing: 0.1em">${escape(pairingCode)}</p>
<p>Continue on the company site and check that it shows the same code before you confirm.</p>
<p><a href="${escape(confirmUrl)}">Continue to the company site</a></p>
<p>This code stops working at ${escape(new Date(expiresAt).toISOString())}.</p>
</body>
</html>
`
}

/**
 * The page shown when a handoff cannot continue.
 * @param message - what went wrong, in terms a member can act on.
 * @returns the page body.
 */
export function problemPage(message: string): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Cannot continue</title></head>
<body style="${STYLE}">
<h1>Cannot continue</h1>
<p>${escape(message)}</p>
<p><a href="/team/start">Start again</a></p>
</body>
</html>
`
}
