/** Packaging-time inputs an installed build carries: the release version and the plugin tree's identity. */

import { createHash } from 'node:crypto'
import { readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/** Environment variable naming the release this build is. */
export const APP_VERSION_ENV = 'DSH_TEAM_APP_VERSION'

/** A release version is three numbers and nothing else. */
const RELEASE_VERSION = /^\d+\.\d+\.\d+$/u

/**
 * Validate the release version this build carries.
 *
 * A suffix breaks updating in two separate places, so neither form is
 * accepted. `electron-updater` reads the channel out of a prerelease tag, so
 * `1.1.0-beta.1` asks for `beta.yml` instead of `latest.yml`; and
 * `dsh-team-update` compares only the three numbers, so a prerelease and the
 * release that follows it compare equal and the update is refused as
 * `not-newer`. Build metadata after `+` is ignored by semver comparison
 * entirely, so two builds of one version would never replace each other.
 * @param {NodeJS.ProcessEnv} env - the packaging environment.
 * @returns {string} the validated `MAJOR.MINOR.PATCH` version.
 */
export function resolveAppVersion(env) {
  const value = env[APP_VERSION_ENV]?.trim()
  if (value === undefined || value === '') {
    throw new Error(`${APP_VERSION_ENV} must name the release version, for example 1.0.0`)
  }
  if (!RELEASE_VERSION.test(value)) {
    throw new Error(
      `${APP_VERSION_ENV} must be MAJOR.MINOR.PATCH with no prerelease tag and no build metadata; received ${value}`,
    )
  }
  return value
}

/**
 * Identify the plugin tree by its content, so an upgrade that ships the same
 * plugins does not recopy them. Paths and sizes are what the walk reads:
 * modification times differ between two installs of one dependency set, and
 * reading 959 MB to hash it would cost more than the copy it saves.
 * @param {string} directory - the staged plugin tree.
 * @returns {string} a stable short digest of the tree's contents.
 */
export function pluginTreeFingerprint(directory) {
  const entries = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      const name = relative(directory, path).split(sep).join('/')
      if (entry.isSymbolicLink()) entries.push(`${name}\0link`)
      else if (entry.isDirectory()) walk(path)
      else if (entry.isFile()) entries.push(`${name}\0${String(statSync(path).size)}`)
    }
  }
  walk(directory)
  entries.sort()
  const hash = createHash('sha256')
  for (const entry of entries) hash.update(entry).update('\n')
  return hash.digest('hex').slice(0, 16)
}
