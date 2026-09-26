/**
 * The wire the desktop shell's Runner and the Control Plane's release route
 * share: the path, the header, the version, and the answer. Both sides import
 * from here so neither can drift.
 * @module @deepseek-ai/dsh-team-release-http/protocol
 */

/** The Runner-facing route answering which release this member is offered. */
export const RELEASE_MANIFEST_PATH = '/team/updates/manifest'

/** The header carrying the device access token as `Bearer <token>`. */
export const ACCESS_TOKEN_HEADER = 'authorization'

/** The protocol version this build speaks. */
export const RELEASE_PROTOCOL_VERSION = 1

/** The oldest protocol version this build still accepts. */
export const MINIMUM_RELEASE_PROTOCOL_VERSION = 1

/**
 * What a Runner sends: the version alone. There is no field for an
 * organization, a member, a device, or a version the caller would like — the
 * Control Plane resolves every one of those from the token and its own records.
 */
export interface ManifestBody {
  readonly protocolVersion: number
}

/**
 * What the Control Plane answers when a release is offered: the signed
 * document exactly as it was published, and the floor this deployment
 * currently enforces.
 */
export interface ManifestAnswer {
  /** The release manifest, as the release machine signed it. */
  readonly manifest: unknown
  /** Base64url Ed25519 signature over the manifest's canonical bytes. */
  readonly signature: string
  /** The oldest version this deployment accepts, or null when it accepts every version. */
  readonly minimumVersion: string | null
}
