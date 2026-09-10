---
description: "模型所见的办公交付物选择：命名要生成的文档类型的 office:kind 提示词分节，以及编辑器芯片读取的投影。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-office

[English](README.md) | 中文

## 概述

`dsh-tool-office` 是模型所见的一次对话办公选择的全部：一个命名要生成文档类型的提示词分节，以及——对 PowerPoint——据以构建的公司模版路径。它不注册工具：模型用环境的脚本写出文件，并用 `present` 声明它，从而列入交付物行与 Sidebar。该分节是 `office/kind` 会话日志的折叠，而编辑器芯片把同一折叠作为 `office` 投影读取，因此选择器与模型绝不冲突。未作选择的会话没有该分节。

## 目录

- [使用本包](#use-this-package)
- [Model Experience](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在 Team 组合中与办公 Remote 和编辑器芯片一并挂载：

```yaml
- name: '@deepseek-ai/dsh-tool-office'
  config:
    welinkinTemplatePath: /absolute/path/to/company-template.pptx
```

| 字段 | 默认 | 含义 |
|---|---|---|
| `welinkinTemplatePath` | — | 每个 `ppt` 交付物据以构建的 PowerPoint 模版；缺省则改为让模型去会话技能目录加载模版技能 |

无 `office/kind` 事件的日志折叠为 `none`，因此新会话没有分节。成员通过编辑器芯片选择，该选择被记录；分节随后命名该格式。

-----

<a id="model-experience"></a>
## Model Experience

### 系统提示词

#### 模型所见

一个分节 `office:kind`，其文本由会话折叠后的办公选择决定。选择为 `none` 时它整段缺席。每种类型命名要生成的格式；`ppt` 另外携带已配置的模版路径以导入并保留，或在未配置模版时携带从会话技能目录加载模版技能并导入其所指模版的指令；该分节绝不断言模版不存在，也不自行给出配色或品牌名。`chart` 要求每张图表一个 SVG 文件，从 Sidebar 打开。每种产出文件的类型都以同一条交付规则收尾：文件只经 `present` 工具抵达读者，绝不靠写出路径。

##### 选择 Word 或 Excel 类型时

```markdown
Produce the deliverable as a Word document (.docx): write the file under the working directory with a script or command available here (python-docx, docx for Node, or a converter such as pandoc), then declare it with the present tool so the reader receives it. Mentioning the path in the reply does not deliver the file; only the present call does.
```

##### 选择 PowerPoint 类型时

```markdown
Produce the deliverable as a PowerPoint presentation (.pptx) built from the company template at <the configured template path>: copy the template into the working directory and edit the copy with a script available here (python-pptx or pptxgenjs), keep its slide masters, layouts, fonts, and brand colours, and replace only the content. Declare the finished file with the present tool. Mentioning the path in the reply does not deliver the file; only the present call does.
```

##### 选择 PowerPoint 类型且未配置模版时

```markdown
Produce the deliverable as a PowerPoint presentation (.pptx) built from the company template. No template path is configured here, so find the template through the session skill catalog: if it lists a PowerPoint template skill, load that skill first, copy the template it names into the working directory, and edit the copy with a script available here (python-pptx or pptxgenjs), keeping its slide masters, layouts, fonts, and brand colours and replacing only the content. If the catalog lists no such skill, say that the company template is not reachable before building a plain .pptx. Declare the finished file with the present tool. Mentioning the path in the reply does not deliver the file; only the present call does.
```

##### 选择可视化类型时

```markdown
Produce the deliverable as charts the reader can open from the Sidebar: render each chart to its own SVG file under the working directory with a script available here (matplotlib, plotly's static export, or hand-written SVG for simple charts), with the data embedded, axis labels, and a legend, then declare every file with the present tool. Keep the explanation in prose; do not paste chart markup or data tables into the reply. Mentioning the path in the reply does not deliver the file; only the present call does.
```

#### Token effect

选择为 `none` 时没有任何内容。否则是一段简短固定的段落；`ppt` 段落还携带模版路径，且不随对话增长。

#### KV Cache effect

选择不变时前缀稳定。选择某个类型、改变它或清除它都会重写此分节，因此随后的请求从 `office:kind` 起重读其前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **分节是指示，不是强制** —— 生成所命名的格式是模型用环境所提供脚本完成的工作，模型仍可能另作选择；分节是引导，而非门禁。
- **图表是静态的** —— 图表类型要求的是从 Sidebar 打开的 SVG 文件，而不是已退役的第三方插件渲染的交互式 ECharts 围栏。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作背景——点击展开</summary>

`office` 投影键在 `src/types.ts` 中声明，由编辑器芯片经 `./client` 导入，因此浏览器与此 Host 折叠共享同一个键与值。

</details>

**运行时不变量：**不发布伴随文件：提示词分段与投影都是对 Session 日志的纯折叠；调用之间不持有任何状态，也不拥有注册表，投影注册的释放由 HMR 安全测试证明。
