# Agent Note: Runner 固定 Control Plane 的证书

Status: implemented

[English](2026-09-02-runner-pins-the-control-plane-certificate.md) | 中文

## 问题

没有域名的 Control Plane 部署也就没有公共机构签发的证书。让管理控制台和面向 Runner 的端点跑在明文 HTTP 上，会把管理员的 Session Cookie 和每一份设备凭据放到线路上，因此这样的部署改用自签证书终止 TLS。

Runner 一侧随即够不着它。三个 Runner 客户端——`team-account-client`、`llm-http-transport-team` 和 `knowledge-team`——都调用全局 `fetch`，而它按 Node 自带的机构清单校验。这份清单不是操作系统的：装进成员钥匙串或 Windows 证书存储的证书让浏览器信任控制台，却让每一次 Runner 调用以 `UNABLE_TO_VERIFY_LEAF_SIGNATURE` 失败。`--use-system-ca` 会读取那个存储，`NODE_EXTRA_CA_CERTS` 会添加该证书，但两者都把信任扩大到进程访问的每一个主机；而且 `app-boot` 把 `NODE_EXTRA_CA_CERTS` 列在任何被发现的 `.env` 都不得设置的名字里，因此它只能来自启动环境。

## 决定

**每个 Control Plane 客户端在自己调用的地址旁边，携带它接受的证书。** `controlPlaneCa` 指向一个 PEM 文件，与 `controlPlaneUrl` 并列出现在三个配置项里，理由与 `controlPlaneUrl` 本就逐行携带的理由相同：桌面安装器从同一个部署事实写出每一行。这两个字段以 `controlPlaneConfigFields` 声明一次，再展开进各插件自己的 schema，因此三个客户端不会在地址或为它们配置的信任上产生分歧。

**该信任只作用于 Control Plane 调用。** 证书成为一个 Undici `Agent`，用作该插件请求的 dispatcher。进程对其他每一个主机继续使用 Node 的默认机构，因此一台必须接受某张公司证书的 Runner，不会因此在整个互联网范围内接受它。这固定的是部署自己的证书，而不是往 Runner 到处生效的信任里添加一个机构。

**Control Plane 调用走 Undici 的 `fetch`，不走全局的那个。** 承载私有信任的 dispatcher 是一个 Undici `Agent`，而全局 `fetch` 会以 `UND_ERR_INVALID_ARG` 拒绝来自另一个 Undici 实例的 `Agent`。`web-fetch-http` 早已为它自己的固定解析引入了 Undici 的 `fetch`；Control Plane 客户端现在同样如此。

**指定了却读不出来的证书，在插件构造时就失败。** `readFileSync` 在插件被构建的地方抛错，而不是等到第一次调用。悄悄退回公共信任的 Runner，会把一个配置错误的部署在很久以后报成一次普通的 TLS 失败；而对一个位于公网地址上的 Control Plane 来说，那种失败与一次攻击无法区分。

**不填时，一切照旧。** 拥有公共签发证书的部署省略该字段，按其他主机一样的方式校验。

## 考虑过的替代方案

**由桌面启动器设置 `NODE_EXTRA_CA_CERTS`。** 否决，因为它把进程的信任扩大到它触达的每一个主机；而且 Node 在启动时读取它，Electron 主进程无法为自己设置。dispatcher 把同一张证书限制在为它配置的那些连接上。

**要求成员把证书装进操作系统信任库。** 对 Runner 否决。装在那里的根证书可以为任意名称签发，因此一旦签名私钥泄露，所有装过它的机器都会暴露——这比一个部署所需要的承诺重得多，何况不加 `--use-system-ca` 时 Node 根本不读那个存储。管理员仍然为浏览器安装它，那是另一个信任决定，影响面也不同。

**在 `TeamAccountClient` 上暴露一个共享 fetch，另外两个客户端直接用。** 两者本就注入了该服务，这样证书只需配置一次。否决，因为一个插件的 TLS 信任会来自另一个插件的配置，而一个配置错误的知识库行，会在操作者设置它的地方之外失败。

## 后果

固定证书是对每一台已安装 Runner 的兼容性承诺：当部署更换证书时，只携带旧签名证书的 Runner 将无法连接。执行轮换的部署必须在切换服务器之前把新证书发到成员手上，这是公共签发证书所没有的运维成本。

证书校验本身是针对真实 Control Plane 验证的，而非在单元测试里，因为合成一份意味着把签名私钥提交进仓库。`transport.spec.ts` 覆盖它周围的接缝：一次调用走的是哪个 fetch、指定的文件必须在插件运行之前存在、以及卸载会释放连接池。

够不着的 Control Plane 在 Runner 登录页上仍然显示为 `credentialsRefused`，因此缺失的证书看起来像密码错误。该映射早于本次改动，另行跟踪。
