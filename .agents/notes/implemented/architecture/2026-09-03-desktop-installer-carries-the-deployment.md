# Agent Note: The desktop installer carries the whole deployment

Status: implemented

English | [中文](2026-09-03-desktop-installer-carries-the-deployment.zh.md)

## Problem

`dsh-team-runner-desktop` carried exactly one deployment fact: the Control Plane origin. Three more had no carrier, and each of them decided whether an installed build worked at all.

The certificate that makes a privately signed Control Plane reachable was the first. `controlPlaneCa` had just become a per-row field on the three Runner clients, and the desktop patch wrote none of them, so every packaged build aimed at such a deployment failed every call — the failure the field exists to prevent.

The plugins a deployment's members are expected to have were the second. They live outside the Runner's own installation, and a member's computer has no package manager to install them with: `dsh plugin add` runs pnpm. Baking them into the Runner executable does not work either for the ones that matter. `pkg` puts application modules in a virtual filesystem, and a native addon cannot be loaded from one — `dsh-univer-office` alone carries `libsql` with its platform binaries plus two Univer native bindings — while the plugin's Gateway copies its own dependency packages onto disk at runtime through `createRequire` and `cpSync`, which assumes real files.

The product's own name and mark were the third, and the shipped defaults named DeepSeek rather than the company installing it.

## Decision

**Superseded in part on 2026-09-10 by the [two-stage upstream merge](../process/2026-09-10-two-stage-upstream-merge.md):** the shipped plugin tree is empty since upstream's Sidebar replaced the third-party plugins; the installer mechanism below stands.

**Every deployment-varying fact is a packaging environment variable.** The source tree names no company. `DSH_TEAM_CONTROL_PLANE_CA`, `DSH_TEAM_PLUGIN_TREE`, `DSH_TEAM_PRODUCT_NAME`, `DSH_TEAM_APP_ID`, `DSH_TEAM_APP_ICON`, and `DSH_TEAM_TRAY_ICON` join the origin and the Runner executable already there. Each is validated at packaging time, so a mistyped path fails the build rather than the installed application.

**Staged files are located at runtime, never at packaging time.** The certificate is copied beside the Runner and its absolute path is composed from `process.resourcesPath` when the Runner starts. A path recorded during packaging would name the build machine.

**Out-of-tree plugins ship as a real directory beside the executable.** The input is an installed profile's `node_modules`, produced once by `dsh plugin --profile <name> add`. Native addons load from real files and the Gateway's own copy step reads real files, neither of which the packaged executable's virtual filesystem offers.

**The desktop shell owns the private profile's manifest.** It writes the layer list on every launch instead of letting `dsh` initialize the shipped `team` template. Members do not compose this profile, and an application upgrade that changes the layer list has to take effect without asking anyone to edit a file. The member's own `cordis.patch.yml` stays theirs and is never written.

**The shipped tree is materialized as the profile's own `node_modules`, not linked to.** Node resolves a package's dependencies from that package's real location, so a linked plugin searches the read-only resource directory instead of the directory it appears to sit in, and fails on its own siblings. The directory must also stay writable, because `healProfilesModuleFallback` adds links there for the packages these plugins take as peers from the Runner installation. macOS clones the copy on a copy-on-write volume, which is why duplicating roughly 590 MB is affordable; the copy is repeated only when the application version changes.

**The tray reads its label from `app.getName()`.** The packaged name is already the one deployment fact for what this application is called, so nothing restates it.

## Alternatives considered

**Add the plugins to the Runner executable's dependency closure.** The loader half would have worked: bundle resolution is installation-first, bare plugin names resolve through the installed base, and a client plugin's browser half is a prebuilt `lib/client.js` the host serves rather than something bundled at runtime. Rejected on the native half — each addon would need the extraction that the executable build hand-writes for ripgrep and node-pty, and the Gateway's runtime copy would still find no real files. The closure manifest is also the Python wheel's runtime; a Team-only user-interface plugin does not belong in it.

**Add the two bundles to `PROFILE_TEMPLATES.team`.** Rejected because the template is shared with source launches: `pnpm dsh --profile team` would then fail in `resolveBundleDir` for packages that launch never installed.

**Link each shipped package into the profile's `node_modules` instead of copying.** This was implemented first and fails at boot: `dsh-better-sidebar` cannot find `ws` and `dsh-univer-office` cannot find `@deepseek-ai/schemastery`, because Node resolves from a package's real path, which for a link is inside the application bundle where no sibling packages exist. Running the Runner with `--preserve-symlinks` would change that rule for every resolution in the process, including the packaged executable's own, and was not worth the copy it saves.

## Discovered while verifying

