# Agent Note: WeWork is the only product identity

Status: implemented

[English](2026-09-07-wework-is-the-only-product-identity.md) | 中文

## 问题

脱离 DeepSeek 的改名只到达了默认构建。`DSH_CLIENT_BUILD_PROFILE=official`——CI、`pnpm run build:official` 以及 Team Runner 安装包所打包的单文件可执行构建都会选择它——从两处恢复了 DeepSeek 身份：该 profile 的 `DSH_CLIENT_TITLE` 携带 `DeepSeek Harness`，而 `client-ui-brand-official` 仅在该 profile 下注册，用鲸鱼标记与 DeepSeek 字标填充侧栏的品牌 slot。

于是安装后的 Windows 应用把窗口标题写成 `DeepSeek Harness`，并在侧栏画出 DeepSeek 标记；而同一份源码不带该 profile 构建时显示的是产品自己的身份。成员看到哪一个身份，取决于安装包里的 Runner 可执行文件是怎么构建的。

同一个窗口还带着 Electron 默认的 `File / Edit / View / Window` 菜单栏，而没有任何 shell 命令去填充它：桌面外壳自己不贡献任何菜单项。

## 决策

**产品身份不随构建 profile 变化。** official profile 的 `DSH_CLIENT_TITLE` 为 `WeWork`，因此浏览器标题——连同桌面窗口标题——在每种构建中都相同。

**DeepSeek 品牌填充是删除，而不是加条件。** `client-ui-brand-official` 被删除，连同它唯一使用的 `FishLogo` 与 `BrandWordmark` 原子组件，`web-app` bundle 也不再组合它。`sidebar.brand.mark` 与 `sidebar.brand.name` slot 出厂即无填充，于是 `SidebarRoot` 自己的兜底——`WeWorkLogo` 加 `brand.localBuild`——在各处都是产品身份。Web 应用的安装清单携带同一个名称。

**标志是一份美术资源、五个落点。** 同一个小微全身形象的 WebP——由 [WeWork 标志就是小微的形象](2026-09-11-the-wework-logo-is-xiaoweis-figure.zh.md)选定并确定尺寸——以 data URI 的形式出现在外壳的 [`WeWorkLogo`](../../../../packages/client/ui-primitives/src/WeWorkLogo.tsx) 原子组件、[`apps/team-admin`](../../../../apps/team-admin/src/brand.ts) 及该应用自己的 `index.html` favicon、[`apps/web/public/favicon.svg`](../../../../apps/web/public/favicon.svg)，以及 [`team-local-login`](../../../../packages/team/team-local-login/src/pages.ts) 的前置页面中。五者读不到彼此的副本：客户端包打包时没有资源加载器，管理台独立于它们打包，而登录页在任何应用资源路由存在之前就已送出。更换标志意味着五处连同各自携带的绘制比例一起更换。形象的灰色明暗与蓝色边缘在浅色底上可辨认，白色身体在深色底上可辨认，因此 favicon 自身不带配色方案切换。

**管理台的登录卡片重复 Runner 的登录页。** 3095 端口原先在 eyebrow、标题与段落之上画一个渐变 `DS` 字母块；现在它画的是标志加 `WeWork` 与管理台自己的副标题，铺在 Runner 的底色、卡片、字段尺寸、字形与渐变按钮之上。两个来源不共享样式表，因此 `apps/team-admin/src/main.css` 重述那一页的配色与尺寸，而不是引入它；管理台保留自己的词汇（`成员`，而非`账户`），并在 Runner 为自身脚注保留的位置上写明在此登录是做什么的。

**Windows 与 Linux 的桌面窗口不带应用菜单。** `createDesktop` 在窗口存在之前把它清空。Chromium 在页面内保留剪贴板与撤销快捷键，成员用到的东西一个都不会丢。macOS 保留默认菜单：它的系统菜单栏拥有退出与隐藏，这些快捷键别无他处。

## 考虑过的替代方案

**构建安装包时不用 official profile。** 这是上游设计的接缝，不需要改源码，但它让出厂身份成为某一条构建命令的属性。文档化的发布路径与 CI 都会选择该 profile，因此任何经由它们的重新构建都会把 DeepSeek 品牌带回来。

**保留该包，只把它从 `web-app` bundle 移除。** 以死代码为由否决：没有别处组合它，而一个唯一用途是本部署不出厂的品牌的包，没有当前的归属者。

## 后果

未来的部署品牌是一个新的填充包，注册进那两个侧栏 slot；slot 及其 owner props 未变，目录仍然记录它们。

产品名不是公司名。`WeWork` 在每个标题、安装清单、登录页与 preset persona 中命名产品；`Welinkin` 仍然命名公司自己的产物：`office` 插件读取的 `welinkinTemplatePath` 字段、安装程序放置公司模版的 `runner/templates/welinkin-ppt.pptx` 路径，以及 Control Plane 的模型条目。安装后应用的名称与图标是打包输入 `DSH_TEAM_PRODUCT_NAME` 与 `DSH_TEAM_APP_ICON`，因此只有打包环境携带 `WeWork` 与该形象时，安装包才携带它们。

`docs/config-catalog.md` 与 `docs/module-graph.md` 针对被删除的包做了手工编辑。`gen-config-catalog` 在三个 Team 包中无关的展开字段上失败，`gen-module-graph` 报告英文图相对本次改动之前的约四十个包已经陈旧；重新生成任何一个都会把这次删除埋进无关的变动里，而中文图根本没有生成器。
