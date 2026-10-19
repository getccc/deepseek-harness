# Agent Note: V3 之前的 WeWork Session 保留知识范围与办公类型事件

Status: implemented

[English](2026-09-26-wework-pre-v3-session-events.md) | 中文

## Problem

WeWork 构建一直写入 Session 格式 v0，直到 2026-09-11 合并上游 0.1.5-rc.2 时写入端改为 V3；2026-09-10 合并上游 0.1.3-alpha.2 的两个集成检查点写入 v2。这些写入端把 `knowledge/scope`（自 2026-09-01 起）与 `office/kind`（自 2026-09-03 起）记录为必需事件。`session-format-v0-to-v1` 中冻结的 v0 清单只列出上游已发布的事件，而 v1→v2 与 v2→v3 迁移边复用这份清单，因此打开这类 Session 会以 `unknown historical event type "knowledge/scope"` 拒绝迁移。一名成员的 Session 存储副本在 164 个日志中含 9 个这样的 v0 日志。

## Decision

`RELEASED_V0_EVENT_DISPOSITIONS` 按这些写入端记录的 payload 成员准确收录两个事件：

- `knowledge/scope`：`version` 为 1，`mode` 为 `off`、`all` 或 `selected`。`selected` 要求非空的 `bases` 数组，其元素为 `{ ref, displayName }`；`ref` 遵循已发布的 `<providerKind>:<sourceCode>:<upstreamId>` 语法（各段使用审计令牌字符集，source code 至多 19 个字符，总长至多 64 个字符），`displayName` 非空。其他模式不带 `bases`。
- `office/kind`：`version` 为 1，`kind` 取自已发布办公选择器写过的全部值：`none`、`word`、`excel`、`ppt`、`chart`，以及已停用的 `amec-ppt` 与 `welinkin-ppt`。

`RELEASED_V2_EVENT_DISPOSITIONS` 继承这两项，因此 v1 中间结果与 v2 源日志走同一路径。事件原样到达 V4，`RELEASED_V3_EVENT_TYPES` 已列出它们（[合并记录](../process/2026-09-26-upstream-0-1-7-rc-2-merge.zh.md)）。已安装的读取方把已停用的 kind 视为 `none`，因为 `foldOfficeChoice()` 会丢弃它无法渲染的 kind。

`bi/scope` 与 `web/access` 不进入 v0 与 v2 清单。`web/access` 首次出现于 2026-09-15，`bi/scope` 首次出现于 2026-09-17，都在写入端改为 V3 之后，因此没有 v0–v2 日志包含它们。迁移在每个未改动的历史代次旁发布 V4 后继文件，符合[相邻迁移决策](../architecture/2026-08-31-released-session-format-migrations.zh.md)的要求。

## Alternatives considered

**把 WeWork 事件作为不透明 JSON 收录。** 已安装的读取方折叠 `knowledge/scope` 数据时不再解析它，不透明收录会让格式错误的范围进入知识提示词段落。v0 迁移边校验每个收录的 payload，以防止这种情况。

**只收录当前选择器提供的办公类型。** 成员日志记录了 2026-09-03 至 2026-09-09 间发布的构建写入的 `amec-ppt` 与 `welinkin-ppt`；拒绝这些值会使相应 Session 无法读取。

**同时把 `bi/scope` 与 `web/access` 加入 v0 与 v2 清单。** V3 之前没有写入端记录过它们，因此不存在可审计的 payload；收录它们会接受只有损坏或伪造的日志才会携带的事件。

## Consequences

V3 之前的 WeWork Session 迁移到 V4 后保留知识范围与办公类型。在 2026-09-26 取得的本机 Session 存储副本上，`scripts/migrate-sessions-to-v4.ts` 转换了 164 个 Session 中的 163 个，此前为 154 个；剩余的失败来自既有的一行损坏 `tool-call-chunks`。新转换的 9 个 v0 源文件字节均未改变，其 V4 后继文件按相同顺序携带相同的范围与类型事件。

[`validation.spec.ts`](../../../../packages/session/session-format-v0-to-v1/tests/validation.spec.ts) 覆盖每个已发布取值与被拒绝的变体。[`wework-historical-events.spec.ts`](../../../../packages/session/session-format-catalog/tests/wework-historical-events.spec.ts) 把 v0 与 v2 夹具还原到当前写入端，并检查对 `bi/scope` 与 `web/access` 的拒绝。
