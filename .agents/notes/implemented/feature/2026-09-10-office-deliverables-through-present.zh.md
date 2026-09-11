# Agent Note: 办公交付物经 present 抵达读者

Status: implemented

[English](2026-09-10-office-deliverables-through-present.md) | 中文

## 问题

办公提示词分节让模型用“univer 办公工具”生成每一份文档，并用 `echarts` 围栏回答图表类型。两者都来自 Team 部署随附的第三方插件；[分两阶段合并上游](../process/2026-09-10-two-stage-upstream-merge.zh.md)为上游的 Sidebar 与文件交付弃用了它们，于是分节命名的是已不存在的工具，而模型用 shell 命令写出的文件谁也收不到：上游的交付物行只列出 `present` 工具声明过的文件。

## 决策

本决策中点名工具的那一半已被[办公交付物回到 univer 工具](2026-09-11-office-deliverables-return-to-the-univer-tools.zh.md)取代；下面的交付规则照旧。

分节命名格式与交付方式，而不是产出它的工具。Word、Excel 与 PowerPoint 类型要求在工作目录下用环境提供的脚本写出文件（python-docx、openpyxl、python-pptx、它们的 Node 对应物或转换器），PowerPoint 类型仍从公司模板开始——复制模板并编辑副本，而每种产出文件的类型都以同一句收尾：写出路径不等于交付文件，只有 `present` 调用才算。图表类型要求每张图表一个 SVG 文件，以同样方式声明，因为 Sidebar 预览图片，而再没有什么会渲染 `echarts` 围栏。

## 考虑过的替代方案

- **自己发布一个 ECharts 渲染器。** 否决：这等于重建合并刚退役的插件，而从 Sidebar 打开的静态 SVG 已经回答了“给我画张图”。
- **让图表类型经 HTML 文件保持交互。** 暂时否决：Sidebar 的 HTML 预览运行在不透明的 iframe 里，只带静态声明的本地资源，交互图表得在每份交付物旁边捆一份图表库。

## 后果

选择器芯片与 `office/kind` 事件不变；只有模型读到的文本变了。`dsh-tool-office` 仍不注册任何工具。未配置模板路径的部署仍走模板技能路线。录制会话快照不含办公分节，因此覆盖在 `section.spec.ts`：它检查图表类型的 SVG 规则，以及每种产出文件类型上的交付句。
