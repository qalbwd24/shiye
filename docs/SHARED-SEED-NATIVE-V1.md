# Shared seed 原生私有文件口 V1

## 2026-10-20 QA原生构建资源闭包要求

专用资料QA的旧a793 APK已由实际启动日志和独审确证：MainActivity.Icon动态查询`ms_*` drawable，但打包stage只含style/network XML，资源查询得到0后在底部导航崩溃。该问题属于QA打包闭包遗漏，不改变下面的业务接口，不外推正式安卓UI同样有错。

以后冻结此类候选，除Java/DEX/页面资产外，须将实际原生源码动态引用的资源和来源摘要纳入构建输入，并核实际APK资源表所有目标均非0、引用闭包齐全；缺资源构建应明确失败，不能用吞异常或空图掩盖。资源补丁若声明保持原行为，还须核原Manifest/DEX/页面资产、已有资源ID及签名身份的实际差异。host编译、资源表校验和真机/模拟器启动分别报告，不能互相替代。

当前资源修复5380a206候选获第二十三批限定host独审通过；最小5380/upgrade回执执行gate-v2 645c/b382/plan5e26获第二十五批通过，未安装/应用新许可。旧4026/0a33不认新APK，不能独立复用。旧失败、已消费安装预算、83f936已推包回执保持；新增设备动作仍须具体用户预算确认及准确后继许可，不能重放旧安装或推包。准确方案见[接续汇报](2026-10-20-BACKEND-DATA-PROGRESS.md)。

2026-10-19源码候选，业务schema以[shared seed](SHARED-SEED-V1.md)为准。不表示APK、UI或日常服务已启用。这里仅接私有文件数据口，不写Product/SQLite业务库；实体/游标/离线命令仍由公共shared JS同一IndexedDB owner负责。

`ProductUiBridge.prepareSharedSeed(InputStream, expectedSha256, cancellation, progress)`为native调用入口；无WebView文件路径参数。读取器先全部接收至私有generated task，再验证原包SHA（可选外部expected）、固定magic/u32BE manifest长度、UTF8、shared-bootstrap manifest、所有成员长度/SHA、无尾部字节。受限ZIP中央目录在ZipFile建索引前限2项，只许data.syseed及可选coverage.json，明确拒绝路径、重复、目录、非STORED/DEFLATED、坏CRC及超限。Product seed不能进入shared lane，旧Product读取器也未放宽。

返回 `{seedToken,manifest,sha256}`。以下固定data actions经ProductUiBridge转发给SharedSeedBridge，均不接受本机路径：

| action                    | input                                             | output                                               |
| ------------------------- | ------------------------------------------------- | ---------------------------------------------------- |
| sharedSeedReadMember      | seedToken,path,offset,length（1–262144）          | offset,next,bytesBase64,chunkSha256                  |
| sharedSeedClose           | seedToken                                         | closed                                               |
| sharedSeedOriginalBegin   | asset（来自manifest）                             | token                                                |
| sharedSeedOriginalWrite   | token,offset,bytesBase64（解码≤262144）           | next                                                 |
| sharedSeedOriginalFinish  | token,asset（必须原身份/大小/SHA/name/mime/path） | handle                                               |
| sharedSeedOriginalAbort   | token                                             | aborted                                              |
| sharedSeedOriginalRead    | handle,offset,length（1–262144）                  | offset,next,bytesBase64,chunkSha256,size,sha256,done |
| sharedSeedOriginalDiscard | handle                                            | discarded                                            |

JS适配应将base64解码为Uint8Array后交`prepareSharedSeed`，并按原stageOriginal begin/write/finish/abort契约转发。finish返回字符串`shared-seed-original:<UUID>`；调用方将其同其他seed原件元信息保存到公共client事务。native不推断事务已成功，也不自行发布实体或游标。

begin只创建私有.part；write要求严格连续offset并逐块同步文件；finish核验完整大小/SHA，将原件和metadata分别原子rename，再回ACK。完成句柄在新的bridge实例仍能读取。关闭container仅撤销seedToken/删该container；关闭bridge清未完成暂存并保留完成句柄，避免成功JS import之后finally.close删除原件。失败prepare应abort新stage；后续只有明确discard才删除已完成原件。原件read仍返回完整SHA和分块SHA，由公共媒体读取端完整验证。用户没有授权真实picker/UI操作，本轮未把新文件选择流程接入现有界面。

