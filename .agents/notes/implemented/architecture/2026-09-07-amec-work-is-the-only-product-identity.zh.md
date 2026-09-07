# Agent Note: AMEC Work is the only product identity

Status: implemented

[English](2026-09-07-amec-work-is-the-only-product-identity.md) | 中文

## 问题

改名为 AMEC Work 只到达了默认构建。`DSH_CLIENT_BUILD_PROFILE=official`——CI、`pnpm run build:official` 以及 Team Runner 安装包所打包的单文件可执行构建都会选择它——从两处恢复了 DeepSeek 身份：该 profile 的 `DSH_CLIENT_TITLE` 携带 `DeepSeek Harness`，而 `client-ui-brand-official` 仅在该 profile 下注册，用鲸鱼标记与 DeepSeek 字标填充侧栏的品牌 slot。

于是安装后的 Windows 应用把窗口标题写成 `DeepSeek Harness`，并在侧栏画出 DeepSeek 标记；而同一份源码不带该 profile 构建时显示的是 AMEC Work。成员看到哪一个身份，取决于安装包里的 Runner 可执行文件是怎么构建的。

同一个窗口还带着 Electron 默认的 `File / Edit / View / Window` 菜单栏，而没有任何 shell 命令去填充它：桌面外壳自己不贡献任何菜单项。

## 决策

**产品身份不随构建 profile 变化。** official profile 的 `DSH_CLIENT_TITLE` 为 `AMEC Work`，因此浏览器标题——连同桌面窗口标题——在每种构建中都相同。

**DeepSeek 品牌填充是删除，而不是加条件。** `client-ui-brand-official` 被删除，连同它唯一使用的 `FishLogo` 与 `BrandWordmark` 原子组件，`web-app` bundle 也不再组合它。`sidebar.brand.mark` 与 `sidebar.brand.name` slot 出厂即无填充，于是 `SidebarRoot` 自己的兜底——`AmecLogo` 加 `brand.localBuild`——在各处都是产品身份。Web 应用的安装清单携带同一个名称。

**Windows 与 Linux 的桌面窗口不带应用菜单。** `createDesktop` 在窗口存在之前把它清空。Chromium 在页面内保留剪贴板与撤销快捷键，成员用到的东西一个都不会丢。macOS 保留默认菜单：它的系统菜单栏拥有退出与隐藏，这些快捷键别无他处。

## 考虑过的替代方案

**构建安装包时不用 official profile。** 这是上游设计的接缝，不需要改源码，但它让出厂身份成为某一条构建命令的属性。文档化的发布路径与 CI 都会选择该 profile，因此任何经由它们的重新构建都会把 DeepSeek 品牌带回来。

**保留该包，只把它从 `web-app` bundle 移除。** 以死代码为由否决：没有别处组合它，而一个唯一用途是本部署不出厂的品牌的包，没有当前的归属者。

## 后果

未来的部署品牌是一个新的填充包，注册进那两个侧栏 slot；slot 及其 owner props 未变，目录仍然记录它们。

`docs/config-catalog.md` 与 `docs/module-graph.md` 针对被删除的包做了手工编辑。`gen-config-catalog` 在三个 Team 包中无关的展开字段上失败，`gen-module-graph` 报告英文图相对本次改动之前的约四十个包已经陈旧；重新生成任何一个都会把这次删除埋进无关的变动里，而中文图根本没有生成器。
