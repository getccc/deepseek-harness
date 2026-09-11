# Agent Note: Office deliverables reach the reader through present

Status: implemented

English | [中文](2026-09-10-office-deliverables-through-present.zh.md)

## Problem

The office prompt section told the model to build every document with "the univer office tools" and to answer the chart kind with `echarts` fences. Both came from third-party plugins the Team deployment shipped; the [two-stage upstream merge](../process/2026-09-10-two-stage-upstream-merge.md) dropped them for upstream's Sidebar and file delivery, so the section named tools that no longer exist, and a file the model wrote with a shell command reached nobody: upstream's deliverables row lists only files the `present` tool declared.

## Decision

The tool-naming half of this decision is superseded by [office deliverables return to the univer tools](2026-09-11-office-deliverables-return-to-the-univer-tools.md); the delivery rule below stands.

The section names the format and the delivery, not a tool that produces it. Word, Excel, and PowerPoint kinds ask for a file written under the working directory with whatever scripts the environment offers (python-docx, openpyxl, python-pptx, their Node counterparts, or a converter), the PowerPoint kinds still start from the company template by copying it and editing the copy, and every file-producing kind ends with the same sentence: mentioning the path does not deliver the file; only the `present` call does. The chart kind asks for one SVG file per chart, declared the same way, because the Sidebar previews images and nothing renders an `echarts` fence any more.

## Alternatives considered

- **Ship an ECharts renderer of our own.** Rejected: it recreates the plugin the merge retired, and a static SVG opened from the Sidebar already answers "make me a chart".
- **Leave the chart kind interactive through an HTML file.** Rejected for now: the Sidebar's HTML preview runs inside an opaque iframe with only statically declared local assets, so an interactive chart would need a bundled charting library beside every deliverable.

## Consequences

The picker chip and the `office/kind` event are unchanged; only the text the model reads moved. `dsh-tool-office` keeps registering no tool. A deployment that wants a template skill still gets the skill route when no template path is configured. Recorded-session snapshots carry no office section, so `section.spec.ts` is the coverage: it checks the SVG rule for charts and the delivery sentence on every file-producing kind.
