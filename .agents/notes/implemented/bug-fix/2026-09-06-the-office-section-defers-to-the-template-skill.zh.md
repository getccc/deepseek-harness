# Agent Note: the office section defers to the template skill

Status: implemented

[English](2026-09-06-the-office-section-defers-to-the-template-skill.md) | 中文

## 问题

Team Runner 的一位成员在编辑器办公芯片中选择了 `Welinkin PPT 模版`，要求生成一份 deck，得到的却是在空白 Slide Unit 上画出的深海军蓝演示文稿。选择已被记录：会话日志在第一轮之前就有 `office/kind` 事件，`office:kind` 分节也在系统提示词中。正是该分节本身让模型跳过了模版。未配置 `welinkinTemplatePath` 时，它写着"This build carries no Welinkin template file, so build the deck to match that style"，并给出一套配色——深海军蓝 `#0A1E3A` 加 `#0066CC` 到 `#00A3E0` 的渐变——那是写进插件里的，并非取自任何模版。

那台 Runner 上模版就在 `~/.dsh/templates/welinkin/WELINKIN-PPT.pptx`，会话技能目录也列有 `welinkin-ppt` 技能，它命名了该路径与模版实测的配色 `#0664B1` 配 `#F2F8FF`。模型加载了技能，用 `ls` 确认了文件，仍然遵循分节：其记录下来的推理权衡两者后选了分节，因为系统级陈述压过已加载的技能。只有之后一条要求使用模版的用户消息才反过来压过了分节。

一个固定字符串带着两个缺陷。它断言了插件无从知晓的环境事实，又凭空造出模版已然拥有的品牌识别。

## 决定

**未配置模版路径时，`office:kind` 分节让模型去会话技能目录，而不描述模版。** `renderOfficeSection`（`packages/office/tool-office/src/index.ts`）中的 `welinkin-ppt` 兜底陈述此处未配置模版路径，要求模型在目录列有 Welinkin PowerPoint 模版技能时先加载它，并把该技能命名的模版作为起始 Unit 导入，保留母版、版式、字体与品牌色；目录没有这样的技能时，则在生成普通 `.pptx` 之前说明模版不可达。它不命名任何颜色，也不断言哪些文件存在。

**分节只陈述配置所知的事。**"此处未配置模版路径"是关于 `office` 行的事实。机器上是否存在模版则不是；由技能或模型自己的检查来确立。

**已配置分支不变。** 设置了 `welinkinTemplatePath` 时，分节命名路径以及导入并保留的指令，这与 `welinkin-ppt` 技能的流程一致；两个来源命名同一个文件。

## 考虑过的替代方案

**把模版实测的配色抄进兜底。** 否决：它修正了颜色却保留了缺陷。插件会再次拥有本属于模版及其技能的品牌事实，下一次模版变更又会让分节以同样的方式出错。

**让分节读取 `~/.dsh/skills` 或技能注册表来判断模版技能是否存在。** 否决：分节将由第二个读取者断言第二个环境事实，而换个名字的技能就会让这个检查失效。模型的提示词里已有目录，也有 `skill` 工具；分节指向它们即可。

**去掉兜底，没有 `welinkinTemplatePath` 就拒绝加载。** 否决：Team bundle 故意留空该路径，因为只有安装程序知道随附模版落在何处；加载时失败会让每个未随附模版的构建都失去该选项，包括模版可经技能到达的源码启动 profile。

**让已加载的技能压过系统提示词。** 不可行：这个排序属于模型。与技能矛盾的分节才是缺陷，排序不是。

## 后果

在没有 `office` 行的 Runner 上，办公选择为 `welinkin-ppt` 的对话现在到达技能的模版而非一套编造的风格；既无行也无技能的 Runner 会被告知模版不可达，而不是收到一份配色凭空的 deck。分节仅在兜底情形下多出一句。

分节仍是指示而非强制；模型仍可能另作选择。`welinkin-ppt` 技能与 `office` 行是命名模版路径的两个地方，二者可能不一致：随附模版的安装程序写入该行，技能应命名同一个文件。

`packages/office/tool-office/tests/section.spec.ts` 钉住兜底：它命名技能路线，保留导入并保留的指令，不断言文件缺失，也不含任何十六进制颜色。免密钥录制会话快照不带 `office/kind` 事件，因此无一变化；以录制选择验证分节的快照仍如[选择器笔记](../feature/2026-09-03-composer-office-deliverable-picker.zh.md)所记那样延后。
