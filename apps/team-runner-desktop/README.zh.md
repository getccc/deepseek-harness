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
- [更新已安装的构建](#update-an-installed-build)
- [运行时行为](#runtime-behavior)
- [平台支持](#platform-support)
- [已知限制](#known-limitations)

-----

<a id="build-installers"></a>
## 构建安装程序

先构建 Runner 可执行文件及其伴随程序，再把可执行文件与部署源提供给对应平台的打包命令：

```sh
DSH_TEAM_APP_VERSION=1.0.0 \
DSH_TEAM_CUA_HELPER=/absolute/path/to/cua-payload \
DSH_TEAM_RUNNER_EXECUTABLE=/absolute/path/to/dsh \
DSH_TEAM_CONTROL_PLANE_URL=https://control.example.com \
pnpm --filter @deepseek-ai/dsh-team-runner-desktop package:mac
```

`package:mac` 生成 Apple 芯片 DMG 以及更新所安装的 zip。`package:mac:x64` 生成 Intel 版的同一组产物；它需要 Intel 版 Runner 可执行文件（`node24-macos-x64`）、Intel 版 Office sidecar 与 Intel 版插件树，因为 Runner、sidecar 与外壳必须是同一架构（`DSH_TEAM_MAC_ARCH` 声明架构，并与可执行文件名中的 `-macos-<arch>` 核对）。两者都不生成 Universal 产物。`package:win` 生成 x64 NSIS 安装程序，并要求 Windows Runner 可执行文件、其 ripgrep 伴随程序与 Windows 版 Office sidecar。

发布版本只经环境变量传入，不要再从别处传：electron-builder 命令行上的 `--config.extraMetadata.version` 覆盖会替换掉已校验的值，并可能悄悄恢复一个破坏更新的后缀。

打包配置把 Runner 二进制文件复制到 Electron 资源中，并在应用元数据中记录已验证的 Control Plane 源。运行时，外壳在自己的应用数据目录下写入部署补丁，用该补丁启动 Team profile，并为子进程提供位于同一目录下的私有 `DSH_HOME`。

<a id="deployment-inputs"></a>
## 部署输入

每一项随部署变化的事实都是打包环境变量，因此同一份源码树无需修改即可产出各企业各自的安装程序。

| 变量 | 必需 | 携带什么 |
|---|---|---|
| `DSH_TEAM_APP_VERSION` | 是 | 本构建所属的发布版本：`MAJOR.MINOR.PATCH`，不带预发布标签，也不带构建元数据，每次发布递增一次。 |
| `DSH_TEAM_UPDATE_ORIGIN` | 否 | 版本产物的获取地址，当它不是 Control Plane 本身时：对象存储或 CDN，适用于自身带宽撑不住每位成员几百兆下载的部署。 |
| `DSH_TEAM_RUNNER_EXECUTABLE` | 是 | 构建好的 Runner 可执行文件；其 ripgrep 与 macOS spawn-helper 伴随程序按相邻的 `-rg` 与 `-spawn-helper` 名称读取。 |
| `DSH_TEAM_OFFICE_SIDECAR` | 是 | 已准备好的 Office sidecar 目录：`node/bin/node`（Windows 为 `node.exe`）处的 Node 运行时，以及 `node_modules` 下的 `@deepseek-ai/libreoffice-kit` 软件包，其中包括本平台的引擎包。缺少任何一项时打包失败。见下文“准备 Office sidecar”。 |
| `DSH_TEAM_CUA_HELPER` | macOS 必需 | 官方 `cua-helper.tgz` 解压后的目录，包含 `native/bin` 和 `cua-helper.json`，必须与当前 helper 源码匹配；校验两个 CPU 版本及全部应用文件。Windows 忽略此变量。 |
| `DSH_TEAM_CONTROL_PLANE_URL` | 是 | 这份构建所属的 Control Plane 源。 |
| `DSH_TEAM_CONTROL_PLANE_CA` | 否 | 签发 Control Plane TLS 证书的那份证书。 |
| `DSH_TEAM_RELEASE_KEY` | 否 | Ed25519 发布公钥的 base64url DER SPKI 编码。没有它的构建从不检查更新，因为它没有可据以判断更新的信任根。 |
| `DSH_TEAM_PLUGIN_TREE` | 否 | 一个已安装 profile 的 `node_modules`，携带树外插件。 |
| `DSH_TEAM_PRODUCT_NAME`、`DSH_TEAM_APP_ID` | 否 | 安装后应用的名称与 bundle 标识符。 |
| `DSH_TEAM_APP_ICON`、`DSH_TEAM_TRAY_ICON` | 否 | 应用图标，以及菜单栏模板图像——其 `@2x` 相邻文件随它一同置入资源。 |
| `DSH_TEAM_PPT_TEMPLATE` | 否 | 办公选择器的 `ppt` 类型导入的 PowerPoint 模版；置于 Runner 旁并在运行时定位路径。 |
| `DSH_TEAM_SKILLS` | 否 | 一个由技能文件夹组成的目录，置于 Runner 旁；部署补丁仅为该目录重新启用宿主技能扫描，使每个预设的目录都在成员自己的技能旁带上它们。 |
| `DSH_TEAM_PPT_SKILL`、`DSH_TEAM_WORD_SKILL`、`DSH_TEAM_EXCEL_SKILL` | 否 | 各办公类型最先加载的技能；每个都必须是 `DSH_TEAM_SKILLS` 内的一个文件夹。 |
| `DSH_TEAM_APPLE_TEAM_ID` | 否 | Apple Developer Team ID；设置后（且环境含 `APPLE_ID` 与 `APPLE_APP_SPECIFIC_PASSWORD`）对 macOS 构建进行公证。 |

### 固定一个私有证书颁发机构

Runner 是一个 Node 进程，不读取操作系统信任库，因此位于企业自签证书颁发机构之后的 Control Plane 在构建携带该机构证书之前不可达：把证书装进钥匙串只能修好浏览器。`DSH_TEAM_CONTROL_PLANE_CA` 把证书置于 Runner 旁，部署补丁则在每一行与 Control Plane 通信的插件上固定它——账号客户端、模型传输、知识与网页搜索。它只对那一个源受信任。使用公开受信任证书的 Control Plane 省略该变量，补丁也就不写这项固定。

桌面壳还会在私有 Team profile 的 `.npmrc` 中，为 Control Plane 的 `/npm/` 端点写入仅针对该仓库的 `cafile` 条目。包查询和下载使用随附的公司证书，不更改其他仓库设置或全局 TLS 信任。

### 携带树外插件

位于 Runner 自身安装之外的插件以真实目录而非打包可执行文件内部的形式随附，因为它们的原生插件无法从打包可执行文件的虚拟文件系统中加载，而它们运行时的依赖复制需要真实文件。用 `dsh plugin --profile <name> add <package>` 把它们装进一个 profile，再让 `DSH_TEAM_PLUGIN_TREE` 指向该 profile 的 `node_modules`。层列表从这棵树挂载 `dsh-univer-office` 与 `@dsh-external/dsh-echarts`，因此树中必须同时带有两者；暂存 profile 中记录的 pnpm 补丁会随打过补丁的文件一同随附。Runner 会跳过 `@deepseek-ai/dsh-*` peer 范围不包含其自身版本的 bundle，而这个 profile 不带任何 `compatibility.json` 豁免，因此树中必须带有声明了 Runner 所在版本线的插件发布版本。

DSH `0.2.2-rc.1` 的暂存 profile 使用 `dsh-univer-office@0.4.0` 及其 [Office 图片导出补丁](patches/dsh-univer-office@0.4.0.patch)。暂存 profile 的 `pnpm-workspace.yaml` 中，`patchedDependencies` 将确切的插件版本映射到本地补丁文件。导出时，补丁从文档对应的 Gateway 读取已保存的图片，使公司 PowerPoint 模板中的位图写入导出文件。

外壳仅在首次启动时初始化私有 profile 清单。插件选择、依赖和成员的 `cordis.patch.yml` 在重启和升级后保留。随附插件复制到 `DSH_HOME/desktop-plugins` 下按内容指纹划分的可写目录，在支持时使用写时复制；profile 中仅建立这些插件顶层包的链接。它们从私有目录解析依赖，与成员安装的包分离。profile 声明的依赖优先于随附链接。旧版复制的目录在迁移时保留其他包。完整的历史版本目录保留，供已有本地引用继续使用。

企业插件树还可以携带 `@wework/company-plugins`。Shell 在新 profile 中启用公司入口和自定义插件索引组合包，并在升级已有公司 profile 时一次性初始化索引组合包。后续启动保留停用选择，其他组合包、依赖和用户补丁均保留。公司入口使用已配置的证书直连账户服务器的目录。插件安装和更新检查使用同一服务器的 `/npm/` 仓库，不回退到公网源。EHS 报告等业务插件仍由成员自行安装。

缺少 profile 包管理设置时，会初始化扁平依赖布局并关闭 peer 依赖自动安装，使插件复用 Runner 内置的服务。现有工作区设置保持不变。

安装程序还把仓库锁定版本的 pnpm 随附到 `runner/pnpm`。外壳通过 `DSH_BUNDLED_PLUGIN_PNPM` 传入其入口，Runner 私有分派器使用 Office sidecar 的独立 Node 安装插件并运行构建脚本。成员的 `PATH` 中无需存在 Node 或 pnpm。普通工具保留原有 `PATH`，显式选择的创作运行时仍然优先。

### 准备 Office sidecar

预览 Word、Excel 或 PowerPoint 文件时的转换会在自带的 Node 运行时下运行 LibreOffice，两者都无法从打包可执行文件的虚拟文件系统中运行。可执行文件从 `DSH_OFFICE_SIDECAR` 指定的目录读取它们；该变量缺失时才会去读一个成员电脑上并不存在的资源缓存。因此安装程序把一份准备好的副本作为 `runner/dsh-office` 随附，外壳在每次启动 Runner 时把该路径传给它。未带 sidecar 启动的 Runner 会记录 `office-to-pdf ... Cannot find package '@deepseek-ai/libreoffice-kit'`，并且无法预览任何 Office 文档。

用 Runner 可执行文件自身发布 sidecar，需在能访问 nodejs.org 与 npm 注册表的机器上执行，然后让 `DSH_TEAM_OFFICE_SIDECAR` 指向它打印出的目录：

```sh
DSH_RESOURCE_CACHE=/absolute/cache DSH_RUNTIME_DOWNLOAD=office /absolute/path/to/dsh
```

所下载的归档是可执行文件旁 `downloads.json` 中固定的那些，因此换用新的可执行文件可能需要新的 sidecar。Windows 的 sidecar 必须为 Windows x64 准备；macOS 上的 Runner 无法发布它。

<a id="preparing-computer-use"></a>
### 准备 Computer Use

使用[官方 helper 构建程序](../../scripts/cua-helper/package.ts)生成已签名并公证的辅助应用，发布凭据配置见[桌面打包说明](../desktop/README.zh.md)。构建任一 Team 桌面 CPU 版本之前，先解压其产物：

```sh
node --import tsx/esm scripts/cua-helper/package.ts --out /absolute/path/to/cua-artifact
mkdir /absolute/path/to/cua-payload
tar -xzf /absolute/path/to/cua-artifact/cua-helper.tgz -C /absolute/path/to/cua-payload
```

把 `DSH_TEAM_CUA_HELPER` 指向解压后的目录。打包会拒绝缺失、源码不匹配或文件被改动的产物，选择对应 CPU 的应用，并随附为 `runner/cua/DSH Computer Use.app`。Electron 签名排除该辅助应用，签名后再次校验其文件未变。Runner 通过 `DSH_BUNDLED_CUA_HELPER` 接收可执行文件路径，可选 Computer Use 组合包仅在启用时读取它。安装版用户不需要 Swift 编译器或开发者签名配置。

Computer Use 要求 macOS 14 或更高版本及 PTC 会话。在插件页启用后，通过其权限页为 `DSH Computer Use.app` 授予辅助功能和屏幕录制权限。这些权限由用户决定。语音输入使用 WeWork 的麦克风权限，macOS 外壳声明了用途并带有 audio-input 权限，模型在首次使用时准备。GitHub、Codex 和 Claude Code 集成仍需相应宿主工具及认证。

安装器将自包含的 Node PTC 启动文件随附为 `runner/ptc/process.mjs`。Shell 通过 `DSH_TEAM_PTC_BOOTSTRAP` 和 `DSH_TEAM_PTC_NODE` 传入该文件与 Office sidecar 独立 Node 的路径。Team 组合包用这些文件以 `node-script` 方式启动，使打包客户端可以切换到保留状态的执行方式，成员仍可在自己的 profile 中修改配置。

### 签名与公证 macOS 构建

没有签名身份时，DMG 采用 ad-hoc 签名，Gatekeeper 会拦截它直到用户清除隔离属性——用于内部测试尚可，不适合分发。要签名并公证：

1. 把 `Developer ID Application` 证书导入登录钥匙串（双击 `.p12` 并输入其密码），随后确认 `security find-identity -v -p codesigning` 能列出它。
2. 为你的 Apple ID 创建一个 app 专用密码（或一个 App Store Connect API key）。
3. 在设置好公证环境后构建；electron-builder 随即用钥匙串身份在加固运行时与 `build/entitlements.mac.plist` 下签名、公证并装订：

```sh
export APPLE_ID="you@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
DSH_TEAM_APPLE_TEAM_ID="YOURTEAMID" \
DSH_TEAM_APP_VERSION=1.0.0 \
DSH_TEAM_CUA_HELPER=/absolute/path/to/cua-payload \
DSH_TEAM_RUNNER_EXECUTABLE=/absolute/path/to/dsh \
DSH_TEAM_CONTROL_PLANE_URL=https://control.example.com \
pnpm --filter @deepseek-ai/dsh-team-runner-desktop package:mac
```

随附的 `dsh` 可执行文件与 `runner/` 下的原生插件随应用一并签名；entitlements 关闭库校验，以便加固运行时的子进程可以加载它们。

-----

<a id="update-an-installed-build"></a>
## 更新已安装的构建

已安装的应用向它自己的 Control Plane 询问更新版本。打包配置把 `electron-updater` 指向 `<control plane origin>/updates/`，因此更新地址跟随本构建所属的部署，不需要另一个属于它自己的地址。

由成员决定何时更新。外壳在启动一分钟后检查一次，此后每六小时检查一次并附加最多半小时的分散，把查到的结果发布给页面，仅在页面请求时才下载。下载完成后停止 Runner 并等待它退出——它的端口，以及在 Windows 上安装程序要替换的文件，都必须先被释放——然后应用重启进入新版本。检查或下载失败时，已安装的构建继续运行。

`window.dshTeamDesktop` 是页面使用的桥：一个上下文隔离的 preload 脚本，暴露 `check`、`install` 与状态订阅，除此之外别无其他。同一个页面在普通浏览器中打开时找不到该对象，也就不显示更新控件。

Electron 的网络栈读取操作系统信任库，因此即便 Runner 接受某个位于公司自有证书颁发机构之后的 Control Plane，这些请求仍会被拒绝。外壳自行针对这一个主机用暂存的 `DSH_TEAM_CONTROL_PLANE_CA` 进行校验，接受由该机构签发的证书，其余主机一律保留 Chromium 自己的判定。

可以安装什么由部署在 `<control plane origin>/updates/manifest.json` 发布的签名清单决定，而不是由产物旁边的元数据决定。外壳经同一条固定了证书的连接读取该文档，用本构建携带的公钥检查其 Ed25519 签名，并拒绝一切该公钥未曾背书的内容：不比已安装构建更新的版本、元数据声称而清单并未覆盖的版本、本次发布没有对应产物的平台，以及跨越该发布所拒绝间隔的升级。拒绝原因会到达成员的提示气泡和外壳日志。

下载完成后会再次对文件做哈希，并与签名清单中的摘要比对。更新程序已经校验过它自己元数据携带的哈希；而这一个，是同时替换了产物与那份元数据的攻击者也无法选择的。不匹配时，已安装的构建继续运行。

发布目录中存放更新程序读取的内容：`latest-mac.yml` 或 `latest.yml`、各个产物，以及它们的 `.blockmap` 文件，后者使一次升级只需取回发生变化的块。macOS 构建同时产出磁盘映像与 zip，因为 Squirrel.Mac 从 zip 替换应用，而磁盘映像仍作为手动下载渠道；两者都在公证之后产出，因此落地的正是已公证的包。

每个版本取下一个 `MAJOR.MINOR.PATCH`：修复用 patch，新能力或 Runner、插件树发生变化用 minor，需要成员配合的变更用 major。后缀在打包时就会被拒绝，而分批放量是 Control Plane 按设备做的判定、不是发布渠道，因此版本线始终保持为一条递增序列。
### 发布一个版本

在发布机上，构建完成签名、公证与 staple 之后：

```sh
node scripts/publish-release.mjs \
  --directory release/<build> --version 1.0.0 --minimum-from 1.0.0 \
  --base-url https://<control plane>/updates/ --key <release private key>
```

它读取 electron-builder 写下的更新元数据，拒绝描述了另一个版本的目录，对各平台更新所安装的那个产物做哈希，并在它们旁边写出 `manifest.json`。`--minimum-from` 给出本次发布可以在其之上应用的最旧已安装版本：低于它的构建会拒绝这次更新，而不是跨越该发布并不支持的间隔去安装。

把产物、它们的 `.blockmap` 文件以及 `latest-mac.yml` 或 `latest.yml` 复制到部署在 `/updates/` 提供的目录，并以静态文件方式提供——差分下载会发出 `Range` 请求，而放在该目录之前的应用层代理必须自行回答它们。

签名清单不放在那里。它在控制台中登记，由控制台决定把该版本提供给谁；以静态文件提供的清单会对每个构建给出同一份答复，从而绕开预发布通道。发布私钥留在发布机上：部署只分发收到的内容、不持有任何密钥，因此一台被攻陷的主机也无法发布一个版本。

该目录在 nginx 中最小的一个 location，与控制台自己的那个并列：

```nginx
location /updates/ {
    alias /opt/deepseek-harness/updates/;
    add_header Cache-Control "no-cache";
    limit_rate 4m;
}
```

`no-cache` 让清单保持新鲜；产物名字里带着版本号，因此文件本身从不需要重新校验。限速则让一次发布不至于把同时还在应答模型调用的主机带宽占满。

-----

<a id="runtime-behavior"></a>
## 运行时行为

- 关闭应用窗口会隐藏它；托盘菜单可以再次打开窗口。
- 操作系统登录项用 `--background` 启动 Electron，因此无需打开窗口即可使用 Runner。
- Runner 意外退出后会安排一次十秒延迟重启。启动失败时 Electron 保持运行、报告故障，并采用相同的延迟重试。
- 窗口显示本地化的启动提示，并最多等待五分钟以获得 Runner 的首次应答，因为首次启动要先物化插件树并修复模块链接才开始监听。子进程必须先宣告自己的入口 URL，桌面壳才会接受 HTTP 应答；同一端口上的其他进程不能授权页面导航或更新清单读取。只有登录重定向、该路由对非导航探测的拒绝、或已登录页面才算就绪。页面加载失败或应答 `404`、`5xx` 时，窗口回到轮询。其他 `4xx` 响应保留页面上的错误提示，包括账户或密码错误；被中止的导航（例如下载）保持页面不动，渲染进程崩溃时重新加载页面。
- 上一实例留下的 Runner——应用在运行时被替换，或被强制退出——会在新 Runner 启动前被停止。只有当该进程仍在运行本构建自己的可执行文件时才信任记录的进程 id；Windows 跳过这一步。如果其他服务占用端口，桌面壳会报告冲突，并等待用户关闭该服务后选择重试。
- 登录项只在首次打包启动时注册一次，之后的启动既不等待该注册也不再弹出通知。
- `runner.log` 旁的 `shell.log` 带时间戳记录每次启动、Runner 的启动与退出、就绪探测结果以及页面加载失败。
- 第二次启动桌面应用会激活已有实例，而不会在端口 `3090` 上启动第二个 Runner。
- 离开本机 Runner 的导航只有 `http` 与 `https` 地址会在系统浏览器中打开，其他协议一律拒绝并记入日志。渲染进程的 Node 集成保持关闭，同时启用上下文隔离与 Chromium 沙箱。
- 退出时停止 Runner 并移除托盘图标。在 Windows 上 Runner 的整个进程树都会结束，其 shell 与辅助进程不会残留；关机或注销时窗口直接关闭而不是隐藏。
- 托盘文案、Runner 本机登录页面，以及编辑器的权限与办公选择器跟随操作系统语言，提供英文或中文。
- 内测声明欢迎弹框永不打开：Team bundle 在组合时就将其置为已确认。

-----

<a id="platform-support"></a>
## 平台支持

| 平台 | 安装程序目标 | 架构 |
|---|---|---|
| macOS 12 或更高版本 | 安装用 DMG，更新用 zip | Apple 芯片（`arm64`）、Intel（`x64`） |
| Windows | NSIS | x64 |

Linux 桌面打包与 macOS Universal 构建不在本应用的平台集合内。

-----

<a id="known-limitations"></a>
## 已知限制

- 一次更新替换整个应用。Runner、插件树与外壳都不会被单独替换，因此每个版本都携带三者。
- 发布清单列出每个已构建架构的 macOS zip，且 `latest-mac.yml` 必须同时列出两个 zip，两种架构才都能更新。请在同一次 electron-builder 运行中构建两种架构，或在发布前合并两份元数据的 `files`；第二份 `latest-mac.yml` 会覆盖第一份。
- Runner 可执行文件按平台在该平台上构建：它的原生插件置入拒绝跨平台目标，因此 Windows 安装程序需要先在 Windows x64 上构建 Runner。唯一的跨平台例外是 macOS 的 CPU 架构：在 Apple 芯片 Mac 上运行 `build-exe-for-python-sdk --targets node24-macos-x64` 时，部署步骤自身会安装 Intel 平台包并构建 Intel 版 Runner。
- 自动登录启动以操作系统用户为单位，而不是特权系统服务。因此 Runner 使用该成员的权限执行工作。
- Runner 日志、外壳日志与部署补丁位于用户级应用数据目录下；支持工具需要从受影响的电脑收集它们。
