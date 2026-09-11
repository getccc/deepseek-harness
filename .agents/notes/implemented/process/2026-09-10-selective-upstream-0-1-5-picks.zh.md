# Agent Note: 选择性挑选上游 0.1.5-rc.1

Status: implemented

[English](2026-09-10-selective-upstream-0-1-5-picks.md) | 中文

## Problem

`dev` 线在上游 `dsh-v0.1.2-alpha.1` 之上承载 Team Edition 包与产品身份，并已从 `dsh-v0.1.3-alpha.1` 选择性挑选了 18 个变更。此后上游一路合并了 112 个 first-parent 提交直到 `dsh-v0.1.5-rc.1`，其中包含本线没有的基础：带 `SessionHandle` 与序号品牌类型的 session 格式 v2 和 v3、移除 `ctx.agent` 与 `Inbox` 类、取代 Detail 面板的右侧 Sidebar、composer 的通用文件上传、Web 连接恢复，以及把共享工具函数移入 `dsh-util-values` 的运行时依赖解耦。对该 tag 的试合并有 233 个文件冲突，大多位于产品身份所修改的 client 包和 45 个仅存在于本 fork 的包所组合的持久化包中。本 fork 还保留自己的产品决定，因此照单全收上游默认值的合并不可接受。

## Decision

上游变更按 pull request 逐个、按上游顺序 cherry-pick 到 `dev`，每个 pull request 一个提交，标题以 `(upstream #NNNN)` 结尾，正文写明每一处本线适配。当 pull request 自身的变更可以用本线的 API 表达时才挑选；由缺失的上游前置变更引起的冲突，只在 pull request 自身增量很小时手工移植，并在提交正文记录。生成的文档用仓库生成器重新生成而不是合并，中文侧逐行移植。产品默认值遵循本线：随附默认模型在网关提供 `deepseek-flash` 之前仍为 `deepseek-v4-flash`，品牌与 persona UI 保持不动，每个新包都补上本线仍要求的 `./invariant` 伴随文件。

### 已挑选

模型与提供方：#3613 pi-ai 0.85.1、#3724 pi-ai 设置恢复、#3792 Base URL 校验、#3824 DeepSeek-V41-Flash 目录条目、#3507 模型切换提示。工具与指引：#3611 基于 base 的 profile 用 read/write/edit 编辑文件、#3853 按作用域裁剪工具指引、#3517 根标记 stat 错误、#3523 拒绝空 prompt、#3485（仅执行时守卫）。Client：#3484 resume header、#3605 嵌套 terminal 卡片、#3680 思考摘要标记、#3791 中文显示模式与模型文案、#3839 composer 占位提示、#3557 斜杠命令说明、#3409 与 #3700 在本地应用中打开 Workspace、#3698 与 #3368 Windows 文件夹选择器。平台：#3672 惰性观察事件、#3673 typert 转发再导出、#3686 从模板创建 profile、#3787 Codex 与 Claude Code 运行时、#3846 MCP 分页游标、#3713 与 #3720。

### 因缺失前置变更而推迟

#3580 需要 #3305 连接恢复；#3582、#3681 与 #3671 需要 #3109 文件上传 composer；#3590 与 #3794 需要 #3316 插件列表；#3618、#3630 与 #3537 需要 session 格式 v2（#3346、#3400）；#3789 需要 #3305 的 shell 翻译器；#3485 的激活事件与 Web 恢复控件需要 #2742、#2774 与 #3346 的投影状态 API。整组变更在其基础移植前不进入本线：Sidebar（#3569、#3588、#3784、#3798、#3807、#3859、#3890、#3909、#3819、#3832）、session 格式 v3（#3535、#3585、#3586、#3631、#3851、#3866）、显式 agent 上下文（#3295、#2672、#3223、#3674、#3884）、原生子进程约束（#2825、#3708、#3804）、Electron（#3413）、反馈上报（#3598、#3765）、composer 与统计打磨（#3699）、环境提示词后缀（#3644）、仅 shell 的 minimal profile（#3510）、package manifest 包（#3602），以及发布依赖面（#3771）。

### 不适用

#3664 修复的是本线没有的滚动采样防抖；#3871 修复的是本线不持有的文件锁；#3466、#3632 与 #3726 只改动笔记和技能；上游的 CI、评审自动化、runner 与模板 pull request、四次版本号提升，以及两对已回滚的变更（#3337/#3778、#3710/#3901）对本线没有内容。

## Alternatives considered

- **把 `dsh-v0.1.5-rc.1` 合并进 `dev`。** 否决：233 个冲突文件包含 persona 与品牌 UI，以及仅存在于本 fork 的包所组合的 session、agent 与 inbox API；解决它们意味着一步移植所有被跳过的基础，且无法逐个变更验证。
- **把 `dev` rebase 到上游。** 否决：它重写每个 fork 提交并遇到同样的冲突。
- **等待稳定的上游发布。** 否决：前置变更的差距随每次发布扩大，而上述修复现在就需要。

## Consequences

之后每次挑选都要付出一次手工适配，上面的推迟列表就是基础移植后可以解锁的积压。上游以 v2 或 v3 录制覆盖的模型可见变更在本线依赖单元测试：model-switch-notice 场景与 system-prompt-in-history 场景未被带入。从上游取来的 Web 快照（`command-menu-zh`、`onboarding-deepseek-config/default-models` 与 `models`）仍需在本线本地刷新。作为交换，本线获得上面列出的修复与功能，并保留每个上游 pull request 编号，下次同步可以按编号比对。
