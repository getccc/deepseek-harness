/**
 * The Control Plane end of the governed wire: opening a Runner request and
 * answering a refusal.
 * @module @deepseek-ai/dsh-team-governed-wire/server
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { ACCESS_TOKEN_HEADER, BEARER_PREFIX } from './protocol.ts'
import type { GovernedProtocol, OpenOptions, OpenedRequest, ParseRoute, ServeOptions } from './types.ts'

/**
 * Write one JSON response that no intermediary may cache.
 * @param res - the response.
 * @param status - the HTTP status.
 * @param body - the value to serialize.
 */
export function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/**
 * Refuse with a closed reason and the status the protocol maps it to.
 * @param res - the response.
 * @param protocol - the capability's protocol.
 * @param reason - the refusal word.
 */
export function refuse<Reason extends string>(
  res: ServerResponse,
  protocol: GovernedProtocol<Reason>,
  reason: Reason | 'unauthenticated',
): void {
  json(res, protocol.statusByReason[reason], { error: protocol.scope, reason })
}

/**
 * Answer a failed operation with its closed reason.
 *
 * A failure the capability does not name is this deployment's own defect
 * rather than anything the Runner did, so it answers 500 with no reason word:
 * inventing one would tell a member to take an action that cannot help.
 * @param res - the response.
 * @param protocol - the capability's protocol.
 * @param error - what the operation threw.
 * @param reasonOf - the refusal word of a failure the capability owns, or undefined for any other.
 */
export function answerFailure<Reason extends string>(
  res: ServerResponse,
  protocol: GovernedProtocol<Reason>,
  error: unknown,
  reasonOf: (error: unknown) => Reason | undefined,
): void {
  const reason = reasonOf(error)
  if (reason === undefined) json(res, 500, { error: 'internal' })
  else refuse(res, protocol, reason)
}

/**
 * The bearer token a request carries, when it carries one.
 *
 * `node:http` joins repeated `authorization` headers into one comma-separated
 * string rather than an array, so a request that sent two does not match the
 * prefix and reads as carrying none.
 * @param req - the request.
 * @returns the token, or undefined.
 */
export function bearer(req: IncomingMessage): string | undefined {
  const value = req.headers[ACCESS_TOKEN_HEADER]
  return typeof value === 'string' && value.startsWith(BEARER_PREFIX) ? value.slice(BEARER_PREFIX.length) : undefined
}

/**
 * Read a JSON object body under a byte bound, refusing as it streams rather
 * than after it has all arrived.
 * @param req - the request.
 * @param limit - the most bytes the body may carry.
 * @returns the object, or undefined for an oversized, unparsable, or non-object body.
 */
export async function readJson(req: IncomingMessage, limit: number): Promise<Record<string, unknown> | undefined> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.byteLength
    if (size > limit) return undefined
    chunks.push(buffer)
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined
  } catch {
    // A body that is not JSON is a proxy error page or a truncated request;
    // either way this build cannot read it, and the parser's own message
    // describes our parse rather than the caller's mistake.
    return undefined
  }
}

/**
 * Read a whole page number, page size, or bound, when the field carries one.
 *
 * Absent is a valid request, the gateway supplies its own default, so the
 * answer distinguishes "not given" from "not a number this build accepts",
 * which is a protocol error rather than an authorization outcome.
 * @param value - the decoded field.
 * @returns the number, `undefined` when the field is absent, or `'invalid'`.
 */
export function readCount(value: unknown): number | undefined | 'invalid' {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) return 'invalid'
  return value
}

/**
 * Everything every route does before it diverges: method, body, protocol
 * version, then identity. The version is checked before any other field is
 * read and before the token is verified: decoding a body under a grammar its
 * sender did not mean is how a version check stops being one, and sending an
 * out-of-date Runner to sign in again cannot help it.
 * @param req - the request.
 * @param res - the response; the refusal is written to it when this returns undefined.
 * @param options - the capability's protocol, the body bound, and the token verifier.
 * @returns the body and the member, or undefined once the refusal is written.
 */
export async function openRequest<Reason extends string>(
  req: IncomingMessage,
  res: ServerResponse,
  options: OpenOptions<Reason>,
): Promise<OpenedRequest | undefined> {
  const { protocol } = options
  if (req.method !== 'POST') {
    json(res, 405, { error: 'method not allowed' })
    return undefined
  }
  const body = await readJson(req, options.limit)
  if (body === undefined) {
    json(res, 400, { error: 'malformed' })
    return undefined
  }
  const version = body['protocolVersion']
  if (typeof version !== 'number' || version < protocol.minimum || version > protocol.current) {
    json(res, 426, {
      error: protocol.scope,
      reason: 'update-required',
      minimum: protocol.minimum,
      current: protocol.current,
    })
    return undefined
  }
  const token = bearer(req)
  const claims = token === undefined ? undefined : await options.verify(token)
  // One answer for an unknown token, a lapsed one, and a revoked device.
  if (claims === undefined) {
    refuse(res, protocol, 'unauthenticated')
    return undefined
  }
  return {
    body,
    principal: { orgId: claims.orgId, principalId: claims.principalId, deviceId: claims.deviceId },
  }
}

/**
 * Build the handler of one POST route: open the request, decode it, run the
 * operation, and answer with the result or a closed refusal.
 * @param options - the capability's protocol, the body bound, the token verifier, and its failure mapping.
 * @param parse - decodes an opened request into the operation to run, or undefined when it is malformed.
 * @returns the route handler.
 */
export function governedHandler<Reason extends string>(
  options: ServeOptions<Reason>,
  parse: ParseRoute,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    const opened = await openRequest(req, res, options)
    if (opened === undefined) return
    const run = parse(opened)
    if (run === undefined) {
      json(res, 400, { error: 'malformed' })
      return
    }
    try {
      json(res, 200, await run())
    } catch (error) {
      answerFailure(res, options.protocol, error, options.reasonOf)
    }
  }
}
