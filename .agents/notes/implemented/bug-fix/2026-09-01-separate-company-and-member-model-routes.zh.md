# Agent Note: 分离公司模型与成员模型路由

Status: implemented

[English](2026-09-01-separate-company-and-member-model-routes.md) | 中文

## 问题

Team 传输为 `deepseek-official` 提供模型目录，并替换适配器配置的 DeepSeek 目录。因此，Control Plane 下发的 `testModel` 等模型显示在 DeepSeek 标题下，存储了 DeepSeek API 密钥的成员也无法看到或选择该密钥所服务的模型。

provider id 同时决定调用路径。若只在浏览器中移动模型行，标题看起来正确，但两个分组仍会提交 `deepseek-official`，运行时无法判断应该使用成员凭据还是公司传输。

## 决策

**公司模型与成员模型使用不同的提供方路由。** `deepseek-official` 保留成员配置的目录、端点与凭据。挂载 LLM HTTP 传输时，同一个 DeepSeek 协议适配器还会注册 `built-in`；该路由读取传输目录，并经由传输发送调用，不解析成员的 DeepSeek 密钥。Team profile 会等待传输挂载后再加载适配器，并使用 `built-in` 作为默认提供方。

**模型目录携带可选的产品分类。** LLM 注册表在提供方元数据中保留 `category: 'built-in'`，`session/modelCatalog` 再把它投影到提供方分组中。即使缺少这项可选元数据，浏览器客户端也会本地化规范的 `built-in` 路由，并本地化其他携带该分类的分组。provider 与 model id 仍是选择标识。普通提供方继续显示适配器持有的名称。

**只有成员路由可配置。** 可配置提供方目录继续公开 `deepseek-official` 及其模型设置卡片。`built-in` 由部署策略提供，绝不会显示为成员可以编辑的、携带凭据的提供方。

**公司传输缺失时快速失败。** 已挂载传输不可用时，`built-in` 的目录与调用请求会以 `TRANSPORT` 失败。它们绝不会回退到成员端点，也不会解析成员的 DeepSeek 密钥。

这项路由拆分补充了既有的 [Runner 只指名一个模型，别无其他](../architecture/2026-08-30-a-runner-names-a-model-and-nothing-else.zh.md)与 [Control Plane 策略治理常驻 Runner](../architecture/2026-08-31-control-plane-policy-governs-the-resident-runner.zh.md)决策。两份 Agent Note 继续独立拥有请求隔离、授权与策略归属规则。

## 曾考虑的替代方案

**只在浏览器中重新分组。** 已否决，因为 provider id 决定调用路径。提交同一 provider id 的两个视觉分组无法选择两条不同的凭据与传输路径。

**把两个目录合并到 DeepSeek 下。** 已否决，因为公司模型的存在不能证明它由 DeepSeek 服务，而合并后的路由无法判断任意 model id 应使用成员凭据还是公司传输。

**为公司模型创建第二个协议适配器包。** 已否决，因为公司请求刻意复用 Runner 的提供方序列化与响应解析。按路由选择传输可以保留唯一一份协议实现，同时不混淆路由归属。

## 后果

成员存入 DeepSeek 密钥后，模型选择器与 Subagent 授权卡片可以同时显示 `DeepSeek` 与本地化的 `Built-in Models` 或 `内置模型` 标题；没有密钥时，[成员路由休眠决策](2026-09-03-member-deepseek-route-dormant-without-a-key.zh.md)只留下公司分组。成员的 DeepSeek 设置继续影响 `deepseek-official`，Control Plane 发现结果则只更新 `built-in`。

持久化的公司模型选择使用 provider `built-in`。这项预发布变更不会推断旧有 `deepseek-official` model id 属于成员还是公司；已有的歧义选择必须重新选择。

共享提供方与目录类型增加一个可选字面量分类。不渲染标题的消费方可以忽略它。展示客户端使用稳定的 `built-in` provider id 作为权威本地化信号，并使用分类识别其他产品持有的分组；它们绝不匹配提供方显示名称。
