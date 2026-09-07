# Agent Note: 小微 stands whole in the hero and the turn header

Status: implemented

[English](2026-09-07-xiaowei-stands-whole-in-the-hero-and-the-turn-header.md) | 中文

## 问题

[小微是助手的名字和脸](2026-09-05-xiaowei-is-the-assistants-name-and-face.zh.md)给了助手一个形象：吉祥物头部的圆形裁切，因为当时唯一的原图坐在白底上，白色的身体在翅膀和脚下处无法干净地从白底上抠出来。裁切展示的是一个头像而不是吉祥物：举起的翅膀、胸前的徽章、展开的双翼——让这只白鸽成为小微而不是任何一只白鸟的部分——都在圆圈之外。产品负责人要求小微出现的每个地方都用完整形象，并提供了新原图：同一只鸽子，挥着手，胸前带着全息徽章，透明底。

## 决定

**唯一的内联源是完整形象。** [`xiaowei-avatar.ts`](../../../../packages/team/team-local-login/src/xiaowei-avatar.ts) 导出 `XIAOWEI_FIGURE_SOURCE`：新原图按形象自身边界外扩 1% 裁切、保留透明底的 320×278 WebP，二进制 17 KB，data URI 23 KB，并以 `XIAOWEI_FIGURE_WIDTH` 与 `XIAOWEI_FIGURE_HEIGHT` 作为绘制尺寸。质量 85 的有损 WebP 保留 alpha 通道。没有消费者裁切它：没有圆角，也没有圆盘。

**每个消费者按自己的宽度完整绘制它。** hero 在问候上方以 160 px 宽、139 px 高绘制形象；轮次头部在留白里以 52 px 宽、45 px 高绘制它。两者都按宽度定尺寸并用 `height: auto`，因此图片自身的宽高比保持不变。由于底是透明的，阴影用沿轮廓的 `drop-shadow` 滤镜而不是盒阴影，此前托起白色圆盘的图层色圆环也不再存在：形象自身的灰色明暗和轮廓阴影把它从浅色主题上分离出来，白色身体在深色主题上无需边框也能读清。

**头部的悬挂量随形象增长。** [`AssistantIdentity.module.css`](../../../../packages/team/team-local-login/src/client/AssistantIdentity.module.css) 里 `--hang` 的上限是形象的 52 px 加它的 4 px 外边距和行的 8 px 间距，即 64 px，因此只要内容列留出至少 80 px 留白，名字仍然坐在内容列的左边缘上。

## 考虑过的替代方案

**轮次头部保留头部裁切，只在 hero 上显示完整形象。** 45 px 的形象很小：头部约 18 px 高。拒绝：要求是小微出现的每个地方都用完整形象，一个源、两个消费者是前一篇 note 为了让形象只在一处更换而选的安排，而且在 52 px 下挥手和徽章仍然可读。

**PNG 源。** 拒绝：同一形象 PNG 是 86 KB，带 alpha 的有损 WebP 是 17 KB，而本产品支持的每个浏览器都能解码带 alpha 的 WebP。

**用资源路由代替内联进客户端包的 23 KB。** 拒绝，理由与前一篇 note 内联裁切时相同：登录页和客户端包都不需要资源路由，而包的增量小于一套小图标字体。

**给完整形象加圆形边框。** 拒绝：站立形象外的圆圈要么剪掉翅膀和脚，要么把鸽子缩进圆里，那正是负责人要求离开的只剩头的样子。

## 后果

空白会话上的 hero 堆叠比没有形象时高 143 px，即形象加它的 4 px 外边距，因此输入框比裁切时期低 39 px。轮次头部行高 45 px。`team-local-login` 的客户端包比裁切时期增大约 10 KB；登录文档不变，登录路由测试仍然钉住那里不含任何内联图片。

Web 期望输出不变：通用场景不挂载团队层，而形象的 ARIA 输出是它的 `alt`，仍由词典拥有。hero 测试与入口测试钉住形象的存在、它的 `alt` 和它的 data URI 源。没有测试钉住绘制尺寸或不裁切；那些是 CSS，靠两种主题的渲染样稿肉眼核对。
