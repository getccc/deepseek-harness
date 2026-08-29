# Team handoff

English | [中文](team-handoff.zh.md)

The handoff is how a member gets from the company site into the application running on their own computer. Three packages carry it: [`dsh-team-control-plane-http`](../../packages/team/team-control-plane-http) serves the Control Plane's Runner-facing binding endpoints, [`dsh-team-account-client`](../../packages/team/team-account-client) (`ctx.teamAccountClient`) holds the device key and the credential on the member's computer, and [`dsh-team-local-handoff`](../../packages/team/team-local-handoff) serves the three local addresses a browser navigates to. Design record: [team handoff Agent Note](../../.agents/notes/implemented/architecture/2026-08-30-the-handoff-is-navigation-not-a-tunnel.md).

## What crosses the network, and what does not

The member's workspace, their sessions, their terminal output, and their diffs never leave their computer. The Control Plane sees a public key, a platform word, a Runner version, and the credentials it issues. What the Runner receives is a refresh token for its own device — never a company provider credential.

The site is the habitual entry, not a checkpoint. A member who opens the local address directly gets the same application, which is what keeps the product usable when the Control Plane is unreachable.

## Three local addresses

| Path | What it does |
|---|---|
| `/team/start` | Opens a binding transaction and shows the pairing code to compare |
| `/team/open` | The daily entry: unlock, silently re-issue, or send the member to bind |
| `/team/callback` | Where the Control Plane sends the browser back with an authorization code |

They are reached by navigating and nothing else: each answers 405 unless the request is a top-level document navigation. They carry no RPC, read no request body, and reach no Host capability, so the browser-trust fence that guards `/api` has nothing to guard here.

The paths are fixed rather than configurable, because a Control Plane registers its redirect target against them — a deployment that renamed one would break every already-bound computer.

## The callback answers 200, not a redirect

This is the part that has to be exactly right, and the obvious version does not work.

The local session cookie is `SameSite=Strict`. The navigation that reaches `/team/callback` was started by the company site, which is a different site. A browser withholds a Strict cookie from every request in a cross-site navigation chain — including the request a redirect would produce. Setting the cookie and answering 303 lands the browser on the application **without** it, and the application answers 401.

So the callback answers 200 with the cookie and a page that navigates itself. That navigation is started by the local document, which makes it same-site, and the cookie travels with it. The page uses `location.replace`, with a `noscript` refresh and a visible link so a member with scripting disabled still arrives.

## The local state binds the callback to the pairing page

`/team/start` mints a random state, puts it on the Control Plane link, and keeps it in this process. `/team/callback` refuses unless the state matches. That is what stops a link someone else assembled from binding this computer to their account.

It is **not** what stops a replay — the Control Plane's authorization code is one-time, and that is what refuses a second callback carrying it. The state survives a failed completion on purpose: spending it there would turn a moment of Control Plane trouble into a full restart for the member.

Living only in this process is deliberate. A Runner restarted mid-binding refuses the callback rather than accepting one it cannot tie to a page it served.

## Returning, and re-locking

A browser that already holds the session gets a redirect to the application with no Control Plane round trip at all. A browser that lost it, on a computer that is still bound, gets the session re-issued with no pairing code — the computer is already this member's. Only an unbound computer is sent back to `/team/start`.

Signing out forgets the credential and keeps the device key, the workspaces, and the sessions: the computer is still the same computer, it just stops holding a team account.

## The Runner-facing endpoints take no session

`POST /team/device/start`, `/redeem`, and `/refresh` are authorized by what the Runner can prove, not by who is logged in: a PKCE verifier, a device signature, and a one-time code. Opening a transaction proves nothing and learns nothing, which is why it needs nothing.

Each body is parsed into the [seam's](device-authorization.md) own request before the seam sees it. The seam's types are a promise its callers keep, and a caller that arrived over HTTP has made no such promise.

The browser-facing half — reading a pending transaction and confirming it — needs a Control Plane session and belongs to the Team Shell.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxteamaccountclient--teamaccountclient"></a>

### `ctx.teamAccountClient` — `TeamAccountClient`

The team account as this computer holds it.

Binding is two steps with a person in between: `begin` opens a transaction and returns what the local pairing page shows, and `complete` runs only after the member confirmed on the Control Plane and the browser came back with a code.

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
 * Redeem the code the browser carried back, and keep the credential.
 * @param transactionId - the transaction the code belongs to.
 * @param code - the one-time authorization code.
 * @returns the state this installation is now in.
 * @throws {NotBoundError} when no transaction is awaiting confirmation in this process.
 * @throws {ControlPlaneRefusedError} when the Control Plane refused the redemption.
 */
async complete(transactionId: TransactionId, code: string): Promise<TeamAccountState>

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
