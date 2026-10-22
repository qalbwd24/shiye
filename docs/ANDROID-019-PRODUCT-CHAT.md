# Android 019 Product chat authority

2026-10-19。根已完成019原生桥集成及隔离Android合成验证；默认QQ仍使用legacy source，尚未切ProductRepository聊天权威。此文将根的真实运行证据与本子任务早期stub编译/JS fixture分开记录。本次文档审计没有安装APK、运行ADB/Gradle/HTTP服务或接触正式库。

## 最新根集成状态（019只读核对）

已按当前源码核对：MainActivity持有ProductUiBridge并在destroy关闭，变更回调进入TelegramFrontend.productChanged；TelegramFrontend通过当前WebMessagePort在h.io调用固定controller，同步结果只回原owner，错误保留ChatException/RepositoryException.code且正文使用固定提示。native-asset-guard019提供window.shiyeProductChat.request，消息层未开放任意HTTP代理。ProductUiBridge.chat dispatch外层使用LocalStore.withProduct，保持同连接串行访问；网络仍在transport独立executor。

根的真实Android合成证据在 `outputs/2026-10-19-android-integration-019/chat/android-native-source.json`，明确`actualAndroid:true,synthetic:true`，5项：native草稿落盘先于ACK、同Repo稳定字符串ID、Markdown原文保留、本地撤回隐藏原文、未配对测试未启网络。它证明真实桥/SQLite纵切，不证明默认QQ已经读写该source，不证明实际旧房迁移、云端往返或所有媒体完成。

新思绪已由根接shared内容prepare＋ProductDiaryStore/同Repository保存：`diary-adapter/android-sqlite-result.json`为14项真实Android SQLite合成结果；`ui-feedback/019-editor-save.json`记录actual native product save等4项实际编辑器检查。保留canonical/未知字段、元数据更新不重建正文等有证据；这不能外推成旧日记全量迁移、完整seed、朝花收件或生产全端同步。早期`bridge-compile.json`仍仅是Main/LocalStore签名stub编译证据，不能升级为完整APK证据。

默认入口当前确实为 `android/qq-chat/install.js:createLegacyChatSource(callbacks)`，没有createProductChatSource导入/装配；尚无根的prepareProductRoom迁移模块。`stage-manifest.json`同时明写`chatWriter:legacy-idb-until-verified-product-cutover`、`diaryWriter:ProductDiaryStore`、`realSeedImport:false`。本轮安全交付应继续保留该明确分工，不能只改一行source工厂就切换真实旧房。

已有入口：服务设置→设备同步与配对→产品数据与朝花夕拾，可检查catalog、显式接收更新、显式同步已准备事务、启用/暂停新消息后台同步、查看库级朝花状态。默认QQ仍legacy，因此“启用新消息后台同步”**不会把默认QQ旧owner的新消息自动转成产品command**。页面已有说明旧随想由原本机消息库保存；后续应在按钮/状态更直接写明仅产品事务，避免用户误以为默认随想已同步。

## 原生接线

`new ProductChatStore(productRepository)` 必须接现有 LocalStore 所有的同一个 SQLite ProductRepository，不另建内容库。构造只在同库增加草稿、操作幂等回执、墓碑坐标三个表。所有方法运行在原生串行存储队列；方法返回在真实事务提交之后。固定桥统一调用 `dispatch(String action, JSONObject payload) throws Exception`，安全错误为 `ChatException.code/getMessage()`，不包含正文或凭据。

| action | payload / result |
|---|---|
| chatSnapshot | `{sourceId?,roomId,title?,limit?}` → 完整消息字段、draft、sourceId、hasOlder、totalMessages；默认末80，当前窗口最大500 |
| chatListRooms | `{}` → `{rooms:[完整conversation envelope],version}` |
| chatSetDraft | `{sourceId?,roomId,text,replyId?,expectedDraftRevision?}` → 持久草稿；缺省reply保持，null取消 |
| chatSendText | `{sourceId?,roomId,clientId,text,replyId?,attachments:[assetId],originalSticker?,messageId?}` → 本地提交回执 |
| chatWithdraw | `{sourceId?,roomId,clientId,messageId}` → 本地墓碑提交回执 |
| chatOperation | `{clientId}` → 已提交原始回执或`{committed:false}`；只读，不重放写入 |
| chatImportLegacyRoom | 下述完整导入对象 → 幂等本地导入回执，不排历史上传 |
| chatQueueOffline | `{limit?:1..100}` → 显式将本模块离线新建消息转固定业务命令；不联网 |

