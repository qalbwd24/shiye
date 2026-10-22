# Android 0.15 后端、长日记与朝花夕拾接入交接

2026-10-18后续017候选已验：015配对/准备接缝已扩展到固定product/sync/原件接口、同SQLite完整信封/事务队列、显式Coordinator和私有原件helper。正常0.17/code19 APK bd1e6a86…仅构建未部署，44原生HTTP/59 SQLite/74原件/11生命周期迁移/9 WebView对象/36共享通过；旧UI权威/生产写口、完整同步和朝花夕拾完整UI仍未切换。手机/主AVD保持016；017四图UI未实施。请以[017验收](validation/2026-10-18-android-product-017.md)及[实施门槛](ANDROID-PRODUCT-017-IMPLEMENTATION.md)为最新入口，下面015未实现项是历史阶段，不覆盖017已验接缝。

2026-10-18 UI后续：主AVD现已0.16.0-qq-skin/code18（冻结0.14原生/业务资产，仅QQ皮肤/触摸），手机亦已保留数据更新0.16。本文件015配对/长文候选code17仍保留源码，未混入016；后续合并请用code19以上，不能把主AVD更新当Repository同步已经接通。QQ模块已补入标准adapter builder清单，完整新后端合并按最新标准契约另验。见[016验收](validation/2026-10-18-android-qq-skin-016.md)。

2026-10-18新增后端正式接入文档入口：[Android标准数据与调用契约v1](ANDROID-PRODUCT-SYNC-CONTRACT.md)、[实际产品API](PRODUCT-SYNC-API.md)和[golden合成fixture](contracts/android-product-sync-v1.fixture.json)。产品18789已复用同一Bearer提供chat/revisit业务口、大正文和私有state原子提交，但只含合成库；不等同日常多实例registry已经挂入该服务。下文关于仅通用sync、未统一业务挂载和容量未解的审计为实施前状态，按新契约逐项核对；本地权威Repository/outbox-inbox及真机完整接入仍待实现。本轮只补文档/合成DTO验证，不改015代码/APK，不动窗口。

实施增量：015-A及015-C准备已在独立QA验证，运行主包仍0.14；见[实际回执](validation/2026-10-18-android-backend-015.md)。下文为实施前审计，新增sync-product候选需按最新能力重新核验。

2026-10-18，只读审计。先由主会话完成0.14 UI与手机部署，再按本文推进下一阶段；本文不改变0.14范围，不声明某个候选已在手机运行。未修改源码、存储、共享文档、设备或服务，也未创建云服务器。

## 一、下一阶段的实际目标

让手机继续以完整本地资料离线读写，后台交换增量；长文与电脑共用richdoc/分段/时间算法；用户能从会话进入朝花夕拾，查看来信、原文并独立配置规则。三个目标相关，但不能用“连接成功”代替本地Repository、内容单源或业务服务接入完成。

推荐先交付**协议识别与完整本地信封接缝**，随后接受支持实体的outbox/inbox，再开放朝花夕拾实际绑定/收件。现有0.14收藏连接不作为整库同步开关，现有TL/SQLite数据保持到对应保留式切换验收完成。

本审计以 [同步前端契约](SYNC-FRONTEND-CONTRACT.md)、[同步后台实现](SYNC-BACKEND-IMPLEMENTATION.md)、[实际内容契约](DESKTOP-ANDROID-CONTENT-CONTRACT.md) 以及当前Android源码为依据。文档中同时保留了历史阶段；以下结论用当前源码交叉核对，未重新查询运行端口或设备版本。

## 二、先分清业务服务与sync/v1

| 项目        | 日常业务API / 0.12、0.14接缝                                 | 独立增量同步服务                                                      |
| ----------- | ------------------------------------------------------------ | --------------------------------------------------------------------- |
| 能力检查    | `/api/health` 中conversationServices/stickerCollection等能力 | `/api/sync/v1/health`，service=shiye-sync、protocol=1，再认证读取info |
| 当前数据    | 日常Entry、chat-journal、回看及收藏；并非sync库              | 独立SQLite实体、版本/回执/变更、媒体；不自行读取diary.json            |
| 认证        | 原本机Host/Origin/访问锁；X-Diary-Client:desktop仅来源兼容   | pair获得deviceId/token，Authorization:Bearer；libraryId/epoch保护     |
| Android已有 | BackendServices发现/实例固定动作；014收藏固定口/128KiB桥分块 | 尚无配对、凭据、info/snapshot/push/pull/watch产品客户端               |
| 内容写口    | Entry PUT、聊天固定写口、config/bind/comment各有业务语义     | push存同步外壳，当前不替业务适配器做完整语义规范化                    |
| 运行器      | 会话实例的规则、游标、投递、评论和后台运行器                 | 支持serviceConfig/binding等实体名，**尚未挂接旧回看运行器**           |

