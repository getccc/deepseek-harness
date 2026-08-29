/**
 * The closed word lists device authorization stores in its own columns.
 *
 * They are runtime arrays rather than bare type unions because a store seeds
 * its column constraints from them: the list lives here once, and SQL restates
 * it only by reading this module.
 * @module @deepseek-ai/dsh-device-authorization/vocabulary
 */

/** Every operating system family a Runner may report. */
export const DEVICE_PLATFORMS = ['darwin', 'linux', 'win32'] as const

/**
 * Why a redemption or refresh was refused.
 *
 * The list is exhaustive on purpose: a Runner is the only audience for these
 * words, and it needs to tell "try again" apart from "bind this computer
 * again" without a message a store would have to hold.
 */
export const CREDENTIAL_REFUSALS = [
  /** No such code, token, or family — or one that belongs to nothing this build holds. */
  'unknown',
  /** Presented after its lifetime ended. */
  'expired',
  /** Already spent once; for a refresh token this also revokes the family. */
  'reused',
  /** The device signature did not verify against the stored public key. */
  'signature-mismatch',
  /** The PKCE verifier did not hash to the challenge the transaction carries. */
  'pkce-mismatch',
  /** The callback address or protocol version differs from what was bound. */
  'binding-mismatch',
  /** The device, or the family, has been revoked. */
  'revoked',
] as const
