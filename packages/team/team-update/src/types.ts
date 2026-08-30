/**
 * What an update decision reads and what it answers.
 * @module @deepseek-ai/dsh-team-update/types
 */

import type { UpdateArchitecture, UpdateArtifact, UpdatePlatform } from './manifest.ts'
import type { UPDATE_REFUSALS } from './index.ts'

/** Why an offered release was refused. */
export type UpdateRefusal = typeof UPDATE_REFUSALS[number]

/** What this computer is, and which release key it trusts. */
export interface UpdateTarget {
  /** Base64url DER SPKI encoding of the Ed25519 release public key. */
  readonly releaseKey: string
  /** The version running here now. */
  readonly installedVersion: string
  readonly platform: UpdatePlatform
  readonly architecture: UpdateArchitecture
}

/** The artifact to install, or the reason no install happens. */
export type UpdateDecision =
  | { readonly install: UpdateArtifact }
  | { readonly refused: UpdateRefusal }
