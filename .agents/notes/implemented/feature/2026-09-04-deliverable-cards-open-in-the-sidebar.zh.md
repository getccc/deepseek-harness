# Agent Note: deliverable cards open in the sidebar

Status: implemented

[English](2026-09-04-deliverable-cards-open-in-the-sidebar.md) | 中文

## 问题

一位 Team 成员向 Welinkin Work 桌面应用要一份 Word 文档、一个工作簿或一套幻灯片，轮次结束时却没有任何可点的东西。办公工具通过 `univer_export` 交回文档，其 `output` 参数指明写出的 `.docx`、`.xlsx` 或 `.pptx` 文件；产出文件行只读取 `write`、`edit` 与 `str_replace_editor`，因此产出了幻灯片的轮次根本没有产出行，文档只能到资源管理器里去找。模型经 `write` 写出的 `.md` 倒是会出现，作为源文件之间的一个标签。成员的参照物是 Trae：轮次末尾一张点名文档的卡片，点击后在对话旁的预览中打开它。

在产出行与这种体验之间还横着两件事。部署随附的侧栏插件 `dsh-better-sidebar` 通过包装 `ctx.workspaces.openPath`——曾经每次对话侧打开文件都要经过的入口——来预览文件；此后对话改为直接调用 `session.openWorkspacePath`，插件的包装便包住了空无一物，点击原生标签会经操作系统离开，而成员实际看到的是插件以优先级 `-1` 注册的同款行。此外，侧栏自己能预览图片、Markdown、HTML 与 PDF，但 `.xlsx` 只回答 `此文件类型不支持预览` 和一个下载按钮：办公预览住在侧栏自己的目录所推荐的另一个插件里，而部署没有随附它。

## 决策

**本轮产出的文档是一张卡片。** `dsh-client-ui-deliverables` 把 `.md`、`.docx`、`.xlsx`、`.csv`、`.pptx` 或 `.pdf` 渲染为卡片——以扩展名标出类别的色块、文件名、路径——叠放在保留其余每个文件的标签行上方。`documentKind` 按扩展名决定，只产出文档的轮次不显示标签行。该条目以 `TURN_TAIL_PRIORITY` 即 `-10` 注册，低于默认序，也低于侧栏的同款行，因此成员看到的是卡片。

**产出行向拥有工具的插件学习工具。** `ctx.deliverables.recognize({ tool, path })` 教会词表一个工具：`path` 从一次调用已解析的参数中读出产出路径，此后成功的调用就像 `write` 一样把它列出。Definition 在每次折叠时读取实时的识别器集合，集合一变化便重新注册，因此已在屏幕上的对话会带着刚学会的工具重新折叠；第一方集合与已教会的工具都拒绝第二位教师。`dsh-client-ui-office`——本就代表办公工具发言的包——教会它读取 `output` 的 `univer_export`。

**`ctx.workspaces.openPath`重新成为浏览器唯一的文件打开入口。** `IWorkspaces` 承载 `openPath(path)`，`WorkspaceController` 把已解析的路径交给 `session.openWorkspacePath`，并把 Host 自己的消息作为 `WorkspaceOpenPathError` 抛出，对话的 `openFile` 按 Session 工作区解析后调用它。每张卡片、每个标签、工具行的路径链接与正文提及都经此离开，因此侧栏插件的包装把它们全部接进自己的编辑器标签页——它会展开面板并按扩展名匹配查看器；没有这类插件的部署一如既往地到达 Host 打开器。

**桌面安装器随附办公预览插件。** `@huanlin/dsh-plugin-better-sidebar-plugin-office`——侧栏自己的目录为 `.docx`、`.xlsx` 与 `.pptx` 点名的插件——加入 `SHIPPED_PLUGIN_BUNDLES`，排在它所注册的侧栏之后，安装进 `DSH_TEAM_PLUGIN_TREE` 所暂存的那个 staging profile 的 `node_modules`。

## 考虑过的替代方案

**在产出物包里直接读取 `univer_export`。** 在 `mutationPath` 里多加一个分支就能列出该文件，无需接缝。被否决：那样本包就要点名一个它别无所知的第三方工具，此后每个新工具都要同样改一次。接缝只多一个服务方法，并把办公耦合放在办公提示词早已所在的位置。

**读取呈现器的 `locations` 而非参数。** 侧栏的同款行从 `ToolCallView.locations` 推导产出文件。被否决：`univer_export` 不呈现任何 location，而 Definition 折叠的是 Session 事件——它们携带参数而非呈现；识别器读取的是真正存在的东西。

**让侧栏的同款行留在前面。** 被否决：同款行渲染的是标签，而成员要的是卡片。遮蔽它只需一个优先级常量，侧栏自己的打开仍然可用，因为它们经过本决策恢复的那个入口。

**从卡片直接调用侧栏服务。** 卡片可以在 `ctx.betterSidebar.openTab` 存在时经它打开文件。被否决：harness 将因此认识一个插件的面孔，而标签、工具行与正文提及各自都需要同样的认识。恢复插件早已包装的那个唯一入口能同时服务它们全部。

**在 harness 里自行渲染办公预览。** 为 `.docx`、`.xlsx` 与 `.pptx` 自建查看器需要推荐插件所携带的同一批渲染库。依据[依赖优先于手写](../process/2026-07-26-dependencies-over-hand-rolling.zh.md)被否决：该插件已存在、有人维护，并通过侧栏文档化的查看器服务注册。

## 后果

交回文档的轮次以一张卡片收尾；点击它会展开侧栏，随附办公预览插件后，工作簿、文档或幻灯片就在那里渲染，而 `.md` 在侧栏的 Markdown 预览中打开。对话侧的每次打开重新经过一个插件可以包装的方法，侧栏现有的拦截正依赖于此，对话与工具测试断言的也改为 Workspace 服务调用而非 Remote。模型为验证工作而做的往返探针导出会像任何成功导出一样被列出，直到模型删除它，因为词表读取的是参数；经 shell 命令写出的文档则完全不会列出。安装器因办公预览插件的渲染库而变大。`ui-deliverables`、`ui-office`、`workspace-controller`、`ui-chat` 与 `ui-tool` 的客户端测试钉住了卡片、被教会的工具、入口及其拒绝；打包应用需要带着暂存的插件树重新构建，成员才能看到预览插件。
