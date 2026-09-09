---
description: "The Windows and Apple silicon macOS desktop shell that keeps one local Team Runner resident and points it at one deployment's Control Plane."
kind: "package-reference"
---

# @deepseek-ai/dsh-team-runner-desktop

English | [中文](README.zh.md)

## Summary

This Electron application installs the Team Runner as a member-owned desktop process. It starts the bundled `dsh --profile team` on loopback port `3090`, opens the local browser application in a hardened window, remains available from the system tray after that window closes, starts in the background at operating-system login, and restarts an unexpectedly exited Runner after ten seconds. Explicitly choosing Quit stops both processes.

The desktop build belongs to one enterprise deployment. Its package metadata carries the Control Plane HTTPS origin and the Runner version; it carries no member password, device credential, refresh token, access token, or upstream model credential. The Runner stores its generated device key and issued credentials under Electron's per-user application-data directory.

## Table of Contents

- [Build installers](#build-installers)
- [Deployment inputs](#deployment-inputs)
- [Runtime behavior](#runtime-behavior)
- [Platform support](#platform-support)
- [Known limitations](#known-limitations)

-----

<a id="build-installers"></a>
## Build installers

Build the Runner executable and its sidecars first, then supply the executable and deployment origin to the platform packaging command:

```sh
DSH_TEAM_RUNNER_EXECUTABLE=/absolute/path/to/dsh \
DSH_TEAM_CONTROL_PLANE_URL=https://control.example.com \
pnpm --filter @deepseek-ai/dsh-team-runner-desktop package:mac
```

`package:mac` produces an Apple silicon DMG only. It does not produce Intel or Universal artifacts. `package:win` produces an x64 NSIS installer and expects the Windows Runner executable and ripgrep sidecar.

The packaging configuration copies the Runner binaries into Electron resources and records the validated Control Plane origin in application metadata. At runtime the shell writes a deployment patch under its own application-data directory, starts the Team profile with that patch, and gives the child a private `DSH_HOME` in the same directory.

<a id="deployment-inputs"></a>
## Deployment inputs

Every deployment-varying fact is a packaging environment variable, so one source tree produces each enterprise's installer without an edit.

| Variable | Required | What it carries |
|---|---|---|
| `DSH_TEAM_RUNNER_EXECUTABLE` | yes | The built Runner executable; its ripgrep and macOS spawn-helper sidecars are read from the neighbouring `-rg` and `-spawn-helper` names. |
| `DSH_TEAM_CONTROL_PLANE_URL` | yes | The Control Plane origin this build belongs to. |
| `DSH_TEAM_CONTROL_PLANE_CA` | no | The certificate that signed the Control Plane's TLS certificate. |
| `DSH_TEAM_PLUGIN_TREE` | no | An installed profile's `node_modules`, carrying the out-of-tree plugins. |
| `DSH_TEAM_PRODUCT_NAME`, `DSH_TEAM_APP_ID` | no | The installed application's name and bundle identifier. |
| `DSH_TEAM_APP_ICON`, `DSH_TEAM_TRAY_ICON` | no | The application icon, and the menu bar template image whose `@2x` neighbour is staged with it. |
| `DSH_TEAM_PPT_TEMPLATE` | no | The PowerPoint template the office picker's `ppt` kind imports; staged beside the Runner and pathed at runtime. |
| `DSH_TEAM_APPLE_TEAM_ID` | no | Apple Developer Team ID; when set (with `APPLE_ID` and `APPLE_APP_SPECIFIC_PASSWORD` in the environment) the macOS build is notarized. |

### Pinning a private certificate authority

The Runner is a Node process and ignores the operating-system trust store, so a Control Plane behind a company's own certificate authority is unreachable until the build carries that authority's certificate: installing it in a keychain fixes the browser only. `DSH_TEAM_CONTROL_PLANE_CA` stages the certificate beside the Runner, and the deployment patch pins it on every row that speaks to the Control Plane — the account client, the model transport, and knowledge. It is trusted for that origin alone. A publicly trusted Control Plane omits the variable and the patch omits the pin.

### Carrying out-of-tree plugins

Plugins outside the Runner's own installation ship as a real directory rather than inside the packaged executable, because their native addons cannot be loaded from a packaged executable's virtual filesystem and their runtime dependency copying expects real files. Install them into a profile with `dsh plugin --profile <name> add <package>`, then point `DSH_TEAM_PLUGIN_TREE` at that profile's `node_modules`.

The shell owns the private profile's manifest: it writes the layer list on every launch and materializes the shipped tree as that profile's own `node_modules` once per application version. The packages have to be real files there rather than links into application resources — a plugin reaches its dependencies through its own real location, and `dsh` adds links beside them for the packages these plugins take as peers from the Runner installation. macOS clones the tree on a copy-on-write volume, so the duplicate costs little time and little disk space. A member never installs plugins into this profile, so an application upgrade that changes the layer list takes effect on the next launch. The member's own `cordis.patch.yml` is never touched.

### Signing and notarizing the macOS build

Without a signing identity the DMG is ad-hoc signed, and Gatekeeper blocks it until a user clears the quarantine attribute — fine for internal testing, not for distribution. To sign and notarize:

1. Import the `Developer ID Application` certificate into the login keychain (double-click the `.p12` and enter its password), then confirm `security find-identity -v -p codesigning` lists it.
2. Create an app-specific password for your Apple ID (or an App Store Connect API key).
3. Build with the notarization environment set; electron-builder then signs with the keychain identity under the hardened runtime and `build/entitlements.mac.plist`, notarizes, and staples:

```sh
export APPLE_ID="you@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
DSH_TEAM_APPLE_TEAM_ID="YOURTEAMID" \
DSH_TEAM_RUNNER_EXECUTABLE=/absolute/path/to/dsh \
DSH_TEAM_CONTROL_PLANE_URL=https://control.example.com \
pnpm --filter @deepseek-ai/dsh-team-runner-desktop package:mac
```

The bundled `dsh` executable and the native addons under `runner/` are signed with the app; the entitlements disable library validation so the hardened-runtime child may load them.

-----

<a id="runtime-behavior"></a>
## Runtime behavior

- Closing the application window hides it; the tray menu opens it again.
- The operating-system login item starts Electron with `--background`, so the Runner is available without opening the window.
- An unexpected Runner exit schedules one restart after ten seconds. A launch failure keeps Electron alive, reports the failure, and uses the same delayed retry.
- The window shows a localized starting notice and waits up to five minutes for the Runner's first answer, because a first launch materializes the plugin tree and heals module links before listening. The Runner binds its port before the login route mounts and answers `404` in between; only the login redirect, the route's refusal of a non-navigation probe, or a signed-in page counts as ready. A page that fails to load or answers an error after a Runner restart sends the window back to polling.
- A Runner left by a previous instance — the application was replaced while running, or force-quit — is stopped before the new one starts, so the fixed port is never contested. The process id is trusted only while that process still runs this build's own executable; Windows skips this step.
- The login item is registered on the first packaged launch only, so later launches neither wait on that registration nor announce it again.
- `shell.log` beside `runner.log` records each launch, Runner start and exit, the readiness probe outcome, and page-load failures with timestamps.
- A second desktop launch activates the existing instance instead of starting a second Runner on port `3090`.
- Navigation outside the local Runner opens in the system browser; renderer Node integration is disabled and context isolation and the Chromium sandbox remain enabled.
- The tray labels, the Runner-local login pages, and the composer permission and office pickers follow the operating system's language, in English or Chinese.
- The first launch seeds the member's settings so the beta-disclaimer welcome notice never opens; a member's own settings are never overwritten.

-----

<a id="platform-support"></a>
## Platform support

| Platform | Installer target | Architecture |
|---|---|---|
| macOS 12 or later | DMG | Apple silicon (`arm64`) |
| Windows | NSIS | x64 |

Linux desktop packaging and macOS Intel support are outside this application's platform set.

-----

<a id="known-limitations"></a>
## Known limitations

- The desktop shell does not download or update the Runner. A deployment signs and distributes a complete installer build.
- The Runner executable is built per platform on that platform: its native addon staging refuses a cross-platform target, so a Windows installer needs the Runner built on Windows x64 first.
- Automatic login startup is per operating-system user, not a privileged system service. The Runner therefore executes work with that member's permissions.
- The Runner log, shell log, and deployment patch live under the per-user application-data directory; support tooling must collect them from the affected computer.
