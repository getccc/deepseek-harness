# Agent Note: a Runner that can be told it is too old

Status: implemented

English | [中文](2026-08-30-a-runner-that-can-be-told-it-is-too-old.zh.md)

## Problem

Runners are installed on members' own computers and update on their own schedule, so a company will always be running several versions at once. Two consequences follow, and neither is served by treating a version as just another field.

A Control Plane eventually needs to stop answering a Runner too old to be trusted with a change. If that refusal is indistinguishable from an ordinary failure, the Runner retries forever and the member sees a product that does not work rather than a product that needs updating.

And a Runner replaces its own executable. Whatever decides that an offered release may be installed is the single point where being wrong hands the machine to whoever produced the release.

## Decision

**The protocol version is decided before anything else reads the body.** Each Runner-facing endpoint checks the version first and answers **426** with the supported range, so a Runner that is too old learns exactly that, and not a downstream complaint about a field whose meaning changed underneath it. The range travels with the refusal because the Runner cannot ask for it through a protocol the other side has just said it does not speak.

`too-new` is a distinct answer from `too-old`: it means this Control Plane is the one that needs updating, and saying so keeps an administrator from chasing a member's installation.

**This is a different check from the binding comparison.** The seam still refuses a redemption whose `protocolVersion` differs from the one the transaction was opened with, and still calls that `binding-mismatch`. "Do we speak this at all" and "is this the same version this transaction was bound to" are separate properties, and conflating them would leave a Runner unable to tell an upgrade from a tampered callback.

**An update decision checks the signature first, against canonical bytes.** Every later check then reads a value the release key vouched for rather than one the document claims. The canonical encoding fixes field order and sorts artifacts, so the same release signs identically however its artifacts were ordered, and a document that reorders its fields cannot present a different signature as valid.

**Versions compare numerically and ignore prerelease tags,** because the harness ships them in its own version and an update decision must not turn on how they sort. A string that does not start with a number is refused rather than guessed at.

**`minimumFrom` makes an upgrade path expressible.** A release that cannot be applied on top of an older build says so, and a Runner below it installs an intermediate release rather than discovering the problem after replacing itself.

**The background service runs as the member.** A launchd agent, a systemd user unit, and a Windows scheduled task — never a daemon, a system unit, or a service. The Runner executes the member's own work with the member's own permissions, and every platform's elevated form would run it as something else. All three restart a crash with a ten-second floor, so a Runner that cannot start fails visibly instead of spinning against its service manager.

## Alternatives considered

**Refusing an old protocol with 400.** Rejected: 400 says the request was malformed, and a Runner acting on that will keep sending the same well-formed request. 426 says the request was understood and refused for what the client is, which is the one refusal an update fixes.

**Folding "too old" into the existing binding-mismatch reason.** Rejected: a member whose callback was tampered with and a member whose application is out of date need different things, and one word cannot tell them apart.

**Signing the manifest's JSON text.** Rejected: it makes the signature depend on whitespace and key order, so a re-serialized manifest fails to verify while meaning the same thing, and a producer and a verifier must agree on a serializer rather than on a format.

**Comparing versions with a semver library.** Rejected for now: the only ordering this decision needs is over numeric components, and prerelease ordering — the part a library adds — is exactly the part that must not influence it.

**Installing the service definitions from this package.** Rejected: writing into `~/Library/LaunchAgents` or Task Scheduler needs privileges and platform knowledge the installer has and a library does not. What is a product decision — which account it runs as, whether it restarts, how fast — is stated once here instead of three times in three installers.

## Consequences

**This repository produces no signed platform installers.** A `.pkg`, `.msi`, or `.deb` needs code-signing certificates and platform toolchains that are not part of the build, so what ships is the decisions those installers carry out, not the installers. The packaging work remains open, and the README says so rather than implying coverage.

Nothing here downloads or applies an artifact either. The manifest names a digest and a size; checking bytes against them and replacing the executable belong to the installer.

One release key, passed in by the caller. Rotation means a target that trusts more than one key, which is a design rather than a second parameter, and adding it later does not change any decision made here.
