# Agent Note: The runtime closure check follows every workspace member

Status: implemented

English | [中文](2026-09-17-the-runtime-closure-check-follows-every-workspace-member.zh.md)

## Problem

`verify-runtime-closure` requires every non-optional workspace peer of a package in the executable's dependency graph to be a `workspace:` dependency of `python/sdk-runtime/package.json`. It read workspace manifests from `packages/*/*` and `vendor/*` only. `@deepseek-ai/dsh` lives in `apps/cli`, so the check treated it as an external package and never followed its dependencies, although the deploy installs all of them, including the Team bundle, the Web application bundle, and the Team Control Plane. A peer declared only below `@deepseek-ai/dsh` passed the check and was absent from the executable. [The desktop installer carries the deployment](../architecture/2026-09-03-desktop-installer-carries-the-deployment.md) met this with `dsh-knowledge`; a packaged WeWork Runner built on 2026-09-17 met it with `dsh-bi`, and `bi`, `tool-bi`, and `api-bi-controller` failed to import on every boot.

## Decision

The check reads its manifest set from the `packages:` members that `pnpm-workspace.yaml` declares, through `scripts/workspace-members.ts`, which `gen-third-party-notices` also uses. A package in any declared member area, including `apps/*`, is followed through its `dependencies` and `optionalDependencies`, and its required workspace peers are checked.

The rule for a peer is unchanged: it must be a direct `workspace:` dependency of the runtime manifest. The runtime manifest therefore names 37 further workspace packages. Five of them — `dsh-bi`, `dsh-bi-gateway`, `dsh-bi-source`, `dsh-knowledge-gateway`, and `dsh-knowledge-source` — were missing from the deployed tree; the other 32 were already installed as dependencies of `@deepseek-ai/dsh`.

## Alternatives considered

**Accept a peer that any package in the graph installs.** Rejected: `build-exe-for-python-sdk` restores only direct dependencies that legacy deploy places outside the target, and it omits package-local `node_modules`. A peer that arrives only as another package's dependency has no guaranteed location in the executable, so this rule would pass the current layout and miss a package that pnpm places elsewhere.

**Add the Team bundle's `cordis.patch.yml` rows as extra roots.** Rejected: every missing peer belonged to a package that `@deepseek-ai/dsh` already reaches through `dependencies`, so plugin rows add no packages to the graph, and a hand-listed set of bundle files can omit a new bundle as the glob list omitted `apps/*`.

**Add `apps/*` to the hand-listed globs.** Rejected: `gen-third-party-notices` already derives its manifest set from `pnpm-workspace.yaml`, and a second hand-listed set would omit the next declared member area.

## Consequences

A peer that only a Team package declares needs a line in the runtime manifest, which is also the Python runtime wheel's closure, so the wheel carries the Control Plane's peers too. `scripts/verify-runtime-closure.spec.ts` rejects a missing peer reached through an `apps/*` package and a workspace file that declares no members.
