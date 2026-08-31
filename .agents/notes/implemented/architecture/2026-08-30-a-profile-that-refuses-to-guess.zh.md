# Agent Note：随产品提供的 Team profile 拒绝猜测它为谁服务

Status: implemented

[English](2026-08-30-a-profile-that-refuses-to-guess.md) | 中文

## 问题

两个 Team profile 现在组合的是真实服务而不是占位物，而其中两项配置值没有任何诚实的默认。一个 Control Plane 必须知道它服务于哪个组织；一个 Runner 必须知道它属于哪个 Control Plane，以及该报告自己的哪个版本。

方便的做法是给一个默认值，让 `dsh --profile team-control-plane` 开箱即启。而每一个候选默认值都以难以察觉的方式是错的：一个空的组织 id 会拿一个并不存在的组织去认证成员，并永远报告"该成员与密码不匹配"；一个 `localhost` 的 Control Plane URL 会让 Runner 把公钥发给任何正在监听的东西；一个编造的 Runner 版本会把一项假事实摆在阅读设备列表的管理员面前。

## 决策

**这些行省略那些键，而插件在缺少它们时拒绝加载。** `team-control-plane-http` 与 `team-admin-api` 在 `organizationId` 为空时抛错；`team-account-client` 把 `controlPlaneUrl` 和 `runnerVersion` 声明为必填，因此 Schema 解析会失败。部署在自己的 Patch 中提供它们，而那正是安装程序本就写入部署事实的地方。

这让失败变得响亮、即时且自足——它发生在加载时、发生在配置错误的那个进程里，并指名那个键。另一种做法则会在更晚、别处，以一个症状的形式失败。

**Control Plane 的每一份存储都写在 DSH home 之下。** 一个后台服务从它的服务管理器恰好所在的位置启动，因此相对路径会把同一个部署的数据散落到它被启动过的各个目录里。

**Control Plane 依然不与任何成员 profile 共享 bundle**，而在挂载了七项服务之后，那些"不存在"断言依然成立。组合测试按 id 指名每一项预期服务**并且**检查 manifest 声明了它，因此一个没有同时声明依赖就被加进来的行会加载失败，而不是悄悄挂上。

## 曾考虑的替代方案

**把组织默认成存储中恰好持有的那一个。** 已否决：它在全新安装上能用，而在部署持有两个组织的那一刻悄悄挑错一个——那正是"挑错"最要紧的时刻。

**在运行时从包里读取 Runner 版本。** 暂时否决：被打包的运行时无法可靠地读到自己的 manifest，而真正要紧的值是安装程序*所安装*的那个版本——安装程序知道它，进程不知道。

**让 team bundle 保持"只覆盖、不插入"的形态。** 那条性质在该层只拥有一个端口时是真的，如今不再为真：该层理所当然地加入了 Account Client 和 Handoff。测试被改写成陈述现在成立的东西——覆盖行指名 id 而绝不指名插件，插入行两者都指名——它依然能抓住原先那条断言所防的错误。

## 后果

`dsh --profile team-control-plane` 和 `dsh --profile team` 在一份裸检出上不会启动。这是有意为之，两份 README 也都这么说，但这意味着两个 profile 都无法通过"不带 patch 直接启动"来做冒烟测试。组合测试读取 patch 而不是启动它，这与它们此前的做法一致。

Control Plane 在 DSH home 的 `control-plane/` 下保留四个 SQLite 文件。在单一数据库的设计下它们本会是一个；把它们拆开的是 SQLite 这项偏离，而把它们合并，正是能买回跨子系统事务的那次改动。
