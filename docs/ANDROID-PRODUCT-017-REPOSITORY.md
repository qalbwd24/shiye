# Android 017：同 SQLite 产品 Repository 接缝

2026-10-18。状态：原生 Repository 已实现并通过专属 Android SQLite 隔离验证；产品连接区/运行包接入由主会话验收。本文不声明旧日记编辑器或 Telegram 消息已经切换权威，也不声明手机已全量同步。

## 本轮实现和权威边界

新增 `android/app/src/main/java/dev/shiye/app/ProductRepository.java`。构造函数必须接收 **LocalStore 自己的 SQLiteDatabase 实例**；本类不开第二个库、不扫描/复制 TL、不调用网络、不产生另一套正文切分算法。`base` 是可信服务器同步版本快照，`local` 是它叠加未确认 intent 后的当前内容；两者不是两份可分别编辑的正文。

完整 `SyncEntity` 信封整体 JSON 持久化，顶层未知扩展、`_product`、`_canonical`、旧 Entry 字段、附件、业务 revision、ISO 时间、显式 null 和列表保持。未知实体完整接收但不能排编辑命令。全库计数接口只查询 SQL COUNT，不读取长文正文。

本轮遵循 [Android 标准契约](ANDROID-PRODUCT-SYNC-CONTRACT.md)、[产品 API](PRODUCT-SYNC-API.md) 与 `public/shared/sync-v2-client.js` 的 base/intent/rebuild、可信基线、固定 wire、ACK、冲突和墓碑规则。共用处理器和 `prepareProductEntry` 仍在业务准备层；没有在 Java 中重写长文切分/时间逻辑。

旧 TL/SQLite 正文尚未完成保留式单源迁移。`status()` 明确返回 `contentSyncEnabled:false`、`messageAuthority:'legacy-tl-not-migrated'`。收到产品信封只是产品收件区可离线读取，不自动变成旧 UI 已读写同一权威。当前 canonical 权威篇与聊天归篇保护为只读；不能把“共有完整信封”解释成当前 Java 已能安全重写 canonical。

## 持久布局

| 新表 | 内容与作用 |
| --- | --- |
| `product017_records` | `(entityType,entityId)` TEXT 主键；完整 record 含 base/local、localRevision、localOnly |
| `product017_pending` | 单调 sequence、不可重用 operationId、entity/command 两条 lane、完整 intent/固定 wire/库身份 |
| `product017_meta` | 库 libraryId/epoch，initialized，snapshotCursor/snapshotKeys 和最终 pull cursor；无令牌 |
| `product017_conflicts` | 同 operationId 的状态/远端 conflictId；本类不会把撤回原文抄进冲突表 |
| `product017_mappings` | `(kind,localId)` TEXT→完整映射对象；同键不同对象拒绝，不用标题猜映射 |

`initialize()` 仅创建以上新表，不改变已有 entries/categories/messages 等表，不清数据，不自行提高宿主 SQLite user_version。主会话负责 LocalStore 的加法升级入口；已有 schema3 数据与原写口保持。当前没有自动导入旧条目或自动生成上传 intent。

## 主会话调用接口

| 接口 | 保证/调用要求 |
| --- | --- |
| `initialize()` | 在宿主选择的升级边界创建新表；不会开网络或读取现有正文 |
| `bindIdentity(info)` | protocol=1；首次绑定 libraryId/epoch，以后错误库/epoch拒绝；不清资料或队列 |
| `load(type,id) / records()` | 返回完整 record；local 可能为 null（快照已不再包含的旧远端对象），UI应处理 |
| `metadata() / status()` | metadata含接收位置；status含 records/pending/conflicts 的 SQL 计数及 initialized，不扫描正文 |
| `transaction(Work<T>)` | 同一个 SQLite connection 的同步回调；异常整笔回滚；endTransaction完成后才返回 |
| `inCurrentTransaction(Work<T>)` | 当 LocalStore 已经开始事务时使用；宿主负责 setSuccessful/endTransaction，并在之后返回“本地已保存” |
| `Tx.database()` | 仅供同步本地 SQL/projection/文件任务登记；不能在回调中等待网络、WebMessage、计时器或另起事务 |
| `enqueueIntent(intent,expectedLocalRevision,localCommit)` | 本地版本核对，完整 local/base 重建，localRevision递增和 entity outbox同事务；可同事务更新宿主投影 |
| `prepareNextPush(identity)` | 返回 **job**，不是 wire。job.wire在首次准备时从可信 base.revision构造并落盘；之后重试完全相同 |
| `ackOperation(id,result,identity)` | 仅确认已发操作；采用返回 base，再重放其后 intent；不重置 localRevision，不碰输入框/IME/草稿 |
| `enqueueCommand(action,input,identity,localCommit)` | 仅四个既定动作白名单；localCommit必需，先本地内容/任务再固定命令，任一步失败全部回滚 |
| `nextCommand(identity) / ackCommand(id,receipt,identity,onReceipt)` | 固定队头读取；onReceipt和删队列同事务，失败保留job；本类不自动清草稿或推断旧TL已切权威 |
| `applyRemotePage(mode,requestedCursor,page,identity)` | 全页身份/参数/实体/projection/游标在一笔事务；处理失败不落半页、不推进位置，不进入outbox |
| `Tx.preserveLocalOnly(envelope,expectedLocalRevision)` | 仅显式保留旧本地资料的接缝；base=null，不自动上传；已具有远端权威/待发操作时拒绝覆盖 |
| `Tx.putMapping/getMapping` | 显式持久身份关联，消息号全程字符串/TEXT |

