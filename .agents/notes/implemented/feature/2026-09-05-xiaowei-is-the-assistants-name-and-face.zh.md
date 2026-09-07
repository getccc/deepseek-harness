# Agent Note: 小微 is the assistant's name and face

Status: implemented

[English](2026-09-05-xiaowei-is-the-assistants-name-and-face.md) | 中文

## 问题

[寄语每半小时更换一次](2026-09-05-the-hero-tagline-changes-every-half-hour.zh.md)让空白会话标题说出了 `我是小微`，但产品里没有别的地方知道这个名字。每个 agent preset 里模型的 persona 都写着 `You are a coding agent powered by the {{model}} model`，于是成员问助手"你是谁"，得到的答案和页面刚刚给出的不一样。这个名字也没有形象：产品里唯一的美术资源是 AMEC 公司标志，它指的是公司，而不是助手。产品现在有了一个吉祥物——一只捧着全息面板的白鸽——作为小微的脸，以及一个英文名 `Xiaowei`。

## 决定

**名字住在 agent preset 的 persona 里。** [`agent-presets`](../../../../packages/preset/agent-presets/presets/) 中的 `standard`、`ptc`、`cordis` 三个 preset 在原有句子前加上 `You are 小微 (Xiaowei), the AMEC Work assistant:`。preset 就是成员在 AMEC Work 里挑选的模式，它们的 persona 本来就是 agent 身份所在之处；固定的 harness 身份句保留，因为它说的是引擎而不是助手。`minimal` preset 保留它的完整提示词，`sdk`、`acp`、`headless` 三个 profile 的 bundle 级 persona 不动：它们是自动化界面，从不挂载 preset，也从不显示这张脸。

**脸是一个内联源、两个消费者。** `team-local-login` 里的 [`xiaowei-avatar.ts`](../../../../packages/team/team-local-login/src/xiaowei-avatar.ts) 把形象导出为 data URI；[小微在 hero 与轮次头部完整站立](2026-09-07-xiaowei-stands-whole-in-the-hero-and-the-turn-header.zh.md)拥有当前的原图、它的编码，以及每个消费者绘制它的尺寸。登录页仍然属于公司：AMEC 标志、`AMEC Work`、`个人与团队工作空间` 和表单上方的 `欢迎回来`，没有脸也没有介绍句，因为尚未登录的成员还没有在和助手对话。

**每个轮次都以同一张脸开头。** `ui-chat` 新增一个 single slot `conversation.chat.assistant-identity`，由轮次中第一个可见活动行所在的 seat 渲染（[身份头部在注入的上下文之上开启轮次](../bug-fix/2026-09-07-the-identity-header-opens-the-turn-above-injected-context.zh.md)拥有那是哪一行的规则），因此一个头部位于助手在该轮次所做的一切之上——收起的摘要、展开的过程行、注入的上下文或正在流式输出的第一步——并且控件一旦出现就不再移动。owner 份额携带轮次、回复状态，以及消息操作行已在使用的日期感知时钟。`team-local-login` 以聊天署名的形态填充它：脸在 `--dsh-conversation-column-width` 留出空间时悬挂在内容列左侧留白里（空间不够时则领在行首），名字加粗，一个 `Agent` 标签和时钟，因此名字与其下每一行共享同一条左边缘。没有占位者的组合不添加任何内容，这也是通用 Web 场景的 ARIA 输出保持不变的原因。

**transcript 里的过程文案以小微的口吻陈述。** `chat` 词典的运行态文案——收起的过程摘要、中断标记、重试状态、压缩状态、指令执行中摘要，以及推理行与指令卡片的隐藏运行标签——都点出助手：`小微调用了 1 次工具 · 回复了 1 条消息`、`小微思考了一会儿`、`小微停下了`、`小微正在思考`。过程摘要是覆盖动词短语分段的模板 `message.turnProcess.summary`，因此每种语言只写一次名字，而不是写进每个计数形式。其他包里工具、终端与后台任务的状态描述的是那些东西而不是助手，措辞不变。

**图片通过词典命名。** hero 的 `alt` 与轮次头部的名字共用一个键，即 `team.account` 命名空间里的 `assistant.name`，头部的标签是 `assistant.tag`；头部的脸带空 `alt`，因为名字就是它的文本；英文名写作 `Xiaowei`。

**脸和名字一起等。** hero 与此前一样在 `/team/account` 回答之前什么都不渲染；脸在同一道闸门之内，因此整块一次落下，而不是先出图再出字。

## 考虑过的替代方案

**用团队层的提示词分节代替修改 preset。** 一个在 harness 身份与 persona 之间注册 `team:assistant` 分节的 Host 插件可以让通用 preset 保持无名。拒绝：preset 的 persona 恰恰就是说明 agent 是谁的那个槽位，preset 已经是 AMEC Work 提供的模式，而为一句话建一个包，表面积大过那句话本身。

**在 hero 上放全身形象。** 对第一版原图拒绝：它坐在白底上，身体也是白色的，因此去背景在翅膀和脚下阴影处很脆弱，而深色主题上的一块白色矩形比没有形象更糟。圆形头部裁切保留了它自己的白色圆盘，在两种主题上都读作头像。[小微在 hero 与轮次头部完整站立](2026-09-07-xiaowei-stands-whole-in-the-hero-and-the-turn-header.zh.md)记录了消除这一反对理由的透明底原图。

**裁切用 PNG。** 拒绝：同一裁切 PNG 是 66 KB，WebP 是 9 KB，而本产品支持的每个浏览器都能解码 WebP。

**用团队层覆盖 `chat` 词典，让名字不进入 `ui-chat`。** 拒绝：locale 运行时按命名空间和语言各注册一本词典，拒绝第二本，因此覆盖需要为几行文案在 locale 服务里新建一套分层机制。名字现在住在三处——preset persona、`team-local-login` 与 `chat` 词典——给助手改名意味着三处都要改。

**把脸放进侧栏品牌位或应用图标。** 拒绝：那些位置指的是公司，成员靠公司标志找到窗口和托盘。助手的脸属于助手说话的地方。

## 后果

三个 Web 场景钉住标准 preset 的提示词——`fresh-round-trip`、`cordis-tool-round`、`ptc-round`——它们的 `system-prompt.expected.md` 与 `web-context.expected.md` sidecar 带上了新句子。SDK、ACP、headless 场景不变，因为它们的 profile 从不挂载 preset。

`team-local-login` 的客户端包增大一份编码后的形象；登录文档大小不变。空白会话上的 hero 高出形象的高度，输入框坐得更低。

二十二个场景的四十八个 Web 期望输出带有过程摘要、中断标记或重试状态，已按新措辞刷新；刷新结果逐行核对过，只有这些行发生变化，另有一个在角色查询里点名旧摘要的 e2e 文件随之更新。一张介绍小微的引导卡是助手还能以名字说话的剩余一处，这里没有开始。

hero 测试钉住脸的存在及其由词典拥有的 `alt`；登录路由测试钉住渲染页面上的工作空间标签，以及页面不含任何内联图片。聊天测试钉住身份头部跨折叠时留在控件上、流式输出时位于注入的上下文之上、无前置行时落在第一步上、落在无过程的回答上、无占位者时的缺席，以及每条运行态文案的新措辞；入口测试钉住占位者、它的释放，以及它带时钟与不带时钟时渲染的头部。没有单元测试能证明模型会应答这个名字；Web 场景证明这句话到达了模型。
