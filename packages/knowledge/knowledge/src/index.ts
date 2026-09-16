/**
 * The knowledge seam: one service a Runner asks for the private knowledge its
 * signed-in member may reach, and for passages out of it.
 *
 * The seam is deliberately small — a directory, its documents, and a search —
 * because every operation it names has to be one the Control Plane can
 * authorize against a current account, a current device, and current grants. There is no operation
 * for naming an address, choosing a tenant, or passing an upstream identifier,
 * so a Runner holding this service still cannot reach a knowledge source
 * except through a decision made elsewhere.
 * @module @deepseek-ai/dsh-knowledge
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import type {
  KnowledgeBaseEntry, KnowledgeDocumentPage, KnowledgeDocumentsRequest,
  KnowledgeSearchRequest, KnowledgeSearchResult,
} from './types.ts'

export {
  InvalidKnowledgeRefError,
  KNOWLEDGE_DOC_ID_MAX_LENGTH,
  KNOWLEDGE_REF_MAX_LENGTH,
  KNOWLEDGE_REF_SEGMENT,
  KNOWLEDGE_SOURCE_CODE_MAX_LENGTH,
  KnowledgeDocRef,
  KnowledgeRef,
  formatKnowledgeDocRef,
  formatKnowledgeRef,
  isKnowledgeDocRef,
  isKnowledgeRef,
  parseKnowledgeDocRef,
  parseKnowledgeRef,
  type KnowledgeDocRefParts,
  type KnowledgeRefParts,
} from './brand.ts'
export {
  DEFAULT_KNOWLEDGE_SCOPE,
  foldKnowledgeScope,
  parseKnowledgeScope,
  selectionOf,
} from './scope.ts'
export {
  KnowledgeError,
  type KnowledgeBaseEntry,
  type KnowledgeDocument,
  type KnowledgeDocumentPage,
  type KnowledgeDocumentState,
  type KnowledgeDocumentsRequest,
  type KnowledgeFailureReason,
  type KnowledgeKind,
  type KnowledgePassage,
  type KnowledgeScope,
  type KnowledgeScopeBase,
  type KnowledgeScopeMode,
  type KnowledgeScopeSelection,
  type KnowledgeSearchRequest,
  type KnowledgeSearchResult,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    knowledge: Knowledge
  }
}

/**
 * Private knowledge, as a Runner sees it. A provider mounts this service;
 * consumers inject `knowledge`.
 *
 * Both methods fail with {@link KnowledgeError} carrying a closed reason.
 * Neither returns a partial answer: a directory that could not be authorized
 * and a search whose scope was refused both raise, because a quietly narrowed
 * result is indistinguishable from a correct one to the model that reads it.
 */
export abstract class Knowledge extends Service {
  constructor(ctx: Context) {
    super(ctx, 'knowledge')
  }

  /**
   * The knowledge bases the current principal may search right now.
   * @param signal - aborts the operation.
   * @returns the authorized directory, empty when the principal holds nothing.
   * @throws {KnowledgeError} when the principal cannot be established or the directory cannot be read.
   */
  abstract catalog(signal?: AbortSignal): Promise<readonly KnowledgeBaseEntry[]>

  /**
   * One page of the documents in one authorized knowledge base.
   *
   * The knowledge base is authorized on this call, like every other operation:
   * a reference that was in the directory a moment ago is not standing
   * permission to list it now.
   * @param request - the knowledge base, and which page of it.
   * @returns the page, empty when the knowledge base holds no document.
   * @throws {KnowledgeError} when the knowledge base is refused or the upstream does not answer usably.
   */
  abstract documents(request: KnowledgeDocumentsRequest): Promise<KnowledgeDocumentPage>

  /**
   * Search the knowledge bases one operation names.
   * @param request - the query, the scope resolved from the Session, and the caller's bounds.
   * @returns the passages, with the knowledge bases actually searched.
   * @throws {KnowledgeError} when any named knowledge base is refused, the scope
   * cannot be searched together, or the upstream does not answer usably.
   */
  abstract search(request: KnowledgeSearchRequest): Promise<KnowledgeSearchResult>
}
