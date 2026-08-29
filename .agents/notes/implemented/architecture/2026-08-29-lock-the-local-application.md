# Agent Note: Locking the local application is a navigation, not an RPC

Status: implemented

English | [中文](2026-08-29-lock-the-local-application.zh.md)

## Problem

`dsh web` is a foreground tool: closing it ends the browser's access along with the process. A Team Runner is a long-lived background service, so the same person now has a local application that stays reachable on a known port for as long as the machine is on. Stepping away from a shared or unattended machine had no answer short of stopping the service, which also ends work in progress.

Ending a browser session means expiring the cookie that carries it. That is only expressible in an HTTP response, so no RPC method and no human command can do it: both answer in a session, not on the wire that holds the cookie.

## Decision

`client-connection` registers an exact `/lock` route beside its `/api` prefix. A `GET` or `HEAD` that presents a valid session is answered with the same cookie expired; any other method returns 405.

The route is navigation-only. It carries no RPC, reads no request body, and reaches no Host capability, so it sits outside the `/api` prefix and outside the browser trust fence that guards it — there is nothing there for the fence to guard.

What protects it instead is the cookie's own `SameSite=Strict`. Only an authenticated request clears anything, and a navigation another site initiates arrives without the cookie, so it reads as unauthenticated and leaves the session intact. A same-site navigation — the person choosing to lock their own application — carries the cookie and clears it. The defense is a property the cookie already had, not a new check.

`BrowserAuth` now owns the full session lifecycle it was already half of: mint (`authorizeIndex`), verify (`isAuthenticated`), and end (`lock`).

The clearing cookie restates the issued cookie's name, `Path`, `HttpOnly`, and `SameSite`. A browser replaces a cookie only when those match, so an attribute drift would leave the original in place and silently fail to lock; the test pins them against the issued cookie rather than against a literal.

## Alternatives considered

**A human command through `ctx.commands`.** Rejected: a command answers inside a session and cannot set a response header on the browser's connection. It could at best ask the browser to navigate here, which is this route plus indirection.

**Rotating the signing secret on lock.** Rejected: that ends every browser session this Runner issued, including ones on other machines the person still wants. Ending all of them is a deliberate, heavier act — delete the owner credential record and restart — and keeping it heavier is the point.

**Requiring the trust fence on `/lock`.** Rejected as miscategorized: the fence exists to stop a cross-site page from reaching Host capability through `/api`. This route reaches none, and the cross-site case is already answered by `SameSite=Strict` withholding the cookie.

## Consequences

Two packages that asserted `client-connection` registers exactly one route now name the two it registers. That count is part of the package's observable surface, so the assertions moved with it rather than being loosened to a minimum.

Locking is per-browser. A person with the application open in two browsers must lock each, and the README states that rather than implying `/lock` is a global sign-out.

The route is reachable by typing the URL, which is deliberate: it works before any Team UI exists, and a later lock control in the client is a link to it rather than a new mechanism.
