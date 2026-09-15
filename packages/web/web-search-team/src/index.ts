/**
 * The Team Runner's search provider: one outbound request to the company
 * Control Plane carrying the current device access token and the query, and
 * nothing else. The Control Plane holds the search credential, decides
 * whether this member may search, and answers with the web service's result.
 * @module @deepseek-ai/dsh-web-search-team
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  WebError,
  type WebSearchProvider,
  type WebSearchRequest,
  type WebSearchResult,
  type WebSearchSource,
} from '@deepseek-ai/dsh-web'
import {
  ACCESS_TOKEN_HEADER,
  WEB_ACCESS_PATH,
  WEB_SEARCH_PATH,
  WEB_SEARCH_PROTOCOL_VERSION,
  WEB_SEARCH_REFUSAL_REASONS,
  type WebSearchRefusalReason,
} from '@deepseek-ai/dsh-web-search-gateway-http'
import {
  controlPlaneConfigFields,
  controlPlaneFetch,
  type ControlPlaneFetch,
  type Response,
} from '@deepseek-ai/dsh-team-account-client'

/** Cordis plugin name. */
export const name = 'web-search-team'

/** The search seam this registers on, and the account client whose token it reads. */
export const inject = ['web', 'teamAccountClient']

/** Stable id this provider registers under; pin it with `searchProvider: team`. */
export const TEAM_PROVIDER_ID = 'team'

/** Plugin config: where the Control Plane is, and how to trust it. */
export interface Config {
  /** Origin of the company Control Plane; no default. */
  controlPlaneUrl: string
  /** PEM file holding the only certificates accepted for it; absent verifies like any host. */
  controlPlaneCa?: string
}

/** Config schema; `controlPlaneUrl` is required. */
export const Config: z<Config> = z.object({ ...controlPlaneConfigFields })

/**
 * The web error code each refusal maps to, so the tool's structured error
 * tells a member what to do: sign in, ask an administrator, update, or retry.
 */
const CODE_BY_REASON: Readonly<Record<WebSearchRefusalReason, string>> = {
  'unauthenticated': 'WEB_PROVIDER_CREDENTIAL_MISSING',
  'not-allowed': 'WEB_PROVIDER_ERROR',
  'upstream-unavailable': 'WEB_PROVIDER_UNAVAILABLE',
  'upstream-invalid': 'WEB_PROVIDER_ERROR',
  'update-required': 'WEB_PROVIDER_ERROR',
  'cancelled': 'WEB_ABORTED',
}

const MESSAGE_BY_REASON: Readonly<Record<WebSearchRefusalReason, string>> = {
  'unauthenticated': 'this computer is not signed in to the company; sign in to search the web through it',
  'not-allowed': 'an administrator has not allowed web search for this member',
  'upstream-unavailable': 'the company web search is not available right now',
  'upstream-invalid': 'the company web search answered with an error',
  'update-required': 'this application is too old for the company web search; update it',
  'cancelled': 'the web search was cancelled',
}

/** The provider: one call per search, the token read fresh each time. */
export class TeamSearchProvider implements WebSearchProvider {
  readonly id = TEAM_PROVIDER_ID

  constructor(
    private readonly ctx: Context,
    private readonly controlPlaneUrl: string,
    private readonly fetch: ControlPlaneFetch,
  ) {}

  /** Always usable locally: whether this member may search is the Control Plane's decision, made per call. */
  available(): boolean {
    return true
  }

