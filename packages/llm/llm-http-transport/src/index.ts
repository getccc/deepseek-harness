/**
 * The provider HTTP transport seam: how a model request reaches a provider,
 * separated from what the request says.
 *
 * An LLM adapter keeps everything it already owns — serializing the request,
 * parsing the stream, image and file semantics. What a transport replaces is
 * only the trip: a member's own key going straight to the provider, or a
 * company model going through the Control Plane with a credential the Runner
 * never holds.
 * @module @deepseek-ai/dsh-llm-http-transport
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import type { TransportRequest, TransportResponse } from './types.ts'

export { TRANSPORT_OPERATIONS } from './vocabulary.ts'
export type {
  TransportOperation,
  TransportRequest,
  TransportResponse,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    llmHttpTransport: LlmHttpTransport
  }
}

/**
 * Raised when a transport could not carry a request at all.
 *
 * The reason is a word rather than a message because a caller has to decide
 * whether to retry, and a sentence is not a decision. A provider that answered
 * with an error status is not this: that is a response, and it is returned.
 */
export class TransportFailedError extends Error {
  constructor(
    readonly reason: 'refused' | 'unreachable' | 'not-bound',
    readonly detail?: string,
  ) {
    super(`transport failed: ${reason}${detail === undefined ? '' : ` (${detail})`}`)
    this.name = 'TransportFailedError'
  }
}

/**
 * How a model request reaches a provider. A provider mounts this service;
 * LLM adapters inject `llmHttpTransport`.
 *
 * A request names an operation the code registers and a model, never a URL. A
 * direct transport resolves both from the member's own configuration; a team
 * transport sends them to the Control Plane, which resolves them from the
 * company catalog. Neither lets a caller decide where bytes go.
 */
export abstract class LlmHttpTransport extends Service {
  constructor(ctx: Context) {
    super(ctx, 'llmHttpTransport')
  }

  /**
   * Carry one request to a provider and hand back its response.
   * @param request - the operation, the model, and the body an adapter built.
   * @returns the provider's status, headers, and body stream.
   * @throws {TransportFailedError} when the request could not be carried at all.
   */
  abstract send(request: TransportRequest): Promise<TransportResponse>
}
