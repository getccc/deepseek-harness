# Agent Note: The Team Control Plane is a standalone tree so it cannot execute code

Status: implemented

English | [中文](2026-08-29-control-plane-carries-no-local-execution.zh.md)

## Problem

The Team Edition Control Plane holds every company credential and answers requests from every member's Runner. If it could also execute code, read files, or drive an Agent on its own host, then compromising it would yield both the credentials and a shell on the server holding them.

The obvious composition is the one every other Team row uses: layer over `dsh-base` and add the company services. That is wrong here, because `dsh-base` is exactly the bundle that mounts the Agent loop, the local filesystem, subprocess, shell, and sandbox providers. Stacking it would grant the Control Plane all of them at once, and nothing in the tree would say that was unintended.

Absence is also hard to hold over time. A capability that is missing looks identical to a capability nobody has added yet, so a later row can reintroduce one without any reviewer noticing the boundary it crossed.

## Decision

`@deepseek-ai/dsh-team-control-plane` is a standalone bundle in the shape of `dsh-sdk-minimal`: its insert list is the complete Cordis tree, and it does not layer over `dsh-base`. The `team-control-plane` profile template names that one bundle and nothing else. At this stage the tree is a single `webserver` row bound to loopback on `3095`, distinct from the Team Runner's `3090` and `dsh web`'s `3080`.

The absence is a composition fact, not a runtime one — nothing is there to observe — so tests hold it in three independent places:

| Barrier | Where | What it catches |
|---|---|---|
| The patch names no local-execution package | this bundle's test | a row added to the tree |
| The manifest declares no such dependency | this bundle's test | the Loader cannot resolve a bare specifier that was never declared |
| The profile template names no bundle carrying them | `app-boot`'s profile test | reintroducing the whole set by stacking `dsh-base` |

The forbidden set is written out package by package rather than matched by prefix. A prefix would silently absorb a new capability package, or silently let one escape by name; an explicit list forces whoever adds a capability package to make a decision here.

## Alternatives considered

**Layer over `dsh-base` and disable the unwanted rows.** Rejected: a `disabled` row is one patch layer away from being enabled again, by the operator's own profile patch, with no test standing in the way. Never mounting the bundle is a stronger guarantee than mounting and switching off.

**Match forbidden packages by prefix.** Rejected for the reason above: it fails open for names outside the pattern and fails closed for unrelated names inside it, and either way removes the deliberate decision.

**A runtime invariant that asserts the services are absent.** Rejected: there is no authoritative relation to observe. The companion stays empty with that reason recorded, per the package invariant rules.

## Consequences

Every company service — accounts, RBAC, quota, audit, the model and knowledge gateways, the private catalog, the admin surface — inserts into this one patch file and must keep the three barriers passing. A service that genuinely needs to run a subprocess does not get to relax them quietly; it needs its own Agent Note.

The guarantee binds what this repository ships, not what an operator later composes. A deployment that adds a local-execution row to its own profile patch defeats it, and no test here can prevent that.

Until the company services land, the profile boots a server that registers no routes and answers 404. That is the intended state: the boundary exists before anything is placed inside it.
