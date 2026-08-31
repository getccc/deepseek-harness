# Agent Note: the handoff is navigation, and the callback cannot be a redirect

Status: implemented

English | [中文](2026-08-30-the-handoff-is-navigation-not-a-tunnel.zh.md)

## Problem

A member should be able to open the company site, log in, and be working — while the workspace they open, the commands they run, and the files they change all stay on their own computer. The obvious way to give that experience is to proxy the application through the server: one URL, one session, nothing to install a mental model for.

That version puts every file read, every diff, and every line of terminal output through the company server. Even without storing any of it, the server becomes the place all of it passes through, which is the opposite of what the product promises.

The second problem is smaller and much sharper. Once the browser is going to end up on a local address, something has to give it a session there, and the natural implementation of that step does not work.

## Decision

This navigation flow remains available through the uncomposed `team-local-handoff` package, but it is no longer the default Team entry. [The Team Runner member-sign-in decision](2026-08-30-team-runner-owns-member-sign-in.md) owns the shipped default in which members stay on port 3090 and the Control Plane is administrator-only. The callback and proxying rationale below remains the authority if a deployment deliberately composes the optional handoff.

**The site is an entry, not a data path.** It authenticates the member, confirms which computer they are at, and hands the browser to a local address. From that point the address bar shows loopback and nothing further crosses the network except company-resource calls the member's work explicitly makes.

The site is also habitual rather than required: opening the local address directly reaches the same application. That is what keeps a member working when the Control Plane is unreachable, and it is why the local entry must never be removed from the documentation.

**`/team/callback` answers 200 with a self-navigating page, not a redirect.** The local session cookie is `SameSite=Strict`. The navigation that reaches the callback was started by the company site, and a browser withholds a Strict cookie from *every* request in a cross-site navigation chain — including the request a redirect produces. Setting the cookie and answering 303 lands the browser on the application without it, and the application answers 401.

The page uses `location.replace`, which is the path verified against a real browser, with a `noscript` refresh and a visible link so a member with scripting disabled still arrives. The navigation the page starts is same-site, so the cookie travels with it.

**Three fixed local addresses, reached by navigating and nothing else.** They carry no RPC, read no request body, and reach no Host capability, so the browser-trust fence that guards `/api` has nothing to guard here; each answers 405 unless the request is a top-level document navigation. The paths are not configurable because a Control Plane registers its redirect target against them.

**The local state binds the callback to the pairing page, and nothing more.** It stops a link someone else assembled from binding this computer to their account. It does not stop a replay — the authorization code is one-time at the Control Plane, which is what refuses a second callback carrying it. The state survives a failed completion deliberately: spending it there would turn a moment of Control Plane trouble into a full restart for the member.

**The optional handoff's Runner-facing calls take no browser session,** because none of them is authorized by one. Opening a transaction proves nothing and learns nothing; redeeming and refreshing are authorized by a PKCE verifier, a device signature, and a one-time code. The shared HTTP package now also carries the default Runner password-authentication call. Each body is parsed before the owning service sees it, because same-process types are a promise an HTTP caller has not made.

## Alternatives considered

**Proxying the application through the server.** Rejected as described: it makes the server the path for all code content, which no amount of "we do not store it" repairs.

**A redirect from the callback.** Rejected because it does not work, not because of taste. This was verified against a real browser before the code was written, and the failure is silent: the redirect succeeds, the application loads, and the session simply is not there.

**A meta refresh instead of a script.** Kept only as the `noscript` fallback. `location.replace` is the path that was actually verified; the fallback is there so a member without scripting is not left on a blank page.

**Spending the local state on every callback, valid or not.** Rejected: it buys nothing, because the code is already one-time at the Control Plane, and it costs a member a full restart whenever the Control Plane hiccups.

**Letting the endpoints hand the seam the parsed body directly.** Rejected: `platform: 'plan9'` would reach a database CHECK and answer 500, and a missing `publicKey` would answer 500 too. A wire boundary that reports the caller's mistake as the server's is a boundary that is not doing its job.

## Consequences

`client-connection` now publishes `browserSession`, a two-method view of the local session: ask whether this browser holds it, and hand it one. Everything else about the cookie stays inside that package, so a second plugin cannot mint a session the package would then have to stay compatible with.

The optional Team Shell owns the browser-facing endpoints that read and confirm a pending transaction. The default Control Plane no longer composes that shell, but deployments retaining this handoff still use its Control Plane session, same-origin, CSRF, and audit checks.

The tests use `node:http` rather than `fetch`. `fetch` overrides `Sec-Fetch-Mode` with its own value, so a test using it cannot present what a real navigation presents, and these endpoints answer on exactly that header. This is worth remembering: the same substitution would silently weaken any future test of a navigation-only endpoint.
