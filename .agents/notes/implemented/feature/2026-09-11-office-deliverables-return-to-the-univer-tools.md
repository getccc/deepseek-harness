# Agent Note: Office deliverables return to the univer tools

Status: implemented

English | [中文](2026-09-11-office-deliverables-return-to-the-univer-tools.zh.md)

## Problem

After the [two-stage upstream merge](../process/2026-09-10-two-stage-upstream-merge.md), the office prompt section asked the model to write Word, Excel, and PowerPoint files with whatever scripts the environment offered ([office deliverables reach the reader through present](2026-09-10-office-deliverables-through-present.md)). On the Team Runner that produced documents of a different kind than before: no live preview while the model works, no review step, no company slide masters unless a script happened to preserve them, and a PowerPoint that ignored the `amec-ppt` skill the deployment wrote for exactly this. The member who owns that deployment wants the previous plugin mode back, and every PowerPoint to start from that skill.

## Decision

**`dsh-univer-office` is installed into the Team profile again, and the section names its tools.** The Word and Excel kinds ask for a `.docx` or `.xlsx` Unit created or imported with the univer office tools, edited there, exported under the working directory, and declared with `present`; the delivery sentence stays, because upstream's deliverables row still lists only declared files. The chart kind asks for strict-JSON `echarts` fences in the answer again, and `@dsh-external/dsh-echarts` is installed into the Team profile to draw them; a fence is not a file, so that kind carries no delivery sentence.

**A configured skill owns the PowerPoint workflow.** `dsh-tool-office` gains `pptSkill`, the name of a session-catalog skill; when it is set, the `ppt` section tells the model to load that skill with the skill tool before anything else and follow it, and names neither the template path nor the layouts, because the skill does. `pptSkill` outranks `welinkinTemplatePath`: the path branch and the catalog-search branch are unchanged and apply only without a skill. The source-launched `team` profile sets `pptSkill: amec-ppt` in its `office` patch row beside the template path; the desktop shell stages no skill and so sets no such key.

This supersedes the tool-naming half of the present-tool note; its delivery rule stands.

## Alternatives considered

- **Keep the script route and only add the skill.** Rejected: the `amec-ppt` skill's workflow is the univer tools (`univer_import`, `univer_compile_svg`, `univer_export`), so a section that sends the model to the skill while telling it to use python-pptx contradicts itself.
- **Hardcode `amec-ppt` in the section.** Rejected: the section states only what the configuration knows ([the office section defers to the template skill](../bug-fix/2026-09-06-the-office-section-defers-to-the-template-skill.md)), and the deployment names its own catalog entry.
- **Keep the chart kind on SVG files opened from the Sidebar.** Tried first, to avoid a GitHub-hosted build; the member asked for the interactive charts back, so the ECharts plugin returned with the univer one.

## Consequences

The Team profile carries two third-party plugins again, each with a peer range behind upstream's version; a Runner boot proves it loads, and `docs/` records nothing about it beyond the README's deployment-dependency limitation. `section.spec.ts` pins the univer wording for each kind, the skill branch and its precedence over the path, and the delivery tail. Recorded-session snapshots still carry no office section.
