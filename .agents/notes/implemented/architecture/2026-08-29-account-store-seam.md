# Agent Note: The account store holds identity and nothing else

Status: implemented

English | [中文](2026-08-29-account-store-seam.zh.md)

## Problem

Team Edition needs somewhere to keep who a member is before it can keep what a member may do. Two questions had to be answered together, because answering either one badly locks in the other.

The first is what the store owns. Putting password material on the account record is the obvious shape, and it is the shape that makes replacing sign-in expensive later: an external identity provider would then arrive at a table whose columns encode the assumption that authentication is a password.

The second is which database. The target deployment is a single Control Plane instance, but the design named PostgreSQL, and this repository has no database driver of any kind — adding one brings a driver dependency, a migration tool, and a test strategy for a database that has to exist before a test can run.

## Decision

`dsh-account-store` is the seam: organizations, member accounts, and the counters a lockout policy reads. It is a repository. It records what happened, reports conflicts as named errors, and decides nothing — whether five failures mean a lockout, and what an encoded hash contains, belong to the authentication provider that reads and writes through it.

Authentication material is reachable only through `getPasswordHash` / `setPasswordHash` and never appears on the account record. The store treats the value as opaque bytes: it does not parse, compare, or derive anything from it. That is what keeps storage and authentication method orthogonal, so replacing password sign-in changes which provider is mounted rather than what is stored.

`dsh-account-store-sqlite` is the shipped backend, on Node's built-in `node:sqlite` — already the backend for session persistence, session query, and storage, so it adds no driver to the repository.

**This departs from the design's PostgreSQL choice, deliberately and reversibly.** The deployment it targets is one Control Plane instance, where SQLite's single-writer limit is not a constraint; PostgreSQL earns its cost at the multi-instance deployment that is explicitly deferred. A PostgreSQL backend is a second provider behind this same Service Definition, and the entity model here is the one the design specifies, so writing it later is implementing an interface rather than reopening a decision.

### Two contracts worth naming

Every method returns a promise, so **no method throws synchronously** — a caller's `.catch` must see every failure. The methods keep synchronous bodies and return `Promise.reject` rather than being `async`, because the repository lint refuses an `async` function with no `await`. Tests hold this: they assert rejection, which a synchronous throw does not satisfy.

`listUsers` orders by SQLite's row identity, not `created_at`. Two accounts issued in the same millisecond share a timestamp, and a backward clock step would order them wrongly; insertion order is what "creation order" means.

## Alternatives considered

**Password hash on the account record.** Rejected: it encodes "authentication is a password" into stored identity, which is the coupling the two-seam split exists to avoid. The column still lives on the account row as the design's data model has it, but only the authentication provider reads or writes it.

**Adding a PostgreSQL driver now.** Rejected for this change: it decides a driver, a migration tool, and a test-infrastructure strategy at once, none of which the deployment needs yet, and none testable in an environment without a database.

**An in-memory backend for tests only.** Rejected: a backend that exists only for tests proves the seam works against something no deployment runs. The SQLite backend runs `:memory:` in tests and a file in production, so tests exercise the shipped code.

## Consequences

A deployment gets durable accounts with no database to operate. When multi-instance arrives, it needs a PostgreSQL provider and a migration path — `SCHEMA_VERSION` is 1 and opening refuses a newer file, but nothing upgrades an older one yet, and the first schema change must add that.

Accounts are suspended, never deleted, because roles, devices, and audit rows will reference them. A deletion path needs those references decided first.

The store holds several organizations but nothing resolves which one a request belongs to, so a deployment uses one until request-scoped organization resolution exists.
