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

/**
 * Identifies one document inside one governed knowledge base, stable for as
 * long as the source keeps the document.
 *
 * A reference is `<KnowledgeRef>/<upstreamDocumentId>`. It is a brand of its
 * own rather than a longer {@link KnowledgeRef} because the two are bounded by
 * different things: a knowledge reference has to fit the audit store's
 * `resource_id` token, and a document is never an audit resource — what an
 * operation on a document records is the knowledge base it belongs to, which
 * is also what a grant names.
 */
export type KnowledgeDocRef = Branded<'KnowledgeDocRef'>

/**
 * Brand a string as a {@link KnowledgeDocRef}.
 *
 * A plain cast: callers holding a value from a wire, a log, or a database use
 * {@link parseKnowledgeDocRef} instead, which proves the grammar.
 * @param ref - the raw reference.
 * @returns the same string, branded (a compile-time cast — no runtime cost).
 */
export function KnowledgeDocRef(ref: string): KnowledgeDocRef {
  return ref as KnowledgeDocRef
}

/**
 * The longest an upstream document id may be.
 *
 * Not a taste and not an audit bound: it is what keeps a Runner-facing request
 * field bounded, so a reference no operation could resolve is refused where it
 * is read rather than after a call. The widest id this build has seen is a
 * 36-character UUID.
 */
export const KNOWLEDGE_DOC_ID_MAX_LENGTH = 64

/** The parts a {@link KnowledgeDocRef} is assembled from and parsed back into. */
export interface KnowledgeDocRefParts {
  /** The knowledge base the document is in. */
  readonly ref: KnowledgeRef
  /** The upstream service's own document identifier. */
  readonly upstreamDocId: string
}

/**
 * Assemble a document reference from its parts.
 * @param parts - the knowledge base reference and the upstream document id.
 * @returns the branded reference.
 * @throws {InvalidKnowledgeRefError} when the knowledge reference is not one, or the
 * document id is empty, holds a character outside {@link KNOWLEDGE_REF_SEGMENT},
 * or exceeds {@link KNOWLEDGE_DOC_ID_MAX_LENGTH}.
 */
export function formatKnowledgeDocRef(parts: KnowledgeDocRefParts): KnowledgeDocRef {
  if (!isKnowledgeRef(parts.ref)) {
    throw new InvalidKnowledgeRefError(`knowledge reference ${JSON.stringify(parts.ref)} is not one`)
  }
  if (!KNOWLEDGE_REF_SEGMENT.test(parts.upstreamDocId)) {
    throw new InvalidKnowledgeRefError(`document id ${JSON.stringify(parts.upstreamDocId)} is empty or holds a character outside the reference alphabet`)
  }
  if (parts.upstreamDocId.length > KNOWLEDGE_DOC_ID_MAX_LENGTH) {
    throw new InvalidKnowledgeRefError(`document id is ${String(parts.upstreamDocId.length)} characters, over the maximum of ${String(KNOWLEDGE_DOC_ID_MAX_LENGTH)}`)
  }
  return KnowledgeDocRef(`${parts.ref}/${parts.upstreamDocId}`)
}

/**
 * Read a document reference back into its parts.
 * @param value - the candidate reference, from a wire, a log, or a database.
 * @returns the parts, or undefined when the value is not a reference this build accepts.
 */
export function parseKnowledgeDocRef(value: string): KnowledgeDocRefParts | undefined {
  const separator = value.indexOf('/')
  if (separator < 0) return undefined
  const ref = KnowledgeRef(value.slice(0, separator))
  const upstreamDocId = value.slice(separator + 1)
  try {
    formatKnowledgeDocRef({ ref, upstreamDocId })
  } catch {
    // The only throw here is InvalidKnowledgeRefError, and this function
    // answers "is it usable" rather than "why not".
    return undefined
  }
  return { ref, upstreamDocId }
}

/**
 * The upstream document id inside a reference already proved to be one.
 *
 * Total rather than optional: the brand is the proof, so a caller holding a
 * `KnowledgeDocRef` has already been through {@link parseKnowledgeDocRef} or
 * {@link formatKnowledgeDocRef}, and a second "or undefined" here would be a
 * branch no caller could reach and every caller would have to handle.
 * @param docRef - the document reference.
 * @returns the upstream document id it carries.
 */
export function upstreamDocIdOf(docRef: KnowledgeDocRef): string {
  return docRef.slice(docRef.indexOf('/') + 1)
}

/**
 * Whether a string is a document reference this build accepts.
 * @param value - the candidate reference.
 * @returns true when {@link parseKnowledgeDocRef} reads it, narrowing the argument.
 */
export function isKnowledgeDocRef(value: string): value is KnowledgeDocRef {
  return parseKnowledgeDocRef(value) !== undefined
}
