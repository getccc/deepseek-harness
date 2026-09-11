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

插件不拥有 tab、文件读取或工具栏。文档所有者读取文件的完整字节，并安置注册声明了该后缀的文档体；每个文档体把字节渲染进自己拥有并在卸载时清空的容器，渲染前显示加载行，失败后显示带重试的提示行。Word 经 `docx-preview` 排成 HTML 页面，图片内联为 data URL。Excel 经 SheetJS：工作簿只解析一次，每次渲染一张工作表为文本表格，超过 2,000 行或 200 列的工作表在此截断并给出说明。PowerPoint 经 `pptx-renderer`，在推荐的 zip 上限内把幻灯片绘制为 HTML 与 SVG，并随 tab 一起销毁。

| 文件 | 职责 |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | 注册词典、三个渲染器定义与按键文档体 |
| [`src/client/office/DocxBody.tsx`](src/client/office/DocxBody.tsx) | 经 `docx-preview` 渲染 Word 页面 |
| [`src/client/office/SheetBody.tsx`](src/client/office/SheetBody.tsx) | 工作簿解析、工作表 tab 与有界表格 |
| [`src/client/office/PptxBody.tsx`](src/client/office/PptxBody.tsx) | 经 `pptx-renderer` 渲染幻灯片列表，随 tab 销毁 |
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
- **Excel 显示的是值** —— 公式渲染为其缓存结果，单元格格式与图表不绘制，超过 2,000 行或 200 列的工作表在该上限处截断并给出说明。
- **PowerPoint 的还原度取决于渲染库** —— 需要 PDF.js 的 SmartArt 与 EMF 回退没有打包，这些元素以库的占位形式呈现。
- **旧版二进制格式** —— 不声明 `.doc` 与 `.ppt`；`.xls` 由 SheetJS 读取。
- **单个 bundle，随启动加载** —— 三个渲染器及其库打进约 3.5 MB 的一个客户端 bundle，Team 组合随页面一起加载。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

渲染库（`docx-preview`、`xlsx`、`@aiden0z/pptx-renderer` 及其 `echarts` 与 `jszip`）由共享的客户端 bundle 预设内联进 `lib/client.js`；它们的 Apache-2.0 声明经 `gen-third-party-notices` 进入 `THIRD_PARTY_NOTICES.md`。`SheetBody` 把解析后的工作簿放在组件状态里，只折叠当前选中的工作表，因此切换工作表不会重新读取字节。PowerPoint 文档体在打开前把字节复制为独立的 `ArrayBuffer`，因为查看器会接管它收到的缓冲区。

</details>

**运行时不变量：**不发布伴随文件：插件通过注册表与 slot 效应注册三个渲染器及其文档体，这些效应已自证其释放；它读取文档所有者提供的文件字节，不发出 cordis 事件，也不拥有跨插件的可变状态。
