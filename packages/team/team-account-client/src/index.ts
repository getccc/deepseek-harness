/**
 * The Runner's side of the team account: the device key it keeps, the
 * credential it holds, and the calls it makes to the Control Plane.
 *
 * The private key never leaves this computer, and no company provider
 * credential ever arrives on it. What the Runner holds is a refresh token for
 * its own device and a short-lived access token, both scoped to this
 * installation.
 * @module @deepseek-ai/dsh-team-account-client
 */

import { generateKeyPairSync, sign } from 'node:crypto'
import { Service, type Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-credentials'
import {
  newSecret,
  pkceChallenge,
  redeemSigningInput,
  refreshSigningInput,
  type DeviceId,
  type DevicePlatform,
  type FamilyId,
  type IssuedCredential,
  type TransactionId,
} from '@deepseek-ai/dsh-device-authorization'
import {
  LOGIN_PATH,
  PROTOCOL_VERSION,
  REDEEM_PATH,
  REFRESH_PATH,
  START_PATH,
  type LoginSuccess,
  type TeamMemberIdentity,
} from '@deepseek-ai/dsh-team-control-plane-http'
import { TEAM_CREDENTIAL_RECORD, readCredential, readDeviceKey, writeCredential } from './storage.ts'
import { controlPlaneConfigFields, controlPlaneFetch, type ControlPlaneFetch } from './transport.ts'
import type { BindingHandle, TeamAccountState } from './types.ts'

export { DEVICE_KEY_RECORD, TEAM_CREDENTIAL_RECORD } from './storage.ts'
export { controlPlaneConfigFields, controlPlaneFetch } from './transport.ts'
export type { ControlPlaneFetch, RequestInit, Response } from './transport.ts'
export type { BindingHandle, StoredCredential, TeamAccountState, TeamMemberIdentity } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    teamAccountClient: TeamAccountClient
  }
}

/** Raised when the Control Plane refused, carrying the word it used. */
export class ControlPlaneRefusedError extends Error {
  constructor(readonly reason: string, readonly status: number) {
    super(`control plane refused: ${reason}`)
    this.name = 'ControlPlaneRefusedError'
  }
}

/**
 * Raised when the Control Plane does not speak this Runner's protocol version.
 *
 * Separate from a refusal because it is the one failure an update fixes, and a
 * Runner that cannot tell it apart would keep retrying a request that will
 * never be accepted.
 */
export class ProtocolUnsupportedError extends Error {
  constructor(readonly minimum: number, readonly current: number) {
    super(`the company Control Plane speaks protocol ${minimum}-${current}, and this Runner speaks ${PROTOCOL_VERSION}`)
    this.name = 'ProtocolUnsupportedError'
  }
}

/** Raised when a call needs a credential this installation does not hold. */
export class NotBoundError extends Error {
  constructor() {
    super('this computer is not bound to a team account')
    this.name = 'NotBoundError'
  }
}

/** Plugin config: which Control Plane, and how this Runner describes itself. */
export interface Config {
  /** Origin of the company Control Plane, such as `https://dsh.company.com`. */
  controlPlaneUrl: string
  /** The fixed loopback address the Control Plane sends the browser back to. */
  callbackUri: string
  /** The version this Runner reports when it binds. */
  runnerVersion: string
  /**
   * Refresh the access token once it is within this many milliseconds of
   * lapsing, so a request does not race its own expiry.
   */
  refreshLeadMs: number
  /**
   * Path to a PEM file whose certificates are the only ones this Runner
   * accepts for the Control Plane, for a deployment whose certificate no
   * public authority signed. Absent, the Control Plane is verified against
   * Node's default authorities like any other host.
   */
  controlPlaneCa?: string
}

/**
 * The platform word for one Node platform string.
 *
 * The device word list names three families; every other Node platform reports
 * as `linux`, because what a Control Plane does with this is show it to an
 * administrator next to a device, and a BSD Runner is nearer that than nothing.
 * @param platform - the value of `process.platform`.
 * @returns the word the device word list governs.
 */
