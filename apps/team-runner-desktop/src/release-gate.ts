/**
 * The gate an offered release passes before it is installed here.
 *
 * `electron-updater` decides what to fetch from the metadata beside the
 * artifacts; this gate decides whether that release may replace the running
 * one at all. It reads the signed manifest the deployment published, so a
 * tampered metadata file or a substituted artifact is refused even where the
 * installer carries no code signature of its own.
 * @module @deepseek-ai/dsh-team-runner-desktop/release-gate
 */

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import {
  compareVersions, decideUpdate,
  type UpdateArchitecture, type UpdateArtifact, type UpdateManifest, type UpdatePlatform,
} from '@deepseek-ai/dsh-team-update'

/** Platforms a release is built for, as the manifest names them. */
const PLATFORMS: readonly UpdatePlatform[] = ['darwin', 'linux', 'win32']

/** Processors a release is built for. */
const ARCHITECTURES: readonly UpdateArchitecture[] = ['arm64', 'x64']

/** The signed document a deployment publishes beside its artifacts. */
export interface SignedManifest {
  readonly manifest: UpdateManifest
  /** Base64url Ed25519 signature over the manifest's canonical bytes. */
  readonly signature: string
  /** The oldest version this deployment still accepts, when it sets one. */
  readonly minimumVersion?: string
}

/** What this computer is, for the decision the manifest is read against. */
export interface ReleaseTarget {
  /** Base64url DER SPKI encoding of the release public key this build trusts. */
  readonly releaseKey: string
  readonly installedVersion: string
  readonly platform: NodeJS.Platform
  readonly architecture: string
}

/** An accepted release, or why it was refused. */
export type GateVerdict =
  | {
    readonly accepted: UpdateArtifact
    /** Whether the installed build is below the floor this deployment enforces. */
    readonly required: boolean
  }
  | {
    readonly refused: string
    /**
     * Whether the refusal is this member having nothing to take rather than
     * something being wrong. A staged release nobody offered them is the
     * ordinary case, and reporting it as a failure would put a warning in
     * front of every member outside the pilot group.
     */
    readonly quiet?: boolean
  }

/**
 * Raised when this computer has no release to consider: the deployment offers
 * this member none, the Runner is not signed in, or the deployment could not
 * be reached. None of the three is something a member can act on, and all
 * three are ordinary.
 */
export class NoOfferedReleaseError extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'NoOfferedReleaseError'
  }
}

/** The two questions the coordinator asks before it replaces this build. */
export interface ReleaseGate {
  /**
   * Whether the offered version may be installed here.
   * @param offered - the version the update metadata announced.
   * @returns the accepted artifact, or why nothing is installed.
   */
  accept(offered: string): Promise<GateVerdict>
  /**
   * Whether a downloaded file is the artifact the release key vouched for.
   * @param path - the downloaded file.
   * @param accepted - the artifact this release was accepted on.
   * @returns nothing when it matches, or why it does not.
   */
  verify(path: string, accepted: UpdateArtifact): Promise<string | undefined>
}

/** How the gate reaches the deployment's manifest. */
export type ManifestReader = () => Promise<SignedManifest>

/**
 * The request the manifest is read with. Narrower than the platform `fetch`,
 * because Electron's own `net.fetch` — the one that sees the pinned
 * deployment authority — takes a string rather than a `URL`.
 */
export type ManifestRequest = (url: string) => Promise<Response>

/**
 * Read one signed manifest from a deployment.
 * @param url - the manifest endpoint.
 * @param request - the request used; the shell passes one that sees the pinned deployment authority.
 * @returns the manifest and its signature.
 * @throws when the endpoint answers an error or a document this build cannot read.
 */
