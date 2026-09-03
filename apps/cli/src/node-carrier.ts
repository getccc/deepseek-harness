/**
 * The packaged executable as a child's Node.
 *
 * A single-file build cannot hand argv to a separate Node: a plugin that
 * spawns `process.execPath` with its worker script — the convention every
 * Node program follows — re-enters this executable, whose entry would read
 * that script path as a broken `dsh` invocation. The launcher therefore
 * recognizes the shape of such a spawn and runs the script as Node would.
 * This is a child-process carrier confined to the packaged build, not an
 * application launcher: applications still start with `dsh --profile`.
 * @module @deepseek-ai/dsh/node-carrier
 */

import { extname, isAbsolute } from 'node:path'

/** Extensions Node's own `node <file>` would execute. */
const SCRIPT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs'])

/**
 * The script a child spawn asked this executable to run, when the arguments
 * have that shape: an absolute path to an existing JavaScript file first.
 * Every `dsh` invocation starts with an option, so no launcher use is
 * shadowed; a relative path is refused because the child's cwd is not known
 * to be the spawner's.
 * @param argv - the arguments after the executable and its entry.
 * @param exists - whether one absolute path names an existing file.
 * @returns the script to run in place of the launcher, or `undefined`.
 */
export function carriedScript(argv: readonly string[], exists: (path: string) => boolean): string | undefined {
  const first = argv[0]
  if (first === undefined || !isAbsolute(first) || !SCRIPT_EXTENSIONS.has(extname(first))) return undefined
  return exists(first) ? first : undefined
}