export function platformWord(platform: string): DevicePlatform {
  if (platform === 'win32') return 'win32'
  if (platform === 'darwin') return 'darwin'
  return 'linux'
}

/**
 * The team account as this computer holds it.
 *
 * The default `signIn` flow authenticates the Runner-local form through the
 * Control Plane and binds the device without navigating there. `begin` and
 * `complete` retain the two-step mechanism used by an optional browser handoff.
 */
export class TeamAccountClient extends Service {
  static inject = ['credentials']

  static Config: z<Config> = z.object({
    ...controlPlaneConfigFields,
    callbackUri: z.string().required(),
    runnerVersion: z.string().required(),
    refreshLeadMs: z.natural().default(60_000),
  })

  /** The verifier for the transaction currently awaiting confirmation. */
  private pendingVerifier: string | undefined

  /** The fetch every call below goes through, carrying this deployment's trust. */
  private readonly fetch: ControlPlaneFetch

  constructor(ctx: Context, public config: Config) {
    super(ctx, 'teamAccountClient')
    this.fetch = controlPlaneFetch(ctx, config.controlPlaneCa)
  }

  /**
   * Open a binding transaction and return what the local pairing page shows.
   *
   * The PKCE verifier stays in this process: it is written nowhere, so a
   * transaction cannot be completed by anything that reads this computer's
   * disk without also being this Runner.
   * @returns the pairing code to display, the Control Plane address to send the member to, and the transaction id.
   */
  async begin(): Promise<BindingHandle> {
    const key = await readDeviceKey(this.ctx.credentials, generateKeyPairSync)
    const verifier = newSecret()
    const started = await this.post<{ transactionId: string; pairingCode: string; expiresAt: number }>(
      START_PATH,
      {
        publicKey: key.publicKey,
        platform: platformWord(process.platform),
        runnerVersion: this.config.runnerVersion,
        pkceChallenge: pkceChallenge(verifier),
        callbackUri: this.config.callbackUri,
        protocolVersion: PROTOCOL_VERSION,
      },
    )
    this.pendingVerifier = verifier
    return {
      transactionId: started.transactionId as TransactionId,
      pairingCode: started.pairingCode,
      expiresAt: started.expiresAt,
      confirmUrl: new URL(`/team/confirm/${started.transactionId}`, this.config.controlPlaneUrl).href,
    }
  }

  /**
   * Authenticate a member and bind this Runner without opening the Control Plane in a browser.
   * @param loginName - the organization-local account name typed on the Runner.
   * @param secret - the account password typed on the Runner.
   * @returns the state this installation is now in.
   * @throws {ControlPlaneRefusedError} when authentication or binding is refused.
   */
  async signIn(loginName: string, secret: string): Promise<TeamAccountState> {
    const pending = await this.begin()
    const issued = await this.post<LoginSuccess>(LOGIN_PATH, {
      transactionId: pending.transactionId,
      loginName,
      secret,
      protocolVersion: PROTOCOL_VERSION,
    })
    return this.complete(pending.transactionId, issued.code, issued.member)
  }