ID 全程字符串，消息1–20位十进制、房间可带负号；sourceId UUID。实体主键严格复用 `productMessageId(sourceId,roomId,id)` / `productConversationId`。不同 source 下相同数字房不混用，未给 source 且存在多个候选时明确拒绝。

本地 send 事务同时写 `putBusinessLocal` 和固定 `sendMessages` command；withdraw 同理固定 `withdrawMessage`。未绑定 libraryId/epoch 时本地 overlay + `chat-deferred019` 映射持久化，绝不编造远程 base；配对本身不自动提升/上传。服务器失败不会撤销已成功本地保存。新发送 sentAt 固定毫秒 ISO，避免服务端归一化后 overlay 永远不匹配。

协调器业务 ACK 使用 `chatStore.receiptHandler()`（传至现有 flushPrepared 的 receipt 参数）。它核对消息ID/withdraw状态，仅 `markBusinessAcknowledged`；真实 pull 的 base 语义匹配后才消 overlay。旧 ACK 不能清除新的 op。原生 Repository 另负责撤回时清旧 pending send 正文及 redacted base；多消息旧批整批取消时其余消息需要显式重建命令，不得伪造 ACK。本模块新建的 send command 每次单消息。

## 旧房保留迁移

source option 为 `prepareProductRoom(roomId,{sourceId,contextVersion}) → Promise<{sourceId?}>`。首次 native snapshot、草稿写入、发送和撤回前等待准备成功；失败返回 `IMPORT_PREPARATION_FAILED`，不会把旧房替换为空产品房。根提供独立迁移 callback，按捕获的房/版本读取旧库完整原件和数据。成功按 source+room 缓存；旧数据继续保留。原生已有已知来源的产品房应直接选其 source，不能凭相同数字房覆盖来源不明记录。

`chatImportLegacyRoom` 输入：

```js
{
  importId: 'stable migration operation id',
  room: {sourceId:'uuid', id:'-10', title:'原名', /* 完整原房未知字段 */},
  messages:[{id:'18446744073709551615', sentAt:'原ISO时间或null',
    text:'原Markdown', replyTo:'可选字符串', attachments:['稳定assetId'],
    /* 完整原消息未知字段；缺text且message是字符串时仅增加text投影 */}],
  draft:{text:'原草稿',replyId:null, /* 原草稿未知字段 */},
  mediaMappings:[{assetId:'stable-id',sha256:'hex64',mime:'image/gif',size:123,name:'原名'}]
}
```

同 importId 不同指纹拒绝；相同记录不改，已有同实体但正文/state不同拒绝并事务回滚。未知字段保留，`_product.refs.origin/conversation/assets` 增补固定关系；撤回墓碑永久清正文，坐标表只保留ID/时间/方向。草稿已有本地revision时不被迁移覆盖。历史导入没有 command，没有自动全库上传。

媒体原件先由根原生导入并实际核验私有字节、SHA、大小，再调用 **非JS dispatch 的** `registerMedia(asset)` 标记可用。迁移 payload 自称 available 不能提高可用性；未验证完整元数据保留在 `chat-media-missing019`，快照显式 mediaPending。原件之后可安全注册，不被不可变的缺失映射阻塞。Blob URL 不作为稳定ID、不写正文。

## source / 原件桥

`createProductChatSource({request?,currentRoom|currentId|roomId,sourceId?,contextVersion?,appearance?,prepareProductRoom?,pollMs?})`。currentRoom可返回`{roomId,sourceId,title}`；contextVersion只随房生命周期变化。根默认提供 `window.shiyeProductChat.request(action,payload)` Promise。

