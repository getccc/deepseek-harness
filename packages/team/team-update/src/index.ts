/**
 * Deciding whether an offered release may be installed.
 *
 * A Runner replaces its own executable, so this is the one decision where
 * being wrong hands the machine to whoever produced the manifest. Every check
 * is therefore stated as a refusal with its own word, and an update is applied
 * only when none of them fires.
 * @module @deepseek-ai/dsh-team-update
 */

import { verify } from 'node:crypto'
import { canonicalManifestBytes, MANIFEST_VERSION } from './manifest.ts'
import { compareVersions, MalformedVersionError } from './version.ts'
import type { UpdateArtifact, UpdateManifest } from './manifest.ts'
import type { UpdateRefusal, UpdateTarget } from './types.ts'

export {
  MANIFEST_VERSION,
  canonicalManifestBytes,
  type UpdateArchitecture,
  type UpdateArtifact,
  type UpdateManifest,
  type UpdatePlatform,
} from './manifest.ts'
export {
  SERVICE_LABEL,
  launchdPlist,
  serviceDefinitionFor,
  systemdUnit,
  windowsTaskDefinition,
  type ServiceDefinition,
} from './service.ts'
export type { UpdateDecision, UpdateRefusal, UpdateTarget } from './types.ts'
export {
  MalformedVersionError,
  compareVersions,
  versionComponents,
} from './version.ts'

/** Every reason this build refuses an offered release. */
export const UPDATE_REFUSALS = [
  /** The signature did not verify against the release key this build trusts. */
  'signature',
  /** The manifest is written in a format this build does not read. */
  'manifest-version',
  /** The offered release is not newer than what is installed. */
  'not-newer',
  /** The release cannot be applied on top of the installed version. */
  'upgrade-path',
  /** The release carries no artifact for this platform and processor. */
  'no-artifact',
  /** A version string in the manifest is not one this build can compare. */
  'malformed-version',
] as const

/**
 * Decide whether an offered release may be installed on this computer.
 *
 * The signature is checked first and against the canonical bytes, so every
 * later check reads values a release key vouched for rather than values the
 * document merely claims.
 * @param manifest - the offered release manifest.
 * @param signature - base64url signature over {@link canonicalManifestBytes}.
 * @param target - the release key this build trusts and what is installed here.
 * @returns the artifact to install, or the reason this release is refused.
 */
export function decideUpdate(
  manifest: UpdateManifest,
  signature: string,
  target: UpdateTarget,
): { readonly install: UpdateArtifact } | { readonly refused: UpdateRefusal } {
  if (!verifiesAgainstReleaseKey(manifest, signature, target.releaseKey)) return { refused: 'signature' }
  // Every check below reads a value the release key vouched for.
  if (manifest.manifestVersion !== MANIFEST_VERSION) return { refused: 'manifest-version' }
  try {
    // Monotonic, and strictly so: reinstalling the running version is not an
    // update, and accepting an older one is how a fixed defect comes back.
    if (compareVersions(manifest.version, target.installedVersion) <= 0) return { refused: 'not-newer' }
    if (compareVersions(target.installedVersion, manifest.minimumFrom) < 0) return { refused: 'upgrade-path' }
  } catch (error) {
    /* v8 ignore next -- compareVersions throws only MalformedVersionError */
    if (!(error instanceof MalformedVersionError)) throw error
    return { refused: 'malformed-version' }
  }
  const install = manifest.artifacts.find(artifact =>
    artifact.platform === target.platform && artifact.architecture === target.architecture)
  if (install === undefined) return { refused: 'no-artifact' }
  return { install }
}

/** Whether the signature was made by the release key this build trusts. */
function verifiesAgainstReleaseKey(
  manifest: UpdateManifest,
  signature: string,
  releaseKey: string,
): boolean {
  try {
    return verify(null, canonicalManifestBytes(manifest), {
      key: Buffer.from(releaseKey, 'base64url'),
      format: 'der',
      type: 'spki',
    }, Buffer.from(signature, 'base64url'))
  } catch {
    // A malformed key or signature is a refusal, not a crash: both arrive from
    // a document this Runner has not yet decided to trust.
    return false
  }
}
