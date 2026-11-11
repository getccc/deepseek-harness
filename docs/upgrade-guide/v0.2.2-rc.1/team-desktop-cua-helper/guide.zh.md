---
kind: upgrade-guide
description: "Team macOS 桌面打包要求提供已签名并公证的 Computer Use 产物。"
---

# Team macOS 桌面辅助应用输入

[English](guide.md) | 中文

## 变更

Team macOS 桌面打包要求设置 `DSH_TEAM_CUA_HELPER`。此前的构建不含 Computer Use 应用，因此启用插件后无法加载其本机辅助程序。打包现在会核对官方 helper 产物与当前源码是否一致，并在随附前检查签名、CPU 架构和公证。Windows 打包不需要此输入。

桌面 profile 仅在缺失时初始化。已有插件选择、依赖和用户补丁保留。随附的 Office 与 ECharts 插件移到独立的私有可写目录，profile 声明的依赖优先。已有会话和设置无需转换。

## 迁移

1. 配置官方 macOS 发布凭据，在仓库根目录运行 `node --import tsx/esm scripts/cua-helper/package.ts --out /absolute/path/to/cua-artifact`。见 [Team 桌面打包说明](../../../../apps/team-runner-desktop/README.zh.md#preparing-computer-use)。
2. 将 `cua-helper.tgz` 解压到单独目录，执行 `package:mac` 和 `package:mac:x64` 时均将 `DSH_TEAM_CUA_HELPER` 指向该目录。源码摘要改变时重新构建产物。保留原有 Runner、插件树和 Office sidecar 输入。
3. 构建安装程序。确认包含 `Contents/Resources/runner/cua/DSH Computer Use.app`，且打包时签名后的摘要校验通过。
4. 在 macOS 14 或更高版本中，从插件页启用 Computer Use，选择 PTC 会话，并通过权限页授予辅助功能和屏幕录制权限。重启 WeWork，确认插件仍处于启用状态。系统授权仍需用户操作。