16个固定网络口的服务端桥包括新增feed-item/read、seed-resolve及seed-register。两个固定seed请求上限34MiB，普通请求4MiB/通用响应8MiB保持；种子manifest SHA为递归排序对象键/数组原顺序的canonical UTF8 JSON，不能依赖org.json对象字段顺序。

验证命令：`node android/sync-tests/shared-seed-host.mjs`；`$env:SHIYE_NATIVE_MEDIA='1'; node android/sync-tests/shared-host.mjs`；`./android/sync-tests/verify-shared.ps1`（仅构建，不加Run）。当前文件完整性与生命周期23个host Java断言及真实HTTP60个host Java断言已通过；Android平台Context/SharedPreferences/Looper由host port替代，不能称实际Android、真实WebView或设备验收。无16GiB压力、低磁盘/断电/进程硬杀矩阵。独立Sol高审批另记。

最新native固定动作白名单另含wallpaper-read/wallpaper-save，复用sharedCommand同库CAS。最终host Java真实HTTP62断言证据：outputs/2026-10-19-shared-business-integration/host-auth-3d796216-725e-4e56-a098-395e6ab031b6，逐Java源SHA同目录sources.json；native文件/handle23项最新native-seed-e3bfa8f1-31c4-452f-8e92-e3fd845dd705。Android harness仅编译成功native-shared-20261019T184545873Z；所有生产Java（含ProductUiBridge窄委托）用Android36 API jar及既有R.jar编译成功full-native-compile-5fad2851-a77b-427b-8c54-654c8285d431，不构成APK安装或设备执行。

## 可调用导入data seam（2026-10-19，Sol执行候选）

公开`SharedSeedImport(Context)`供独立资料设置页worker使用，`prepare(InputStream,expectedSha256,cancellation,progress)`回小ticket `{seedToken,packageId,libraryId,epoch,sha256,manifest:{byteLength,sha256}}`；不把完整manifest放外层消息。`handle(action,input)`只转16backend及10file固定口，主线程拒绝。ProductUiBridge另加`prepareSharedSeedTicket`，原Product installer不参与。

新增`sharedSeedManifestRead{seedToken,offset,length}`分页；JS默认128KiB，native上限256KiB。新增`sharedSeedStorageBudget{rawPackageBytes}`→`{estimatedAdditionalBytes:3*raw+128MiB,availableBytes,enough,estimateOnly:true}`，只是raw路径估算，ZIP压缩不能按压缩长度冒充解压空间。10file白名单为storageBudget/manifestRead/readMember/close/originalBegin/Write/Finish/Abort/Read/Discard。

`public/shared/shared-seed-import.js`导出createSharedSeedImportController({client,storage,libraryId,epoch,nativeRequest,onProgress})，实际方法importNativeTicket(ticket,{resolve,signal})、importFile(File,{resolve,expectedSha256,signal})、estimateFile(File)、resume(packageId)、status(packageId)、openOriginal(assetId)、readOriginal(assetId,{offset,length})、copyOriginal(assetId,{sink,signal})。只同库client.importSeed、原件索引读复用active状态/SHA/revision；不从包静默设置启用身份。两runtime.seed已接，原件fallback先本机、无索引才网络。File版仅raw.syseed，原生版受限ZIP沿既有reader；页面必须据imported才称完成，quarantined是待可信联网。

同package同manifest重放已窄修client：只新登记consume prepared；若旧包已存在则discard这轮未被索引拥有的新stage、旧句柄仍保留，避免重复导入3GB产生未引用永久副本。异manifest同package仍拒绝。

## conversation-feeds-v1 下一批（2026-10-19，root定案，实施中）

完整资料包manifest.version=2，requiredFeatures严格['conversation-feeds-v1']，mode仍shared-bootstrap，容器magicSHIYE-SEED-V1保持独立容器版本；新JS/Java兼容v1core和此v2，未知requiredfeature拒。v1仅core目的，不能称完整79程序/评论包。每房conversationFeeds声明conversationId/watermark/feedRevision(64hex)/rosterSha256/rowCount/redactionCount/parts，每part path=entities/SHA.json、size/SHA/counts，通常约1MiB，单row连包装最大64MiB，JSON总512MiB。

