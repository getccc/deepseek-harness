---
description: "仅 Team 的知识 Remote：浏览器读取的已授权目录、它记录的会话范围选择，以及成员自行运行的检索。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-knowledge-controller

[English](README.md) | 中文

## 概述

`dsh-api-knowledge-controller` 是私有知识每一个浏览器界面的 Host 那一半：成员可以检索什么、他们为某个会话选了什么，以及他们在会话之外运行的检索。浏览器自己够不到 `ctx.knowledge`——该服务位于 Host，而持有设备 Token 的是它的提供方——因此选择器和面板都来问这里。它是独立的包而不是 session controller 上的更多接口面，因为知识只属于 Team：没有知识的组合不挂载它；而一个容忍服务缺席的 controller 只能报告空目录，那读起来像「你什么权限都没有」。

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

在已挂载知识提供方的组合中挂载它；它注册 `knowledge` Remote 命名空间。

### 最小配置

本 controller 没有配置。

```yaml
- name: '@deepseek-ai/dsh-knowledge-team'
  config:
    controlPlaneUrl: https://dsh.company.com
- name: '@deepseek-ai/dsh-api-knowledge-controller'
```

### 六个方法

| 方法 | 回答什么 | 需要会话 |
|---|---|---|
| `scope(sessionId)` | 某个会话可以从什么中选择、它选了什么，以及已选引用中哪些已不在目录里 | 是 |
| `choose(sessionId, mode, knowledgeRefs?)` | 记录选择并回答同样的视图 | 是 |
| `directory()` | 该成员此刻可以检索的知识库 | 否 |
| `documents(knowledgeRef, page?)` | 某个知识库中文档的一页，每份都由受治理引用命名 | 否 |
| `documentContent(docRef)` | 某一份文档的原始文件（base64），或代替它的解析文本 | 否 |
| `search(query, mode, knowledgeRefs?)` | 排名后的段落，以及实际被检索的知识库 | 否 |

目录在每次调用时重新读取而不缓存：上次查看之后被撤销的授权应当让选择器变窄，管理员停用的知识库应当从中消失。

`directory`、`documents`、`documentContent` 和 `search` 都不触及会话：它们不追加事件、不启动模型轮次，也不需要有会话处于打开状态。这正是它们可以服务于成员自行打开的面板的原因——也正因如此，授权只是保持不变而非被放宽：Control Plane 会在这次调用上判定它所命名的每一个知识库。格式正确的引用会被原样传递，而不是先与这里读到的目录比对：真正作数的答案在 Control Plane，提前判断既要为每次查询多读一次目录，又仍可能与那个答案不一致。

### 选择为何携带名字

范围事件在每个引用旁记录一个显示名称，因为提示词会写出所选知识库，而模型可见的名字必须能从会话日志重建。名字取自做出选择那一刻的目录。

这也是目录中不存在的引用被拒绝而不是被记录的原因。Control Plane 在检索时本来也会拒绝它，而记录它等于在日志里放进一个任何检索都无法兑现的名字。

<a id="understand-the-implementation"></a>
## 理解实现

### 设计理念

这里不做任何授权。本 controller 提供的目录，是 Control Plane 已经按成员持有的权限收窄过的；而基于已记录选择的检索会被再次单独授权。它拥有的是成员意图与日志所述之间的差异——这正是陈旧选择被报告而不是被静默收窄的原因。

### 源码地图

| 文件 | 内容 |
|---|---|
| [`src/index.ts`](src/index.ts) | `knowledge` Remote 命名空间、其请求校验、范围投影、文档列表与阅读，以及成员自行运行的检索 |

<a id="further-exploration"></a>
## 延伸阅读

- [dsh-client-ui-knowledge](../../client/ui-knowledge/README.zh.md) —— 本命名空间服务的选择器与 Chip。
- [dsh-client-ui-knowledge-panels](../../client/ui-knowledge-panels/README.zh.md) —— 读取目录并运行检索的两个面板。
- [知识子系统](../../../docs/subsystems/knowledge.zh.md) —— 本包记录的范围值。
- [Team 私有知识 Agent Note](../../../.agents/notes/proposed/feature/2026-09-01-team-private-knowledge-control-plane.zh.md) —— 范围为何存在于会话日志中。

<a id="model-experience"></a>
## 模型体验

间接影响，通过 `dsh-tool-knowledge`：本包记录的范围决定它的提示词章节写出什么，也决定它的工具是否被提供。本 controller 不贡献提示词，也不注册 schema。通过 `search` 运行的检索，以及通过 `documents` 和 `documentContent` 运行的列表与阅读，都完全不到达模型——它们回答的内容交给浏览器，到此为止。

#### KV Cache 影响

无直接失效，但一次已记录的选择会造成失效：具名消费方的提示词章节和工具列表都会改变，因此随后的请求会重读其前缀。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

这些限制界定了本 controller 自身在何处不完整。它们是当前的包约束。

- **选择需要一个活跃会话** —— `scope` 与 `choose` 按会话 id 解析 agent，没有活跃 agent 时拒绝，因此无法为一个没在运行的会话设置范围。`directory` 与 `search` 不需要会话。
- **成员自行运行的检索不被记录在任何地方** —— `search` 不追加会话事件，而 Control Plane 审计的是这次检索本身，不是哪个浏览器界面发起了它。
- **文件以 base64 跨越边界** —— `documentContent` 把一整份文件作为 JSON 中的文本回答，传输量因此多出约三分之一。让这一点可负担的是 Control Plane 的字节上界；这里不做流式传输也不做缓存。
- **没有变更通知** —— 已打开选择器的浏览器不会得知授权发生了变化；它在下次打开时看到收窄后的目录。
- **没有逐次选择的审计** —— 记录范围只写会话事件。成员检索了哪些知识库由 Control Plane 在检索时审计，判定发生在那里。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 —— 点击展开</summary>

方法只声明调用方会传的参数。生成的 Remote 客户端按*声明*的参数个数校验，因此浏览器一旦省略末尾的可选参数，调用在到达传输层之前就被拒绝（`expected 3 argument(s), got 2`）。于是没人会传的上界只能作为 Control Plane 的配置项存在，而不是这里一个无人使用的可选参数；分页大小、字节上界与结果条数上界都不在本接口上。能发现这类回归的只有 `apps/web/tests/knowledge-panels.e2e.ts`，因为只有它跑生成的客户端。

</details>

**运行时不变量：**不发布伴随文件：controller 在调用之间不持有任何状态，也不拥有注册表；记录的范围只引用成员选择时可检索的知识库，这一点在 `choose` 内对同一次调用读取的目录强制执行，并由本包测试断言。
