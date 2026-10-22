# shared-v1 离线初始包与增量接续

2026-10-20 数据后端实际状态：本会话已正式启用固定代际导出 e8a5，持续写入不要求停止；下方“正式87cf/尚待实现”属于此前阶段。准确冻结CLI、同seq撤回保护及实际启用证据见[导出验收](validation/2026-10-20-fixed-generation-export.md)。真实后继83f936快照签名/成员/十房参数已独审，首导尚未完成，deliveryReady仍false。五特性组合仅源码/隔离审批，真实首导QA仅使用已安装旧两特性APK及83f936包；不混淆两者。当前收口与剩余边界见[资料与同步接续汇报](2026-10-20-BACKEND-DATA-PROGRESS.md)。

2026-10-20上述fixed-export+cut接缝已非作者窄复审：main4a97c74d…/fallback1131cad9…准确162源/463边通过，3直接隔离HTTP接缝独立通过，原key/登记/品牌pin/同seq撤回保护保持。详见本轮`manual-cut-export-combined/independent.md/json`；仅私有集成批准，客户端P1/最终同包及部署门槛仍待，当前正式e8a不因此自动取得cut。

2026-10-20 cut直接接缝补充（私有组合，未部署）：固定导出session read的严格白名单只增加`supportedBusinessFeatures`，snapshot/pull/entity/feed/command读必须满足钉住代际的`requiredBusinessFeatures`；不让session token绕过新schema reader门槛。info可先读取能力要求，原件media-read沿旧协议。pin含`_chatJournalBoundaryVersion:1`时完整v2 seed必须包含boundary实体及`chat-journal-manual-cut-v1` requiredFeature；pin后cut和普通提交不重选代际。原pin品牌/TTL/原件/签名/key/永久登记及同seq真实feed规则不改。组合精确SHA/3源语义合并及相邻门槛见`outputs/2026-10-20-chat-followup/manual-cut-export-combined/receipt.md`，待非作者复核，不改变本轮e8a维护范围。

## 2026-10-20 用户确认：正常持续写入时也能完成打包（接续实施门槛）

用户强调消息一直在更新，关键是算法能够把资料打包交给另一端。**不能要求用户停止写消息，也不能为追到“此刻最新”反复作废整个资料包。** 包表示固定已提交代际；导出后新增、编辑、撤回在包内水位之后接续。包有效与当前端仍在更新是两个独立事实，不能把导出后正常变化当成成员缺失。

本轮需核实并补齐：原owner固定真实不可变COW代际，实体/会话feed（包括不增加shared seq的legacy变化）/来源回执/原件映射/签名登记和覆盖评估均绑定同一代际。原件在该代际下按大小与SHA逐块验证；后来原件和消息不纳入本包，也不要求重新复制已经验证的字节。若对外使用导出会话，令牌只能由已鉴权原owner生成，有数量/生命周期和资源边界，不能接受caller提供数据库、current/complete标志或任意路径。会话失效或原件确实缺失须明确失败，不以静默重建身份或循环全量追新掩盖。

原同seq feed撤回完整性保护保持：历史包的feed必须证明属于当时真实钉住的代际，不能仅凭永久seed登记或shared watermark就把后来不同feed判为同内容。历史快照验收与“当前live仍完全一致”分别报告；当前coverage的COW变化busy只可用于即时预览，不得成为允许正常写入的可靠导出的唯一完成条件。实现/独审尚在接续，当前正式87cf没有因此自动获得新会话能力。

PC来源采集时点与业务快照时点分别记录。尚未接持续消息端口时，不声称包后PC本机新增已经进服务器；既有后继包先按其真实采集代际核验，不因后来消息更新重签。最终续传必须证明包后新增、编辑、删除/撤回与媒体能沿原身份接续；若历史日志已压缩，明确走可信全量状态回退并保留本机编辑，不伪称该路径仍是delta。

2026-10-19最新用户要求覆盖下方历史“首次完全离线只能隔离”：PC与手机均为local-first客户端，首次导入也须可完全离线立即读写。实施中的可信路径是原owner持久Ed25519签名、完整包校验及用户显式信任库公钥；不接受调用方`trusted:true`，不把库凭据或私钥装入包。未签旧包继续隔离。此新增能力尚待源码/隔离/双端入口独立审核，不能据本段称正式已启用。

