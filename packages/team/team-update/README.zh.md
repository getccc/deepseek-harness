---
description: "判定一个被提供的发行版是否可以安装：清单签名、版本单调性、升级路径、平台产物，以及安装程序所写入的后台服务定义。"
kind: "package-reference"
---

# @deepseek-ai/dsh-team-update

[English](README.md) | 中文

## 概述

`dsh-team-update` 只回答一个问题——这个被提供的发行版可以替换正在这里运行的 Runner 吗？——并渲染安装程序所写入的后台服务定义。两者都是数据上的纯函数：本包不下载、不写入、也不启动任何东西，因为那些需要属于安装程序的权限与平台知识。属于这里的是判定，因为 Runner 会替换自己的可执行文件，而在清单上判断错误，等于把这台机器交给制造该清单的人。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与推迟事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

```ts
import { decideUpdate, serviceDefinitionFor } from '@deepseek-ai/dsh-team-update'
import type { ServiceDefinition, UpdateManifest, UpdateTarget } from '@deepseek-ai/dsh-team-update'

declare const manifest: UpdateManifest
declare const signature: string
declare const target: UpdateTarget
declare const definition: ServiceDefinition

const decision = decideUpdate(manifest, signature, target)
if ('install' in decision) {
  // decision.install names the artifact for this platform and processor.
}

const { filename, document } = serviceDefinitionFor('darwin', definition)
```

`decideUpdate` 返回的要么是待安装的产物，要么是"为什么不"的那个词——`signature`、`manifest-version`、`not-newer`、`upgrade-path`、`no-artifact` 或 `malformed-version`。每一个对安装程序都是不同的说法，对成员也都是不同的动作。

-----

<a id="understand-the-implementation"></a>
## 理解实现

### 签名先被检查，且针对规范字节

此后的每一项检查读到的都是发行密钥背书过的值，而不是文档自称的值。这些字节由 [`canonicalManifestBytes`](src/manifest.ts) 以固定字段顺序和排序后的产物列表构造，因此同一个发行版无论其产物以何种顺序排列都签出相同结果，而一个重排了字段的文档也无法把另一份签名冒充为有效。

### 版本按数字比较，忽略预发布标记

harness 自身的版本里带着预发布标记，而一次更新判定不能取决于那些标记如何排序。不以数字开头的字符串会被拒为 `malformed-version`，而不是被猜测。

### `minimumFrom` 让升级路径可被表达

一个无法叠加在更旧构建之上的发行版，会声明它所接受的最旧版本。低于它的 Runner 会先安装一个中间发行版，而不是在已经替换掉自己之后才发现问题。

### 服务以成员身份运行

一个 launchd *agent*、一个 systemd *user* 单元、一个 Windows *计划任务*——绝不是 daemon、system 单元或服务。Runner 以成员自己的权限执行成员自己的工作，而每个平台的提权形态都会让它以别的身份运行。三者都会在崩溃后重启并带十秒下限，因此启动不起来的 Runner 会显式失败，而不是空转。

### 源码地图

| 路径 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | 更新判定及其拒绝 |
| [`src/manifest.ts`](src/manifest.ts) | 清单格式，以及发行密钥所签的字节 |
| [`src/version.ts`](src/version.ts) | 点分数字版本的比较 |
| [`src/service.ts`](src/service.ts) | 安装程序所写入的三份服务定义 |
| [`src/types.ts`](src/types.ts) | 一次判定所读取与回答的内容，仅类型 |
| [`src/invariant.ts`](src/invariant.ts) | 不变量伴生插件注册 |

-----

<a id="further-exploration"></a>
## 延伸阅读

- [团队 Handoff 子系统](../../../docs/subsystems/team-handoff.zh.md)——本 Runner 与 Control Plane 协商的协议版本。
- [`team-account-client`](../team-account-client/README.zh.md)——协议拒绝在哪里告诉成员去更新。

<a id="model-experience"></a>
## 模型体验

无，因为这里判定的是安装，不注册任何 Prompt 段、工具或 Request Context。

#### KV Cache 影响

这里没有任何东西进入模型请求，因此本包没有请求前缀，也没有缓存影响。

## 已知限制与推迟事项

<a id="known-limitations-and-deferred-work"></a>

这些是当前契约的约束，不是任务清单。

- **这里没有任何东西下载、校验或应用产物** —— 清单指名了摘要和大小；把字节对照它们检查、以及替换可执行文件，属于有权限做这件事的安装程序。
- **本仓库不产出带签名的平台安装包** —— `.pkg`、`.msi` 或 `.deb` 需要代码签名证书与平台工具链，而本包只覆盖那些安装程序所执行的判定。
- **只有一把发行密钥，由外部传入** —— 密钥轮换意味着一个信任多于一把密钥的目标，那需要它自己的设计，而不是多加一个参数。
- **服务定义只被渲染，不被安装** —— 把它们写进 `~/Library/LaunchAgents`、`~/.config/systemd/user` 或计划任务，以及卸载时移除它们，是安装程序的工作。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文 —— 点击展开</summary>

测试驱动的是一把真实的 Ed25519 发行密钥，并逐字段修改已签名的清单，因为被测的性质不是"一份好清单会被接受"，而是"一份被改过的清单不会"。Windows 文档先为命令行加引号、再为 XML 转义引号；断言未转义形态的测试，断言的是一份坏文档。

</details>
