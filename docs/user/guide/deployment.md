# Start and deploy DeepSeek Harness

English | [中文](deployment.zh.md)

## Summary

This tutorial takes a repository checkout to a browser-ready DeepSeek Harness Web UI and identifies the separate Team management entry point. It covers the verified source build, local startup, authentication, model and workspace setup, loopback-only remote access, process supervision, upgrades, and the failures an operator is most likely to meet. DeepSeek Harness is developer-preview software and is not production-ready; run it with least privilege in a disposable or dedicated environment.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Build the checkout](#build-the-checkout)
- [Start the Web UI](#start-the-web-ui)
- [Open and configure the UI](#open-and-configure-the-ui)
- [Start Team management](#start-team-management)
- [Reach a remote development host](#reach-a-remote-development-host)
- [Operate the process](#operate-the-process)
- [Troubleshooting](#troubleshooting)
- [Further Exploration](#further-exploration)

-----

<a id="prerequisites"></a>

## Prerequisites

Use a host that satisfies the repository engines and can isolate the files and credentials available to the agent.

- Read the [safety notice](../../../SAFETY.md). Prefer a disposable virtual machine, container, or dedicated account, and keep backups of every writable workspace.
- Install Node.js `^22.19.0` or `>=24.0.0` and pnpm `11.7.0`.
- Give the process write access to its Harness home. `DSH_HOME` selects it; the default is `~/.dsh`.
- Choose the repository directory that should become the process's default workspace root.

Confirm the toolchain before installing dependencies:

```sh
node --version
pnpm --version
```

<a id="build-the-checkout"></a>

## Build the checkout

Run the maintained source preparation path from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm run build
```

The install covers every workspace package. Platform warnings for optional native packages built for another operating system or CPU are expected; a nonzero exit is not. The build compiles the host and client packages and writes the Web frontend distribution.

Run `pnpm run build` after a fresh checkout and after source changes that affect built artifacts. `pnpm dsh web` starts from the prepared artifacts and does not rebuild them.

<a id="start-the-web-ui"></a>

## Start the Web UI

Start the loopback server without asking the operating system to open a browser:

```sh
pnpm dsh web --no-open
```

The default listener is `127.0.0.1:3080`. Startup is complete when stdout prints one `dsh web:` URL. That URL contains a one-process bearer token: keep it out of public logs and do not paste it into issues or chat rooms.

Choose another port when `3080` is occupied:

```sh
pnpm dsh web --no-open --port 8080
```

The Web launcher intentionally rejects `--host 0.0.0.0`. The shipped server has no TLS termination and the application can run model-generated commands with the launching user's authority, so direct network exposure is not a supported deployment.

<a id="open-and-configure-the-ui"></a>

## Open and configure the UI

Open the complete tokenized URL printed at startup. The browser exchanges the token for an HTTP-only cookie and redirects to the clean root URL. This local Web surface does not show an account-and-password login form, but it is not anonymous: an unauthenticated request to the clean root returns `401`.

Then complete the first-use path:

1. Open **Settings → Models**, store a provider credential, and select a model. The [model guide](providers.md) covers DeepSeek, catalog providers, and custom OpenAI-compatible endpoints.
2. Choose a workspace. The invocation directory is the default filesystem location, but the composer stays unavailable until the Web UI has a selected workspace.
3. Start a session and send a small read-only task before granting broader permissions.

<a id="start-team-management"></a>

## Start Team management

Team management is a separate Control Plane, not a route inside the Web UI on port `3080`. The `team-control-plane` profile listens on `127.0.0.1:3095`; its sign-in page is `/team/login` and uses a member name and password. Successful authentication creates an HTTP-only session cookie, while CSRF checks, role grants, and audit records protect administrative actions.

The profile fails closed until the deployment provisions an organization, an administrator password, and role grants through the account, authentication, and access-control services, then supplies that organization ID to the `team-shell` row. The current Team Shell has no organization bootstrap, enrollment-link, first-password, or grant-editing page. For local plain HTTP, set `secureCookie: false`; a TLS deployment keeps it `true`.

The current full Control Plane composition also needs a credentials provider for its model-gateway HTTP row. An administrator-only local preview may disable that row in `$DSH_HOME/profiles/team-control-plane/cordis.patch.yml`; this leaves company model routing unavailable:

```yaml
- id: team-shell
  config:
    organizationId: 019400a1-0000-7000-8000-000000000000
    secureCookie: false
- id: model-gateway-http
  disabled: true
```

After provisioning and patching the profile, start it from the repository root:

```sh
pnpm dsh --profile team-control-plane
```

Open `http://127.0.0.1:3095/team/login`. Keep this listener on loopback for local development. The [Control Plane bundle](../../../packages/bundle/team-control-plane/README.md) owns its composition, and the [Team Shell](../../../packages/team/team-shell/README.md) owns the browser-session and administrative behavior.

<a id="reach-a-remote-development-host"></a>

## Reach a remote development host

Keep the Web listener on the remote host's loopback interface. Start it from the repository checkout on that host:

```sh
pnpm dsh web --no-open
```

On the operator workstation, forward the same local port to the remote loopback listener:

```sh
ssh -N -L 3080:127.0.0.1:3080 user@server
```

Open the startup URL on the operator workstation while the tunnel is active. Preserve `127.0.0.1:3080` and the printed token exactly. An SSH launch suppresses automatic browser opening but still prints the URL.

The repository cannot verify your SSH server, firewall, or forwarding policy. The deployment operator must confirm that only intended users can establish the tunnel and that the remote `3080` listener remains bound to loopback.

<a id="operate-the-process"></a>

## Operate the process

A supervisor may run the same `pnpm dsh web --no-open` command. Configure these values explicitly rather than relying on an interactive shell:

- Set the working directory to the repository checkout whose artifacts were built.
- Set `DSH_HOME` to a persistent directory writable only by the service account; it owns profiles, settings, credentials, and local product state.
- Capture stdout and stderr in a restricted log because the readiness line contains a process credential.
- Send `SIGTERM` for an ordinary stop. The CLI gives the plugin tree up to five seconds to dispose before it forces exit.
- Do not add a public listener, TLS proxy, container image, or system service template unless that deployment owns and verifies the missing security and lifecycle contracts. The repository ships none for the Web UI.

To upgrade a source deployment, stop the process, update the checkout, rerun the two build commands, and start the same profile again. Keep a backup of `DSH_HOME` and writable workspaces before changing versions; pre-release on-disk formats have no compatibility promise.

<a id="troubleshooting"></a>

## Troubleshooting

- **Startup reports `EADDRINUSE`** — another process owns the port. Stop it or pass an unused `--port` value.
- **Startup asks for a build** — run `pnpm run build` from the repository root, then retry the same launch command.
- **The clean URL returns `401`** — use the complete tokenized URL from this process's startup line. A clean URL works only after that browser receives its cookie.
- **Team management does not appear on port `3080`** — start the separate `team-control-plane` profile and open port `3095` at `/team/login`.
- **The Control Plane waits for `credentials`** — the model-gateway HTTP row is active without its required provider. Complete that provider composition, or disable only that row for the administrator-only local preview described above.
- **The browser does not open over SSH** — this is expected. Keep the tunnel active and open the printed URL on the operator workstation.
- **The composer is disabled** — select both a configured model and a workspace.
- **The page shows stale client code after a source change** — rebuild and refresh the existing URL. Starting a second server does not update the first one.

<a id="further-exploration"></a>

## Further Exploration

- [Use the Web UI](index.md) — run the first task after startup.
- [Configure models](providers.md) — provider credentials, routes, models, and request compatibility.
- [Architecture](../../architecture.md) — profiles, plugin composition, the agent loop, the Session log, and capability seams.
- [CLI behavior reference](../../../apps/cli/reference/README.md) — exact profile layering, flags, source execution, and shutdown behavior.
- [Web application bundle](../../../packages/bundle/web-app/README.md) — tokenized startup, host trust, configuration, and current limitations.

## Dev Note

The SSH tunnel step requires manual verification on the target deployment because this checkout has no authority over the operator's SSH server, firewall, or identity policy.
