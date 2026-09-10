# Agent Note: One PowerPoint row carries the company template

Status: implemented

English | [中文](2026-09-09-one-powerpoint-row-carries-the-company-template.zh.md)

## Problem

The composer's office picker offered two PowerPoint rows. `ppt` built a deck on a blank Slide Unit; `welinkin-ppt` imported the template the installer staged. Choosing between them asked the member to know something only the deployment knows — whether a template is configured at all — and the wrong answer is silent: on a Runner that ships a template, `ppt` produces an off-brand deck that looks finished. No member wants the blank deck when the company template exists, so the choice had no useful side.

The rows also carried no marks. Four labels of similar length in one column are told apart only by reading each, and the picker is the one composer control whose options are formats a member recognizes by icon everywhere else.

## Decision

**`ppt` is the only PowerPoint kind, and the configured template is what it builds from.** `welinkin-ppt` is gone from `OfficeKind`, `OFFICE_KINDS`, the chip's local mirror of it, the Remote wire union, and the projection's validator. `renderOfficeSection`'s `ppt` branch carries what the template kind carried: with `welinkinTemplatePath` set it names the path and the import-and-preserve instruction; with none set it keeps the skill route [the office section defers to the template skill](../bug-fix/2026-09-06-the-office-section-defers-to-the-template-skill.md) established, ending in a plain `.pptx` when the catalog lists no template skill. A deployment that stages no template is what yields a blank deck now, not a second row.

**The section names no brand.** The fallback used to send the model after a "Welinkin PowerPoint template skill", but the deployment names its own catalog entry — a staged tree carries `amec-ppt` as readily as `welinkin-ppt` — so the section asks for a PowerPoint template skill and calls the file the company template. This extends the rule that note already owns: the section states only what the configuration knows, and the skill's name is not that.

**A kind this build does not know imposes no format.** `foldOfficeChoice` reads each recorded value through `parseOfficeChoice`, whose contract already covered a stored log, and the projection's `apply` reads it the same way. A Session that chose `welinkin-ppt` under the older build folds to `none`: the member re-picks, and neither the prompt section nor the chip is handed a value it has no branch for. Mapping the retired kind onto `ppt` would be a compatibility shim, which the [pre-release stance](../../../../AGENTS.md#pre-stable-apis-and-released-session-data) rules out while `SESSION_FORMAT_VERSION` is `0`.

**Each row carries its own glyph.** `IconDocumentOutline16`, `IconSpreadsheetOutline16`, `IconSlidesOutline16`, and `IconChartOutline16` join the primitives set as harness-drawn glyphs — the figma source the rest of the set comes from carries no office-kind marks. They are rounded-rect outlines at one 1.15px thickness so the four read as a family beside the extracted glyphs, and the chip maps kind to glyph beside the display order it already owned.

**`welinkinTemplatePath` keeps its name.** It names the template file, not the retired kind, so the desktop shell's `DSH_TEAM_PPT_TEMPLATE` staging, the bundle comment, and every `office` patch row a source-launched profile carries keep working unchanged.

## Alternatives considered

**Keep both rows and mark the template one as the default.** Rejected: a default the member can override is still a choice presented, and the losing branch is the one nobody wants. The picker would keep asking a question whose answer the deployment already gave by staging a template or not.

**Rename `welinkinTemplatePath` to `pptTemplatePath`.** Rejected on blast radius against zero gain in accuracy: the key names the template, which is still a Welinkin artifact, and the rename would break quietly. Schemastery neither strips nor rejects an unknown config key, so a deployment whose `office` row still named the old key would load fine while the plugin read `undefined` and fell back to the skill route — a Runner that looks configured and is not.

**Reuse existing primitives for the four marks.** Rejected: the set's nearest glyphs are a list-with-pen, a folder, and a data cylinder, none of which say Word, Excel, PowerPoint, or chart. Borrowing them would make two rows share visual vocabulary with unrelated controls elsewhere in the composer.

**Show the chosen kind's glyph on the chip trigger too.** Not taken here: the trigger's fixed mark is what makes the collapsed chip recognizable as the office control, and the tinted label already names the choice.

## Consequences

The picker is four rows where it was five, and the one PowerPoint row's behavior now depends on deployment configuration rather than on which row the member picked. A Runner with no template and no template skill still reaches a plain deck, so no build loses the ability to make one.

Prompt text changed for every PowerPoint conversation, so `packages/office/tool-office/tests/section.spec.ts` pins both branches, and pins that the fallback names no brand. `packages/office/office/tests/scope.spec.ts` and the section spec pin the retired-kind fold from both the section and the projection side. No shipped snapshot changes: no recorded-session fixture chooses an office kind, the same gap [the picker note](../feature/2026-09-03-composer-office-deliverable-picker.md) records.

The primitives icon set now mixes drawn glyphs with figma extracts. The count assertion in `packages/client/ui-primitives/tests/icons.client.spec.tsx` names the three groups, so a future extract that replaces one of these four has a place to land.
