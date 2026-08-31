---
description: "The Windows and Apple silicon macOS desktop shell that keeps one local Team Runner resident and points it at one deployment's Control Plane."
kind: "package-reference"
---

# @deepseek-ai/dsh-team-runner-desktop

English | [中文](README.zh.md)

## Summary

This Electron application installs the Team Runner as a member-owned desktop process. It starts the bundled `dsh --profile team` on loopback port `3090`, opens the local browser application in a hardened window, remains available from the system tray after that window closes, starts in the background at operating-system login, and restarts an unexpectedly exited Runner after ten seconds. Explicitly choosing Quit stops both processes.

The desktop build belongs to one enterprise deployment. Its package metadata carries the Control Plane HTTPS origin and the Runner version; it carries no member password, device credential, refresh token, access token, or upstream model credential. The Runner stores its generated device key and issued credentials under Electron's per-user application-data directory.

## Build installers

Build the Runner executable and its sidecars first, then supply the executable and deployment origin to the platform packaging command:

```sh
DSH_TEAM_RUNNER_EXECUTABLE=/absolute/path/to/dsh \
DSH_TEAM_CONTROL_PLANE_URL=https://control.example.com \
pnpm --filter @deepseek-ai/dsh-team-runner-desktop package:mac
```

`package:mac` produces an Apple silicon DMG only. It does not produce Intel or Universal artifacts. `package:win` produces an x64 NSIS installer and expects the Windows Runner executable and ripgrep sidecar.

The packaging configuration copies the Runner binaries into Electron resources and records the validated Control Plane origin in application metadata. At runtime the shell writes a deployment patch under its own application-data directory, starts the Team profile with that patch, and gives the child a private `DSH_HOME` in the same directory.

## Runtime behavior

- Closing the application window hides it; the tray menu opens it again.
- The operating-system login item starts Electron with `--background`, so the Runner is available without opening the window.
- An unexpected Runner exit schedules one restart after ten seconds. A launch failure keeps Electron alive, reports the failure, and uses the same delayed retry.
- A second desktop launch activates the existing instance instead of starting a second Runner on port `3090`.
- Navigation outside the local Runner opens in the system browser; renderer Node integration is disabled and context isolation and the Chromium sandbox remain enabled.

## Platform support

| Platform | Installer target | Architecture |
|---|---|---|
| macOS 12 or later | DMG | Apple silicon (`arm64`) |
| Windows | NSIS | x64 |

Linux desktop packaging and macOS Intel support are outside this application's platform set.

## Known limitations

- The desktop shell does not download or update the Runner. A deployment signs and distributes a complete installer build.
- Automatic login startup is per operating-system user, not a privileged system service. The Runner therefore executes work with that member's permissions.
- The application log and deployment patch live under the per-user application-data directory; support tooling must collect them from the affected computer.
