# Agent Note: 桌面安装程序携带整个部署

Status: implemented

[English](2026-09-03-desktop-installer-carries-the-deployment.md) | 中文

## 问题

`dsh-team-runner-desktop` 只携带一项部署事实：Control Plane 源。另外三项没有承载者，而每一项都决定安装后的构建能否工作。

第一项是让私签 Control Plane 可达的那份证书。`controlPlaneCa` 刚刚成为三个 Runner 客户端上的逐行字段，而桌面补丁一行都不写，因此每一份指向这类部署的打包构建都在每一次调用上失败——正是这个字段要防止的失败。

第二项是部署的成员应当拥有的插件。它们位于 Runner 自身安装之外，而成员的电脑上没有可用来安装它们的包管理器：`dsh plugin add` 运行 pnpm。把它们烤进 Runner 可执行文件对真正要紧的那些也行不通。`pkg` 把应用模块放进虚拟文件系统，而原生插件无法从中加载——仅 `dsh-univer-office` 就携带带平台二进制的 `libsql` 以及两个 Univer 原生绑定——同时该插件的 Gateway 在运行时通过 `createRequire` 与 `cpSync` 把自己的依赖包复制到磁盘上，这需要真实文件。

第三项是产品自己的名称与标识，而随附的默认值写的是 DeepSeek，而不是安装它的公司。

## 决定

**每一项随部署变化的事实都是打包环境变量。** 源码树不写任何一家公司。`DSH_TEAM_CONTROL_PLANE_CA`、`DSH_TEAM_PLUGIN_TREE`、`DSH_TEAM_PRODUCT_NAME`、`DSH_TEAM_APP_ID`、`DSH_TEAM_APP_ICON` 与 `DSH_TEAM_TRAY_ICON` 加入已有的源与 Runner 可执行文件。每一项都在打包时校验，因此写错的路径让构建失败，而不是让安装后的应用失败。

**置入的文件在运行时定位，绝不在打包时定位。** 证书被复制到 Runner 旁，其绝对路径在 Runner 启动时由 `process.resourcesPath` 组成。打包期间记录的路径写的是构建机器。

**树外插件以真实目录随附于可执行文件旁。** 输入是一个已安装 profile 的 `node_modules`，由 `dsh plugin --profile <name> add` 一次性产出。原生插件从真实文件加载，Gateway 自己的复制步骤也读取真实文件，而打包可执行文件的虚拟文件系统两者都不提供。

**桌面外壳拥有私有 profile 的清单。** 它在每次启动时写入层列表，而不是让 `dsh` 初始化随附的 `team` 模板。成员不组合这个 profile，而改变层列表的应用升级必须无需任何人编辑文件即可生效。成员自己的 `cordis.patch.yml` 仍归他们所有，从不被写入。

**随附的树被物化为 profile 自己的 `node_modules`，而不是被链接。** Node 从一个包的真实位置解析它的依赖，因此被链接的插件会去只读的资源目录里搜索，而不是去它看起来所处的目录，于是在自己的同级包上失败。该目录还必须可写，因为 `healProfilesModuleFallback` 会在那里为这些插件从 Runner 安装取用的 peer 包添加链接。macOS 在写时复制卷上克隆这份副本，这正是复制约 590 MB 仍可承受的原因；只有应用版本改变时才重复复制。

**托盘从 `app.getName()` 读取自己的标签。** 打包后的名称已经是"这个应用叫什么"的唯一部署事实，因此没有任何地方重述它。

## 考虑过的替代方案

**把插件加入 Runner 可执行文件的依赖闭包。** 加载器那一半本来可行：bundle 解析以安装优先，裸插件名通过已安装基址解析，而客户端插件的浏览器那一半是宿主提供的预构建 `lib/client.js`，不是运行时打包出来的。因原生那一半被否决——每个原生插件都需要可执行文件构建为 ripgrep 与 node-pty 手写的那种外置，而 Gateway 的运行时复制仍然找不到真实文件。闭包清单同时也是 Python wheel 的运行时；只属于 Team 的用户界面插件不该放进去。

**把这两个 bundle 加入 `PROFILE_TEMPLATES.team`。** 被否决，因为该模板与源码启动共用：`pnpm dsh --profile team` 会在 `resolveBundleDir` 上为那次启动从未安装的包失败。

**把随附的每个包链接进 profile 的 `node_modules`，而不复制。** 这个方案先被实现，并在启动时失败：`dsh-better-sidebar` 找不到 `ws`，`dsh-univer-office` 找不到 `@deepseek-ai/schemastery`，因为 Node 从包的真实路径解析，而链接的真实路径位于应用包内，那里没有任何同级包。让 Runner 带 `--preserve-symlinks` 运行会改变该进程内每一次解析的规则，包括打包可执行文件自己的解析，不值得它省下的那次复制。

## 验证时发现

打包可执行文件还会送出一个不含任何浏览器插件的应用外壳，登录后报 `client-modules: HTML did not preload @deepseek-ai/dsh-client-modules/client.js`。普通 Node 会把安装的包软链进 `$DSH_HOME/profiles/node_modules`，而打包可执行文件改写生成的代理包，因为操作系统链接进不了它的文件系统。这些代理对 `import` 是透明的，但它们的清单只带 `dsh.moduleFallback`——于是从一行已解析模块向上找最近清单的 `ClientModuleRegistry` 停在代理上，找不到 `dsh.client`，无声地丢掉了全部 47 个安装自带的浏览器插件，连模块系统自己也在内。只有两个位于 profile 内、是真实包的插件幸存。`nearestPackage` 现在会沿着代理记录的目标找到真实的包。

