# Agent Note: 为上游 Sidebar 提供办公文档预览

Status: implemented

[English](2026-09-11-office-previews-for-the-upstream-sidebar.md) | 中文

## 问题

右侧 Sidebar 里的 Word、Excel 与 PowerPoint 预览来自 Team 安装程序随附的第三方办公预览器，它只向第三方 sidebar 的服务注册。[分两阶段合并上游](../process/2026-09-10-two-stage-upstream-merge.zh.md)用上游 Sidebar 取代了两者，而上游内置渲染器只覆盖 Markdown、代码、HTML、PDF 与图片，于是从文件树或交付物卡片打开的 `.docx`、`.xlsx`、`.pptx` 落到纯文本文档体，显示"非文本文件"。编辑器芯片要求产出的办公交付物恰恰就是这些文件。

## 决策

一个 fork 自有的客户端插件 `dsh-client-ui-sidebar-documentpreview-office` 向上游的文档预览注册表登记三种外部渲染器，并把它们的文档体安置在按键的 `sidebar.right.tab.document` 槽位：Word 用 `docx-preview`，Excel 用 SheetJS 加 Univer 的 sheets 预设，PowerPoint 用 `pptx-renderer`。文档体保留了已退役预览器在 Team Runner 上调校过的呈现方式：Word 页面按栏宽缩放，直到读者用滑块或 Alt + 滚轮自行缩放；一套幻灯片按舞台宽度缩放为单一滚动列表，栏宽不小于 380 px 时旁边显示幻灯片缩略图栏，并带上一页/下一页控件；工作簿则打开为已退役预览器展示的同一种 Univer 电子表格，按那个预览器的折叠方式从 SheetJS 的解析结果折叠而来。每个文档体占满共享文档体，并通过 `scrollportRef` 上报自己的滚动容器，因此内容滚动时控件保持固定。它只通过 Team bundle patch 的一行挂载，别处一概不挂。上游注册表把同一后缀的外部实现排在内置实现之前，其工具栏允许读者在已注册渲染器之间切换，因此将来上游的办公渲染器可以与本插件并存试用，删掉那一行即可移除本包。

## 考虑过的替代方案

- **把第三方预览器请回来。** 否决：它对接的是已退役 sidebar 的服务而非上游注册表，而且在同样三个库之外还带着 Univer。
- **在 Host 上转换文档再预览结果。** 否决：Sidebar 的文档所有者已经把完整字节交给渲染器，转换步骤意味着每次打开都要一个 Host 工具、一个临时文件和一次二次读取。
- **用 SheetJS 之上的纯 HTML 网格渲染 Excel。** 先试过，bundle 能小几 MB：它画出了 Excel 的表头、列宽与合并单元格，却不是 Team 成员一直在读的那种电子表格，于是应成员要求换回 Univer 预设。
- **首次使用时再加载渲染库。** 暂时否决：客户端 bundle 格式是每个插件一个闭包工厂产物，没有分块加载，因此三个库打进约 3.5 MB 的一个 bundle。

## 后果

成员重新可以就地阅读办公文档，文件卡片的打开与定位动作不变。Excel 预览把值、公式、数字格式、合并单元格与尺寸带进 Univer，但不带字体、填充与边框，bundle 增至约 21 MB；PowerPoint 的还原度取决于渲染库，需要 PDF.js 的 SmartArt 与 EMF 回退没有打包。注册与每个文档体由本包的测试覆盖，以生成的 Word 包与工作簿为 fixture，PowerPoint 查看器则被 mock；Web e2e 车道新增一个办公场景：在随附组合外加挂载本插件的 overlay 之上驱动一段录制的轮次，然后从"文件"打开生成的 Word 文档与工作簿。
