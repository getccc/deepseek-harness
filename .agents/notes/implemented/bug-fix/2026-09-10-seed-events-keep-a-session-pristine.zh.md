# Agent Note: 创建时钉住的事实让会话保持 pristine

Status: implemented

[English](2026-09-10-seed-events-keep-a-session-pristine.md) | 中文

## 问题

`pristine` 是 New Session 用来交回一段未被动过的对话、而不是别人已设置好的对话所读取的位；会话列表投影曾在任何事件上结束它。上游 0.1.5 会在任何人看到之前为每个新会话钉住权限预设、沙箱模式与审批策略，Web 流程也同样记录挂载的 agent 预设，因此在[分两阶段合并](../process/2026-09-10-two-stage-upstream-merge.zh.md)之后没有任何会话是 pristine 的：每次点击 New Session 都会创建另一段对话，hero 的第一条提示词去了第二个会话，而第一个留下成为孤儿，Web 生命周期场景在期望一个的地方数出了两个已落盘的会话。

## 决策

投影把组合在创建时写入的种子事件——`permission/preset`、`sandbox/mode`、`approval/policy`、`agent-preset/selected`——视为描述构建而非个人选择，因此它们不动 `pristine`；其他任何事件仍然结束它。投影的 `stateVersion` 升到 3，让曾把种子事件算进去的缓存被重新计算。fixture Connection 在这里同样镜像 Host：它创建的会话在第一条提示词之前是 pristine 的，组装 jsdom 车道正需要这样才能复用空白会话，保住粘贴与回显场景所驱动的常驻编辑器。

## 考虑过的替代方案

- **像上游那样复用仅仅空白的会话。** 否决：本 fork 把别人已选了模型或知识的对话留在 New Session 之外，而 `blank` 分不出这两者。
- **用时间窗而不是事件名来界定种子。** 否决：事件的含义在于其类型，封闭集合在新的种子事件出现时仍可被检查。

## 后果

个人自己的设置——模型选择、知识范围、办公类型、命令、计划模式、标题——仍然结束 pristine。在空白会话上手动选择的权限预设不再结束它，这会把这一项偏好交回同一台电脑上的下一次 New Session；另一个选项是让每段对话都不可复用。`session-list-blank.host.spec.ts` 钉住了这两半。