打包可执行文件还会以 `TypeError: child.isDirectory is not a function` 拒绝每一次 Session 创建，而浏览器把它吞掉了：工作区选择器关闭，什么也没选中。`agent-presets` 用 `readdir(dir, { withFileTypes: true })` 列出它随附的 preset 根目录，而那个根目录位于可执行文件内部。用同一版 `@yao-pkg/pkg` 打包的探针表明，在它的虚拟文件系统里每一种 `readdir`——`readdirSync`、`fs.promises.readdir`、ESM 的 `node:fs/promises` 绑定——都忽略 `withFileTypes` 而返回纯名字，而 `stat` 正常。发现逻辑现在先列名字，再用 `stat` 逐个分类。`cordis` preset 把 `skill-filesystem` 挂在它自己 base URL 下的 `skills/` 目录上，是同一类路径，因此该 preset 的 skill 列表在打包版 Runner 里有同样的失败；它不是 Team 的默认 preset，此处仅记录。

桌面窗口还可能空白几分钟，而实测原因并不是 Runner 慢：打包版 Runner 在冷启动或热启动、在类 Finder 环境下都在 spawn 后 2–3 秒应答登录页，收到 SIGTERM 后 0.3 秒释放端口。问题在外壳的就绪探测接受任何低于 `500` 的状态，而 Runner 在登录路由挂载之前就绑定端口，其间以空正文应答 `404`；探测在 +1.9 秒撞上它，`loadURL` 渲染了那个空页面，而由于这次导航本身成功了，直到 Dock 或托盘点击再次触发探测之前什么都不会重试。就绪现在是 `303`、`405` 或 `200`；窗口显示启动提示而不是一片空白；探测带超时；页面加载失败或应答错误时回到轮询。另外两个长等待的成因从源头去除：上一实例存活的 Runner 占着 3090 端口，迫使十秒一次的重启循环，因此外壳记录 Runner 的进程 id，并在该进程仍运行本构建可执行文件时于启动前让它退出；登录项曾在每次启动时重复注册——关键路径上多出数秒，还每次弹系统通知——现在只注册一次。带时间戳的 `shell.log` 记录这一序列供支持使用。

在这次改动之前，打包可执行文件根本无法运行 `--profile team`。它的依赖闭包缺少 Team 各层在运行时导入的三个工作区 peer——`dsh-knowledge`、`dsh-session-title-llm` 与 `dsh-util-workspace-path`——因此 `knowledge`、`tool-knowledge`、`api-knowledge-controller` 与 `session-title-llm` 在每次启动时都导入失败。`verify-runtime-closure` 正是为拦下这种情况而存在，却通过了，因为它检查清单点名的那些包的 peer，而不是 deploy 安装的每一个包的 peer：这三个都是通过 `@deepseek-ai/dsh` 自己的依赖进入依赖图的。现在清单点名了它们，这也把它们纳入了该门禁。这里没有扩大门禁的覆盖范围。

随后每一个写类 Univer 工具都以 `GATEWAY_UNAVAILABLE: error: --profile <name> is required` 失败。`dsh-univer-office` 用脚本路径 spawn `process.execPath` 来启动它的 Gateway 与内容 worker——这是每个 Node 程序都遵循的惯例——而在打包版 Runner 里 `process.execPath` 就是 `dsh` 可执行文件，其入口把脚本路径读成了没有 `--profile` 的 `dsh` 调用。用同一版本打包的探针表明，`--sea` 模式下 pkg 两条文档化的逃逸都不生效：`PKG_EXECPATH=PKG_INVOKE_NODEJS` 与子进程重入规则都仍然运行内置入口，并把脚本追加到 argv。把另一个 Node 交给子进程也不可行——插件的原生插件是按可执行文件的 Node ABI 构建的，而成员的电脑上没有 Node。因此启动器识别这种 spawn 的形状——第一个参数是指向现有 `.js`、`.mjs` 或 `.cjs` 文件的绝对路径——并把 argv 缩减为 `node <script>` 给出的形式后经 Node 自己的主模块路径运行它，于是 `require.main` 与 `import.meta.main` 成立。每一次 `dsh` 调用都以选项开头，因此启动器的任何用法都不会被遮蔽，而且该检查只在打包构建里运行。这是一个子进程载体，并以此身份记入应用启动规则；它不启动任何应用。

## 后果

安装程序很大。插件树在压缩前约 590 MB，其中大部分是 Univer 查看器的构件，而且整棵复制，因为没有任何清单说明运行中的 Runner 会用到其中哪些部分。

Windows 安装程序需要先在 Windows x64 上构建 Runner。可执行文件构建拒绝跨平台的原生插件目标，因此两半无法在一台机器上产出。

没有任何机制检查随附的插件树与 Runner 可执行文件是否由兼容版本构建。这些插件把 Harness 包声明为 peer 并从 Runner 的安装解析它们，因此升级其中一方的部署必须重新构建两者。

成员无法向这个 profile 添加 bundle，因为清单在每次启动时被重写。通过补丁文件进行的配置不受影响。
