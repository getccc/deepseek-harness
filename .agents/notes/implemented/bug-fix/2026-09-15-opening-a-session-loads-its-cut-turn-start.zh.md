# Agent Note: 打开 Session 时加载窗口所截轮次的起点

Status: implemented

[English](2026-09-15-opening-a-session-loads-its-cut-turn-start.md) | 中文

## 问题

Session 打开时，从尾部往前数 50 条 message 取一页。当最后一个轮次超过 50 条 message 时，这一页从该轮次中间开始，其 `turn/start` 留在更早的历史里。按轮次作用的 Conversation Definition 只在 `turn/start` 上开始；在 start 到达之前，assembler 让它们的更新保持挂起。于是浏览器刷新后，一个 55 步的 PowerPoint 轮次显示了工具行，却没有显示 `dsh-univer-office` 的审阅卡片（这是一个按轮次作用的视图），而较短的 Word 与 Excel 轮次保留了卡片。点击"加载更早"后卡片恢复。

## 决策

打开窗口安装之后，Session client 找出窗口起点所在的轮次：即在任何 `turn/start` 之前出现的第一个按轮次作用的事件所属的轮次。存在这样的轮次且历史还有更多时，它以 200 条 message 一页向前补，直到该轮次的 `turn/start` 进入窗口。它不加载更早的轮次，遇到无进展的页即停止，stream generation 变化时停止，经 `loadingOlder` 报告忙碌，页请求抛错时软失败并保留已打开的窗口。服务端按 message 对齐的分页不变。

## 考虑过的替代方案

- **让服务端每一页都对齐到轮次边界。** 否决：分页契约及其 host 测试有意允许一页从轮次中间开始，而且每一页都将携带整个轮次，与客户端渲染什么无关。
- **让 univer 插件在没有 `turn/start` 时也开始其轮次视图。** 否决：修复会落在第三方 bundle 里，其他按轮次作用的 Definition 仍有同样的缺口。
- **调大打开时的页大小。** 否决：任何固定大小都会被更长的轮次超出。

## 后果

打开最后一个轮次很长的 Session 会多一次或多次历史请求，并加载该轮次的全部内容，而实时跟随过该轮次的客户端本来就持有这些内容。`session.client.spec.ts` 固定了在所截轮次起点处停止分页、在轮次边界不分页、无进展与 generation 变化时停止，以及软失败。
