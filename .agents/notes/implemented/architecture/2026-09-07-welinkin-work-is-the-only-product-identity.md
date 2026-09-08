# Agent Note: Welinkin Work is the only product identity

Status: implemented

English | [中文](2026-09-07-welinkin-work-is-the-only-product-identity.zh.md)

## Problem

The rebrand away from DeepSeek reached the default build only. `DSH_CLIENT_BUILD_PROFILE=official` — selected by CI, by `pnpm run build:official`, and by the single-executable build the Team Runner installer packs — restored the DeepSeek identity twice: the profile's `DSH_CLIENT_TITLE` carried `DeepSeek Harness`, and `client-ui-brand-official` registered only under that profile, filling the sidebar's brand slots with the whale mark and the DeepSeek wordmark.

The installed Windows application therefore titled its window `DeepSeek Harness` and drew the DeepSeek marks in its sidebar, while the same source built without the profile showed the product's own. Which identity a member saw depended on how the Runner executable inside the installer had been built.

The same window also carried Electron's default `File / Edit / View / Window` menu bar, which no shell command populates: the desktop shell contributes no menu item of its own.

## Decision

**Product identity does not vary by build profile.** The official profile's `DSH_CLIENT_TITLE` is `Welinkin Work`, so the browser title, and with it the desktop window title, is the same in every build.

**The DeepSeek brand occupants are gone, not conditioned.** `client-ui-brand-official` is deleted, together with the `FishLogo` and `BrandWordmark` primitives it was the only caller of, and the `web-app` bundle no longer composes it. The `sidebar.brand.mark` and `sidebar.brand.name` slots ship unoccupied, so `SidebarRoot`'s own fallback — `WelinkinLogo` beside `brand.localBuild` — is the product identity everywhere. The web application's install manifest carries the same name.

**The mark is one artwork with five homes.** The same PNG travels as a data URI in the shell's [`WelinkinLogo`](../../../../packages/client/ui-primitives/src/WelinkinLogo.tsx) primitive, in [`apps/team-admin`](../../../../apps/team-admin/src/brand.ts) and that application's own `index.html` favicon, in [`apps/web/public/favicon.svg`](../../../../apps/web/public/favicon.svg), and in [`team-local-login`](../../../../packages/team/team-local-login/src/pages.ts)'s pre-application pages. None of the five can read another's copy: the client packages bundle with no asset loader, the administration console bundles independently of them, and the login page is served before any application asset route exists. Replacing the mark means replacing all five and the drawn ratio each carries. Both of the mark's tones read on a light and a dark ground, so the favicon carries no colour-scheme swap of its own.

**The administration console's sign-in card repeats the Runner's.** Port 3095 drew a gradient `DS` monogram over an eyebrow, a heading, and a paragraph; it now draws the mark beside `Welinkin Work` and the console's own subtitle, over the Runner's ground, card, field metrics, glyphs, and gradient button. The two origins share no stylesheet, so `apps/team-admin/src/main.css` restates that page's palette and metrics rather than importing them; the console keeps its own vocabulary (`Member`, not `Account`) and closes the card with what signing in there is for, in the slot the Runner reserves for its own footnote.

**Windows and Linux desktop windows carry no application menu.** `createDesktop` clears it before the window exists. Chromium keeps the clipboard and undo accelerators inside the page, so nothing a member uses is lost. macOS keeps the default menu: its system menu bar owns Quit and Hide, and those accelerators exist nowhere else.

## Alternatives considered

**Build the installer without the official profile.** This is the seam upstream designed, and it needs no source change, but it makes the shipped identity a property of one build command. The documented release path and CI both select the profile, so any rebuild through them reintroduces DeepSeek branding.

**Keep the package and drop it from the `web-app` bundle.** Rejected as dead code: nothing else composes it, and a package whose only purpose is a brand this deployment does not ship has no current owner.

## Consequences

A future deployment brand is a new occupant package registering into the two sidebar slots; the slots and their owner props are unchanged, and the catalog still documents them.

The brand names the office picker's company-template kind with it: `welinkin-ppt`, the `welinkinTemplatePath` field the `office` plugin reads, and the `runner/templates/welinkin-ppt.pptx` path the installer stages the template at. A Session that recorded the previous kind folds to a value no build renders and `parseOfficeChoice` refuses off the wire; the member re-picks the kind.

`docs/config-catalog.md` and `docs/module-graph.md` were edited by hand for the removed package. `gen-config-catalog` fails on unrelated spread fields in three Team packages, and `gen-module-graph` reports the English graph stale by roughly forty packages that predate this change; regenerating either would have buried the removal in unrelated churn, and the Chinese graph has no generator at all.