提供 `getSnapshot/getDraft/setDraft/sendText/sendFiles/sendSticker/getMedia/openMedia/withdraw/loadOlder/getContext/subscribe/refresh/flush/setActive/dispose`。getDraft初始ready=false，native返回后ready=true；setDraft立即捕获房和引用，排队写入不因快速切房丢到新房，未ACK自有草稿优先。flush只等待本地草稿与查询不确定提交，不进行云同步。读请求只活动时轻轮询/响应`shiye-product-chat-changed`。发送未知ACK先只读chatOperation确认，不能自动重发；未确认锁住同一发送。

根固定原件RPC：

1. `mediaImportStart({name,mime,size}) → {token}`
2. `mediaImportChunk({token,offset,base64}) → {offset:累计写入字节}`，单块≤131072原字节。
3. `mediaImportComplete({token}) → asset`或`{asset}`，asset含assetId/id、size、sha256、mime/name。必须注册可用元数据。
4. 失败/切房时可调用`mediaImportCancel({token})`，不得删除已经完成的独立原件。
5. `chatMedia({assetId,offset,length≤131072}) → {base64,mime,name,size,sha256,offset,complete}`。

sendFiles/sticker 先完成私有原件导入与整SHA核对，再将stable assetId传固定chatSendText；本地ACK不等云。getMedia核对每块range、总大小、整SHA后才创建Blob URL，inactive/dispose/withdraw时释放。source当前UI原件上限64MiB，保持018交互限额；原生metadata允许服务512MiB但不声称WebView已支持整512MiB。没有任意URL/HTTP动作代理、没有token参数/日志。sticker本地UI标记单独映射，不令服务剥离的扩展字段阻止overlay收敛。

## 验证与边界

- `node tmp/android-integration-019/chat/source-probe.mjs`：23项固定native RPC合成fixture通过；真实File/Blob分块300001字节、整SHA、未知ACK查询不重发、草稿引用/重建/切房、迁移先于snapshot及失败不空房。此fixture不等于真实SQLite或HTTP验收。
- SDK36 Android jar + JBR javac 实际编译当前ProductRepository、ProductChatStore、ProductChatStoreProbe通过；仅source/target8过时警告。
- `tmp/android-integration-019/chat/ProductChatStoreProbe.java` 提供 `run(initializedEmptyRealRepository)`；必须根在独立真实Android SQLite执行，覆盖20位ID/未知字段/导入幂等、离线/提升、ACK不伪base、真实acceptEntity收敛、撤回redact、草稿引用。当前只编译，未运行，不冒称通过。
- 当前snapshot累计窗口上限500，完整历史保存在同库，但超过500的进一步分页尚需固定cursor页接口；本轮不冒称无限历史已实现。
- 首次收到仅墓碑且无任何原消息坐标的远端记录无法从哈希entityId还原room/id；原记录仍在Repository，不能凭猜测归房。已见/迁移过的消息可用同库IDS定位。
- UI安装、真实桥、迁移字节映射、真实SQLite与017服务联调由根隔离验证；本子任务不做设备/生产写入。

产物：`outputs/2026-10-19-android-integration-019/chat/source-probe.json`；测试脚本、SDK类与原生probe在`tmp/android-integration-019/chat/`。

## 019 独立 native controller 增量

`ProductUiBridge(MainActivity) throws Exception`；MainActivity当前`store/io/main`均package-private，未要求放宽访问范围。新增类由根接入口，本子任务不改Main/TelegramFrontend/LocalStore。

