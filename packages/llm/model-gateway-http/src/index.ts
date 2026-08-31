/**
 * The Control Plane's company model endpoint.
 *
 * This is where the content of a company model call actually passes through
 * the Control Plane, and where the credential is attached. Everything it does
 * is arranged around two facts: the request must not be able to say where it
 * goes, and the response must not be held in memory.
 * @module @deepseek-ai/dsh-model-gateway-http
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef, isCredentialRefName } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-device-authorization'
import { applyPlanToBody, type CallPlan } from '@deepseek-ai/dsh-model-gateway'
import type { Settlement } from '@deepseek-ai/dsh-quota'
import { TRANSPORT_OPERATIONS } from '@deepseek-ai/dsh-llm-http-transport'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { ACCESS_TOKEN_HEADER, MODEL_CATALOG_PATH, MODEL_INVOKE_PATH } from './protocol.ts'
import { UsageScanner } from './usage.ts'

export {
  ACCESS_TOKEN_HEADER,
  MODEL_CATALOG_PATH,
  MODEL_INVOKE_PATH,
  type DiscoveredModel,
  type InvokeBody,
  type ModelCatalogBody,
} from './protocol.ts'
export { UsageScanner, readUsage, type ReportedUsage } from './usage.ts'

/** Cordis plugin name. */
export const name = 'model-gateway-http'
/** Services required before the endpoint may register. */
export const inject = ['webServer', 'modelGateway', 'deviceAuthorization', 'credentials']

/** Plugin config: how much the endpoint reads, and how long it waits. */
export interface Config {
  /** Largest request body accepted, in bytes. */
  maxRequestBodyBytes: number
  /** How long to wait for the upstream provider before giving up, in milliseconds. */
  upstreamTimeoutMs: number
}

/** Plugin config schema. */
export const Config: z<Config> = z.object({
  maxRequestBodyBytes: z.natural().min(1).default(4 * 1024 * 1024),
  upstreamTimeoutMs: z.natural().min(1).default(600_000),
})

/** Write one JSON response. */
function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/** Read a JSON body, or the reason it cannot be read. */
async function readJson(req: IncomingMessage, limit: number): Promise<Record<string, unknown> | string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.byteLength
    if (size > limit) return 'body too large'
    chunks.push(buffer)
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : 'body must be a JSON object'
  } catch {
    return 'body must be JSON'
  }
}

/**
 * The bearer token a request carries, when it carries one.
 *
 * `node:http` joins repeated `authorization` headers into one comma-separated
 * string rather than an array, so a request that sent two does not match the
 * prefix and reads as carrying none.
 */
function bearer(req: IncomingMessage): string | undefined {
  const value = req.headers[ACCESS_TOKEN_HEADER]
  return typeof value === 'string' && value.startsWith('Bearer ') ? value.slice(7) : undefined
}

/**
 * Register the company model endpoint.
 * @param ctx - Host plugin context carrying the web server, the gateway, and the credential provider.
 * @param config - resolved plugin config (schema defaults applied).
 */
export function apply(ctx: Context, config: Config): void {
  const catalog: WebRoute = {
    kind: 'exact',
    path: MODEL_CATALOG_PATH,
    handler: async (req, res) => {
      if (req.method !== 'GET') {
        json(res, 405, { error: 'method not allowed' })
        return
      }
      const token = bearer(req)
      if (token === undefined) {
        json(res, 401, { error: 'unauthorized' })
        return
      }
      const claims = await ctx.deviceAuthorization.verifyAccessToken(token)
      if (claims === undefined) {
        json(res, 401, { error: 'unauthorized' })
        return
      }
      json(res, 200, {
        models: await ctx.modelGateway.discover(claims.orgId, claims.principalId),
      })
    },
  }
  ctx.effect(() => ctx.webServer.register(catalog), 'model-gateway-http: catalog route')

  const route: WebRoute = {
    kind: 'exact',
    path: MODEL_INVOKE_PATH,
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        json(res, 405, { error: 'method not allowed' })
        return
      }
      const token = bearer(req)
      if (token === undefined) {
        json(res, 401, { error: 'unauthorized' })
        return
      }
      const claims = await ctx.deviceAuthorization.verifyAccessToken(token)
      // One answer for an unknown token, a lapsed one, and a revoked device:
      // which it was is what an attacker holding a stale token wants to learn.
      if (claims === undefined) {
        json(res, 401, { error: 'unauthorized' })
        return
      }
      const body = await readJson(req, config.maxRequestBodyBytes)
      if (typeof body === 'string') {
        json(res, 400, { error: body })
        return
      }
      const request = parseInvoke(body)
      if (typeof request === 'string') {
        json(res, 400, { error: 'refused', reason: request })
        return
      }

      let plan: CallPlan
      try {
        plan = await ctx.modelGateway.authorize({
          orgId: claims.orgId,
          principalId: claims.principalId,
          deviceId: claims.deviceId,
          modelRef: request.modelRef,
          period: request.period,
          inputTokens: request.inputTokens,
          ...(request.maxOutputTokens === undefined ? {} : { maxOutputTokens: request.maxOutputTokens }),
          ...(request.correlationId === undefined ? {} : { correlationId: request.correlationId }),
        })
      } catch (error) {
        const reason = error instanceof Error && 'reason' in error ? String(error.reason) : undefined
        if (reason === undefined) {
          json(res, 500, { error: 'internal' })
          return
        }
        json(res, 403, { error: 'refused', reason })
        return
      }

      await proxy(ctx, config, res, plan, request.body)
    },
  }
  ctx.effect(() => ctx.webServer.register(route), 'model-gateway-http: invoke route')
}