已在外层事务内调用 `transaction()` 会拒绝，避免嵌套提交产生假本地ACK。Tx仅在同步callback中可用；callback返回即失效，不能跨线程或保留到下一笔事务。`Projection.update(tx,record)`如有配置，也在同笔事务运行；投影失败会回滚整页或整次编辑，不允许异步落entries。

发送普通实体时主会话应提交 `new JSONArray().put(job.getJSONObject("wire"))`。不能把包含 intent/wire 的整个 job 发给 push。客户端手填的 operationId/baseRevision/deviceId被剔除；新编辑生成新operationId，旧wire不改。status中的本地revision、业务data.revision和服务器外壳revision彼此独立。

## 接收、墓碑与冲突

snapshot每页持久记录已seen身份与snapshotCursor，最后才采用checkpoint作为pull cursor。中断重开能续页；空远端不删除 localOnly，也不会未经确认上传旧资料。正常pull不扫描清库。错误库/epoch、旧页cursor、非法实体、不能前进的分页或projection失败都整页回滚。

产品契约要求已确认撤回不可复活。因此最终snapshot即使未列出旧墓碑，也保留其withdrawn base；这是对共用通用客户端“未seen一律清base”路径的保守加固，防止空重快照洗掉撤回。较新active也不能覆盖已确认withdrawn。此保护不改变正常snapshot、ACK合并或活动内容冲突规则。

收到withdrawn时保留身份/顺序和状态，base/local的data均为空；删除该实体含旧正文的待发intent，仅留下无正文冲突状态。已知对应的旧消息发送业务batch不改载荷重试，而是取消该不可变batch并记无正文状态；其他本地输入由其原localCommit权威保留，是否显式重排新batch由业务控制器处理。legacy TL/宿主的缓存清理由未来同事务projection接管；本轮没有擅自删除尚未迁移的旧库。

普通冲突/拒绝保留原待发intent并阻塞该实体队头；远端新base可供显示，但本地较新意图保持。迟ACK确认第一版之后，第二版依然在local和队列中；其下一wire采用确认后的真实base，而非设备时间/本地revision。ACK不会推进pull cursor。

canonical权威长文必须在业务层完成共享prepare、previousRecord/units/layout保留与一致性验证后再开放编辑；本轮默认拒 `CANONICAL_PREPARATION_REQUIRED`，不以一个未经证明的“prepared:true”解除保护。普通完整已支持产品实体可使用真正dirty字段，值可以是数组、对象或显式null。unknown、server-owned message/comment/delivery/service state不走普通push绕过业务口。

## 实际验证

专属工具：`android/repository-tests/verify.ps1`，明确只允许 `emulator-*`；测试包 `dev.shiye.repositoryqa017` 无Activity、无网络权限。测试在emulator-5554的真实 `android.database.sqlite.SQLiteDatabase` 上执行，不安装主 `dev.shiye.app`，未操作手机。fixture全部合成，无私人正文、令牌或配对码。

`generate-reference.mjs` **实际运行公共sync-v2-client状态机**，在第一条push尚未ACK时排第二次编辑，产出迟ACK/拒绝/撤回三阶段oracle。Android逐对象核对local/base和wire基线；不是另写一个同名假同步实现。

最终59项断言通过，包含：

- golden完整Entry/_canonical/未知信封保真，20位超long消息ID及reply逐字符保持，productConversationId/productMessageId与fixture一致；
- 同DB宿主projection＋intent/业务command异常一起回滚，receipt失败保留job，不批量清较新草稿；
- 消息/评论墓碑清理仍含原文的固定业务command，评论沿原operationId或显式持久映射核对；
- 迟ACK保留后续编辑、真正base生成下一wire、固定wire重试/SQLite重开、原localRevision和队列保持；
- 整页失败不落半条/不推cursor、snapshot中断恢复、空远端不清localOnly/不自动上传、已确认墓碑跨空snapshot保留及拒复活；
- schema3原行body/revision/显式null内容时钟始终保持，映射冲突拒绝，未知类型只读，数字消息ID拒绝，身份守卫、过期Tx和外层rollback。

回执 `outputs/2026-10-18-android-product-017/repository/android-sqlite-result.json`，源码/fixture SHA-256及设备/范围见同目录 `verification.json`；build/instrumentation日志同目录。临时QA工程/Java编译文件/共用oracle在 `tmp/android-product-017/repository/`。最早QA探针以execSQL运行有返回值的PRAGMA被Android拒绝，已改为rawQuery后完成上列真实测试；这是测试夹具修正，不冒称最早运行通过。

本轮没有做断电/强杀窗口、旧TL数据库升级、手机覆盖安装、生产编辑器权威迁移、完整原件任务/大正文hydrate、后台生命周期或双端离线冲突实测。完整产品接入状态以主会话的 [017实施](ANDROID-PRODUCT-017-IMPLEMENTATION.md) 与最终验收为准；不因本接口已存在就将上述门槛写为完成。