A packaged executable also served an application shell with no browser plugins in it, reporting `client-modules: HTML did not preload @deepseek-ai/dsh-client-modules/client.js` after login. Where plain Node symlinks the installation's packages into `$DSH_HOME/profiles/node_modules`, a packaged executable writes generated proxy packages instead, because an operating-system link cannot enter its filesystem. Those proxies are transparent to `import`, but their manifests carry only `dsh.moduleFallback` — so `ClientModuleRegistry`, which walks from a row's resolved module to the nearest manifest, stopped at the proxy, found no `dsh.client`, and silently dropped all 47 installation-owned browser plugins including the module system itself. Only the two profile-resident plugins, which are real packages, survived. `nearestPackage` now follows a proxy's recorded target to the real package.

A packaged executable also rejected every Session creation with `TypeError: child.isDirectory is not a function`, which the browser swallowed: the workspace picker closed and nothing was selected. `agent-presets` listed its shipped preset root with `readdir(dir, { withFileTypes: true })`, and that root lives inside the executable. A probe packaged with the same `@yao-pkg/pkg` release shows that inside its virtual filesystem every `readdir` flavor — `readdirSync`, `fs.promises.readdir`, the ESM `node:fs/promises` binding — ignores `withFileTypes` and returns plain names, while `stat` works. Discovery now lists names and classifies each by `stat`. The `cordis` preset mounts `skill-filesystem` on a `skills/` directory under its own base URL, which is the same kind of path, so that preset's skill listing has the same failure in a packaged Runner; it is not the Team default and is left as recorded.

The desktop window could also stay empty for minutes, and the measured cause was not a slow Runner: the packaged Runner answers its login page 2–3 s after spawn, cold or warm, under a Finder-like environment, and leaves its port 0.3 s after SIGTERM. The shell's readiness probe accepted any status below `500`, and the Runner binds its port before the login route mounts, answering `404` with an empty body in that window; the probe hit it at +1.9 s, `loadURL` rendered the empty page, and because that navigation had succeeded nothing retried until a Dock or tray click ran the probe again. Readiness is now `303`, `405`, or `200`; the window shows a starting notice instead of nothing; a probe carries a timeout; a page that fails to load or answers an error returns to polling. Two further causes of long waits are removed at the source: a Runner surviving from a previous instance kept port 3090 and forced ten-second restart loops, so the shell records the Runner's process id and retires that survivor before starting, when it still runs this build's executable; and the login item was re-registered on every launch — several seconds on the critical path plus a system notification each time — so it is registered once. A timestamped `shell.log` records the sequence for support.

The packaged executable could not run `--profile team` at all before this change. Its dependency closure was missing three workspace peers the Team layers import at runtime — `dsh-knowledge`, `dsh-session-title-llm`, and `dsh-util-workspace-path` — so `knowledge`, `tool-knowledge`, `api-knowledge-controller`, and `session-title-llm` failed to import on every boot. `verify-runtime-closure` exists to catch exactly this and passed, because it checks the peers of packages the manifest names rather than of every package the deploy installs: all three enter the graph through `@deepseek-ai/dsh`'s own dependencies. The manifest now names them, which also brings them under the gate. The gate's reach is not widened here.

Every write-class Univer tool then failed with `GATEWAY_UNAVAILABLE: error: --profile <name> is required`. `dsh-univer-office` starts its Gateway and its content worker by spawning `process.execPath` with a script path — the convention every Node program follows — and inside the packaged Runner `process.execPath` is the `dsh` executable, whose entry read the script path as a `dsh` invocation without `--profile`. A probe packaged with the same release shows that in `--sea` mode pkg honours neither of its documented escapes: `PKG_EXECPATH=PKG_INVOKE_NODEJS` and the child re-entry rule both still run the bundled entry with the script appended to argv. Handing children a different Node is not an option either — the plugins' native addons are built for the executable's Node ABI, and a member's computer has no Node. The launcher therefore recognizes the spawn's shape — an absolute path to an existing `.js`, `.mjs`, or `.cjs` file first — and runs it through Node's own main-module path with argv reduced to what `node <script>` gives, so `require.main` and `import.meta.main` hold. Every `dsh` invocation starts with an option, so no launcher use is shadowed, and the check runs only in the packaged build. This is a child-process carrier, recorded in the application-launch rule as such; it launches no application.

## Consequences

The installer is large. The plugin tree is about 590 MB before compression, most of it the Univer viewer's artifacts, and it is copied whole because no manifest says which parts a running Runner reaches.

A Windows installer needs the Runner built on Windows x64 first. The executable build refuses a cross-platform native addon target, so the two halves cannot be produced on one machine.

Nothing checks that the shipped plugin tree and the Runner executable were built from compatible versions. The plugins declare Harness packages as peers and resolve them from the Runner's installation, so a deployment that upgrades one must rebuild both.

A member cannot add a bundle to this profile, because the manifest is rewritten on every launch. Configuration through the patch file is unaffected.
