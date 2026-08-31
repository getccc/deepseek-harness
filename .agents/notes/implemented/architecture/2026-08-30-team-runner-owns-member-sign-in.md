# Agent Note: the Team Runner owns member sign-in

Status: implemented

English | [中文](2026-08-30-team-runner-owns-member-sign-in.zh.md)

## Problem

The Team Runner and the Control Plane serve different people. Ordinary members work in the Runner on loopback, while administrators use the Control Plane to create accounts, compose roles, bind grants, suspend members, revoke devices, and manage company resources. Sending an ordinary member from the Runner to the Control Plane to sign in makes the administration origin part of the member product and contradicts that separation.

The standalone Web application also unlocks through a process token. Reusing that startup behavior for Team would bypass the organization account that access control evaluates, so the Runner needs its own entry before the application can be opened.

## Decision

**The Team Runner serves the account-and-password form on `/team/login`.** Its startup entry is the clean local `/team/open` path, without the standalone Web process token. A locked browser is sent to the local form; an authenticated local browser enters the application. No ordinary-member navigation to the Control Plane is part of this flow.

**The pre-application form and the in-application account launcher are one local feature.** The server-rendered form owns its responsive, bilingual login presentation because the React application is still locked. After entry, the same package replaces the ordinary Settings trigger through the optional `settings.launcher` slot: the sidebar shows the member identity, and its menu opens the existing Settings panel or navigates through the local logout route. That route forgets the process credential, expires the authenticated browser session, and returns directly to `/team/login`. The Settings shell retains panel state and section ownership.

**The password still reaches the Control Plane over the configured origin.** The local page does not verify or store it. `team-account-client` opens a device transaction, sends the login name and password with that transaction to the Runner-facing Control Plane endpoint, and redeems the returned one-time code with the PKCE verifier and a device-key signature. The deployment must protect that origin with TLS outside local development.

**The local form proves its browser origin before reading the password.** A normal `Origin` must match the Runner authority. `Referrer-Policy: no-referrer` can make the browser send `Origin: null`, which is accepted only with the browser-controlled `Sec-Fetch-Site: same-origin`; a missing or cross-site classification is refused.

**Every successful sign-in creates a fresh device credential family.** Rebinding the same physical key revokes its older families before the new one is issued. This prevents an older token from observing a later account assignment through the mutable device row.

**Successful local sign-in carries only public member identity back to the Runner.** The Control Plane login response includes the login name and display name beside the one-time code. The Runner stores those fields with its device credential, preserves them across refresh, and exposes them at `/team/account` only to an authenticated local browser session. Passwords, device keys, refresh tokens, and access tokens never enter the browser response.

**The Control Plane browser application is an administration surface.** Password authentication alone does not create an administration session. The account must also hold `organization.admin.access`, and every later administration request rechecks that permission before checking its action-specific grant. The default Control Plane composition contains no member confirmation page.

**Account status participates in every access decision.** A missing, cross-organization, or suspended principal receives `default-deny` even if role bindings and a device token still exist. Suspending a member therefore stops company-resource use immediately at the authorization point; the system does not depend on waiting for a token to expire.

This decision replaces the company-site navigation flow in [the earlier handoff note](2026-08-30-the-handoff-is-navigation-not-a-tunnel.md) as the default Team composition. The old handoff package remains an uncomposed optional package during the pre-release transition; its callback details do not describe the shipped member entry.

## Alternatives considered

**Keep member authentication on port 3095 and hide the administration controls after sign-in.** Rejected because ordinary members would still see and depend on the administration origin, and authentication would remain coupled to a browser route the Runner does not own.

**Send the password directly from browser JavaScript to the Control Plane.** Rejected because that requires cross-origin browser policy and makes the administration origin visible to the ordinary-member client. The Runner already owns the device key and binding protocol, so it owns the authentication call as well.

**Read the member name from the Control Plane in the browser.** Rejected because the sidebar would acquire a cross-origin administration dependency and a second browser authentication mechanism. The Runner already receives authoritative identity during local sign-in and can expose the two display fields under its existing local session.

**Add the account control beside the Settings trigger.** Rejected because two bottom controls duplicate the settings entry and do not match the account-menu interaction. An optional launcher slot lets Team replace only the trigger while retaining the settings panel and every contributed section.

**Treat a valid device token as sufficient after an administrator suspends the account.** Rejected because account status is an administrator-controlled authorization input. Waiting for expiry would create a period in which the console says the member is suspended while gateways still admit them.

## Consequences

Deployments supply the same organization ID to both `team-control-plane-http` and `team-admin-api`. The first uses it as the member account namespace; the second uses it as the administration namespace. Boot fails rather than guessing either value.

The default profile boundaries are visible in the browser: ordinary members use port 3090, administrators use port 3095, and standalone `dsh web` remains on port 3080 with its process-token unlock. Network isolation for 3095 remains a deployment responsibility in addition to the application permission check.

One Runner process still holds one active team credential. Signing in again replaces that credential for every browser using the process. Per-browser multi-account use requires a different credential-custody design and is not implied by this change.

The optional browser-handoff binding does not authenticate through the local login response, so it can hold a device credential without member display fields. In that composition the launcher uses a neutral team-member label while retaining Settings and sign-out actions.
