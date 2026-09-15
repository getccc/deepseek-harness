# Agent Note: The desktop installer ships the office build

Status: implemented

English | [中文](2026-09-15-the-desktop-installer-ships-the-office-build.zh.md)

## Problem

The office picker's Word, Excel, and PowerPoint kinds build with the univer office tools and start from skills with verified build steps ([office deliverables return to the univer tools](2026-09-11-office-deliverables-return-to-the-univer-tools.md), [office builds take few tool calls](2026-09-15-office-builds-take-few-tool-calls.md)). The desktop installer carried none of it: after the upstream merge its shipped plugin layer list was empty, so a packaged Runner mounted neither `dsh-univer-office` nor the ECharts renderer, staged no skill, and set no office skill. A packaged member got office instructions naming tools that did not exist. The skill route also named no template file, while a packaged Runner stages the template at an installation-specific path inside the application bundle.

## Decision

**The installer mounts the office plugins from its plugin tree.** `SHIPPED_PLUGIN_BUNDLES` names `dsh-univer-office` and `@dsh-external/dsh-echarts`, so `DSH_TEAM_PLUGIN_TREE` must carry both. A pnpm patch recorded in the staging profile ships as patched files, which is how the univer raster-export repair reaches members.

**The installer ships the office skills.** `DSH_TEAM_SKILLS` stages a directory of skill folders as `runner/skills`, and the deployment patch adds that directory to `skill-filesystem`'s `customSkillDirs`, scanned beside the member's own roots. `DSH_TEAM_PPT_SKILL`, `DSH_TEAM_WORD_SKILL`, and `DSH_TEAM_EXCEL_SKILL` name the skill each office kind loads first; packaging fails unless each names a folder inside `DSH_TEAM_SKILLS`. The names are recorded in application metadata as `teamOfficeSkills` and written into the `office` row as `pptSkill`, `wordSkill`, and `excelSkill` beside the staged template path. The deployment refuses office skills without a staged skill directory.

**The PowerPoint skill route names the template file.** When both `pptSkill` and `welinkinTemplatePath` are configured, the `ppt` section keeps the skill as the workflow owner and adds the template file path with the instruction to use it wherever the skill names the template. This replaces the earlier rule that the skill branch names no template path.

## Alternatives considered

- **Copy the skills into the private Harness home's `skills` directory.** Rejected: that root belongs to the member, and an application upgrade would have to overwrite or merge files a member may have edited.
- **Keep the template path inside the skill.** Rejected: the path differs between a developer profile and each packaged installation, and only the deployment patch knows it.
- **One variable mapping kinds to skills.** Rejected: three variables validate independently and match the three `tool-office` keys one to one.

## Consequences

A macOS installer that ships the office build needs a staging profile with both plugins installed, the skills directory, and the three skill names; a build without them still packages and mounts no office plugin. The plugin tree adds several hundred megabytes, cloned once per application version. `deployment.spec.ts` pins the office row, the skill root, the skill-directory refusal, and the layer list; `section.spec.ts` pins the template sentence on the skill branch.