同步文档中的18769/18779及Tailscale地址是隔离联调快照，不是将正式日记改接新空库的指令；18770也不是本任务可接管的服务。后续使用前由负责会话重新核实归属、地址、库身份。

当前不能把BackendServices的地址直接改成18779就完成同步：该类查的是业务health/catalog，HTTP又只接受localhost/127.0.0.1；`backend_network_security.xml`也只对这两个主机放行明文。临时测试包已证明网络可达，不代表正式包具有相同协议与网络策略。

下一步应新增**协议专属的SyncTransport/连接上下文**，复用生命周期取消、安全错误与固定路由思想，不能复用业务动作/桌面来源头冒充同步认证。连接页仍可在同一个“服务连接”入口按能力清楚分组；过渡期间保存sync配置不能覆盖旧业务配置或014已固定的收藏scope。若要求所有能力最终只用一个root，须先由后端提供受保护的统一挂载/业务适配，并明确发布能力；现在没有这个同服事实。

新sync配置最少含baseUrl、deviceId、私有令牌引用、已确认libraryId/epoch、启用状态。首次顺序是health→用户输入配对码pair→Bearer info→核对库身份；客户端不远程调用local-pairing管理员口。401暂停待认证，不丢待发内容；换地址先停旧watch/传输，校验同库身份再恢复，不清库重来。014收藏目前按旧baseURL固定scope，不能因“sync库身份相同”就擅自清除这个独立保护。

主线优先HTTPS。若下一阶段用局域网/Tailscale HTTP隔离联调，应给QA包/指定目标设计明确、狭窄的网络策略并验实际包，不把WebView网络拦截或全局cleartext全部放开。业务服务原Host/Origin/访问锁保持。

## 三、本地Repository必须先补的持久边界

实际`LocalStore`为schema3：entries只有已支持的本地字段，另有categories/assets/旧rooms/messages/meta；dispatch单请求有SQLite事务，但没有sync outbox/inbox、远端base或游标表。Entry DTO重建为richdoc，attachments来自body引用；save只支持YYYY-MM-DD、已有本地分类ID和有限字段。完整桌面时间/未知信封/独立附件/canonical权威当前会被保护式adapter提前只读，这个保护不能删。

新版随想仍由`shiye-android-telegram-v2` IndexedDB/冻结worker持有消息与草稿；LocalStore旧messages表不是它的权威来源。原生flush及014媒体ACK是真实本地保存接缝，但都不是跨设备outbox事务。现在“先写TL，再异步抄到SQLite/outbox”存在两步之间强杀丢同步意图的窗口。

推荐的下一阶段接口，**均为建议新增，不是现存方法**：

| Repository接缝                                  | 完成条件                                                                                             |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `loadEntryEnvelope(id)`                         | 读取完整原件/扩展字段、权威标记、内容时钟和独立附件，产生可编辑能力判定；列表只用派生索引            |
| `saveEntryIntent(id,localRevision,dirtyFields)` | 共用校验/必要的单源派生后，在同一SQLite事务保存完整业务对象、索引投影和待发intent，再返回本地保存ACK |
| `applyRemotePage(page,cursorContext)`           | 验库/epoch/业务版本，同一事务保真落实体、base、冲突/映射与接收游标；不把接收再登记为本地编辑         |
| `ackOperation(operationId,receipt)`             | 只确认已发快照；推进远端base、重建后续本地intent，不清正在输入的较新修改                             |
| `resolveIdentity(kind,localId)`                 | 持久保存Entry/规范单元/原聊天复合身份/TL投影ID/会话UUID映射，不能用标题或有损数值替代                |
| `enqueueMediaTask(assetId,task)`                | 原件先落私有文件，任务/断点/校验与消息同步状态分离，不阻塞文字本地保存                               |

新持久层需覆盖完整业务信封、本地revision、远端base/revision、不可变wire操作、outbox顺序、inbox/meta游标、冲突旁支、身份映射与媒体任务。表名/迁移版本在实现前单独确定；不在本文直接批准真实库迁移。

若采用完整aggregate JSON作为权威，原entries表只能作为**同事务更新的读取索引/兼容投影**，所有编辑须进入Repository，不能让两个body继续分别可编辑。也可选择已知字段＋扩展侧车重组完整信封，但必须证明未知字段、完整日期、独立附件与canonical关系往返不丢；“多存一份JSON”本身不是单源证明。

