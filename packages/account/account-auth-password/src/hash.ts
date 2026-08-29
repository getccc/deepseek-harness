/**
 * Password derivation and its self-describing encoded form.
 *
 * The encoded string carries the algorithm and every parameter that produced
 * it, so a stored hash stays verifiable after the deployment raises its cost
 * or a later provider adds another algorithm. Verification dispatches on the
 * recorded algorithm; it never assumes the current one.
 * @module @deepseek-ai/dsh-account-auth-password/hash
 */

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCallback) as (
  secret: string, salt: Buffer, keylen: number, options: ScryptCost,
) => Promise<Buffer>

/** Derived-key length in bytes; 32 matches the algorithm's output block. */
const KEY_BYTES = 32
/** Salt length in bytes. */
const SALT_BYTES = 16

/** The tunable work factors of one derivation. */
export interface ScryptCost {
  /** CPU/memory cost, a power of two. */
  readonly N: number
  /** Block size. */
  readonly r: number
  /** Parallelization. */
  readonly p: number
  /**
   * Upper bound scrypt is allowed to allocate. Node refuses a derivation whose
   * working set exceeds it, so it must track `N` and `r` rather than stay at
   * the 32 MiB default.
   */
  readonly maxmem: number
}

/** The memory bound a cost needs, with the headroom Node's own check wants. */
function memoryFor(cost: Omit<ScryptCost, 'maxmem'>): number {
  return 256 * cost.N * cost.r * 2
}

/**
 * Encode one derivation as `$scrypt$N=..,r=..,p=..$salt$hash`, both payloads
 * base64url. The leading algorithm segment is what lets a future provider add
 * another algorithm without invalidating anything already stored.
 */
function encode(cost: ScryptCost, salt: Buffer, derived: Buffer): string {
  return `$scrypt$N=${String(cost.N)},r=${String(cost.r)},p=${String(cost.p)}`
    + `$${salt.toString('base64url')}$${derived.toString('base64url')}`
}

/** One parsed encoded hash. */
interface Parsed {
  readonly cost: Omit<ScryptCost, 'maxmem'>
  readonly salt: Buffer
  readonly derived: Buffer
}

/**
 * Parse an encoded scrypt hash.
 * @param encoded - the stored string.
 * @returns its parts, or undefined when the string is not a scrypt hash this build understands.
 */
export function parse(encoded: string): Parsed | undefined {
  const match = /^\$scrypt\$N=(\d+),r=(\d+),p=(\d+)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/u.exec(encoded)
  if (match === null) return undefined
  const [, rawN, rawR, rawP, rawSalt, rawDerived] = match
  /* v8 ignore next -- the pattern's five groups are all required, so a match fills every one */
  if (rawN === undefined || rawR === undefined || rawP === undefined
    || rawSalt === undefined || rawDerived === undefined) return undefined
  return {
    cost: { N: Number(rawN), r: Number(rawR), p: Number(rawP) },
    salt: Buffer.from(rawSalt, 'base64url'),
    derived: Buffer.from(rawDerived, 'base64url'),
  }
}

/**
 * Derive and encode a fresh hash for a secret.
 * @param secret - the secret in the clear.
 * @param cost - the work factors to record and apply.
 * @returns the self-describing encoded hash.
 */
export async function hashSecret(secret: string, cost: Omit<ScryptCost, 'maxmem'>): Promise<string> {
  const salt = randomBytes(SALT_BYTES)
  const full = { ...cost, maxmem: memoryFor(cost) }
  return encode(full, salt, await scrypt(secret, salt, KEY_BYTES, full))
}

/**
 * Verify a secret against an encoded hash, using the parameters the hash
 * itself records rather than the deployment's current ones.
 * @param secret - the secret in the clear.
 * @param encoded - the stored hash.
 * @returns whether the secret produced the stored derivation.
 */
export async function verifySecret(secret: string, encoded: string): Promise<boolean> {
  const parsed = parse(encoded)
  if (parsed === undefined) return false
  const derived = await scrypt(secret, parsed.salt, parsed.derived.length, {
    ...parsed.cost,
    maxmem: memoryFor(parsed.cost),
  })
  return derived.length === parsed.derived.length && timingSafeEqual(derived, parsed.derived)
}

/**
 * Whether a stored hash was produced with weaker parameters than the
 * deployment now asks for, and should be replaced after a successful verify.
 * A hash this build cannot parse also needs replacing: it belongs to an
 * algorithm this provider no longer produces.
 * @param encoded - the stored hash.
 * @param cost - the deployment's current work factors.
 * @returns true when the stored hash should be re-derived.
 */
export function needsRehash(encoded: string, cost: Omit<ScryptCost, 'maxmem'>): boolean {
  const parsed = parse(encoded)
  if (parsed === undefined) return true
  return parsed.cost.N < cost.N || parsed.cost.r < cost.r || parsed.cost.p < cost.p
}
