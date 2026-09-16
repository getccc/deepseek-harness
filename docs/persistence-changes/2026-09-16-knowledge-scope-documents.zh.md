---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-09-16-knowledge-scope-documents

[English](2026-09-16-knowledge-scope-documents.md) | 中文

## 概述

允许一个已记录的知识库携带对话被收窄到的文档，每份文档都带上它被选中时的标题。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

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
## 兼容性

既有记录仍然有效：不带 `documents` 的知识库即整个知识库，这正是本次改动之前写下的每条记录的含义。不认识该字段的读取方会忽略它并检索整个知识库——比成员所选的更宽，但绝不会更窄——这是用可选字段而非新模式的代价，而新模式本需要升级格式版本。该字段只在恰好命名一个知识库的范围上被接受，每一项的引用都必须解析到这个知识库，且每一项都带一个标题字符串，因此收窄后的范围不会描述一次谁也执行不了的检索。之所以记录标题，是因为提示词会点出这份文档，而模型可见的名字必须能从日志中重建；controller 在写入前会把它折叠为一行、至多 200 个字符。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/knowledge packages/api/knowledge-controller packages/client/ui-knowledge：561 个测试通过，其中包括范围校验器拒绝多知识库范围上的文档、来自其他知识库的文档、空文档列表和不带标题的文档，以及把以它不认识的属性名记录的收窄读作整个知识库。

<a id="dev-note"></a>
## 开发备注

无。
