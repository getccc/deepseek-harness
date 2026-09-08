# Agent Note：公司模型声明图片输入

状态：已实现

[English](2026-09-07-company-models-declare-image-input.md) | 中文

## 问题

2026-09-07，Welinkin Control Plane 的 `Welinkin Model` 条目已切到上游 `deepseek-v4-flash-vision-exp`，而每台成员 Runner 在 `built-in` 路由上仍然拒绝图片。两道门槛都在拒绝，而两者都读不到目录。`session-controller` 里的输入框门槛向 LLM 服务询问所选模型的 `inputModalities`，DeepSeek 适配器对每条路由（包括 `built-in`）都用本机 `models` 列表回答这个问题；Control Plane 目录没有模态字段，因此除非每台 Runner 自己的 profile 另行声明，公司模型就是纯文本，而那份声明又压在整体替换数组的 settings 用户层之下。这道门槛之后，适配器对任何经传输发送的带图请求一律拒绝，因为它的图片路径用成员自己的密钥经 DeepSeek Files API 上传，而传输路由没有密钥。

## 决定

**目录声明请求可以携带什么。** [`model-gateway`](../../../../packages/llm/model-gateway/src/types.ts) 里的 `ModelEntry` 与 `RegisterModel` 携带 `inputModalities`，一个取自 `MODEL_INPUT_MODALITIES`（`text`、`image`）的非空列表。词表由 [`llm-http-transport`](../../../../packages/llm/llm-http-transport/src/vocabulary.ts) 拥有并由网关重新导出，因为这个值正是穿过那条接缝从目录到达 Adapter 的，两侧必须指名同一个封闭集合。`discover` 把它连同引用与显示名一起返回，`/team/model/catalog` 对外发布它，Team 传输在线路边界拒绝列表缺失、为空或含有本 Runner 不认识的词的目录。

**SQLite 以 schema 版本 2 把它存为 JSON 数组。** [`model-gateway-sqlite`](../../../../packages/llm/model-gateway-sqlite/src/schema.ts) 增加 `input_modalities TEXT NOT NULL`，附带“合法且非空的 JSON 数组”的 CHECK，`applySchema` 拒绝 `user_version` 不是 0 或 2 的文件。发布前立场是拒绝旧的磁盘格式而不是迁移，因此处于版本 1 的部署重建目录并重新注册模型。

**管理 API 把省略的列表视为 `text`。** [`team-admin-api`](../../../../packages/team/team-admin-api/src/index.ts) 的 `POST /models` 读取可选的 `inputModalities`；缺失视为 `text`，为空、重复或含未知词的列表以 `modalities` 为由回答 400。`WireModel` 携带该列表，管理台的模型表单增加一个复选框“接受图片输入”，勾选与否对应 `['text', 'image']` 或 `['text']`；表格用一个标签标出支持图片的行。

**传输路由从传输目录取模型事实，并内联发送图片。** [`DeepSeekAdapter`](../../../../packages/llm/llm-deepseek/src/adapter.ts) 通过 `remoteCatalog` 解析一条路由的目录条目：拥有发现权的传输所在的路由在每次 `resolveModel`、`prepareCall` 与 `stream` 时重读 `listModels()`，因此管理员的修改到达下一次请求而不是下一次重启，最近一次列举结果只为无法等待列举的同步 `imageRequestPricing` 路径保留。`modelInfoFor`、`streamWithConnection` 里的图片门槛与请求序列化器读的都是这同一个条目。传输路由从不持有密钥，因此 `request` 把每张图片在 `maxInlineRequestImageBytes` 之内序列化为 base64 的 `image_url`，从不进入 Files API 分支；那条指名“Files API image references”的拒绝已经不存在，条目缺少 `image` 的公司模型得到的 `UNSUPPORTED_CONTENT` 消息与直连路由上纯文本模型得到的相同。远端条目的图片预算取适配器默认值，因为目录不携带按模型的图片策略。

**Control Plane 默认读取 32 MiB 的请求体。** [`model-gateway-http`](../../../../packages/llm/model-gateway-http/src/index.ts) 把 `maxRequestBodyBytes` 从 4 MiB 提高到 32 MiB，`team-control-plane` bundle 写入同一个值：内联图片使适配器 20 MiB 的内联预算经 base64 编码后成为端点必须接受的请求大小。

## 考虑过的替代方案

**在每台 Runner 的 profile 目录里声明模态。** 这正是临时绕过办法在开发用 Mac 上做的事，它失败了两次：settings 用户层的 `llm-deepseek.models: []` 整体替换了 profile 的列表，而按机器写的声明跟不上管理员在 Control Plane 上做的修改。否决。

**让 Files API 上传经由 Control Plane 转发。** 一个代理的文件端点能保留适配器偏好的表示方式，但它需要在同一把公司密钥下跨成员的文件归属映射，网关 README 把这一点列为刻意缺席。推迟；内联 base64 不需要网关尚未携带的任何东西。

**用 `ALTER TABLE` 把 schema 版本 1 迁移到 2。** 依发布前立场否决：在第一个打标签的发布之前，后端拒绝旧的磁盘格式，而目录小到足以重建。

**给远端目录加带存活期的缓存。** 否决：间隔会成为一个隐藏的可调参数，而过期条目会让图片放行到管理员刚刚切走的模型。每次模型解析读一次目录，是读到当前声明的代价。

**在 `model-gateway` 里另设一份模态词表。** 否决：同一个线路值的两份列表会漂移，而传输接缝已经拥有两侧共同读取的封闭操作列表。

## 后果

传输路由上的每次模型解析花费一次 `GET /team/model/catalog`：每次预备调用一次，消息带图时再多一次。目录是对少数几个模型逐行做的访问控制判定，而同一台 Runner 本来就在输入框每次打开时列举它。

Welinkin 部署重建 `models.sqlite`，重新注册它的两个模型，并把 `Welinkin Model` 标为接受图片；打包的管理台在下一次构建时获得该复选框。`built-in` 路由上的图片 token 估算来自最近一次列举，因此从未列举过的路由在第一次预备调用之前把图片按文本定价。

单元测试套件覆盖目录列与版本拒绝、端点的目录响应体、传输的线路校验、管理 API 的默认值与拒绝，以及适配器的远端解析、内联序列化、拒绝与定价。没有无密钥的录制会话快照覆盖 Team 传输，因为快照 harness 不组合 Control Plane；图片路径在 Welinkin 部署上用源码启动的 Runner 做了端到端验证。
