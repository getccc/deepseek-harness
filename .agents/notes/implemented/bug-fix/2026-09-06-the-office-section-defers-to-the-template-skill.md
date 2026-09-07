# Agent Note: the office section defers to the template skill

Status: implemented

English | [中文](2026-09-06-the-office-section-defers-to-the-template-skill.zh.md)

## Problem

A member of the Team Runner picked `AMEC PPT 模版` in the composer's office chip, asked for a deck, and received a dark-navy presentation drawn on a blank Slide Unit. The choice had been recorded: the Session log held the `office/kind` event before the first turn, and the `office:kind` section was in the system prompt. The section itself is what made the model skip the template. With no `amecTemplatePath` configured, it read "This build carries no AMEC template file, so build the deck to match that style" and named a palette, dark navy `#0A1E3A` with a gradient from `#0066CC` to `#00A3E0`, that had been written into the plugin rather than taken from any template.

On that Runner the template existed at `~/.dsh/templates/amec/AMEC-PPT.pptx`, and the session skill catalog listed an `amec-ppt` skill naming that path and the template's measured palette, `#0664B1` on `#F2F8FF`. The model loaded the skill, confirmed the file with `ls`, and still followed the section: its logged reasoning weighs the two and chooses the section because a system-level statement outranks a loaded skill. Only a later user message asking for the template outranked the section in turn.

One fixed string carried two defects. It asserted a fact about the environment that the plugin cannot know, and it invented brand identity that a template already owns.

## Decision

**With no template path configured, the `office:kind` section sends the model to the session skill catalog instead of describing the template.** The `amec-ppt` fallback in `renderOfficeSection` (`packages/office/tool-office/src/index.ts`) states that no template path is configured here, tells the model to load an AMEC PowerPoint template skill if the catalog lists one and to import the template that skill names as the starting Unit, keeping its masters, layouts, fonts, and brand colours, and, when the catalog lists no such skill, to say the template is not reachable before building a plain `.pptx`. It names no colours and asserts nothing about which files exist.

**The section states only what the configuration knows.** "No template path is configured here" is a fact about the `office` row. Whether a template exists on the machine is not; a skill, or the model's own inspection, establishes that.

**The configured branch is unchanged.** When `amecTemplatePath` is set, the section names the path and the import-and-preserve instruction, which agrees with the `amec-ppt` skill's workflow; the two sources name the same file.

## Alternatives considered

**Copy the template's measured palette into the fallback.** Rejected: it corrects the colours and keeps the defect. The plugin would again own brand facts that live in the template and its skill, and the next template change would leave the section wrong in the same way.

**Have the section read `~/.dsh/skills` or the skill registry to decide whether a template skill exists.** Rejected: the section would then assert a second environment fact from a second reader, and a skill under another name would defeat the check. The model already holds the catalog in its prompt and the `skill` tool; the section points at those.

**Drop the fallback and refuse to load without `amecTemplatePath`.** Rejected: the Team bundle leaves the path absent on purpose, because only the installer knows where a staged template landed, and failing at load would remove the option from every build without a staged template, including a source-launched profile whose template is reachable through a skill.

**Make the loaded skill outrank the system prompt.** Not available: that ranking is the model's. A section that contradicts a skill is the defect, not the ranking.

## Consequences

A conversation whose office choice is `amec-ppt` on a Runner with no `office` row now reaches the skill's template instead of a fabricated style, and a Runner with neither a row nor a skill is told that the template is unreachable rather than handed a deck in invented colours. The section grows by one sentence in the fallback case only.

The section still instructs and does not enforce; a model may choose otherwise. The `amec-ppt` skill and the `office` row are two places that name the template path, and they can disagree: an installer that stages a template writes the row, and the skill should name the same file.

`packages/office/tool-office/tests/section.spec.ts` pins the fallback: it names the skill route, keeps the import-and-preserve instruction, asserts nothing about missing files, and contains no hex colour. The keyless recorded-session snapshots carry no `office/kind` event, so none changes; a snapshot proving the section against a recorded choice stays deferred as [the picker note](../feature/2026-09-03-composer-office-deliverable-picker.md) records.
