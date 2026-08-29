# Agent Note：team profile 叠加在 web-app 之上而非分叉它

Status: implemented

[English](2026-08-29-team-profile-bundle.md) | 中文

## 问题

Team Edition 需要自己的 `dsh` 表层：公司账户、RBAC、模型与知识库网关，以及本地登录 handoff。这些全都是在 `dsh web` 已经提供的浏览器应用之上做加法——没有一项是替换它。

可选的形态有两种。team bundle 可以自己重述整个浏览器表层，拥有 `dsh-web-app` 所插入配置行的一份副本；也可以作为又一个 patch 层坐落在 `dsh-web-app` 之上。第一种形态复制了一个庞大且仍在活跃变化的配置行集合，并且必然导致两份副本漂移。第二种形态要求 Team 新增的一切都能表达为对已组合配置树的覆盖或插入。

第二个问题随本层需要的第一行配置一同出现。Team Runner 是长期运行的后台服务，而 `dsh web` 是开发者手工启动的前台工具。两者都是普通的回环服务器，因此不能共用端口：后绑定的那个会失败。`dsh web` 默认使用 `3080`，所以同样默认 `3080` 的 Team Runner 会在每一台运行过 `dsh web` 的机器上启动失败——而且失败落在必须免配置即可工作的产品一侧，开发工具反倒占着端口。

## 决策

`@deepseek-ai/dsh-team` 是叠加在 `dsh-web-app` 之上的 patch 列表载体，`team` profile 模板依次组合 `dsh-base`、`dsh-web-app` 和本层。浏览器应用、会话存储和全部本机能力仍归原本拥有它们的 bundle 所有。

本层的第一行也是目前唯一一行配置，覆盖 `webserver` 使其默认为 `3090`，并重述该行拥有的每一个键——因为 patch 会替换整个 `config`。`--port` 仍然优先，`inject` 仍属于 `dsh-web-app` 插入的那一行。

端口固定而非扫描。公司入口会把浏览器导航到一个已知的回环地址，因此一个在端口冲突后悄悄换了地址的 Runner 会变成不可达，而不只是不存在——这比带着诊断拒绝启动更糟。

该 profile 保持 `patchReload: live`，与 `web` 一致，因为它服务的是同一个浏览器表层。

### 包结构

| 路径 | 作用 |
|---|---|
| `packages/bundle/team/cordis.patch.yml` | 本层：本 bundle 覆盖的配置行 |
| `packages/bundle/team/src/index.ts` | 模块身份；无运行时 API |
| `packages/bundle/team/src/invariant.ts` | 空伴随插件——静态 patch 载体不拥有可变关系 |
| `packages/boot/app-boot/src/profile.ts` | `PROFILE_TEMPLATES` 中的 `team` 条目 |

本 bundle 不为它所覆盖配置行对应的包声明依赖。`dsh-base` 为它所**插入**的包声明依赖；一个只按 id 覆盖既有行的层不插入任何东西，因此其依赖闭包为空。分层关系存在于 profile 模板的 bundle 列表中，那正是组合器自身的输入。

## 曾考虑的替代方案

**重述浏览器表层的 team bundle。** 已否决：它复制了 `dsh-web-app` 拥有的配置行集合，且每次 web-app 变更两份副本都会漂移。叠加保证每行只有一个归属。

**按操作系统用户派生端口。** 在本层否决：公司入口无法从浏览器得知目标用户的端口，因此派生端口必须依赖本地启动器或自定义协议入口才可达。在两者之一存在之前，固定端口才能让入口保持可寻址。

**冲突时扫描空闲端口。** 已否决：它把一次响亮的启动失败变成一个悄无声息不可达的 Runner，因为入口仍然会导航到配置的地址。

**为后台服务使用 `patchReload: startup`。** 推迟而非否决：在用户编辑 patch 时重新组合正是 `web` profile 已有的行为，且目前还没有服务托管的部署需要仅启动时应用的变体。

## 后果

同一时刻一台机器上只有一个 Team Runner 能持有回环端口，因此另一个操作系统用户启动的第二个 Runner 会绑定失败。并发多用户机器因此不在本层范围内；解除该限制需要上面提到的本地启动器或协议入口。

后续每一行 Team 配置——账户客户端、公司模型与知识库传输、本地 handoff 端点——都落在同一个 patch 文件里，且每一行覆盖既有行时都必须重述其完整 `config`。

修改 `dsh web` 的默认端口会悄悄重新制造本层要避免的冲突；本 bundle 的测试断言两个默认值保持不同。
