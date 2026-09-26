#!/usr/bin/env node
/**
 * Write the signed release manifest beside the artifacts a build produced.
 *
 * Run it on the release machine, where the private key is. The key is read
 * from a file rather than the environment, so it never appears in a process
 * listing or a shell history.
 *
 * ```sh
 * node scripts/publish-release.mjs \
 *   --directory release/signed-20260920-wework \
 *   --version 1.0.0 --minimum-from 1.0.0 \
 *   --base-url https://10.1.120.90:3095/updates/ \
 *   --key ~/.dsh/wework-release.key
 * ```
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { releaseManifest, signRelease } from './release-manifest.mjs'

const { values } = parseArgs({
  options: {
    directory: { type: 'string' },
    version: { type: 'string' },
    'minimum-from': { type: 'string' },
    'base-url': { type: 'string' },
    key: { type: 'string' },
  },
})

for (const name of ['directory', 'version', 'minimum-from', 'base-url', 'key']) {
  if (values[name] === undefined) throw new Error(`--${name} is required`)
}

const directory = /** @type {string} */ (values.directory)
const document = signRelease(
  releaseManifest({
    directory,
    version: /** @type {string} */ (values.version),
    minimumFrom: /** @type {string} */ (values['minimum-from']),
    baseUrl: /** @type {string} */ (values['base-url']),
  }),
  readFileSync(/** @type {string} */ (values.key), 'utf8'),
)

const path = join(directory, 'manifest.json')
writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`)
console.log(`wrote ${path} for ${document.manifest.version} with ${String(document.manifest.artifacts.length)} artifact(s)`)