## V2完整会话投影与离线签名（本轮接续）

容器magic仍为`SHIYE-SEED-V1\n`；容器版与manifest版独立。默认完整导出manifest `version:2`，`mode:shared-bootstrap`不变。显式`coreOnly:true`才导出旧v1核心实体包，不称完整会话投影。新读器兼容v1 core及v2已知必需feature；未知feature/非法版本组合拒绝，旧读器必须拒绝v2。

V2含`requiredFeatures:['conversation-feeds-v1']`与`conversationFeeds`。每个活动真实目录房恰有一项`{conversationId,watermark,feedRevision,rosterSha256,rowCount,redactionCount,parts}`；part描述为`{path,size,sha256,rowCount,redactionCount}`，路径复用`entities/<SHA>.json`。part原字节是canonical JSON `{format:'shiye-conversation-feed-part',version:1,conversationId,watermark,feedRevision,messages,redactions}`；messages是原固定feed完整投影（程序、评论及撤回同样保留），非raw revisit/runtime。rosterSHA覆盖canonical `{conversationId,watermark,feedRevision,messages,redactions}`并保持数组次序。通常约900KiB分组，单行加包装仍不得超过64MiB；全部parts计入既有512MiB JSON及成员总界，超界拒绝，不静默截断。

导出逐房使用原`conversation-feed`和固定`feed-item-read`完整取行。shared水位和全局feedRevision须一致；登记重新核钉住COW原feed及所有parts摘要，而非伪造shared索引revision。feedRevision同时覆盖不增shared seq的原程序/评论runtime变化；只sharedSeq相同不足以证明旧投影未变。维持shared增量索引不逐次全库扫描feed。包内投影导入时独立保留；联网首次发布前须追最新feed/墓碑，可信离线签名路径由下段确定初始信任，均不把投影当第二业务owner。

签名包另声明`seed-attestation-ed25519-v1`必需feature。`attestation`固定字段为`{version:1,algorithm:'Ed25519',exportId,issuedAt,publicKeyRawBase64,keyFingerprintSha256,manifestPayloadSha256,signatureBase64}`。公钥为raw32字节，fingerprint为该32字节SHA256。payloadSHA为整个canonical manifest移除顶层attestation后的SHA；签名输入为canonical `{domain:'shiye-shared-seed-attestation-v1',libraryId,epoch,packageId,watermark,manifestPayloadSha256,exportId,keyFingerprintSha256,issuedAt}`。最终manifestSHA包含attestation，避免签名自引用。

两步登记：原owner先核未签意图及真实generation/完整roster/原件/feed，随后同owner队列登记payloadSHA、签名与最终manifestSHA，仅返回公钥/签名/摘要；exporter补attestation并核最终SHA才发布。私钥只在原dataDir下`.shared-auth`独立私有文件持久，不纳入业务JSON、seed、复制实体或前端。客户端先核完整成员/签名，再由用户显式信任fingerprint并持久pin，方可首次完全离线激活；同库不同key不得静默替换。联网须核同libraryId/epoch/key，先接最新删除/撤回/delta后上传原本地耐久outbox。服务地址迁移不换库身份，私有key备份与回退必须同步管理。

2026-10-19，纯数据层源码与合成隔离验证。保存共同 JSON 库的 shared 完整业务实体，不使用旧 Product `_product`／只读 profile 映射。未操作真实电脑整包、未迁移手机现有测试内容、未安装 APK、未启动或切换正式服务。原生文件口另见[原生契约](SHARED-SEED-NATIVE-V1.md)。

## 容器与字段

raw `.syseed` 为 `SHIYE-SEED-V1\n`（14字节）＋4字节大端 manifest 长度＋manifest UTF8＋按 `members` 数组顺序连接的原字节。`format:shiye-shared-seed`、`version:1`、`mode:shared-bootstrap`；旧 `shiye-product-seed` 明确拒绝。没有 NDJSON 单行限制。

