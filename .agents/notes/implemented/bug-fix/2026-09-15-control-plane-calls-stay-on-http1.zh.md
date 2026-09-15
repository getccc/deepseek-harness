# Agent Note: Control Plane 调用保持 HTTP/1.1

Status: implemented

[English](2026-09-15-control-plane-calls-stay-on-http1.md) | 中文

## 问题

打包版 WeWork Runner 对每个新轮次都回应 `transport failed: unreachable (fetch failed)`，并显示原始默认模型 id 而不是公司模型目录，而同一进程中的联网搜索调用一直成功。Control Plane 访问日志显示，该 Runner 的模型调用一直正常，直到一次流式 invoke 以 `499`（客户端取消）结束，此后再无记录。在运行中的 Runner 内捕获的 Undici 诊断显示，每个模型目录请求都立即以 `ERR_HTTP2_INVALID_SESSION: The session has been destroyed` 失败。Undici 8 默认协商 HTTP/2，在那次被取消的流之后，模型传输的固定信任 agent 把已销毁的会话留在连接池中，之后的每次调用都复用它。只有重启 Runner 才会替换该 agent；联网搜索客户端有自己的 agent，因而不受影响。

## 决策

`controlPlaneFetch` 以 `allowH2: false` 构造其固定信任的 agent——直连的 `Agent` 与每个代理的 `ProxyAgent`。于是账号客户端、模型传输、知识库与联网搜索发往 Control Plane 的调用都使用 HTTP/1.1 连接池，连接池会丢弃已关闭的 socket 并新建连接。流式响应不受影响，因为 Control Plane 同样通过 HTTP/1.1 以 server-sent events 流式返回。

## 考虑过的替代方案

- **在 unreachable 失败后重建 agent。** 不作为修复采纳：失败的那次调用仍会丢失，该规则需要小心避免在真实网络故障时丢弃健康的连接池，而且根因会继续留在其他所有调用路径中。
- **在进程级调度器上禁用 HTTP/2。** 在此否决：该调度器服务所有出站请求，故障只在固定信任的 Control Plane agent 上观察到，这样影响范围的部署变更需要单独的证据。

## 后果

在并发流时，Control Plane 调用会比 HTTP/2 多路复用打开更多 TCP 连接；Control Plane 的 nginx 前端本就接受 HTTP/1.1。未配置 `controlPlaneCa` 的部署仍走进程级调度器，它允许 HTTP/2。`transport.spec.ts` 固定了直连与代理 agent 上的 `allowH2: false`。
