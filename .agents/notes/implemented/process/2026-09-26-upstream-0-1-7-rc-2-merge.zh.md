# Agent Note: 合并上游 0.1.7-rc.2

Status: implemented

[English](2026-09-26-upstream-0-1-7-rc-2-merge.md) | 中文

## Problem

上游发布了 `dsh-v0.1.7-rc.2`，相对本线最后一次合并的 `dsh-v0.1.6-alpha.2`（[上一次合并](2026-09-18-upstream-0-1-6-alpha-2-merge.zh.md)）合入了 268 个 pull request。该版本替换了 Team Edition 所依赖的三样东西：Agent 预设改为由 bundle 声明的插件行（`agent-preset` 与 `agent-preset-registry`），不再由 `agent-presets` 扫描目录；官方 DeepSeek 适配器只保留 Messages API，其路由注册移入 `llm-deepseek-api-key`，旁边新增 DeepSeek 账号路由；Session 日志升级为 V4 格式，其 V3 迁移会拒绝任何不认识的必需 V3 事件。它还把工作区浏览器的会话行操作改写为经插槽注册的置顶、重命名、分叉与归档操作，用状态与耗时取代整轮的工具调用计数摘要，重命名了全部图标原语，并新增带独立侧边栏入口的 DeepSeek 账号登录。

## Decision

在分支 `merge/upstream-0.1.7-rc.2` 上一次性合并该 tag：先一个 merge commit，随后是若干适配 commit。两侧冲突时以 fork 行为为准；其余上游变更全部吸纳。

以下 fork 行为被重新安放到上游的新结构上：

- **聊天模式。** `chat` 预设是 Web bundle 的 `presets/chat.patch.yml` 中一行 `@deepseek-ai/dsh-agent-preset`，声明 `workspace: none`。`agent-preset-registry` 新增 `workspace` 声明、`chatDefault` 配置、`resolveFor(workspace, id?)`，并在 `select` 中给出 `agent-preset/workspace-mismatch` 拒绝，因此无 cwd 的 Session 创建与 webhook 仍解析到原来的预设。设置页与新任务选择器在上游重写后的 store 上保留聊天模式规则。
- **最近列表。** `RecentBrowser` 保留 `sidebar.recent` 插槽，但渲染工作区浏览器自己的行插槽；浏览器挂载期间通过一个包内私有 store 共享这些插槽。聊天会话因此获得上游的置顶、重命名、分叉、归档、悬停操作与插件行标记，而不再使用 fork 单独的操作对象。
- **公司模型。** `llm-deepseek` 为 `built-in` 路由保留一个只经 Transport 发送的 Chat Completions 适配器（`src/chat-completions/`），因为 Team Transport 承载的是 `chat.completions` 操作。`llm-deepseek-api-key` 在注入 `llmHttpTransport` 期间注册该路由，并让成员路由在其密钥可解析之前保持休眠。旧 Chat Completions 适配器的直连请求与 Files API 分支被删除：按上游的决定，成员路由只使用 Messages。
- **已发布的 Session。** `RELEASED_V3_EVENT_TYPES` 包含 `bi/scope`、`knowledge/scope`、`office/kind` 与 `web/access`，它们是已发布的 WeWork V3 写入端作为必需事件记录的类型；`verify-v3-event-vocabulary` 与 fork 最后一个 V3 写入端完全一致。
- **DeepSeek 账号。** Team bundle 禁用 `deepseek-account`、`llm-deepseek-account`、`account-controller` 与 `ui-settings-account`：个人平台余额会绕过 Control Plane 的授权与审计，而账号入口会占用 `settings.launcher` 插槽（现由 `ui-settings` 声明），该插槽由 Team 账号入口占据。
- **对话中的身份。** 小微身份标头与人设措辞移到上游的轮次状态控件上（「小微用时 {duration}」），而不是恢复 fork 的工具调用计数摘要。

## Alternatives considered

- **把 `agent-presets` 包保留为 fork 副本。** 拒绝：上游的设置页、创造模式、插件管理与组合清单都读取注册表，第二套预设系统会让每个消费方分裂。
- **把公司路由迁到 Messages 协议。** 本次合并不采用：这需要新的 Transport 操作，并在每个部署上发布新的 Control Plane，而现有的 Chat Completions 路径无需改动即可工作。
- **为最近列表再声明一份行插槽。** 拒绝：一个插槽只有一个声明方，副本会让聊天行看不到插件的行操作与定时标记。

## Consequences

工作区依赖范围遵循上游规则（DSH 包用 `workspace:*`，vendor 与 native 用 `workspace:~`），fork 包使用根版本号。

对本机 Session 存储做 V4 迁移时，全部 V3 日志（含 fork 事件）都转换成功。九个记录了 `knowledge/scope` 或 `office/kind` 的早期 v0 日志仍在冻结的 v0 边界失败，因为该边界的载荷表未列出这两个类型；同样的日志在本次合并之前的分支上也会失败，因此本次合并既不导致也不修复这一问题。

在 macOS 上收起侧边栏时，侧边栏的前置控件变为三个（切换、新对话、新工作任务），因此 frame 的前置留白增至 196px，全屏时为 120px。新建会话快捷键开始一个工作任务。