  /**
   * Redeem the code the browser carried back, and keep the credential.
   * @param transactionId - the transaction the code belongs to.
   * @param code - the one-time authorization code.
   * @param member - authenticated member identity returned by a local sign-in.
   * @returns the state this installation is now in.
   * @throws {NotBoundError} when no transaction is awaiting confirmation in this process.
   * @throws {ControlPlaneRefusedError} when the Control Plane refused the redemption.
   */
  async complete(
    transactionId: TransactionId,
    code: string,
    member?: TeamMemberIdentity,
  ): Promise<TeamAccountState> {
    const verifier = this.pendingVerifier
    // The verifier lives only in the process that opened the transaction, so a
    // Runner restarted mid-binding starts the flow again rather than pretending
    // it can finish one it cannot prove it began.
    if (verifier === undefined) throw new NotBoundError()
    const key = await readDeviceKey(this.ctx.credentials, generateKeyPairSync)
    const issued = await this.post<IssuedCredential>(REDEEM_PATH, {
      transactionId,
      code,
      pkceVerifier: verifier,
      deviceSignature: sign(null, Buffer.from(redeemSigningInput(transactionId, code)), key.privateKey)
        .toString('base64url'),
      callbackUri: this.config.callbackUri,
      protocolVersion: PROTOCOL_VERSION,
    })
    this.pendingVerifier = undefined
    await writeCredential(this.ctx.credentials, issued, member)
    return {
      bound: true,
      deviceId: issued.deviceId,
      familyId: issued.familyId,
      ...(member === undefined ? {} : { member }),
    }
  }

  /**
   * What this installation currently holds.
   * @returns whether it is bound, and to which device and family.
   */
  async state(): Promise<TeamAccountState> {
    const stored = await readCredential(this.ctx.credentials)
    return stored === undefined
      ? { bound: false }
      : {
        bound: true,
        deviceId: stored.deviceId,
        familyId: stored.familyId,
        ...(stored.member === undefined ? {} : { member: stored.member }),
      }
  }

  /**
   * An access token that will still be valid when it arrives, refreshing first
   * when the stored one is close enough to lapsing to lose the race.
   * @returns the access token to present to a company-resource entry.
   * @throws {NotBoundError} when this computer holds no credential.
   * @throws {ControlPlaneRefusedError} when the refresh was refused, including after a replay revoked the family.
   */
  async accessToken(): Promise<string> {
    const stored = await readCredential(this.ctx.credentials)
    if (stored === undefined) throw new NotBoundError()
    if (Date.now() + this.config.refreshLeadMs < stored.accessExpiresAt) return stored.accessToken
    const key = await readDeviceKey(this.ctx.credentials, generateKeyPairSync)
    const issued = await this.post<IssuedCredential>(REFRESH_PATH, {
      familyId: stored.familyId,
      refreshToken: stored.refreshToken,
      deviceSignature: sign(
        null,
        Buffer.from(refreshSigningInput(stored.familyId, stored.refreshToken)),
        key.privateKey,
      ).toString('base64url'),
    })
    await writeCredential(this.ctx.credentials, issued, stored.member)
    return issued.accessToken
  }

  /**
   * Forget the team credential, keeping the device key, the workspaces, and the
   * sessions. The computer stays the same computer; it just stops holding a
   * team account.
   */
  async signOut(): Promise<void> {
    await this.ctx.credentials.deleteRecord(TEAM_CREDENTIAL_RECORD)
  }

  /** POST one JSON body to the Control Plane and read one JSON answer. */
  private async post<T>(path: string, body: unknown): Promise<T> {
    const response = await this.fetch(new URL(`/team/device${path}`, this.config.controlPlaneUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const answer = await response.json() as Record<string, unknown>
    if (response.ok) return answer as T
    if (response.status === 426) {
      // The range travels with the refusal, because this Runner cannot ask for
      // it through a protocol the other side has just said it does not speak.
      throw new ProtocolUnsupportedError(
        typeof answer.minimum === 'number' ? answer.minimum : PROTOCOL_VERSION,
        typeof answer.current === 'number' ? answer.current : PROTOCOL_VERSION,
      )
    }
    // A refusal names the seam's word when the Control Plane sent one; anything
    // else is a body this Runner has no agreement about.
    const reason = [answer.reason, answer.error].find(value => typeof value === 'string')
    throw new ControlPlaneRefusedError(reason ?? 'unknown', response.status)
  }
}

export default TeamAccountClient

/** Identifies the device this installation binds as, once bound. */
export type { DeviceId, FamilyId }
