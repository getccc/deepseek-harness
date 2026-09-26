import type { UpdateManifest } from '@deepseek-ai/dsh-team-update'

/** One platform a release is published for, and the artifact it installs from. */
export interface ReleaseTarget {
  readonly platform: string
  readonly architecture: string
  /** Filename of the electron-builder update metadata for this platform. */
  readonly metadata: string
  /** Extension of the artifact an update installs from. */
  readonly extension: string
}

/** The platforms a release is published for. */
export declare const RELEASE_TARGETS: readonly ReleaseTarget[]

/**
 * Read one electron-builder update metadata document.
 * @param text - the YAML written beside the artifacts.
 * @returns the release it describes.
 */
export declare function readUpdateMetadata(text: string): {
  version: string
  files: { url: string; size: number }[]
}

/**
 * Describe one artifact as the manifest does.
 * @param directory - where the built artifacts are.
 * @param target - the platform this artifact is for.
 * @param name - the artifact's filename.
 * @param baseUrl - the directory the deployment serves artifacts from.
 * @returns the artifact entry.
 */
export declare function artifactOf(
  directory: string,
  target: ReleaseTarget,
  name: string,
  baseUrl: string,
): UpdateManifest['artifacts'][number]

/**
 * Build the manifest for one release from what the build produced.
 * @param input - the release to describe.
 * @returns the manifest, unsigned.
 * @throws when a metadata document describes another version, or no platform has one.
 */
export declare function releaseManifest(input: {
  directory: string
  version: string
  minimumFrom: string
  baseUrl: string
  publishedAt?: number
  targets?: readonly ReleaseTarget[]
}): UpdateManifest

/**
 * Sign a manifest with the release key.
 * @param manifest - the manifest to sign.
 * @param privateKeyPem - PKCS8 PEM of the Ed25519 release private key.
 * @returns the published document.
 */
export declare function signRelease(
  manifest: UpdateManifest,
  privateKeyPem: string,
): { manifest: UpdateManifest; signature: string }
