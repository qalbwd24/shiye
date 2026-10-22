# 2026-10-20 设置、持续消息、cut、固定代际导出与appearance组合

最新精确源码与数据 runtime 候选已获 [独审第十七批](2026-10-20-backend-resumption-independent-review.md) 限定通过，未部署、未安装或操作设备，没有更新 PC UI。稳定入口 `outputs/2026-10-20-composed-backend/current-review-locator.json` 已实际回读核对，指向 `outputs/2026-10-20-composed-appearance/candidate-1792488052384/handoff.json` 及其 `review-index-approved.json`，附独审报告逐文件SHA。原第十五批6a10/b020/1fca和全部旧冻结、旧索引不覆盖，作为已批准基线保留。这不是设备首导、正式维护或完整互通批准。

| 产物 | 精确 manifest SHA256 | 冻结范围 |
| --- | --- | --- |
| backend `outputs/backend-runtimes/20261020-composed-appearance-1792487877920` | `f2d25859c2717f8afebaf1825530bfd97833e8896a5d64dccd5e1ad51af08904` | 167源、483相对依赖 |
| 同schema fallback `20261020-composed-appearance-fallback-1792487877920` | `faf07f20e1c68f94c13ba12699e0760ea8a0d2bb1a314cbdb63dd0189f0b714e` | 相同167源；四个写开关为false |
| client `outputs/2026-10-20-composed-appearance/candidate-1792488052384/client` | `65673563c2891659a4f6069a1d7af1161993564563b7532cd49add30955d1c9d` | 72源、100内部依赖、22 Java |

Android bundle保持 `57975267a8043f948dd1ab20312bbf2447268f3fc83f89a59e6b8a7817398c0c`；最新PC bundle `361696291a3f39320e44aeebd62b3a1dd42b310f0befd008271b726c3d15a49a`。第十五批原19项冻结、23项作者源码lint及native6/旧30按未变源码SHA复用；新增appearance仅6个直接场景与最终目录失败隔离1项，6源lint零诊断。非作者逐167/167/72源、AST、双bundle重建，以及实际旧图588、新图上传/CAS、坏资源/目录失败仍独立sent写HTTP均通过。准确增量与原失败见[appearance验证](2026-10-20-composed-appearance.md)。

## 输入与语义组合

在新私有 `tmp/shared-backend-composed-20261020` 工作，保留所有旧冻结字节。输入为正式 e8a5 固定代际导出、已审 cut+e8a `4a97c74d…/1131cad9…`、unbound第三冻 `ecabbfa1…/f0389654…`、已审媒体/native client71 `34452981…`，以及离线设置最终 `11c5bcd4…/9153421f…`。app、replication、service、seed-package、seed 及相邻 reader 接缝逐语义合并，不整文件覆盖另一功能；source-map、冲突决策和各输入 manifest 均在候选中保留。

原 source cache、来源采集/source receipt、原件校验、同owner/COW/写队列、Ed25519 key、永久seed登记、旧操作回执和公开源鉴权实现保持。原 `auth.mjs`、`seed-attestation.mjs`、source plan/conflicts、library commit 与 source-session-cache 模块 SHA 在基线 review 索引单列验证；最新source-collection只接已审b5固定资源证明读口，和server proof均精确复用b5字节。未把新 PC cut 或尚未纳入的多组广播再实现一遍。

## 设置投影 P1 与兼容回退

旧87cf/117会把新 catalog/legacy service 投影置 deleted 的原反例仍保留。组合后第一次升级由原owner COW事务补齐 `service-settings-catalog:library` 与 `service:legacy-revisit`，持久 `_serviceSettingsProjectionVersion:1`；失败不能ready，重开幂等，不换library/epoch/key/旧回执。既有本地同槽/多槽、可信父回执、双 revision CAS、旧ACK不遮新实体及迟到刷新保护均沿原设置候选。

新 floor、info/reader、seed 与 client 同时识别三项业务功能：`chat-journal-manual-cut-v1`、`chat-units-unbound-v1`、`service-settings-projection-v1`。通用加载器从真实 dataDir 根结构读取 marker；未知版本、有实际结构却缺 marker、manifest 缺对应功能均拒。正文里的相同字符串不能伪造 marker。非作者分别对每个 marker 遍历真实旧manifest，避免首个错误掩盖其余门槛。

新 fallback 使用与 main 完全相同的 flatten/reader/投影源码，manifest 将 `manualCutWrites`、`chatIngestWrites`、`messageEditWrites`、`serviceSettingsWrites` 全置false。原已提交设置回执可重放；新设置 save/local、legacy config/archive、实例创建/参数、binding 以及 shared service-request(config) 都拒绝写入。原读取与普通会话创建仍可用。实际新加载器→fallback→HTTP→普通COW后，原设置/service/boundary/chat-message实体逐行保持 active 及原值，entries/media/revisit/messageStore/sourceCollections/exports/edits、key/library/epoch保持。

