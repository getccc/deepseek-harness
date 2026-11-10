/**
 * Serving the administration console from the Control Plane.
 *
 * The console is a built browser application: this mounts its files under one
 * address and does nothing else. The page itself is not secret — every view it
 * can render asks the administration API first, and that is where a session is
 * required — so the files are served without authentication and the API is
 * what refuses.
 * @module @deepseek-ai/dsh-team-admin-app
 */

import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { serveStatic } from '@deepseek-ai/dsh-host-frontend-static'
import type { WebResourceRoute } from '@deepseek-ai/dsh-host-webserver'

/** Stable Cordis plugin name. */
export const name = 'team-admin-app'

/** Service required before the console's files can be claimed. */
export const inject = ['webServer']

/**
 * Address the console is served under.
 *
 * Fixed rather than configurable: the application compiled against it addresses
 * the administration API by an absolute path, so a deployment that moved the
 * page would have to rebuild the application to match.
 */
export const CONSOLE_PREFIX = '/team/admin'

/** Where the built console lives, as workspace knowledge of this package. */
function distIndexPath(): string {
  return createRequire(import.meta.url).resolve('@deepseek-ai/dsh-team-admin-frontend/dist/index.html')
}

/**
 * Mount the built administration console.
 * @param ctx - the Control Plane context.
 */
export function apply(ctx: Context): void {
  const distIndex = distIndexPath()
  const distRoot = dirname(distIndex)

  const console: WebResourceRoute = {
    kind: 'prefix',
    path: CONSOLE_PREFIX,
    resource: (request) => {
      const url = new URL(request.url)
      url.pathname = url.pathname.slice(CONSOLE_PREFIX.length) || '/'
      return serveStatic(
        new Request(url, { method: request.method, headers: request.headers }),
        distRoot,
        distIndex,
        () => undefined,
        page => page.replace(/<head(?:\s[^>]*)?>/iu, open => `${open}<base href="${CONSOLE_PREFIX}/">`),
      )
    },
  }

  ctx.effect(() => ctx.webServer.register(console), `team-admin-app: ${CONSOLE_PREFIX}`)
}
