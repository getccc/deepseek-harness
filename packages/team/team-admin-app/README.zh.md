---
description: "由 Control Plane 提供管理控制台：把构建好的浏览器应用的文件挂在一个地址下，除此之外什么也不做。"
kind: "package-reference"
---

# @deepseek-ai/dsh-team-admin-app

[English](README.md) | 中文

## 概述

`dsh-team-admin-app` 把构建好的管理控制台放到 Control Plane 自己的监听器上。它从一个目录读文件，除此之外什么也不做——没有会话、没有授权、没有配置。这个页面不是机密：它能渲染的每个视图都会先询问 [`team-admin-api`](../team-admin-api/README.zh.md)，而那里才是需要会话、检查授权的地方。

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
- name: '@deepseek-ai/dsh-team-admin-app'
```

没有配置。控制台在 `/team/admin` 提供，部署方无法移动它：针对那个地址编译的应用以绝对路径访问它的 API，因此换个地方提供的页面必须重新构建才能匹配。

文件来自 `@deepseek-ai/dsh-team-admin-frontend`，由 `pnpm run build` 产出。一个没有构建过的检出在这里什么也提供不了。

-----

<a id="understand-the-implementation"></a>
## 理解实现

### 页面是公开的，API 不是

把这个外壳提供给未认证的浏览器不花什么代价——它就是一个 script 标签和一份样式表。应用随后询问 `GET /team/api/session`，得到 401，然后渲染登录卡片。反过来去认证这个外壳，意味着多出第二处决定谁已登录的地方。

### 一个 base 元素，因为构建产物与地址无关

应用以相对资源 URL 构建，因此同一批文件可以挂在任意前缀下。一个不带尾斜杠的 `/team/admin` 请求会把这些 URL 解析到高一级目录，因此被提供的页面携带 `<base href="/team/admin/">`，两种形式都能工作。

### 路径穿越归静态服务器管，不归本包管

[`serveStatic`](../../host/frontend-static/src/index.ts) 已经把请求解析到 dist 根目录之下，并拒绝任何越界的东西。本包剥掉自己的前缀，把其余部分交出去，而不是重复一次出错即为目录穿越的路径比较。

### 源码地图

| 路径 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | 路由、dist 位置与 base 元素 |

-----

<a id="further-exploration"></a>
## 延伸阅读

- [`team-admin-api`](../team-admin-api/README.zh.md) —— 控制台对话的那个 JSON 界面。
- [部署指南](../../../docs/user/guide/deployment.zh.md) —— 启动一个提供它的 Control Plane。

<a id="model-experience"></a>
## 模型体验

无，因为本包提供的是静态文件，不注册任何提示词分区、工具或请求上下文。

#### KV 缓存影响

这里没有任何东西加入模型请求，因此本包没有请求前缀，也没有缓存影响。

## 已知限制与推迟事项

<a id="known-limitations-and-deferred-work"></a>

这些是契约当前的约束，不是任务待办。

- **一个固定地址** —— 控制台位于 `/team/admin`，因为应用以绝对路径访问它的 API；换个地方提供就意味着重新构建应用。
- **资源没有缓存头** —— 每个文件都不带 `Cache-Control` 提供，因此即使 vendor 分块的文件名已经带了内容哈希，浏览器每次访问仍会重新校验。
- **本包不自己做压缩** —— Web 服务器的 gzip 覆盖这些响应；本包不选择编码方式。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

dist 路径通过 `createRequire` 解析，因此无论工作区还是一次安装把构建好的应用放在哪里，本包都能找到。缺少构建产物表现为 404 而不是加载失败，因为这一行不应该让 Control Plane 起不来。

</details>

**运行时不变量：**不发布伴随文件：本包只从一个目录读取文件，不持有状态；请求不会离开该目录是一次路径比较的属性，测试直接观察它。
