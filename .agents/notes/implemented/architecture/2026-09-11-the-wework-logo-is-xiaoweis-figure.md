# Agent Note: The WeWork logo is 小微's figure

Status: implemented

English | [中文](2026-09-11-the-wework-logo-is-xiaoweis-figure.zh.md)

## Problem

The product carried two artworks with separate jobs. The Welinkin company mark filled every brand place the source tree owns — the sidebar brand row, both favicons, the administration console, and the Runner-local sign-in page — while 小微's figure appeared only where the assistant speaks. [小微 is the assistant's name and face](../feature/2026-09-05-xiaowei-is-the-assistants-name-and-face.md) kept them apart on purpose: it rejected the face in the sidebar brand slot and the application icon because those places named the company. The product owner renamed the product from `Welinkin Work` to `WeWork` and asked that every logo be the mascot artwork, the white pigeon waving with the holographic badge on its chest.

## Decision

**The logo is 小微's whole figure.** The supplied artwork is the same 2000×2000 transparent-ground image that [小微 stands whole in the hero and the turn header](../feature/2026-09-07-xiaowei-stands-whole-in-the-hero-and-the-turn-header.md) encodes as the assistant's likeness. The logo is that image trimmed to the figure's own bounds, resized to 128×111, and encoded as lossy WebP at quality 90 with its alpha channel: 6.4 KB binary, 8.5 KB as a data URI. The sidebar draws it 32 px wide in both the brand row and the collapsed rail, both sign-in pages draw it 56 px wide, and the administration console's sider 26 px; 128 px covers the widest, 56 px, at 2× density.

**The five homes carry it byte for byte.** It replaces the Welinkin mark wherever [WeWork is the only product identity](2026-09-07-wework-is-the-only-product-identity.md) lists a copy, and each home carries the 128:111 ratio. The shell primitive is named for the product, `WeWorkLogo`, and the administration console exports `WEWORK_LOGO_SOURCE`, `WEWORK_LOGO_WIDTH`, and `WEWORK_LOGO_HEIGHT`. Both favicons declare a WebP image, and `favicon.svg` centres the figure in its 50-unit square.

**The sign-in page shows the figure but does not introduce the assistant.** The Runner-local sign-in page draws the logo beside `WeWork` and the workspace label, over `欢迎回来`. It carries no introduction sentence, because a member who has not signed in is not yet talking to the assistant.

**The logo and the likeness keep separate encodings.** `XIAOWEI_FIGURE_SOURCE` stays the assistant's face at 320×278 for the 160 px hero; the logo is its own 128×111 encoding. Both derive from one artwork, so replacing the mascot means re-encoding both.

## Alternatives considered

**Draw `XIAOWEI_FIGURE_SOURCE` as the sign-in page's logo.** `team-local-login` already inlines it, so this would remove one of the five copies. Rejected: it is sized for the hero, 23 KB as a data URI against 8.5 KB, and its ratio and margin differ from the four copies it must match, so "replace all five" would stop being a literal instruction.

**Crop the logo to the head for the 16 to 26 px places.** A head crop reads better in a favicon than a whole figure whose head is a third of its height. Rejected: the request was the supplied image as the logo, and at the console sider's 26 px the wave, the badge, and the eyes still read.

**PNG, as the Welinkin mark was.** Rejected: an RGBA PNG of the figure is 20 KB, and a 256-colour palette PNG bands the shaded body and loses the eye colour, while lossy WebP with alpha is 6.4 KB and indistinguishable at every drawn size. The likeness already ships as WebP, and every supported browser and the Electron shell decode it.

## Consequences

The window's brand row, the tab, and the sign-in pages now show the face the hero shows, so the product and its assistant share one likeness. [小微 is the assistant's name and face](../feature/2026-09-05-xiaowei-is-the-assistants-name-and-face.md) keeps its rejection of the face as the company mark as history and links here.

The application icon and the menu bar template stay packaging inputs outside the source tree, `DSH_TEAM_APP_ICON` and `DSH_TEAM_TRAY_ICON`, so an installer shows the figure only when its packaging supplies figure-derived images.

`ui-primitives` pins the logo's WebP source and ratio; the sidebar snapshot carries the new data URI; the manifest e2e pins the favicon's WebP image; the login route suite pins the lockup. No test compares the five copies with one another.
