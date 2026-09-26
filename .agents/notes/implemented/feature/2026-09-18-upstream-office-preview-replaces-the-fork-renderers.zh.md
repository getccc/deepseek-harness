# Agent Note: 用上游的办公预览替换 fork 自有渲染器

Status: implemented

[English](2026-09-18-upstream-office-preview-replaces-the-fork-renderers.md) | 中文

## Problem

fork 迁到上游右侧 Sidebar 后，其内置渲染器只覆盖 Markdown、代码、HTML、PDF 与图片，因此从文件树或交付物卡片打开的 `.docx`、`.xlsx`、`.pptx` 会落到纯文本文档体并显示「不是文本文件」——而这三种后缀恰好就是 composer 的办公 chip 要求模型产出的东西。fork 当时的答案是 `dsh-client-ui-sidebar-documentpreview-office`：一个仅 Team 组合挂载的插件，向上游预览注册表登记三种浏览器渲染器，Word 用 `docx-preview`，Excel 用 SheetJS 折叠进 Univer 的 sheets 预设，PowerPoint 用 `pptx-renderer`。它在单个 closure-factory bundle 中带来约 3.5 MB 的渲染库，Excel 预览不携带字体、填充与边框，SmartArt 与 EMF 回退也无法渲染。

上游 `dsh-v0.1.6-alpha.2` 自带办公预览：`dsh-office-to-pdf` 通过独立发布的 `@deepseek-ai/libreoffice-kit` 在 Node Host 上转换 DOC、DOCX、XLS、XLSX、PPT、PPTX，共享的文档预览再用它已经加载的 PDF.js worker 绘制结果。web bundle 挂载了这两行，因此 fork 的 Team profile 通过叠加 `dsh-web-app` 即可继承该功能。

## Decision

移除 fork 插件及其 Team bundle 行，改用上游的转换预览阅读办公文档。Sidebar 的注册表把外部渲染器排在内置实现之前，这正是该插件存在期间一直挡在前面的原因；删掉那一行就是完整的卸载。

办公**创作**路径不受影响：`packages/office/*`、`dsh-client-ui-office`、composer 的办公选择器，以及 `office-word` / `office-excel` / `amec-ppt` / `univer*` 技能全部保留。变的只有阅读器。

## Alternatives considered

- **让 fork 插件与上游渲染器并存。** 拒绝：注册表会把 fork 的外部渲染器排在内置转换预览之前，成员仍会看到浏览器渲染器，fork 却要为一个严格更窄的结果继续承担 3.5 MB 的库和它们的维护。
- **只为 Excel 保留 fork 插件。** 拒绝：当初选 Univer 预设是因为它看起来像电子表格，但转换出的 PDF 保留了字体、填充、边框与打印版式，折叠进 Univer 从未携带这些。三种后缀共用一个阅读器也更容易说明。
- **在 Host 转换但仍在浏览器渲染。** 这正是 fork 在 2026-09 以「需要 Host 工具、临时文件以及每次打开都要二次读取」为由拒绝过的方案。上游的 provider 正好回答了这一点：转换是一个带有界定准入的服务，PDF 缓存按源内容作键，Client 在复用字节前会重新校验源授权、版本与转换器 generation。

## Consequences

成员重新以转换后的 PDF 阅读 Word、Excel 与 PowerPoint，文件卡片的打开与在文件管理器中显示动作保持不变，并获得 LibreOffice 转换所携带的保真度：字体、填充、边框与打印版式。阅读不再是纯页内行为——字节会到达 Host 转换器，在 Team Runner 上那就是成员自己的计算机，而不是 Control Plane。缺失字体会在预览中报告，而不是被悄悄替换。

放弃的能力是实时电子表格：Excel 预览现在是分页的打印输出，因此 Sidebar 中没有工作表标签栏、公式栏与单元格选择。只有当成员要求在预览中与电子表格交互时才重新引入 fork 渲染器，并且与上游的并列注册，而不是取而代之。

打包新增一个原生依赖：`@deepseek-ai/libreoffice-kit` 从其 `optionalDependencies` 中按目标选择引擎，因此 WeWork 安装包构建必须为每个目标暂存所声明的引擎——或在 kit 未声明时使用 Node WASM——预览才能在已打包的 Runner 中工作。fork 自有的办公 e2e 场景及其 overlay 随插件一并删除；上游的 `document-preview` e2e 用自带的 DOC、XLS、PPT fixture 覆盖转换预览。
