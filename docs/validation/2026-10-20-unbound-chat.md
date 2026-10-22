# 持续全房消息：未归篇单元候选

本切片由暂停点 `tmp/unbound-chat-candidate/checkpoint.json` 接续，基线为正式 backend156 `87cf12665…` 与 client66 `ddc740ab…`。只修改私有候选与本文对应契约；未切生产指针、未写生产 JSON、未启动模拟器或安装手机。独立终审待回执，`continuousSyncReady` 仍为 false。

## 当前交审组合：源撤回后继修复及媒体/native接缝

统一入口：`outputs/2026-10-20-unbound-chat/candidate-1792482750598/handoff.json`。后端及回退复用第三冻，不再复制出同源码新运行包：

| 范围 | manifest SHA-256 |
| --- | --- |
| 后端162源/453边，`outputs/backend-runtimes/20261020-chat-unbound-1792482257216` | `ecabbfa12976da716774819d1c96553bcbd4884c533e74609c364894cb457421` |
| 同schema fallback，`outputs/backend-runtimes/20261020-chat-unbound-fallback-1792482257216` | `f03896547e97af7662cf8f6e9501c4fe7aca74f4509002bb4407eced040c8547` |
| client71/22Java，`candidate-1792482750598/client` | `344529817ec1e5f07447a8c6d65fe02b3c4ad8efb47723cd5cdb3547b39d415b` |

独审新P1原例为：旧300已同步，本机durable撤回后新301带 `replacementOf/root300`；旧端口仅跳过撤回记录，server300仍active、新301拒绝，outbox阻塞。旧第二冻不能发布。修复在 `tmp/unbound-chat-media-candidate`：固定 `chat-ingest-sent` 新增可选 `withdrawals`，同原owner事务先调用原 `withdrawChatMessage` 再收新消息。端口读取持久withdrawn/outbox并剥本机forward元数据，同shared IDB先提交撤回批次/checkpoint，再提交后继批次，不另立业务ledger。

首次采集若旧正文已不存在，完整durable撤回时间与替代链仅能建立同ID的null-body tombstone；绝不造旧正文/隐藏Entry。旧简化marker若没有时间，只可从真实已有message/withdrawal原记录取时间，无见证时明确409、整事务回滚。HLC显式root终态会抑制迟到新后继正文；普通legacy单条撤回仍只处理该message，不伪称root终态。第三冻已经[独审第五批](2026-10-20-backend-resumption-independent-review.md)按精确ecabb/f038/6005通过：原非作者300→301脚本及首次缺前驱/纯withdraw/重启等直接相邻重新执行，300withdrawn/301active/pending[]，原失败保留。最终344529客户端新增media/native尚待下一批独审，不外推第五批批准。

实际媒体接缝已接到runtime：显式 `enableSentMessages:true` 从原IDB只读source锚（不调用可能初始化的 `journal.sourceId()`），自动使用 `createDesktopSentMediaResolver`。同durable worker snapshot读取已成功整数消息所指documents，严格size、完整SHA、mime、name验证，复用原 `createSharedMediaClient` begin/chunk/complete、server原.stage及同库media。稳定操作ID由library/epoch/source/document/fullSHA/metadata派生，existing original按原owner完整校验后复用其UUID；共享localCache只保存已验证receipt，没有新媒体队列或业务库。pending File/failed rows不读原件；真实产品仍未开启该选项。

Native仅基精确client66修改 `SharedSeedFile.java` 的feature whitelist/数量上限为三，其他21Java同SHA。该源 `43d29751652793e7e7f4d4bf1cbf93e5a404ac97569c00b1d24612d13ccc43ea → a4e2e59236416808a6d0d216429d44acf01ff6c89b9c043136b31e0593d5af16`；已知三feature可进入native reader，未知/重复/第四feature、漏feed或v1降级仍拒。普通APK和旧QA APK仍未因此更新。

证据：冻结树18项 `media-native-frozen-core.log`（含15原核心、真实bootstrap默认resolver、PNG图文原SHA/size/type、既有UUID复用、600003字节丢chunk/complete ACK同op续传）；源撤回原独审作者重放 `independent-original-author-replay-fixed.log`；36文件lint0为 `media-lint-corrected.log`。同一真实signed fixture SHA在旧native失败、新native六断言通过，未改的原host probe30断言通过，详见 `native-feature/{sources.json,chat-summary.json,existing-summary.json,old-native-rejected-known-feature.log}`。这是host Java/合成同源IDB与真实隔离HTTP，不是Android设备、真实PC资料或长时大库验收。

媒体中间 `candidate-1792482725592` 仅为一处 `!=` 的未收尾风格稿，保留不交付；最终71源候选已改成显式undefined/null判断。第二冻与以下旧描述只为过程证据，不替代当前组合与独审门槛。

## 第二次冻结（历史候选，因源撤回接缝缺失暂停发布）

统一入口：`outputs/2026-10-20-unbound-chat/candidate-1792481836707/handoff.json`。

