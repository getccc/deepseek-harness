/**
 * The stable BI references: the one identity a project keeps across renames,
 * the chart address beneath it, and the only BI identifiers that leave the
 * Control Plane.
 *
 * A project reference is `<providerKind>:<sourceCode>:<upstreamId>`; a chart
 * reference is `<BiProjectRef>/<upstreamChartId>`. The upstream ids inside
 * them are meaningful only to the provider that minted them, so a Runner, a
 * model, and a Session log name a project or a chart without holding a BI
 * address, credential, or route.
 * @module @deepseek-ai/dsh-bi/brand
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Identifies one governed BI project, stable across upstream renames. */
export type BiProjectRef = Branded<'BiProjectRef'>

/**
 * Identifies one saved chart inside one governed project, stable for as long
 * as the source keeps the chart.
 *
 * A brand of its own rather than a longer {@link BiProjectRef} because the two
 * are bounded by different things: a project reference has to fit the audit
 * store's `resource_id` token, and a chart is never an audit resource. What an
 * operation on a chart records is the project it belongs to, which is also
 * what a grant names.
 */
export type BiChartRef = Branded<'BiChartRef'>

/**
 * Brand a string as a {@link BiProjectRef}.
 *
 * A plain cast: callers holding a value from a wire, a log, or a database use
 * {@link parseBiProjectRef} instead, which proves the grammar.
 * @param ref - the raw reference.
 * @returns the same string, branded (a compile-time cast with no runtime cost).
 */
export function BiProjectRef(ref: string): BiProjectRef {
  return ref as BiProjectRef
}

/**
 * Brand a string as a {@link BiChartRef}.
 *
 * A plain cast: callers holding a value from a wire, a log, or a database use
 * {@link parseBiChartRef} instead, which proves the grammar.
 * @param ref - the raw reference.
 * @returns the same string, branded (a compile-time cast with no runtime cost).
 */
export function BiChartRef(ref: string): BiChartRef {
  return ref as BiChartRef
}

/**
 * The longest a project reference may be.
 *
 * The audit store bounds `resource_id` with `AUDIT_TOKEN`: at most 64
 * characters over letters, digits, and `. _ : @ -`. A project reference is
 * what a BI audit row records, so a reference the audit store would refuse is
 * one no operation could record, and length fails where the reference is
 * built rather than at the first denial.
 */
export const BI_REF_MAX_LENGTH = 64

/**
 * What one segment of a reference may hold: the audit token alphabet without
 * the colon, which separates the segments, and without the slash, which
 * separates a chart id from its project.
 */
export const BI_REF_SEGMENT = /^[A-Za-z0-9._@-]+$/u

/**
 * The longest a deployment's source code may be.
 *
 * The bound private knowledge derived for its own references, kept equal here
 * so one deployment source code serves both catalogs: `webi`, two colons, and
 * a 36-character UUID leave more room inside {@link BI_REF_MAX_LENGTH} than
 * knowledge's provider kind does, and a code that fits the tighter rule fits
 * this one. A deployment naming a longer source fails at plugin load rather
 * than minting references its own audit store would reject.
 */
export const BI_SOURCE_CODE_MAX_LENGTH = 19

/**
 * The longest an upstream chart id may be.
 *
 * Not an audit bound, because a chart is never the audited resource. It is
 * what keeps a Runner-facing request field bounded, so a reference no
 * operation could resolve is refused where it is read rather than after a
 * call. The widest id this build has seen is a 36-character UUID.
 */
export const BI_CHART_ID_MAX_LENGTH = 64

/** The parts a {@link BiProjectRef} is assembled from and parsed back into. */
export interface BiProjectRefParts {
  /** Which upstream product governs the project, such as `webi`. */
  readonly providerKind: string
  /** The deployment-configured code naming one upstream source. */
  readonly sourceCode: string
  /** The upstream service's own project identifier, meaningful only to its provider. */
  readonly upstreamId: string
}

/** The parts a {@link BiChartRef} is assembled from and parsed back into. */
export interface BiChartRefParts {
  /** The project the chart is in. */
  readonly ref: BiProjectRef
  /** The upstream service's own chart identifier. */
  readonly upstreamChartId: string
}

/** Raised when parts cannot form a reference this build would accept. */
export class InvalidBiRefError extends Error {
  constructor(readonly detail: string) {
    super(`not a usable BI reference: ${detail}`)
    this.name = 'InvalidBiRefError'
  }
}

/**
 * One segment proved to sit in the alphabet and under its own length bound.
 * @throws {InvalidBiRefError} naming the segment and which rule it broke.
 */