随想切换需独立门槛：先保留旧TL库和原件，建立来源/消息/草稿映射，再让发送动作经Repository本地事务获得ACK后投影到TL。若先保留TL作为临时权威，则outbox必须与其原消息提交在同一个IDB事务内；不能另开同步IDB或晚扫整库伪装原子。当前大量reader固定`indexedDB.open(...,1)`，直接升级该库版本会让旧worker/收藏/flush reader出现VersionError，必须统一调整并做覆盖升级恢复验证。

## 四、复用同步核，但不要造一个假事务port

`public/shared/sync-v2-client.js`已有持久队列/收件/重试/冲突逻辑，独立storage port的实际方法为：transaction内getMeta/setMeta、getEntity/putEntity/listEntities、listPending/putPending/deletePending、listConflicts/putConflict。事务回调可await存储方法，禁止网络或计时器；必须串行写入、异常回滚、持久commit后才返回。

不能把每个tx方法各发一次普通原生RPC并各自commit，再声称整个`transaction(fn)`原子；也不能把SQLite事务跨不受控的WebMessage/网络等待一直挂起。实现前在以下两条路径中明确选择并验证：

1. 原生Repository拥有事务与命令，移植同步状态机外壳时复用既有协议/行为fixture作为一致性基准；Java不另造冲突/幂等规则。
2. 继续运行共用JS状态机，为SQLite提供受限、可回滚且原子提交的事务port；需实现完整事务执行/提交边界，不能使用若干独立CRUD桥拼接。先用强杀/并发/异常回滚证明，再接编辑器。

现有createIndexedDbSyncStorage可用于隔离原型和对照，不是Android SQLite适配已完成。默认不新增一个保存同一正文的第三权威库。

enqueue的调用方只提交entityType/entityId/command/data或changes；共用客户端自行产生operationId并从可信base形成wire。它会丢弃调用方手填的operationId/baseRevision/deviceId。业务Entry.revision、LocalStore本地revision、同步外壳revision、接收cursor及回看游标必须分开保存；不把本地updatedAt或“同步成功时间”当游标。

已发wire不得改变；新编辑排后续intent。snapshot/pull整页实体与cursor落盘后才推进，push ACK水位不等于已收完其他设备变化。较晚服务器提交成为当前版，另一版只进同实体冲突历史，不造第二篇日记/普通消息/回看来源。正在编辑的输入、光标、IME、编辑开始时基线与脏字段不因远端更新被覆盖或悄悄换基线。

首轮接入有两个源码级门槛：

- `supportedEntityTypes`同时限制enqueue和acceptEntity，不是仅编辑权限。遇未列出的实体会拒绝整页并保持游标，不能过滤掉它再前移；server-owned asset也必须接收。建议完整Repository保真接收opaque全类型/原件关系，只在业务编辑命令另设白名单；未知/暂不能渲染的数据完整保存并只读。
- snapshot结束会对其存储中未被seen的记录置base=null后rebuild。不能先把旧本地资料伪装成可信远端base，再连一个空库。初次需有snapshot staging、来源映射/并库预检与local-only保护；经明确启用后才把待上传本地对象登记为有稳定create intent的实体。测试必须证明空远端和快照中断/恢复不清旧资料，也不未经确认全库上传。

## 五、长日记算法：已有模块与实际未接处

`content-algorithms.js`已原样导入shared rich-document、message-units、legacy-time-segments、diary-paragraph-messages等；`desktop-entry-adapter.js`提供深克隆保留/可编辑能力/合并接缝。当前`currentCanonicalEnabled=false`。源码中的prepareDiaryUnits、reassemble和projectDiaryParagraphMessages实际调用集中在`runContentFixture`测试接缝；编辑器业务save仍合并body后走LocalStore.saveEntry，没有把整篇→units/layout生产流水线及其持久化接齐。

下一步应新增同一业务命令的保真处理，顺序为：

```text
完整Entry原件 + 本次真正dirty字段 + previousUnits/layout + 媒体上下文/时区
  → 共用richdoc/schema检查
  → 保留式整篇修改
  → 在权威模式需要时 prepareDiaryUnits
  → reassemble逐结构核对原body
  → 同事务保存唯一权威aggregate + outbox
  → 回看只读 projectDiaryParagraphMessages
```

未启用canonical的本地篇保持Entry.body权威，不为“分段已打包”自动打开全库canonical。收到messageStore权威篇时先完整持久保留units/layout/原件，能力未补齐继续只读；不能把兼容Entry.body另开可编辑副本。候选ID和派生段落ID都不作为独立可上传正文身份。

