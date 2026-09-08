# Agent Note: The office picker offers a visualization kind

Status: implemented

English | [中文](2026-09-03-office-picker-visualization-kind.zh.md)

## Problem

The composer's office picker named four file formats — Word, Excel, PowerPoint, the Welinkin PowerPoint template — and a member who wanted the answer to contain a chart had no way to say so. Charts are the one deliverable a Team Runner can hand back without producing a file at all: the `@dsh-external/dsh-echarts` plugin renders any fenced block whose info string is exactly `echarts` as an interactive Apache ECharts canvas, but only if the model knows to emit one, and nothing told it to.

## Decision

**A fifth kind, `chart`, joins the same fold, event, and projection as the file kinds.** It is an `OfficeKind` like the others: one `office/kind` event records it, one `office:kind` prompt section carries it, and the chip reads it back from the `office` projection. Nothing about the picker's shape changes — the [office-deliverable picker](2026-09-03-composer-office-deliverable-picker.md) already owns that.

**Its prompt names the fence contract, not a tool.** The renderer supplies no tool call: it captures settled markdown fences. The section therefore tells the model to write one fenced block per chart whose info string is exactly `echarts`, holding nothing but a strict-JSON ECharts option — the renderer rejects JavaScript functions, expressions, `renderItem`, and event handlers, and parses with `JSON.parse` alone, so the section states those limits where the model reads them.

**The picker's display order is the order a member reaches for: Word, Excel, PPT, Welinkin PPT, visualization.** `OFFICE_KINDS`, the chip's local mirror of it, and the `renderOfficeSection` switch all carry that one order, so a reader comparing them sees no unexplained asymmetry.

**The chip's copy says deliverable, not document.** A chart is not a document, and the chip now names a set that is not all files.

## Consequences

The renderer is a profile-installed external plugin, not a harness dependency, and the prompt section does not check for it. Where it is absent the kind degrades to a readable JSON code block rather than failing: the fence contract is the whole coupling, and stating it costs the same paragraph either way.

Reaching the packaged Team Runner takes two steps, not one. The desktop shell rewrites its private profile's manifest on every launch from `SHIPPED_PLUGIN_BUNDLES`, so installing the plugin into the staging profile that becomes `DSH_TEAM_PLUGIN_TREE` only supplies the files — the layer list must name `@dsh-external/dsh-echarts` too, or the shipped tree carries a plugin nothing mounts.

`chart` is the first kind whose deliverable is the answer itself, so `dsh-tool-office`'s Model Experience section now documents a kind that names no file, and the `office/` group README no longer claims every kind produces one.

No shipped snapshot changes. The office section is absent from a default (`none`) Session, and no recorded-session fixture chooses an office kind — the same gap the picker note records, now one kind wider.

## Alternatives considered

**A separate composer chip for visualization.** Rejected: the choice is mutually exclusive with the file kinds — a conversation producing a deck is not also producing loose charts — and single-select within one control is what expresses that. A second chip would let a member pick both and leave the prompt with two conflicting format instructions.

**Name the kind `viz`, matching the Chinese label 可视化.** Rejected: the sibling slugs (`word`, `excel`, `ppt`) name the concrete format, and the concrete format here is an ECharts chart. The label stays 可视化 / Visualization; the slug says what is produced.

**Have the section name the `@dsh-external/dsh-echarts` plugin.** Rejected: model-facing text carries task-relevant concepts, not the deployment's plugin inventory. The model needs the fence and the JSON rules; which plugin consumes them is not its concern.
