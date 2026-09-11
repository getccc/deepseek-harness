# Agent Note: The WeWork logo is 小微's figure

Status: implemented

[English](2026-09-11-the-wework-logo-is-xiaoweis-figure.md) | 中文

## 问题

产品带着两份各司其职的美术资源。Welinkin 公司标志填满源码树拥有的每个品牌位置——侧栏品牌行、两个 favicon、管理台以及 Runner 本地登录页——而小微的形象只出现在助手说话的地方。[小微是助手的名字与脸](../feature/2026-09-05-xiaowei-is-the-assistants-name-and-face.zh.md)有意把两者分开：它否决了把脸放进侧栏品牌位与应用图标，因为那些位置指的是公司。产品负责人把产品从 `Welinkin Work` 改名为 `WeWork`，并要求每个标志都换成吉祥物原图，即那只挥手、胸前带全息徽章的白鸽。

## 决定

**标志是小微的全身形象。** 提供的原图正是[小微在 hero 与轮次头部完整站立](../feature/2026-09-07-xiaowei-stands-whole-in-the-hero-and-the-turn-header.zh.md)编码为助手形象的那张 2000×2000 透明底图片。标志是这张图裁到形象自身边界、缩放到 128×111，并以质量 90 的有损 WebP 连同 alpha 通道编码：二进制 6.4 KB，data URI 8.5 KB。侧栏在品牌行与收起轨道中都以 32 px 宽绘制它，两个登录页以 56 px 宽绘制，管理台侧栏为 26 px；128 px 覆盖了其中最宽的 56 px 在 2 倍像素密度下的需要。

**五个落点逐字节携带同一份。** 它在 [WeWork 是唯一的产品身份](2026-09-07-wework-is-the-only-product-identity.zh.md)列出的每个副本处替换 Welinkin 标志，每个落点都携带 128:111 的比例。外壳原子组件以产品命名为 `WeWorkLogo`，管理台导出 `WEWORK_LOGO_SOURCE`、`WEWORK_LOGO_WIDTH` 与 `WEWORK_LOGO_HEIGHT`。两个 favicon 都声明 WebP 图片，`favicon.svg` 把形象居中于它 50 单位的方框内。

**登录页显示形象，但不介绍助手。** Runner 本地登录页在 `欢迎回来` 之上把标志画在 `WeWork` 与工作空间标签旁边。它不带介绍句，因为尚未登录的成员还没有在和助手对话。

**标志与形象各自编码。** `XIAOWEI_FIGURE_SOURCE` 仍是助手的脸，320×278，供 160 px 的 hero 使用；标志是自己的 128×111 编码。两者出自同一份原图，因此更换吉祥物意味着两者都要重新编码。

## 考虑过的替代方案

**把 `XIAOWEI_FIGURE_SOURCE` 画成登录页的标志。** `team-local-login` 已经内联了它，这样可以去掉五份副本中的一份。拒绝：它按 hero 的尺寸编码，data URI 为 23 KB 对 8.5 KB，而且它的比例与留边和它必须一致的其余四份不同，"五处都要更换"就不再是一句字面指令。

**在 16 到 26 px 的位置把标志裁成头部。** 头部裁切在 favicon 里比头部只占三分之一高度的全身形象更好辨认。拒绝：要求是把提供的图片作为标志，而在管理台侧栏的 26 px 下挥手、徽章与眼睛仍然可辨。

**像 Welinkin 标志那样用 PNG。** 拒绝：形象的 RGBA PNG 为 20 KB，256 色调色板 PNG 会让有明暗的身体出现色带并丢失眼睛的颜色，而带 alpha 的有损 WebP 为 6.4 KB，在每个绘制尺寸下都看不出差别。形象本来就以 WebP 出厂，所有支持的浏览器与 Electron 外壳都能解码它。

## 后果

窗口的品牌行、标签页与登录页现在显示与 hero 相同的脸，产品与它的助手共用一个形象。[小微是助手的名字与脸](../feature/2026-09-05-xiaowei-is-the-assistants-name-and-face.zh.md)把"脸不作公司标志"的否决作为历史保留，并链接到这里。

应用图标与菜单栏模板图仍是源码树之外的打包输入 `DSH_TEAM_APP_ICON` 与 `DSH_TEAM_TRAY_ICON`，因此只有打包时提供了由该形象派生的图片，安装包才会显示它。

`ui-primitives` 钉住标志的 WebP 源与比例；侧栏快照带有新的 data URI；清单 e2e 钉住 favicon 的 WebP 图片；登录路由测试钉住标志组合。没有测试比对五份副本彼此是否一致。
