/**
 * The release manifest: what an update is, and what a Runner checks before it
 * becomes one.
 *
 * A Runner replaces its own executable, so the manifest is the one artifact
 * whose authenticity decides everything downstream. It is defined here as data
 * with a canonical byte encoding, because a signature over "the manifest" is
 * only meaningful if both sides agree on which bytes those are.
 * @module @deepseek-ai/dsh-team-update/manifest
 */

import type { DEVICE_PLATFORMS } from '@deepseek-ai/dsh-device-authorization'

/** The platform an artifact is built for. */
export type UpdatePlatform = typeof DEVICE_PLATFORMS[number]

/** The processor an artifact is built for. */
export type UpdateArchitecture = 'arm64' | 'x64'

/** One downloadable artifact in a release. */
export interface UpdateArtifact {
  readonly platform: UpdatePlatform
  readonly architecture: UpdateArchitecture
  /** Where the artifact is fetched from. */
  readonly url: string
  /** Base64url SHA-256 of the artifact bytes, checked after download. */
  readonly digest: string
  readonly sizeBytes: number
}

/**
 * One release, as the signed manifest describes it.
 *
 * `minimumFrom` is what makes an upgrade path expressible: a release that
 * cannot be applied on top of an older build states the oldest one it accepts,
 * and a Runner below it installs an intermediate release first rather than
 * discovering the problem after replacing itself.
 */
export interface UpdateManifest {
  /** The manifest format this document is written in. */
  readonly manifestVersion: number
  /** The release being offered, as a dotted numeric version. */
  readonly version: string
  /** The oldest installed version this release may be applied on top of. */
  readonly minimumFrom: string
  /** When the release was published, in epoch milliseconds. */
  readonly publishedAt: number
  readonly artifacts: readonly UpdateArtifact[]
}

/** The manifest format this build writes and reads. */
export const MANIFEST_VERSION = 1

/**
 * The bytes a release key signs.
 *
 * Field order is fixed here rather than taken from the document, so two
 * documents that mean the same release produce the same bytes, and a document
 * that reorders its fields cannot present a different signature as valid.
 * @param manifest - the manifest to encode.
 * @returns the canonical UTF-8 encoding to sign and to verify against.
 */
export function canonicalManifestBytes(manifest: UpdateManifest): Buffer {
  const artifacts = [...manifest.artifacts]
    .map(artifact => [
      artifact.platform,
      artifact.architecture,
      artifact.url,
      artifact.digest,
      String(artifact.sizeBytes),
    ].join(' '))
    // Sorted, so the same set of artifacts in any order signs identically.
    .sort()
  return Buffer.from([
    `dsh-update-manifest:${String(manifest.manifestVersion)}`,
    manifest.version,
    manifest.minimumFrom,
    String(manifest.publishedAt),
    ...artifacts,
  ].join('\n'), 'utf8')
}
