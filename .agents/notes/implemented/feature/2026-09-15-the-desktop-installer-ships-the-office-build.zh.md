# Agent Note: 桌面安装器随附办公构建

Status: implemented

[English](2026-09-15-the-desktop-installer-ships-the-office-build.md) | 中文

## 问题

办公选择器的 Word、Excel 与 PowerPoint 类型用 univer 办公工具构建，并从带已验证构建步骤的技能起步（[办公交付物回到 univer 工具](2026-09-11-office-deliverables-return-to-the-univer-tools.zh.md)、[办公构建只用少量工具调用](2026-09-15-office-builds-take-few-tool-calls.zh.md)）。桌面安装器一样都没带：合并上游之后，它随附的插件层列表为空，于是打包版 Runner 既不挂载 `dsh-univer-office`，也不挂载 ECharts 渲染器，不暂存任何技能，也不设置任何办公技能。打包版成员得到的办公指令点名的是不存在的工具。技能路线也不给出模版文件，而打包版 Runner 把模版暂存在应用包内一个随安装而定的路径上。

## 决策

**安装器从其插件树挂载办公插件。** `SHIPPED_PLUGIN_BUNDLES` 点名 `dsh-univer-office` 与 `@dsh-external/dsh-echarts`，因此 `DSH_TEAM_PLUGIN_TREE` 必须同时带有两者。暂存 profile 中记录的 pnpm 补丁以打过补丁的文件随附，univer 位图导出修复就是这样抵达成员的。

**安装器随附办公技能。** `DSH_TEAM_SKILLS` 把一个由技能文件夹组成的目录暂存为 `runner/skills`，部署补丁把该目录加入 `skill-filesystem` 的 `customSkillDirs`，与成员自己的根目录一同扫描。`DSH_TEAM_PPT_SKILL`、`DSH_TEAM_WORD_SKILL` 与 `DSH_TEAM_EXCEL_SKILL` 点名各办公类型最先加载的技能；除非每个都点名 `DSH_TEAM_SKILLS` 内的一个文件夹，否则打包失败。这些名字以 `teamOfficeSkills` 记入应用元数据，并作为 `pptSkill`、`wordSkill` 与 `excelSkill` 写入 `office` 行，与暂存的模版路径并列。没有暂存技能目录时，部署拒绝办公技能。

**PowerPoint 技能路线给出模版文件。** 同时配置了 `pptSkill` 与 `welinkinTemplatePath` 时，`ppt` 分节仍以技能为流程所有者，并加上模版文件路径，要求在技能提到模版的地方都使用该路径。这取代了此前技能分支不给出模版路径的规则。

## 考虑过的替代方案

- **把技能复制进私有 Harness home 的 `skills` 目录。** 否决：该根目录属于成员，应用升级将不得不覆盖或合并成员可能改过的文件。
- **把模版路径留在技能里。** 否决：该路径在开发者 profile 与每个打包安装之间各不相同，只有部署补丁知道它。
- **用一个变量把类型映射到技能。** 否决：三个变量各自独立校验，并与 `tool-office` 的三个键一一对应。

## 后果

要随附办公构建的 macOS 安装器需要一个装有两个插件的暂存 profile、技能目录与三个技能名；缺少它们的构建仍能打包，但不挂载任何办公插件。插件树增加数百 MB，按应用版本克隆一次。`deployment.spec.ts` 固定了 office 行、技能根目录、缺技能目录时的拒绝以及层列表；`section.spec.ts` 固定了技能分支上的模版句。
