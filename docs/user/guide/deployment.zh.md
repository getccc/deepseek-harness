# 启动及部署 DeepSeek Harness

[English](deployment.md) | 中文

## 摘要

本教程将一个仓库检出准备为可在浏览器中使用的 DeepSeek Harness Web UI，并说明独立的团队管理入口。内容涵盖经过验证的源码构建、本机启动、认证、模型与工作区配置、仅回环的远程访问、进程托管、升级，以及运维人员最可能遇到的故障。DeepSeek Harness 是开发者预览软件，尚未达到生产就绪状态；请以最小权限在一次性或专用环境中运行。

## 目录

- [前置条件](#prerequisites)
- [构建检出](#build-the-checkout)
- [启动 Web UI](#start-the-web-ui)
- [打开并配置 UI](#open-and-configure-the-ui)
- [启动团队管理端](#start-team-management)
- [访问远程开发主机](#reach-a-remote-development-host)
- [运维进程](#operate-the-process)
- [故障排查](#troubleshooting)
- [延伸阅读](#further-exploration)

-----

<a id="prerequisites"></a>

## 前置条件

所用主机必须满足仓库的引擎要求，并能隔离 agent 可访问的文件与凭据。

- 阅读[安全说明](../../../SAFETY.zh.md)。优先使用一次性虚拟机、容器或专用账户，并备份每一个可写工作区。
- 安装 Node.js `^22.19.0` 或 `>=24.0.0`，以及 pnpm `11.7.0`。
- 让进程可以写入 Harness home。`DSH_HOME` 用于选择该目录，默认值是 `~/.dsh`。
- 选择一个仓库目录，作为进程的默认工作区根目录。

安装依赖前先确认工具链：

```sh
node --version
pnpm --version
```

<a id="build-the-checkout"></a>

## 构建检出

在仓库根目录运行项目维护的源码准备路径：

```sh
pnpm install --frozen-lockfile
pnpm run build
```

安装覆盖所有 workspace 包。为其他操作系统或 CPU 构建的可选原生包可能显示平台警告，这是预期现象；非零退出则不是。构建会编译 Host 与 Client 包，并写出 Web 前端产物。

全新检出后，以及修改了会影响构建产物的源码后，都要运行 `pnpm run build`。`pnpm dsh web` 会从准备好的产物启动，不会自行重新构建。

<a id="start-the-web-ui"></a>

## 启动 Web UI

启动回环服务器，但不要求操作系统打开浏览器：

```sh
pnpm dsh web --no-open
```

默认监听地址是 `127.0.0.1:3080`。stdout 打印一条 `dsh web:` URL 时，启动即告完成。该 URL 包含仅供本进程使用的 bearer token：不要让它进入公开日志，也不要把它粘贴到 issue 或群聊中。

如果 `3080` 已被占用，请选择其他端口：

```sh
pnpm dsh web --no-open --port 8080
```

Web launcher 会刻意拒绝 `--host 0.0.0.0`。随附服务器不终止 TLS，而应用可以用启动用户的权限执行模型生成的命令，因此直接暴露到网络不是受支持的部署方式。

<a id="open-and-configure-the-ui"></a>

## 打开并配置 UI

打开启动时打印的完整 token URL。浏览器会用该 token 换取 HTTP-only cookie，然后重定向到干净的根 URL。这个本地 Web 表层不显示账户密码登录页，但并非匿名访问：未经认证的请求访问干净根路径会返回 `401`。

然后完成首次使用流程：

1. 打开**设置 → 模型**，存储提供方凭据并选择模型。[模型指南](providers.zh.md)介绍 DeepSeek、目录提供方与自定义 OpenAI 兼容端点。
2. 选择工作区。调用目录是默认文件系统位置，但 Web UI 选中工作区之前，输入框不可用。
3. 开启会话，并先发送一个较小的只读任务，再授予更广权限。

<a id="start-team-management"></a>

## 启动团队管理端

团队管理端是独立且仅供管理员使用的 Control Plane，不是 `3080` 端口 Web UI 或 `3090` 成员 Runner 中的一条路由。`team-control-plane` Profile 监听 `127.0.0.1:3095`，并在 `/team/admin/` 供管理员管理部门树、用户、角色与授权、控制台自身的导航、设备和公司模型。只有持有 `organization.admin.access` 的账户才能在密码认证后创建 HTTP-only Session；之后每项操作还受 CSRF 检查、入口权限、动作授权与审计记录保护。

部署必须先通过账户、认证与访问控制服务创建组织、管理员密码、`organization.admin.access` 与所需动作授权，再把该组织 ID 同时提供给 `team-control-plane-http` 和 `team-admin-api`，否则 Profile 会拒绝启动。控制台的侧边栏由 Control Plane 在首次启动时播种的导航绘制，每条菜单都指明一项权限：只持有 `organization.admin.access` 的管理员登录后会看到一个空控制台，直到 `department.read`、`member.read`、`role.read`、`menu.manage`、`device.inventory.read` 与 `model.catalog.read` 的授权就位。仍然没有邀请链接或初始密码页面：管理员在控制台里添加成员，而给这位成员设置第一个密码需要另一条路径。本地明文 HTTP 要设置 `secureCookie: false`；TLS 部署则保持 `true`。

当前完整 Control Plane 组合中的模型网关 HTTP 行还需要凭据提供方。仅用于本地预览管理界面时，可以在 `$DSH_HOME/profiles/team-control-plane/cordis.patch.yml` 中禁用该行；此时公司模型路由不可用：

```yaml
- id: team-control-plane-http
  config:
    organizationId: 019400a1-0000-7000-8000-000000000000
    pathPrefix: /team/device
    maxRequestBodyBytes: 16384
- id: team-admin-api
  config:
    organizationId: 019400a1-0000-7000-8000-000000000000
    secureCookie: false
- id: model-gateway-http
  disabled: true
```

完成初始化并修补 profile 后，从仓库根目录启动：

```sh
pnpm dsh --profile team-control-plane
```

打开 `http://127.0.0.1:3095/team/admin`。控制台是一份构建产物，因此源码检出必须先运行 `pnpm run build`，这个地址才有东西可提供。本地开发时让该 listener 保持绑定回环地址。[Control Plane bundle](../../../packages/bundle/team-control-plane/README.zh.md)拥有组合说明；[管理 API](../../../packages/team/team-admin-api/README.zh.md)拥有控制台每一次动作背后的授权与审计行为。

普通成员通过 `pnpm dsh --profile team` 启动单独配置的 Team Runner。它会打开 `http://127.0.0.1:3090/team/open`，成员在本地输入账户与密码；其浏览器不会访问 `3095`。Runner 的 `controlPlaneUrl` 必须使用它访问 Control Plane 时所经过的 TLS 源。

<a id="reach-a-remote-development-host"></a>

## 访问远程开发主机

让 Web listener 继续绑定远程主机的回环接口。在该主机的仓库检出中启动：

```sh
pnpm dsh web --no-open
```

在运维工作站上，把同一个本地端口转发到远程回环 listener：

```sh
ssh -N -L 3080:127.0.0.1:3080 user@server
```

隧道有效时，在运维工作站打开启动 URL。请完整保留 `127.0.0.1:3080` 与打印出的 token。通过 SSH 启动会抑制自动打开浏览器，但仍会打印 URL。

仓库无法验证你的 SSH 服务器、防火墙或转发策略。部署运维人员必须确认只有预期用户能够建立隧道，并确认远程 `3080` listener 仍只绑定回环接口。

<a id="operate-the-process"></a>

## 运维进程

进程管理器可以运行同一条 `pnpm dsh web --no-open` 命令。请显式配置以下值，不要依赖交互式 shell：

- 把工作目录设为已经构建产物的仓库检出。
- 把 `DSH_HOME` 设为仅服务账户可写的持久目录；它拥有 profile、设置、凭据与本地产品状态。
- 受限保存 stdout 与 stderr，因为就绪日志行包含进程凭据。
- 发送 `SIGTERM` 执行常规停止。CLI 最多给插件树五秒进行清理，随后强制退出。
- 不要添加公开 listener、TLS proxy、容器镜像或系统服务模板，除非该部署自行拥有并验证缺失的安全与生命周期约定。仓库没有为 Web UI 随附这些内容。

升级源码部署时，停止进程、更新检出、重新运行两条构建命令，然后再次启动同一个 profile。变更版本前请备份 `DSH_HOME` 与可写工作区；预发布磁盘格式不提供兼容性承诺。

<a id="troubleshooting"></a>

## 故障排查

- **启动报告 `EADDRINUSE`**：端口已被其他进程占用。停止该进程，或通过 `--port` 传入未占用端口。
- **启动提示需要构建**：在仓库根目录运行 `pnpm run build`，然后重试相同启动命令。
- **干净 URL 返回 `401`**：使用本进程启动日志中的完整 token URL。浏览器收到 cookie 后，干净 URL 才可用。
- **成员使用 3090，管理员使用 3095**：为成员登录启动 `team` Profile，为 `/team/admin/` 启动独立的 `team-control-plane` Profile。
- **Control Plane 等待 `credentials`**：模型网关 HTTP 行处于启用状态，但缺少它要求的提供方。请补齐该提供方组合，或仅为上文的本地管理界面预览而禁用这一行。
- **通过 SSH 时浏览器未打开**：这是预期行为。保持隧道有效，并在运维工作站打开打印出的 URL。
- **输入框不可用**：同时选择一个已配置模型和一个工作区。
- **源码变更后页面仍显示旧 Client 代码**：重新构建并刷新现有 URL。启动第二个服务器不会更新第一个。

<a id="further-exploration"></a>

## 延伸阅读

- [使用 Web UI](index.zh.md)：启动后运行第一个任务。
- [配置模型](providers.zh.md)：提供方凭据、路由、模型与请求兼容性。
- [架构](../../architecture.zh.md)：profile、插件组装、agent loop、Session 日志与能力 seam。
- [CLI 行为参考](../../../apps/cli/reference/README.zh.md)：准确的 profile 分层、flag、源码执行与停止行为。
- [Web 应用组合包](../../../packages/bundle/web-app/README.zh.md)：token 化启动、Host 信任、配置与当前限制。

## Dev Note

SSH 隧道步骤需要在目标部署上人工验证，因为当前检出无权控制运维人员的 SSH 服务器、防火墙与身份策略。
