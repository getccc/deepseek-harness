/**
 * The Runner-facing model endpoint: its path, and the facts a Runner sends.
 *
 * A Runner and the Control Plane ship as separate installations, so the wire
 * facts live in one module that both import rather than in two hand-matched
 * copies.
 * @module @deepseek-ai/dsh-model-gateway-http/protocol
 */

import type { ModelInputModality } from '@deepseek-ai/dsh-llm-http-transport'

/** Path the Control Plane serves company model invocations under. */
export const MODEL_INVOKE_PATH = '/team/model/invoke'

/** Path the Control Plane serves the current device principal's visible models under. */
export const MODEL_CATALOG_PATH = '/team/model/catalog'

/** Header carrying the Runner's device access token. */
export const ACCESS_TOKEN_HEADER = 'authorization'

/**
 * What a Runner sends to invoke a company model.
 *
 * There is no endpoint, host, path, or upstream authorization here. A Runner
 * names an operation and a model; the Control Plane resolves the rest from the
 * catalog, which is what keeps a company credential out of a request a Runner
 * could point somewhere.
 */
export interface InvokeBody {
  /** A code-registered provider operation. */
  readonly operation: string
  /** The company model ref, as the catalog holds it. */
  readonly modelRef: string
  /** The budget period this request belongs to. */
  readonly period: string
  /** Tokens the adapter counted in the prompt. */
  readonly inputTokens: number
  /** The most output the adapter wants; the catalog's ceiling still applies. */
  readonly maxOutputTokens?: number
  /** Opaque correlation for the session; never a local session id. */
  readonly correlationId?: string
  /** The request body the adapter built, minus where it goes. */
  readonly body: Record<string, unknown>
}

/**
 * One model the Control Plane permits this device principal to discover.
 *
 * `inputModalities` is the catalog's declaration; a Runner refuses an image
 * for a model whose list lacks `image` rather than sending it to find out.
 */
export interface DiscoveredModel {
  readonly modelRef: string
  readonly displayName: string
  readonly inputModalities: readonly ModelInputModality[]
}

/** Runner-facing model discovery response. */
export interface ModelCatalogBody {
  readonly models: readonly DiscoveredModel[]
}
