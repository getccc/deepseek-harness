/**
 * The team transport: a company model request going out through the Control
 * Plane.
 *
 * What this sends is an operation, a model ref, and the body an adapter built.
 * What it does not send — and could not, because the request has no place for
 * it — is an address or an upstream credential. The company key stays where a
 * plugin sharing this process cannot reach it.
 * @module @deepseek-ai/dsh-llm-http-transport-team
 */

import { Readable } from 'node:stream'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  LlmHttpTransport,
  TransportFailedError,
  type TransportRequest,
  type TransportResponse,
} from '@deepseek-ai/dsh-llm-http-transport'
import { ACCESS_TOKEN_HEADER, MODEL_INVOKE_PATH } from '@deepseek-ai/dsh-model-gateway-http'
import type {} from '@deepseek-ai/dsh-team-account-client'

/** Plugin config: which Control Plane, and which budget period. */
export interface Config {
  /** Origin of the company Control Plane, such as `https://dsh.company.com`. */
  controlPlaneUrl: string
}

/**
 * How a company model request reaches its provider.
 *
 * The access token is read per call rather than held, because the account
 * client refreshes it and a cached one would be the stale copy. That is the
 * same reason the credential itself never comes here at all.
 */
export class TeamLlmHttpTransport extends LlmHttpTransport {
  static inject = ['teamAccountClient']

  static Config: z<Config> = z.object({
    controlPlaneUrl: z.string().required(),
  })

  constructor(ctx: Context, public config: Config) {
    super(ctx)
  }

  async send(request: TransportRequest): Promise<TransportResponse> {
    const token = await this.accessToken()
    let response: Response
    try {
      response = await fetch(new URL(MODEL_INVOKE_PATH, this.config.controlPlaneUrl), {
        method: 'POST',
        headers: {
          [ACCESS_TOKEN_HEADER]: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          operation: request.operation,
          modelRef: request.modelRef,
          period: currentPeriod(),
          inputTokens: request.inputTokens,
          ...(request.maxOutputTokens === undefined ? {} : { maxOutputTokens: request.maxOutputTokens }),
          ...(request.correlationId === undefined ? {} : { correlationId: request.correlationId }),
          body: request.body,
        }),
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      })
    } catch (error) {
      throw new TransportFailedError('unreachable', detailOf(error))
    }
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      // Streamed through, not buffered: an adapter parses a completion as it
      // arrives, and holding one here would undo that.
      body: response.body === null
        ? Readable.from([])
        : Readable.fromWeb(response.body as never),
    }
  }

  /** The Runner's current access token, or the reason there is none. */
  private async accessToken(): Promise<string> {
    try {
      return await this.ctx.teamAccountClient.accessToken()
    } catch (error) {
      // Not bound and refused are different things to a member: one is "connect
      // this computer", the other is "ask an administrator".
      /* v8 ignore next -- the account client rejects with Error; the guard is for the type */
      const name = error instanceof Error ? error.name : ''
      if (name === 'NotBoundError') throw new TransportFailedError('not-bound')
      throw new TransportFailedError('refused', detailOf(error))
    }
  }
}

/**
 * What a failure says about itself, when it says anything.
 *
 * The account client and `fetch` both reject with Errors, so the guard is for
 * the `unknown` a catch binds rather than for a path either of them takes.
 */
function detailOf(error: unknown): string | undefined {
  /* v8 ignore next -- both callers reject with Error; the guard is for the type */
  return error instanceof Error ? error.message : undefined
}

/**
 * The budget period a request belongs to, as `YYYY-MM` in UTC.
 *
 * UTC rather than local time so two members in different time zones spend the
 * same organization's month, and a month rather than a configurable window
 * because the ledger only needs the two sides to name periods the same way.
 * @returns the current period key.
 */
export function currentPeriod(): string {
  const now = new Date()
  return `${String(now.getUTCFullYear())}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}

export default TeamLlmHttpTransport
