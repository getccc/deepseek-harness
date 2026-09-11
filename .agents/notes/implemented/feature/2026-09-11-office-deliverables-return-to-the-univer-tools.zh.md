# Agent Note: 办公交付物回到 univer 工具

Status: implemented

[English](2026-09-11-office-deliverables-return-to-the-univer-tools.md) | 中文

## 问题

[分两阶段合并上游](../process/2026-09-10-two-stage-upstream-merge.zh.md)之后，办公提示词分节让模型用环境里现成的脚本写出 Word、Excel 与 PowerPoint 文件（[办公交付物经 present 抵达读者](2026-09-10-office-deliverables-through-present.zh.md)）。在 Team Runner 上，这产出的文档和以前不是一回事：模型工作时没有实时预览，没有审阅步骤，除非脚本碰巧保留，否则没有公司母版，而 PowerPoint 完全无视部署专为此写的 `amec-ppt` 技能。拥有该部署的成员要求换回原来的插件模式，并让每个 PowerPoint 都从该技能起步。

## 决策

**`dsh-univer-office` 重新安装进 Team profile，分节点名它的工具。** Word 与 Excel 类型要求用 univer 办公工具创建或导入 `.docx` / `.xlsx` Unit，在其中编辑，导出到工作目录下，再用 `present` 声明；交付句保留，因为上游的交付物行仍只列出已声明的文件。图表类型不变：仍要求 SVG 文件，因为组合里没有任何东西渲染 ECharts 围栏。

**已配置的技能掌管 PowerPoint 流程。** `dsh-tool-office` 新增 `pptSkill`，即会话目录里某个技能的名字；设置后，`ppt` 分节让模型先用 skill 工具加载该技能并照做，既不写模版路径也不写版式，因为技能自己会说。`pptSkill` 优先于 `welinkinTemplatePath`：路径分支与目录搜索分支不变，只在没有技能时生效。源码启动的 `team` profile 在其 `office` patch 行里于模版路径旁设置 `pptSkill: amec-ppt`；桌面壳不随附技能，因此不设该键。

本决策取代 present 那条记录里点名工具的那一半；其交付规则照旧。

## 考虑过的替代方案

- **保留脚本路线，只加技能。** 否决：`amec-ppt` 技能的流程就是 univer 工具（`univer_import`、`univer_compile_svg`、`univer_export`），一个把模型送去该技能却又让它用 python-pptx 的分节自相矛盾。
- **把 `amec-ppt` 硬编码进分节。** 否决：分节只陈述配置知道的事（[办公分节交由模版技能决定](../bug-fix/2026-09-06-the-office-section-defers-to-the-template-skill.zh.md)），目录条目的名字由部署自己定。
- **连图表类型的 ECharts 插件一起恢复。** 未采纳：那是一个 GitHub 托管的构建，成员没有提出，而 Sidebar 已经能打开图表类型产出的 SVG 文件。

## 后果

Team profile 再次带上一个第三方插件，其 peer 版本范围落后于上游版本；Runner 启动证明它能加载，`docs/` 里除 README 的部署依赖限制外不记录它。`section.spec.ts` 钉住每种类型的 univer 措辞、技能分支及其对路径的优先级，以及交付句尾。录制会话快照仍不含办公分节。
