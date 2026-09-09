---
description: "模型所见的办公交付物选择：命名要生成的文档类型的 office:kind 提示词分节，以及编辑器芯片读取的投影。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-office

[English](README.md) | 中文

## 概述

`dsh-tool-office` 是模型所见的一次对话办公选择的全部：一个命名要生成文档类型的提示词分节，以及——对 PowerPoint——据以构建的公司模版路径。它不注册自己的工具；生成文件由 univer office 工具完成。该分节是 `office/kind` 会话日志的折叠，而编辑器芯片把同一折叠作为 `office` 投影读取，因此选择器与模型绝不冲突。未作选择的会话没有该分节。

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

一个分节 `office:kind`，其文本由会话折叠后的办公选择决定。选择为 `none` 时它整段缺席。每种类型命名要生成的格式；`ppt` 另外携带已配置的模版路径以导入并保留，或在未配置模版时携带从会话技能目录加载模版技能并导入其所指模版的指令；该分节绝不断言模版不存在，也不自行给出配色或品牌名。`chart` 不命名任何文件：它要求输出由 Web 界面就地渲染的 `echarts` 围栏。

##### 选择 Word 或 Excel 类型时

```markdown
Produce the deliverable as a Word document (.docx) with the univer office tools: create or import a .docx Unit, edit it there, and hand back the file.
```

##### 选择 PowerPoint 类型时

```markdown
Produce the deliverable as a PowerPoint presentation built from the company template at <the configured template path>: import it with the univer office tools as the starting Unit, keep its slide masters, layouts, fonts, and brand colours, and replace only the content. Hand back the .pptx.
```

##### 选择 PowerPoint 类型且未配置模版时

```markdown
Produce the deliverable as a PowerPoint presentation built from the company template, using the univer office tools. No template path is configured here, so find the template through the session skill catalog: if it lists a PowerPoint template skill, load that skill first and import the template it names as the starting Unit, keeping its slide masters, layouts, fonts, and brand colours and replacing only the content. If the catalog lists no such skill, say that the company template is not reachable before building a plain .pptx.
```

##### 选择可视化类型时

```markdown
Produce the deliverable as interactive charts in the answer itself. Write one fenced code block per chart whose info string is exactly `echarts`, holding nothing but a strict-JSON Apache ECharts option: double-quoted keys and strings, no comments, no trailing commas, and no JavaScript functions, expressions, `renderItem`, or event handlers. String formatters such as "{value}%" are supported. Keep the explanation in prose outside the fence.
```

#### Token effect

选择为 `none` 时没有任何内容。否则是一段简短固定的段落；`ppt` 段落还携带模版路径，且不随对话增长。

#### KV Cache effect

选择不变时前缀稳定。选择某个类型、改变它或清除它都会重写此分节，因此随后的请求从 `office:kind` 起重读其前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **分节是指示，不是强制** —— 生成所命名的格式是 univer office 工具的工作，模型仍可能另作选择；分节是引导，而非门禁。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>面向维护者的工作背景——点击展开</summary>

`office` 投影键在 `src/types.ts` 中声明，由编辑器芯片经 `./client` 导入，因此浏览器与此 Host 折叠共享同一个键与值。

</details>
