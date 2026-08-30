---
description: "Control Plane 的设备确认页：成员在一台电脑被绑定到自己账户之前所比对的东西，以及这次绑定需要的三道证明。"
kind: "package-reference"
---

# @deepseek-ai/dsh-team-shell

[English](README.md) | 中文

## 概述

`dsh-team-shell` 只提供一个页面：成员确认请求连接的这台电脑是自己的。它保持服务端渲染，是因为成员从哪里抵达——他们自己 Runner 提供的配对页上的一条链接——以及抵达后做什么，也就是比对一个码、按一个按钮。管理是一个浏览器应用；而这一页必须在一次跨站导航落地的瞬间即可阅读。

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

```yml
- name: '@deepseek-ai/dsh-team-shell'
  config:
    maxRequestBodyBytes: 16384
```

页面位于 `/team/confirm/<事务 id>`；Runner 用它刚打开的事务构造出那个地址。没有别的路由，也没有别的配置：这个页面所解析的会话由 [`team-admin-api`](../team-admin-api/README.zh.md) 打开，而没有携带会话的浏览器会被送去管理控制台登录，再回到这里。

-----

<a id="understand-the-implementation"></a>
## 理解实现

### 一次确认需要三样都在

一个会话、一个指明本授权方的 `Origin`，以及由该会话派生的 CSRF 令牌。它们的失败方式不同：令牌拒绝一份伪造的表单，而源拒绝一个从未渲染过表单的页面发来的请求。把一台电脑绑定到一个账户是这一页上唯一的动作，而仅仅一个 cookie 会随成员从未发起的请求一起送出。

### 拒绝给出的是这道缝自己的词

`expired`、`already-confirmed`，以及其他任何情况，会变成三句不同的话，取自设备授权这道缝产生的那个词，而不是猜出来的。一个根本不带词的失败属于这个部署，而不属于成员：它答复 500 并记录 `outcome: 'error'`，因为一条说成员被拒绝而实际并没有的记录，比没有记录更糟。

### 未登录的浏览器去控制台，然后回来

重定向携带 `next`，因此顺着配对链接过来的成员会落在他们被送往的那一页，而不是一个他们没有要求的管理视图。

### 源码地图

| 路径 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | 路由、三道证明与审计记录 |
| [`src/pages.ts`](src/pages.ts) | 确认页，以及说明为何无法继续的那个页面 |
| [`src/paths.ts`](src/paths.ts) | 本包指名的两个地址 |
| [`src/invariant.ts`](src/invariant.ts) | 不变量伴随插件注册 |

-----

<a id="further-exploration"></a>
## 延伸阅读

- [团队 Handoff 子系统](../../../docs/subsystems/team-handoff.zh.md)——三个地址与 Callback 的同站弹跳。
- [`team-browser-session`](../team-browser-session/README.zh.md)——这一页与管理 API 共享的 cookie 与 CSRF 派生。

<a id="model-experience"></a>
## 模型体验

无，因为本包服务的是成员的浏览器，不注册任何提示词分区、工具或请求上下文。

#### KV 缓存影响

这里没有任何东西加入模型请求，因此本包没有请求前缀，也没有缓存影响。

## 已知限制与推迟事项

<a id="known-limitations-and-deferred-work"></a>

这些是契约当前的约束，不是任务待办。

- **没有从页面上拒绝的办法** —— 不认得这个请求的成员会关掉标签页；事务随后自行过期，而不是当场被拒。
- **页面一次只显示一个事务** —— 有两个待处理请求的成员没有一个列出它们的视图，只能各自从各自的链接确认。
- **只有英文** —— 与管理控制台不同，这一页没有走 locale 词典。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

测试直接通过账户存储打开一个浏览器会话，而不是去登录，因为登录属于管理 API，而本包不应为了可测试而依赖它。

</details>