| manifest 字段                               | 含义                                                      |
| ------------------------------------------- | --------------------------------------------------------- |
| packageId                                   | 包 UUID，同 ID 异 manifest 拒绝                           |
| libraryId／epoch                            | 已启用 shared owner 的真实 UUID，导出器不创建另一个库身份 |
| snapshotWatermark／watermark                | snapshot 第一页水位／补齐 pull 后水位                     |
| cursor                                      | `{libraryId,epoch,after:watermark}`，自身不是可信证明     |
| complete／createdAt                         | `true`／导出时间                                          |
| entities                                    | `{entityType,entityId,revision,seq,sha256,path}` 数组     |
| assets                                      | `{assetId,sha256,size,mime,name,path}` 数组               |
| members                                     | `{path,sha256,size}` 有序数组                             |
| bytes／entityBytes                          | 成员总字节／实体成员总字节                                |
| entityCount／assetCount                     | 实体／活动 media 原件数量                                 |
| containsCredentials／containsSourceArchives | 均为 false，不打包凭据和原始备份档案                      |

实体只允许 `entities/<成员SHA256>.json`，保留完整 shared 信封、未知普通字段、canonical、历史和状态。原件只允许 `media/<原件SHA256>`；同 SHA 可复用成员，保留每个 assetId 映射。墓碑不得含非空 data／遗留 canonical 正文。已知 Entry、聊天、canonical unit、贴纸、共享及两端独立壁纸引用必须有真实原件。不执行 HTML、配置、程序或恢复正文。

必须区分三个 SHA：entity.sha256 是服务器业务指纹 `SHA256(canonical({state,data,...canonical}))`；成员 SHA 绑定完整 canonical 信封；manifestSha256 绑定整个 canonical manifest。canonical 递归排序对象键、数组保持原序，不能依赖 JS／org.json 字段插入顺序。文件 SHA 则覆盖 framing 与全部成员原字节。

上限：manifest 32MiB、单实体 64MiB、实体 JSON 合计 512MiB、单原件 16GiB、成员合计 64GiB、100000 实体／100000 原件／200000 成员。读范围不超过256KiB，不把原件整体放进 JSON、base64 正文或一个内存 Buffer。JSON 聚合有明确容量边界，不承诺所有设备在上限内无内存压力。

Node ZIP wrapper 仅接受 `data.syseed` 与可选 `coverage.json`，核对中央目录、local header、范围、CRC、压缩方法和解压字节数，不进行一般目录解压。当前支持 ZIP32 STORED／DEFLATE／data descriptor，明确拒绝 ZIP64；大包使用 raw `.syseed`。原生 wrapper 能力见独立契约，不互相冒充实测。

## 可信导出

### 电脑原owner显式CLI（2026-10-19源码接线）

`node tools/computer-export.mjs export --data-dir <明确原owner绝对data目录> --server <明确原owner根URL> --file <私有绝对.syseed路径> --work-dir <私有绝对工作目录> [--credential-file <私有绝对JSON路径>]`复用本节`exportSharedSeed`及原owner固定info/snapshot/pull/entity-read/media-read/seed-register。先只读data内已存在的shared身份并与HTTP libraryId/epoch核对，不一致拒绝。凭据文件仅取token/cookie/deviceId，不允许覆盖URL或传任意path；HTTP仅loopback，远程须HTTPS。未启用shared直接拒绝，不在副本生成身份；分块原件核对身份/size/chunkSHA并由既有导出器核全文SHA，登记成功才发布目标。目标已存在不覆盖。

CLI的seed是原已登记owner当前业务全量，不自行证明PC未登记本机来源已完整；输出`completeComputerExport:false`，完整电脑门槛另由真实来源覆盖清点与前端采集验收。`capture`子命令只是私有恢复材料，绝非该shared种子格式，不能直接导入。正式上线与本机快照缺口见[采集接续](COMPUTER-COLLECTION-CONTINUOUS-SYNC-2026-10-19.md)。

`src/server/shared-sync/seed-package.mjs`：`exportSharedSeed({file,directory,request?,getDb?,openOriginal,register?})`。目标文件和私有工作根必须显式绝对路径。request 为已鉴权固定 transport；getDb 必须取原已启用 owner 的稳定 COW generation，不能在私有副本重新初始化身份后冒充原库。openOriginal 返回每块最多256KiB的字节流，size／SHA不符或原件缺失则不发布。

HTTP 导出默认先 seed-register，成功才发布。只读 owner 导出若需历史接续，显式提供 register(input)，由原 owner／已鉴权端点登记；未登记包只允许当前完整 roster 严格相等，过期后隔离。

