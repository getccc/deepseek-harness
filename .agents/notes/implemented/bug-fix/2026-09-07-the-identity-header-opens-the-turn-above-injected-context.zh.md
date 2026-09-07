# Agent Note: The identity header opens the Turn above injected context

Status: implemented

[English](2026-09-07-the-identity-header-opens-the-turn-above-injected-context.md) | 中文

## 问题

[小微是助手的名字和脸](../feature/2026-09-05-xiaowei-is-the-assistants-name-and-face.zh.md)把身份头部放在轮次过程控件上（控件显示时），否则放在第一个 Assistant 步骤上。回复的前几行常常不是第一步：请求会组装注入的上下文——系统提示词分节、技能目录、工作区指令——这些 `context` 行在流里位于成员话语与步骤之间。轮次运行时，读者先看到两行 `上下文注入`，然后才是小微的头部；控件保持隐藏的已关闭轮次也维持这个顺序。产品负责人在一次真实会话中报告了它：头部属于回复的最上方。

## 决定

**轮次中第一个可见活动行所在的 seat 渲染头部。** [`ChatNodeSeat`](../../../../packages/client/ui-chat/src/client/chat/ChatNodeSeat.tsx) 选出轮次的领头键：[`turn-activity.ts`](../../../../packages/client/ui-chat/src/client/chat/turn-activity.ts) 里的 `turnActivityLead` 遍历轮次的有序键，跳过回复之前的行（`system-prompt`、`user`、`steering`），在轮次过程控件显示时返回控件（它的锚点先于每个过程行，此时折叠在它下面的行不是候选），否则返回剩下的第一行，不论其种类。selector 只为那一个 seat 产出已解析的 `TurnLocation`，为其他 seat 产出 `undefined`，因此增长中的轮次只重渲染它的领头行。[`TurnActivityHeader`](../../../../packages/client/ui-chat/src/client/chat/TurnActivityHeader.tsx) 挂载在那里，拥有日历日刻度，并从轮次推导 owner 份额：轮次打开时为 `running`，关闭后为 `settled`，时钟取自 `turn/start`，当轮次的开始在已加载窗口之外时回退到领头步骤自身的时间。轮次过程控件与 Assistant 步骤不再渲染头部，`renderIdentity` 从节点 owner props 移到 seat 自己的 props。

**状态是轮次的，不是步骤的。** owner 份额的 `status` 收窄为 `running | settled`：头部代表整个回复，步骤级的 `interrupted` 状态属于步骤自己的渲染。

## 考虑过的替代方案

**把上下文行移到第一步之下。** 拒绝：流就是 Session 日志的持久顺序，注入的上下文确实先于步骤到达模型；重排行会错误陈述发生过的事。

**当上下文行在最前时由它自己的视图渲染头部。** 拒绝：每种可能领头的行——上下文、重试、错误、步骤、控件——都需要同一道判断，而且每个都要看轮次里的其他行才能决定。seat 里的一个 selector 只判断一次。

**头部留在步骤上，折叠之前先隐藏上下文行。** 拒绝：运行中的轮次还没有折叠，而这些行在运行时是有用的。

## 后果

头部现在也会领起回复只是一条重试链或一个无步骤错误的轮次，因为那些就是回复。Web 期望输出不变：通用场景没有占位者，而已关闭轮次的控件仍然领头。聊天测试钉住流式输出时头部位于注入的上下文之上、无前置行时落在第一步上、跨折叠时留在控件上、落在无过程回答的步骤上，以及只有成员话语的轮次上的缺席。`turnProcessLayout` 原样从 seat 移入 `turn-activity.ts`。
