---
description: "让一份本机 Team Runner 常驻、并指向一个部署的 Control Plane 的 Windows 与 Apple 芯片 macOS 桌面外壳。"
kind: "package-reference"
---

# @deepseek-ai/dsh-team-runner-desktop

[English](README.md) | 中文

## 概述

这个 Electron 应用把 Team Runner 安装成成员拥有的桌面进程。它在回环端口 `3090` 上启动随附的 `dsh --profile team`，用经过安全加固的窗口打开本机浏览器应用，窗口关闭后仍可从系统托盘使用，在操作系统登录时于后台启动，并在 Runner 意外退出十秒后重启它。明确选择退出会同时停止两个进程。

一份桌面构建只属于一个企业部署。它的包元数据携带 Control Plane 的 HTTPS 源与 Runner 版本；它不携带成员密码、设备凭据、刷新 token、访问 token 或上游模型凭据。Runner 把生成的设备密钥与签发的凭据存放在 Electron 的用户级应用数据目录下。

## 构建安装程序

先构建 Runner 可执行文件及其伴随程序，再把可执行文件与部署源提供给对应平台的打包命令：

```sh
DSH_TEAM_RUNNER_EXECUTABLE=/absolute/path/to/dsh \
DSH_TEAM_CONTROL_PLANE_URL=https://control.example.com \
pnpm --filter @deepseek-ai/dsh-team-runner-desktop package:mac
```

`package:mac` 只生成 Apple 芯片 DMG，不生成 Intel 或 Universal 产物。`package:win` 生成 x64 NSIS 安装程序，并要求 Windows Runner 可执行文件与 ripgrep 伴随程序。

打包配置把 Runner 二进制文件复制到 Electron 资源中，并在应用元数据中记录已验证的 Control Plane 源。运行时，外壳在自己的应用数据目录下写入部署补丁，用该补丁启动 Team profile，并为子进程提供位于同一目录下的私有 `DSH_HOME`。

## 运行时行为

- 关闭应用窗口会隐藏它；托盘菜单可以再次打开窗口。
- 操作系统登录项用 `--background` 启动 Electron，因此无需打开窗口即可使用 Runner。
- Runner 意外退出后会安排一次十秒延迟重启。启动失败时 Electron 保持运行、报告故障，并采用相同的延迟重试。
- 第二次启动桌面应用会激活已有实例，而不会在端口 `3090` 上启动第二个 Runner。
- 离开本机 Runner 的导航会在系统浏览器中打开；渲染进程的 Node 集成保持关闭，同时启用上下文隔离与 Chromium 沙箱。

## 平台支持

| 平台 | 安装程序目标 | 架构 |
|---|---|---|
| macOS 12 或更高版本 | DMG | Apple 芯片（`arm64`） |
| Windows | NSIS | x64 |

Linux 桌面打包与 macOS Intel 支持不在本应用的平台集合内。

## 已知限制

- 桌面外壳不下载或更新 Runner。部署方需要签名并分发完整的安装程序构建。
- 自动登录启动以操作系统用户为单位，而不是特权系统服务。因此 Runner 使用该成员的权限执行工作。
- 应用日志与部署补丁位于用户级应用数据目录下；支持工具需要从受影响的电脑收集它们。
