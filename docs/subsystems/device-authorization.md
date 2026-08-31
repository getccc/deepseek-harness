# Device authorization

English | [中文](device-authorization.zh.md)

Device authorization turns a successful member authentication into a long-lived credential on one computer, and nowhere else. The approval may come from the optional Control Plane browser handoff or the default audited Runner password flow. The subsystem is one seam — [`dsh-device-authorization`](../../packages/account/device-authorization) (`ctx.deviceAuthorization`) with the [`dsh-device-authorization-sqlite`](../../packages/account/device-authorization-sqlite) backend — and it is server-side only: the Control Plane composes it, no Runner mounts it, and models never see it. Design record: [device binding Agent Note](../../.agents/notes/implemented/architecture/2026-08-29-device-binding-proves-possession.md).

## What the flow establishes

A Runner generates an Ed25519 key pair at first start and keeps the private half on that computer. Binding proves three separate things, and refuses unless all three hold:

1. **A member approved it.** Confirmation happens on the Control Plane, under an authenticated session, which is where the organization and the account come from.
2. **The member approved *this* computer.** They compare a pairing code and a public-key digest between the local page and the Control Plane page.
3. **The computer holds the key they compared.** Redemption requires a signature from the private key behind that digest.

A transaction carries no account until step 1, so opening one teaches an unauthenticated caller nothing.

## The pairing code is for a person

`XXXX-XXXX` from an alphabet with no vowels and no `0`, `O`, `1`, `I`, or `L`. No vowels means a code cannot spell a word the eye completes instead of reading; the excluded pairs are the ones that look alike in whatever font a browser picks.

It does not have to resist guessing on its own. Confirming already requires an authenticated Control Plane session, and the transaction expires in minutes.

## The authorization code binds everything it can

The code is stored only as a hash, and redeeming it is refused unless the PKCE verifier hashes to the challenge that opened the transaction, the device signature verifies against the stored public key, and the callback address and protocol version match what was bound. Its lifetime is capped at 60 seconds by the build: the code travels one redirect, and a longer window buys an attacker time rather than buying a member anything.

The signed bytes name both the transaction and the code, so a signature captured from one redemption proves nothing about another. The code itself is not in the signed string — a leaked signature would otherwise carry the code that made it.

## Refresh-token families

Redemption opens a family and mints its first refresh and access token. Refreshing spends one refresh token and mints the next.

**Presenting a spent refresh token revokes the whole family.** Either the token leaked or the Runner lost track of it, and the two cannot be told apart, so both are answered by making every credential in the family useless — a thief and the rightful holder end up equally unable to continue, which is the outcome that leaves the member no choice but to bind again.

## Revocation reaches every family

Revoking a device revokes every family it ever opened, including families from an earlier binding of the same key. Readers check only the family, so this is what makes a revoked device unable to obtain tokens; the two halves are one operation for that reason.

Rebinding the same key keeps one device row rather than accumulating identities, so an administrator revoking a computer revokes the computer.

## Access tokens carry no authorization

A token says which organization, which account, and which device. It does not carry roles, grants, or scopes. Company-resource entries authorize each request against the [policy revision](access-control.md) current at the time of the request, so a role change takes effect without waiting for a token to expire.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxdeviceauthorization--deviceauthorization-abstract-seam"></a>

### `ctx.deviceAuthorization` — `DeviceAuthorization` (abstract seam)

Device binding, the credentials it produces, and the device registry it fills. A provider mounts this service; consumers inject `deviceAuthorization`.

Nothing here authorizes anything: a credential proves which device and which account a request comes from, and access control decides what that principal may do, against the policy revision current at the time of the request.

```ts cordis-catalog
/**
 * Open a binding transaction. The request carries no account: a transaction
 * belongs to nobody until a member confirms it from an authenticated session,
 * so an unauthenticated caller learns nothing by opening one.
 * @param request - the device's public key, platform, PKCE challenge, and fixed callback.
 * @returns the transaction id, the pairing code to display locally, and when it lapses.
 */
abstract start(request: StartRequest): Promise<StartedTransaction>

/**
 * Read what a confirmation page must show before a person confirms.
 * @param id - the transaction the member's browser was sent to.
 * @returns the device facts and the pairing code to compare against the local page.
 * @throws {TransactionRefusedError} when it is unknown, lapsed, or already confirmed.
 */
abstract describe(id: TransactionId): Promise<PendingTransaction>

/**
 * Confirm a transaction, minting the one-time code the browser carries back.
 * @param id - the transaction being confirmed.
 * @param approval - who is confirming, from an authenticated Control Plane session.
 * @returns the plaintext code, its lifetime, and the bound callback address.
 * @throws {TransactionRefusedError} when it is unknown, lapsed, or already confirmed.
 */
abstract confirm(id: TransactionId, approval: Approval): Promise<IssuedCode>

/**
 * Turn an authorization code into a device and its first credential. The
 * device row is created here, because until this point no one has proved
 * possession of the private key behind the digest the member compared.
 * @param request - the code, the PKCE verifier, the device signature, and the bound callback and version.
 * @returns the device, its credential family, and the first refresh and access tokens.
 * @throws {CredentialRefusedError} when any bound fact fails to match.
 */
abstract redeem(request: RedeemRequest): Promise<IssuedCredential>

/**
 * Exchange a refresh token for the next one and a fresh access token.
 *
 * Presenting a refresh token that was already spent revokes the whole family:
 * either the token leaked or the Runner lost track of it, and both are
 * answered by making every credential in that family useless.
 * @param request - the family, the refresh token, and a device signature over both.
 * @returns the next credential pair.
 * @throws {CredentialRefusedError} when the token is unknown, lapsed, reused, or the device is revoked.
 */
abstract refresh(request: RefreshRequest): Promise<IssuedCredential>

/**
 * Resolve an access token to what it stands for.
 * @param token - the plaintext access token a Runner presented.
 * @returns the claims, or undefined when the token is unknown, lapsed, or its device is revoked.
 */
abstract verifyAccessToken(token: string): Promise<AccessTokenClaims | undefined>

/**
 * List an organization's devices in binding order.
 * @param orgId - the organization to list.
 * @returns every device the organization holds, revoked ones included.
 */
abstract listDevices(orgId: OrgId): Promise<Device[]>

/**
 * Revoke a device and every credential family it holds. Revoking one that is
 * already revoked is not an error: the caller's intent is that it be gone.
 * @param id - the device to revoke.
 */
abstract revokeDevice(id: DeviceId): Promise<void>

/**
 * Revoke one credential family, leaving the device able to bind again.
 * @param id - the family to revoke.
 */
abstract revokeFamily(id: FamilyId): Promise<void>
```

Types: [OrgId](account.md)

Source: [`packages/account/device-authorization/src/index.ts`](../../packages/account/device-authorization/src/index.ts)
<!-- END GENERATED cordis-surface -->
