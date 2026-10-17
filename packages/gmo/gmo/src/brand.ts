/**
 * The stable GMO supply-chain references: the one identity a category keeps
 * across renames, the result address beneath it, and the only GMO identifiers
 * that leave the Control Plane.
 *
 * A category reference is `<providerKind>:<sourceCode>:<upstreamId>`; a result
 * reference is `<GmoCategoryRef>/<upstreamResultId>`. The upstream ids inside
 * them are meaningful only to the provider that minted them, so a Runner, a
 * model, and a Session log name a category or a result without holding a GMO
 * address, credential, or route.
 * @module @deepseek-ai/dsh-gmo/brand
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Identifies one governed GMO category (a business line such as GB / GL), stable across upstream renames. */
export type GmoCategoryRef = Branded<'GmoCategoryRef'>

/**
 * Identifies one processing result (or one stage of a result) inside one
 * governed category, stable for as long as the source keeps the result.
 *
 * A brand of its own rather than a longer {@link GmoCategoryRef} because the
 * two are bounded by different things: a category reference has to fit the
 * audit store's `resource_id` token, and a result is never an audit resource.
 * What an operation on a result records is the category it belongs to, which
 * is also what a grant names.
 */
export type GmoResultRef = Branded<'GmoResultRef'>

/**
 * Brand a string as a {@link GmoCategoryRef}.
 *
 * A plain cast: callers holding a value from a wire, a log, or a database use
 * {@link parseGmoCategoryRef} instead, which proves the grammar.
 * @param ref - the raw reference.
 * @returns the same string, branded (a compile-time cast with no runtime cost).
 */
export function GmoCategoryRef(ref: string): GmoCategoryRef {
  return ref as GmoCategoryRef
}

/**
 * Brand a string as a {@link GmoResultRef}.
 *
 * A plain cast: callers holding a value from a wire, a log, or a database use
 * {@link parseGmoResultRef} instead, which proves the grammar.
 * @param ref - the raw reference.
 * @returns the same string, branded (a compile-time cast with no runtime cost).
 */
export function GmoResultRef(ref: string): GmoResultRef {
  return ref as GmoResultRef
}

/**
 * The longest a category reference may be.
 *
 * The audit store bounds `resource_id` with `AUDIT_TOKEN`: at most 64
 * characters over letters, digits, and `. _ : @ -`. A category reference is
 * what a GMO audit row records, so a reference the audit store would refuse is
 * one no operation could record, and length fails where the reference is
 * built rather than at the first denial.
 */
export const GMO_REF_MAX_LENGTH = 64

/**
 * What one segment of a reference may hold: the audit token alphabet without
 * the colon, which separates the segments, and without the slash, which
 * separates a result id from its category.
 */
export const GMO_REF_SEGMENT = /^[A-Za-z0-9._@-]+$/u

/**
 * The longest a deployment's source code may be.
 *
 * The bound private knowledge and BI derived for their own references, kept
 * equal here so one deployment source code serves every catalog. A deployment
 * naming a longer source fails at plugin load rather than minting references
 * its own audit store would reject.
 */
export const GMO_SOURCE_CODE_MAX_LENGTH = 19

/**
 * The longest an upstream result id may be.
 *
 * Not an audit bound, because a result is never the audited resource. It is
 * what keeps a Runner-facing request field bounded, so a reference no
 * operation could resolve is refused where it is read rather than after a
 * call. The widest id the upstream mints is a 32-character hexadecimal
 * identifier plus a stage suffix.
 */
export const GMO_RESULT_ID_MAX_LENGTH = 64

/** The parts a {@link GmoCategoryRef} is assembled from and parsed back into. */
export interface GmoCategoryRefParts {
  /** Which upstream product governs the category, such as `exceltools`. */
  readonly providerKind: string
  /** The deployment-configured code naming one upstream source. */
  readonly sourceCode: string
  /** The upstream service's own category key, meaningful only to its provider. */
  readonly upstreamId: string
}

/** The parts a {@link GmoResultRef} is assembled from and parsed back into. */
export interface GmoResultRefParts {
  /** The category the result is in. */
  readonly ref: GmoCategoryRef
  /** The upstream service's own result identifier. */
  readonly upstreamResultId: string
}

/** Raised when parts cannot form a reference this build would accept. */
export class InvalidGmoRefError extends Error {
  constructor(readonly detail: string) {
    super(`not a usable GMO reference: ${detail}`)
    this.name = 'InvalidGmoRefError'
  }
}

/**
 * One segment proved to sit in the alphabet and under its own length bound.
 * @throws {InvalidGmoRefError} naming the segment and which rule it broke.
 */
function segment(label: string, value: string, maxLength: number): string {
  if (!GMO_REF_SEGMENT.test(value)) {
    throw new InvalidGmoRefError(`${label} ${JSON.stringify(value)} is empty or holds a character outside the audit token alphabet`)
  }
  if (value.length > maxLength) {
    throw new InvalidGmoRefError(`${label} is ${String(value.length)} characters, over the maximum of ${String(maxLength)}`)
  }
  return value
}

