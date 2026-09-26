/**
 * What a published release is, as this deployment records it.
 * @module @deepseek-ai/dsh-team-release/types
 */

/** Who a release is offered to. */
export type ReleaseChannel = 'staged' | 'general'

/** One release an organization published. */
export interface PublishedRelease {
  /** The release version, three dotted numbers. */
  readonly version: string
  /** The signed manifest document, exactly as the publisher produced it. */
  readonly manifest: string
  /** Base64url Ed25519 signature over the manifest's canonical bytes. */
  readonly signature: string
  /** Whether this release is offered to everyone or only to staged members. */
  readonly channel: ReleaseChannel
  readonly publishedAt: number
  /** When an administrator withdrew it; a withdrawn release is offered to nobody. */
  readonly withdrawnAt?: number
}

/** A release being published. */
export interface PublishRelease {
  readonly version: string
  readonly manifest: string
  readonly signature: string
  readonly channel: ReleaseChannel
}

/** The floor below which this deployment's application refuses to run. */
export interface ReleaseFloor {
  readonly version: string
  readonly updatedAt: number
}