`POST /api/shared/v1/seed-register` 与 `seed-resolve` 输入均为 `{libraryId,epoch,manifest,manifestSha256}`；这两个固定口 body 上限34MiB，普通固定口不随之放宽。登记独立核对真实 generation 的水位、完整集合、每实体逻辑指纹／完整成员 SHA，以及实际原件 size／SHA。`_sharedSeedExports` 同一个 JSON 提交仅保存 exportId/packageId/manifestSHA/库身份/水位/rosterDigest，不复制正文、不增加业务 seq。5000项永久登记满额拒绝，不淘汰旧项；重放返回同 exportId。

复制原件期间电脑可继续写。复制后重新采当前元数据，复用已验证的不可变原件、补新媒体；登记前又变更则最多重取四轮后明确报忙。登记开始钉住真实 generation，流式验原件期间允许 COW 新写，登记仍绑定该真实 generation。最终写包再次校验暂存成员；完整同步后以不覆盖方式发布目标文件。不能外推为持续高频写入／16GiB压力已验。

## 导入与原件生命周期

`public/shared/shared-seed.js`：`prepareSharedSeed({manifest,readMember,stageOriginal,signal?})`。readMember(path,offset,length)只能读 manifest 成员。stageOriginal 为 `begin(asset)→token`、`write(token,offset,bytes)`、`finish(token,asset)→持久不透明handle`、`abort(token)`。finish 仍私有，不得替换旧 active original。模块私有 WeakMap 保存校验结果，修改公开 prepared 或传 trusted:true 不能绕过预检。

未签旧包的`client.importSeed(prepared,{resolve:true})`先一次 storage 事务保存隔离实体／原件 handle，保留草稿、Blob、outbox、未知 ACK 恢复件和原 live cursor。隔离实体无 base/local，普通阅读口不可见旧正文。新签名V2包在完整校验、Ed25519验签与用户显式信任库key后允许首次完全离线激活；用户未信任/签名失败时保持隔离，不以联网强制门槛替代新用户需求。具体数据口与持久pin由客户端候选实现并另交独审。

在线 resolve 历史包须匹配永久登记的身份／manifestSHA／rosterDigest／水位。客户端在隔离区从可信包水位 pull，合并最新新增、修改、删除与撤回；追到鉴权的当前水位后，使用 live receive 同一个 accept/rebuild，在一次 IndexedDB 事务发布 inbox、原件索引及 cursor。本地 optimistic 重放、localRevision 与 tombstone final 同规则，不换 owner、不重新发送正文、不清库、较新 cursor 不倒退。

签名登记返回`{registered,exportId,manifestPayloadSha256,manifestSha256,attestation,watermark,info,replayed}`；`manifestSha256`是补签后的最终SHA。相同原未签意图或完全相同已签包可重放同回执；新package caller自带attestation不得创建登记，未登记signed包不得借resolve绕过issuer。`info.seedSigningKey`是`null`（尚未初始化）或`{algorithm:'Ed25519',publicKeyRawBase64,keyFingerprintSha256}`；info只读、不生成key。已有签名回执后key缺失、跨library复用、损坏或fingerprint不符明确拒绝，不静默换key。私有文件先flush再原子link；并发首次初始化读取实际胜者。epoch可沿同library的key，但包签名仍绑定具体epoch。

delta 已压缩则在隔离区转完整 snapshot，再从其第一页水位补 pull，最终仍一次发布；该场景明确全量回退，不声称节省正文。无登记的过期包、未来自报水位、缺 roster、异库／epoch、校验或事务失败均不发布半批。resolveSeed(packageId)可重试隔离包；adoptSeedOriginals(packageId)先鉴权 live receive，仅复用与当前活动 media SHA/size 相同的原件，不发布旧包正文。

事务拥有隔离／活动 handle 后，consume 状态使常见 finally discard/close 不会删除它。失败仅清本次未拥有 stage，不改旧索引；崩溃残留可作 orphan 后续回收，不能把文件 rename 等同 DB 事务成功。Node `openSharedSeedOriginal({directory,handle})` 仅在显式私有根解析自己的生成 handle；包内路径不能成为文件路径。原生 handle 走固定私有文件口，不暴露本机路径。

## 验证边界

### 2026-10-20 三业务schema组合与在线种子读取

