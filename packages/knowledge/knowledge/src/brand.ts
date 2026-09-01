/**
 * The stable knowledge reference: the one identity a knowledge base keeps
 * across renames, and the only knowledge identifier that leaves the Control
 * Plane.
 *
 * A reference is `<providerKind>:<sourceCode>:<upstreamId>`. The upstream id
 * stays in the Control Plane catalog, so a Runner, a model, and a Session log
 * name a knowledge base without holding anything that could address the
 * upstream service directly.
 * @module @deepseek-ai/dsh-knowledge/brand
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Identifies one governed knowledge base, stable across upstream renames. */
export type KnowledgeRef = Branded<'KnowledgeRef'>

/**
 * Brand a string as a {@link KnowledgeRef}.
 *
 * A plain cast: callers that hold a value parsed from a wire, a log, or a
 * database use {@link parseKnowledgeRef} instead, which proves the grammar.
 * @param ref - the raw reference.
 * @returns the same string, branded (a compile-time cast — no runtime cost).
 */
export function KnowledgeRef(ref: string): KnowledgeRef {
  return ref as KnowledgeRef
}

/**
 * The longest a reference may be.
 *
 * This is not a taste: the audit store bounds `resource_id` with `AUDIT_TOKEN`
 * — at most 64 characters over letters, digits, and `. _ : @ -` — and a
 * reference the audit store would refuse is a reference no operation could
 * record. Length therefore fails where the reference is built, not at the
 * first denial.
 */
export const KNOWLEDGE_REF_MAX_LENGTH = 64

/**
 * What one segment of a reference may hold: the audit token alphabet without
 * the colon, which separates the segments.
 */
export const KNOWLEDGE_REF_SEGMENT = /^[A-Za-z0-9._@-]+$/u

/**
 * The longest a deployment's source code may be.
 *
 * Derived from the worst case this build produces: `weknora` plus two colons
 * plus a 36-character UUID leaves 19 characters inside
 * {@link KNOWLEDGE_REF_MAX_LENGTH}. A deployment that names a longer source
 * fails at plugin load rather than minting references its own audit store
 * would reject.
 */
export const KNOWLEDGE_SOURCE_CODE_MAX_LENGTH = 19

/** The parts a {@link KnowledgeRef} is assembled from and parsed back into. */
export interface KnowledgeRefParts {
  /** Which upstream product governs the knowledge base, such as `weknora`. */
  readonly providerKind: string
  /** The deployment-configured code naming one upstream source. */
  readonly sourceCode: string
  /** The upstream service's own identifier, meaningful only to its provider. */
  readonly upstreamId: string
}

/** Raised when parts cannot form a reference this build would accept. */
export class InvalidKnowledgeRefError extends Error {
  constructor(readonly detail: string) {
    super(`not a usable knowledge reference: ${detail}`)
    this.name = 'InvalidKnowledgeRefError'
  }
}

/**
 * Assemble a reference from its parts.
 * @param parts - the provider kind, source code, and upstream id.
 * @returns the branded reference.
 * @throws {InvalidKnowledgeRefError} when a segment is empty, holds a character outside
 * {@link KNOWLEDGE_REF_SEGMENT}, or the assembled reference exceeds
 * {@link KNOWLEDGE_REF_MAX_LENGTH}.
 */
export function formatKnowledgeRef(parts: KnowledgeRefParts): KnowledgeRef {
  const segments: readonly [string, string][] = [
    ['provider kind', parts.providerKind],
    ['source code', parts.sourceCode],
    ['upstream id', parts.upstreamId],
  ]
  for (const [label, value] of segments) {
    if (!KNOWLEDGE_REF_SEGMENT.test(value)) {
      throw new InvalidKnowledgeRefError(`${label} ${JSON.stringify(value)} is empty or holds a character outside the audit token alphabet`)
    }
  }
  if (parts.sourceCode.length > KNOWLEDGE_SOURCE_CODE_MAX_LENGTH) {
    throw new InvalidKnowledgeRefError(`source code ${JSON.stringify(parts.sourceCode)} is longer than ${String(KNOWLEDGE_SOURCE_CODE_MAX_LENGTH)} characters`)
  }
  const ref = `${parts.providerKind}:${parts.sourceCode}:${parts.upstreamId}`
  if (ref.length > KNOWLEDGE_REF_MAX_LENGTH) {
    throw new InvalidKnowledgeRefError(`reference is ${String(ref.length)} characters, over the audit token maximum of ${String(KNOWLEDGE_REF_MAX_LENGTH)}`)
  }
  return KnowledgeRef(ref)
}

/**
 * Read a reference back into its parts.
 * @param value - the candidate reference, from a wire, a log, or a database.
 * @returns the parts, or undefined when the value is not a reference this build accepts.
 */
export function parseKnowledgeRef(value: string): KnowledgeRefParts | undefined {
  const segments = value.split(':')
  if (segments.length !== 3) return undefined
  const [providerKind, sourceCode, upstreamId] = segments as [string, string, string]
  try {
    formatKnowledgeRef({ providerKind, sourceCode, upstreamId })
  } catch {
    // The only throw here is InvalidKnowledgeRefError, and this function
    // answers "is it usable" rather than "why not"; a caller that needs the
    // reason calls formatKnowledgeRef itself.
    return undefined
  }
  return { providerKind, sourceCode, upstreamId }
}

/**
 * Whether a string is a reference this build accepts.
 * @param value - the candidate reference.
 * @returns true when {@link parseKnowledgeRef} reads it, narrowing the argument.
 */
export function isKnowledgeRef(value: string): value is KnowledgeRef {
  return parseKnowledgeRef(value) !== undefined
}