**新marker落库前必须先受控升级稳定 `server.mjs` / `src/server/runtime-release.mjs`，并绑定准确同schema fallback。** 不能只改指针而沿旧稳定入口漏传写开关，旧87cf/117/f038/1131均不能回退该组合库。以后维护前重读实际指针、marker、PC窗口与正常保存状态，不能复用此次 e8a 维护计划或宣称已有新维护授权。

## cut、持续消息与种子接缝

保留原已审 cut 实现及边界实体。source port 仅接实际耐久行的有效 `shiyeSegmentId/sendOperationId` UUID对，传到受控 `segmentId/sendOperationId`；拒半对/坏UUID，不上传本机重试字段。unbound rawCompatibility 保这两个元数据，语义正文比较不把它们当正文变更，已有分段/发送身份相冲突仍拒绝；旧归篇raw及正文hash不因采集新增元数据被重写。

原cut之后晚到的 unbound 消息经同unit归篇，HLC后继沿原根/时间/引用与原segment。已脱离Entry的后继归篇补原segment；无segment旧发送仍沿既有当前段规则，raw不伪造分段字段。原300撤回→301后继、默认 verified documents resolver、断ACK/UUID/原件规则按已有源码证据复用并核直接相邻。

固定代际会话仍为原owner私有品牌/一会话/绝对30分钟/原件校验/原队列签名；真实12次并发提交时 open1/register1/4原件各读1次，pin25/live37。含cut的固定包在每read继续写、登记前又cut仍保pin边界；同seq真实程序feed撤回继续要求resolve刷新，当前freshness不使历史签包失效。没有重新签发1.8GB真实包追新消息。

签名seed现在可需要五项特性：feed、attestation及上述三业务功能。SharedSeedFile相对已审a4e2只改白名单与3→5数量上限；实际签名五feature小容器 Java prepare、未知第6、限内未知、重复、缺feed及v1降级六项host检查通过，旧生命周期代码未改。旧a793 QA APK不能导本新五feature包；83f936旧两feature真实包任务独立，未借此授权新APK或设备操作。

## 原失败与最终验证边界

保留中间 `candidate-1792486035849`：旧配置口可绕过设置禁写，所以90a/918e不作为最终候选。第二冻 `candidate-1792486396196` 的6a10/b020后端沿用，但d1b1/c966 client也不作为最终客户端：真实五feature种子在线首导时，旧 catchup pull/snapshot 和固定feed command漏 `supportedBusinessFeatures`，停留quarantined、`SHARED_CLIENT_UPGRADE_REQUIRED`。最终只补这两处固定读握手；用未自动加字段的raw HTTP，真实IDB importFile默认resolve→pull→feed成功，settings catalog/boundary/unbound三投影可读。

另保留组合时 media-read误加能力字段而被严格原件读形状拒绝的产品失败，修为原media形状；源UUID、测试now参数、允许的普通会话新增room期望及legacy观察源闭包属于已定位测具边界，未改写为首次全过。

最终14个core与5个adjacent均从最终冻结源执行。6项host与原30按准确Java SHA复用。client71中的旧 `shiye-journal.js` c4fdd…仍只是未改integrationObservedOnly来源，一条外部边明确不在两个bundle中，不能把它当整套PC UI可直接部署。未验实际产品调度、手机主页/完整互通、设备首导或新正式维护，`continuousSyncReady=false`、原83f快照的 `deliveryReady=false`边界保持。

第十五批基线审查索引为 `review-1792486638377/review-index-v2.json`，SHA `a9ed4d9bbdde83467872f4edcb11d59eb3180623ffa4235c2e34a4f6f429bf45`。原索引中 `sameCodeFallbackWithFourFlags:false` 为摘要字段误写，v2明确纠正为相同源码、四flag全false，保原索引及SHA，不改任何产品冻结字节。最新第十七批准入索引另为 `outputs/2026-10-20-composed-appearance/candidate-1792488052384/review-index-approved.json`，SHA `1b4cbbd22c9d0ea561cc3fbab8fdcee1a8aec8d74185ea706c8e2b934583df32`；稳定current locator已指向该入口，SHA `98ca9b53ba527ed2a0501ed83e1e2bd4b9b8b834202027b5083a82633034b9a0`，原locator字节另存新候选的 `previous-composed-current-review-locator.json`。本次只更新交接索引，不改任何产品冻结。