part固定{format:shiye-conversation-feed-part,version:1,conversationId,watermark,feedRevision,messages,redactions} canonicalJSON；rosterSHA绑定canonical({conversationId,watermark,feedRevision,messages:全房有序rows,redactions:完整原序})。prepare私有品牌新增feeds数组，仅隔离落库。联网resolve刷新当前全部活动conversation与旧包scope的墓碑，固定feed分页水合守同watermark/feedRevision，不能只靠sharedSeq判legacy runtime未变；原shared-inbox抽纯验证及同txapply，保留generation superseded guard和redaction scrub，与实体/游标/原件最终一次事务发布。数据Sol持schema/prepare/server，此代理持client/native/inboxhelper；新feature源码/独审/实际前端/真实包尚未通过，旧59批能力不扩大。

## signed full 首次离线导入API（2026-10-19，Sol执行新候选）

本节覆盖前文“只能quarantine等在线”的最终产品路径。新full manifest.v2必须两个known requiredFeatures：conversation-feeds-v1、seed-attestation-ed25519-v1；容器magic仍SHIYE-SEED-V1。原owner私钥只server .shared-auth持久，包只publicraw32/指纹/exportId/issuedAt/payloadSHA/Ed25519签名。payloadSHA为canonical(manifest删attestation)，签名context在shared-seed-trust.js导出，绑定库/epoch/package/水位/exportId/指纹/issuedAt。签名不是加密或登录凭据，不能用explicit:true或trusted:true替代验签。旧v1/未签v2仍可验证后隔离，不能离线激活。

两runtime模块均re-export以下独立静态函数，首次无config/无服务URL可直接调用；不构造runtime、不写业务实体、不pin、不把原件拷进IDB：

- inspectSharedSeedFile(file,{signal})：raw.syseed完整framing/manifest/每成员流式SHA及真实Ed25519验证，再回小summary。ZIP用native reader，File口拒一般ZIP。不是只看manifest就声称全包完整。
- inspectSharedSeedNativeTicket(ticket,{nativeRequest,signal})：同样经manifest/member受限分页核完整字节+签名。成功回summary并ticketDisposition:'retained'，token仍归UI；inspect不消费。失败/cancel调用close一次，只有close ACK成功时抛出的原Error附ticketDisposition:'closed'；非UUID附'unowned'且不路由；close失败保原错误code，不伪closed，省略ticketDisposition、附closeFailed:true/cleanupRequired:true，UI可重试仅此token清理。无效/不存在token不能关闭别的任务。UI随后调用importNativeTicket即无条件移交import，UI不重复close；import从合法token开始所有guard处于finally，成功/失败/取消均close。

summary字段：verified:true、bytesVerified:true、libraryId/epoch/packageId/watermark、keyFingerprintSha256、publicKeyRawBase64、exportId、manifestPayloadSha256、manifestSha256。由完整字节校验和真实验签后内部品牌生成；UI只显示/选择，不把summary当绕过下次验证的可信输入。

UI显示身份与key指纹并由用户明确选择“信任此电脑资料库并离线导入”。随后若无同身份runtime，可createSharedRuntime({config:{enabled:true,libraryId:summary.libraryId,epoch:summary.epoch},nativeRequest})临时构造，不start/sync、不先持久config；PC用bootstrapDesktopSharedRuntime同身份模式。constructor/status仅本地读，不要求在线info或服务地址；已有同identity runtime复用，异库不合并/不静默bind。导入调用：

```js
const result = await runtime.seed.importNativeTicket(ticket, {
  signal,
  offlineTrust: { explicit: true, keyFingerprintSha256: verified.keyFingerprintSha256 },
});
// PC File对应runtime.seed.importFile(file,同options)
```

import重新完整prepare/真实验签后，在同一个发布事务核已有pin或显式首次意图，commit pin+active core baseline+首次feed inbox+原件索引+cursor，保留draft/outbox并rebuild已有optimistic本地变更；新空replica立即离线读写，返回{packageId,status:'imported',offline:true,pendingSync:true,feedsPublished}。仅existing pin相同可传offline:true不再重复TOFU；无pin需明确matching指纹，换lib/epoch/key一律拒绝。onTrustRequired(summary)可在完整prepare后辅助提示并返回相同意图，但不能替代首次无config静态inspect入口。

