# Agent Note: signing in is not being allowed, and a write needs all three

Status: implemented

English | [中文](2026-08-30-signing-in-is-not-being-allowed.zh.md)

## Problem

The Control Plane needs pages: somewhere to sign in, somewhere a member confirms the computer asking to connect, and somewhere an administrator manages members, roles, and devices. The tempting shape is the one every small admin panel has — sign in, and the panel is yours.

That shape collapses two questions into one. "Which member is this?" and "may this member do this?" are answered by different subsystems, and a panel that treats a successful sign-in as permission has no place to put the second answer. It also leaves the audit trail unable to say who did anything, because the panel is what knows the principal and the stores below it do not.

There is a narrower problem underneath. A form post carrying a session cookie is not evidence that the member submitted the form: a browser attaches the cookie to a request another site caused.

## Decision

**Signing in succeeds for any member; every page and every action then asks access control separately.** A member with no grants signs in and can still do nothing, including reading the member list. This is what gives the second question a place to be answered, and it is tested by a member who authenticates successfully and is refused every read and every write.

**Every write needs all three.** A session says who is asking. Same-origin browser metadata says the request came from these pages: an ordinary `Origin` must name the same authority as the request, while an opaque context carrying `Origin: null` must carry the browser-controlled `Sec-Fetch-Site: same-origin`. A CSRF token derived from the session — a different value from the cookie — says the form was one this session rendered. Any proof missing is a refusal.

Deriving the CSRF token rather than storing it means there is no second record to keep in step with the session, and it is not the cookie's own value, so carrying the cookie is not by itself enough.

**The HTTP surface that authenticates writes the audit record,** because it is what knows the principal and authentication method. The Runner-facing account endpoint records ordinary member authentication, while the administration API records console authentication. A store that creates a role has no principal, no device, and no correlation to record.

**A failed sign-in records no account.** Which of "no such member", "wrong password", and "locked" it was is what an attacker wants, so the page answers one message for all three, and the record names none. Recording the account would turn the trail into a list of which login names exist.

**The session cookie is `SameSite=Lax`.** A member reaches the confirmation page from a link on the pairing page their own Runner served, which is a cross-site top-level navigation. `Strict` would withhold the session there and ask them to sign in again for no reason. This is the mirror of the Runner-side decision, where the local cookie stays `Strict` and the callback answers with a self-navigating page instead of a redirect.

**Suspending a member is the whole act.** A session resolves through its account, and a suspended account holds none. Nothing has to remember to end their sessions as well, and nothing that forgot could leave a suspended member signed in.

## Alternatives considered

**A signed session cookie carrying the member's identity.** Rejected: revocation would then mean waiting for the signature to lapse, and suspending a member would not take effect until it did. An opaque token with its hash in the store makes ending a session immediate, and makes the account status part of resolving it.

**Storing a CSRF token beside the session.** Rejected: a second record that must stay in step with the first, for a value that is a pure function of the first.

**Refusing a write on the CSRF token alone, without browser-origin metadata.** Rejected: they fail differently. A token check refuses a forged form; browser metadata refuses a request from a page that never rendered a form at all, including one that guessed a token would not be needed.

**Letting a store failure answer 400 with the refusal text.** Rejected after the coverage gate exposed it: the fallback branch was reachable only for a failure that carried no refusal word, and it told the member their request was unrecognized. A store problem now answers 500 and records `outcome: 'error'`, because a record saying the member was refused when they were not is worse than no record.

**Trusting the rendered form to supply every field.** Rejected after a test showed an empty login name reaching the store and being stored. Each action now names the fields it cannot proceed without, and a form missing one is refused before anything is written.

## Consequences

The account store gained browser sessions: `createBrowserSession`, `resolveBrowserSession`, and `revokeBrowserSession`, with `SCHEMA_VERSION` at 2. The table is additive and every statement is `CREATE ... IF NOT EXISTS`, so an existing database gains it on the next open — which corrects a README that claimed the first schema change would need a migration path it does not.

`revokeUserBrowserSessions` was written and then removed: suspending a member already ends their sessions through the status check, so the explicit call changed no outcome, and a seam method with no caller is a surface with nobody to keep it correct.

Grant editing has no page. Roles can be created and bound, but what a role carries is set through the access-control service. An administrator who needs to change grants today does it there, and the page for it needs its own design — a role's grants are the sharpest thing in the product to get wrong from a form.