- `JSONObject handle(String action,JSONObject payload,WebMessagePort owner) throws Exception`：必须off-main调用。chat固定口交ProductChatStore；五个media固定口交ProductMediaBridge；未知动作由store明确拒绝，不提供任意URL或HTTP代理。
- `chat()`、`media()`给根的固定迁移/原件导入逻辑；`setChangeListener(Runnable)`用于主线程派发`shiye-product-chat-changed`。`cancelOwner(port)`只清该port未完成临时原件；`close()`供Activity生命周期结束。
- `productSyncStatus`返回同库计数、脱敏transport状态、enabled/running/phase/error/lastResult。错误只包含受限code，绝不返回原始网络响应或token。
- `productSyncEnable/Disable`显式同步提交独立本地设置。默认关闭；即使上次启用，构造也不主动联网。Disable取消本次coordinator、原件任务和代际。
- `productSyncRun`显式启动单次网络任务，立刻返回状态。实际网络独占`transport.executor()`，不在h.io/SQLite事务中。按receive→依赖检查/原件上传→flushPrepared→receive运行；大初始快照未收完只留checkpoint，下一次显式继续。启用后新send/withdraw会排此队列，但本地ACK不会因为排队或服务器失败被改成失败。

依赖检查对chat固定origin找同库conversation；远端base存在时不重写旧会话设置，尚无base时用固定chat/room保存完整已知配置。附件只从已注册私有原件读取，上传前重新整SHA核验，mediaBegin返回的missingChunks逐块受限上传，complete核对size/hash。其他实体只允许已知类型，category要求taxonomy已有真实base；不齐时保留pending并阻塞，不能伪称全库seed已完成。评论依赖本轮明确阻塞，朝花夕拾完整UI也未交付。

`ProductMediaBridge`改进：严格canonical base64、owner绑定、最多4个导入、≤131072字节块、64MiB本地导入、落盘fsync及整SHA后发布。原件映射和chat可用映射在**同一个Repository事务**提交；其`registerMedia(Tx,asset)`是仅native内部事务接缝。发布后元数据失败可重试complete；取消不会删除已经发布的原件。

下载文件允许的固定目录只有`files/product019-originals`、原LocalStore的`files/media`、ProductOriginals的`noBackup/product-originals-v1`。`registerDownloaded(metadata,verifiedFile)`仅native调用，重新核验目录/大小/整SHA，再原子注册同库元数据。该接缝不接受JS路径。当前controller未新增自动下载RPC；远端原件尚未准备时明确失败，不能假装图片已可查看。根可使用原ProductOriginals独立队列下载完成后调用此接缝。

根错误序列化须保留`ProductChatStore.ChatException.code`和`ProductRepository.RepositoryException.code`；旧Main.reply仅识别LocalStore异常，若漏code会让source把明确本地拒绝当未知ACK而安全锁定。变更通知应发送到当前QQ宿主，源本身仍有活动轮询兜底。

本增量实际SDK编译包含真实Repository/ChatStore/MediaBridge/UiBridge/Transport/Credentials/Coordinator/Originals；MainActivity和LocalStore只使用最小签名stub以隔离根并行集成，**不等于完整APK构建或真实Android运行**。source的23项fixture在本增量后仍通过。未运行服务/Gradle/ADB，未对正式库执行任何动作。

## 最新协议接入缺口与下一阶段顺序

本次重新读取 `SYNC-FRONTEND-CONTRACT.md`、`PRODUCT-SEED-API.md`、`DESKTOP-ANDROID-CONTENT-CONTRACT.md`、`CONVERSATION-SERVICES-API.md`，以下按真实源码归类，不把后端已完成接口继续列成后端待做。

