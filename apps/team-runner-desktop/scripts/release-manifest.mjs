/**
 * Building and signing the release manifest a deployment publishes.
 *
 * electron-builder already writes what the updater needs to fetch a release;
 * this adds the document that decides whether a build may install it. The two
 * are kept in agreement here, at the one place that sees both.
 */

import { createHash, createPrivateKey, sign as signBytes } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { load } from 'js-yaml'
import { MANIFEST_VERSION, canonicalManifestBytes } from '@deepseek-ai/dsh-team-update'

/**
 * The platforms a release is published for, and which artifact each one
 * installs from. macOS updates from the zip, never the disk image, because
 * that is what Squirrel.Mac replaces an application with.
 */
export const RELEASE_TARGETS = [
  { platform: 'darwin', architecture: 'arm64', metadata: 'latest-mac.yml', extension: '.zip' },
  { platform: 'win32', architecture: 'x64', metadata: 'latest.yml', extension: '.exe' },
]

/**
 * Read one electron-builder update metadata document.
 * @param {string} text - the YAML written beside the artifacts.
 * @returns {{ version: string, files: { url: string, size: number }[] }} the release it describes.
 */
export function readUpdateMetadata(text) {
  const document = load(text)
  if (typeof document !== 'object' || document === null) throw new Error('update metadata is not a document')
  const { version, files } = /** @type {{ version?: unknown, files?: unknown }} */ (document)
  if (typeof version !== 'string' || !Array.isArray(files)) {
    throw new Error('update metadata carries no version or file list')
  }
  return {
    version,
    files: files.map((file) => {
      const { url, size } = /** @type {{ url?: unknown, size?: unknown }} */ (file)
      if (typeof url !== 'string' || typeof size !== 'number') throw new Error('an update metadata file has no url or size')
      return { url, size }
    }),
  }
}

/**
 * Describe one artifact as the manifest does, reading the file itself for the
 * digest the installed application will check after downloading it.
 * @param {string} directory - where the built artifacts are.
 * @param {{ platform: string, architecture: string, extension: string }} target - the platform this artifact is for.
 * @param {string} name - the artifact's filename.
 * @param {string} baseUrl - the directory the deployment serves artifacts from.
 * @returns {{ platform: string, architecture: string, url: string, digest: string, sizeBytes: number }} the artifact entry.
 */
export function artifactOf(directory, target, name, baseUrl) {
  const path = join(directory, name)
  if (!existsSync(path)) throw new Error(`the release directory has no ${name}`)
  return {
    platform: target.platform,
    architecture: target.architecture,
    url: new URL(name, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).href,
    digest: createHash('sha256').update(readFileSync(path)).digest('base64url'),
    sizeBytes: statSync(path).size,
  }
}

/**
 * Build the manifest for one release from what the build produced.
 *
 * The version each metadata document names must be the version being
 * published: a release directory from another build is the mistake this
 * catches, and it would otherwise ship a signature over the wrong files.
 * @param {{ directory: string, version: string, minimumFrom: string, baseUrl: string, publishedAt?: number, targets?: typeof RELEASE_TARGETS }} input - the release to describe.
 * @returns {import('@deepseek-ai/dsh-team-update').UpdateManifest} the manifest, unsigned.
 */
export function releaseManifest(input) {
  const targets = input.targets ?? RELEASE_TARGETS
  const artifacts = []
  for (const target of targets) {
    const metadataPath = join(input.directory, target.metadata)
    if (!existsSync(metadataPath)) continue
    const metadata = readUpdateMetadata(readFileSync(metadataPath, 'utf8'))
    if (metadata.version !== input.version) {
      throw new Error(`${target.metadata} describes ${metadata.version}, not ${input.version}`)
    }
    const file = metadata.files.find(entry => entry.url.endsWith(target.extension))
    if (file === undefined) throw new Error(`${target.metadata} lists no ${target.extension} artifact`)
    artifacts.push(artifactOf(input.directory, target, file.url, input.baseUrl))
  }
  if (artifacts.length === 0) throw new Error('the release directory holds no update metadata for any platform')
  return {
    manifestVersion: MANIFEST_VERSION,
    version: input.version,
    minimumFrom: input.minimumFrom,
    publishedAt: input.publishedAt ?? Date.now(),
    artifacts,
  }
}

/**
 * Sign a manifest with the release key.
 * @param {import('@deepseek-ai/dsh-team-update').UpdateManifest} manifest - the manifest to sign.
 * @param {string} privateKeyPem - PKCS8 PEM of the Ed25519 release private key.
 * @returns {{ manifest: import('@deepseek-ai/dsh-team-update').UpdateManifest, signature: string }} the published document.
 */
export function signRelease(manifest, privateKeyPem) {
  const key = createPrivateKey(privateKeyPem)
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('the release key must be an Ed25519 private key')
  return { manifest, signature: signBytes(null, canonicalManifestBytes(manifest), key).toString('base64url') }
}
