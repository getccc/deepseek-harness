---
description: "What a model sees of the office-deliverable choice: the office:kind prompt section naming the document kind to produce, and the projection a composer chip reads."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-office

English | [中文](README.zh.md)

## Summary

`dsh-tool-office` is everything the model sees of a conversation's office choice: one prompt section that names the document kind to produce, and — for a PowerPoint — the company template path to build from. It registers no tool: the model writes the file with the environment's scripts and declares it with `present`, which lists it in the deliverables row and the Sidebar. The section is a fold over the `office/kind` Session log, and a composer chip reads the same fold as the `office` projection, so the picker and the model never disagree. A Session that chose nothing has no section.

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
    welinkinTemplatePath: /absolute/path/to/company-template.pptx
```

| Field | Default | Meaning |
|---|---|---|
| `welinkinTemplatePath` | — | The PowerPoint template every `ppt` deliverable is built from; absent sends the model to a template skill in the session catalog instead |

A log with no `office/kind` event folds to `none`, so a fresh Session gets no section. A member chooses through the composer chip, which records the choice; the section then names the format.

-----

<a id="model-experience"></a>
## Model Experience

### System prompt

#### What the model sees

One section, `office:kind`, whose text is chosen by the Session's folded office choice. It is absent entirely while the choice is `none`. Each kind names the format to produce; `ppt` additionally carries the configured template path to import and preserve, or, when no template is configured, the instruction to load a template skill from the session catalog and import the template it names; the section never asserts that no template exists, and it names neither a palette nor a brand of its own. `chart` asks for one SVG file per chart, opened from the Sidebar. Every file-producing kind ends with the same delivery rule: the file reaches the reader only through the `present` tool, never by naming its path.

##### With the Word or Excel kind chosen

```markdown
Produce the deliverable as a Word document (.docx): write the file under the working directory with a script or command available here (python-docx, docx for Node, or a converter such as pandoc), then declare it with the present tool so the reader receives it. Mentioning the path in the reply does not deliver the file; only the present call does.
```

##### With the PowerPoint kind chosen

```markdown
Produce the deliverable as a PowerPoint presentation (.pptx) built from the company template at <the configured template path>: copy the template into the working directory and edit the copy with a script available here (python-pptx or pptxgenjs), keep its slide masters, layouts, fonts, and brand colours, and replace only the content. Declare the finished file with the present tool. Mentioning the path in the reply does not deliver the file; only the present call does.
```

##### With the PowerPoint kind chosen and no template configured

```markdown
Produce the deliverable as a PowerPoint presentation (.pptx) built from the company template. No template path is configured here, so find the template through the session skill catalog: if it lists a PowerPoint template skill, load that skill first, copy the template it names into the working directory, and edit the copy with a script available here (python-pptx or pptxgenjs), keeping its slide masters, layouts, fonts, and brand colours and replacing only the content. If the catalog lists no such skill, say that the company template is not reachable before building a plain .pptx. Declare the finished file with the present tool. Mentioning the path in the reply does not deliver the file; only the present call does.
```

##### With the visualization kind chosen

```markdown
Produce the deliverable as charts the reader can open from the Sidebar: render each chart to its own SVG file under the working directory with a script available here (matplotlib, plotly's static export, or hand-written SVG for simple charts), with the data embedded, axis labels, and a legend, then declare every file with the present tool. Keep the explanation in prose; do not paste chart markup or data tables into the reply. Mentioning the path in the reply does not deliver the file; only the present call does.
```

#### Token effect

Nothing while the choice is `none`. Otherwise one short fixed paragraph; the `ppt` paragraph also carries the template path, which does not grow with the conversation.

#### KV Cache effect

Prefix-stable while the choice is unchanged. Choosing a kind, changing it, or clearing it rewrites this section, so the following request re-reads its prefix from `office:kind` onward.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The section instructs; it does not enforce** — producing the named format is the model's work with whatever scripts the environment offers, and a model may still choose otherwise; the section is guidance, not a gate.
- **Charts are static** — the chart kind asks for SVG files opened from the Sidebar, not the interactive ECharts fences the retired third-party plugin rendered.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The `office` projection key is declared in `src/types.ts`, imported by the composer chip through `./client`, so the browser and this Host fold share one key and value.

</details>

**Runtime invariant:** No companion is published: the prompt section and projection are pure folds of the Session log; nothing is held between calls and no registry is owned, and the projection registration's disposal is proven by the HMR-safety test.
