---
description: "What a model sees of the office-deliverable choice: the office:kind prompt section naming the document kind to produce, and the projection a composer chip reads."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-office

English | [中文](README.zh.md)

## Summary

`dsh-tool-office` is everything the model sees of a conversation's office choice: one prompt section naming the document kind to produce and, for a PowerPoint, the skill or company template to build from. It registers no tool: the model builds the document with the univer office tools the Team deployment installs, exports it, and declares the file with `present`, which lists it in the deliverables row and the Sidebar. The section folds the `office/kind` Session log, and a composer chip reads the same fold as the `office` projection, so the picker and the model never disagree.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount it in a Team composition beside the office Remote and the composer chip:

```yaml
- name: '@deepseek-ai/dsh-tool-office'
  config:
    pptSkill: amec-ppt
    welinkinTemplatePath: /absolute/path/to/company-template.pptx
```

| Field | Default | Meaning |
|---|---|---|
| `pptSkill` | — | The session-catalog skill every `ppt` deliverable starts by loading; it owns the template workflow and outranks the path below |
| `welinkinTemplatePath` | — | The PowerPoint template every `ppt` deliverable is built from when no skill is configured; absent sends the model to a template skill in the session catalog instead |

A log with no `office/kind` event folds to `none`, so a fresh Session gets no section. A member chooses through the composer chip, which records the choice; the section then names the format.

-----

<a id="model-experience"></a>
## Model Experience

### System prompt

#### What the model sees

One section, `office:kind`, whose text is chosen by the Session's folded office choice. It is absent entirely while the choice is `none`. Each document kind names the format to produce with the univer office tools; `ppt` additionally carries the configured skill to load first, or the configured template path to import and preserve, or, when neither is configured, the instruction to load a template skill from the session catalog and import the template it names; the section never asserts that no template exists, and it names neither a palette nor a brand of its own. `chart` asks for one strict-JSON `echarts` fence per chart in the answer, which the ECharts plugin the Team deployment installs draws in place. Every file-producing kind ends with the same delivery rule: the file reaches the reader only through the `present` tool, never by naming its path.

##### With the Word or Excel kind chosen

```markdown
Produce the deliverable as a Word document (.docx) with the univer office tools: create or import a .docx Unit, write and lay the document out there, export the finished file under the working directory, then declare it with the present tool so the reader receives it. Mentioning the path in the reply does not deliver the file; only the present call does.
```

##### With the PowerPoint kind chosen and a skill configured

```markdown
Produce the deliverable as a PowerPoint presentation (.pptx) built from the company template. Before anything else, load the skill named <the configured skill> with the skill tool and follow it: it names the template to import as the starting Unit with the univer office tools and the layouts, colours, and type sizes to keep. Then export the finished file under the working directory, then declare it with the present tool so the reader receives it. Mentioning the path in the reply does not deliver the file; only the present call does.
```

##### With the PowerPoint kind chosen and only a template path configured

```markdown
Produce the deliverable as a PowerPoint presentation (.pptx) built from the company template at <the configured template path>: import it with the univer office tools as the starting Unit, keep its slide masters, layouts, fonts, and brand colours, and replace only the content. Then export the finished file under the working directory, then declare it with the present tool so the reader receives it. Mentioning the path in the reply does not deliver the file; only the present call does.
```

##### With the PowerPoint kind chosen and neither configured

```markdown
Produce the deliverable as a PowerPoint presentation (.pptx) built from the company template, using the univer office tools. No template path is configured here, so find the template through the session skill catalog: if it lists a PowerPoint template skill, load that skill first and import the template it names as the starting Unit, keeping its slide masters, layouts, fonts, and brand colours and replacing only the content. If the catalog lists no such skill, say that the company template is not reachable before building a plain .pptx. Then export the finished file under the working directory, then declare it with the present tool so the reader receives it. Mentioning the path in the reply does not deliver the file; only the present call does.
```

##### With the visualization kind chosen

```markdown
Produce the deliverable as interactive charts in the answer itself. Write one fenced code block per chart whose info string is exactly `echarts`, holding nothing but a strict-JSON Apache ECharts option: double-quoted keys and strings, no comments, no trailing commas, and no JavaScript functions, expressions, `renderItem`, or event handlers. String formatters such as "{value}%" are supported. Keep the explanation in prose outside the fence.
```

#### Token effect

Nothing while the choice is `none`. Otherwise one short fixed paragraph; the `ppt` paragraph also carries the skill name or template path, which does not grow with the conversation.

#### KV Cache effect

Prefix-stable while the choice is unchanged. Choosing a kind, changing it, or clearing it rewrites this section, so the following request re-reads its prefix from `office:kind` onward.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The section instructs; it does not enforce** — producing the named format is the model's work with the univer office tools the deployment installs, and a model may still choose otherwise; the section is guidance, not a gate.
- **The univer office tools are a deployment dependency** — the section names tools that `dsh-univer-office`, installed into the Team profile, registers; a profile without that plugin gets instructions its model cannot follow.
- **Charts need the ECharts plugin** — the chart kind asks for `echarts` fences that `@dsh-external/dsh-echarts`, installed into the Team profile, renders; a profile without it shows the fence as code.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The `office` projection key is declared in `src/types.ts`, imported by the composer chip through `./client`, so the browser and this Host fold share one key and value.

</details>

**Runtime invariant:** No companion is published: the prompt section and projection are pure folds of the Session log; nothing is held between calls and no registry is owned, and the projection registration's disposal is proven by the HMR-safety test.
