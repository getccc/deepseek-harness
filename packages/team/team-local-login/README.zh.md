---
description: "Team Runner 的本地账户登录、应用入口与退出路由。"
kind: "package-reference"
---

# @deepseek-ai/dsh-team-local-login

[English](README.md) | 中文

## 概述

`dsh-team-local-login` 让普通成员的浏览器始终停留在 Team Runner 源上。它在 `/team/login` 提供响应式账户密码表单，把未解锁的 `/team/open` 浏览器送到那里，并在登录成功后交给本地浏览器会话服务。在应用内部，它会把设置入口替换成已登录成员入口。浏览器不会导航到 Control Plane 管理端源。

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

```yaml
plugins:
  '@deepseek-ai/dsh-team-local-login':
    applicationPath: /
    maxRequestBodyBytes: 16384
    locale: en-US
```

把它组合在 `client-connection` 与 `team-account-client` 之后，并让 Web Runtime 打开 `/team/open`。与独立 Web 根路径不同，这个入口不能收到进程 Token URL。

-----

<a id="understand-the-implementation"></a>
## 理解实现

### 登录页面留在本地，认证仍由权威端完成

HTML 表单由回环地址上的 Runner 提供。提交后，Runner 开启一个设备 Transaction，并通过 `team-account-client` 把凭据发送给配置好的 Control Plane。Control Plane 验证密码并批准该 Transaction，Runner 再用自己的 PKCE Verifier 与设备密钥签名完成兑换。本地页面不存储密码，但部署仍必须用 TLS 保护 Control Plane 连接。

表单只在浏览器提供同源元数据后才读取凭据。普通 `Origin` 必须指名请求的 authority。登录页的 `Referrer-Policy: no-referrer` 也可能让浏览器发送 `Origin: null`；只有当浏览器控制的 `Sec-Fetch-Site` Header 同时声明 `same-origin` 时，Runner 才接受这类提交。

登录文档是一个独立的响应式页面，具备双语文案、键盘焦点样式、密码管理器元数据与减少动态效果处理，并且不加载外部资源。它与应用包保持独立，因为应用被锁定时它仍必须能够渲染。

### 入口不会静默复用已存团队凭据

只有当这个浏览器已经持有有效本地 Session 时，`/team/open` 才会进入应用。即使进程仍持有团队凭据，未解锁的浏览器也会回到 `/team/login`，因此新打开的浏览器无法在未认证时继承账户。

### 退出会清除两层状态

`/team/logout` 接受已认证的本地导航，忘掉进程中的团队凭据、让浏览器 Cookie 过期，然后直接重定向到 `/team/login`。未认证的导航只会返回登录页，不能清除进程凭据。

### 应用底部展示本地成员

浏览器端占用设置 Shell 的可选 `settings.launcher` Slot。它携带本地浏览器 Cookie 读取 `/team/account`，展示返回的显示名与文字头像，并打开包含设置和退出登录的菜单。设置会调用 Shell 拥有的面板动作；退出登录会导航到 `/team/logout`。身份响应只包含 `loginName` 与 `displayName`。

### 空白会话按成员自己的时钟问候

同一个浏览器端用同一次 `/team/account` 读取填充 Conversation Shell 的 `conversation.hero.headline` Slot。标题是小微的全身形象加两行：一行是助手称呼显示名的问候，一行是它下面的寄语。问候属于成员浏览器时钟所处的时段——深夜、清晨、晨会、上午其余时间、中午、下午、晚上——寄语属于所处的半小时；时段边界写在 [`day-parts.ts`](src/client/day-parts.ts) 中，文案写在 [`locales.ts`](src/client/locales.ts) 中。一直开着的会话会自己跨入下一个半小时。身份到达之前，标题保持为空，而不是问候一个无名者。

此后 transcript 里的每个轮次都以一个头部开头：同一个形象——在内容列左侧留白够用时悬挂在留白里——加上名字、`Agent` 标签和该轮次的时钟，经由 Chat 视图的 `conversation.chat.assistant-identity` slot；头部位于回复的第一行之上，无论那是过程控件、注入的上下文还是第一步。

### 源码地图

| 路径 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | 请求验证与四条本地路由 |
| [`src/pages.ts`](src/pages.ts) | 应用解锁前提供的独立 HTML |
| [`src/paths.ts`](src/paths.ts) | 固定本地路径 |
| [`src/client/`](src/client/) | 本地化成员入口、账户菜单与欢迎标题 |
| [`src/xiaowei-avatar.ts`](src/xiaowei-avatar.ts) | 小微的全身形象，内联供欢迎标题与回复署名行使用 |

-----

<a id="further-exploration"></a>
## 延伸阅读

- [团队登录子系统](../../../docs/subsystems/team-handoff.zh.md)——成员认证与设备绑定的两侧。
- [`team-account-client`](../team-account-client/README.zh.md)——设备密钥与凭据保管。
- [`team-admin-api`](../team-admin-api/README.zh.md)——独立的仅管理员浏览器 API。

<a id="model-experience"></a>
## 模型体验

无，因为这些路由与账户入口都不注册任何模型输入。

#### KV Cache 影响

这里没有任何东西进入模型请求，因此没有缓存影响。

## 已知限制与推迟事项

<a id="known-limitations-and-deferred-work"></a>

- **每个 Runner 进程只有一个活跃账户**——再次登录会为使用该 Runner 的所有浏览器替换进程凭据。
- **没有成员自助修改密码页面**——管理员在 Control Plane 中替换密码，这会撤销该账户的每个浏览器会话与设备凭据族。
- **两种应用前 Locale**——服务端渲染表单目前支持 `en-US` 与 `zh-CN`。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作上下文——点击展开</summary>

路由测试固定了干净的本地入口、同源表单要求、通用认证拒绝、Session 签发、已认证身份响应与退出顺序。浏览器测试固定了本地化账户入口及其设置和退出动作。账户客户端测试则对着真实 Control Plane 端点和设备认证 Provider 驱动密码流程。

</details>

**运行时不变量：**不发布伴随文件：路由测试直接证明本包的请求局部关系，没有剩余的独立可变关系可供检查。