**已初始化库再离线导旧包不覆盖任何当前权威inbox。** 不排序feedRevision hash，不用同watermark证明未撤回。core仍走原revision/tombstone guard，原inbox/known withdrawn/本地草稿/outbox保持，可复用已验证原件。联网按同library/epoch/key核info后先收权威delta与全部当前feed/redactions，再重放durable outbox；未配对或服务离线仅停同步，不重置本地库/稿。更晚PC正文冲突仍按原CAS保留，编辑clock/local ACK另阶段，不用sentAt猜修改时刻。

本地恢复API：runtime.seed.status(packageId)→{packageId,libraryId,epoch,keyFingerprintSha256|null,status:'imported'|'quarantined',pendingSync:boolean,entities,originals}。内部offline-pending-sync对外始终status:'imported',pendingSync:true；不要依赖内部字符串。runtime.seed.trust()→{libraryId,epoch,initialized,pinned,keyFingerprintSha256,publicKeyRawBase64,syncStatus:'offline-pending-sync'|'synced'|null,pendingSyncPackages[]}。config写失败后，同身份重建临时runtime，用status确认imported且库/epoch/key同summary后只重试激活，不重导。pin/publickey不是device token。

第11个file固定动作sharedSeedVerifyAttestation{libraryId,epoch,packageId,watermark,attestation}→{verified:boolean}，严格context、canonical小消息、raw32 SPKI包装后Java Signature Ed25519；仅WebCrypto真实不支持时用native fallback，调用方不能传自选crypto对象伪造私有品牌。普通16backend口保持。Android具体WebView/provider能力须在独立data QA验，host Java实际正反签名与Android36源码编译不等于设备执行。

raw shared-diary-client默认await sync/local optimistic create缺口按root另阶段修；本批离线写自测显式sync:false，只证明durable本地写/重开与随后原API同步，不冒称页面所有保存入口已改本机ACK。PC runtime.start同步错误已回本地offline状态，本地身份/数据不依赖auth/key网络能否匹配。两前端实际picker/激活/renderer和真实3.33GB整包仍待独立验证。

### 2026-10-20 组合schema的种子特性接缝

最终已独审组合 `candidate-1792486638377` 的seed可声明五个已知feature：conversation-feeds-v1、seed-attestation-ed25519-v1、chat-journal-manual-cut-v1、chat-units-unbound-v1、service-settings-projection-v1。SharedSeedFile相对已审a4e2仅扩白名单及数量上限3→5；未知第6、限内未知、重复、缺feed、v1降级仍拒，不能用增加上限接受任意字符串。实际已签五feature小容器经冻结Java host prepare通过；原SharedSeedBridge/旧30生命周期按未改SHA复用，没有构建或安装APK。具体源SHA、six host checks及范围见[组合验收](validation/2026-10-20-composed-backend.md)与独审第十四/十五批。

JS种子在线resolve、catchup pull/snapshot、固定conversation-feed command都携带同编译已知业务集合，并在info/seed/client拒未知要求。实际默认importFile→resolve→pull→feed已通过原rawHTTP/IDB验证；保留原漏握手导致quarantined的失败。旧a793 QA不支持本新五feature包，83f936旧两feature真实包首导仍按原独立许可；host通过不代替设备或产品入口验收。

### 2026-10-20 原生注入入口的固定 module origin（QA私有候选）

Android `evaluateJavascript` 注入的导入入口不可依赖注入脚本的相对 module base。实际5380诊断取得原始TypeError：相对 `/telegram/qq-chat/shared-import-ui.js` 在about:blank/CORS-cross-origin脚本基准无法解析。私有最小后继只把该唯一literal改为既有受信固定源 `https://appassets.androidplatform.net/telegram/qq-chat/shared-import-ui.js`，不取location/配置/用户输入、不扩域或任意路径，不改opener/原catch/业务模块与数据语义。

候选源码/host验证/同证书APK及准确下一次保资料升级提案见 `outputs/2026-10-20-native-import-completion/module-origin-successor-locator.json`。原Java对照DEX精确等于5380；修后仅TelegramFrontend.class和native DEX改变，Manifest/资源/11775资产不变。host固定VM验证旧about:blank拒、新绝对源调用原open一次、load拒仍原Alert；实际WebView修复与完整首导尚未验证。此候选未安装，所有旧预算/失败保持，新安装须用户具体预算及独审后另授权；83f已推包不得重放，deliveryReady=false。
