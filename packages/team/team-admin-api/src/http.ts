/**
 * Reading a JSON request and answering with one.
 * @module @deepseek-ai/dsh-team-admin-api/http
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WireRefusal, WireRefusalReason } from './types.ts'

/** Header a write echoes the session's CSRF value in. */
export const CSRF_HEADER = 'x-dsh-csrf'

/** Why {@link readJson} produced no object. */
export type BodyProblem = 'too-large' | 'malformed'

/**
 * Answer with a JSON body.
 * @param res - the response to write.
 * @param status - the HTTP status.
 * @param body - the value to serialize.
 */
export function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload).toString(),
    // An administration answer is about one member's authority at one moment;
    // a cache that served it to the next request would be serving the wrong
    // member's view.
    'cache-control': 'no-store',
  })
  res.end(payload)
}

/**
 * Answer a request that will not be carried out.
 * @param res - the response to write.
 * @param status - the HTTP status.
 * @param error - the word the console switches on.
 * @param said - the reason the console has copy for, and the English sentence for everyone else.
 */
export function refuse(
  res: ServerResponse,
  status: number,
  error: WireRefusal['error'],
  said: { reason?: WireRefusalReason; detail?: string } = {},
): void {
  json(res, status, {
    error,
    ...(said.reason === undefined ? {} : { reason: said.reason }),
    ...(said.detail === undefined ? {} : { detail: said.detail }),
  })
}

/**
 * Read one JSON object from a request body.
 *
 * Bounded before parsing rather than after, so an oversized body is refused
 * without being held. A body that is not a JSON object — an array, a string, a
 * fragment — is `malformed`: every route here takes named fields.
 * @param req - the incoming request.
 * @param maxBytes - the largest body this deployment accepts.
 * @returns the object, or the reason there is none.
 */
export async function readJson(
  req: IncomingMessage,
  maxBytes: number,
): Promise<Record<string, unknown> | BodyProblem> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.byteLength
    // Stop reading and answer; destroying the socket here would take the
    // response with it and the console would see a dropped connection rather
    // than the refusal.
    if (size > maxBytes) return 'too-large'
    chunks.push(buffer)
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : 'malformed'
  } catch {
    // Not JSON at all, or a fragment of it: either way there is no object here.
    return 'malformed'
  }
}

/**
 * Read one string field a route cannot proceed without.
 * @param body - the parsed request body.
 * @param name - the field to read.
 * @returns the trimmed value, or undefined when it is absent or not a non-empty string.
 */
export function text(body: Record<string, unknown>, name: string): string | undefined {
  const value = body[name]
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * Read one optional string field of a partial update.
 *
 * Three answers, because a partial update has three cases: the field was not
 * sent, it was sent with a value, or it was sent empty to clear what is stored.
 * A value that is not a string is treated as absent, which is what the routes
 * do with every field they cannot use.
 * @param body - the parsed request body.
 * @param name - the field to read.
 * @returns the trimmed value, null to clear it, or undefined when it was not sent.
 */
export function patchText(body: Record<string, unknown>, name: string): string | null | undefined {
  const value = body[name]
  if (value === null) return null
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * Read one optional whole-number field of a partial update.
 * @param body - the parsed request body.
 * @param name - the field to read.
 * @returns the value, or undefined when it was not sent or is not a safe integer.
 */
export function patchInteger(body: Record<string, unknown>, name: string): number | undefined {
  const value = body[name]
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined
}

/**
 * Read one optional boolean field of a partial update.
 * @param body - the parsed request body.
 * @param name - the field to read.
 * @returns the value, or undefined when it was not sent or is not a boolean.
 */
export function patchBoolean(body: Record<string, unknown>, name: string): boolean | undefined {
  const value = body[name]
  return typeof value === 'boolean' ? value : undefined
}
