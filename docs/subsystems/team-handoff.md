# Team sign-in

English | [中文](team-handoff.zh.md)

Ordinary members sign in on the Team Runner at port 3090. Administrators use the Control Plane at port 3095. The default flow never navigates a member browser to the Control Plane: [`dsh-team-local-login`](../../packages/team/team-local-login) owns the local account form, [`dsh-team-account-client`](../../packages/team/team-account-client) owns the device key and credential, and [`dsh-team-control-plane-http`](../../packages/team/team-control-plane-http) authenticates the account and issues the device-bound credential. Design record: [Team Runner member sign-in Agent Note](../../.agents/notes/implemented/architecture/2026-08-30-team-runner-owns-member-sign-in.md).

## The two browser surfaces serve different people

| Address | User | Purpose |
|---|---|---|
| `http://127.0.0.1:3090/team/open` | Ordinary member | Local login and the Runner application |
| `https://control-plane.example/team/admin/` | Administrator | Accounts, roles, grants, devices, audit, and company resources |

Standalone `dsh web` remains on port 3080 and uses its process-token unlock. Team does not reuse that shortcut: its Web runtime opens the clean `/team/open` path, and a locked browser is redirected to `/team/login`.

Application authorization is not a substitute for deployment isolation. Production deployments should expose 3095 only through their administrator network or reverse proxy and terminate TLS there.

## One local login becomes one device credential

1. The Runner opens a device transaction and keeps the PKCE verifier in memory.
2. The local form sends the account and password to the Runner. The Runner forwards them with the transaction to the configured Control Plane origin.
3. The Control Plane verifies the active account, records the authentication event, and approves the transaction with that audit reference.
4. The Runner redeems the one-time code using the PKCE verifier and a signature from its device key.
5. The Runner stores the refresh and access tokens through its credential provider, then the local browser-session service unlocks the application.

The password is not stored on the Runner, but it does cross the Runner-to-Control-Plane connection. TLS is therefore required outside local development. Company provider credentials never travel in the other direction: the Runner receives only its device credential.

A later successful sign-in with the same device key revokes that device's older credential families before issuing the replacement. One Runner process holds one active team account; signing in again changes the account for every browser using that process.

## Three fixed local routes

| Path | What it does |
|---|---|
| `/team/open` | Opens the application for an authenticated local browser, otherwise redirects to login |
| `/team/login` | Serves and accepts the account-and-password form |
| `/team/logout` | Forgets the team credential, then delegates local cookie removal to `/lock` |

`/team/open` does not silently mint a browser session from a stored team credential. A new or locked browser must authenticate, which prevents a second browser on a shared computer from inheriting the process account merely by opening the port.

The login form requires an exact same-origin submission, accepts a bounded URL-encoded body, and gives wrong, unknown, locked, and suspended accounts the same refusal. It is server-rendered because the application assets are unavailable before the local session is established.

## The Control Plane is administrator-only

The administration API verifies both the password and `organization.admin.access` before creating a browser session. Every later request rechecks that entry permission and then checks the action-specific grant, such as `member.disable` or `model.catalog.manage`. Removing the entry grant therefore ends console access even if the browser still carries a session cookie.

The default Control Plane bundle does not compose `team-shell` or any member confirmation page. A deployment supplies the same `organizationId` to `team-control-plane-http` for member authentication and to `team-admin-api` for administration; both rows fail rather than guessing it.

## Suspension is checked where access is decided

Access control requires the principal to exist in the requested organization and have status `active` before roles and grants are evaluated. A suspended account receives `default-deny` even while an older device access token and role bindings still exist. Gateways therefore stop admitting company-resource use immediately instead of waiting for token expiry.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxteamaccountclient--teamaccountclient"></a>

### `ctx.teamAccountClient` — `TeamAccountClient`

The team account as this computer holds it.

The default `signIn` flow authenticates the Runner-local form through the Control Plane and binds the device without navigating there. `begin` and `complete` retain the two-step mechanism used by an optional browser handoff.

```ts cordis-catalog
/**
 * Open a binding transaction and return what the local pairing page shows.
 *
 * The PKCE verifier stays in this process: it is written nowhere, so a
 * transaction cannot be completed by anything that reads this computer's
 * disk without also being this Runner.
 * @returns the pairing code to display, the Control Plane address to send the member to, and the transaction id.
 */
async begin(): Promise<BindingHandle>

/**
 * Authenticate a member and bind this Runner without opening the Control Plane in a browser.
 * @param loginName - the organization-local account name typed on the Runner.
 * @param secret - the account password typed on the Runner.
 * @returns the state this installation is now in.
 * @throws {ControlPlaneRefusedError} when authentication or binding is refused.
 */
async signIn(loginName: string, secret: string): Promise<TeamAccountState>

/**
 * Redeem the code the browser carried back, and keep the credential.
 * @param transactionId - the transaction the code belongs to.
 * @param code - the one-time authorization code.
 * @param member - authenticated member identity returned by a local sign-in.
 * @returns the state this installation is now in.
 * @throws {NotBoundError} when no transaction is awaiting confirmation in this process.
 * @throws {ControlPlaneRefusedError} when the Control Plane refused the redemption.
 */
async complete( transactionId: TransactionId, code: string, member?: TeamMemberIdentity, ): Promise<TeamAccountState>

/**
 * What this installation currently holds.
 * @returns whether it is bound, and to which device and family.
 */
async state(): Promise<TeamAccountState>

/**
 * An access token that will still be valid when it arrives, refreshing first
 * when the stored one is close enough to lapsing to lose the race.
 * @returns the access token to present to a company-resource entry.
 * @throws {NotBoundError} when this computer holds no credential.
 * @throws {ControlPlaneRefusedError} when the refresh was refused, including after a replay revoked the family.
 */
async accessToken(): Promise<string>

/**
 * Forget the team credential, keeping the device key, the workspaces, and the
 * sessions. The computer stays the same computer; it just stops holding a
 * team account.
 */
async signOut(): Promise<void>
```

Types: [TransactionId](device-authorization.md)

Source: [`packages/team/team-account-client/src/index.ts`](../../packages/team/team-account-client/src/index.ts)
<!-- END GENERATED cordis-surface -->
