/**
 * The company model gateway: what a Runner may invoke, and what the call
 * actually becomes.
 *
 * A Runner names a model and gets back a call it could not have constructed
 * itself — the endpoint, the upstream model name, and the credential all come
 * from the catalog. That is what makes "the credential never reaches the
 * Runner" a property of the design rather than a promise: there is nothing in
 * the request for a Runner to put one in.
 * @module @deepseek-ai/dsh-model-gateway
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import { isCredentialRefName } from '@deepseek-ai/dsh-credentials'
import type { OrgId } from '@deepseek-ai/dsh-account-store'
import type { ReservationId } from '@deepseek-ai/dsh-quota'
import type { Settlement } from '@deepseek-ai/dsh-quota'
import type {
  CallPlan,
  DiscoveredCatalogModel,
  InvocationRefusal,
  InvocationRequest,
  ModelEntry,
  ModelStatus,
  RegisterModel,
} from './types.ts'

export {
  MODEL_FIELD,
  OUTPUT_LIMIT_FIELDS,
  applyPlanToBody,
} from './body.ts'
export type {
  CallPlan,
  DiscoveredCatalogModel,
  InvocationRefusal,
  InvocationRequest,
  ModelEntry,
  ModelStatus,
  RegisterModel,
} from './types.ts'
export { INVOCATION_REFUSALS, MODEL_STATUSES } from './vocabulary.ts'
// The modality vocabulary is the transport seam's: the value crosses that wire
// from this catalog to an adapter, so both sides read one list.
export { MODEL_INPUT_MODALITIES } from '@deepseek-ai/dsh-llm-http-transport'
export type { ModelInputModality } from '@deepseek-ai/dsh-llm-http-transport'

declare module '@deepseek-ai/cordis' {
  interface Context {
    modelGateway: ModelGateway
  }
}

/**
 * Raised when a catalog entry names something the gateway could never use.
 *
 * Separate from an invocation refusal because it is an administrator's mistake
 * at the moment they make it, rather than a member's request being turned
 * down — and catching it here is what stops a model from sitting in the
 * catalog marked active while every call to it fails.
 */
export class MalformedCatalogEntryError extends Error {
  constructor(readonly field: string) {
    super(`catalog field ${JSON.stringify(field)} does not name what the gateway needs`)
    this.name = 'MalformedCatalogEntryError'
  }
}

/**
 * Whether a string can address a provider credential.
 *
 * The grammar belongs to the credential provider, so this asks it rather than
 * restating it: a credential *reference* is a POSIX identifier such as
 * `COMPANY_DEEPSEEK_KEY`, and a credential *key* — `scope/id` — addresses a
 * different thing and cannot be resolved as one.
 * @param value - the candidate credential reference.
 * @returns true when a gateway could resolve it at call time.
 */
export function isUsableCredentialRef(value: string): boolean {
  return isCredentialRefName(value)
}

/** Raised when an invocation cannot proceed. */
export class InvocationRefusedError extends Error {
  constructor(readonly reason: InvocationRefusal) {
    super(`invocation refused: ${reason}`)
    this.name = 'InvocationRefusedError'
  }
}

/**
 * The company model catalog and the decision in front of it. A provider mounts
 * this service; consumers inject `modelGateway`.
 *
 * Authorization is asked on every invocation rather than cached with a token,
 * so a role change takes effect on the next request instead of when a
 * credential happens to expire.
 */
export abstract class ModelGateway extends Service {
  constructor(ctx: Context) {
    super(ctx, 'modelGateway')
  }

  /**
   * Put a model in the catalog, or update the one already there.
   *
   * Idempotent on `(orgId, modelRef)`: the stable ref is the identity, so a
   * provider renaming its model upstream, or a credential rotating, changes
   * this row without disturbing any grant that names it.
   * @param input - the model's stable ref and everything the upstream call needs.
   * @returns the stored entry.
   * @throws {MalformedCatalogEntryError} when a field names something no call could use.
   */
  abstract register(input: RegisterModel): Promise<ModelEntry>

  /**
   * Withdraw a model from service, or return it.
   * @param orgId - the organization the model belongs to.
   * @param modelRef - the model to change.
   * @param status - whether it may be invoked.
   */
  abstract setStatus(orgId: OrgId, modelRef: string, status: ModelStatus): Promise<void>

  /**
   * Take a model out of the catalog, with the grants that named it.
   *
   * Deleting is not retiring. A retired model keeps its row and its grants and
   * returns to service unchanged; a deleted one leaves nothing behind, so a
   * model registered later under the same ref starts with no access. Only what
   * {@link register} governed is ungoverned: a ref this catalog holds no entry
   * for changes nothing and does not fail, even when some other subsystem
   * governs a resource of the model type under that same ref.
   * @param orgId - the organization the model belongs to.
   * @param modelRef - the model to remove.
   */
  abstract remove(orgId: OrgId, modelRef: string): Promise<void>

  /**
   * Every model in an organization's catalog, in registration order.
   *
   * This is the administrator's view and is not filtered by any principal's
   * grants; a member's list is {@link discover}.
   * @param orgId - the organization to list.
   * @returns the catalog, retired models included.
   */
  abstract list(orgId: OrgId): Promise<ModelEntry[]>

  /**
   * The models one principal may see, with nothing an upstream call needs.
   *
   * A Runner is told the stable ref, the display name, and the input
   * modalities and no more: the endpoint, the upstream name, and the
   * credential reference are the gateway's, and a member's model list is not
   * the place to publish them. The modalities are there because the Runner
   * decides before sending whether a message with an image may go to this
   * model, and has no other way to know.
   * @param orgId - the organization to list.
   * @param principalId - the account asking.
   * @returns the active models this principal holds `model.discover` on.
   */
  abstract discover(orgId: OrgId, principalId: string): Promise<DiscoveredCatalogModel[]>

  /**
   * Decide one invocation and hold the budget for it.
   *
   * The order is deliberate: a model nobody may discover is refused as
   * unknown, an authorized model with no budget is refused after the
   * authorization it passed, and a reservation is only taken once the request
   * is certain to be attempted.
   * @param request - who is asking, for which model, and how much it may cost.
   * @returns the approved call, including the reservation to settle afterwards.
   * @throws {InvocationRefusedError} with the word for why it may not proceed.
   */
  abstract authorize(request: InvocationRequest): Promise<CallPlan>

  /**
   * Settle the reservation an approved call held.
   *
   * A pass-through to the ledger, so a caller that holds a plan does not also
   * need the quota service, and so every settlement for a gateway call goes
   * through one place.
   * @param reservationId - the reservation the plan named.
   * @param settlement - what the provider reported, what is estimated, or a release.
   */
  abstract settle(reservationId: ReservationId, settlement: Settlement): Promise<void>
}
