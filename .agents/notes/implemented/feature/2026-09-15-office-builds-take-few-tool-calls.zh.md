# Agent Note: 办公构建只用少量工具调用

Status: implemented

[English](2026-09-15-office-builds-take-few-tool-calls.md) | 中文

## 问题

用 univer 工具构建的办公交付物（[办公交付物回到 univer 工具](2026-09-11-office-deliverables-return-to-the-univer-tools.zh.md)）耗时几十分钟到两小时，结果也不理想。已记录的 Team 会话说明了原因。工具执行只占很小一部分：一个 101 分钟的 PowerPoint 回合里，199 次模型请求等待了 95 分钟，工具运行只用了 4 分钟。步数来自三个习惯。模型在运行时摸索 Facade API，每次对整个类 `univer_api show` 返回约 13 KB，于是一个 Excel 回合在五步内把上下文从 40K 撑到 82K token。它每次请求只做一处小改动或一次检查，并逐页截图。`univer_export` 反复拒绝同一个错误时，它花了约 90 步绕开，最后在 univer 工具之外手工拼装 `.pptx` 的 XML。长回合还会碰上少见的上游故障：一个 Excel 回合在静默 60 秒后以 `STREAM_CLOSED` 结束，因为重试策略默认不重试该代码。

## 决策

**办公分节要求每种 univer 构建的类型尽量少用调用。** Word、Excel 与 PowerPoint 的每个分支都在交付规则之前带同一句固定的节约规则：一个 Unit 的内容用一个 `univer_execute` 脚本写完，独立调用一起发出，只查缺少的确切 Facade 方法而不展示整个类，同一个 univer 工具以同一错误失败两次后停下报告，而不是换一种方式重建文件。

**Word 与 Excel 可以像 PowerPoint 那样从已配置的技能起步。** `dsh-tool-office` 新增与 `pptSkill` 对称的 `wordSkill` 与 `excelSkill`：设置后，该类型的分节让模型在第一次 univer 调用前加载该会话目录技能，并遵循其已验证的构建步骤。分节自身不点名任何技能，因为由部署点名其目录条目（[办公分节让位于模版技能](../bug-fix/2026-09-06-the-office-section-defers-to-the-template-skill.zh.md)）。

**Team bundle 重试未带 `[DONE]` 就关闭的流。** 其 `llm-deepseek` 行把 `retryPolicy` 设为默认的 normal 模式代码再加上 `STREAM_CLOSED`。列表重述默认值，因为配置的列表会替换默认值。

## 考虑过的替代方案

- **离开 univer 工具，改用脚本写文件。** 暂缓而非否决：拥有该部署的成员先测试更快的 univer 路径，再做决定。脚本会失去当初让 univer 工具回归的实时预览与审阅卡片。
- **把已验证的配方直接写进分节。** 否决：每种类型的配方有数 KB，而分节在每个办公会话的每次请求中都会重发，包括根本不构建文件的回合。技能只在模型开始构建时加载。
- **在分节里硬编码技能名。** 否决，理由与 `pptSkill` 作为配置相同：只有安装方知道自己随附了哪些技能。
- **修改默认策略，处处重试 `STREAM_CLOSED`。** 在此否决：默认值归 `dsh-llm` 所有，而干净的半截 EOF 重试可能重复一次昂贵的生成。Team 部署接受这一代价，因为一个失败的办公回合代价更高。

## 后果

每个 univer 构建的分节增加一句约 70 token 的话，每种类型固定不变。节约规则是引导：模型仍可能拆分构建，具体步骤由技能承载。未配置技能的 Word 或 Excel 分节仍会得到节约规则。被重试的已关闭流会重复丢失请求的 token。

有两项部署事实位于本仓库之外，因分节的指令依赖它们而记录在此。`dsh-univer-office` 0.2.14 把每张导入或插入的 PNG 与 JPEG 存为 UUID 资源，而其导出器只接受内联 base64 来源，因此任何带位图的演示文稿，包括每一份从公司模版导入的演示文稿，`univer_export` 都会失败。开发用 Team profile 带有一个 pnpm 补丁，在导出前经 Gateway 的资源路由把每个资源读回。已验证的 `office-word`、`office-excel` 技能与重写后的 `amec-ppt` 技能位于该机器 `$DSH_HOME/skills` 下的用户技能目录；打包版 Runner 的私有 DSH home 在其安装器暂存它们之前，既没有该补丁也没有这些技能。

`section.spec.ts` 固定 Word 与 Excel 的技能句、未配置技能时该句的缺席，以及每个 univer 构建分支上的节约句；`team.spec.ts` 固定重试代码。