时间规则必须直接复用：手打完整日期时间解释、Asia/Shanghai默认/显式IANA时区、contentEditedAt缺失与显式null的差别、媒体insertedAt/occurrenceId、段落+1/+2秒及clamped。同图多次出现保持不同occurrence，字体折行不切段，代码/列表/表格/引用内部结构保持。气泡去时间标记/去段首写作缩进只做展示，不能回存正文。Node/jsdom旧HTML转换不能直接复制到WebView/Java，需后端完整只读reading-document或经另行验证的公共外壳。

实际业务写口也不能混用：完整richdoc Entry走POST/PUT entries，原chat-journal.messages目前仍为text/附件/回复语义，不能把富文档降成plain text塞入text假装无损。sync/v1虽能保存JSON，不因此补齐业务校验或自动驱动朝花夕拾来源。

## 六、朝花夕拾的三个可见入口

当前“应用设置→服务连接”能发现providers/instances，并点实例读取status；页面明确只读，不会新建/绑定。BackendServices内部虽有config/feed/source/comment等白名单请求，但没有create/bind方法，也没有实际聊天投影消费者。打包还明确排除旧shiye-revisit wrapper；TL中既有“过去的我”等演示房不能算正式收件入口。

推荐在现有设置层级中补三处，不另造一套顶层应用导航：

| 入口                                | 用户可做什么                                  | 固定后端接缝                                                                          |
| ----------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------- |
| 应用设置→服务连接                   | 连接/发现、协议区分、认证、实例概览           | health/discover；sync配对/info与业务catalog分清                                       |
| 随想→会话菜单→会话后端/朝花夕拾设置 | 明确选择/创建实例、绑定、规则保存、运行状态   | POST instances、PUT bindings、实例status/config/runner-status；显式运行操作另提供按钮 |
| 实际已绑定会话的消息菜单            | 查看原日记、固定引用/评论、定位来源；日期提示 | instance feed/source/context/comment/withdraw，不用菜单文本重建来源                   |

新增create/bind仍应是原生固定方法，禁止任意URL桥。创建前先把调用方生成的稳定instance UUID与参数保存为待处理intent，重试用相同ID/载荷；绑定使用稳定bindingId、跨端会话UUID/命名空间身份及expectedRevision。创建成功但绑定失败保留实例及重试状态，不反复新建。当前TL裸房间数值、会话标题不能作为跨设备conversationId。

规则页按服务发现的configuration渲染并保留未改字段：daily-random/interval、间隔单位与整数值、dailyTime、时区、实时分类过滤、sourceDateFrom/To双含范围及enabled。空边界转null、缺省不误清。config用实例自己的revision，binding用独立revision；收到ACK后才显示保存成功。08:00/北京时间或旧六个月记录都不能硬编码覆盖用户当前status。

每实例独立保存投递inbox和分页位置，原始页next/total在整页持久应用后推进，再过滤superseded父项；首段replacesDeliveryId复用父消息映射，余段新增，重试按deliveryId幂等。每条显示消息保留instanceId、deliveryId/batchId、SourceRef与原时间/投递时间。旧单例历史和旧固定房保持，不自动归并新实例，也不回放过去时段。

无引用回复使用当前会话最近已收到的历史单条；有引用用被引消息自身的实例与delivery。第一次发送/排队时冻结目标与operationId，重试、新来信、换房或重新绑定都不改目标。只传batchId会变成固定组评论，不能用它冒充单条回复。评论是独立主体，按来源聚合/定位，不再写一份到旧Entry评论里，也不成为下一轮回看来源。

原文入口消费完整只读source/reading-document，不能把气泡Markdown回存成原文。多实例规则、随机选日、续推游标和后台运行仍由业务服务负责，手机不再写一份定时选日算法或上传本机旧游标覆盖服务器。

sync/v1里的serviceConfig/binding实体目前只有通用保存能力；在后端未接实际registry/runner之前，push成功不等于规则已执行。015可先在隔离业务服务完成设置/收件闭环，再由后端明确实现统一服务挂载及配置/评论同步映射；不从独立sync库读取几条合成对象就宣称正式朝花夕拾已接云端。

## 七、实施前必须解决的容量与媒体边界

