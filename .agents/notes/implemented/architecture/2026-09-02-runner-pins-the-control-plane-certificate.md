# Agent Note: The Runner pins the Control Plane's certificate

Status: implemented

English | [中文](2026-09-02-runner-pins-the-control-plane-certificate.zh.md)

## Problem

A Control Plane deployment that has no domain has no publicly signed certificate either. Serving the administration console and the Runner-facing endpoints over plain HTTP puts the administrator's session cookie and every device credential on the wire in the clear, so such a deployment terminates TLS with a certificate it signed itself.

Nothing on the Runner side could then reach it. The three Runner clients — `team-account-client`, `llm-http-transport-team`, and `knowledge-team` — each called the global `fetch`, which verifies against Node's own bundled authority list. That list is not the operating system's: a certificate installed in a member's Keychain or Windows certificate store makes the browser trust the console and leaves every Runner call failing with `UNABLE_TO_VERIFY_LEAF_SIGNATURE`. `--use-system-ca` would read that store, and `NODE_EXTRA_CA_CERTS` would add the certificate, but both widen trust to every host the process talks to, and `app-boot` lists `NODE_EXTRA_CA_CERTS` among the names no discovered `.env` may set, so it has to come from the launching environment.

## Decision

**Each Control Plane client carries the certificate it accepts, beside the address it calls.** `controlPlaneCa` names a PEM file and sits next to `controlPlaneUrl` in all three rows, for the reason `controlPlaneUrl` is already carried per row: the desktop installer writes every row from one deployment fact. The two fields are declared once as `controlPlaneConfigFields` and spread into each plugin's own schema, so the three clients cannot drift on the address or the trust configured for them.

**The trust reaches only Control Plane calls.** The certificate becomes an Undici `Agent` used as the dispatcher for that plugin's requests. The process keeps Node's default authorities for every other host, so a Runner that must accept one company certificate does not thereby accept it for the whole internet. This is a pinning of the deployment's own certificate, not an authority added to what the Runner trusts everywhere.

**Control Plane calls go through Undici's `fetch`, not the global one.** A dispatcher carrying private trust is an Undici `Agent`, and the global `fetch` rejects an `Agent` from a different Undici instance with `UND_ERR_INVALID_ARG`. `web-fetch-http` already imported Undici's `fetch` for its own pinned lookup; the Control Plane clients now do the same.

**A named certificate that cannot be read fails at plugin construction.** `readFileSync` throws where the plugin is built rather than at the first call. A Runner that quietly fell back to public trust would report a misconfigured deployment as an ordinary TLS failure much later, and against a Control Plane on a public address that failure is indistinguishable from an attack.

**Absent, nothing changes.** A deployment with a publicly signed certificate omits the field and is verified like any other host.

## Alternatives considered

**Set `NODE_EXTRA_CA_CERTS` from the desktop launcher.** Rejected because it widens the process's trust to every host it reaches, and because Node reads it at startup, so an Electron main process cannot set it for itself. The dispatcher confines the same certificate to the connections it was configured for.

**Ask members to install the certificate in the operating system trust store.** Rejected for the Runner. A root certificate installed there can sign for any name, so a leaked signing key would expose every machine that installed it — a heavier commitment than a deployment needs, and Node would not read the store without `--use-system-ca` anyway. Administrators still install it for the browser, which is a different trust decision with a different blast radius.

**Expose one shared fetch on `TeamAccountClient` and let the other two clients use it.** Both already inject that service, so this would have configured the certificate once. Rejected because a plugin's TLS trust would then come from another plugin's configuration, and a misconfigured knowledge row would fail somewhere other than where an operator set it.

## Consequences

Pinning is a compatibility promise to every installed Runner: when the deployment's certificate is replaced, a Runner carrying only the old signing certificate cannot connect. A deployment that rotates must ship the new certificate to members before switching the server over, which is the operational cost a publicly signed certificate does not have.

The certificate verification itself is proven against a real Control Plane rather than in a unit test, because a synthetic one would mean committing a signing key. `transport.spec.ts` covers the seam around it: which fetch a call goes through, that a named file must exist before the plugin runs, and that unloading releases the connection pool.

An unreachable Control Plane still reaches a member as `credentialsRefused` on the Runner's login page, so a missing certificate looks like a wrong password. That mapping predates this change and is tracked separately.
