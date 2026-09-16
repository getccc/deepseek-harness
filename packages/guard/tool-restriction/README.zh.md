---
description: "为一个 agent preset 的 agent 按允许列表或拒绝列表遮蔽全局工具的组合行，供需要让 preset 的工具面小于 host 注册范围的用户与维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-restriction

[English](README.md) | 中文

## 概述

在 agent preset 内使用此包，声明该 preset 的 agent 能看到哪些全局工具。允许列表只保留列出的工具，拒绝列表移除列出的工具，空的允许列表移除全部全局工具——随附的 `chat` preset 正是这样在 host 之后注册任何工具时仍保持无工具。此行只能在 scope 内挂载：挂到 host 组合里会直接失败，因为上下文全局的遮蔽会覆盖每一个 agent。名字会对照该行挂载时已注册的工具检查，所以拼错的名字会让 preset 的第一个会话失败，而不是什么都不守。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

在 preset 的 `agent.cordis.yml` 里加一行。preset 自己的行注册的工具不受影响；被遮蔽的只有每个 scope 从 host 组合继承来的工具。

### 何时选择它

当一个 preset 必须比 host 为所有人注册的工具看得更少时选择它——只对话的 preset，或者绝不能碰到部署新增工具（例如知识检索）的 preset。当你想去掉的工具是 preset 自己注册的时不要用它，因为 scope 自己的注册不可被限制；改为移除注册它的那一行。

### 声明遮蔽

```yaml
- id: tool-restriction
  name: '@deepseek-ai/dsh-tool-restriction'
  config:
    allow: []
```

| 字段 | 默认 | 含义 |
|---|---|---|
| `allow` | 无 | 保持可见的全局工具名；其余全局工具都被移除。`[]` 移除全部 |
| `allowWhenRegistered` | 无 | 仅与 `allow` 同用：部署在该行挂载前已注册时同样保持可见的全局工具名；未注册时跳过而非拒绝 |
| `deny` | 无 | 从可见范围移除的全局工具名 |

至少要声明一个列表：什么都不遮蔽的行通不过校验，缺省的列表也绝不会被当成空列表。两个列表同时声明时取交集。没有任何已注册全局工具使用的名字会在该行挂载时失败，对 preset 而言就是第一次组合它的会话——`allowWhenRegistered` 除外，它的存在是为了让内置 preset 保留只有部分部署才注册的工具（`chat` preset 与 Team 知识检索），而不让其余部署失败。代价是放弃拼写检查；它也只在挂载时读取一次：之后才注册的工具会一直被遮蔽，直到 preset 再次挂载。生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-tool-restriction)记录每个可接受的值。

### 你得到什么

加入该 preset 的 agent 在工具 schema 里看到的是遮蔽后的目录，也无法执行被遮蔽的工具，效果与 host 从未注册它完全一样。遮蔽是对实时全局层的常驻过滤，所以部署在 preset 挂载之后注册的工具同样被遮蔽。其他 preset 和 host 自己的视图保留完整的工具面。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

此行是 `ctx.tools.restrict()` 的配置面：`apply` 校验至少有一个列表，然后把限制作为挂载上下文上的一个 effect 注册，因此释放该行就解除遮蔽。其余一切——与其他限制求交集、scope 本地注册的豁免、未知名字和无 scope 上下文的拒绝——都是注册表自身的契约，记录在 tools 子系统文档中。

遮蔽附着的 scope 是该行被插入的上下文所在的 scope。在 agent preset 内，这就是 preset 的常驻挂载，是每个加入该 preset 的 agent 的祖先，所以一行就覆盖全部。

### 源码地图

| 文件 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`Config` schema、至少一个列表的检查、`restrict()` effect |
| — | 不发布运行时不变量伴随件；此行只拥有一个注册表 effect，没有独立伴随件能观察到分歧的状态。 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [Tools 子系统参考](../../../docs/subsystems/tools.zh.md)——scope 分层、`restrict()`，以及 scope 自己的注册为何保持可见。
- [Agent presets](../../preset/agent-presets/README.zh.md)——此行写入的组合文件，以及使用它的随附 `chat` preset。
- [生成的配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-tool-restriction)——每个可接受的配置字段及其源声明。
- [guard 组映射](../README.zh.md)——同组的其他 guard 包。

-----

<a id="model-experience"></a>
## 模型体验

### 遮蔽后的全局工具目录

#### 模型看到什么

不新增任何内容。遮蔽移除的每个全局工具都不出现在该 preset agent 请求的 `tools` schema 中，调用它会得到注册表的 `Error: unknown tool "<name>"` 结果，与未注册的工具完全一样。

#### Token 影响

零直接 token；请求携带的工具 schema 比未遮蔽的 host 组合更少。

#### KV Cache 影响

前缀稳定：遮蔽后的目录在 preset 常驻挂载的生命周期内固定，因此其 agent 每次请求的工具 schema 前缀相同。解除或重新挂载该行会改变前缀，使其后的请求无法复用。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- **只限全局工具**——注册表设计上豁免 scope 自己的注册，所以 preset 自己那一行注册的工具无法在此遮蔽；改为移除那一行。
- **挂载时检查名字**——`deny` 命名一个部署在 preset 挂载之后才注册的工具会让挂载失败；改用 `allow` 声明，它从不命名被移除的工具。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
