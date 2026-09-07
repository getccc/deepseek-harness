# Agent Note: AMEC Work is the only product identity

Status: implemented

English | [中文](2026-09-07-amec-work-is-the-only-product-identity.zh.md)

## Problem

The rebrand to AMEC Work reached the default build only. `DSH_CLIENT_BUILD_PROFILE=official` — selected by CI, by `pnpm run build:official`, and by the single-executable build the Team Runner installer packs — restored the DeepSeek identity twice: the profile's `DSH_CLIENT_TITLE` carried `DeepSeek Harness`, and `client-ui-brand-official` registered only under that profile, filling the sidebar's brand slots with the whale mark and the DeepSeek wordmark.

The installed Windows application therefore titled its window `DeepSeek Harness` and drew the DeepSeek marks in its sidebar, while the same source built without the profile showed AMEC Work. Which identity a member saw depended on how the Runner executable inside the installer had been built.

The same window also carried Electron's default `File / Edit / View / Window` menu bar, which no shell command populates: the desktop shell contributes no menu item of its own.

## Decision

**Product identity does not vary by build profile.** The official profile's `DSH_CLIENT_TITLE` is `AMEC Work`, so the browser title, and with it the desktop window title, is the same in every build.

**The DeepSeek brand occupants are gone, not conditioned.** `client-ui-brand-official` is deleted, together with the `FishLogo` and `BrandWordmark` primitives it was the only caller of, and the `web-app` bundle no longer composes it. The `sidebar.brand.mark` and `sidebar.brand.name` slots ship unoccupied, so `SidebarRoot`'s own fallback — `AmecLogo` beside `brand.localBuild` — is the product identity everywhere. The web application's install manifest carries the same name.

**Windows and Linux desktop windows carry no application menu.** `createDesktop` clears it before the window exists. Chromium keeps the clipboard and undo accelerators inside the page, so nothing a member uses is lost. macOS keeps the default menu: its system menu bar owns Quit and Hide, and those accelerators exist nowhere else.

## Alternatives considered

**Build the installer without the official profile.** This is the seam upstream designed, and it needs no source change, but it makes the shipped identity a property of one build command. The documented release path and CI both select the profile, so any rebuild through them reintroduces DeepSeek branding.

**Keep the package and drop it from the `web-app` bundle.** Rejected as dead code: nothing else composes it, and a package whose only purpose is a brand this deployment does not ship has no current owner.

## Consequences

A future deployment brand is a new occupant package registering into the two sidebar slots; the slots and their owner props are unchanged, and the catalog still documents them.

`docs/config-catalog.md` and `docs/module-graph.md` were edited by hand for the removed package. `gen-config-catalog` fails on unrelated spread fields in three Team packages, and `gen-module-graph` reports the English graph stale by roughly forty packages that predate this change; regenerating either would have buried the removal in unrelated churn, and the Chinese graph has no generator at all.
