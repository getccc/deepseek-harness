# Agent Note: 合并上游 0.2.1-rc.2

Status: implemented

[English](2026-10-19-upstream-0-2-1-rc-2-merge.md) | 中文

## Problem

上游发布了 `dsh-v0.2.1-rc.2`，相对本线最后一次合并的 `dsh-v0.1.7-rc.2`（[上一次合并](2026-09-26-upstream-0-1-7-rc-2-merge.zh.md)）新增 2,373 个提交。该版本替换了 Team Edition 所依赖的若干结构：Session 创建改为 `createSession`，按名称复用空白 Session，不再接管显式身份；聊天记录经新的 `conversation.chat.flow` slot 渲染；Web 运行时公告 `publicUrl`，并把开发者提示词分节移入 `harness-dev-context` 行；浏览器会话 cookie 按监听器协议划分受众，并在 TLS 监听器上携带 `Secure`；运行时不变式伴生入口被移除；弹窗命令外壳新增选项分组与搜索模式。

## Decision

在分支 `merge/upstream-0.2.1-rc.2` 上一步合并该标签，形式为一个合并提交加若干适配提交。两侧矛盾时以本 fork 的行为为准；上游其余变更全部保留。

在上游新结构上重新落位的 fork 行为：

- **对话 Session。** `ApiSessionCreateRequest.cwd` 可以缺省。`createSession`、`claim` 与 `createAgent` 会创建没有 cwd 的 Session，并经 `resolveFor` 组合 roster 的 `chatDefault`；`session.create` 回显 Session 拥有的 cwd。未组合 roster 的部署以 `session/location-required` 拒绝不带位置的创建。冷列表保留没有 cwd 的 Session。
- **默认模型。** `settleDefaultSelection` 仍在提示词准入前，把没有自身选择的 Session 绑定到模型目录的默认模型。
- **身份头部。** `conversation.chat.assistant-identity` 成为 `conversation.chat.flow` 的子 slot；`ChatFlow` 构造 `renderIdentity`，由轮次的首个 `ChatNodeSeat` 渲染 `TurnActivityHeader`。
- **Web 界面上下文。** `web-app` 在 `publicUrl` 旁保留 `entryPath`、`surfaceAudience` 与 `surfaceName`。开发者受众的定位来自 `harness-dev-context`；`member` 受众注册自己的 `app:web-surface` 分节，Team bundle 禁用 `harness-dev-context`。
- **浏览器会话。** `issueSession`、`lock` 与 `endSession` 接收监听器的 TLS 状态，因此 Team 登录、handoff 与锁定路由使用上游的 cookie 受众。
- **Workspace 导航。** 新工作任务经上游的具名空白创建只复用未改动的空白 Session；新对话指名未改动的对话 Session，或创建不带位置的 Session；由宿主的复用规则取代客户端的 writer-held 回退。
- **弹窗。** 多选弹窗类型携带上游的搜索文案与模式，并在上游的分组 listbox 中勾选行。
- **公司模型。** `built-in` Chat Completions 适配器共享上游按路由仅记录一次的扩展日志，并报告接受失败。
- **文案与品牌。** 小微文案落在上游重命名后的轮次过程键上（「小微已完成，用时」），权限标签保持「只读／工作区可写／完全访问」，`ui-brand-official` 继续移除。

## Alternatives considered

- **在 `createSession` 旁保留 `ensureSession`。** 已拒绝：上游的命令、测试与空白复用全部经过 `createSession`，第二条创建路径会让每个消费方分叉。
- **把开发者提示词分节重新加回 `web-app`。** 已拒绝：上游把它们移到了 `harness-dev-context`，其旧段落投影能保持已恢复 Session 的提示词稳定；`web-app` 只保留成员定位。

## Consequences

宿主聚合程序做类型检查约需 4.5 GB，因此宿主编译器堆上限设为 6 GB。上游的 Typert 门禁拒绝解析到构建产物的导入，因此 fork 的 `/types` 与 `/client` 子路径导出在 `tsconfig.base.json` 中有手写的源码别名。
