---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-09-16-knowledge-scope-documents

English | [中文](2026-09-16-knowledge-scope-documents.zh.md)

## Summary

Lets one recorded knowledge base carry the documents a conversation was narrowed to, each with the title it was chosen by.

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
    after: "4ab10b0fffb11e82617ef098edb5bf856421740fd052f7ca55fbee3cad8aca65"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing records remain valid: a knowledge base without `documents` is the whole knowledge base, which is what every record written before this change means. A reader that does not know the field ignores it and searches the whole knowledge base — wider than the member chose, never narrower — which is the cost of an optional field over a new mode, and a new mode would have required a format-version bump. The field is accepted only on a scope naming exactly one knowledge base, each entry's reference must resolve to that knowledge base, and each carries a title string, so a narrowed scope cannot describe a search nobody can perform. The title is recorded because the prompt names the document, and a model-visible name has to be reconstructable from the log; the controller folds it to one line of at most 200 characters before writing it.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/knowledge packages/api/knowledge-controller packages/client/ui-knowledge: 561 tests passed, including the scope validator refusing documents on a multi-knowledge-base scope, a document from another knowledge base, an empty document list, and a document with no title, and reading a narrowing recorded under a property name it does not know as the whole knowledge base.

<a id="dev-note"></a>
## Dev Note

None.
