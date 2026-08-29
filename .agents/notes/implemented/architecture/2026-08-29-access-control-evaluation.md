# Agent Note: Authorization stays explainable by refusing to be expressive

Status: implemented

English | [中文](2026-08-29-access-control-evaluation.zh.md)

## Problem

Team Edition governs models, MCP servers and tools, knowledge scopes, plugins, skills, members, devices, and usage. The obvious way to express who may touch what is a policy language — conditions, deny rules, inheritance — and every one of those features makes the same question harder to answer: why was this particular request refused?

That question is not academic. An administrator debugging a member's access, an audit row explaining a denial, and a support conversation all need it. A policy engine answers it by replaying evaluation; a list of grants answers it by being read.

Two smaller decisions came with it. Permissions could be strings a database accepts, which makes a typo a silent misconfiguration. And a grant could carry a resource's URL or credentials, which makes rotating either one a grant migration.

## Decision

The evaluation is four rules and nothing else: default deny; a role's grants admit; several roles union; a disabled resource is refused whatever any grant says. There is no explicit deny, no role inheritance, and no expression language. A decision therefore returns the grants that admitted it, and explaining an approval means listing them.

An administrative role is not a master key. `member.create` grants nothing about models, because every permission is granted explicitly and nothing is implied by holding another.

**Permissions are values in code.** `PERMISSION_CATALOG` is a closed set of `(resourceType, action)` pairs; administrators compose roles out of it and cannot invent a permission string. The SQLite backend seeds the catalog into a table and points both grant tables at it with a foreign key, so a grant naming an ungoverned pair cannot be stored even by a caller that reached the database without passing the service — the check exists in the operation that makes the decision *and* in the storage that keeps it.

**Grants name resources by reference.** A resource row is keyed by `(organization, type, external ref)` — the identity a request names — with a surrogate id that a grant points at, so a display name can change and a URL or credential can rotate without touching a single grant. Registering is idempotent because the owning subsystem re-registers its catalog on every start.

**Groups bind in bulk and change no outcome.** Evaluation unions direct and group-derived roles into one set, so a group is an administrator's convenience rather than a second kind of binding the algorithm knows about. A role held both ways counts once.

**One revision counter, not one per subsystem.** Every outcome-changing mutation advances the organization's `policyRevision`, which lives with the organization in the account store, and a decision quotes the revision it was computed against. That is what lets a cache tell stale from merely old. Governing a resource advances it too, because a type grant some role already holds now covers one more thing; creating a group does not, because it binds nothing.

### One name was already taken

The design calls the request and the answer `AuthorizationRequest` and `AuthorizationDecision`. Both names collide in this repository: the credentials subsystem already owns `AuthorizationRequest` for an OAuth-style grant flow, which is a different concept wearing the same word. They are `AccessRequest` and `AccessDecision` here, so "authorization" keeps meaning the credential flow and a permission check reads as one.

## Alternatives considered

**A policy expression language.** Rejected: it buys conditions nobody has asked for and costs the ability to explain a refusal by reading data. If a condition becomes necessary, it should arrive as a named, tested rule rather than as a general evaluator.

**Explicit deny.** Rejected: with allow-only grants a decision is a union, and order and precedence never enter the answer. Deny would make both part of every explanation.

**Role inheritance.** Rejected for the same reason: an inherited grant is one a reader has to reconstruct rather than read.

**Permissions as free strings.** Rejected: a typo would become a grant that silently never matches, or worse, one that matches something unintended later when the string is adopted.

**Storing endpoint or credential on the grant.** Rejected: it makes rotation a migration and puts secrets in a table administrators edit.

## Consequences

Every new governed capability adds a `(resourceType, action)` pair to the code catalog, and a deployment upgrading gets it through the schema's seeding. Retiring one leaves the row in the database so existing grants keep their foreign key; the code catalog is what stops it being granted again.

A refusal distinguishes `default-deny` (no roles at all), `no-grant` (roles, none matching or no such resource), and `resource-disabled`. The last one deliberately confirms a resource exists, because it answers a principal who does hold a grant and a confusing message would be worse than the disclosure.

Nothing caches decisions. The revision exists so a caller can cache safely, and adding a cache inside the service would put two authorities behind one answer.
