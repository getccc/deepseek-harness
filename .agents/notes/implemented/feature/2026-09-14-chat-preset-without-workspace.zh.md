# Agent Note: 无工作区的聊天 preset

Status: implemented

[English](2026-09-14-chat-preset-without-workspace.md) | 中文

## 问题

每个 Web 会话都是工作会话：创建时解析一个工作目录，侧栏把会话按 Workspace 分组，composer 在选定 Workspace 之前一直是 inert。想向小微问一个问题的成员必须先选项目，然后等待首个 token，而标准 preset 把这段时间花在二十个工具 schema、一次 skills 扫描、一次 `AGENTS.md` 读取和一次目录 runtime-context 快照上，问题本身却根本不碰目录。产品想要一个与工作模式并列的聊天模式，像 Codex 和豆包那样：快，无工作区，其对话列在 Workspace 树下方的"最近"列表里而不是树内。

host 里有三个事实挡在前面。`session.create` 没有 Workspace 或 cwd 时兜底到 Runner 的 `process.cwd()`，桌面应用从 Finder 启动时那就是 `/`。会话列表和搜索丢掉每个 header 无 cwd 的冷会话，这个过滤是 7 月为退役 cwd 之前的 legacy 元数据加的。部署级 persona 后缀会插值 `{{cwd}}`，对没有记录 cwd 的会话直接抛错。

## 决定

**聊天模式是一个普通 agent preset 加一个不拥有 cwd 的会话。** host 层不存在会话类型。preset 的 `preset.yml` 声明 `workspace: required`（缺省即此值）或 `workspace: none`；discovery 把它解析到 `AgentPreset.workspace`，roster 行携带它，词汇之外的值把 preset 标为 broken 而不是默认掉。随附的 `chat` preset 声明 `none`，组合一个只有 prefix 没有 suffix 的 persona，从而把部署的 `{{cwd}}` 后缀遮蔽掉，再加标准的 compaction 组和一行 `allow: []` 的 `@deepseek-ai/dsh-tool-restriction`。

**位置决定组合。** 带 `workspaceId` 或 `cwd` 的 `session.create` 组合所命名的 preset 或 roster 的 `default`；两者皆无时组合所命名的 preset 或 roster 的 `chatDefault`，会话 header 不记录 cwd。`AgentPresets.resolveFor(workspace, id?)` 按类别选默认值，并以 `agent-preset/workspace-mismatch` 拒绝为另一类位置声明的 preset；`select` 对空会话施加同样的拒绝，所以聊天会话永远不会变成工作组合，反之亦然。没有组合 roster 的部署以 `session/location-required` 拒绝不带位置的创建；`process.cwd()` 兜底已删除。`SessionCreateValue` 回传会话拥有的 cwd，客户端的占位行在列表帧到达前就能说明会话的类别。

**无 cwd 的会话是完整的会话。** 列表、搜索、历史分页、follow、冷恢复、inspect 和 skill 目录都为它服务；Workspace 注册表不再把它记为无效路径，因为没有 Workspace 能索引它。它的日志位于持久层早已存在的 `_no-cwd` 目录。会话格式不变：header 里的 `cwd` 本来就是可选的。

**工具面是 host 事实。** `dsh-tool-restriction` 是 `ctx.tools.restrict()` 的配置面，挂在 preset 组合内；`allow: []` 为加入该 preset 的 agent 遮蔽全部全局工具，包括部署之后注册的工具，所以"聊天没有工具"不依赖每个 host 层工具自己的可见性规则。

**客户端只读一个事实。** `SessionSummary.kind` 在摘要不含 cwd 时为 `chat`，否则为 `work`，在 session service 里推导一次。侧栏顶部两项是"新对话"和"新工作任务"；`uiWorkspace.startChat()` 复用 pristine 的聊天会话或以不命名位置的方式新建一个；Workspace 树下方的 `sidebar.recent` 区块按最新优先列出会话，过滤器持久化（聊天、工作、全部；默认聊天），聊天会话绝不进入 Workspace 树或其单列表。聊天会话的 hero 不渲染 Workspace 行也不 inert；其 composer 隐藏访问 chip、plan slot 以及知识和 office 选择器；agent-preset chip 只提供 `required` 的 preset，也绝不把暂存的选择施加到聊天会话上。

## 曾考虑的替代方案

**在 preset 之外加一个 host 级会话类型。** header 上的 `kind` 字段或创建时的判别字段会重复 header 已经陈述的两个事实：preset 决定能力，cwd 有无决定 Workspace 归属。[Workspace 产品流程决定](../../archived/feature/2026-07-25-workspace-ui-product-flow.md)已因同样理由拒绝在 cwd 之外增加第二个归属字段。

**给聊天会话一个 scratch cwd。** 在固定目录下创建聊天会话可以让所有 cwd 守卫原样不动。拒绝：会话会宣称拥有一个它从不使用的目录，沙箱和文件工具会据此解析，Workspace 注册表的引导会把它领养为一个 Workspace。

**仅靠约定实现零工具。** 隐藏知识和 office 选择器后，每个 host 层工具仍由各自的可见性规则管辖，部署之后新增一个就会进入聊天会话。限制行只多一个小包，却让工具面成为挂载时的事实。

**在客户端推导聊天 preset id。** 侧栏本可以读 roster 并用 `none` 默认值的 id 创建。拒绝：不命名位置在 host 上已经选择了 `chatDefault`，客户端因此不携带任何 preset id，部署只在一处更改聊天组合。

**为工作 preset 保留 `process.cwd()` 兜底。** 没有生产调用方依赖它：Web 客户端总是命名 Workspace，SDK、headless、ACP 和 webhook 总是传 cwd。只有测试依赖它，而桌面 Runner 的 `process.cwd()` 是 `/`，正是这次改动要让其响亮失败的错误配置。

## 后果

成员一键开始聊天，首个 token 只等模型：在成员开启联网之前请求只携带 persona，没有工具 schema；开启之后恰好携带两个网页工具的 schema 及其指引，每次搜索在随附的 DeepSeek 路由上都是一次完整的辅助模型请求。聊天对话位于最近列表，绝不在 Workspace 里；工作对话仍然一键可达。没有 `chatDefault` 的部署里不带位置的创建会连同可以服务它的 preset 一起失败，需要工作区的 `chatDefault` 或不需要工作区的用户默认值会在它将组合的第一个会话处失败。之前把 `header.cwd` 缺失等同于"未找到"的每个读取方都必须为无 cwd 会话陈述自己的行为；ACP 会话列表保留其 cwd 过滤，因为 ACP 会话必须有 cwd。web 快照通道的 scaffold 曾拒绝无 cwd 的回放会话，现在接受，`snapshots/web/chat-preset` 以开关开启的状态固定聊天组合的提示词、工具 schema 与渲染。在 Team Runner 上，搜索以公司凭据经控制面离开（[Team 网页搜索](2026-09-15-team-web-search-through-the-control-plane.zh.md)）；其他部署里 DeepSeek provider 花的是成员自己的 `DEEPSEEK_API_KEY`。客户端视图存储键改为 `dsh.workspace.view.v6`，因为再水合是整体替换，旧文档缺少最近过滤器。
