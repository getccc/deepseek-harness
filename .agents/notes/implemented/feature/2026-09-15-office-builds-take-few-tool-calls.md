# Agent Note: Office builds take few tool calls

Status: implemented

English | [中文](2026-09-15-office-builds-take-few-tool-calls.zh.md)

## Problem

Office deliverables built with the univer tools ([office deliverables return to the univer tools](2026-09-11-office-deliverables-return-to-the-univer-tools.md)) took tens of minutes to two hours, and the results disappointed. The recorded Team sessions show why. Tool execution was a small share of the time: a 101-minute PowerPoint turn spent 95 minutes waiting on 199 model requests and 4 minutes running tools. The step count came from three habits. The model discovered the Facade API at run time, and each `univer_api show` of a whole class returned about 13 KB, so an Excel turn grew its context from 40K to 82K tokens in five steps. It issued one small edit or check per request and screenshotted page by page. And when `univer_export` rejected the same error repeatedly, it spent about 90 steps working around it, finally hand-assembling the `.pptx` XML outside the univer tools. A long turn also meets rare upstream faults: one Excel turn ended with `STREAM_CLOSED` after a 60-second silent pause, because the retry policy does not retry that code by default.

## Decision

**The office section asks every univer-built kind for a short build.** Word, Excel, and every PowerPoint branch carry one fixed economy sentence before the delivery rule: write a Unit's content in one `univer_execute` script, issue independent calls together, look up only the exact Facade method that is missing rather than showing a whole class, and stop and report after the same univer tool fails with the same error twice instead of rebuilding the file another way.

**Word and Excel can start from a configured skill, as PowerPoint already does.** `dsh-tool-office` gains `wordSkill` and `excelSkill`, symmetric with `pptSkill`: when set, the kind's section tells the model to load that session-catalog skill before its first univer call and follow its verified build steps. The section names no skill of its own, because the deployment names its catalog entries ([the office section defers to the template skill](../bug-fix/2026-09-06-the-office-section-defers-to-the-template-skill.md)).

**The Team bundle retries a stream closed without `[DONE]`.** Its `llm-deepseek` row sets `retryPolicy` to the default normal-mode codes plus `STREAM_CLOSED`. The list restates the defaults because a configured list replaces them.

## Alternatives considered

- **Leave the univer tools and write files with scripts.** Deferred, not rejected: the member who owns the deployment tests the faster univer path first and then decides. Scripts lose the live preview and review card that brought the univer tools back.
- **Put the verified recipes in the section itself.** Rejected: the recipes run to several kilobytes per kind, and the section is resent on every request of every office Session, including turns that never build a file. A skill loads only when the model starts a build.
- **Hardcode skill names in the section.** Rejected for the same reason `pptSkill` is configuration: only the installation knows which skills it ships.
- **Retry `STREAM_CLOSED` everywhere by changing the default policy.** Rejected here: the default belongs to `dsh-llm`, and a clean partial EOF can repeat a costly generation. The Team deployment accepts that cost because a failed office turn costs more.

## Consequences

Every univer-built section grows by one sentence of about 70 tokens, fixed per kind. The economy rule is guidance: a model may still split a build, and the skill carries the concrete steps. A Word or Excel section without a configured skill still gets the economy rule. A retried closed stream repeats the lost request's tokens.

Two deployment facts sit outside this repository and are recorded here because the section's instructions depend on them. `dsh-univer-office` 0.2.14 stores every imported or inserted PNG and JPEG as a UUID asset, while its exporter accepts only inline base64 sources, so any deck with a raster image, including every deck imported from the company template, fails `univer_export`. The dev Team profile carries a pnpm patch that reads each asset back through the Gateway's asset route before export. The verified `office-word`, `office-excel`, and rewritten `amec-ppt` skills live in that machine's user skill catalog under `$DSH_HOME/skills`; a packaged Runner's private DSH home carries neither the patch nor the skills until its installer stages them.

`section.spec.ts` pins the skill sentence for Word and Excel, its absence without a skill, and the economy sentence on every univer-built branch; `team.spec.ts` pins the retry codes.
