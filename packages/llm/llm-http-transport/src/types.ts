/**
 * What a transport carries, and what it hands back.
 * @module @deepseek-ai/dsh-llm-http-transport/types
 */

import type { Readable } from 'node:stream'
import type { TRANSPORT_OPERATIONS } from './vocabulary.ts'

/** One provider operation this build knows how to carry. */
export type TransportOperation = typeof TRANSPORT_OPERATIONS[number]

/** One model a transport-controlled catalog exposes to an adapter. */
export interface TransportModel {
  readonly id: string
  readonly name: string
}

/**
 * One request on its way to a provider.
 *
 * There is no URL, host, path, or upstream authorization here, and that is the
 * point: an adapter says which operation and which model, and the transport
 * decides where that goes. A member's own provider and a company one are then
 * the same call with a different transport mounted.
 */
export interface TransportRequest {
  /** Which provider operation, from the code-registered list. */
  readonly operation: TransportOperation
  /** The model, as the adapter names it — a company ref, or a provider's own. */
  readonly modelRef: string
  /** The request body the adapter built. */
  readonly body: Record<string, unknown>
  /** Tokens the adapter counted in the prompt, for a transport that reserves. */
  readonly inputTokens: number
  /** The most output this request should produce, when the adapter bounds it. */
  readonly maxOutputTokens?: number
  /** Opaque correlation for the session; never a local session id. */
  readonly correlationId?: string
  /** Cancels the request, and whatever the transport is doing to carry it. */
  readonly signal?: AbortSignal
}

/**
 * What a provider answered.
 *
 * The body is a stream. A model response is long, and a transport that
 * buffered it would hold a whole completion in memory per request — on a
 * Control Plane, once per member at once.
 */
export interface TransportResponse {
  readonly status: number
  readonly headers: Readonly<Record<string, string>>
  readonly body: Readable
}