1. **完成聊天切换的保留迁移与恢复门槛，再启用Product source。** 根需提供prepareProductRoom：读取完整旧房/消息/草稿/引用/原件，核来源sourceId并幂等同库导入；迁移未成功保持旧source可用，不能native空快照替代。加入冷启/强杀、引用、未知ACK、新编辑不被迟到ACK清除、GIF原件、旧房>500消息的实际验证。现500累计窗口会在hasOlder=true后反复得到同一窗口，切默认前应改固定cursor/page或明确禁用加载按钮并显示边界，不能给出假的“更早消息”。未知提交attempt/clientId目前仅source内存，进程重建后锁不保持；正式切换前需持久化待确认UI操作并只读查chatOperation，避免保留草稿在冷启后被当作全新发送。
2. **落实seed本机安装与可靠接续。** 后端seed导出/状态/Range下载/resolve已存在；Android当前transport没有固定seed端点、没有流式.syseed读取/文件选择入口、没有Repository原子importSeed、redactions+包hash幂等+seedCatchUpRequired状态机。先增加这些接缝并以共用fixture验证；USB真实全量导入另按明确任务执行。文件magic/manifest/成员及整包SHA、成员路径白名单、long边界、重复记录、资产引用和完整canonical均须校验；已配对info后seed/resolve核libraryId/epoch/真实checkpoint，在**同一LocalStore事务**安装远端base+redactions、保留并重放本机outbox，失败不推进游标。重启后必须先pull完整稳定watermark，再push；种子不重排成outbox、不替换整SQLite、云端initialize-empty不是手机导入口。本机壁纸不随种子/电脑会话图覆盖，sticker tags未知/可选值保留。
3. **朝花夕拾真实入口与持续同步状态。** 产品18789目前是库级revisit，已有transport/coordinator固定status/feed/context/comment/source；当前UI只status。先做真实feed独立投递sequence、SourceRef完整原文与段落/媒体、冻结单条deliveryId或显式整组batchId、媒体occurrenceId、评论/撤回及原件下载。复用桌面内容/时间/段落共享模块，不能把气泡Markdown回存richdoc。旧日常服务`/api/conversation-services`是另一认证/实例/绑定协议：目前Android发现/实例status只读，不等于产品库多实例已存在；create/bind/config使用各自UUID/revision，收件与评论按instance作用域隔离，不把旧固定房/旧单例重归新实例。持续watch/退避/通知和可解释的媒体/正文独立状态也仍需接。

### 本轮需明确保留的安全门槛

- **审计发现、随后已定向修复：后台同步丢唤醒。** 原startSync在busy时直接return。根后续明确授权后，ProductUiBridge改为实际RunGate：忙时32次并发请求合并为dirty，成功且期间有新请求时只补一轮；失败/blocked清本次dirty并暂停，禁止无限重试。disable/close失效代际，finish到补跑提交之间取消也不能复活；新手动run不能被旧finally清掉。100项/页上限不会因为checkpoint自动无限drain，仍须新请求/用户继续。401/身份错误继续暂停而不清队列。这仍不等于watch/断网自动退避完整调度已交付。
- **同次修复：原生状态不再假idle。** phase现在综合receiveAfterSend.hasMore、flushPrepared.blocked及最终pending；blocked优先，其次checkpoint，完全无余项才idle。当前productSyncRun仍立即返回排队状态，原生页面尚未订阅最终变更/轮询，此UI显示刷新缺口保留给根，不能把初始queued文案当最终结果。
- **默认source切换仍受门控。** 真实5项合成测试并不覆盖旧房迁移。保留legacy默认且同步文案不宣称聊天已上云，可避免本轮将旧房空替换或双写。当前未发现默认旧owner路径被本控制器自动清库/自动全库上传。
- 媒体下载仅有ProductOriginals与registerDownloaded原生接缝，尚无实际自动下载任务/UI；未注册到本机的原件应显式待下载，不渲染成假成功。已存原件与输入不因网络失败删除。
- 对首次仅收到远端墓碑、从未见过原消息的情况，entityId哈希不能还原原房坐标；现IDS只覆盖已见/导入消息。Repository保留墓碑，但source不能猜房。后续seed/pull消息映射应保留有证据的origin侧车。

前段为只读审计；随后根明确授权仅改ProductUiBridge与定向测试/本文修复上面两个调度问题，未改其余生产代码。本次运行 `tmp/android-integration-019/chat/run-ui-gate-probe.ps1`：实际生产嵌套RunGate/resultPhase在JVM执行，19项通过/32并发请求；含成功补跑、失败暂停、代际取消、manual新run、checkpoint/blocked分类。SDK编译真实bridge/业务依赖通过，Activity/LocalStore为签名stub；未声称真实Android/SQLite/网络已重测。回执 `outputs/2026-10-19-android-integration-019/chat/ui-run-gate-probe.json`。没有启动服务/ADB/Gradle，后续由根整包构建与运行把关。
