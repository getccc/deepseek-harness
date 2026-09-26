# Agent Note: 合并上游 0.1.6-alpha.2

Status: implemented

[English](2026-09-18-upstream-0-1-6-alpha-2-merge.md) | 中文

## Problem

上游发布了 `dsh-v0.1.6-alpha.2`，相对本线最后一次合并的 `dsh-v0.1.6-alpha.1`（[上一次合并](2026-09-15-upstream-0-1-6-alpha-1-merge.zh.md)）合入了 75 个 pull request。该版本重写了 Team Edition 扩展所在的多个区域：Conversation 变成带自有宽度控件的可复用 Factory，Session 列表以本地引用计数取代 `current`，`ISessions` 移除了 `open` 与 `clear`（主视图导航迁到 `uiWorkspace`），Sidebar 新增 Windows 标题栏与 macOS 顶部条布局，profile 重载从 `ProfileTemplate.patchReload` 迁入 `hmr` 行，插件管理成为带 Web 页面的服务，右侧 Sidebar 新增基于 Host 转换的办公预览。

## Decision

在分支 `merge/upstream-0.1.6-alpha.2` 上一次性合并该 tag：先一个 merge commit，随后是若干适配 commit。两侧冲突时以 fork 行为为准；其余上游变更全部吸纳。

以下 fork 行为被重新安放到上游的新结构上，而不是保留为分叉副本：

- Session 摘要在上游的 `retainedBy` 之外保留 fork 的 `kind`；所有原先读取已废弃 `SessionListState.current` 的消费方改读主视图引用计数。
- `uiWorkspace` 保留 fork 的 pristine Session 复用与聊天启动，同时采用上游的 `SessionTarget` 导航，并新增 `clearSession()`，为 Team 登录落地页与知识面板提供 `sessions.clear` 与 `sessions.open` 原先提供的公开席位。
- Conversation Factory 的 children 以 fork 的 `conversation.hero.headline` 取代上游的品牌标记子槽；composer 保留语音席位，上下文计量则随上游移入 dock。
- Sidebar 采用 Windows 标题栏与 macOS 顶部条，但保留 WeWork 标志与「新建对话／新建工作任务」两行；那些把上游单个 New Session 按钮固定到标题栏的规则被删除，而不是留下指向本 fork 并不渲染的元素。
- `/` 弹出选择器在上游的 Tab 接受与当前值高亮之外，保留其多选外壳。

办公阅读器的归属在同一分支中改变（[决策](../feature/2026-09-18-upstream-office-preview-replaces-the-fork-renderers.zh.md)）。

## Alternatives considered

- **再次拆解该版本逐项挑拣。** 拒绝，理由与上一次合并相同：alpha.2 把 Conversation、Session 列表与 profile 解析一起重写，逐项挑拣就必须手工重新推导这些关系。
- **把 `ProfileTemplate.patchReload` 保留为 fork 字段。** 拒绝：上游删除了该字段，并把该生命周期移入 `hmr` 行，而 `dsh-base` 为每个 profile 启用该行且模块根列表为空。Team profile 不声明该行即继承「仅配置监视」，Control Plane bundle 不叠加 base，因而仍然不监视任何东西——正是该字段原本要表达的两种行为。

## Consequences

`test:snapshot` 与 `test:expected` 通过各自的 gate 运行时为绿，这些 gate 使用 `DSH_EXAMPLE_MODE=lib`。直接运行 `pnpm run test:snapshot` 现在会失败：上游把启动器的默认 profile 解析方式由 `link` 改为 `runtime`，因此在 `src` 启动下，一部分行经 profile 解析到已构建的 `lib/`，其余则落到 tsconfig paths 映射进入 `src`，`@deepseek-ai/dsh-tools` 因此被加载两次——其 `TOOL_RUNTIME_SCHEDULER` symbol 随即无法匹配，`agent-loop` 中每次工具调用都会失败。在源码启动重新统一到单一平面之前，请使用该 gate，或设置 `DSH_EXAMPLE_MODE=lib`。

fork 的 runtime-closure gate 会遍历应用包，上游的版本不会，因此上游新随附的 `OPTIONAL_BUNDLES` 通过 `@deepseek-ai/dsh` 触达 experimental 对等包，并要求把它们写进 deploy root，而 `verify-default-product-isolation` 要求该 root 不含 experimental 包。该 gate 现在在 optional bundle 处停止遍历，因为它由使用者自行开启，其对等包随该选择一同到来。

有两个与本次合并无关、依赖宿主环境的测试失败，在上一分支同样复现：Python PTC 运行时需要 CPython 3.10，而本机 `/usr/bin/python3` 是 3.9.6；`spawn-runner` 中一条 Windows 路径断言在 macOS 上不成立。上游的桌面更新测试在把 `process.platform` 打桩为 `win32` 时沿用了测试宿主的架构，而更新策略自身的身份规则只接受 x64，因此该打桩现在同时指定架构。
