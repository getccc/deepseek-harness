# Agent Note: The Team desktop updates itself from the Control Plane

Status: proposed

English | [中文](2026-09-20-team-desktop-self-update.zh.md)

## Problem

A Team member upgrades by downloading a 280 MB disk image or a 231 MB installer from the website and reinstalling over the running application. Every release reaches members late, and a build that repairs a break in their work reaches them only when someone tells them it exists.

Three pieces of the answer already sit in this repository, none of them connected. [`dsh-team-update`](../../../../packages/team/team-update) decides whether an offered release may replace the one running here — Ed25519 manifest signature, numeric version order, `minimumFrom` upgrade path, platform artifact — and has no consumer. [`apps/desktop`](../../../../apps/desktop/src/update-coordinator.ts) runs a complete `electron-updater` coordinator for the upstream personal Desktop, published through a `generic` provider at a public download origin. [`apps/team-runner-desktop`](../../../../apps/team-runner-desktop/src/main.ts) has neither: its window loads `http://127.0.0.1:3090/team/open` with no preload and no IPC channel, so nothing in the page can reach the shell.

The deployment removes the obvious answer. Members run the application on the company intranet, where the Control Plane is the only address an installed build already trusts: [`resolveDeployment`](../../../../apps/team-runner-desktop/src/deployment.ts) refuses a packaged Control Plane that is not HTTPS, so every deployment terminates TLS, and the build carries the private certificate authority that signed it. The website is plain HTTP. No Windows code-signing certificate exists yet; the macOS build is signed and notarized.

The version numbers this project ships would defeat the decision before any of it runs. `versionComponents` reads three numbers and ignores everything after `-`, so `0.1.6-alpha.1.20260917.2` and `0.1.6-alpha.1.20260918.1` are both `0.1.6`, compare equal, and `decideUpdate` answers `not-newer`.

## Proposal

Publish each release through the Control Plane the installed build already trusts, decide with `dsh-team-update`, download and install with `electron-updater`, and put the control beside the member at the sidebar foot.

### Released versions are three increasing numbers

A release build takes `MAJOR.MINOR.PATCH` and nothing else, starting at `1.0.0` for the first build that can update itself, and packaging refuses any other form. A prerelease tag sends `electron-updater` to another channel and compares equal to the release that follows it, because `compareVersions` reads only the three numbers; build metadata after `+` is ignored by semver comparison, so two builds of one version would never replace each other. Staged rollout is therefore the Control Plane's decision per device, not a release channel, and the version line stays one increasing sequence. The website's hardcoded `v2.3.0` gives way to the published version, read once rather than written twice.

### The Control Plane serves the release

nginx serves `/updates/` as a static directory beside the console: the signed manifest, the `electron-updater` metadata, each artifact, and each `.blockmap`. Static files answer `Range` requests, which differential download requires; an application-layer proxy placed in front of them would have to answer `206` itself.

The manifest request carries the member's device identity, so the Control Plane decides per device which version a manifest offers. The staged rollout and the forced minimum are that decision, not a second mechanism. Artifact requests are unauthenticated: a 280 MB download outlives the account token's 60-second refresh lead, and the signature is what makes the bytes trustworthy.

### The manifest signature stands in for the missing Windows certificate

The release private key stays on the release machine and signs the manifest there. The Control Plane stores and serves what it is given and holds no key. The client verifies the signature against the public key it ships with, reads the artifact digest from the verified document, and `electron-updater` refuses a download whose hash does not match — differential downloads included, because the assembled file is hashed before it is installed.

An intercepted intranet connection can withhold an update, or serve an older signed manifest that `not-newer` refuses. It cannot make a client install bytes the release key did not vouch for, which is the property a Windows Authenticode certificate would otherwise supply. When that certificate arrives, `publisherName` adds the operating system's own check above this one.

### The shell carries a coordinator shaped like Desktop's

The Team shell carries its own coordinator, built like the one in `apps/desktop`: the same check and install phases, one in-flight operation at a time, and the same constructor parameters for the state sink, the updater, and the enabling condition. It is not shared code. `@deepseek-ai/dsh-desktop` is a private application with no export surface, and `pnpm run duplication` reads `packages` and `scripts` rather than `apps`, so extracting one shared package would cost a new package group today for one class; the extraction is a follow-up, and the two coordinators stay structurally alike so it remains cheap. Its `beforeRestart` hook is where the Team shell stops the Runner and waits for the port and the executable to be released, which Windows requires before an installer may replace files.

`electron-updater` requests through Electron's network stack, which reads the operating system's trust store and therefore rejects the deployment's private certificate authority. The shell pins that authority for the Control Plane host alone with `session.setCertificateVerifyProc`, comparing against the staged `runner/control-plane-ca.crt`. `app.on('certificate-error')` does not apply: it observes `webContents` navigation, not `net` requests.

### The control joins the member row over a preload bridge

The member row at the sidebar foot declares a `team.account.action` list, and the control joins it there, beside the name. The shell exposes check, install, and a state subscription through a context-isolated preload bridge, as `apps/desktop` already does for its own page, and reports the download's percentage on that subscription, because a 280 MB transfer needs more than a button that looks busy. One Team package reads the bridge and registers the control. It declares the bridge itself rather than importing the shell's declaration, because the two programs compile independently; `protocolVersion` is what a drift between them trips on. A browser opened at port 3090 and a source launch carry no bridge, the package registers nothing, and no control renders.