已独审但未部署的最终组合为 `outputs/2026-10-20-composed-backend/candidate-1792486638377/handoff.json`（main6a10c80f…b2190/fallbackb0203e34…20160/client1fca9860…c9aaa）。同源floor/reader/seed/client同时识别cut、unbound、settings三项业务feature；seed requiredFeatures可为feed+attestation+三业务共5项，未知/重复仍拒。原e8a固定品牌/COW/原件/签名登记与历史resolve保持，真实12次并发提交及同seq feed撤回均有冻结证据。

在线种子额外闭合原两处漏握手：catchup pull/snapshot及固定conversation-feed command携带编译已知supportedBusinessFeatures。真实五feature已签小容器用默认IDB importFile→resolve→pull→feed通过，保留此前quarantined/SHARED_CLIENT_UPGRADE_REQUIRED原失败。新same-schema fallback保所有新投影读、旧回执与无关写，禁四项新feature写；新marker前须先受控升级稳定server/loader，不能用旧87cf或单cut/unbound包回退。19定向/6 native host及独审第十五批范围见[组合验收](validation/2026-10-20-composed-backend.md)。本组合未装设备/未启产品，旧a793 QA不可导五feature包，83f936两feature真实包及deliveryReady=false边界独立保持。

### 2026-10-20 固定代际本机导出实现候选

私有候选新增 `/api/source-collection/seed-export/{open,read,register,coverage,close}` 五个POST固定口，保持本机已鉴权issuer边界，拒Bearer/device凭据。open仅接原libraryId/epoch及可选已存在sourceOperationId；原owner自己产生opaque随机token并以内存品牌钉住实际COW对象，caller不能传数据库、路径、current/complete或指定历史代际。每owner一个会话、绝对30分钟TTL、retained JSON≤256MiB，到期/关闭/服务结束释放。

read白名单只含info/snapshot/pull/entity-read/feed-item-read/media-read和command内唯一conversation-feed，原分页/分块/成员上限保持。register只从内部品牌读取实际同代际实体/完整feed与真实原件，在原store队列永久签名登记；活库水位可以继续前进。未持品牌的旧seed-register仍按当前原owner严格验证，历史resolve与同seq撤回完整性门槛保持。coverage对pin加该包真实永久登记重建同代际完整覆盖，snapshot有效与currentOwnerAdvanced/currentFeedGenerationChanged单列；登记自身改变COW引用不算业务freshness变化。

电脑CLI参数不变，自动open→固定代际读/复制/登记→coverage→finally close；未具能力的旧server明确失败，原件缺失/损坏或会话过期也明确失败，不自动改追当前或循环重包。token不入包/持久业务JSON，永久exportGeneration仅记录钉住时间、水位与source operation引用。PC本机来源仍受采集时点和持续端口接入边界限制。源码、15项定向及原失败见 [固定代际验收](validation/2026-10-20-fixed-generation-export.md)；精确e8a5已独审并按准确plan959e669/两阶段gate007723受控正式启用，PID32952、原identity/key保持、前后5根4124文件备份及原30秒runner恢复完成，聊天保持停止交还PC owner。实际CLI须用 `outputs/backend-runtimes/20261020-fixed-generation-export-1792482012758/tools/computer-export.mjs` 的同SHA冻结闭包（完整命令见验收），不能把工作区相对旧src入口视作已审算法。87cf实载同schema回退仅涵盖本e8a导出，不借此外推其他新schema候选；既有83f后继包不因本次上线追新重签，QA首导未验所以deliveryReady仍false。

`node --test tests/shared-seed.test.mjs tests/shared-seed-zip.test.mjs`：合成大于2MiB实体的实际 HTTP 导出与可写保存、未知字段、真实 IDB 草稿/outbox/Blob、原件 close 后可读、离线／未来水位／缺 roster、导出后电脑新增和撤回的 delta 接续（不走 snapshot）、复制期间写入、登记落盘／重开重放且 seq 不增、隔离正文不可见、游标压缩的 snapshot 回退、资源损坏、事务回滚、受限 ZIP。压缩通过固定 transport 故障注入，未制造五万条写入凑日志上限。

分项日志和模块 SHA：`outputs/2026-10-19-shared-seed-data`。这是数据层证据，不是工作区全量测试、真实资料整包导入、Android 实机或手机内容迁移。本轮保留手机现有测试资料，没有分类、删除、覆盖、安装或启动设备。
