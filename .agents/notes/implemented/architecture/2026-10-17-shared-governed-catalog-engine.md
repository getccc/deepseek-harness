# Agent Note: One governed catalog engine and one governed wire for knowledge, BI, and GMO

Status: implemented

English | [中文](2026-10-17-shared-governed-catalog-engine.zh.md)

## Problem

The knowledge, BI, and GMO capabilities each shipped the same Control Plane catalog: a SQLite table of what a source governs, a reconciliation that registers each row as an access-control resource, a per-operation access decision, and an audit record. They also shipped the same Runner endpoints: request opening with a version check before identity, a closed refusal envelope, and a device-token call that maps every failure to a closed word. BI copied knowledge and GMO copied BI on purpose, so that adding a capability did not edit packages other people had shipped ([the GMO proposal](../../proposed/feature/2026-10-16-team-gmo-supply-chain-through-the-control-plane.md) records that choice). The clone detector reported 42 clones touching the three families, 14 of them between the SQLite gateways, and a fix to reconciliation or authorization had to land three times with nothing but review to keep the copies equal.

## Decision

Two packages own the shared code. Everything that names a table, a word, a path, or a field stays in the capability.

`dsh-governed-catalog-sqlite` (`packages/access/governed-catalog-sqlite`) holds the `GovernedCatalog` class. A capability constructs it with a `GovernedCatalogSpec`: its table names, reference column, governed resource type, audit action and failure key, whether a new entry starts switched on, the columns a listing writes, and five functions that map its own types onto catalog rows. The class owns opening the database and its pragmas, joining concurrent synchronizations, describing every listed entry before anything is written, retiring dropped entries before their rows, writing a listing in one transaction, registering resources, the source status, admission, authorized listing, and the audit record. `applyCatalogSchema` is the version and application-id check. Each gateway keeps its DDL, row type, `applySchema`, and operations.

`dsh-team-governed-wire` (`packages/team/team-governed-wire`) holds both ends of the Runner wire. `governedHandler` opens a POST in a fixed order (method, body bound, version range, device token), runs a capability's decoder outside the failure handling so a field this build cannot read is a 400, and answers a failure through the capability's reason mapping. `governedClient` posts the version and fields with the current token and maps a failed fetch, a body that is not a JSON object, an unknown refusal word, and an unreadable token to the capability's own error. `COMMON_REFUSAL_STATUS` owns the eight refusal words every capability shares and their statuses; each capability adds its own words to a copy.

The `*-gateway-sqlite`, `*-gateway-http`, and `*-team` packages of the three families delegate to these two. The change keeps every SQLite table and column, application id and schema version, route path and protocol version, permission, audit action and metadata key, error message, and model-visible string as they were. `startsEnabled` stays a per-capability value because knowledge and BI start a discovered entry on and GMO starts it off. The Control Plane packages import `dsh-team-governed-wire`, which holds no `node:sqlite` import, so the Runner, which imports the HTTP packages for their path constants, does not load the SQLite engine.

## Recorded evidence

The existing suites of all three families pass unchanged: 1,115 tests across 29 files before and after. The two new packages carry their own suites at 100% statements, branches, functions, and lines. `pnpm run duplication` falls from 64 to 40 clones on the same tree. The clones touching the three families fall from 42 to 17: all 14 between the SQLite gateways go, the HTTP gateways drop from 11 to 2, and the Runner providers from 4 to 2.

## Alternatives considered

**A shared base class for the three gateways.** Each gateway extends its own Service Definition (`KnowledgeGateway`, `BiGateway`, `GmoGateway`), which carries the capability's operations and Cordis service key. A second base would need multiple inheritance, so the engine is held by composition.

**One package for the SQLite engine and the wire.** The Runner imports the HTTP packages for their paths, and a single entry would load `node:sqlite` there. Package entry points other than `.` need special publication handling in this repository, so two packages is the smaller change.

**Put the Runner call into `dsh-team-account-client`.** That package owns the fetch and the token, so the call fits it. The Control Plane end has no home there, and the two ends repeat the same facts (the bearer header, the version check, the refusal envelope); keeping them together gives each fact one owner.

**Make the catalog an abstract store with SQLite as one provider.** There is one backend and no second planned. A seam with a single implementation costs a Service Definition and a provider package; the SQLite-specific name `governed-catalog-sqlite` states the mechanism and can be split when a second backend exists.

**Extract the Typert controllers and the composer controls too.** The Typert generator requires each controller to be a concrete `TypertRemoteService` with its own constructor and decorated methods, so the controllers cannot share a base class, and their wire types differ by name on purpose (`categoryRef`, `projectRef`, `knowledgeRefs`). Their common `parseRequest` also exists in the office and settings controllers, which makes it a Typert-wide helper. The composer controls share a trigger that is also in `ui-office`, which makes it a client-primitive change with its own locale and CSS ownership. Both are separate changes.

**Leave the copies and test them against each other.** A test that compares three implementations of the same rule catches a divergence after it ships; the shared class prevents it.

## Consequences

- A fix to reconciliation, admission, the audit record, request opening, or refusal decoding lands once and reaches knowledge, BI, and GMO together. A new governed capability supplies a spec and a protocol instead of a fourth copy.
- A capability's table and column names are written into SQL text by the engine. They come from constants in the capability and never from request data; the engine README states this.
- The old-schema refusal in the BI and GMO catalogs, which carried a coverage exemption because it was reachable only after a version bump, is now exercised by the engine's own suite.
- The 17 remaining clones are the Typert controllers (four), the composer controls (five), the `scope` folds of BI and GMO, the two source providers `bi-webi` and `gmo-excel-tools` (two stretches), the HTTP gateways' plugin `Config` boilerplate (two, one shared with the web-search gateway), the Runner providers' constructor (two), and one inside `knowledge-weknora`.
- `dsh-web-search-gateway-http`, `dsh-model-gateway-http`, and `dsh-team-release-http` still carry their own request opening; moving them onto the wire package is possible but not part of this decision.
