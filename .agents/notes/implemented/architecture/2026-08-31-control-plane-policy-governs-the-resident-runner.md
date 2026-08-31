# Agent Note: Control Plane policy governs the resident Runner

Status: implemented

English | [中文](2026-08-31-control-plane-policy-governs-the-resident-runner.zh.md)

## Problem

Team Edition separates a server-deployed administration application from a Runner on each member's computer. Installing the Runner as a desktop application must not turn the local process into a second policy authority, while remote policy changes must take effect even when that Runner stays alive in the background. Password replacement, model visibility, device inventory, and process residency need one consistent ownership model.

## Decision

**The Control Plane owns account and resource policy; the Runner owns local execution and credential custody.** Administrators create accounts, replace passwords, compose roles, bind exact model resources, and revoke devices on port `3095`. Members authenticate on the local port `3090`; the Runner sends the password to the configured Control Plane over TLS, holds the resulting device credential, and asks the Control Plane for the model catalog under its current access token. It does not copy authorization policy into a local database.

**Replacing a password revokes every existing path back into that account.** The administration write stores the new password and then revokes all Control Plane browser sessions plus every device credential family owned by the account. A resident Runner therefore loses refresh and model access and returns the member to local sign-in. This applies to the administrator's own account as well; that response expires the current administration cookie.

**A model is a governed resource, not only a catalog row.** Every catalog model has a managed-resource id. The role editor selects exact model resources and replaces that role's model discovery and invocation grants with exact grants for the selected ids. Runner discovery evaluates the current device principal and returns only active models it may discover; invocation independently requires the matching invocation grant.

**Device inventory is presented under its account owner.** The administration API retains device inventory and revoke operations, while the browser application renders each member's devices in the expandable member row. Removing the separate navigation page does not create a second ownership relation or change the authorization checks.

**Electron owns desktop residency, not authorization.** The desktop shell starts the bundled Team profile, hides on window close, remains reachable from a tray, registers a per-user login item for background startup, and restarts an unexpected Runner exit after ten seconds. Explicit Quit ends both processes. One enterprise build carries one validated Control Plane origin but no account or provider secret.

**The desktop platform set is Windows x64 and Apple silicon macOS.** The macOS packager emits `arm64` DMG artifacts only. Intel and Universal builds are absent rather than untested variants presented as supported.

## Alternatives considered

**Keep device tokens valid after a password replacement.** Rejected because a stolen device credential would survive the account owner's recovery action. Requiring every device to authenticate again makes password replacement the unambiguous account-wide recovery boundary.

**Cache role-to-model selections in each Runner.** Rejected because background residency would create stale authorization windows and a revocation protocol. Discovery under the current access token makes the Control Plane's ordinary access decision authoritative on every refresh.

**Run the Runner as a privileged system service.** Rejected because local tools and workspaces belong to the operating-system user. A per-user login item supplies background availability without changing the identity or privileges under which work executes.

**Ship one Universal macOS installer.** Rejected because Intel support was not required and a Universal artifact increases build, signing, download, and verification work for an unsupported architecture.

## Consequences

Password replacement is intentionally disruptive: every browser and computer signs in again, including the administrator performing a self-reset. Device rows remain visible for inventory, but their credential families are revoked immediately.

Model display and model invocation use two explicit actions over the same resource id. A role selection writes both so the ordinary product workflow does not display an unusable model, while the gateway still checks invocation independently.

The resident shell must remain an ordinary member process. Installers can enable login startup without administrator privileges, and support can distinguish closing the window from explicitly quitting the Runner.

An enterprise distribution produces separate Windows x64 and macOS arm64 artifacts and bakes the deployment's non-secret Control Plane origin into each build. Changing that origin requires another build.
