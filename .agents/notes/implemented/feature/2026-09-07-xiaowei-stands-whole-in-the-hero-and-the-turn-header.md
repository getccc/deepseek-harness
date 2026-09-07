# Agent Note: 小微 stands whole in the hero and the turn header

Status: implemented

English | [中文](2026-09-07-xiaowei-stands-whole-in-the-hero-and-the-turn-header.zh.md)

## Problem

[小微 is the assistant's name and face](2026-09-05-xiaowei-is-the-assistants-name-and-face.md) gave the assistant a likeness: a circular crop of the mascot's head, because the only artwork then sat on a white ground and the white body could not be lifted off it cleanly at the wings and the feet. The crop shows an avatar, not the mascot: the raised wing, the badge on the chest, and the spread wings, the parts that make the white pigeon 小微 rather than any white bird, are outside the circle. The product owner asked for the whole figure wherever 小微 appears, and supplied new artwork of the same pigeon, waving, with the holographic badge on its chest, on a transparent ground.

## Decision

**The one inlined source is the whole figure.** [`xiaowei-avatar.ts`](../../../../packages/team/team-local-login/src/xiaowei-avatar.ts) exports `XIAOWEI_FIGURE_SOURCE`, a 320×278 WebP of the new artwork trimmed to the figure's own bounds with a 1% margin and its transparent ground kept, 17 KB binary and 23 KB as a data URI, with `XIAOWEI_FIGURE_WIDTH` and `XIAOWEI_FIGURE_HEIGHT` as the drawn size. Lossy WebP at quality 85 keeps the alpha channel. No consumer crops it: there is no border radius and no disc.

**Each consumer draws it whole at its own width.** The hero draws the figure 160 px wide, 139 px tall, above the greeting; the turn header draws it 52 px wide, 45 px tall, in the gutter. Both size by width with `height: auto`, so the image's own aspect ratio holds. Because the ground is transparent, the shadow is a `drop-shadow` filter along the outline rather than a box shadow, and the ring in the layer colour that lifted the white disc is gone: the figure's own grey shading and the outline shadow separate it from the light theme, and the white body reads on the dark theme without a frame.

**The header's hang grows with the figure.** The `--hang` cap in [`AssistantIdentity.module.css`](../../../../packages/team/team-local-login/src/client/AssistantIdentity.module.css) is the figure's 52 px plus its 4 px margin and the row's 8 px gap, 64 px, so the name still sits on the content column's left edge wherever the column leaves at least 80 px of gutter.

## Alternatives considered

**Keep the head crop in the turn header and show the whole figure only in the hero.** A 45 px figure is small: the head is about 18 px tall. Rejected: the request was for the whole figure wherever 小微 appears, one source with two consumers is the arrangement the earlier note chose so the likeness changes in one place, and at 52 px the wave and the badge still read.

**A PNG source.** Rejected: the same figure is 86 KB as PNG and 17 KB as lossy WebP with alpha, and every browser this product supports decodes WebP with alpha.

**An asset route instead of 23 KB inlined in the client bundle.** Rejected for the reason the earlier note inlined the crop: neither the login page nor the client bundle needs an asset route, and the bundle grows by less than a small icon font.

**A circular frame around the whole figure.** Rejected: a circle around a standing figure either clips the wings and the feet or shrinks the pigeon inside it, which is the head-only look the owner asked to leave.

## Consequences

The hero stack is 143 px taller than a hero without a figure, the figure plus its 4 px margin, so the composer sits 39 px lower on a blank session than it did with the crop. The turn header row is 45 px tall. The `team-local-login` client bundle grows by about 10 KB over the crop; the login document is unchanged, and the login route suite still pins the absence of any inlined image there.

Web expected outputs are unchanged: the generic scenarios do not mount the team layer, and the figure's ARIA output is its `alt`, which the dictionaries still own. The hero and launcher suites pin the figure's presence, its `alt`, and its data URI source. No test pins the drawn size or the absence of a crop; those are CSS, checked by eye against a rendered mock of both themes.
