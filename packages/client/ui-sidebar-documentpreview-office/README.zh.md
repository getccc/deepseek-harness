---
description: "右侧 Sidebar 的 Word、Excel 与 PowerPoint 文件预览：向随附的文档预览注册表登记三种外部渲染器，作为一行 bundle 挂载即可移除。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-sidebar-documentpreview-office

[English](README.md) | 中文

## 概述

`dsh-client-ui-sidebar-documentpreview-office` 在右侧 Sidebar 的文档 tab 内预览 Word、Excel 与 PowerPoint 文档，因此对话产出的或成员从文件树打开的 `.docx`、`.xlsx`、`.pptx` 可以就地阅读，而不只是在桌面应用里打开。它向 Sidebar 的文档预览注册表登记三种外部渲染器，只挂载在 Team 浏览器组合中；一旦卸载，内置的纯文本回退立即回归。渲染在浏览器里基于文件的完整字节进行，不向任何地方发送内容。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在浏览器组合中把它挂载在 `dsh-client-ui-sidebar-documentpreview` 旁边；Team bundle 就是这样做的。它无需配置。之后在 Sidebar 打开 `.docx`、`.xlsx`、`.xlsm`、`.xls` 或 `.pptx` 文件会显示文档本身，而不是"非文本文件"那一行，文档工具栏仍然列出该后缀的每一个已注册渲染器。要卸载，删掉那一行 bundle 挂载即可：注册表把外部渲染器排在内置渲染器之前，因此将来上游为同一后缀提供的渲染器可以与本包并存试用，确认更合适后再拆掉本包。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

插件不拥有 tab、文件读取或工具栏。文档所有者读取文件的完整字节，并安置注册声明了该后缀的文档体；每个文档体把字节渲染进自己拥有并在卸载时清空的容器，渲染前显示加载行，失败后显示带重试的提示行。Word 经 `docx-preview` 排成 HTML 页面，图片内联为 data URL；文档体把页面缩放到栏宽，直到读者拖动缩放滑块或使用 Alt + 滚轮，"适应宽度"按钮则恢复跟随栏宽。Excel 经 SheetJS 与 Univer：SheetJS 解析工作簿，文档体把它折叠成 Univer 工作簿快照（带类型、公式与格式化文本的单元格，合并单元格，列宽、行高与隐藏的行列），Univer 的 sheets 预设按文档语言把它绘制成带自己的工作表 tab、网格线与公式栏的电子表格；实例随 tab 一起销毁。PowerPoint 经 `pptx-renderer`，在推荐的 zip 上限内把整套幻灯片绘制为按舞台宽度缩放的单一滚动列表，带上一页/下一页控件，舞台宽度不小于 380 px 时在左侧显示随滚动进入视野才绘制的幻灯片缩略图栏；查看器随 tab 一起销毁。

| 文件 | 职责 |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | 注册词典、三个渲染器定义与按键文档体 |
| [`src/client/office/DocxBody.tsx`](src/client/office/DocxBody.tsx) | 经 `docx-preview` 渲染 Word 页面 |
| [`src/client/office/SheetBody.tsx`](src/client/office/SheetBody.tsx) | 工作簿解析与 Univer 实例的生命周期 |
| [`src/client/office/xlsx-to-univer.ts`](src/client/office/xlsx-to-univer.ts) | 把 SheetJS 工作簿折叠为 Univer 工作簿快照 |
| [`src/client/office/PptxBody.tsx`](src/client/office/PptxBody.tsx) | 经 `pptx-renderer` 渲染幻灯片列表，含导航与重新适配，随 tab 销毁 |
| [`src/client/office/PptxRail.tsx`](src/client/office/PptxRail.tsx) | 进入缩略图栏视野时才绘制的幻灯片缩略图 |
| [`src/client/office/Status.tsx`](src/client/office/Status.tsx) | 加载、带重试的失败与不支持内容的提示行 |

</details>

-----

<a id="model-experience"></a>
## 模型体验

无：本包在浏览器中绘制成员打开的文档，不注册任何面向模型的内容。

#### KV Cache 影响

无；文件字节经 Remote 传输，不组装任何模型请求。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

- **只读** —— 文档体只呈现文档；编辑仍由文件卡片打开的桌面应用完成。
- **Excel 只读且不带样式** —— Univer 以其编辑界面打开工作簿，但不会写回文件；单元格的字体、填充与边框不折叠进快照，因此单元格只保留值、公式、数字格式、合并与尺寸。
- **PowerPoint 的还原度取决于渲染库** —— 需要 PDF.js 的 SmartArt 与 EMF 回退没有打包，这些元素以库的占位形式呈现。
- **旧版二进制格式** —— 不声明 `.doc` 与 `.ppt`；`.xls` 由 SheetJS 读取。
- **单个 bundle，随启动加载** —— 三个渲染器及其库（含 Univer 的 sheets 预设）打进约 21 MB 的一个客户端 bundle，Team 组合随页面一起加载。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

渲染库（`docx-preview`、`xlsx`、`@univerjs/presets` 及其 sheets 预设、`@aiden0z/pptx-renderer` 及其 `echarts` 与 `jszip`）由共享的客户端 bundle 预设内联进 `lib/client.js`；它们的 Apache-2.0 声明经 `gen-third-party-notices` 进入 `THIRD_PARTY_NOTICES.md`。sheets 预设的样式表由 `tsdown.config.ts` 里的一个解析器内联为文本（预设自带的内联加载器只按导入者的相对路径读样式表），并由 `apply` 中的一个效应挂载，因此随插件一起卸下；Univer 从 `<html lang>` 读取文档语言，locale 运行时会保持它是最新的。PowerPoint 文档体在打开前把字节复制为独立的 `ArrayBuffer`，因为查看器会接管它收到的缓冲区；渲染库按滚动容器的 `clientWidth` 给每张幻灯片定尺寸，所以幻灯片周围的留白放在舞台上而不是滚动容器上。每个文档体占满共享文档体的整个高度，并通过 `scrollportRef` 上报自己的滚动容器，这样 Word 的缩放条与 PowerPoint 的工具栏在页面或幻灯片滚动时保持固定。

</details>

**运行时不变量：**不发布伴随文件：插件通过注册表与 slot 效应注册三个渲染器及其文档体，这些效应已自证其释放；它读取文档所有者提供的文件字节，不发出 cordis 事件，也不拥有跨插件的可变状态。
