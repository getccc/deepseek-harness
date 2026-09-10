# Agent Note: the first request uses the model the composer names

Status: implemented

[English](2026-09-05-the-first-request-uses-the-model-the-composer-names.md) | 中文

## 问题

一位 Team Runner 成员打开空白对话，在 composer 的模型 seat 里看到 `Welinkin Model · High`，发出消息后，这一轮却以 `API 密钥无效` 失败，seat 也变成了 `built-in/test-Qwen`。请求发给了一个成员看不到、也没有选过的模型。

同一个部署默认值有两个读取方，而它们的答案不一致。自[默认模型跟随选择器](../../archived/feature/2026-08-07-default-model-follows-the-picker.md)起，每次被接受的 `session.selectModel` 都把所选模型写入整机共享的 `agent-default-model` 设置节，于是某台机器上一旦有人选过 `test-Qwen`，之后每个空白 Session、之后在这台机器上登录的每位成员都会被继续指向它。公司路由只列出当前登录成员的角色所授权的模型，当目录不再列出已存默认值时，composer 会显示目录列出的第一个模型。但 `session.prompt` 直接从 `ctx.agentDefaultModel` 读取已存默认值并把请求发到那里；Control Plane 以 `403 unknown-model` 拒绝这个未授权的模型，adapter 将其归类为 `AUTH`，客户端则把它表述为密钥无效。

## 决定

**`session.prompt` 会把没有自身选择的 Session 绑定到目录给出的默认模型。** `ApiSessionAgentController.settleDefaultSelection` 在路由检查之前运行：只要 Session 既没有已选的选择、也没有已记录的 `request/header`，它就构建与 composer 读取的同一份 `ModelCatalog`，并把其中的 `default` 安装为默认层返回的值。这个默认值在目录列出部署默认值时就是部署默认值，仅在未列出时才是目录列出的第一个模型，因此请求使用的正是 seat 显示的模型。在记录下一次请求之前，每次 prompt 都会重新读取这个绑定，所以两次 prompt 之间变化的目录或已存默认值都能到达该 Session；绑定只存在于进程内：`request/header` 记录实际使用的模型，这就是日志需要的事实。

**已经做出的选择不会被改动。** 已选的选择或已记录的 header 保持各自的层级和"目录仅供参考"的立场：路由可能服务一个它已不再公布的模型，选了它的成员就会得到它。当没有 adapter 服务所绑定的提供方时，`session.prompt` 仍以 `model-unavailable` 拒绝；这个拒绝现在指向 Session 绑定的路由，而绝不会仅因部署的已存默认值而触发。

**`selectModel` 保存的内容不变。** 整机共享的设置节仍然跟随选择器；角色无法触及它所指模型的成员，会得到目录的默认模型而不是被拒绝。

## 考虑过的替代方案

**让客户端在首次 prompt 之前通过 `selectModel` 提交被替换后的默认值。** 已拒绝：[默认模型跟随选择器](../../archived/feature/2026-08-07-default-model-follows-the-picker.md)这项决定指明 `session.prompt` 是执行边界，客户端的固定操作会与它先于的 prompt 竞速，而且其他每个客户端都得做同样的固定。它还会通过 `saveSelection` 把替换结果保存为整机默认值，把按成员划分的目录事实变成整机偏好。

**把这个绑定记录为 `model/selection` 事件。** 已拒绝：该事件记录的是有人为这个 Session 做出的选择，并会成为投影中的 `pending`，composer 随后会把它呈现为成员自己的选择。这个绑定是 Session 的回退值，不是选择；`request/header` 已经记录了实际使用的模型。

**在 `selectionFor` 的默认层内部解析目录默认值。** 已拒绝：`installModelSelection` 在提示组装时同步读取该层，而目录是一次会到达 Control Plane 的异步读取。在 `session.prompt` 处绑定，既保持该层同步，也把这次往返放在唯一接纳 prompt 的位置。

**按成员而不是按机器保存部署默认值。** 此处未做：管理员仍可能在成员选定模型之后撤销授权，所以无论如何都需要请求时的绑定。按成员保存已存默认值仍是待定事项。

## 影响

任何机器上登录的每位成员都会看到其角色授权的内置模型，空白 Session 的首个请求会发给 composer 显示的模型。之后的成员无法发现的已存默认值不再产生被读作密钥失败的拒绝。空白 Session 的首次 prompt 多付出一次目录构建，在公司路由上是一次 `GET /team/api/models` 往返，而 composer 自身的加载本来就会付出这一次；已有记录请求的 Session 不付出任何代价。

绕过 `session.prompt` 的直接入口（SDK server、ACP、webhook）继续读取已存默认值，因为它们没有需要保持一致的 composer。adapter 仍把 Control Plane 的 `403 refused` 归类为 `AUTH`，所以在做出选择之后被撤销的授权仍会被读作密钥无效；这个措辞是另一个独立的缺陷。

session-models 的 Host 测试固定了以下行为：未列出的默认值上的绑定、目录列出期间的实时默认值、目录省略的已选选择和已记录选择，以及对没有 adapter 服务的已记录路由的拒绝。没有任何 keyless 录制会话场景携带回放目录之外的已存默认值，因此快照不变。
