---
description: "What a model sees of the office-deliverable choice: the office:kind prompt section naming the document kind to produce, and the projection a composer chip reads."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-office

English | [中文](README.zh.md)

## Summary

`dsh-tool-office` is everything the model sees of a conversation's office choice: one prompt section that names the document kind to produce, and — for the AMEC PowerPoint kind — the template path to build from. It registers no tool of its own; the univer office tools produce the file. The section is a fold over the `office/kind` Session log, and a composer chip reads the same fold as the `office` projection, so the picker and the model never disagree. A Session that chose nothing has no section.

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
    amecTemplatePath: /absolute/path/to/amec-ppt.pptx
```

| Field | Default | Meaning |
|---|---|---|
| `amecTemplatePath` | — | The AMEC PowerPoint template the `amec-ppt` kind imports; absent sends the model to an AMEC template skill in the session catalog instead |

A log with no `office/kind` event folds to `none`, so a fresh Session gets no section. A member chooses through the composer chip, which records the choice; the section then names the format.

-----

<a id="model-experience"></a>
## Model Experience

### System prompt

#### What the model sees

One section, `office:kind`, whose text is chosen by the Session's folded office choice. It is absent entirely while the choice is `none`. Each kind names the format to produce; `amec-ppt` additionally carries the configured template path to import and preserve, or, when no template is configured, the instruction to load an AMEC template skill from the session catalog and import the template it names; the section never asserts that no template exists and names no palette of its own. `chart` names no file at all: it asks for `echarts` fences the web surface renders in place.

##### With a Word, PowerPoint, or Excel kind chosen

```markdown
Produce the deliverable as a PowerPoint presentation (.pptx) with the univer office tools: create or import a .pptx Unit, build the slides there, and hand back the file.
```

##### With the AMEC PowerPoint template kind chosen

```markdown
Produce the deliverable as a PowerPoint presentation built from the AMEC company template at <the configured template path>: import it with the univer office tools as the starting Unit, keep its slide masters, layouts, fonts, and brand colours, and replace only the content. Hand back the .pptx.
```

##### With the AMEC PowerPoint template kind chosen and no template configured

```markdown
Produce the deliverable as a PowerPoint presentation built from the AMEC company template, using the univer office tools. No template path is configured here, so find the template through the session skill catalog: if it lists an AMEC PowerPoint template skill, load that skill first and import the template it names as the starting Unit, keeping its slide masters, layouts, fonts, and brand colours and replacing only the content. If the catalog lists no such skill, say that the AMEC template is not reachable before building a plain .pptx.
```

##### With the visualization kind chosen

```markdown
Produce the deliverable as interactive charts in the answer itself. Write one fenced code block per chart whose info string is exactly `echarts`, holding nothing but a strict-JSON Apache ECharts option: double-quoted keys and strings, no comments, no trailing commas, and no JavaScript functions, expressions, `renderItem`, or event handlers. String formatters such as "{value}%" are supported. Keep the explanation in prose outside the fence.
```

#### Token effect

Nothing while the choice is `none`. Otherwise one short fixed paragraph; the `amec-ppt` paragraph also carries the template path, which does not grow with the conversation.

#### KV Cache effect

Prefix-stable while the choice is unchanged. Choosing a kind, changing it, or clearing it rewrites this section, so the following request re-reads its prefix from `office:kind` onward.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The section instructs; it does not enforce** — producing the named format is the univer office tools' work, and a model may still choose otherwise; the section is guidance, not a gate.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The `office` projection key is declared in `src/types.ts`, imported by the composer chip through `./client`, so the browser and this Host fold share one key and value.

</details>
