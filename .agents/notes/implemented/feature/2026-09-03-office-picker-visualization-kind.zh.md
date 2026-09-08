# Agent Note: 办公选择器提供可视化类型

Status: implemented

[English](2026-09-03-office-picker-visualization-kind.md) | 中文

## Problem

编辑器的办公选择器只命名四种文件格式——Word、Excel、PowerPoint、Welinkin PowerPoint 模版——想让回答里直接出现图表的成员无从表达。图表是 Team Runner 唯一无需生成文件即可交付的成果：`@dsh-external/dsh-echarts` 插件会把 infostring 严格等于 `echarts` 的围栏渲染为可交互的 Apache ECharts 画布，但前提是模型知道要输出这样一段围栏，而此前没有任何东西这样告诉它。

## Decision

**第五种类型 `chart` 接入与文件类型相同的折叠、事件与投影。** 它和其他类型一样是一个 `OfficeKind`：一个 `office/kind` 事件记录它，一个 `office:kind` 提示词分节承载它，芯片从 `office` 投影读回它。选择器的形态没有任何变化——那由[办公交付物选择器](2026-09-03-composer-office-deliverable-picker.zh.md)拥有。

**它的提示词命名围栏约定，而非工具。** 渲染器不提供任何工具调用：它捕获已完成的 markdown 围栏。因此该分节告诉模型为每张图写一段 infostring 严格等于 `echarts` 的围栏，其中只放严格 JSON 的 ECharts option——渲染器拒绝 JavaScript function、expression、`renderItem` 与事件处理器，且只用 `JSON.parse` 解析，所以这些限制写在模型读得到的地方。

**选择器的展示顺序即成员的取用顺序：Word、Excel、PPT、Welinkin PPT、可视化。** `OFFICE_KINDS`、芯片对它的本地镜像，以及 `renderOfficeSection` 的 switch 都采用这同一顺序，读者对照三处时看不到无解释的不对称。

**芯片的文案说交付物，不说文档。** 图表不是文档，而芯片现在命名的集合已不全是文件。

## Consequences

渲染器是按 profile 安装的外部插件，而非 harness 依赖，提示词分节也不检查它是否存在。它缺席时该类型降级为一段可读的 JSON 代码块而非失败：围栏约定就是全部耦合，无论如何都是同样一段文字。

抵达打包版 Team Runner 需要两步而非一步。桌面外壳每次启动都从 `SHIPPED_PLUGIN_BUNDLES` 重写其私有 profile 的清单，因此把插件装进那个将成为 `DSH_TEAM_PLUGIN_TREE` 的暂存 profile 只提供了文件——层列表还必须命名 `@dsh-external/dsh-echarts`，否则随附的插件树里躺着一个无人挂载的插件。

`chart` 是第一个以回答本身为交付物的类型，因此 `dsh-tool-office` 的 Model Experience 分节现在记录一种不命名任何文件的类型，而 `office/` 组 README 不再声称每种类型都生成文件。

没有任何随附快照发生变化。默认（`none`）会话中办公分节整段缺席，且没有任何录制会话夹具选择过办公类型——与选择器笔记记录的是同一处空缺，只是又宽了一种类型。

## Alternatives considered

**为可视化单设一个编辑器芯片。** 否决：该选择与文件类型互斥——一次生成演示文稿的对话不会同时生成散落的图表——而单选正是表达这一点的方式。第二个芯片会让成员同时选中两者，给提示词留下两条互相冲突的格式指令。

**把类型命名为 `viz`，与中文标签可视化对应。** 否决：同级 slug（`word`、`excel`、`ppt`）命名的都是具体格式，而这里的具体格式是 ECharts 图表。标签仍是可视化 / Visualization；slug 说明产出什么。

**让该分节命名 `@dsh-external/dsh-echarts` 插件。** 否决：面向模型的文本承载与任务相关的概念，而非部署的插件清单。模型需要的是围栏与 JSON 规则；由哪个插件消费它们不是模型该关心的事。
