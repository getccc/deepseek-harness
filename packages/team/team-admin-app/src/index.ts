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
import { readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { serveStatic } from '@deepseek-ai/dsh-host-frontend-static'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'

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

  /**
   * The console's page, anchored at the address it is served under.
   *
   * The application is built with relative asset URLs so the same files mount
   * anywhere; a request for the prefix without a trailing slash would resolve
   * those one directory too high, and the base element settles it for both.
   */
  const renderIndex = async (): Promise<string> => {
    const page = await readFile(distIndex, 'utf8')
    return page.replace(/<head(?:\s[^>]*)?>/iu, open => `${open}<base href="${CONSOLE_PREFIX}/">`)
  }

  const console: WebRoute = {
    kind: 'prefix',
    path: CONSOLE_PREFIX,
    handler: async (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405)
        res.end()
        return
      }
      /* v8 ignore next -- node:http always supplies url on server requests. */
      const url = new URL(req.url ?? '/', 'http://dsh.invalid')
      const within = decodeURIComponent(url.pathname).slice(CONSOLE_PREFIX.length)
      await serveStatic(
        within === '' ? '/' : within,
        res,
        distRoot,
        distIndex,
        // The page is public; every view it renders asks the API, and the API
        // is where a session is required.
        () => true,
        renderIndex,
      )
    },
  }

  ctx.effect(() => ctx.webServer.register(console), `team-admin-app: ${CONSOLE_PREFIX}`)
}
