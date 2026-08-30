/**
 * SQLite-backed company model gateway: the catalog, and the decision in front
 * of it.
 * @module @deepseek-ai/dsh-model-gateway-sqlite
 */

import { DatabaseSync } from 'node:sqlite'
import type { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { OrgId, UserId, type OrgId as OrgIdType } from '@deepseek-ai/dsh-account-store'
import type {} from '@deepseek-ai/dsh-access-control'
import {
  ReservationRefusedError,
  type ReservationId,
  type Settlement,
} from '@deepseek-ai/dsh-quota'
import {
  InvocationRefusedError,
  ModelGateway,
  type CallPlan,
  type InvocationRequest,
  type ModelEntry,
  type ModelStatus,
  type RegisterModel,
} from '@deepseek-ai/dsh-model-gateway'
import { applySchema, type ModelRow } from './schema.ts'

export { MODEL_GATEWAY_SQLITE_APPLICATION_ID, SCHEMA_VERSION } from './schema.ts'

/** Plugin config: where the catalog lives. */
export interface Config {
  /** SQLite database path, or `:memory:` for an in-process database. */
  path: string
}

/** The resource type the permission catalog governs models under. */
const RESOURCE_TYPE = 'model'

function toEntry(row: ModelRow): ModelEntry {
  return {
    orgId: OrgId(row.org_id),
    modelRef: row.model_ref,
    displayName: row.display_name,
    providerRef: row.provider_ref,
    upstreamModel: row.upstream_model,
    endpoint: row.endpoint,
    credentialRef: row.credential_ref,
    maxOutputTokens: row.max_output_tokens,
    status: row.status as ModelStatus,
  }
}

/**
 * The model gateway over one SQLite catalog.
 *
 * Registering a model also governs it in access control, because a catalog
 * entry no grant can name is a model nobody can ever invoke — and an
 * administrator who added one would have to know to do a second thing
 * elsewhere for the first to mean anything.
 */
export class SqliteModelGateway extends ModelGateway {
  static inject = ['accessControl', 'quota']

  static Config: z<Config> = z.object({
    path: z.string().required(),
  })

  private db!: DatabaseSync

  constructor(ctx: Context, public config: Config) {
    super(ctx)
  }

  /** Open and bring the database to the current schema. */
  protected async [Service.init](): Promise<void> {
    const db = new DatabaseSync(this.config.path)
    applySchema(db)
    this.db = db
    this.ctx.effect(() => () => { db.close() }, 'model-gateway-sqlite.close')
    await Promise.resolve()
  }

  async register(input: RegisterModel): Promise<ModelEntry> {
    this.db.prepare(
      `INSERT INTO model
         (org_id, model_ref, display_name, provider_ref, upstream_model, endpoint,
          credential_ref, max_output_tokens, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')
       ON CONFLICT (org_id, model_ref) DO UPDATE SET
         display_name = excluded.display_name,
         provider_ref = excluded.provider_ref,
         upstream_model = excluded.upstream_model,
         endpoint = excluded.endpoint,
         credential_ref = excluded.credential_ref,
         max_output_tokens = excluded.max_output_tokens`,
    ).run(
      input.orgId, input.modelRef, input.displayName, input.providerRef,
      input.upstreamModel, input.endpoint, input.credentialRef, input.maxOutputTokens,
    )
    // Governed in the same act. A catalog entry access control does not know
    // about is a model no grant can name and nobody can ever invoke.
    await this.ctx.accessControl.registerResource({
      orgId: input.orgId,
      type: RESOURCE_TYPE,
      externalRef: input.modelRef,
      displayName: input.displayName,
    })
    return this.entry(input.orgId, input.modelRef) as ModelEntry
  }

  async setStatus(orgId: OrgIdType, modelRef: string, status: ModelStatus): Promise<void> {
    this.db.prepare('UPDATE model SET status = ? WHERE org_id = ? AND model_ref = ?')
      .run(status, orgId, modelRef)
    // The governed resource follows, so a retired model is refused by access
    // control as well as here, whichever entry point a request arrives at.
    const resources = await this.ctx.accessControl.listResources(orgId, RESOURCE_TYPE)
    const governed = resources.find(resource => resource.externalRef === modelRef)
    if (governed !== undefined) {
      await this.ctx.accessControl.setResourceEnabled(governed.id, status === 'active')
    }
  }

  list(orgId: OrgIdType): Promise<ModelEntry[]> {
    const rows = this.db.prepare('SELECT * FROM model WHERE org_id = ? ORDER BY rowid')
      .all(orgId) as unknown as ModelRow[]
    return Promise.resolve(rows.map(toEntry))
  }

  async discover(orgId: OrgIdType, principalId: string): Promise<
    { readonly modelRef: string; readonly displayName: string }[]
  > {
    const rows = this.db.prepare("SELECT * FROM model WHERE org_id = ? AND status = 'active' ORDER BY rowid")
      .all(orgId) as unknown as ModelRow[]
    const visible: { modelRef: string; displayName: string }[] = []
    for (const row of rows) {
      const decision = await this.ctx.accessControl.authorize({
        orgId,
        principalId: UserId(principalId),
        action: 'model.discover',
        resourceType: RESOURCE_TYPE,
        resourceId: row.model_ref,
      })
      // Only the stable ref and the display name. The endpoint, the upstream
      // name, and the credential reference are the gateway's.
      if (decision.allowed) visible.push({ modelRef: row.model_ref, displayName: row.display_name })
    }
    return visible
  }

  async authorize(request: InvocationRequest): Promise<CallPlan> {
    const entry = this.entry(request.orgId, request.modelRef)
    // Absent and undiscoverable answer alike, so a refusal never tells a member
    // which models exist in an organization they hold nothing in.
    if (entry === undefined) throw new InvocationRefusedError('unknown-model')
    if (entry.status !== 'active') throw new InvocationRefusedError('model-retired')
    const decision = await this.ctx.accessControl.authorize({
      orgId: request.orgId,
      principalId: request.principalId,
      ...(request.deviceId === undefined ? {} : { deviceId: request.deviceId }),
      action: 'model.invoke',
      resourceType: RESOURCE_TYPE,
      resourceId: request.modelRef,
      ...(request.correlationId === undefined
        ? {}
        : { context: { sessionCorrelationId: request.correlationId } }),
    })
    if (!decision.allowed) {
      throw new InvocationRefusedError(decision.reason === 'no-grant' ? 'unknown-model' : 'not-allowed')
    }
    // The catalog's ceiling wins: a Runner asking for more output than the
    // model is configured to produce gets the configured amount, and the
    // reservation is taken against that rather than against the ask.
    const maxOutputTokens = Math.min(
      request.maxOutputTokens ?? entry.maxOutputTokens,
      entry.maxOutputTokens,
    )
    const reservation = await this.reserve(request, maxOutputTokens)
    return {
      modelRef: entry.modelRef,
      endpoint: entry.endpoint,
      upstreamModel: entry.upstreamModel,
      credentialRef: entry.credentialRef,
      reservationId: reservation,
      maxOutputTokens,
      policyRevision: decision.policyRevision,
    }
  }

  async settle(reservationId: ReservationId, settlement: Settlement): Promise<void> {
    await this.ctx.quota.settle(reservationId, settlement)
  }

  /** Hold the budget, translating the ledger's refusal into this seam's word. */
  private async reserve(request: InvocationRequest, maxOutputTokens: number): Promise<ReservationId> {
    try {
      const held = await this.ctx.quota.reserve({
        orgId: request.orgId,
        period: request.period,
        principalId: request.principalId,
        ...(request.deviceId === undefined ? {} : { deviceId: request.deviceId }),
        modelRef: request.modelRef,
        inputTokens: request.inputTokens,
        maxOutputTokens,
        ...(request.correlationId === undefined ? {} : { correlationId: request.correlationId }),
      })
      return held.id
    } catch (error) {
      /* v8 ignore next -- the ledger rejects only with ReservationRefusedError */
      if (!(error instanceof ReservationRefusedError)) throw error
      throw new InvocationRefusedError(error.reason === 'exceeded' ? 'quota-exceeded' : 'malformed')
    }
  }

  /** Read one catalog row. */
  private entry(orgId: OrgIdType, modelRef: string): ModelEntry | undefined {
    const row = this.db.prepare('SELECT * FROM model WHERE org_id = ? AND model_ref = ?')
      .get(orgId, modelRef) as ModelRow | undefined
    return row === undefined ? undefined : toEntry(row)
  }
}

export default SqliteModelGateway