### Packaging publishes what the updater reads

The macOS build adds a `zip` target: Squirrel.Mac replaces an application from a zip, and the disk image remains the manual download. The zip is produced after notarization and stapling, so the bundle that lands is the notarized one. Both platforms already emit `.blockmap`. The release step signs the manifest and uploads artifacts, manifest, and blockmaps together.

The plugin tree's generation stamp is a fingerprint of the tree's paths and sizes, computed once at packaging time and carried in the application manifest, because an upgrade that ships identical plugins otherwise recopies 959 MB on Windows at first launch.

### The console publishes a release

The admin console gains a release page: register a version with its signed manifest, choose who is offered it, set the minimum version below which the application refuses to run, withdraw a release, and read the version distribution the existing device records already hold. Artifacts reach the host by `scp`: nginx caps a request body at 40 MB, and a 280 MB upload through the console would need a second mechanism for no gain.

## Alternatives considered

**Serve updates from the website.** The website and the public Control Plane share a host, so a static `/updates/` there would work and need no new route. Rejected because the website is plain HTTP and, more decisively, because the update address must follow the Control Plane a build was packaged for — the intranet deployment and the public one are different servers, and a second address would have to be packaged, validated, and kept in step with the first.

**Let an upstream client package read the bridge.** The control could instead join `sidebar.footer.action`, an unoccupied list `ui-sidebar` already declares, which would place it one row above the member rather than beside them. Rejected on both counts: the row this belongs on is the member's own, and a shell-owned global read from an upstream browser package would make the desktop shell a silent dependency of every deployment's web surface. The Team package that does read it ships only where a shell can act on what it reports.

**Reach the shell through the Runner.** An `ipc` channel on the spawned Runner plus a BFF controller would carry update state on the existing request path, matching how `open-in-app` and the office picker are built. Rejected as the larger of two correct answers: it adds a process protocol and an API package to move state the preload bridge already carries, and the Runner restarts independently of the shell, so that channel would need its own reconnection rules.

**Write the downloader and installer.** Replacing a running `.app` on macOS means driving Squirrel.Mac or reimplementing it, and a Windows installer replacement has to survive its own executable being overwritten. `electron-updater` does both, is already a dependency here, and its differential download is measured below.

**Ship only the changed component.** The `dsh` executable is 278 MB of the package and the plugin tree is most of the rest, so replacing one of them would move far less data. Rejected for macOS: an executable delivered outside the application bundle and run from the member's data directory is not covered by that bundle's notarization, and Gatekeeper's treatment of such a file is not something to build a release path on.

**Wait for the Windows certificate.** Rejected because the signed manifest already provides for the bytes what the certificate would provide, and the certificate's remaining benefit — the operating system's own opinion of the publisher — does not gate the mechanism.

## Acceptance criteria

A packaged macOS build offered a newer signed release shows the control at the sidebar foot, downloads on click, and restarts into the new version with the member's sessions, settings, and credentials intact.

A packaged Windows build does the same, and its installer replaces the files while the previous Runner is gone, verified by an upgrade run on a machine where the application was already running.

A manifest whose signature, version, or platform artifact does not satisfy `decideUpdate` produces no download, and the refusal reason reaches the shell log.

A build below the manifest's `minimumFrom` refuses the update instead of installing across an unsupported gap, and a manifest older than the installed version is refused as `not-newer`.

The Control Plane answers `Range` requests for artifacts, and a differential download completes without fetching the whole file.

With no shell — a browser at port 3090, or a source launch — the sidebar renders no update control and the package registers nothing.

Focused tests cover the decision path, the coordinator's phases, the certificate-pinning predicate, and the plugin-tree fingerprint. The client package carries its own dictionaries, and the sidebar registration is covered by the client test tier.

## Risks

**Endpoint protection may refuse an unsigned silent installer.** The Windows installer carries no Authenticode signature, and an intranet endpoint agent may block or alert on it even though `electron-updater` never marks the file as web-downloaded. Source inspection cannot decide this; it has to be tried on a managed office machine before a Windows rollout is announced.

**A macOS signing identity change breaks the update path.** Squirrel.Mac replaces an application only with one signed by the same identity, so an identity that is replaced rather than renewed strands every installed build on a manual reinstall.

**The host serves the download.** Three retained versions on both platforms occupy roughly 1.5 GB, and a release draws a 150–280 MB download from every member. The public host already runs its disk near saturation; the intranet host has headroom. `/updates/` needs its own rate limit, and the client's check needs jitter.

**Differential download helps unevenly.** Measured from two consecutive real builds' blockmaps: a Windows release that changed one browser bundle needs 22.0 MB of its 220.8 MB package, while a macOS release across one day of work needs 155.3 MB of 280.4 MB, because re-signing and the rebuilt executable move most blocks. macOS members should expect a download of that size.

**The first install stays unprotected.** The website is HTTP, so an initial download can be substituted in transit, and browsers already warn about executables served that way. Automatic updates are signed end to end; the first one is not, until the website carries TLS.
