# Agent Note: 分两阶段合并上游 0.1.5-rc.1

Status: implemented

[English](2026-09-10-two-stage-upstream-merge.md) | 中文

## 问题

在[选择性挑选](2026-09-10-selective-upstream-0-1-5-picks.zh.md)之后，本线还想要三项上游能力，而它们都不是可挑选的提交：带后台进度的通用文件上传（[记录](../feature/2026-08-26-generic-file-upload.zh.md)）、带可 steer 队列的可继续子代理（[记录](../feature/2026-07-28-continuable-subagent-conversations.zh.md)），以及带标签、分栏、全屏、文档预览与显式文件交付的右侧 Sidebar（[记录](../architecture/2026-09-05-sidebar-tab-types-and-navigation.zh.md)）。三者都建立在会话格式 v2 与 v3、`SessionHandle` 持久化、apiremote 错误契约和聊天表面重写之上，而挑选恰恰把这些基础留在了后面；逐项移植意味着手工搬运每一项基础。

## 决策

以两次完整合并取得这些基础，每次合并后各自验证：先 `dsh-v0.1.3-alpha.2`，再 `dsh-v0.1.5-rc.1`，都在分支 `merge/upstream-0.1.3-alpha.2` 上进行。每个阶段两个提交：合并的文本解决，然后是让代码树能编译、能通过测试与文档门禁的适配。生成的目录、图与 Web 黄金文件在文本步骤取上游，在适配步骤重新生成；只生成英文的生成器输出，其中文侧按小节从上一次适配移植并重新记录。

Team 安装程序随附的第三方 sidebar、办公预览器、Univer 与 ECharts 插件被弃用，改用上游的 Sidebar 与文件交付：`apps/team-runner-desktop/src/profile.ts` 中的 `SHIPPED_PLUGIN_BUNDLES` 为空，成员电脑上的 Team profile manifest 只列出 Runner 自带的 bundle。本线不为历史会话日志提供迁移路径：合并前记录的会话重新创建，而不做转换。

由 fork 拥有的行为重新安放到上游结构上，而不是保留一份分叉副本：助手身份头部成为上游 `ChatNodeSeat` 中的一个 `useChat` 选择器，在轮次的首行渲染 `TurnActivityHeader`，首行由上游按轮次的过程呈现算出，而不再私自复制那套布局；浏览器锁定路由与 `browserSession` 位于 `client-connection` 中上游的 `webServer` 注入之内；`PopupMultiSelectSpec` 加入上游的 `PopupSelectSpec` 与 `ActionSpec` 联合类型；设置启动器 slot 包住上游的触发器与连接指示器；Welinkin 标记与名称是 Sidebar 的回退品牌，hero 标题 slot 取代了鱼；小微文案保留在上游的 locale 键上，`reasoning.running` 是推理行读取的唯一 fork 键。

沿途满足的仓库规则：不断言任何关系的不变量伴随插件被移除并在 README 写明原因，而不是空着发布；`gen-config-catalog` 解析 `...spread` 对象字段，使 Control Plane 配置包得以生成；`gen-tsconfig-paths` 拥有 `tsconfig.base.json`，其中四个名称与目录不同的包使用手写条目；`gen-persistence-catalog` 拥有 `known-event-types.ts`，此前它缺少 fork 的 `office/kind` 事件。

## 考虑过的替代方案

- **在选择性线上把三项功能作为挑选移植。** 否决：试运行显示仅文件上传就有六十个冲突块分布在二十八个文件中，而且三项都需要同样的会话与聊天基础。
- **一步合并 `dsh-v0.1.5-rc.1`。** 否决：与选择性线相比有 265 个冲突文件，两代格式之间没有任何一个代码树能编译的节点。
- **在上游 Sidebar 旁保留第三方 sidebar。** 否决：两者都声明右栏与文件打开入口，而办公预览器只向第三方服务注册。

## 后果

阶段 1 以 `c22bd0a46f` 与 `794ec7891c` 落地；阶段 2 以文本检查点 `beb016e1d6` 与携带本记录的适配提交落地。阶段 2 结束时，typecheck、lint、898 对双语配对与包不变量门禁均为绿色；剩余的单元测试失败是 `dev` 线原本就有的（app-frame 标题、缺少已构建前端的管理控制台、Python 运行时所需的 CPython 3.9）以及两个在 macOS 上以未改动的上游内容失败的上游套件。Web 黄金文件是上游的，需要用 fork 品牌在本地刷新。工具写出的办公文档通过工作区与 Sidebar 的文件树到达成员；`ui-office` 的产出文件识别器随第三方预览器一起离开，经上游 `deliverFile` 接缝交付是后续事项。[交付物卡片](../feature/2026-09-04-deliverable-cards-open-in-the-sidebar.zh.md)与[桌面安装程序](../architecture/2026-09-03-desktop-installer-carries-the-deployment.zh.md)两条记录中描述随附插件树的部分已被取代。
