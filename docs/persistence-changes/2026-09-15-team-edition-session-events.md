---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-09-15-team-edition-session-events

English | [中文](2026-09-15-team-edition-session-events.zh.md)

## Summary

Records the Team Edition Session events `knowledge/scope`, `office/kind`, and `web/access` in the persistence type history.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-09-15-team-edition-session-events
baseline: false
changes:
  - root: "event:knowledge/scope"
    previous: null
    after: "51d9917929b4023f847ccbee830de86514c344c4da57a4a5da3f12b0940247a4"
    decision: same-version
  - root: "event:office/kind"
    previous: null
    after: "5a4bc04e9442537d25a694ce81cd10ae715cda1ed651fa059e8486d43ee2e09a"
    decision: same-version
  - root: "event:web/access"
    previous: null
    after: "5186d42540d72069270711837a91a81011179a8af785f32b859ec0dc6d327559"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

These events already exist in Session logs written by this line; recording them adds no field, removes none, and changes no requirement. A log without them stays valid and is read as recording no knowledge scope, office kind, or web switch value.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/knowledge/tool-knowledge packages/office/tool-office packages/web/tool-web packages/api/web-access-controller: 8 files, 171 tests passed.

<a id="dev-note"></a>
## Dev Note

None.
