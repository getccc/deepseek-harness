---
description: "已发布的桌面版本：一个部署提供的签名清单、每个版本提供给谁，以及它仍然接受的最旧构建；面向 Team 部署发布流程的维护者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-team-release

[English](README.md) | 中文

## 概述

本包保存一个部署已经发布的内容：每个版本的签名清单（与发布机产出的完全一致）、其签名、它是提供给所有人还是仅提供给预发布成员，以及它是否已被撤回。它还保存该部署强制执行的那一个版本下限。它不签署任何东西，也不对成员作任何判定——一台被攻陷的 Control Plane 可以扣住某个版本或提供更旧的版本（后者会被已安装的应用以 `not-newer` 拒绝），但无法发布属于它自己的版本。

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

在 Control Plane 组合中挂载它并给出数据库路径；控制台向其中发布，[`dsh-team-release-http`](../team-release-http/README.zh.md) 从其中答复 Runner。

```yaml
- id: team-release
  name: '@deepseek-ai/dsh-team-release'
  config:
    path: !!js dshHomePath('control-plane', 'releases.sqlite')
```

`publish` 记录一个版本，或替换此前已发布的同一版本的记录——把预发布版本放量给所有人，就是同一个调用带上 `channel: 'general'`。`withdraw` 停止提供某个版本，同时不忘记它曾经存在。`offered` 答复某个成员可以取用的最新版本，`floor` 答复该部署的应用低于它就拒绝运行的版本。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

清单与签名以文本形式逐字节存储，因为签名覆盖的是清单的规范字节，重新编码该文档会使其失效。发布只检查一件事：该文档描述的版本与它被发布成的版本一致，这正是那个否则会让签名覆盖另一个版本文件的错误。

版本在内存中按数字排序，而不是按 SQLite 的文本排序规则，使用的是与已安装应用相同的比较方式，因此 `1.0.10` 在这里比 `1.0.9` 新的理由与在那里相同。一个部署只持有少量版本，因此这次排序的代价不值得为之建索引。

撤回是一个时间戳而不是删除，这样管理员可以区分被撤下的版本与从未发布过的版本。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [dsh-team-release-http](../team-release-http/README.zh.md)——从本存储答复的、面向 Runner 的路由。
- [dsh-team-update](../team-update/README.zh.md)——已安装应用对本存储所提供内容作出的判定。
- [dsh-team-runner-desktop](../../../apps/team-runner-desktop/README.zh.md)——向其中发布、并从其中安装的外壳。
- [Team 包地图](../README.zh.md)——相邻的 Team 包。

-----

<a id="model-experience"></a>
## 模型体验

无，因为发布与提供版本不注册任何模型输入。

#### KV Cache 影响

此处没有任何内容进入模型请求，因此没有缓存影响。

## 已知限制与推迟事项

<a id="known-limitations-and-deferred-work"></a>

- **两个通道，而非任意分组** ——一个版本要么提供给所有人，要么提供给其角色被授予预发布通道的成员；想要多个彼此独立的试点分组的部署，需要的东西超出本存储所持有的范围。
- **不校验签名** ——存储记录了一个它无法校验的签名，因为发布公钥位于已安装的应用中。发布了损坏签名的控制台，会在成员的应用拒绝该版本时才得知这一点。
- **每个组织一个下限** ——版本下限对每位成员、每个平台一视同仁。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时不变量：** 不发布伴随包。本存储拥有自己的行，而授权归访问控制所有，本包无法向它断言任何事情。
