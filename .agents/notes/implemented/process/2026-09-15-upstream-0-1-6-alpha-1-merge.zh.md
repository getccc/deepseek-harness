# Agent Note: 合并上游 0.1.6-alpha.1

Status: implemented

[English](2026-09-15-upstream-0-1-6-alpha-1-merge.md) | 中文

## 问题

上游发布了 `dsh-v0.1.6-alpha.1`，相对本线上次合并的 `dsh-v0.1.5-rc.2` 多了 89 个已合并 pull request（[上次合并](2026-09-10-two-stage-upstream-merge.zh.md)）。该版本重写了 Team Edition 所扩展的若干区域：DeepSeek 适配器拆分为 Chat Completions 与 Messages 两种协议并以 Messages 为默认，浏览器测试夹具被 `RemoteMock` 取代，Workspace 浏览器改由调用方派生顺序，agent preset 选择增加设置开关，composer 权限选择移入 `ui-permission-presets`，`agent/session-start` 变为需等待的 `agent/created`，同步读取 Session 事件被弃用，Session 日志上传默认开启。

## 决策

在分支 `merge/upstream-0.1.6-alpha.1` 上一步合并该标签，形式为一个合并提交加若干适配提交。双方矛盾时以 fork 行为为准；其余上游变更全部吸收。

fork 行为重新落在上游的新结构上，而不是保留一份分叉副本：

- Control Plane 的 `built-in` 路由位于 Chat Completions 协议适配器：该路由用传输的目录替代连接目录，图片以内联方式序列化，不解析密钥；分派器总是把 `built-in` 交给 Chat Completions，因为传输只承载 `chat.completions`。成员路由遵循上游的协议默认值，并在密钥未配置期间保持休眠。
- 最近列表、其类别过滤器以及不属于 Workspace 分组的聊天 Session 用上游的最近更新辅助函数派生顺序；手动排序只作用于 Workspace 树与单列表。
- 在上游的模式选择开关下，无工作区的聊天 preset 保留其徽章且永远不会成为设置默认值，hero 选择器只提供工作区 preset。
- 聊天 composer 规则移入 `ConversationContent` 与权限 slot，`/web` 本地化通过其 definition id 加入内置命令展示表，权限标签 只读／工作区可写／完全访问 移入 `ui-permission-presets`。
- Team bundle 关闭 `session-log-deepseek`，因为在公司路由上，日志后缀会经 Control Plane 到达公司提供方。
- 同步读取 Session 事件历史的 fork 代码在上游的延后迁移 lint 例外下保留调用；fork 的测试在发出 `agent/created` 时带上 `source`。

## 考虑过的替代方案

- **像 0.1.3 与 0.1.5 线那样选择性挑选。** 否决：适配器拆分、测试基础设施替换与权限选择迁移是后续大多数 pull request 的前提。
- **保留 fork 的单文件 DeepSeek 适配器。** 否决：会失去 Messages 协议、Files 对等能力与图片卸载水位线，且之后每次上游适配器变更都会再次冲突。
- **在插件中撤销上游的 Session 日志上传默认值。** 否决：仅使用 base 的部署的成员路由遵循上游；只有 Team 路由会把成员工作送到公司提供方。

## 影响

适配后 typecheck、lint 与 `pnpm run build` 通过。单元测试剩下的失败是本机原有的（`experimental/ptc-runtime-python` 需要 CPython 3.10 而本机为 3.9、macOS 上的 `spawn-runner` 用例），外加上游的 `webworker-packer` image-loadable 用例，其测试与源码与标签一致。文档门禁通过，其中 `packages/README.md` 的字数上限从上游的 994 提高到 1045，以容纳 Team Edition 的包分组。

Web e2e 在其夹具遵循 fork 的 Session 语义（`pristine`、`webAccess` Remote、无密钥时休眠的路由），并且打开 Session 时改为以倍增页而非固定 200 条消息页回溯到被截断轮次的起点之后通过。录制会话快照只在 CPython 3.9 的 PTC 场景失败。本次合并未重跑打包后的桌面 Runner：上游把 profile 解析改为运行时模式并让打包载体采用它，因此 WeWork 安装包构建需要单独验证。把 fork 的同步 Session 历史读取迁移到 projection 是延后的工作。
