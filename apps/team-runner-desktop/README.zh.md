---
description: "让一份本机 Team Runner 常驻、并指向一个部署的 Control Plane 的 Windows 与 Apple 芯片 macOS 桌面外壳。"
kind: "package-reference"
---

# @deepseek-ai/dsh-team-runner-desktop

[English](README.md) | 中文

## 概述

这个 Electron 应用把 Team Runner 安装成成员拥有的桌面进程。它在回环端口 `3090` 上启动随附的 `dsh --profile team`，用经过安全加固的窗口打开本机浏览器应用，窗口关闭后仍可从系统托盘使用，在操作系统登录时于后台启动，并在 Runner 意外退出十秒后重启它。明确选择退出会同时停止两个进程。

一份桌面构建只属于一个企业部署。它的包元数据携带 Control Plane 的 HTTPS 源与 Runner 版本；它不携带成员密码、设备凭据、刷新 token、访问 token 或上游模型凭据。Runner 把生成的设备密钥与签发的凭据存放在 Electron 的用户级应用数据目录下。

## 目录

- [构建安装程序](#build-installers)
- [部署输入](#deployment-inputs)
- [运行时行为](#runtime-behavior)
- [平台支持](#platform-support)
- [已知限制](#known-limitations)

-----

<a id="build-installers"></a>
## 构建安装程序

先构建 Runner 可执行文件及其伴随程序，再把可执行文件与部署源提供给对应平台的打包命令：

```sh
DSH_TEAM_RUNNER_EXECUTABLE=/absolute/path/to/dsh \
DSH_TEAM_CONTROL_PLANE_URL=https://control.example.com \
pnpm --filter @deepseek-ai/dsh-team-runner-desktop package:mac
```

`package:mac` 只生成 Apple 芯片 DMG，不生成 Intel 或 Universal 产物。`package:win` 生成 x64 NSIS 安装程序，并要求 Windows Runner 可执行文件与 ripgrep 伴随程序。

打包配置把 Runner 二进制文件复制到 Electron 资源中，并在应用元数据中记录已验证的 Control Plane 源。运行时，外壳在自己的应用数据目录下写入部署补丁，用该补丁启动 Team profile，并为子进程提供位于同一目录下的私有 `DSH_HOME`。

<a id="deployment-inputs"></a>
## 部署输入

每一项随部署变化的事实都是打包环境变量，因此同一份源码树无需修改即可产出各企业各自的安装程序。

| 变量 | 必需 | 携带什么 |
|---|---|---|
| `DSH_TEAM_RUNNER_EXECUTABLE` | 是 | 构建好的 Runner 可执行文件；其 ripgrep 与 macOS spawn-helper 伴随程序按相邻的 `-rg` 与 `-spawn-helper` 名称读取。 |
| `DSH_TEAM_CONTROL_PLANE_URL` | 是 | 这份构建所属的 Control Plane 源。 |
| `DSH_TEAM_CONTROL_PLANE_CA` | 否 | 签发 Control Plane TLS 证书的那份证书。 |
| `DSH_TEAM_PLUGIN_TREE` | 否 | 一个已安装 profile 的 `node_modules`，携带树外插件。 |
| `DSH_TEAM_PRODUCT_NAME`、`DSH_TEAM_APP_ID` | 否 | 安装后应用的名称与 bundle 标识符。 |
| `DSH_TEAM_APP_ICON`、`DSH_TEAM_TRAY_ICON` | 否 | 应用图标，以及菜单栏模板图像——其 `@2x` 相邻文件随它一同置入资源。 |
| `DSH_TEAM_PPT_TEMPLATE` | 否 | 办公选择器的 `ppt` 类型导入的 PowerPoint 模版；置于 Runner 旁并在运行时定位路径。 |
| `DSH_TEAM_APPLE_TEAM_ID` | 否 | Apple Developer Team ID；设置后（且环境含 `APPLE_ID` 与 `APPLE_APP_SPECIFIC_PASSWORD`）对 macOS 构建进行公证。 |

### 固定一个私有证书颁发机构

Runner 是一个 Node 进程，不读取操作系统信任库，因此位于企业自签证书颁发机构之后的 Control Plane 在构建携带该机构证书之前不可达：把证书装进钥匙串只能修好浏览器。`DSH_TEAM_CONTROL_PLANE_CA` 把证书置于 Runner 旁，部署补丁则在每一行与 Control Plane 通信的插件上固定它——账号客户端、模型传输与知识。它只对那一个源受信任。使用公开受信任证书的 Control Plane 省略该变量，补丁也就不写这项固定。

### 携带树外插件

位于 Runner 自身安装之外的插件以真实目录而非打包可执行文件内部的形式随附，因为它们的原生插件无法从打包可执行文件的虚拟文件系统中加载，而它们运行时的依赖复制需要真实文件。用 `dsh plugin --profile <name> add <package>` 把它们装进一个 profile，再让 `DSH_TEAM_PLUGIN_TREE` 指向该 profile 的 `node_modules`。

外壳拥有这个私有 profile 的清单：它在每次启动时写入层列表，并按应用版本把随附的树物化为该 profile 自己的 `node_modules`。这些包必须是那里的真实文件，而不是指向应用资源的链接——插件通过自己的真实位置解析依赖，而 `dsh` 会在它们旁边补上插件作为 peer 从 Runner 安装取用的包。macOS 在写时复制卷上克隆这棵树，因此这份副本几乎不花时间也几乎不占磁盘空间。成员从不向这个 profile 安装插件，因此改变层列表的应用升级会在下次启动时生效。成员自己的 `cordis.patch.yml` 不会被触碰。

### 签名与公证 macOS 构建

没有签名身份时，DMG 采用 ad-hoc 签名，Gatekeeper 会拦截它直到用户清除隔离属性——用于内部测试尚可，不适合分发。要签名并公证：

1. 把 `Developer ID Application` 证书导入登录钥匙串（双击 `.p12` 并输入其密码），随后确认 `security find-identity -v -p codesigning` 能列出它。
2. 为你的 Apple ID 创建一个 app 专用密码（或一个 App Store Connect API key）。
3. 在设置好公证环境后构建；electron-builder 随即用钥匙串身份在加固运行时与 `build/entitlements.mac.plist` 下签名、公证并装订：

```sh
export APPLE_ID="you@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
DSH_TEAM_APPLE_TEAM_ID="YOURTEAMID" \
DSH_TEAM_RUNNER_EXECUTABLE=/absolute/path/to/dsh \
DSH_TEAM_CONTROL_PLANE_URL=https://control.example.com \
pnpm --filter @deepseek-ai/dsh-team-runner-desktop package:mac
```

随附的 `dsh` 可执行文件与 `runner/` 下的原生插件随应用一并签名；entitlements 关闭库校验，以便加固运行时的子进程可以加载它们。

-----

<a id="runtime-behavior"></a>
## 运行时行为

- 关闭应用窗口会隐藏它；托盘菜单可以再次打开窗口。
- 操作系统登录项用 `--background` 启动 Electron，因此无需打开窗口即可使用 Runner。
- Runner 意外退出后会安排一次十秒延迟重启。启动失败时 Electron 保持运行、报告故障，并采用相同的延迟重试。
- 窗口显示本地化的启动提示，并最多等待五分钟以获得 Runner 的首次应答，因为首次启动要先物化插件树并修复模块链接才开始监听。Runner 在登录路由挂载之前就绑定端口，其间应答 `404`；只有登录重定向、该路由对非导航探测的拒绝、或已登录页面才算就绪。Runner 重启后页面加载失败或应答错误时，窗口回到轮询。
- 上一实例留下的 Runner——应用在运行时被替换，或被强制退出——会在新 Runner 启动前被停止，因此固定端口永不争抢。只有当该进程仍在运行本构建自己的可执行文件时才信任记录的进程 id；Windows 跳过这一步。
- 登录项只在首次打包启动时注册一次，之后的启动既不等待该注册也不再弹出通知。
- `runner.log` 旁的 `shell.log` 带时间戳记录每次启动、Runner 的启动与退出、就绪探测结果以及页面加载失败。
- 第二次启动桌面应用会激活已有实例，而不会在端口 `3090` 上启动第二个 Runner。
- 离开本机 Runner 的导航会在系统浏览器中打开；渲染进程的 Node 集成保持关闭，同时启用上下文隔离与 Chromium 沙箱。
- 托盘文案、Runner 本机登录页面，以及编辑器的权限与办公选择器跟随操作系统语言，提供英文或中文。
- 首次启动会为成员的设置置入一个值，使内测声明欢迎弹框永不打开；成员自己的设置绝不会被覆盖。

-----

<a id="platform-support"></a>
## 平台支持

| 平台 | 安装程序目标 | 架构 |
|---|---|---|
| macOS 12 或更高版本 | DMG | Apple 芯片（`arm64`） |
| Windows | NSIS | x64 |

Linux 桌面打包与 macOS Intel 支持不在本应用的平台集合内。

-----

<a id="known-limitations"></a>
## 已知限制

- 桌面外壳不下载或更新 Runner。部署方需要签名并分发完整的安装程序构建。
- Runner 可执行文件按平台在该平台上构建：它的原生插件置入拒绝跨平台目标，因此 Windows 安装程序需要先在 Windows x64 上构建 Runner。
- 自动登录启动以操作系统用户为单位，而不是特权系统服务。因此 Runner 使用该成员的权限执行工作。
- Runner 日志、外壳日志与部署补丁位于用户级应用数据目录下；支持工具需要从受影响的电脑收集它们。
