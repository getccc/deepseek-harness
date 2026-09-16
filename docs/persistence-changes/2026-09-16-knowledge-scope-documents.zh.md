---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-09-16-knowledge-scope-documents

[English](2026-09-16-knowledge-scope-documents.md) | 中文

## 概述

让一条已记录的知识库携带会话收窄到的那些文档。

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
    after: "dec35810f66b8eda5b53537f7f9232a9d40eb10faf0a4b000673ce0623afb5a2"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

已有记录仍然有效：没有 `docRefs` 的知识库就是整个知识库，这也正是此前每条记录的含义。不认识该字段的读取方会忽略它并检索整个知识库——比成员所选更宽，绝不会更窄——这是用可选字段而不是新增 mode 的代价，而新增 mode 会要求升格式版本。该字段只在范围恰好命名一个知识库时被接受，且其中每个文档引用都必须解析到该知识库，因此收窄后的范围无法描述一个无人能执行的检索。模型对这种范围被告知的是它的知识库和文档数量，两者都可仅凭日志重建；不记录任何文档标题。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/knowledge packages/api/knowledge-controller packages/client/ui-knowledge packages/client/ui-knowledge-panels：517 个测试通过，其中包括范围校验器拒绝多知识库范围上的文档、来自另一个知识库的文档引用，以及空文档列表。

<a id="dev-note"></a>
## 开发备注

无。
