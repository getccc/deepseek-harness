/**
 * The values both sides of the binding flow must compute identically.
 *
 * A Runner and the Control Plane never share code at runtime, so every value
 * either of them derives — the PKCE challenge, the public-key digest a person
 * compares, the bytes a device signs, the hash a secret is stored under — is
 * defined once here and imported by both.
 * @module @deepseek-ai/dsh-device-authorization/crypto
 */

import { createHash, randomBytes, verify } from 'node:crypto'

/**
 * Pairing-code alphabet: no vowels, so a code cannot spell a word a person
 * would read past; no `0`, `O`, `1`, `I`, or `L`, so no pair of characters
 * looks alike on a screen the member is comparing against another screen.
 */
const PAIRING_ALPHABET = 'BCDFGHJKMNPQRSTVWXZ23456789'

/** Characters per pairing-code group; two groups are shown as `XXXX-XXXX`. */
const PAIRING_GROUP = 4

/** Bytes of entropy behind every secret this flow mints. */
const SECRET_BYTES = 32

/**
 * Mint one opaque secret: an authorization code or a refresh token.
 * @returns 32 random bytes, base64url-encoded.
 */
export function newSecret(): string {
  return randomBytes(SECRET_BYTES).toString('base64url')
}

/**
 * Mint the code a person compares between two screens.
 *
 * It is short because a person reads it aloud or compares it by eye, and it
 * does not have to resist guessing on its own: confirming still requires an
 * authenticated Control Plane session, and the transaction it names expires in
 * minutes.
 * @returns eight alphabet characters as `XXXX-XXXX`.
 */
export function newPairingCode(): string {
  const bytes = randomBytes(PAIRING_GROUP * 2)
  const chars = [...bytes].map(byte => PAIRING_ALPHABET[byte % PAIRING_ALPHABET.length] as string)
  return `${chars.slice(0, PAIRING_GROUP).join('')}-${chars.slice(PAIRING_GROUP).join('')}`
}

/**
 * Hash a secret for storage. A store keeps only this, so reading the database
 * does not yield a usable code or token.
 * @param secret - the plaintext secret.
 * @returns the base64url SHA-256 digest.
 */
export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('base64url')
}

/**
 * The PKCE challenge for a verifier, as RFC 7636 `S256`.
 * @param verifier - the Runner's own random verifier, which never leaves it until redemption.
 * @returns the base64url SHA-256 digest to send when starting a transaction.
 */
export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

/**
 * The digest of a device public key, which a person compares between the local
 * pairing page and the Control Plane confirmation page.
 * @param publicKey - the base64url DER SPKI encoding of the Ed25519 public key.
 * @returns the base64url SHA-256 digest.
 */
export function digestPublicKey(publicKey: string): string {
  return createHash('sha256').update(publicKey).digest('base64url')
}

/**
 * The bytes a device signs to redeem an authorization code.
 *
 * Both the transaction and the code are named, so a signature captured from one
 * redemption proves nothing about another.
 * @param transactionId - the transaction the code belongs to.
 * @param code - the plaintext authorization code.
 * @returns the string to sign, and to verify against.
 */
export function redeemSigningInput(transactionId: string, code: string): string {
  return `dsh-device-redeem:${transactionId}:${hashSecret(code)}`
}

/**
 * The bytes a device signs to exchange a refresh token.
 * @param familyId - the credential family the refresh token belongs to.
 * @param refreshToken - the plaintext refresh token being presented.
 * @returns the string to sign, and to verify against.
 */
export function refreshSigningInput(familyId: string, refreshToken: string): string {
  return `dsh-device-refresh:${familyId}:${hashSecret(refreshToken)}`
}

/**
 * Whether a signature over `input` was made by the private key matching
 * `publicKey`.
 * @param publicKey - the base64url DER SPKI encoding of the Ed25519 public key.
 * @param input - the string the device was asked to sign.
 * @param signature - the base64url signature the device returned.
 * @returns true when the signature verifies; false for any malformed key or signature.
 */
export function verifyDeviceSignature(publicKey: string, input: string, signature: string): boolean {
  try {
    return verify(null, Buffer.from(input), {
      key: Buffer.from(publicKey, 'base64url'),
      format: 'der',
      type: 'spki',
    }, Buffer.from(signature, 'base64url'))
  } catch {
    // A malformed key or signature is a refusal, not a crash: both arrive from
    // a Runner this Control Plane has not yet decided to trust.
    return false
  }
}