| 范围 | 路径 | manifest SHA-256 |
| --- | --- | --- |
| 后端162源、453相对依赖边 | `outputs/backend-runtimes/20261020-chat-unbound-1792481836707` | `64086c0721aa43662a114cd33f9d834bbc171504a89508d4727025b75bedd21c` |
| 同源码禁新ingest/HLC回退 | `outputs/backend-runtimes/20261020-chat-unbound-fallback-1792481836707` | `f20649ddaf023d879f9376bfcf7ce1409a61a008cc554a4d6134309d6997e226` |
| 客户端70源、原22 Java不变、两bundle | `outputs/2026-10-20-unbound-chat/candidate-1792481836707/client` | `b0d914b45b26582581d57d332739b605156a6c4f396207566e49fe631a9a71d4` |

本包仅实现 `chat-units-unbound-v1`。稳定 launcher 候选另识别 `_serviceSettingsProjectionVersion:1 → service-settings-projection-v1` 的结构化功能门槛，但本运行包不含设置投影实现，也不声明该功能，故拒在该设置schema库启动。合包须由一个执行者语义合并 app/replication/service 及功能集合，不能文件覆盖。

## 行为与边界

原 JSON 的 `messageStore.units` 保存未归篇本人已发送消息，`origin.entryId:null`，身份仍为原 `chatUnitId(sourceId,roomId,messageId)`。不建隐藏 Entry，不另建业务库，不变更归篇开关。图文格式沿原formatter/canonical unit，原件须先由真实大小/SHA及原owner媒体元数据验证。以后原 `journal-send` 显式归篇将同unit及完整已撤回前驱链原子绑定到真实 Entry，不重建身份或复制邻篇。

撤回、原时后继、引用、HLC、程序作者保护继续使用原withdrawal和 `_messageEdits`。终态回执及旧签名seed重放不能恢复正文。新业务数据进入的同事务持久 `_chatMessageUnitsVersion:1`；旧bound chat单位保持原validator兼容，只对新null-entry chat强制完整UUID/十进制坐标。

共享command/snapshot/pull、entity/feed分块读及seed握手检查 reader `supportedBusinessFeatures`。新客户端收info/页/ACK先拒未知 `requiredBusinessFeatures`，新seed明确要求chat功能；旧client66 validator实证拒该新seed。旧87cf真实manifest不能经新launcher打开带marker库。launcher解析真正JSON根marker，不在正文搜字符串；未知marker版本或无marker但含null-entry chat均拒。回退只禁新ingest/HLC写，保读与其他正常写口，不宣称整库只读。

PC数据runtime导出 `readDesktopSentMessages/createDesktopSentMessagePort/startDesktopSentMessagePort`；`bootstrapDesktopSharedRuntime` 在显式 `sentMessageReadOptions` 或 `readSentMessages` 下启用广播/轮询调度，提供 `captureSentMessages()`。广播只触发重读已持久worker库，payload不作为正文。原sourceId只读不初始化，全部真实房不受link enabled/category过滤；消息和checkpoint在同shared IDB事务进入原outbox，再走固定 `chat-ingest-sent`。pending/failed/草稿/程序/演示排除；成功整数转发/重新编辑可保本机重试元数据，采集白名单保正文并剥这些字段。

**本冻媒体resolver仍须由调用方提供**，尚未实际接通真实worker documents上传；独立后续媒体overlay正在复用既有shared media/jobs补齐。未接PC产品启动/页面，未验真实浏览器多窗口长期采集、完整真实图库/大库或设备，不据合成fixture声称持续互通已启用。

## 定向证据与保留失败

- 冻结树13项：`outputs/2026-10-20-unbound-chat/final-core.log`。涵盖关闭/无分类房、不改Entry、同op/异文冲突/整批回滚、真实媒体字节变化拒绝、重启、HLC双后继→真实归篇→再编辑/终态、离线连续编辑→同步、旧seed终态重放、旧manifest/旧reader/未知feature拒绝、fallback保读/其他写、调度与停止、成功转发及replacement字段剥离。
- 直接邻近43项首冻42过/1失败，保留 `frozen-adjacent.log`。失败为把新坐标校验错误扩到旧bound chat；第二冻只收窄此条件，原失败精确复跑1过：`validator-original-fixed.log`。其余42项SHA/scope未受这项放宽影响，复用证据而不重跑；fixture SHA见 `adjacent-fixture-manifest.json`。
- 最初reader门槛补齐后，注册wire未随seed whitelist更新，2项出口失败，保留 `core-after-reader-gate.log`；修复后8项 `core-reader-gate-fixed.log`，后续13项覆盖该链。
- 首冻结工具未声明经过manifest校验的动态选包import而拒，保留 `freeze-first.log`。新工具只允许 `runtime-release.mjs` 精确 `pathToFileURL(path.join(directory, manifest.entry)).href` 动态表达式，并逐SHA验证选定manifest，不放开任意动态依赖。
- 35个受影响源码/fixture/工具的定向lint零错误：`lint-final.log`。两bundle从冻结source实际重建，manifest登记实际SHA；普通APK和旧QA APK没有因此自动兼容。

首冻 `candidate-1792481738034` 保留但因旧bound validator反例不可发布；第二冻仍待独立审核，不作部署许可。
