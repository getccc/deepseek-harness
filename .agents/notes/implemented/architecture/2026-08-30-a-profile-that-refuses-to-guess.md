# Agent Note: the shipped Team profiles refuse to guess who they serve

Status: implemented

English | [中文](2026-08-30-a-profile-that-refuses-to-guess.zh.md)

## Problem

Both Team profiles now compose real services rather than a placeholder, and two of their configuration values have no honest default. A Control Plane must know which organization it serves; a Runner must know which Control Plane it belongs to and which version of itself to report.

The convenient move is a default that lets `dsh --profile team-control-plane` start out of the box. Every candidate is wrong in a way that is hard to notice: an empty organization id authenticates members against an organization that does not exist and reports "that member and password do not match" forever; a `localhost` Control Plane URL makes a Runner send its public key to whatever is listening; an invented Runner version puts a false fact in front of the administrator reading the device list.

## Decision

**The rows omit those keys, and the plugins refuse to load without them.** `team-control-plane-http` and `team-admin-api` throw when `organizationId` is blank; `team-account-client` declares `controlPlaneUrl` and `runnerVersion` required, so schema resolution fails. A deployment supplies them in its own patch, which is where an installer already writes deployment facts.

This makes the failure loud, immediate, and self-contained — it happens at load, in the process that is misconfigured, naming the key. The alternative fails later, elsewhere, as a symptom.

**Every Control Plane store writes under the DSH home.** A background service starts from wherever its service manager happens to be, so a relative path would scatter one deployment's data across whatever directories it was launched from.

**The Control Plane still shares no bundle with any member profile,** and the absence assertions still hold with seven services mounted. The composition tests name each expected service by id *and* check the manifest declares it, so a row added without its dependency fails to load rather than quietly mounting.

## Alternatives considered

**Defaulting the organization to whichever one the store holds.** Rejected: it works on a fresh install and silently picks the wrong one the moment a deployment holds two, which is exactly when being wrong matters.

**Reading the Runner version from the package at runtime.** Rejected for now: the bundled runtime has no reliable read of its own manifest, and the value that matters is the version an installer *installed*, which the installer knows and the process does not.

**Letting the team bundle keep its "overrides only, inserts nothing" shape.** That property was true when the layer owned a port and is not true now: the layer legitimately adds the account client and the handoff. The test was rewritten to state what holds instead — an override names an id and never a plugin, and an insert names both — which still catches the mistake the original guarded against.

## Consequences

`dsh --profile team-control-plane` and `dsh --profile team` do not start from a bare checkout. That is intended, and both READMEs say so, but it means neither profile can be smoke-tested by launching it without a patch. The composition tests read the patch rather than boot it, which is what they did before.

The Control Plane keeps four SQLite files under `control-plane/` in the DSH home. Under the single-database design they would be one; the SQLite deviation is what splits them, and consolidating them is the change that would buy back cross-subsystem transactions.
