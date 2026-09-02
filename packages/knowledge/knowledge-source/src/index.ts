/**
 * The upstream knowledge-source seam: what a Control Plane provider offers the
 * governed gateway in front of it.
 *
 * This is the only place an upstream knowledge product is spoken to, and it is
 * mounted in the Control Plane alone. The two operations are the two the
 * gateway can authorize: enumerate what a source holds, and search an explicit
 * set of its knowledge bases. There is no operation that takes a URL, a
 * caller-chosen header, or an arbitrary upstream path, so the gateway cannot
 * be talked into an operation the permission catalog does not govern.
 *
 * Everything here is in upstream terms — upstream ids, not `KnowledgeRef`s —
 * because mapping between the two is the catalog's job, and a provider that
 * knew about governed resources would be authorizing.
 * @module @deepseek-ai/dsh-knowledge-source
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import type { KnowledgeKind } from '@deepseek-ai/dsh-knowledge'

declare module '@deepseek-ai/cordis' {
  interface Context {
    knowledgeSource: KnowledgeSource
  }
}

/** One knowledge base as its upstream source describes it. */
export interface UpstreamKnowledgeBase {
  /** The source's own identifier, meaningful only to this provider. */
  readonly upstreamId: string
  readonly name: string
  /** Empty when the source supplies none. */
  readonly description: string
  readonly kind: KnowledgeKind
  readonly documentCount: number
  /** Documents the source is still ingesting. */
  readonly processingCount: number
  /**
   * Which embedding model indexes this knowledge base.
   *
   * The catalog records it because multi-base retrieval is only defined for
   * knowledge bases that share one: the gateway refuses a mixed set rather
   * than sending an upstream request whose behavior nobody specified.
   */
  readonly embeddingModelId: string
  /** Epoch milliseconds, or undefined when the source supplies no timestamp. */
  readonly updatedAt: number | undefined
}

/** What the gateway asks a source to search. */
export interface UpstreamSearchRequest {
  /**
   * The upstream ids to search, already authorized. Never empty: an empty set
   * is not a request for everything, and a provider that widened one would be
   * making a decision the gateway already made.
   */
  readonly upstreamIds: readonly string[]
  readonly query: string
  /** The most passages to return, after the provider's own bounds apply. */
  readonly maxResults: number
  readonly signal?: AbortSignal
}

/** One passage a source returned, already bounded and cleaned by its provider. */
export interface UpstreamPassage {
  /** Which knowledge base produced it, so the gateway can map it back. */
  readonly upstreamId: string
  /** The source document's title, empty when the source supplies none. */
  readonly title: string
  /** Passage text with any unresolvable source reference neutralized. */
  readonly text: string
  /** Whether {@link text} was cut to the provider's per-passage maximum. */
  readonly truncated: boolean
  readonly score: number
}

/**
 * One upstream knowledge product. A provider mounts this service; the governed
 * gateway injects `knowledgeSource`.
 *
 * Failures are raised as `KnowledgeError` with `upstream-unavailable` or
 * `upstream-invalid`. A provider never raises an authorization reason: it does
 * not know who is asking, which is the point.
 */
export abstract class KnowledgeSource extends Service {
  constructor(ctx: Context) {
    super(ctx, 'knowledgeSource')
  }

  /**
   * Which upstream product this is, as the first segment of a `KnowledgeRef`.
   *
   * A constant of the provider rather than configuration: it names the code
   * that speaks the protocol, and a deployment renaming it would change the
   * identity of every knowledge base already governed.
   */
  abstract readonly providerKind: string

  /**
   * The deployment's code for this source, as the second `KnowledgeRef`
   * segment. Configuration, because one company's `prod` is another's `kb`.
   */
  abstract readonly sourceCode: string

  /**
   * Everything the configured source holds.
   * @param signal - aborts the operation.
   * @returns every knowledge base, in whatever order the source lists them.
   * @throws {KnowledgeError} `upstream-unavailable` or `upstream-invalid`.
   */
  abstract list(signal?: AbortSignal): Promise<readonly UpstreamKnowledgeBase[]>

  /**
   * Search an explicit, already-authorized set of knowledge bases.
   * @param request - the authorized upstream ids, the query, and the result bound.
   * @returns the passages, at most `maxResults` of them.
   * @throws {KnowledgeError} `upstream-unavailable` or `upstream-invalid`.
   */
  abstract search(request: UpstreamSearchRequest): Promise<readonly UpstreamPassage[]>
}
