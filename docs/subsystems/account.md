# Accounts

English | [中文](account.zh.md)

An account is who a member is: a login name unique inside one organization, a display name, a status, and the counters a sign-in policy reads. The subsystem is one seam — [`dsh-account-store`](../../packages/account/account-store) (`ctx.accountStore`) with the [`dsh-account-store-sqlite`](../../packages/account/account-store-sqlite) backend — and it is server-side only: the Control Plane composes it, no Runner mounts it, and models never see it (no tools, no prompt text, no session events). Design record: [account store seam Agent Note](../../.agents/notes/implemented/architecture/2026-08-29-account-store-seam.md).

## What the store owns, and what it does not

The store is a repository. It records what happened, reports conflicts as named failures, and decides nothing. Whether five consecutive failures mean a lockout, how long a lock lasts, and what an encoded password hash contains all belong to the authentication provider that reads and writes through it.

That split is deliberate. Authentication material is reachable only through `getPasswordHash` and `setPasswordHash`, never as a field on the account record, and the store treats the value as opaque bytes — it does not parse, compare, or derive anything from it. Replacing password sign-in with an external identity provider therefore changes which provider is mounted, not the stored accounts, roles, or devices.

## An issued account cannot yet sign in

`createUser` stores identity only: the account carries no authentication material and `mustChangePassword` is set. An administrator cannot create a usable account on a member's behalf, because clearing that flag is what `setPasswordHash` does — the member choosing a secret is the only path to a signed-in account.

## Sign-in state

`recordFailedLogin` returns the consecutive failure count; `lockUser` refuses sign-in until a moment the caller passes and resets the count, so the next lockout needs a fresh run of failures; `recordSuccessfulLogin` clears both and stamps the moment. Every one of these records a decision the authentication provider already made.

## Ordering and identity

`listUsers` returns accounts in insertion order taken from the backend's own row identity, not from `createdAt`: two accounts issued in the same millisecond share a timestamp, and a backward clock step would order them wrongly.

`OrgId` and `UserId` are branded strings, so an organization id cannot be passed where an account id belongs.

## Consumers

The authentication provider reads and writes sign-in state and password material. Access control resolves a principal to an organization and reads `policyRevision`, which every authorization-affecting change increments in the same transaction as the change itself. Neither exists yet; this seam lands first because both need somewhere to put identity.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxaccountstore--accountstore-abstract-seam"></a>

### `ctx.accountStore` — `AccountStore` (abstract seam)

Durable organizations and member accounts. Every method is a repository operation: it stores or returns records and reports conflicts, and it makes no policy decision of its own. A provider mounts this service; consumers inject `accountStore`.

```ts cordis-catalog
/**
 * Create the organization every other record hangs from.
 * @param name - human-readable organization name.
 * @returns the stored organization, at policy revision zero.
 */
abstract createOrganization(name: string): Promise<Organization>

/**
 * Read one organization.
 * @param id - the organization to read.
 * @returns the organization, or undefined when the store holds none.
 */
abstract getOrganization(id: OrgId): Promise<Organization | undefined>

/**
 * Advance an organization's policy revision, the value authorization caches
 * are keyed by. Callers increment it in the same transaction as the change
 * that invalidated them.
 * @param id - the organization whose revision advances.
 * @returns the revision after the increment.
 * @throws {UnknownOrganizationError} when the store holds no such organization.
 */
abstract bumpPolicyRevision(id: OrgId): Promise<bigint>

/**
 * Issue an account. The account starts active, with no password material and
 * `mustChangePassword` set, so an administrator cannot create a usable
 * account without the member choosing their own secret.
 * @param input - the identity fields an administrator supplies.
 * @returns the stored account.
 * @throws {DuplicateLoginNameError} when the login name is taken in that organization.
 */
abstract createUser(input: CreateAccountUser): Promise<AccountUser>

/**
 * Read one account by id.
 * @param id - the account to read.
 * @returns the account, or undefined when the store holds none.
 */
abstract getUser(id: UserId): Promise<AccountUser | undefined>

/**
 * Resolve a sign-in attempt's login name to an account.
 * @param orgId - the organization the login name belongs to.
 * @param loginName - the name as typed, compared exactly.
 * @returns the account, or undefined when no account carries that name.
 */
abstract findUserByLogin(orgId: OrgId, loginName: string): Promise<AccountUser | undefined>

/**
 * List an organization's accounts in creation order, oldest first.
 * @param orgId - the organization to list.
 * @returns every account the organization holds.
 */
abstract listUsers(orgId: OrgId): Promise<AccountUser[]>

/**
 * Set whether an account may authenticate.
 * @param id - the account to change.
 * @param status - the status to store.
 * @throws {UnknownAccountUserError} when the store holds no such account.
 */
abstract setUserStatus(id: UserId, status: AccountUserStatus): Promise<void>

/**
 * Read the authentication material an account carries, if any.
 *
 * Only the authentication provider calls this. The store treats the value as
 * opaque bytes: it never parses, compares, or derives anything from it, which
 * is what lets a different authentication provider replace the format without
 * touching stored identity.
 * @param id - the account whose material is read.
 * @returns the stored encoded hash, or undefined when the account has none.
 */
abstract getPasswordHash(id: UserId): Promise<string | undefined>

/**
 * Store the authentication material for an account and clear
 * `mustChangePassword`, because choosing a secret is what satisfies it.
 * @param id - the account to change.
 * @param encodedHash - the provider's own encoded hash, stored verbatim.
 * @throws {UnknownAccountUserError} when the store holds no such account.
 */
abstract setPasswordHash(id: UserId, encodedHash: string): Promise<void>

/**
 * Record one failed sign-in and return the resulting consecutive count. The
 * store counts; the authentication provider decides what a count means.
 * @param id - the account that failed to sign in.
 * @returns consecutive failures including this one.
 * @throws {UnknownAccountUserError} when the store holds no such account.
 */
abstract recordFailedLogin(id: UserId): Promise<number>

/**
 * Refuse sign-in until a moment in time, and reset the failure count so the
 * next lockout needs a fresh run of failures.
 * @param id - the account to lock.
 * @param until - epoch milliseconds after which sign-in may be attempted again.
 * @throws {UnknownAccountUserError} when the store holds no such account.
 */
abstract lockUser(id: UserId, until: number): Promise<void>

/**
 * Record a successful sign-in: clear the failure count and any lock, and
 * stamp the moment.
 * @param id - the account that signed in.
 * @param at - epoch milliseconds of the sign-in.
 * @throws {UnknownAccountUserError} when the store holds no such account.
 */
abstract recordSuccessfulLogin(id: UserId, at: number): Promise<void>
```

Source: [`packages/account/account-store/src/index.ts`](../../packages/account/account-store/src/index.ts)
<!-- END GENERATED cordis-surface -->
