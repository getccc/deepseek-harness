---
description: "GMO供应链服务（ctx.gmo）：稳定的分类与结果引用、已授权分类目录、结果列表、描述与提问词汇、会话 GMO 范围，以及封闭的失败分类。"
kind: "package-reference"
---

# @deepseek-ai/dsh-gmo

[English](README.md) | 中文

## 概述

`dsh-gmo`（`ctx.gmo`）是 Team Runner 用来询问其已登录成员可分析哪些 GMO供应链分类的服务。它定义四个操作——读取已授权的分类目录、列出一个分类的结果、说明一个结果、向一个结果提问——以及两种受治理引用、`gmo/scope` 会话事件、提问词汇和封闭的失败集合。它自己不发网络请求：由挂载的提供方发出，在 Team 版里该提供方转发给授权每个操作的 Control Plane。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

需要 GMO 分析的组合挂载一个提供方，由它注册本服务；插件和工具作者随后调用 `ctx.gmo.catalog()`、`ctx.gmo.results()`、`ctx.gmo.describe()` 与 `ctx.gmo.ask()`。没有任何调用接受数据源、地址或凭据，因为这些都不是调用方可以选择的。

### 何时选用

要构建 GMO 提供方、面向模型的 GMO 工具，或任何必须读取会话 GMO 范围的东西时导入它。只想要已发布行为的部署应通过 Team profile 获得。本服务不注册工具，也不贡献自己的提示词：没有挂载提供方时，每个操作都是缺失而不是空。

### 最小配置

服务没有配置——它是一个抽象服务。部署会变化的内容由提供方的行提供：

```yaml
- name: '@deepseek-ai/dsh-gmo-team'
  config:
    controlPlaneUrl: https://dsh.example.com
```

### 命名分类与结果

`GmoCategoryRef` 是 `<providerKind>:<sourceCode>:<upstreamId>`，是唯一离开 Control Plane 的分类标识。`GmoResultRef` 是 `<GmoCategoryRef>/<upstreamResultId>`。用 `formatGmoCategoryRef` 与 `formatGmoResultRef` 构造，用 `parse` 系列函数读回；后者返回 `undefined` 而不抛出，因为它们的调用方是在决定是否接受一个值，而不是诊断它。分类引用以审计 token 字符集限制在 64 个字符，数据源代码限制在 19 个；结果 id 在同一字符集（不含冒号和斜杠）下限制在 64 个字符，因此多步结果的某一步写作 `<id>.<阶段>`。

### 提问

`GmoQuery` 是一个封闭词汇，有三种：`aggregate`（对最多两个分组列做求和、行数或去重计数，带日期粒度、排序和上限）、`overview`（数据源现成的看板之一）和 `rows`（一页明细）。`readGmoQuery`、`readGmoFilters` 与 `readGmoCount` 证明一个未知值确实是其中之一：Runner 的工具在发送之前用它们，Control Plane 在收到时用它们。词汇未定义的键被拒绝而不是被忽略。

### 读取会话范围

`foldGmoScope(events)` 从会话日志恢复当前范围，其 `end` 参数折叠一个前缀，让回退与分叉读到日志在那一点上说了什么。没有 `gmo/scope` 事件的日志折叠为 `off`。`categoryOf` 回答已记录的分类，`off` 时回答 `undefined`。范围命名一个分类或没有分类；没有表示"全部分类"的分支。

<a id="understand-the-implementation"></a>
## 理解实现

### 设计理念

服务之所以小，是因为它命名的每个操作都必须是 Control Plane 能对照当前账号、当前设备和当前授权去授权的操作。提问是词汇而不是语句，原因相同：Control Plane 能说出问的是什么、记录它的种类，并拒绝词汇未定义的东西。

### 源码地图

| 文件 | 内容 |
|---|---|
| [`src/index.ts`](src/index.ts) | `Gmo` 服务定义和本包的导出 |
| [`src/brand.ts`](src/brand.ts) | 两种受治理引用、它们的语法与边界 |
| [`src/types.ts`](src/types.ts) | 目录、列表、描述、提问、答案、范围与失败类型 |
| [`src/query.ts`](src/query.ts) | 证明一个值是提问、筛选集或计数的读取器 |
| [`src/scope.ts`](src/scope.ts) | `gmo/scope` 会话事件、它的折叠与校验器 |
| [`src/error.ts`](src/error.ts) | 携带一个封闭原因的 `GmoError` |

### 数据模型

描述携带读者提出好问题所需的内容：每一列的键、类型、筛选方式，以及其所有者写下的业务含义；看板的度量与维度；数据源的当前日期；以及该分类用 Markdown 写下的规则。答案是数据源自己的、有界的 JSON，连同它所回答的引用，因为数字由数据源计算，这里不重新推导。

<a id="further-exploration"></a>
## 延伸阅读

- [GMO 子系统](../../../docs/subsystems/gmo.zh.md)——共享词汇与失败分类。
- [Team GMO供应链分析 Agent Note](../../../.agents/notes/proposed/feature/2026-10-16-team-gmo-supply-chain-through-the-control-plane.zh.md)——为何以分类为授权单位，以及业务规则为何随数据而行。

<a id="model-experience"></a>
## 模型体验

间接地，通过 GMO 工具包——它向模型呈现结果列表、说明与答案，并贡献范围提示词段。本服务不贡献提示词，也不注册 schema。

#### KV Cache 影响

没有直接失效。所指名的消费者拥有一次范围选择引起的请求前缀变化，这种变化是真实的：改变范围既改变一个提示词段，也改变工具列表，因此后续请求会重新读取其前缀。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

这些限制定义了本包何时单靠自身并不完整。它们是当前的包约束。

- **一个会话不能用几个分类**——范围命名一个分类或没有分类，因此跨业务线的提问是两个对话。
- **没有调用方自己的语句**——提问是三种之一；这里不运行语句、不关联结果，也不对比两个期间。
- **失败是一个封闭集合**——数据源的拒绝读作 `invalid-query`、`unsupported` 或 `too-large`，不带数据源自己的话，所以调用方除了指向描述之外，无法向成员展示某一列为何被拒绝。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时不变量：** 不发布伴随包：服务不拥有注册表，也不发出事件；恢复范围的折叠由本包的测试对照会话日志断言。
