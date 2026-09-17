# Agent Note: 运行时闭包检查遍历每个工作区成员

Status: implemented

[English](2026-09-17-the-runtime-closure-check-follows-every-workspace-member.md) | 中文

## 问题

`verify-runtime-closure` 要求可执行程序依赖图中每个包的非可选工作区对等依赖（peer dependency），都是 `python/sdk-runtime/package.json` 的 `workspace:` 依赖。它只从 `packages/*/*` 与 `vendor/*` 读取工作区 manifest（元数据清单）。`@deepseek-ai/dsh` 位于 `apps/cli`，因此该检查把它当作外部包，从不遍历它的依赖，尽管 deploy 会安装这些依赖，其中包括 Team bundle、Web 应用 bundle 与 Team Control Plane。只在 `@deepseek-ai/dsh` 之下声明的对等依赖能通过检查，却不在可执行程序中。[桌面安装器携带部署](../architecture/2026-09-03-desktop-installer-carries-the-deployment.zh.md)在 `dsh-knowledge` 上遇到过这一问题；2026-09-17 构建的打包版 WeWork Runner 又在 `dsh-bi` 上遇到，`bi`、`tool-bi` 与 `api-bi-controller` 在每次启动时都导入失败。

## 决策

该检查通过 `scripts/workspace-members.ts` 从 `pnpm-workspace.yaml` 声明的 `packages:` 成员读取 manifest 集合，`gen-third-party-notices` 也使用这个模块。任何已声明成员区域中的包，包括 `apps/*`，都会沿其 `dependencies` 与 `optionalDependencies` 继续遍历，并检查其必需的工作区对等依赖。

对等依赖的规则不变：它必须是运行时 manifest 的直接 `workspace:` 依赖。因此运行时 manifest 另外列出了 37 个工作区包。其中五个——`dsh-bi`、`dsh-bi-gateway`、`dsh-bi-source`、`dsh-knowledge-gateway` 与 `dsh-knowledge-source`——不在已部署的目录树中；其余 32 个已经作为 `@deepseek-ai/dsh` 的依赖被安装。

## 考虑过的替代方案

**只要依赖图中任一包安装了该对等依赖就接受。** 否决：`build-exe-for-python-sdk` 只恢复被 legacy deploy 放到目标目录之外的直接依赖，并且省略包内的 `node_modules`。仅作为其他包的依赖进入的对等依赖在可执行程序中没有确定的位置，所以这条规则会让当前布局通过，却发现不了 pnpm 放到别处的包。

**把 Team bundle 的 `cordis.patch.yml` 条目作为额外根。** 否决：每个缺失的对等依赖都属于 `@deepseek-ai/dsh` 已经通过 `dependencies` 到达的包，因此插件条目不会给依赖图增加包；手工列出的 bundle 文件集合也会像 glob 列表遗漏 `apps/*` 那样遗漏新的 bundle。

**把 `apps/*` 加进手工列出的 glob。** 否决：`gen-third-party-notices` 已经从 `pnpm-workspace.yaml` 推导其 manifest 集合，再维护一份手工列表会遗漏下一个声明的成员区域。

## 后果

只由 Team 包声明的对等依赖需要在运行时 manifest 中占一行，而该 manifest 也是 Python 运行时 wheel 包的闭包，所以 wheel 包也携带 Control Plane 的对等依赖。`scripts/verify-runtime-closure.spec.ts` 拒绝经 `apps/*` 包到达的缺失对等依赖，也拒绝未声明任何成员的工作区文件。
