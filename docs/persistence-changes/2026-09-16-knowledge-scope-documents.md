---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-09-16-knowledge-scope-documents

English | [中文](2026-09-16-knowledge-scope-documents.zh.md)

## Summary

Lets one recorded knowledge base carry the documents a conversation was narrowed to.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-09-16-knowledge-scope-documents
baseline: false
changes:
  - root: "event:knowledge/scope"
    previous: "2026-09-15-team-edition-session-events"
    after: "dec35810f66b8eda5b53537f7f9232a9d40eb10faf0a4b000673ce0623afb5a2"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing records remain valid: a knowledge base without `docRefs` is the whole knowledge base, which is what every record written so far means. A reader that does not know the field ignores it and searches the whole knowledge base — wider than the member chose, never narrower — which is the cost of an optional field over a new mode, and a new mode would have required a format-version bump. The field is accepted only on a scope naming exactly one knowledge base, and every document reference in it must resolve to that knowledge base, so a narrowed scope cannot describe a search nobody can perform. What the model is told about such a scope is its knowledge base and how many documents, both reconstructable from the log alone; no document title is recorded.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/knowledge packages/api/knowledge-controller packages/client/ui-knowledge packages/client/ui-knowledge-panels: 517 tests passed, including the scope validator refusing documents on a multi-knowledge-base scope, a document reference from another knowledge base, and an empty document list.

<a id="dev-note"></a>
## Dev Note

None.