function segment(label: string, value: string, maxLength: number): string {
  if (!BI_REF_SEGMENT.test(value)) {
    throw new InvalidBiRefError(`${label} ${JSON.stringify(value)} is empty or holds a character outside the audit token alphabet`)
  }
  if (value.length > maxLength) {
    throw new InvalidBiRefError(`${label} is ${String(value.length)} characters, over the maximum of ${String(maxLength)}`)
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
    // The only throw is InvalidBiRefError, and its detail is the reason the
    // parser deliberately does not report.
    return false
  }
  return true
}

/**
 * Assemble a project reference from its parts.
 * @param parts - the provider kind, source code, and upstream id.
 * @returns the branded reference.
 * @throws {InvalidBiRefError} when a segment is empty, holds a character outside
 * {@link BI_REF_SEGMENT}, the source code exceeds {@link BI_SOURCE_CODE_MAX_LENGTH},
 * or the assembled reference exceeds {@link BI_REF_MAX_LENGTH}.
 */
export function formatBiProjectRef(parts: BiProjectRefParts): BiProjectRef {
  const ref = [
    segment('provider kind', parts.providerKind, BI_REF_MAX_LENGTH),
    segment('source code', parts.sourceCode, BI_SOURCE_CODE_MAX_LENGTH),
    segment('upstream id', parts.upstreamId, BI_REF_MAX_LENGTH),
  ].join(':')
  if (ref.length > BI_REF_MAX_LENGTH) {
    throw new InvalidBiRefError(`reference is ${String(ref.length)} characters, over the audit token maximum of ${String(BI_REF_MAX_LENGTH)}`)
  }
  return BiProjectRef(ref)
}

/**
 * Read a project reference back into its parts.
 * @param value - the candidate reference, from a wire, a log, or a database.
 * @returns the parts, or undefined when the value is not a reference this build accepts.
 */
export function parseBiProjectRef(value: string): BiProjectRefParts | undefined {
  const segments = value.split(':')
  if (segments.length !== 3) return undefined
  const [providerKind, sourceCode, upstreamId] = segments as [string, string, string]
  const parts: BiProjectRefParts = { providerKind, sourceCode, upstreamId }
  return accepted(() => formatBiProjectRef(parts)) ? parts : undefined
}

/**
 * Whether a string is a project reference this build accepts.
 * @param value - the candidate reference.
 * @returns true when {@link parseBiProjectRef} reads it, narrowing the argument.
 */
export function isBiProjectRef(value: string): value is BiProjectRef {
  return parseBiProjectRef(value) !== undefined
}

/**
 * Assemble a chart reference from its parts.
 * @param parts - the project reference and the upstream chart id.
 * @returns the branded reference.
 * @throws {InvalidBiRefError} when the project reference is not one, or the chart
 * id is empty, holds a character outside {@link BI_REF_SEGMENT}, or exceeds
 * {@link BI_CHART_ID_MAX_LENGTH}.
 */
export function formatBiChartRef(parts: BiChartRefParts): BiChartRef {
  if (!isBiProjectRef(parts.ref)) {
    throw new InvalidBiRefError(`project reference ${JSON.stringify(parts.ref)} is not one`)
  }
  return BiChartRef(`${parts.ref}/${segment('chart id', parts.upstreamChartId, BI_CHART_ID_MAX_LENGTH)}`)
}

/**
 * Read a chart reference back into its parts.
 * @param value - the candidate reference, from a wire, a log, or a database.
 * @returns the parts, or undefined when the value is not a reference this build accepts.
 */
export function parseBiChartRef(value: string): BiChartRefParts | undefined {
  const separator = value.indexOf('/')
  if (separator < 0) return undefined
  const parts: BiChartRefParts = {
    ref: BiProjectRef(value.slice(0, separator)),
    upstreamChartId: value.slice(separator + 1),
  }
  return accepted(() => formatBiChartRef(parts)) ? parts : undefined
}

/**
 * Whether a string is a chart reference this build accepts.
 * @param value - the candidate reference.
 * @returns true when {@link parseBiChartRef} reads it, narrowing the argument.
 */
export function isBiChartRef(value: string): value is BiChartRef {
  return parseBiChartRef(value) !== undefined
}

/**
 * The project inside a chart reference already proved to be one.
 *
 * Total rather than optional: the brand is the proof, so a caller holding a
 * `BiChartRef` has been through {@link parseBiChartRef} or
 * {@link formatBiChartRef}, and a second "or undefined" would be a branch no
 * caller could reach and every caller would have to handle.
 * @param chartRef - the chart reference.
 * @returns the project reference it sits under.
 */
export function projectRefOf(chartRef: BiChartRef): BiProjectRef {
  return BiProjectRef(chartRef.slice(0, chartRef.indexOf('/')))
}

/**
 * The upstream chart id inside a chart reference already proved to be one.
 * @param chartRef - the chart reference.
 * @returns the upstream chart id it carries.
 */
export function upstreamChartIdOf(chartRef: BiChartRef): string {
  return chartRef.slice(chartRef.indexOf('/') + 1)
}
