# Agent Note: The packaged bootstrap carries child scripts

Status: implemented

English | [中文](2026-09-15-the-packaged-bootstrap-carries-child-scripts.zh.md)

## Problem

A plugin that starts a worker by spawning `process.execPath` with a script path re-enters the single-file executable. [The desktop installer carries the deployment](../architecture/2026-09-03-desktop-installer-carries-the-deployment.md) records the fix: the entry recognizes an absolute script path first and runs it as Node would. That dispatch lived only in `apps/cli`'s `import.meta.main` block. The single-file executable enters through `python/sdk-runtime/runtime-bootstrap.mjs`, which imports `lib/bin.js` and called `runCli()` directly, so the dispatch never ran there: every such child printed `--profile <name> is required`, and `dsh-univer-office` could start neither its Gateway nor its content worker in a packaged Runner. Builds that shipped no out-of-tree plugin did not show it.

## Decision

`apps/cli` exports `runExecutable()`, which runs a carried script when the packaged executable received one and otherwise runs `runCli()`. Both the `import.meta.main` block and the runtime bootstrap's ordinary branch call it. The carrier's recognition rule in `node-carrier.ts` is unchanged, and the private subprocess-runner branch still dispatches before it.

## Alternatives considered

- **Duplicate the recognition in the bootstrap.** Rejected: two copies of one packaged-launch rule would drift, and the bootstrap would need `apps/cli` internals it does not import today.
- **Make the bootstrap the main module of `lib/bin.js`.** Rejected: the bootstrap owns the private subprocess-runner selection, which must run before any CLI module loads.

## Consequences

A packaged Runner serves plugin children again. `scripts/build-exe-for-python-sdk.spec.ts` pins that the bootstrap calls `runExecutable()`; the packaged-Runner smoke of a desktop build spawns the executable with a script and expects it to run.
