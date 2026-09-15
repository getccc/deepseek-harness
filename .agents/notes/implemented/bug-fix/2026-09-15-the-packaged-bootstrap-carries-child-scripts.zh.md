# Agent Note: 打包入口承载子进程脚本

Status: implemented

[English](2026-09-15-the-packaged-bootstrap-carries-child-scripts.md) | 中文

## 问题

插件以脚本路径 spawn `process.execPath` 来启动 worker 时，会重新进入单文件可执行程序。[桌面安装器携带部署](../architecture/2026-09-03-desktop-installer-carries-the-deployment.zh.md)记录了修复：入口先识别绝对脚本路径，并像 Node 那样运行它。该分派只存在于 `apps/cli` 的 `import.meta.main` 代码块里。单文件可执行程序经 `python/sdk-runtime/runtime-bootstrap.mjs` 进入，它导入 `lib/bin.js` 并直接调用 `runCli()`，所以那里从不执行该分派：每个这样的子进程都打印 `--profile <name> is required`，`dsh-univer-office` 在打包版 Runner 中既无法启动其 Gateway，也无法启动其内容 worker。未随附树外插件的构建没有暴露这一问题。

## 决策

`apps/cli` 导出 `runExecutable()`：打包可执行程序收到被承载的脚本时运行该脚本，否则运行 `runCli()`。`import.meta.main` 代码块与运行时 bootstrap 的普通分支都调用它。`node-carrier.ts` 中的识别规则不变，私有 subprocess runner 分支仍在它之前分派。

## 考虑过的替代方案

- **在 bootstrap 中复制识别逻辑。** 否决：同一条打包启动规则的两份副本会逐渐偏离，而且 bootstrap 将需要它目前并不导入的 `apps/cli` 内部实现。
- **让 bootstrap 成为 `lib/bin.js` 的主模块。** 否决：bootstrap 拥有私有 subprocess runner 的选择，必须在任何 CLI 模块加载之前执行。

## 后果

打包版 Runner 重新能够承载插件子进程。`scripts/build-exe-for-python-sdk.spec.ts` 固定 bootstrap 调用 `runExecutable()`；桌面构建的打包版 Runner 冒烟测试用脚本 spawn 该可执行程序，并期望脚本运行。
