# Agent Note: callers waking to one lapsing token share one refresh

Status: implemented

[English](2026-09-04-callers-waking-to-one-lapsing-token-share-one-refresh.md) | 中文

## 问题

成员关闭 Welinkin Work 桌面应用，稍后再次打开。重新打开的浏览器同时加载模型目录与知识库范围，两个界面一起失败：编辑器旁显示 `Built-in Models 加载失败：transport failed: refused (control plane refused: reused)`，知识库选择器以同样的方式拒绝。重试无济于事，等待也一样；只有重新登录才能恢复 Runner。

`reused` 这个词是 Control Plane 的重放裁决：Refresh Token 在第一次出示时即被用掉，第二次出示则吊销整个凭据 Family，使窃取者与合法持有者同样无法继续（[设备授权](../../../../packages/account/device-authorization/README.zh.md)）。`TeamAccountClient.accessToken()` 读取已存凭据，判断它临近过期，便用它的 Refresh Token 去兑换——而且每次调用各做一遍。模型传输的目录请求与知识库 Provider 的范围请求都在重连后的第一次绘制时调用它，两者读到同一份临近过期的凭据，也出示了同一个 Refresh Token。第一次兑换成功；第二次成了重放，并吊销了第一次刚刚轮换出来的 Family。应用关闭的时间超过 Access Token 的寿命，这场竞态就必然发生，因为此后每次唤醒都从一个已过期的 Token 开始。

## 决策

**`accessToken()` 一次只有一趟在飞。** 客户端保存进行中调用的 Promise；在它运行期间到达的调用者共享这趟并得到同一个 Token。这趟航程既覆盖读取也覆盖兑换，因此在一次兑换完成之后到达的调用者读到的是轮换后的凭据而不是被替换的那份，不存在陈旧读取能发起第二次兑换的窗口。航程无论以何种方式落定都会自行清除，因此一次被拒绝的兑换不会把此后的每次调用都钉在那次拒绝上。

**Control Plane 不作任何改动。** 重用检测继续吊销 Family：正是这一性质让被盗的 Refresh Token 一文不值，而把同一个 Token 出示两次的一方是 Runner。

## 考虑过的替代方案

**在 Control Plane 上设置重用宽限窗口。** 一个刚被用掉几秒内再次出示的 Refresh Token 可以用已经铸出的后继凭据作答，一些授权服务器正是这样做的。在此被否决：它为了掩盖 Runner 的缺陷而削弱了对每台设备的重放裁决，而 Runner 是可以自我串行化的单个进程。对于在兑换与写入凭据之间被杀死的 Runner，它仍是唯一的解法，本决策对此保持原状。

**用定时器提前刷新。** 到期前的后台刷新能让已存 Token 保持新鲜，任何一次唤醒都不会遇到过期。被否决：桌面应用关闭时会停止 Runner，因此在造成故障的那段时间里没有任何定时器在跑，而且定时器仍会与唤醒后的第一次调用竞争。

**在两个消费方各自串行化。** 模型传输与知识库 Provider 可以各自持有一趟自己的航程。被否决：它们彼此仍会竞争，而第三个消费方又会与两者竞争。凭据只有一条记录，因此拥有它的接缝拥有这趟航程。

## 后果

重新打开后两个界面都能加载，被这场竞态吊销过的成员再登录一次即可保持登录。持有新鲜 Token 的并发调用者如今共享一次凭据读取，比先前各读一次更省。账号客户端的测试套件以长于 Token 寿命的提前量向真实 Control Plane 同时发起三次调用：三者得到同一个 Token，下一次调用兑换轮换后的那个，证明 Family 幸存；同一测试跑在先前的客户端上会以 `control plane refused: reused` 失败。在 Control Plane 兑换与自身写入凭据之间被杀死的 Runner，下次启动时仍会出示一个已用掉的 Token 而必须重新登录；上述宽限窗口可以覆盖这种情形，在实际出现之前延期处理。
