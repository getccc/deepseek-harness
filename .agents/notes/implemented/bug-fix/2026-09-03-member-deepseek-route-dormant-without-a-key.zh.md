# Agent Note: 成员 DeepSeek 路由在没有密钥时保持休眠

Status: implemented

[English](2026-09-03-member-deepseek-route-dormant-without-a-key.md) | 中文

## Problem

一名没有自己 DeepSeek 密钥的成员登录 Team Runner 后打开模型菜单，会在公司的「内置模型」之上看到一个列着三个模型的 `DeepSeek` 分组。这三个模型没有一个能服务请求：`llm-deepseek` 在加载时无论凭据引用是否有值都注册 `deepseek-official`，只有请求本身才会发现密钥缺失并以 `MISSING_CREDENTIAL` 失败。[按请求解析配置的决策](../../archived/architecture/2026-07-29-request-level-llm-config-credentials.md)选择这一姿态是为了让密钥缺失永远不会导致插件加载失败，随后的[路由拆分](2026-09-01-separate-company-and-member-model-routes.zh.md)又把公司目录放到了自己的路由下——于是成员路由继续宣告着无密钥成员可以选中、会失败、且看不懂原因的模型。

独立 Web 应用出于另一个原因保持着同样的姿态：它的首次运行密钥提示把未注册的已声明 `deepseek-official` 路由读作「未激活」，并把未激活当成部署故障，直接结束引导而不渲染。一个只有密钥存在才注册的路由，会因此把用来存入密钥的那个提示本身藏起来。

## Decision

**`deepseek-official` 只在其凭据引用可解析出值时注册。** `llm-deepseek` 仍在加载时把该路由声明为可配置，因此 Models 卡片与首次运行提示保留入口；它也仍按请求解析密钥。但注册跟随请求所读的同一引用：挂载了凭据 seam 时，由 `describe(ref).configured` 决定；没有 seam 时，由启动环境在加载时决定一次，因为进程环境的变化不可观察。插件会在该引用的每次 `credentials/reference-updated` 提交、设置变更（分节可能改名引用或修改重试策略）以及凭据 seam 挂载或卸载时重新判定路由。`built-in` 路由与之前完全一样只跟随已挂载的传输：它的凭据在 Control Plane 上。

**路由集合与重试策略并列为注册时捕获的事实。** 两者都通过 `replace` 在一次同步注册表分节中原位重新注册，因此观察者永远不会看到提供方消失又出现。注册表拒绝空的首次注册，所以休眠中的插件在至少一条路由开启前不持有注册；之后的空集合让存活的注册在休眠期间保留，而不是把它释放。凭据查询是异步的且可能重叠：一个代数计数器让最新一次查询拥有注册表，而 fiber 处于卸载中、已释放或失败状态后，任何查询都不再触碰它。插件加载会等待首次查询，因此紧跟插件自身 `await` 之后发出的请求永远不会落进未注册的空窗。

**休眠的已声明路由让请求失败时附带指引。** `NO_ADAPTER` 保留其 code 与 `no adapter registered for provider "…"` 前缀；当可配置提供方目录声明了该路由时，消息会点名激活它的设置分节，并说明 web Models 页会同时写入分节与凭据。没有密钥的 headless 运行因此仍能知道该做什么——这原本是 `MISSING_CREDENTIAL` 告诉它的。

**首次运行就绪判断把休眠的官方路由读作无密钥姿态，而非故障。** `onboardingReadiness` 不再有 `provider-inactive` 这一原因：由已声明行的凭据描述符决定。未配置且可写的凭据照旧触发提示；凭据已配置而注册表尚未拾取路由则是进行中的注册，读作 `loading`，`llm/adapters-updated` 刷新会把它变成 provider-ready。[首次运行凭据设置决策](../../archived/feature/2026-07-30-deepseek-onboarding-credential-setup.md)记录了修订后的「不渲染即结束该步骤」的状态列表。

## Consequences

Team Runner 的模型菜单只向成员提供确实能服务他们的东西：公司的「内置模型」，以及仅在成员存入自己的密钥后才出现的 `DeepSeek` 分组；Team profile 的 `built-in` 默认值在常见情形下不需要任何回退。独立 Web 应用在没有任何路由时，编辑器因「模型不可用」阻塞而失活，首次运行提示在旁边打开；存入密钥会在同一次提交上注册路由，因此阻塞解除、提示关闭，无需重新加载。移除密钥会再次撤下路由，曾选中它的 Session 会变为不可路由，而不是让下一次请求失败。

仅来自环境的密钥只在加载时判定一次。启动后才导出到进程环境的密钥，要等到下一次设置变更或 seam 挂载才会激活路由；托管凭据存储——即 Models 页写入的地方——才是实时路径。对于密钥在注册与调用之间消失的请求，`MISSING_CREDENTIAL` 仍可到达；脱离插件单独嵌入的适配器类也保留该失败作为唯一的无密钥信号。

没有 keyless 录制会话场景固定这一休眠姿态：每条快照通道都禁用 `llm-deepseek`，并通过 `dsh-llm-replay` 服务 `deepseek-official`，因此真实无密钥适配器下的选择器内容无法在那里录制。插件自身的测试固定了密钥到达、移除、引用改名、seam 挂载与卸载、查询失败、查询重叠以及卸载后才落定的查询这些注册行为；客户端测试固定了修订后的就绪状态与对话框「先打开再等待」的顺序。

## Alternatives considered

**保持路由注册，改为过滤目录。** 拒绝：`session/modelCatalog` 从 `listProviders()` 构建分组，并把同一集合报告为 `routableProviders`——这正是编辑器阻塞所读取的事实。在一个投影里隐藏已注册路由而另一个投影称其可路由，会让成员通过 `/model` 选中菜单所隐藏的东西，还需要在注册表之外再造一套「已配置」的概念。注册已经意味着「能服务请求」；无密钥的路由做不到。

**由各适配器回答的注册表级 `providerReady` 查询。** 拒绝：它增加一个 seam 角色和一个每次目录读取都必须等待的异步问题，只为表达注册表已经用成员资格建模的事实。pi-ai 适配器立下了先例——裸挂载在设置分节提供 profile 之前不注册任何路由——成员路由是同一姿态，只是以凭据而非 profile 为键。

**插件不持有任何路由时在加载期记录一条警告。** 拒绝：在 Team Runner 中，成员路由休眠是每次启动的常态，而 keyless CLI 冒烟测试要求 stderr 为空。`NO_ADAPTER` 消息把指引带到了无密钥请求真正浮现的那个位置。

**保留 `provider-inactive`，在对话框里为官方路由做特例。** 拒绝：这次改动之后，官方路由恰好在密钥缺失或注册进行中时未激活，因此该原因不再指向 Models 页能诊断的部署故障。同一份联接的两个读者对「未激活」不能各执一词。
