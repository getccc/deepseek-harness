# Agent Note: Control Plane SQLite write path

Status: implemented

English | [中文](2026-09-17-control-plane-sqlite-write-path.zh.md)

## Problem

The Control Plane keeps nine stores (accounts, devices, access control, audit, quota, models, console menus, knowledge, BI) in SQLite files and reaches them through the synchronous `node:sqlite` driver in one process, so every statement blocks every request that process serves, including streamed model responses. Each model call authorizes, reserves quota, and settles through these stores. Two costs grew with use. `reserve` summed every reservation of the calendar-month period before inserting, even when no budget limit existed and the sum could not refuse the request. The stores also ran in SQLite's default rollback journal, which syncs both the journal and the database file on each commit and makes readers wait for a writer.

## Decision

`dsh-quota-sqlite` reads the period's budget first and sums the period's settlements and open reservations only when a limit exists. `usage()` still derives the complete standing from the rows, and the ledger stores no running total.

Each of the nine stores accepts `journalMode` (`wal` by default, or the rollback journals `delete`, `truncate`, and `persist`) and `busyTimeoutMs` (1,000 by default). After `applySchema` accepts the file's application id and schema version, the store applies the journal mode and sets `synchronous = FULL`, so a resolved write survives power loss under WAL regardless of the SQLite build's default. WAL is persistent in the file, and a committed transaction can remain in the `-wal` file until a checkpoint; the [Control Plane bundle README](../../../../packages/bundle/team-control-plane/README.md) states the backup procedure this requires.

## Measurements

Measured locally on 2026-09-17 on macOS arm64 with an internal SSD, Node 24.15.0, and SQLite 3.51.3, using built `lib/` packages under plain Node. The workload has one organization, 300 members bound to one role granted `model.invoke`, one registered model, and file-backed account, access-control, quota, and model stores. Before timing, the quota file receives N settled reservations in the current period in one transaction. A timed call is `modelGateway.authorize` followed by `modelGateway.settle`; 30 warm-up calls precede 300 measured calls, and the table reports the median. Model and network latency are excluded.

| Seeded reservations | Rollback journal, sum on every reserve | WAL, sum only under a limit |
|---|---|---|
| 0 | 1.05 ms | 0.32 ms |
| 10,000 | 6.20 ms | 0.33 ms |
| 100,000 | 105.6 ms | 0.36 ms |
| 500,000 | 774.1 ms | 0.32 ms |

With a limit and 100,000 seeded reservations, a call takes 93 ms after the change and 95 ms before it. On an empty ledger, WAL alone reduces a call from 1.05 ms to 0.41 ms, and `synchronous = NORMAL` would reduce it further to 0.32 ms. The SSD's sync cost is low, so a slower disk increases the journal-mode difference; no slower disk was measured.

## Alternatives considered

**Keep the balance in a total maintained by triggers.** A limited `reserve` would read one row, but the ledger would gain a stored copy of its balance, a schema version, and a backfill, while no production consumer sets a limit. It is the follow-up for deployments that enable limits.

**Run WAL with `synchronous = NORMAL`.** Rejected because a committed transaction may roll back after an operating-system crash or power loss, which would lose settlements, audit events, or issued credentials that callers already received. The [archived Session SQLite provider](../../archived/architecture/2026-08-18-sqlite-physical-chunk-row-compression.md) made the same choice.

**Share the open sequence through a new package.** The nine stores repeat two config fields and three statements; a package would add registration, documentation, and a dependency from every store, which outweighs the repeated lines it would remove.

**Add covering indexes for the period sum.** Index-only reads lower the constant factor, but a limited call still reads every reservation in the period.

## Consequences

Calls without a limit no longer slow down as a month's reservations accumulate, and writes no longer block readers of the same file. Under a limit, `reserve` still reads the whole period, which the `dsh-quota-sqlite` README lists under known limitations. Existing deployments switch their files to WAL at first start, and operators must back up through SQLite's backup API instead of copying a database file. An external `sqlite3` session holding a write lock makes a request wait up to `busyTimeoutMs` before failing, where it previously failed at once, and the process is blocked during that wait. Each store's tests read the journal mode through a second connection for the default and for a configured rollback journal.
