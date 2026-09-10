# Agent Note: One PowerPoint row carries the company template

Status: implemented

[English](2026-09-09-one-powerpoint-row-carries-the-company-template.md) | 中文

## Problem

编辑器的办公选择器提供两个 PowerPoint 行。`ppt` 在空白 Slide Unit 上构建演示；`welinkin-ppt` 导入安装程序放置的模版。在二者间选择，要求成员知道只有部署才知道的事——是否配置了模版——而答错是无声的：在随附模版的 Runner 上，`ppt` 生成一份看起来已完成、却不符合品牌的演示。公司模版存在时没有成员想要空白演示，因此这个选择没有有用的一侧。

这些行也不带任何标记。同一列中四个长度相近的标签只能逐个读才能分辨，而选择器是编辑器里唯一一个其选项是成员在别处都靠图标识别的格式的控件。

## Decision

**`ppt` 是唯一的 PowerPoint 类型，且它据以构建的正是已配置的模版。** `welinkin-ppt` 已从 `OfficeKind`、`OFFICE_KINDS`、芯片对它的本地镜像、Remote 线上联合类型以及投影的校验器中移除。`renderOfficeSection` 的 `ppt` 分支承载原模版类型所承载的内容：设置了 `welinkinTemplatePath` 时命名路径与导入并保留的指令；未设置时保留[办公分节让位于模版技能](../bug-fix/2026-09-06-the-office-section-defers-to-the-template-skill.zh.md)确立的技能路线，并在目录未列出模版技能时以一份朴素 `.pptx` 收尾。如今产生空白演示的是未放置模版的部署，而不是第二个行。

**该分节不命名任何品牌。** 回退分支过去让模型去寻找“Welinkin PowerPoint 模版技能”，但目录条目由部署自己命名——放置好的树携带 `amec-ppt` 与携带 `welinkin-ppt` 一样自然——因此分节只请求一个 PowerPoint 模版技能，并把该文件称为公司模版。这把那条笔记已经拥有的规则再推进一步：分节只陈述配置所知道的事，而技能的名字不在其内。

**本次构建不认识的类型不施加任何格式。** `foldOfficeChoice` 让每个已记录的值经过 `parseOfficeChoice`——其契约本就覆盖已存储的日志——投影的 `apply` 也以同样方式读取。在旧构建下选择了 `welinkin-ppt` 的会话折叠为 `none`：成员重新选择，而提示词分节与芯片都不会拿到一个自己没有分支可处理的值。把退役类型映射到 `ppt` 会是一层兼容垫片，而在 `SESSION_FORMAT_VERSION` 为 `0` 期间[预发布立场](../../../../AGENTS.md#pre-stable-apis-and-released-session-data)排除了这种做法。

**每一行携带自己的图标。** `IconDocumentOutline16`、`IconSpreadsheetOutline16`、`IconSlidesOutline16` 与 `IconChartOutline16` 作为在本仓库绘制的图标加入 primitives 图标集——图标集其余部分所出自的 figma 源不含办公类型的标记。它们是统一 1.15px 粗细的圆角矩形描边，因此这四个与提取自 figma 的图标并置时读作同一族；芯片在它本就拥有的显示顺序旁把类型映射到图标。

**`welinkinTemplatePath` 保留原名。** 它命名的是模版文件，而不是已退役的类型，因此桌面外壳的 `DSH_TEAM_PPT_TEMPLATE` 放置、bundle 注释，以及源码启动 profile 携带的每一个 `office` 补丁行都原样继续工作。

## Alternatives considered

**保留两行，并把模版那一行标为默认。** 已否决：成员可覆盖的默认仍然是被呈现的选择，而落选的那一支正是无人想要的。选择器会继续追问一个部署早已通过是否放置模版给出答案的问题。

**把 `welinkinTemplatePath` 更名为 `pptTemplatePath`。** 以影响面对零准确度收益否决：该键命名的是模版，而它仍是 Welinkin 的产物，且更名会无声地损坏。schemastery 对未知配置键既不剥除也不拒绝，因此 `office` 行仍沿用旧键的部署会正常加载，而插件读到 `undefined` 并回退到技能路线——一台看似已配置、实则没有的 Runner。

**为这四个标记复用现有 primitives。** 已否决：图标集中最接近的图标是带笔的列表、文件夹与数据圆柱，没有一个能表达 Word、Excel、PowerPoint 或图表。借用它们会让两行与编辑器别处不相干的控件共享视觉词汇。

**在芯片触发器上也显示所选类型的图标。** 此处未采用：触发器固定的标记正是折叠后的芯片能被认出是办公控件的原因，而着色的标签已经命名了该选择。

## Consequences

选择器由五行变为四行，而这唯一一个 PowerPoint 行的行为如今取决于部署配置，而不取决于成员点了哪一行。既无模版也无模版技能的 Runner 仍能得到一份朴素演示，因此没有任何构建失去生成演示的能力。

每一次 PowerPoint 对话的提示词文本都发生了变化，因此 `packages/office/tool-office/tests/section.spec.ts` 钉住两个分支，并钉住回退分支不命名任何品牌。`packages/office/office/tests/scope.spec.ts` 与该分节测试从分节侧与投影侧共同钉住退役类型的折叠。没有任何随附快照发生变化：没有任何录制会话夹具选择办公类型，这正是[选择器笔记](../feature/2026-09-03-composer-office-deliverable-picker.zh.md)所记录的同一处缺口。

primitives 图标集如今混合了绘制的图标与 figma 提取。`packages/client/ui-primitives/tests/icons.client.spec.tsx` 中的计数断言点名了这三组，因此将来若有提取件替换这四个之一，也有落脚之处。
