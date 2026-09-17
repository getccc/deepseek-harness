# Agent Note: Control Plane SQLite 写入路径

Status: implemented

[English](2026-09-17-control-plane-sqlite-write-path.md) | 中文

## 问题

Control Plane 把九个存储（账户、设备、访问控制、审计、配额、模型、控制台菜单、知识库、BI）保存在 SQLite 文件中，并在一个进程内通过同步的 `node:sqlite` 驱动访问，因此每条语句都会阻塞该进程服务的所有请求，包括流式模型响应。每次模型调用都要经过这些存储完成授权、预留配额和结算。有两项开销随使用增长。`reserve` 在插入前会汇总日历月周期内的每个 Reservation，即使不存在预算上限、汇总结果也无法拒绝请求时仍然如此。这些存储还运行在 SQLite 默认的回滚日志模式下，每次提交都要同步日志文件和数据库文件，读者也要等待写者。

## 决策

`dsh-quota-sqlite` 先读取该周期的预算，只在存在上限时才汇总该周期的结算与未结算的 Reservation。`usage()` 仍然从行中推导完整的账面状况，账本不存储运行总额。

九个存储都接受 `journalMode`（默认 `wal`，或回滚日志模式 `delete`、`truncate`、`persist`）和 `busyTimeoutMs`（默认 1,000）。`applySchema` 接受文件的 application id 和 schema 版本后，存储会应用日志模式并设置 `synchronous = FULL`，因此无论 SQLite 构建的默认值是什么，已 resolve 的写入在 WAL 下都能在断电后保留。WAL 模式会持久保存在文件中，已提交的事务在检查点之前可能只存在于 `-wal` 文件里；[Control Plane bundle README](../../../../packages/bundle/team-control-plane/README.zh.md) 说明了由此需要的备份方式。

## 测量

2026-09-17 在本地测量：macOS arm64 内置 SSD，Node 24.15.0，SQLite 3.51.3，在普通 Node 下运行构建后的 `lib/` 包。工作负载包含一个组织、绑定到同一个角色（已授予 `model.invoke`）的 300 名成员、一个已注册模型，以及基于文件的账户、访问控制、配额和模型存储。计时前，在一个事务中向配额文件写入当前周期内 N 条已结算的 Reservation。一次计时调用是 `modelGateway.authorize` 加 `modelGateway.settle`；先预热 30 次，再测量 300 次，表中给出中位数。不含模型和网络延迟。

| 预置 Reservation 数 | 回滚日志，每次 reserve 都汇总 | WAL，只在有上限时汇总 |
|---|---|---|
| 0 | 1.05 ms | 0.32 ms |
| 10,000 | 6.20 ms | 0.33 ms |
| 100,000 | 105.6 ms | 0.36 ms |
| 500,000 | 774.1 ms | 0.32 ms |

设置上限并预置 100,000 条 Reservation 时，改动后一次调用耗时 93 ms，改动前为 95 ms。在空账本上，仅启用 WAL 就能把一次调用从 1.05 ms 降到 0.41 ms，`synchronous = NORMAL` 还能再降到 0.32 ms。该 SSD 的同步开销很低，因此较慢的磁盘会放大日志模式之间的差距；没有在较慢的磁盘上测量。

## 考虑过的替代方案

**用触发器维护的总额保存余额。** 有上限的 `reserve` 只需读一行，但账本会多出一份存储的余额副本、一个 schema 版本和一次回填，而目前没有生产消费者设置上限。这是启用上限的部署的后续工作。

**在 WAL 下使用 `synchronous = NORMAL`。** 已否决：操作系统崩溃或断电后，已提交的事务可能回滚，会丢失调用方已经收到的结算、审计事件或已签发的凭据。[已归档的 Session SQLite provider](../../archived/architecture/2026-08-18-sqlite-physical-chunk-row-compression.md) 做出了相同的选择。

**通过新包共享打开流程。** 九个存储重复的是两个配置字段和三条语句；新包带来的注册、文档以及每个存储上的一条依赖，超过了它能删掉的重复代码。

**为周期汇总添加覆盖索引。** 仅索引读取能降低常数因子，但有上限的调用仍会读取周期内的每个 Reservation。

## 后果

没有上限的调用不再随当月 Reservation 累积而变慢，写入也不再阻塞同一文件的读者。有上限时，`reserve` 仍会读取整个周期，`dsh-quota-sqlite` README 把它列在已知限制中。已有部署会在首次启动时把文件切换为 WAL，运维人员必须通过 SQLite 的备份 API 备份，而不是复制数据库文件。持有写锁的外部 `sqlite3` 会话会让请求最多等待 `busyTimeoutMs` 后失败（以前是立即失败），等待期间进程被阻塞。每个存储的测试都通过第二个连接读取日志模式，覆盖默认值和配置的回滚日志模式。