export async function readManifest(url: string, request: ManifestRequest = fetch): Promise<SignedManifest> {
  const response = await request(url)
  if (!response.ok) {
    // Every refusal here is a state of this computer rather than a fault a
    // member could do something about: 404 is the staged channel for everyone
    // outside the pilot group, 401 a Runner that is not signed in, and the
    // rest a deployment that could not answer.
    throw new NoOfferedReleaseError(response.status === 401
      ? 'this computer is not signed in to the deployment'
      : `the deployment answered ${String(response.status)} for the release manifest`)
  }
  const document = await response.json() as {
    manifest?: unknown
    signature?: unknown
    minimumVersion?: unknown
  }
  if (typeof document.signature !== 'string' || typeof document.manifest !== 'object' || document.manifest === null) {
    throw new Error('release manifest is missing its manifest or signature')
  }
  // The fields are read as the manifest type here and verified by the
  // signature before any of them is acted on: a document whose contents differ
  // from what the release key signed cannot produce a valid signature.
  return {
    manifest: document.manifest as UpdateManifest,
    signature: document.signature,
    // The floor is the deployment's own statement rather than the release
    // key's, because it changes without republishing a release.
    ...typeof document.minimumVersion === 'string' ? { minimumVersion: document.minimumVersion } : {},
  }
}

/**
 * Decide whether the offered version may be installed on this computer.
 *
 * The version `electron-updater` found and the version the manifest signs must
 * be the same release: metadata that names a version the release key did not
 * vouch for is exactly what this gate exists to refuse.
 * @param offered - the version the update metadata announced.
 * @param target - what this computer is and which release key it trusts.
 * @param read - how the signed manifest is fetched.
 * @returns the artifact to install, or why nothing is installed.
 */
export async function acceptRelease(
  offered: string,
  target: ReleaseTarget,
  read: ManifestReader,
): Promise<GateVerdict> {
  let signed: SignedManifest
  try {
    signed = await read()
  } catch (error) {
    // Unreachable, unreadable, and not signed in are all this computer's
    // situation rather than a failure to report; the shell log keeps them.
    return {
      refused: error instanceof Error ? error.message : String(error),
      quiet: true,
    }
  }
  const platform = PLATFORMS.find(name => name === target.platform)
  const architecture = ARCHITECTURES.find(name => name === target.architecture)
  // A computer outside the platforms releases are built for is refused here
  // rather than handed to the decision as some other platform's build.
  if (platform === undefined || architecture === undefined) {
    return { refused: `no releases are built for ${target.platform} ${target.architecture}` }
  }
  const decision = decideUpdate(signed.manifest, signed.signature, {
    releaseKey: target.releaseKey,
    installedVersion: target.installedVersion,
    platform,
    architecture,
  })
  if ('refused' in decision) {
    // A signature that does not verify is the one refusal a member should
    // see: it means the document did not come from the release key. The
    // others — not newer, no artifact for this computer, an upgrade path this
    // build may not take — are ordinary states of a healthy deployment.
    return {
      refused: `release refused: ${decision.refused}`,
      ...decision.refused === 'signature' ? {} : { quiet: true },
    }
  }
  if (signed.manifest.version !== offered) {
    // The metadata beside the artifacts is not what this build trusts, and a
    // deployment mid-publish shows exactly this for a moment.
    return {
      refused: `release metadata offers ${offered}, the signed manifest ${signed.manifest.version}`,
      quiet: true,
    }
  }
  // Below the floor the deployment enforces, this update is not optional; the
  // member is told so rather than left on a build the deployment refuses.
  const required = signed.minimumVersion !== undefined
    && compareVersions(target.installedVersion, signed.minimumVersion) < 0
  return { accepted: decision.install, required }
}

/**
 * Verify a downloaded file against the artifact the release key vouched for.
 *
 * The updater already checked the hash its own metadata carried; this checks
 * the one the signature covers, which is the only hash an attacker who
 * replaced both the artifact and the metadata could not choose.
 * @param path - the downloaded file.
 * @param artifact - the accepted artifact.
 * @returns nothing when the file matches, or why it does not.
 */
export async function verifyDownload(path: string, artifact: UpdateArtifact): Promise<string | undefined> {
  const size = (await stat(path)).size
  if (size !== artifact.sizeBytes) {
    return `downloaded ${String(size)} bytes, the signed manifest names ${String(artifact.sizeBytes)}`
  }
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Uint8Array)
  const digest = hash.digest('base64url')
  return digest === artifact.digest ? undefined : 'the downloaded file does not match the signed manifest'
}
