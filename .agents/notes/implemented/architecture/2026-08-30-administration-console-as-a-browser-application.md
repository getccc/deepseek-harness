# Agent Note: The administration console is a browser application

Status: implemented

English | [中文](2026-08-30-administration-console-as-a-browser-application.zh.md)

Supersedes the presentation decision in [the server-rendered console note](../feature/2026-08-30-control-plane-administration-console.md); the governed resources, the permissions each route asks, and the catalog refusals recorded there are unchanged.

## Problem

The server-rendered console reached the limit of what forms and full-page reloads express. Every act is a POST and a redirect, so a suspension and a rename cost the same round trip as loading the page again; a table cannot be filtered without a new address; a dialog cannot exist at all, so creating a member and confirming a destructive act look identical. Its copy is also English-only and embedded in the markup, which puts a second language out of reach without templating every page.

## Decision

Administration is a React and Ant Design application, built by `apps/team-admin` and served by the Control Plane at `/team/admin`. It talks to one thing: `dsh-team-admin-api`, a JSON surface under `/team/api` that asks the same three questions each form post asked — a session, this site's `Origin`, and the CSRF value that session derives — before it asks the service that owns the record, and leaves the same audit row.

**The application decides what to show; it decides nothing about what is allowed.** `GET /team/api/session` answers the `resourceType|action` pairs the member holds so a control nobody could use is left out. Every route then asks access control again. A build that showed a button it should not have still gets a refusal.

**Every collection is a table, and every create, edit, and destructive act is a dialog.** A write answers with the collection it changed, so the table updates from the answer rather than from a second read that would already be a round trip stale.

**Copy is locale-owned, the way the browser client's is.** `zh` is the key-set source of truth and `en` mirrors it, so a key present in one dictionary and missing from the other is a type error rather than a blank label. The choice is this browser's, kept in `localStorage`: a display preference on one machine is not something an organization decides for a member, and the Control Plane has no reason to store it.

**Confirming a computer stays a server-rendered page.** A member arrives there from a link their own Runner served, to compare a code and press one button. An application would have to load before it could show them the thing they came to check. `dsh-team-shell` is now that page and nothing else; the session rules both surfaces share moved to `dsh-team-browser-session`.

## Alternatives considered

**Keeping the server-rendered console and styling it to match.** Rejected after it was built and used: the appearance was reachable, but modal confirmation, in-place table updates, and a second language each needed machinery that a form-and-redirect page does not have, and the sum of that machinery is an application written badly.

**A single application covering the confirmation page too.** Rejected because that page's whole job is to be readable the instant a cross-site navigation lands on it, and it is the one page whose failure means a member cannot connect a computer at all.

**Serving the console from a separate process.** Rejected because the Control Plane already terminates the session the console runs under, and a second listener would mean a second address, a second TLS termination, and cookies that have to be scoped across both.

**Storing the language preference per account.** Rejected for now: it is a per-browser display choice, and making it durable means an account field, a settings route, and a decision about what a member sees on a machine that disagrees with it.

## Consequences

An administrator gets the interaction an administration console is expected to have, in either language, over an API that is enforced independently of it. The application is 34 kB beside a 963 kB vendor chunk of React and Ant Design, split so that editing a view re-hashes only the small one.

The Control Plane now serves a built artifact, so `pnpm run build` is a prerequisite for a deployment where it was not before. The console has no client-side routing, so a browser reload returns to the overview rather than the view that was open. Enrollment, first passwords, resource-specific grant creation, pagination, and an audit view remain absent, as they were before.

## Testing

`packages/team/team-admin-api/tests/api.spec.ts` drives the API the way the console drives it and drops each of the three proofs in turn, checking that the store changed nothing. The console's own views are not unit-tested; what they render is the API's answer, and what they may do is what the API allows.
