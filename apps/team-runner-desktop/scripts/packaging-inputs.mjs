/** Packaging-time inputs an installed build carries: the release version and the plugin tree's identity. */

import { createHash, createPublicKey } from 'node:crypto'
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

/** Environment variable carrying the release public key this build trusts. */
export const RELEASE_KEY_ENV = 'DSH_TEAM_RELEASE_KEY'

/**
 * Validate the release public key, in the encoding the decision kernel reads:
 * base64url DER SPKI of an Ed25519 public key.
 *
 * A build without one carries no trust root for an update, so it never checks
 * for one. That is the safe absence: a deployment that has not yet published
 * a release key keeps distributing complete installers.
 * @param {NodeJS.ProcessEnv} env - the packaging environment.
 * @returns {string | undefined} the validated key, or undefined when this build carries none.
 */
export function resolveReleaseKey(env) {
  const value = env[RELEASE_KEY_ENV]?.trim()
  if (value === undefined || value === '') return undefined
  let key
  try {
    key = createPublicKey({ key: Buffer.from(value, 'base64url'), format: 'der', type: 'spki' })
  } catch (cause) {
    throw new Error(`${RELEASE_KEY_ENV} must be base64url DER SPKI of the release public key`, { cause })
  }
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new Error(`${RELEASE_KEY_ENV} must be an Ed25519 public key; received ${String(key.asymmetricKeyType)}`)
  }
  return value
}

/** Environment variable naming where this build fetches release artifacts. */
export const UPDATE_ORIGIN_ENV = 'DSH_TEAM_UPDATE_ORIGIN'

/**
 * Where the installed build fetches release artifacts and the updater
 * metadata beside them.
 *
 * It defaults to the deployment's own Control Plane, which needs no second
 * address. A deployment whose Control Plane has little bandwidth — every
 * member pulls a few hundred megabytes on a release — points this at object
 * storage or a CDN instead. Nothing about trust moves with it: what may be
 * installed is decided by the signed manifest the Control Plane serves, and
 * the downloaded bytes are checked against the digest that manifest carries.
 * @param {NodeJS.ProcessEnv} env - the packaging environment.
 * @param {string} controlPlaneUrl - the deployment's Control Plane origin.
 * @returns {string} the directory releases are served from, ending in a slash.
 */
export function resolveUpdateOrigin(env, controlPlaneUrl) {
  const value = env[UPDATE_ORIGIN_ENV]?.trim()
  const url = new URL(value === undefined || value === '' ? '/updates/' : value, controlPlaneUrl)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`${UPDATE_ORIGIN_ENV} must be an http or https address; received ${url.protocol}`)
  }
  return url.href.endsWith('/') ? url.href : `${url.href}/`
}