1. LocalStore允许的richdoc正文上限是2,000,000 UTF-16，而sync当前每操作1MiB、批次4MiB。中文/完整信封可能远大于可同步上限。先协商大aggregate策略或明确暂不能同步并完整保留本地，不能截字、拆成无关联普通记录或假报成功。
2. snapshot的limit1–200是条数，不是响应字节预算。首轮大对象QA先控制页数并验证字节/内存边界，超限不推进cursor；后端需给长文分页/大对象策略，不能默认100篇长文总可塞入一个桥消息。
3. sync watch最多25秒等待，0.12现有12秒读超时不能原样套用；sync专属transport需覆盖长轮询时长并支持生命周期取消/30秒轮询兜底。
4. sync媒体有assetId、uploadId、缺块/断点、默认256KiB与512MiB上限；014收藏为业务mediaId和64MiB、131072字节桥块，LocalStore原生importMedia目前另有20MiB上限。原件hash可用于核验，这些端点/ID/容量/状态不能直接混用；大原件本地完整文件层需先补齐。需要持久`localAssetId↔businessMediaId↔syncAssetId`关系，不将TL document号、blob URL或私有路径塞进同步业务体。
5. 原件任务先本地保存，正文可引用“待上传/待下载”状态，等待asset完成变更后再可用；失败不清body/occurrence。0.14分块桥思想可复用，原来的sticker-upload-finish不能假装已完成sync媒体发布。
6. 新sync JS/业务桥进入APK时纳入精确内容版本与构建校验，复用0.13/0.14的同origin升级缓存教训；不通过清SW/IDB绕过升级验证。

## 八、建议交付顺序与最小验收

| 阶段               | 可直接开始的工作                                                | 完成门槛                                                                                                |
| ------------------ | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 015-A 连接识别     | sync固定transport、配对/私有凭据/info、同库保护，保留旧业务设置 | 真实隔离服务配对/401/换库/epoch/prefix；网络连通与产品可同步状态分开，不自动上传                        |
| 015-B 完整本地信封 | Repository完整Entry/未知字段/独立附件/时钟/映射，隔离副本迁移   | 原件往返、未知格式只读、断网冷启动、写中强杀，旧SQLite/TL库/草稿/原件均保留                             |
| 015-C 单源长文     | 生产命令复用prepare/reassemble/paragraph投影；区分权威开关      | 现有cross-device fixture同输入桌面/WebView逐对象相等，真实编辑重开保持ID/时间/原body；不切正式canonical |
| 015-D 增量闭环     | 内容+outbox、inbox+cursor、不可变wire、媒体任务/冲突呈现        | 丢ACK重试、发送中新编辑、双端离线冲突、远端更新不夺IME、墓碑不复活、原件失败恢复                        |
| 015-E 朝花夕拾     | 上述会话入口、固定create/bind/config、实例收件/原文/评论        | 两实例独立规则/日期/进度、来源失效、段落替换/去重、旧实例引用、重开恢复；先隔离业务服务                 |
| 后续正式接入       | 后端业务/sync桥确认、只读预检、一致备份与受控切换               | 主会话按授权做真实部署/版本/运行回读；不能用候选或联调网页结果替代                                      |

015-A与B的只读/合成准备可并行组织，但没有B的本地事务边界，不开放实际内容push。C不需要再造段落算法；E的配置UI可先做原型，但没真实绑定/收件ACK不显示“已开启”。首批可编辑实体在Repository业务命令中逐类放行；接收端完整保真存储opaque实体，不能误把supportedEntityTypes当仅写权限过滤。不扫描/上传全库所有散落数据。

已有可复用证据：0.10内容fixture/编辑器往返、0.12业务发现99项HTTP、0.14收藏原件136项HTTP、sync-v2隔离存储/客户端/媒体与真机网络联调。它们分别证明相应层，不能互相代替Android Repository、强杀恢复或正式同步。本文只做源码/契约审计，未新增运行测试或安装回执。

## 九、后续会话开工索引

- 当前Android边界：`LocalStore.java`、`BackendServices.java`、`BackendServicesPage.java`、`AndroidStickerServices.java`、`TelegramFrontend.java`、`AppSettings.java`、`backend_network_security.xml`。
- 富文档：`android/app/src/main/assets/editor.js`、`desktop-entry-adapter.js`、`content-algorithms.js`；公共源在public/shared和public/editor，Gradle只拷贝，不在assets副本另改算法。
- 同步核：`public/shared/sync-v2-client.js`及media/media-cache；后端src/server/sync-v2、固定API与身份边界按上述三份主契约。
- 朝花夕拾：[会话服务API](CONVERSATION-SERVICES-API.md)、[长期接入清单](revisit/INTEGRATION-CHECKLIST.md)、[前后端契约](revisit/FRONTEND-BACKEND-CONTRACT.md)。实施时由负责会话更新这些共享入口，本审计不代改。
- 本次唯一产物：`docs/ANDROID-BACKEND-015-HANDOFF.md`。无新增临时文件、后台、设备操作或数据副本。
