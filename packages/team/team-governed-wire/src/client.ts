/**
 * The Runner end of the governed wire: one device-token call to the Control
 * Plane and the decoding of its refusals.
 * @module @deepseek-ai/dsh-team-governed-wire/client
 */

import type { Response } from '@deepseek-ai/dsh-team-account-client'
import { ACCESS_TOKEN_HEADER, BEARER_PREFIX } from './protocol.ts'
import type { GovernedClient, GovernedClientOptions } from './types.ts'

/**
 * Bind the endpoints of one capability's Control Plane.
 *
 * Every failure that is not an answer this build can read becomes
 * `control-plane-unreachable`: from a member's seat, a DNS failure, a TLS
 * failure, a proxy that ate the request, and a Control Plane that is down are
 * the same fact, and none of them is something they can act on differently.
 * A token that cannot be read is `unauthenticated`: not bound and refused are
 * the same to a caller, and both are answered by signing this computer in.
 * @param options - the transport, the origin, the token source, and the capability's reasons.
 * @returns a function that performs one call and returns its decoded object.
 * @throws from that function, the capability's error built by `options.fail`, for every outcome but success.
 */
export function governedClient<Reason extends string>(options: GovernedClientOptions<Reason>): GovernedClient {
  return async (path, protocolVersion, fields, signal) => {
    const token = await readToken(options)
    let response: Response
    try {
      response = await options.fetch(new URL(path, options.baseUrl), {
        method: 'POST',
        headers: {
          [ACCESS_TOKEN_HEADER]: `${BEARER_PREFIX}${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ protocolVersion, ...fields }),
        ...(signal === undefined ? {} : { signal }),
      })
    } catch {
      // Includes the caller's own abort, which reaches the tool as a
      // cancellation through its execution signal rather than through here.
      throw options.fail('control-plane-unreachable', 'the Control Plane did not answer')
    }
    let decoded: unknown
    try {
      decoded = await response.json()
    } catch {
      // A reverse proxy error page rather than a Control Plane answer.
      throw options.fail('control-plane-unreachable', 'the answer was not a Control Plane answer')
    }
    if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) {
      throw options.fail('control-plane-unreachable', 'the answer was not an object')
    }
    const body = decoded as Record<string, unknown>
    if (response.ok) return body
    throw options.fail(refusalOf(body, options.reasons), `the Control Plane answered HTTP ${String(response.status)}`)
  }
}

/** The Runner's current access token, or the capability's `unauthenticated` refusal. */
async function readToken<Reason extends string>(options: GovernedClientOptions<Reason>): Promise<string> {
  try {
    return await options.account.accessToken()
  } catch {
    // The account client's own failure says why this computer is not signed
    // in; to a capability caller every cause has the same remedy.
    throw options.fail('unauthenticated', 'this computer is not signed in')
  }
}

/**
 * Read the reason out of a refusal.
 *
 * An unknown word is treated as unreachable rather than passed through: a
 * Control Plane speaking reasons this build does not know is one this build
 * cannot act on, and inventing a meaning would tell a member to do something
 * that may not help.
 */
function refusalOf<Reason extends string>(body: Record<string, unknown>, reasons: readonly Reason[]): Reason | 'control-plane-unreachable' {
  const reason = body['reason']
  return typeof reason === 'string' && (reasons as readonly string[]).includes(reason)
    ? reason as Reason
    : 'control-plane-unreachable'
}
