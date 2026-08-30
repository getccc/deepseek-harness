---
description: "Serving the administration console from the Control Plane: the built browser application's files under one address, and nothing else."
kind: "package-reference"
---

# @deepseek-ai/dsh-team-admin-app

English | [中文](README.zh.md)

## Summary

`dsh-team-admin-app` puts the built administration console on the Control Plane's own listener. It reads files out of one directory and does nothing else — no session, no authorization, no configuration. The page is not secret: every view it can render asks [`team-admin-api`](../team-admin-api/README.md) first, and that is where a session is required and a grant is checked.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

```yml
- name: '@deepseek-ai/dsh-team-admin-app'
```

No configuration. The console is served at `/team/admin`, and a deployment cannot move it: the application compiled against that address reaches its API by an absolute path, so a page served elsewhere would have to be rebuilt to match.

The files come from `@deepseek-ai/dsh-team-admin-frontend`, which `pnpm run build` produces. A checkout that has not been built serves nothing here.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### The page is public; the API is not

Serving the shell to an unauthenticated browser costs nothing — it is a script tag and a stylesheet. The application then asks `GET /team/api/session`, gets a 401, and renders the sign-in card. Authenticating the shell instead would mean a second place that decides who is signed in.

### A base element, because the build is address-agnostic

The application is built with relative asset URLs so the same files mount under any prefix. A request for `/team/admin` without a trailing slash would resolve those one directory too high, so the served page carries `<base href="/team/admin/">` and both forms work.

### Traversal is the static server's, not this package's

[`serveStatic`](../../host/frontend-static/src/index.ts) already resolves a request against the dist root and refuses anything outside it. This package strips its own prefix and hands over the rest, rather than repeating a path comparison whose mistakes are a directory traversal.

### Source map

| Path | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The route, the dist location, and the base element |
| [`src/invariant.ts`](src/invariant.ts) | Invariant companion registration |

-----

<a id="further-exploration"></a>
## Further Exploration

- [`team-admin-api`](../team-admin-api/README.md) — the JSON surface the console talks to.
- [Deployment guide](../../../docs/user/guide/deployment.md) — starting a Control Plane that serves it.

<a id="model-experience"></a>
## Model Experience

None, as this serves static files and registers no prompt section, tool, or request context.

#### KV Cache effect

Nothing here joins a model request, so the package has no request prefix and no cache effect.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These are current constraints of the contract, not a task backlog.

- **One fixed address** — the console lives at `/team/admin` because the application addresses its API absolutely; serving it elsewhere means rebuilding the application.
- **No cache headers on assets** — every file is served without `Cache-Control`, so a browser revalidates the vendor chunk on each visit even though its name already carries a content hash.
- **No compression of its own** — the webserver's gzip covers these responses; this package does not choose an encoding.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The dist path is resolved through `createRequire`, so the package finds the built application wherever the workspace or an install put it. A missing build is a 404 rather than a load failure, because the row must not stop a Control Plane from starting.

</details>