/** Read one invocation body, or name the field that is missing. */
function parseInvoke(body: Record<string, unknown>): {
  modelRef: string
  period: string
  inputTokens: number
  maxOutputTokens?: number
  correlationId?: string
  body: Record<string, unknown>
} | string {
  const operation = body['operation']
  // An operation this build does not carry is refused before anything else
  // reads the request: the list is closed so a caller cannot name a path.
  if (typeof operation !== 'string' || !(TRANSPORT_OPERATIONS as readonly string[]).includes(operation)) {
    return 'unknown-operation'
  }
  const modelRef = body['modelRef']
  const period = body['period']
  const inputTokens = body['inputTokens']
  const inner = body['body']
  if (typeof modelRef !== 'string' || modelRef.length === 0) return 'malformed-body'
  if (typeof period !== 'string' || period.length === 0) return 'malformed-body'
  if (typeof inputTokens !== 'number' || !Number.isSafeInteger(inputTokens)) return 'malformed-body'
  if (typeof inner !== 'object' || inner === null || Array.isArray(inner)) return 'malformed-body'
  const maxOutputTokens = body['maxOutputTokens']
  const correlationId = body['correlationId']
  return {
    modelRef,
    period,
    inputTokens,
    ...(typeof maxOutputTokens === 'number' ? { maxOutputTokens } : {}),
    ...(typeof correlationId === 'string' ? { correlationId } : {}),
    body: inner as Record<string, unknown>,
  }
}

/**
 * Call the provider and stream its answer back, settling the reservation from
 * what the provider said it cost.
 *
 * The credential is resolved here and nowhere else, and it exists only for the
 * duration of the call: it is never written into the plan, the catalog, or a
 * log.
 */
async function proxy(
  ctx: Context,
  config: Config,
  res: ServerResponse,
  plan: CallPlan,
  body: Record<string, unknown>,
): Promise<void> {
  // A catalog entry naming something that is not a credential reference at
  // all, or one nobody configured, is this deployment's problem rather than
  // the member's — and neither is a refusal, so nothing is charged.
  const credential = isCredentialRefName(plan.credentialRef)
    ? await ctx.credentials.resolve(credentialRef(plan.credentialRef))
    : undefined
  if (credential === undefined) {
    await settle(ctx, plan, { kind: 'released' })
    json(res, 500, { error: 'internal' })
    return
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => { controller.abort() }, config.upstreamTimeoutMs)
  let upstream: Response
  try {
    upstream = await fetch(new URL('/v1/chat/completions', plan.endpoint), {
      method: 'POST',
      headers: {
        'authorization': `Bearer ${credential.value}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(applyPlanToBody(body, plan)),
      signal: controller.signal,
    })
  } catch {
    clearTimeout(timeout)
    // No response at all is not evidence the provider refused: it may have
    // processed the prompt and generated tokens nobody saw. The settlement
    // rules call that indeterminate, and an indeterminate call is estimated.
    await settle(ctx, plan, { kind: 'estimated', inputTokens: 0, outputTokens: plan.maxOutputTokens })
    json(res, 502, { error: 'upstream unreachable' })
    return
  }

  const scanner = new UsageScanner()
  res.writeHead(upstream.status, {
    'cache-control': 'no-store',
    'content-type': upstream.headers.get('content-type') ?? 'application/json',
  })
  try {
    for await (const chunk of streamOf(upstream)) {
      scanner.push(chunk)
      res.write(chunk)
    }
    res.end()
  } finally {
    clearTimeout(timeout)
    await settle(ctx, plan, settlementFor(upstream.status, scanner.end(), plan))
  }
}

/** The provider's body as a stream of chunks, or nothing when it had none. */
async function* streamOf(response: Response): AsyncGenerator<Buffer> {
  if (response.body === null) return
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    yield Buffer.from(chunk)
  }
}

/**
 * Decide the settlement from the provider's answer.
 *
 * A status the provider produced saying it did not accept the request, with no
 * usage, is the one case that releases the whole reservation. Everything else
 * charges: reported when the provider said what it used, estimated otherwise,
 * because a call that produced no usage field may still have produced tokens.
 * @param status - the HTTP status the provider answered with.
 * @param usage - what the provider reported, when it reported anything.
 * @param plan - the approved call, whose output ceiling bounds an estimate.
 * @returns the settlement to record for this call.
 */
export function settlementFor(
  status: number,
  usage: { inputTokens: number; outputTokens: number } | undefined,
  plan: { maxOutputTokens: number },
): Settlement {
  if (usage !== undefined) return { kind: 'reported', ...usage }
  if (status >= 400) return { kind: 'released' }
  return { kind: 'estimated', inputTokens: 0, outputTokens: plan.maxOutputTokens }
}

/** Settle, and never let a settlement failure become the member's problem. */
async function settle(ctx: Context, plan: CallPlan, settlement: Settlement): Promise<void> {
  try {
    await ctx.modelGateway.settle(plan.reservationId, settlement)
  } catch {
    // The reconciler closes what this could not. Throwing here would replace a
    // response the member already received with an error about bookkeeping.
  }
}