/**
 * Whether a format call accepts its parts.
 *
 * For the parsers, which answer "is it usable" rather than "why not"; a
 * caller that needs the reason calls the format function itself.
 */
function accepted(format: () => string): boolean {
  try {
    format()
  } catch {
    // The only throw is InvalidGmoRefError, and its detail is the reason the
    // parser deliberately does not report.
    return false
  }
  return true
}

/**
 * Assemble a category reference from its parts.
 * @param parts - the provider kind, source code, and upstream id.
 * @returns the branded reference.
 * @throws {InvalidGmoRefError} when a segment is empty, holds a character outside
 * {@link GMO_REF_SEGMENT}, the source code exceeds {@link GMO_SOURCE_CODE_MAX_LENGTH},
 * or the assembled reference exceeds {@link GMO_REF_MAX_LENGTH}.
 */
export function formatGmoCategoryRef(parts: GmoCategoryRefParts): GmoCategoryRef {
  const ref = [
    segment('provider kind', parts.providerKind, GMO_REF_MAX_LENGTH),
    segment('source code', parts.sourceCode, GMO_SOURCE_CODE_MAX_LENGTH),
    segment('upstream id', parts.upstreamId, GMO_REF_MAX_LENGTH),
  ].join(':')
  if (ref.length > GMO_REF_MAX_LENGTH) {
    throw new InvalidGmoRefError(`reference is ${String(ref.length)} characters, over the audit token maximum of ${String(GMO_REF_MAX_LENGTH)}`)
  }
  return GmoCategoryRef(ref)
}

/**
 * Read a category reference back into its parts.
 * @param value - the candidate reference, from a wire, a log, or a database.
 * @returns the parts, or undefined when the value is not a reference this build accepts.
 */
export function parseGmoCategoryRef(value: string): GmoCategoryRefParts | undefined {
  const segments = value.split(':')
  if (segments.length !== 3) return undefined
  const [providerKind, sourceCode, upstreamId] = segments as [string, string, string]
  const parts: GmoCategoryRefParts = { providerKind, sourceCode, upstreamId }
  return accepted(() => formatGmoCategoryRef(parts)) ? parts : undefined
}

/**
 * Whether a string is a category reference this build accepts.
 * @param value - the candidate reference.
 * @returns true when {@link parseGmoCategoryRef} reads it, narrowing the argument.
 */
export function isGmoCategoryRef(value: string): value is GmoCategoryRef {
  return parseGmoCategoryRef(value) !== undefined
}

/**
 * Assemble a result reference from its parts.
 * @param parts - the category reference and the upstream result id.
 * @returns the branded reference.
 * @throws {InvalidGmoRefError} when the category reference is not one, or the
 * result id is empty, holds a character outside {@link GMO_REF_SEGMENT}, or
 * exceeds {@link GMO_RESULT_ID_MAX_LENGTH}.
 */
export function formatGmoResultRef(parts: GmoResultRefParts): GmoResultRef {
  if (!isGmoCategoryRef(parts.ref)) {
    throw new InvalidGmoRefError(`category reference ${JSON.stringify(parts.ref)} is not one`)
  }
  return GmoResultRef(`${parts.ref}/${segment('result id', parts.upstreamResultId, GMO_RESULT_ID_MAX_LENGTH)}`)
}

/**
 * Read a result reference back into its parts.
 * @param value - the candidate reference, from a wire, a log, or a database.
 * @returns the parts, or undefined when the value is not a reference this build accepts.
 */
export function parseGmoResultRef(value: string): GmoResultRefParts | undefined {
  const separator = value.indexOf('/')
  if (separator < 0) return undefined
  const parts: GmoResultRefParts = {
    ref: GmoCategoryRef(value.slice(0, separator)),
    upstreamResultId: value.slice(separator + 1),
  }
  return accepted(() => formatGmoResultRef(parts)) ? parts : undefined
}

/**
 * Whether a string is a result reference this build accepts.
 * @param value - the candidate reference.
 * @returns true when {@link parseGmoResultRef} reads it, narrowing the argument.
 */
export function isGmoResultRef(value: string): value is GmoResultRef {
  return parseGmoResultRef(value) !== undefined
}

/**
 * The category inside a result reference already proved to be one.
 *
 * Total rather than optional: the brand is the proof, so a caller holding a
 * `GmoResultRef` has been through {@link parseGmoResultRef} or
 * {@link formatGmoResultRef}, and a second "or undefined" would be a branch no
 * caller could reach and every caller would have to handle.
 * @param resultRef - the result reference.
 * @returns the category reference it sits under.
 */
export function categoryRefOf(resultRef: GmoResultRef): GmoCategoryRef {
  return GmoCategoryRef(resultRef.slice(0, resultRef.indexOf('/')))
}

/**
 * The upstream result id inside a result reference already proved to be one.
 * @param resultRef - the result reference.
 * @returns the upstream result id it carries.
 */
export function upstreamResultIdOf(resultRef: GmoResultRef): string {
  return resultRef.slice(resultRef.indexOf('/') + 1)
}