  /**
   * Ask the Control Plane whether this member may search at all. Anything
   * short of an explicit `allowed: true` — not signed in, not granted, an
   * old protocol, an unreachable or unreadable Control Plane — is false, so a
   * consumer offers search only when the decision is certain.
   * @param signal - cancellation of the decision request.
   * @returns whether the Control Plane permits this member to search.
   */
  async permitted(signal?: AbortSignal): Promise<boolean> {
    let token: string
    try {
      token = await this.ctx.teamAccountClient.accessToken()
    } catch {
      // Not bound or refused: no member to decide for.
      return false
    }
    let response: Response
    try {
      response = await this.fetch(new URL(WEB_ACCESS_PATH, this.controlPlaneUrl), {
        method: 'POST',
        headers: {
          [ACCESS_TOKEN_HEADER]: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ protocolVersion: WEB_SEARCH_PROTOCOL_VERSION }),
        ...(signal === undefined ? {} : { signal }),
      })
    } catch {
      // Unreachable, or the caller's own abort: no decision was made.
      return false
    }
    if (!response.ok) return false
    let decoded: unknown
    try {
      decoded = await response.json()
    } catch {
      // A reverse proxy error page rather than a Control Plane answer.
      return false
    }
    return typeof decoded === 'object' && decoded !== null && (decoded as Record<string, unknown>)['allowed'] === true
  }

  /**
   * Run one search through the Control Plane.
   * @param request - the query and the source bound the tool asked for.
   * @param signal - the caller's cancellation, forwarded to the request.
   * @returns the Control Plane's answer, validated field by field.
   * @throws {WebError} with the code the refusal maps to, `WEB_PROVIDER_UNAVAILABLE`
   * when the Control Plane cannot be reached or read, or `WEB_ABORTED` on cancellation.
   */
  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const token = await this.accessToken()
    let response: Response
    try {
      response = await this.fetch(new URL(WEB_SEARCH_PATH, this.controlPlaneUrl), {
        method: 'POST',
        headers: {
          [ACCESS_TOKEN_HEADER]: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          protocolVersion: WEB_SEARCH_PROTOCOL_VERSION,
          query: request.query,
          ...(request.maxResults === undefined ? {} : { maxResults: request.maxResults }),
        }),
        ...(signal === undefined ? {} : { signal }),
      })
    } catch (error) {
      if (signal?.aborted === true) throw new WebError('the web search was cancelled', 'WEB_ABORTED', { cause: error })
      throw new WebError('the Control Plane did not answer the web search', 'WEB_PROVIDER_UNAVAILABLE', { cause: error })
    }
    let decoded: unknown
    try {
      decoded = await response.json()
    } catch (error) {
      // A reverse proxy error page rather than a Control Plane answer.
      throw new WebError('the web search answer was not a Control Plane answer', 'WEB_PROVIDER_UNAVAILABLE', { cause: error })
    }
    if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) {
      throw new WebError('the web search answer was not an object', 'WEB_PROVIDER_UNAVAILABLE')
    }
    const body = decoded as Record<string, unknown>
    if (!response.ok) {
      const reason = refusalOf(body)
      throw new WebError(
        `${MESSAGE_BY_REASON[reason]} (the Control Plane answered HTTP ${String(response.status)})`,
        CODE_BY_REASON[reason],
      )
    }
    return readAnswer(body)
  }

  private async accessToken(): Promise<string> {
    try {
      return await this.ctx.teamAccountClient.accessToken()
    } catch (error) {
      // Not bound and refused are the same to a search caller: neither is a
      // search failure, and both are answered by signing this computer in.
      throw new WebError(MESSAGE_BY_REASON.unauthenticated, 'WEB_PROVIDER_CREDENTIAL_MISSING', { cause: error })
    }
  }
}

/**
 * The refusal reason a failed answer names.
 * @param body - the refusal body.
 * @returns the reason, or `upstream-unavailable` for a word this build does not know.
 */
function refusalOf(body: Record<string, unknown>): WebSearchRefusalReason {
  const reason = body['reason']
  return typeof reason === 'string' && (WEB_SEARCH_REFUSAL_REASONS as readonly string[]).includes(reason)
    ? reason as WebSearchRefusalReason
    : 'upstream-unavailable'
}

/**
 * Validate a success answer at the wire before it becomes a search result.
 * @param body - the decoded answer.
 * @returns the result.
 * @throws {WebError} `WEB_PROVIDER_ERROR` when a required field is missing or mistyped.
 */
export function readAnswer(body: Record<string, unknown>): WebSearchResult {
  const sources = body['sources']
  const truncated = body['truncated']
  const content = body['content']
  if (!Array.isArray(sources) || typeof truncated !== 'boolean' || (content !== undefined && typeof content !== 'string')) {
    throw new WebError('the web search answer is missing its fields', 'WEB_PROVIDER_ERROR')
  }
  return {
    ...(content === undefined ? {} : { content }),
    sources: sources.map(source => readSource(source)),
    truncated,
  }
}

function readSource(value: unknown): WebSearchSource {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new WebError('a web search source is not an object', 'WEB_PROVIDER_ERROR')
  }
  const row = value as Record<string, unknown>
  const url = row['url']
  if (typeof url !== 'string' || url === '') {
    throw new WebError('a web search source is missing its URL', 'WEB_PROVIDER_ERROR')
  }
  return {
    url,
    ...(typeof row['title'] === 'string' ? { title: row['title'] } : {}),
    ...(typeof row['snippet'] === 'string' ? { snippet: row['snippet'] } : {}),
    ...(typeof row['publishedAt'] === 'string' ? { publishedAt: row['publishedAt'] } : {}),
  }
}

/**
 * Register the provider on the web seam.
 * @param ctx - the Runner context.
 * @param config - the Control Plane origin and its pinned certificate.
 */
export function apply(ctx: Context, config: Config): void {
  const fetch = controlPlaneFetch(ctx, config.controlPlaneCa)
  ctx.effect(
    () => ctx.web.registerSearchProvider(new TeamSearchProvider(ctx, config.controlPlaneUrl, fetch)),
    'web-search-team: search provider',
  )
}
