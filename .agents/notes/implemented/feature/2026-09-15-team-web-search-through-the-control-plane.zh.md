# Agent Note: 经控制面的 Team 网页搜索

Status: implemented

[English](2026-09-15-team-web-search-through-the-control-plane.md) | 中文

## 问题

Team Runner 经控制面抵达公司模型，控制面持有公司凭据并按成员决策，但它的 `web_search` 工具仍运行基础组合的 DeepSeek 搜索 provider：一次发往 `api.deepseek.com` 的 Messages 调用，用的是成员自己电脑上持有的 `DEEPSEEK_API_KEY`。没有个人 key 的成员——在 Team Edition 中就是每一个成员——一开启联网就得到结构化的 `WEB_PROVIDER_CREDENTIAL_MISSING` 错误，而持有 key 的成员则把它花在公司工作上且无任何记录。聊天组合的[联网开关](2026-09-14-chat-preset-without-workspace.zh.md)让这个缺口在第一个需要时效信息的问题上显露出来。

## 决定

**搜索是控制面操作；抓取留在本地。** [`dsh-web-search-gateway-http`](../../../../packages/web/web-search-gateway-http/README.zh.md) 在控制面上提供 `POST /team/web/search`，`dsh-web` 与 `dsh-web-search-deepseek` 组合在那里，公司的 `DEEPSEEK_API_KEY` 凭据也在那里解析。[`dsh-web-search-team`](../../../../packages/web/web-search-team/README.zh.md) 在 Runner 的 `ctx.web` 上注册 `team` 提供方，发送查询、来源上限、协议版本与当前设备访问令牌；Team bundle 以 `searchProvider: team` 选中它并保留 `fetchProvider: http`，因为抓取公开页面不需要公司凭据，让页面正文穿过控制面毫无收益。路由沿用知识网关的形状：版本在解码任何其他字段之前决定，主体只来自已校验的令牌，拒绝是封闭集合中的一个词，Runner 把不认识的词视为控制面不可用。

**每次搜索都是一次决策和一条记录。** 权限目录新增 `web_search|web.search`；路由在首次服务某个组织时注册该组织唯一的 `web_search` 资源，每次调用都重新询问访问控制，并写一条 `web.search` 审计事件，附来源数、`no-grant` 原因或 `webFailure` 词。随附的控制台导航在资源管理下带有一个 `action` 类的"联网搜索"条目，管理员由此在角色编辑器里把权限给角色；覆盖整个目录的角色从一开始就持有它，因此既有部署的管理员升级后不会被锁在外面。

**失败映射为成员能做的事。** Runner 提供方把每个拒绝转为工具渲染的 web 错误码：登录（`WEB_PROVIDER_CREDENTIAL_MISSING`）、找管理员（指名拒绝的 `WEB_PROVIDER_ERROR`）、稍后重试（`WEB_PROVIDER_UNAVAILABLE`）、更新（`WEB_PROVIDER_ERROR`）或无事可做（`WEB_ABORTED`）。可达性失败、代理错误页与无法读取的答复从成员的座位看是同一个事实，共用 `WEB_PROVIDER_UNAVAILABLE`。

## 曾考虑的替代方案

**把搜索作为第二种操作送经模型网关。** DeepSeek 搜索本身就是一次 Messages 调用，`/team/model/invoke` 本可以承载它并继承配额、审计与目录。拒绝：传输词汇只有 `chat.completions`，用量扫描器读 OpenAI 形状，而一个只用于搜索的模型行会出现在每个成员的模型选择器里，除非目录 schema 学会操作列表——那会让每个既有的 `models.sqlite` 搁浅。专用路由原样复用 web seam，且不触碰模型网关的安全路径。

**在组织资源上决定 `web.search`。** 管理资源已按组织存在，`organization|web.search` 本不需要注册。拒绝：那些资源门控的是管理操作，把面向成员的能力放在其上会让角色编辑者勾选"组织管理"时看不到它同时打开了公司付费的搜索。

**不做决策，只要有效令牌。** 每个已绑定成员本可以搜索。拒绝：控制面的规则是它花费公司凭据的任何事都按成员决定并记录，模型调用与知识搜索皆如此；游离于该规则之外的能力正是管理员无法为某个角色关掉的那一个。

**从管理 API 播种资源。** `team-admin-api` 在启动时播种其他管理资源。拒绝：web 路由拥有它所决策的资源，正如知识网关拥有其目录资源，而首次使用时的幂等注册每个进程每个组织只花一次写入。

## 后果

Team 成员从第一次 `/web on` 起就以公司凭据搜索，需要时效信息的聊天无需个人 key 即可得到它。管理员在控制台按角色授予或收回联网搜索，并在审计日志里看到每次搜索、拒绝与 provider 失败。控制面组合获得 web seam 与 DeepSeek 提供方但不含抓取提供方，其组合测试仍证明它不携带任何执行代码的能力。搜索用量尚未针对成员的模型预算预留或结算：DeepSeek 路由每次搜索在公司 key 上花费一次完整的模型请求，在搜索接入配额 seam 之前审计日志是唯一的账本。独立的 `dsh web` 部署不变，仍花成员自己的 key。
