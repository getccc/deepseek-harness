---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-09-15-team-edition-session-events

[English](2026-09-15-team-edition-session-events.md) | 中文

## 概述

把 Team Edition 的 Session 事件 `knowledge/scope`、`office/kind` 与 `web/access` 记入持久化类型历史。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

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
## 兼容性

这些事件已经存在于本线写入的 Session 日志中；记录它们不新增、不删除字段，也不改变必需性。不含这些事件的日志仍然有效，读作未记录知识范围、办公文档类型或联网开关取值。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/knowledge/tool-knowledge packages/office/tool-office packages/web/tool-web packages/api/web-access-controller：8 个文件、171 个测试通过。

<a id="dev-note"></a>
## 开发备注

无。
