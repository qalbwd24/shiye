# 电脑与Android互通：核查后接续

### 同seq feed变化的coverage P1修订

旧source152 manifest `76b7171cd298a380851af44991730747f45637641cd095d1250a6a16b5bffc6c`存在独立真实HTTP反例：legacy程序comment撤回会变feedRevision但不推进sharedSeq，旧evaluate只看历史登记与index而误判当前完整。该旧包禁止用于complete判定，原问题冻结和独立失败日志不替换。

修订后同步`evaluateComputerExportCoverage({db,...})`只作预览；detached/旧db没有私有current-COW proof，永不返回snapshotComplete=true，同时直接比当前global feedRevision。新增同受限actual-loopback/Host/Origin/unlocked admin（任何Bearer/device头拒）的`POST /api/source-collection/coverage`，body仅`{manifest,sourceOperationId}`、32MiB上限；不写库/不登记新种子。它调用`evaluateCurrentComputerExportCoverage`钉原store.getDb当前不可变COW对象，复用collectSharedSeedFeeds/sharedSeedOwnerTransport逐房取完整行、redactions、part字节/hash、roster与manifest descriptor全量严格一致；末getDb若换对象，即使seq没变也409 SOURCE_COVERAGE_BUSY，须新取核验。验证只在一次导出评估执行，不进入每次mutate/index维护。既有source targets/CAS/conflict/asset/真实永久登记门槛全部保留。合法旧seed-register重放仍只证明历史登记，不能取代当前owner/feed证明。

电脑export有显式sourceOperation时只从该原owner固定coverage口取证明，不在CLI把persisted旧JSON当当前证明；普通未指定source操作的export仍可产历史包，但报告不完整。包内Ed25519/库身份不替代该当前完整性核验。真实读/hash期间任何提交发生都要重新核验或明确busy，不能靠caller complete/current标志跳过。

修复从问题152仅覆coverage、computer-export、source-collection三源，冻`outputs/backend-runtimes/20261019-shared-coverage-fix-1792447177016`152文件/422边，manifest SHA`2835995054d7ad0135f757eb659fb0ac400af61904a37e18c06e9d516b7ed29e`。冻结内两项直接场景通过：正常source mapping+签名包完整证明；190000字程序comment实际HTTP撤回同seq后旧包拒完整，兼验comment edit、COW变化busy、detached旧db、旧合法登记重放、sourceReceipt/program config保持。日志`coverage-feed-fix-tests.log`，已交原反例独审，未正式部署/未做3GB/设备操作，不混live新query或message动作。

只读正式auth/writer预检21:58:59Z：无cookie GET access200 enabled=false/unlocked=true、仅stat access.json不存在，未读hash/token/cookie；目前不缺密码输入。原security sessions为内存Map、30分钟滑动，重启不保session；以后若启密码须正常重新解锁，不绕过。旧legacy runner running/waiting、conversation instances0、5 open归篇且到期0；前端未处理File/附件/编辑、上传/导入与其他请求源仍需真实回执证明，maintenanceReady=false。shared identity/signingkey/deviceauth/programauth仅boolean inventory未存在。公开证据`formal-auth-writer-readonly-preflight.json`不含正文/实际IDs/私有路径。该快照不是维护许可，未stop/start/config/正式写。

### 代际完整评估与受控维护工具（候选，尚未正式执行）

`computer-coverage.mjs/evaluateComputerExportCoverage`从真实原owner sourceCollections回执、当前directory/profile/listState/order、preferences、wallpaper、sticker与冲突revision/hash，逐项核signed-v2 manifest实体/原件及原owner永久seed登记。必须显式选择`sourceOperationId`，不读调用者complete布尔；`computer-export export --source-operation <该实际回执UUID>`返回计算报告。`snapshotComplete/completeComputerExport`为指定采集代际已完整映射并打入已登记签名包，`completeSnapshotAt`为该包实际签发时间，`sourceCaptureGeneration`绑定原capture manifest/contentSHA；不是‘此刻WebView仍未变化’的承诺。任何缺回执、target变化、缺原件、manifest/index不一致或缺正式登记均false并给snapshotBlockers。`continuousSyncReady`另列，当前disabled/unlinked房消息端口未接所以false；未来持续端口尚未完成不阻塞一个有完整证据的初始代际包。rendererRestoration仍单列pending，不能以数据已包声称页面已恢复显示。

新`tools/shared-backend-rollout.mjs`默认只允许`check <私有绝对plan.json>`；`backup|switch|rollback`须额外`--execute --approved-plan-sha256 <已独审精确plan SHA>`。它不会创建正式plan、伪造ACK、关闭前端或自动恢复运行器。plan格式`shiye-controlled-shared-rollout/version1`固定action switch|rollback，须包含实际projectRoot/dataDir/stateDir/profileDir/exportsDir/backupDir、pointer/sharedConfig/launcher路径和逐SHA、libraryId/epoch（首次未启用为null）、当前JSON SHA、process{pid,executablePath,commandLine,createdAt}、port、listenHost=127.0.0.1/remoteEnabled=false、1–120秒windowMs、candidate/sameSchemaRollback各manifest+SHA、clientCandidate数据manifest+SHA以及完整backupRoots{name,source}。client manifest必须同时钉住两bundle artifactsSHA；仅登记源码不够。候选与回退均须含同shared/source/signing schema，精确组合source149、修后local-first和knownrefs的新最终freeze仍须另交独审，此脚本不把文件存在自动当审核通过。

plan.evidence为私有`{kind,file,sha256}`列表，每件封套`{version:1,kind,complete:true,observedAt,references:[{file,sha256}],...}`必须对应真实原始ACK/status/观察回执、120秒内且逐SHA未变；这些封套由执行Sol汇集供独审，不是后台通用drain证明。缺一即中止：frontend-saved-stopped要求saveHttpAcknowledged/standardStopAcknowledged=true且visibleUnsaved/pendingFilePreparation/pendingAttachments/pendingEditor明确false（flush空不自动满足）；legacy-runner-stopped与conversation-runners-stopped要求running=false/inFlight=0，后者instanceIds完整覆盖原JSON所有revisit实例；external-writers-paused要求activeWriters=0；uploads-imports-drained要求uploads/importCommits=0。未知/尚未入队File准备或可见编辑未完成必须保原窗口、放弃该轮维护，不要求停止外部一本日记App。

check实时核Win32 API进程路径/命令行/创建时间、已知前端进程为0、API Established连接为0、启动器/指针/共享配置/候选全部SHA、原JSON身份与hash及所有open归篇deadline不跨维护窗口。共享配置必须显式enabled:true/remote:false/listenHost:127.0.0.1/sourceCollection.exportsDir同受限私有根。backup全量复制原dataDir（包括JSON/日志/回执/media/originals/已存在.shared-auth key与SQLite/WAL、.program-auth）、PC profile+window及配置/launcher；拒全部祖先及内层reparse，前后源逐件SHA与目标再核一致，最后才有verified-backup marker。真实未初始化的shared/key/auth只记是否存在，不输出密钥。

switch先再验私有backup markerSHA与全部当前源/备份成员，昂贵校验后重新检查ACK年龄/期限/身份/无连接，才Windows Stop-Process精确旧PID；这不叫优雅SIGTERM。停后JSON/指针再变则不换包保现场。pointer原子改为明确release，子进程显式DIARY_BACKEND_MANIFEST/dataDir/sharedConfig（不继承旧环境指向别包），隐藏启动；健康与真实原JSON library/epoch一致才记录启动。任何阶段失败均中止，不循环重启、不自动退旧无shared包、不恢复旧JSON覆盖新写入。rollback只允许已存在shared原JSON、同schema包，不恢复数据/换identity；灾难恢复另走人工冲突方案。启动回执固定clientsMayResume:false/postInitializationBackupRequired:true：还必须重新停/核已自动恢复runner并在独审条件下私有备份新真实identity/key/auth/日志/回执，未完成前不开放客户端；本脚本不会把初启健康等同维护全部完成。

新152文件/418边冻结`outputs/backend-runtimes/20261019-shared-business-1792446001549`以已审source149为base仅overlay exporter/coverage/rollout工具，manifest SHA`76b7171cd298a380851af44991730747f45637641cd095d1250a6a16b5bffc6c`；冻结内7项（原实际提交4含新coverage正/反例+维护守卫3）通过，日志`outputs/2026-10-19-computer-collection/coverage-rollout-tests.log`，Windows正式stop/start路径未执行，待独审。knownrefs61单源client另冻`data-knownrefs-1792445885744`，manifest SHA`a2e96f9ae2ce07d97b52adb903bc8fd31f84fdca36faa959953fbde1ec02c081`，原61仅shared-seed.js变，22Java不变、两bundle重建已获Sol高分项审批；不能套原61旧bundle。

原source149已获独立分项通过，后续修后local-first第三冻亦已通过。仅从这两个冻结取三个server源（service/directory/entries）组合为149/415 `20261019-shared-composed-1792446215857`，manifest SHA `8082e4ee404d4a170c5bc48e8d2e486f74767223e9298b91f9d2c1fa98093274`；client从已审knownrefs61仅覆第三冻三client为 `data-composed-1792446232119`，manifest SHA `e3eec1e75f44a28bf7e2a0eb11f9a6fcfdb0de96b395075b4f6e3639ff55bf20`，双bundle冻结重建/22Java不变。未读取并行live queryport半段；2个直接整合合成场景通过，日志`composed-source-localfirst-tests.log`，组合闭包另交独审。该组合未混新152评估器/维护工具待审scope，不能当其已审批。PC ui49已由其owner正常升级恢复；本执行器未争用该维护窗，新fresh capture仍须最终组合/维护方案审齐后另协调，不把旧workcopy冒当前。Android G9观察期间本轮仅小合成/代码冻结，没有AVD/3.3GB hash复制/正式维护。


### 持续同步覆盖的已核真实缺口

PC现有`shiye-journal.js`只枚举journal link已配置房；`!link.enabled && !withdrawals.length`直接跳过房登记与消息归档，即使有待撤回，撤回处理后仍以`!link.enabled`跳过普通消息。未配置link的新房同样不枚举。现shared-directory port只登记目录/偏好，未替代这条发送端口；canonical send仍要求显式canonical owner，普通legacy房拒409，已鉴权program的内部例外不得供前端借用。因此本次525条无missing仅证明所采代际，不证明将来关闭自动归篇/新房的消息已全量共享。

最终computer coverage必须同时有source capture及同owner sourceReceipt、当前目录/设置/原件/冲突实际revision/hash/包覆盖证明，并有后续真实端口ACK/水位或可核受控代际一致性；缺持续端口证明不能声称持续同步完整。不得为补缺强开自动归篇、自动迁messageOwner、创建第二业务库，或把未发送pending/草稿当已发。‘消息持久共享’与‘自动归篇’分离的原owner兼容路径需要另一个精确定约切片，本候选不放宽旧早时间/手改/closed保护。

### 同owner采集提交器与耐久回执（候选，未正式写入）

新增固定本机管理口`POST /api/source-collection/apply`，与messages登记同一actual-loopback、Host/Origin、解锁local-admin保护；任何Bearer或设备头都拒绝。body严格为`{libraryId,epoch,operationId,captureRelativePath,captureManifestSha256}`，没有正文/任意目标/完整标志。服务重读整份受限capture并核所有成员SHA，再生成私有WeakMap准备令牌；所有必需server原件均逐件全文size/SHA及图片格式核验，媒体metadata同hash不构成证明。正式提交仍仅原store.mutate队列，重核库身份、原目录/设置/消息/冲突/资源CAS后复用原profile/list/order/preferences/wallpaper/sticker业务函数；任一晚失败整份JSON与增量索引、回执一同回滚。

原JSON新增`sourceCollections={version:1,receipts:[...]}`，永久operationId/digest回执记录source UUID、capture manifest/contentSHA、当前目录/逐房profile/listState revision与hash、偏好revision/hash、原件全文size/SHA、wallpaper/sticker绑定、两条冲突revision/state/hash及各恢复策略。只读复制为`source-collection-receipt`，不复制私有capture正文/原始profile/凭据。重放返回原receipt，不再次覆写用户后续资料；同operation异source/manifest拒绝。此阶段`backendMapped:true`只说明已核业务映射，`computerComplete:false`及renderer pending明确不是最终全电脑完成声明。

CLI `node tools/computer-export.mjs apply`沿register-conflicts相同明确路径参数和本机cookie，先wx持久化私有collection request，核HTTP与原已存在library/epoch一致。只对recipe缺失原件的唯一SHA，用原shared media begin/chunk/complete固定口、≤256KiB流式分块上传，上传op由库/source/SHA/size/mime确定；begin前已全文核capture字节，后核大小/mtime和服务完成SHA。已有精确冲突回执是前置，CLI不隐式替用户选择或新增active消息。最终ACK丢失时沿同私有operation重试，已完成原件和receipt不重复。此CLI从不作为第二writer直接写diary.json。

新窄冻结`outputs/backend-runtimes/20261019-shared-business-1792445229399`以已审144为base，仅本scope九项overlay及新增纯依赖，149文件/410静态边，manifest SHA`633399b4960abd38be666bef6348e4714e37ffe15758a9661bf2a77f5286f50d`；未混并行offline-create的service/directory/entries源码。冻结内11项通过（commit4、recipe3、原conflict4），含4唯一原件真实HTTP上传、下游sticker失败整批回滚、丢ACK后重开重放和再导出/读取签名v2原件；日志`outputs/2026-10-19-computer-collection/source-collection-receipt-tests.log`。已交独审，正式owner/shared启用/真实冲突与资源提交均未执行，完整coverage仍须真实同owner最终回执与可信后续代际核验。

### 源目录/资源/偏好recipe与恢复兼容（候选，未正式提交）

`desktop-collection-recipe.mjs`复用PC原纯directory projector/16键reader及原sanitizer，产出既有`conversation-save/list-state/order`、`client-preferences-save`、`wallpaper-save`及sticker原域的CAS recipe，仅dry-run不写/不造library身份。source raw graph的null-prototype记录只作数据clone；大旧dataURL先按同portable sanitizer分流，原字节/字段/memberSHA单列。原desktop外观对象保其他键，已验证原件映射为`desktop:thoughts.values['shiye-preview-appearance-v1'].wallpaperAssetId`；种子仅对这个已知路径与原sticker.mediaId核原件引用，普通未知prefs字符串不猜资源权限。真正提交还须原owner队列核每原件全文size/SHA及全部CAS，再生成sourceReceipt；metadata同SHA只是待核候选，不能拿recipe标complete。

同scope可选`restoreReceipts:{version:1,values:{'shiye-room-switch-sidebar-v1':<原JSON字符串>,'shiye-switch-timing-v2':'1'}}`只保两项固定PC迁移回执。首项核原previousMode/effectivePreviousMode迁移关系、后项只接受原`1`，原字节保留；它们惰性打包，不在Android应用、不自动执行。PC显式恢复resolver须先核旧迁移语义再原key恢复并复核mode/delay，未接/失败不能称完整恢复。`shiye-room-state-v1`仅私有启动cache，worker rooms/dialogs仍pin/archive权威；`shiye-input-height`旧测试无产品reader不猜转换；`tt-last-activity`从未读取/上传/恢复。每项状态列restorationCoverage，不能只说有rawprofile就算换机恢复。

当前只读真实recipe确认：10房/1待注册、10 profile初始CAS、6列表state初始CAS、9实际portable键；3sticker原稳定ID与name/note同值，缺group保原server默认，不清字段。13个当前房/收藏逻辑原件加1旧global fallback；其中待补6个房资源引用实际只对应4个唯一SHA上传，原global已有匹配media。4未引用wallpaper只私有恢复不猜绑定，0未分类storage。源码测试与实际私有计划均不代替正式target回执；global pointer与restoreReceipts的renderer恢复仍待前端显式接入验收。

### 两条无版本证据源冲突的受控登记契约

显式配置沿`config/shared-backend.local.json`既有入口增加`sourceCollection:{exportsDir:<绝对私有根>}`，仅`enabled:true`可启用；默认关闭，不开LAN。CLI为`node tools/computer-export.mjs register-conflicts --data-dir <原owner> --capture-dir <已审私有capture> --exports-dir <服务配置同根> --plan-file <私有耐久request.json> --server <原owner根URL> [--credential-file <仅本机admin cookie文件>]`。CLI核原已存在library/epoch与HTTP一致，仅向固定本机管理口提交，不接受device/program token；request文件在首次提交前以wx固化operationId与CAS，丢ACK重试沿原请求，不生成新身份。成功仅表示两条冲突保留已登记，不代表电脑全覆盖。

### 原owner受控上线/回退执行方案（待独审，不执行）

复用`tmp/chat-reedit-backend/snapshot.mjs`与`switch-api.ps1`既有保护结构，不能直接运行其旧指针/旧候选/旧PID常量。最终执行另生成本轮只读预检回执和受控脚本，由root协调维护：

1. 独审最终冻结源码/AST闭包及修后签名边界；先有同shared schema的已审安全回退包。核原安装/指针/进程ExecutablePath、CommandLine、CreationDate、真实dataDir与state；记录当前runner状态和待恢复实例，保旧配置/原回执。PC/Android本轮owned UI继续分开，不发正式测试消息。
2. 向PC owner取得维护窗口，标准`desktop-control status→stop`，必须LocalSaveAck及既有用户活动保护通过；未完成File准备/pending不冒称已发送。任何正常保存/stop失败立即保现场停下，不强杀窗口/重载。不停用户外部一本日记写作。
3. 经已解锁本机原API停止legacy回看及全部已运行实例runner并等待running=false/in-flight完成；暂停其他已授权worker写入。旧包无通用drain端点，不能虚构ACK：必须逐个证明实际前端请求源全部保存HTTP ACK、runner.stop已await结束、无已挂上传/导入commit/API连接；核COW当前无已到期idle-open，整个有限维护窗口不跨最近deadline（原timer只有到期open才入写队列）。若有原FIFO只读barrier再取可观测ACK；缺某真实writer路径的排空证据就中止补证，不靠延长固定sleep。随后两次整JSON字节/SHA相同、`.tmp`不存在且客户端已停，核磁盘/commit余量。没有Windows优雅SIGTERM接口，不把稳定快照单独冒称排空证明。
4. 私有稳定备份是集合：diary.json（含shared增量索引/操作回执/source映射）、原件media/originals、导入原档、access配置、`.shared-auth` key/token数据库及journal/WAL相关文件、program授权库、部署配置/冻结指针和原profile已审恢复材料。备份前拒祖先及整树reparse，逐文件size/SHA前后复核；只备份JSON不足。首次无key也明确记不存在，未来迁址必须复制同库同key与所有回执，URL不纳数据身份。
5. 在API进程路径/创建时间、指针SHA、JSON SHA及候选全SHA仍匹配时，才对已排空Windows Node执行核身份Stop-Process；这不是优雅SIGTERM。停后再核稳定备份，对原dataDir选择已审新冻结包并显式`sharedSync:true,remote:false`、原loopback监听，不开防火墙。原store第一次同JSON rename初始化唯一libraryId/epoch/seq基线，绝不在副本生成再冒充原库。启动后只读health/info/snapshot验证能力/身份及全部原业务保持；验签key仅真实register首次原子生成，再立刻纳私有备份集合。
6. 在前端恢复写前，必要受限source登记/CAS按真实原owner排队完成；目录/空房/order、偏好未知便携键、头像/贴纸/壁纸各域、资产全SHA映射、两条冲突/sourceReceipt逐项记录最终revision/hash。coverage只聚合这些真实同owner回执，未读/未映射/并发代际变化明确incomplete，不发布最终success marker。完整seed原owner流式导出并签发后，双端显式信任key、首次离线读写和再联网墓碑/增量/outbox由独立验收；不能用planner complete或全文件copy替代。
7. 仅在健康/业务保持/私有备份核验后标准恢复原ui48与原运行runner，恢复状态按维护前记录；失败保留所有现场/包/指针，不能循环重启。首次shared写入之前如完全未产生新业务，可经核验恢复整集合旧备份；任何shared/签名/业务/回执写入之后，优先前向修复或同shared schema安全包并保同library/epoch/key/日志/回执。禁止退nonshared旧包仍让旧cursor继续服务；若不得不灾难恢复，必须停所有同步参与者、保留当前待发/草稿/恢复材料，由root显式制定epoch重快照/冲突恢复，不能静默回退游标或丢新版日记。

用户明确选择保留两版后再选。本批仅开放显式配置私有exports根的actual-loopback本机管理员`POST /api/source-collection/messages`；沿原Host/Origin及解锁保护，带任何Bearer/设备身份头拒绝，普通paired/program不开放。请求只含`operationId,captureRelativePath,captureManifestSha256,records:[{roomId,messageId,expectedOwnerSha256}]`，最多两条纯文本冲突，不接受sourcePayload/文件绝对路径。server拒源根及全部祖先/成员reparse和路径穿越，核manifest与全部成员全文SHA/roster、link sourceUUID，然后从私有proof品牌中按精确ID取已发送非program/非pending消息，沿原formatter白名单构造源版。媒体暂拒，不猜映射或另建普通asset。

本机原owner当前可见同ID消息及完整ownerFingerprint必须CAS一致；创建独立`sourceMessageConflicts`原JSON域，保限定两版/来源成员SHA/库主版本，绝不新增active消息、改原Entry或混入旧entry/media conflicts。一次有界操作永久回执，同op异文拒绝。复制实体仅`source-message-conflict`只读投影，包可保待核两版，不先实现不安全覆盖。每次原store同JSON提交前，仅对已登记最多两项按精确parent Entry/message检查；撤回/删除/隐藏/父草稿/缺失时持久record与复制投影同事务彻底清掉两版及所有嵌套payload，仅留无正文审计身份/hash。terminal重放不能复活，旧包联网仍先收最新墓碑。生产只能原owner队列提交，不允许CLI另进程直接写diary.json。此段先定契约，源码/隔离测试及正式启用分别交独审。

本轮采集增量回执：已审`bd2b4a8f...`模块仅在此前稳定工作副本重采，不再触正式profile/不重做维护。新66成员113357105字节，manifest SHA256 `ee451e6dbe93dd925d9cbdbc631346b0ccc8a1fc412ee9906708e449814822d6`，完整逐件SHA/roster通过；四本机迁移/旧恢复键私有保留，activity值从未读取。原backup、首份66成员/9098模块及原manifest/locator字段保留，私有locator以独立字段定位新材料。新对账仍525条：示例10、exact复用431、原后继保留3、原程序/评论域复用79、无版本证据冲突2；无真正缺失待历史晚写条目。公开只有数量/hash，材料仍非可直接导入完整业务包。

完整会话投影及离线信任候选已沿[原种子契约](SHARED-SEED-V1.md)补V2 parts与原owner Ed25519两步登记。5项新HTTP/签名专项及原13相关场景通过，日志`outputs/2026-10-19-computer-collection/seed-v2-attestation-tests.log`；已交Sol高独审，不等于正式启用/真实整包已发布。实际full包仍待原owner受控shared上线、目录/资源/偏好CAS与sourceReceipt、2冲突保留登记、双端导入口验签/显式信任及离线可写验收。

## 本轮实际采集与原owner过渡（2026-10-19追加，覆盖下方早期只读阶段）

用户要求补齐思绪日记、随想会话、设置和相关原件，最终打成实际可导入且可接续同库增量的资料包。便签不在范围。一本日记是用户继续写作的外部App，今后通常导出到用户已指定备份下载目录；本轮只提供可靠显式接续接口，不自动重新导入该目录旧备份。用户继续写作不要求停；正式后端维护与写作App分开协调。

`tools/computer-export.mjs capture --data-dir <明确正式data目录> --exports-dir <明确私有state/exports目录>`只读采集原JSON一个稳定文件代际，以及该代际索引内全部media/import原件。每个原件完整流式复制并核对size/SHA，源文件在同一打开句柄的大小/mtime变化、缺件或校验失败均不生成成功marker；不自动生成shared身份、不启服务。成功材料含精确私有`diary.json`、media、originals及capture-manifest，仅为恢复输入，可能包含原本库内的私有运行设置，不得发前端或当shared包。未索引的本机profile、尚未保存的草稿与prepared File/Blob不会被误称已采集。

实际已私有保留3157篇、9个正式登记房、8模板；3137媒体+3原始导入档案共3140文件、3,327,019,485字节全部完整SHA核验。原JSON21,951,871字节，采集SHA`f2744707d1011b196250e832ba7b28646029b14659ca02bf747296fb03590814`。公开仅[计数/SHA/覆盖报告](../outputs/2026-10-19-computer-collection/real-source-capture-summary.json)，不含正文、原件、真实文件ID或凭据。此时正式owner无shared身份，材料`directlyImportable:false/completeComputerExport:false`，不是任务最终完成。

PC worker本机空房/目录pin/archive/order、16键偏好与其它已声明可移植设置、尚未送journal的消息/原件，必须由前端owner固定逻辑快照补齐后再登记原owner；不把原始WebView profile当可跨端导入快照。`replacementMediaIntent`、`localForward`和prepared-edit File/Blob只能作为私有本机pending/retry恢复材料，不能隐式升为已发shared消息或复制源程序/评论署名。已发送消息沿原journal白名单；未发草稿保留本机。

独立data模块`previews/telegram-chat/shiye-desktop-source-capture.js`导出`captureDesktopSource({emit,signal})`，无app/worker依赖，只打开既有journal-link/settings/link和telegram-preview/preview/library；缺库中止升级事务，不创建新source。完整worker record（消息/文档/服务/撤回/pending/draft/未知字段）用私有typed graph保存，BigInt与20位字符串ID保真；二进制单独`media/<SHA>`成员，不能当已登记服务器asset。16个既有偏好键与room-order原raw另存，其他storage仅采key清单、不采值，明确不声称所有设置已齐。

固定sink协议：await emit `member-start{path,size}`、按成员从0开始`member-chunk{path,index,dataBase64}`、`member-end{path,size,sha256}`，最终`complete{summary}`；kind字段分别为这些名字。解码chunk128KiB，单WebMessage JSON小于256KiB。逻辑路径为`logical/library.typed.json`、`logical/link.typed.json`、`logical/preferences.json`、可选`logical/assets.typed.json`及`logical/withdrawal-recovery.typed.json`，二进制仅`media/<64hex>`。按原UI-PREFERENCES资源表完整读取已有assets与recoveries store，同readonly事务保存全部键和值；缺可选库不创建，存在但不可读明确失败。wallpaper/sticker原件及previewBlob、mapping/order和withdrawal恢复正文保持私有；旧全局wallpaper data URL只提取原字节成员并记源字段映射，原localStorage不迁移或改写。usage/viewports补在私有settings中，其余storage仍仅列未采值的key清单。

库/身份/已选设置/资源/恢复记录前后复读hash完全一致才complete；变化、缺库、取消或sink错误无complete。summary不含正文，coverage始终recovery-only/未全机完整。此模块需要独立只读capture host/私有sink实际运行；本轮17项Node定向（含3项真实fake-IDB、8项新来源/采集及6项既有导入相邻）通过并lint通过，真实WebView/私有profile采集仍由root与capture host另验；不能把flush queue误称全部异步File准备和草稿已提交。

受控上线顺序：独立审查并冻结后由root协调维护窗，前端正常保存ACK、运行器排空与标准stop，再取稳定私有备份；原owner切已审shared运行包，原JSON同rename初始化唯一libraryId/epoch/增量基线，保持旧业务/ID/legacy owner。health确认身份与能力后恢复正常服务，再用下方真实固定HTTP导出、seed-register及导入resolve验收。不能在私有副本初始化新身份后冒充正式续同步。回退优先用同shared schema/能力的已审安全包；若退无增量旧包，必须先停shared客户端并明确重建epoch/重快照策略，不能允许旧cursor继续读写并声称无损续同步。本轮执行者未自行重启或部署正式服务。

一本日记显式来源接口沿原`POST /api/import`或流式`POST /api/import-upload`，在首次上传加`X-Import-Source: one-diary`、`X-Import-Source-Id: <固定导出谱系UUID>`；后者随staged job固化，commit不重解释。谱系UUID不能由文件名、标题、行号或当前正文生成。uuid/id是原篇键，沿既有legacy.original映射保留旧电脑Entry ID；同源同内容重放复用，变化版本保留并建立same-identifier冲突，电脑已改/草稿不被覆盖。缺uuid/id的篇明确`unidentifiedEntries`并独立保留，不能按标题/日期/行号合并；一般未指定策略的老导入行为保持。原导入档案/未知原始字段继续保留。这里只完成接口，不批量导入真实旧文件，也不声称自动三方合并已完成。

独立反例修订：原篇身份明确保存`recordType:'uuid'|'id'`及原字符串`recordId`，同一规则先选择有效uuid、仅缺uuid时用id。旧无source记录同样只比较其所选主键；禁止incoming UUID与旧备用id或旧id类型交叉相认，即使标题/时间/正文完全相同也保两篇。旧本轮未含recordType的显式source只按其原original主键类型解释，不猜另一个字段。独立失败脚本保留并已交原例复审。

2026-10-19用户先要求继续采集/持续同步，随后明确先核查既有电脑后端，避免重做已完成能力。本轮先做只读兼容核查，不新增采集生产代码、不部署或安装手机，不干扰「安卓ui」当前候选/5554。

最新明确范围：思绪日记、随想会话、朝花夕拾和未来AI/机器人服务。电脑便签不要求同步，上一轮便签候选保留但不纳入本轮完成门槛。电脑和Android未来共用同一服务器、同一组业务数据、同等读写权限，仅访问出口不同；不能用两个独立业务库或只读迁移profile替代这个目标。

用户已确认会话置顶、归档、手工排列三项都跨端共用。它们应有服务器权威与版本化写入，不能继续只写每台设备独立偏好并宣称互通。设备窗口、DPI/字号/输入法适配和本机撤回恢复材料仍按既有私有契约处理；新增共享字段与本机展示字段分开，未知字段不丢。

已给前端会话送达本轮要求；其回执当前没有额外完整localStorage/IDB逻辑采集器，UI022继续冻结021原生的显式白名单，不因此混入后端候选。后端先复用正式JSON业务写口、领域算法与既有同步传输底座，再明确同一业务库的注册/变更登记和Android桥接；不重写Entry、会话服务、回看或原位编辑算法。

核查事实与逐项矩阵见[兼容核查](COMPUTER-BACKEND-COMPATIBILITY-AUDIT-2026-10-19.md)。未接项不能用“有API”“能新建”“能接收快照”替代验收。现阶段不启用双写、不迁messageOwner、不把新18789库当正式电脑资料；现有只读迁移快照仅作保真输入，不能作为双方日常编辑的数据权限。

核查完成后，本轮继续实现最小共同后端缺口：在既有conversation-services及同一JSON mutate里补共享会话目录、新建幂等、每房置顶/归档CAS与全列表顺序CAS，复用saveConversation与原消息/程序实例。description/idleHours补进既有state响应，未传description保持原值；保存资料保留未知字段。根负责现有route/health及契约，Sol仅新增directory domain/unit与独立HTTP测试，另一Sol只读审查；不改任一端UI、不切正式包、不装手机。新产物`outputs/2026-10-19-shared-conversation-directory`。这一步仍不是完整互通，后续身份映射/本机房注册/双端桥与持续登记按矩阵逐项接通。

该最小后端候选现已完成46个不同Node场景（38业务/相邻＋8实际隔离HTTP）及独立审查，详情[验收](validation/2026-10-19-shared-conversation-directory.md)。源码快照与hash交前端接续，尚未部署，前端当前可继续原候选开发，不把待接功能提前显示为已同步。
# 当前实际执行状态（2026-10-19）

原owner已受控切到独审156 `9e080882...`：原JSON初始化同库shared身份，loopback/shared enabled、remote false；同码marker1安全模式`11708e63...`保留，未退旧nonshared。真实正常保存退出、已审分离FIFO屏障200/closed0/前后业务字节一致、5根4066文件稳定pre-switch与完整postidentity备份均已留私有原证据。原日记/媒体/规则/批次/投递/评论保持，marker1版本初始化；新进程正常autoStart仅单调推进原运行游标。canonical shared配置经expected-absent原子发布，SHA `4bab105874391219d7c0ff5d9190b1cb094f85873c3d450af37da9fb7fbc91d1`，无env默认loader验证同owner并另备份。原运行器已恢复原running/30秒；前端成功保持退出，desktop资源已归还PC owner升级ui50，不声称本会话恢复了ui49。签名key尚待首实际register生成，绝不将缺失称已备份。

本窗口新的ui49稳定profile已从备份另工作copy只读捕获并重对账：577消息/10房/71二进制，482 exact复用、4原后继保护、79原程序域、2无编辑时间证据同ID冲突、10示例私有。实际两冲突已在原owner保双版登记。source apply当前严格拒绝：3个required room-wallpaper的Blob/metadata声明PNG而全文核实字节为JPEG；必要原件上传回执保留，目录/设置/sourceReceipt整事务未提交，没有假complete。最小候选只允许受限source proof内PNG声明→已全文SHA核验JPEG的格式规范：私有brand固定旧metadata/CAS及detectedMime，同原JSON事务规范该原件权威MIME再绑既有wallpaper，保ID/字节/未知字段并记correction审计；全局图片验证不放宽。候选须定向审后才能替换运行源。初始签名full尚未生成；continuous disabled/unlinked房lane及大raw偏好helper另列未就绪。公开维护回执仅数量/布尔/SHA：[actual-maintenance-summary.json](../outputs/2026-10-19-computer-collection/actual-maintenance-summary.json)。

MIME候选已精确以运行156为base只改`desktop-collection-commit.mjs`与`seed-package.mjs`：前者仅known资源规范PNG→JPEG，原件inode/size/mtime/ctime代际和原metadata在commit前再核、后段失败全事务回滚；`targets.originalMimeCorrections`只记录assetId/declaredMime/verifiedMime/size/SHA。后者仅导出资产MIME遵循原权威`type || mime || application/octet-stream`，不新schema、不改原始capture。冻结`20261019-shared-source-mime-1792450987398`，manifest SHA`87cf12665b03f0c17c7c41f3ae34ce72e5032e7dab0e5cf83aaa3df7191ca52f`，156源/436原相对依赖，仅两源不同；冻结树8项定向真实HTTP/签full/原件一致性及相邻通过，包含无type旧mime兼容、非图片类型、错magic/SHA、非known、并发metadata/file、回滚及重放。日志`outputs/2026-10-19-computer-collection/source-mime-frozen-tests.log`；首个测具缺test-only client依赖失败保留，补依赖仅从已审e3ee客户端取且不进runtime。已获Sol高两源独审及真实私有COW预演分项批准，尚未部署，当前正式仍156；PC owner已自行升级ui50，后续API维护必须另协调新状态，不复用上次人工无未确认操作证明。


### 连续appearance已知资源前置读取（独立候选，未启用）

真实既有capture中appearance单key raw UTF8为1,158,568字节，原通用256KiB预算会先拒整个偏好读取。新候选保持原预算，只对desktop:thoughts的shiye-preview-appearance-v1.wallpaper已知dataURL走有界2MiB前置验证；其他键、未知字段、false与稀疏对象继续原reader。纯返回投影删除该已验证dataURL并写wallpaperAssetId，本机localStorage、旧显示图和assets均不写；未知图片、绑定不符或缺实际sourceReceipt明确失败，不静默丢图。

公共data接口为createDesktopPreferenceResourceReader / createDesktopPreferenceResourceResolver；PC数据port新增readDesktopPortablePreferencesWithResources及startDesktopDirectoryPort的preferenceResource:{request,owner:{libraryId,epoch},source:{operationId,captureRelativePath,captureManifestSha256}}可接配置。固定action source-preference-resource-proof映射POST /api/source-collection/preference-resource-proof，仅原actual-loopback/Host/Origin/unlocked local-admin，无Bearer/device授权。请求只带上述source上下文与request:{key,sourceField,rawSha256,rawBytes,sha256,size,mime}，不发raw/dataURL。服务端私有capture brand、真实backend-mapped同库回执、原member及image全文SHA/size/MIME、当前desktop profile相同media pointer与请求结束COW代际必须全部通过；只读不产生业务提交。

响应captureRawSha256是原采集该key字符串UTF8 SHA；sourceMemberSha256是整个preferences成员SHA，两者不混。rawSha256仅回显调用端当前raw指纹并由reader在await后再比本机原串：允许后续普通未知/false参数改变而沿用同一已验证图片，不声称后端看过新raw正文。绑定改变或原件损坏/库代际变化拒绝。已有私有capture只读证据raw SHA a40cd63cda618bc76ed1042191691dadfe2da89d4f903596218289acdb486470，与整成员376760f6d7ff8832bb63bc55983382cbf8bda70ee8454a9f491b4654a60429fa不同；当前正式source apply未成功，actual receipt缺失必须SOURCE_RESOURCE_RECEIPT_REQUIRED。

该候选不混已审87cf或运行156；尚未接PC原生固定transport/renderer显式恢复，不声称连续偏好已正式可用。closed/disabled/unlinked房后续消息lane仍缺，continuousSyncReady=false；该连续缺口与指定fresh采集代际的完整初始包门槛分别报告。下一维护窗口先重比正常stop后的profile roster，变化则另稳定工作副本重新采集/对账，不拿577旧capture覆盖ui50后的偏好。

连续appearance候选独立patch：`outputs/2026-10-19-computer-collection/appearance-resource-1792452129456/patch-manifest.json`，SHA `b5c3832f528d978b2bad1c3415a58d3cf2bc9e74164d1810853f1de27fb6b8e6`；基156精确五源，新增两module，共158源/442边。它是不可被runtime selector选择的patch材料，不混87cf两源。冻结树8数据场景＋2真实HTTP通过，targeted eslint/prettier通过，日志与candidate-evidence同目录；尚未独审/部署/实际前端接线。

当前更新：87cf已在第二个正常保存维护窗受控启用，FIFO 200/closed0/业务字节保持，完整pre/post备份与同库identity核验完成，canonical config仍4bab…；chat/tray保持退出交回PC owner做ui51，本侧不再持有desktop窗口。新profile roster与上一代不同，已仅从新稳定backup另workcopy重新采到588消息/10房/71二进制：493 exact、4后继、79程序域、2双方fingerprint不变的旧冲突复用、10示例私有。actual owner source apply已成功、backendMapped=true；完整签名包仍在生成，未提前声明complete。appearance b5c383…五源另获Sol高第18批分项通过，未部署，不混87cf。

真实首次full已生成并经原owner登记与current feed/COW coverage实核：v2签名包SHA `2f789dcd052fc968959de984f85257993008e4543607d0325cb07e75b6c367c5`，1,837,784,748字节，6404实体、3151全文SHA原件、10房feed594行及10redactions；completeSnapshotAt `2026-10-19T23:31:55.590Z`，fresh source capture manifest `0148028bf91dbf2524789d8da616afe5c928338d35b8c3052772ae5af4c3fe40`。两条无editedAt旧冲突保双版且fingerprint核验复用，原active消息未覆写。首实际签发立即完成真实key/auth、含sourceReceipt及永久导出登记的原JSON、canonical config稳定私有备份并核公钥pin，绝不使用QA身份。文件仅私有exports，公开数量/SHA/coverage见actual-full-export-summary.json。snapshotComplete=true不代表后续PC全房lane已接：continuousSyncReady=false，renderer显式恢复仍pending；没有手机/5554/客户端导入或页面验收。

实际包只读重开验证已完成：容器全文SHA、所有声明成员size/SHA、3151原件关联、Ed25519签名均通过；验证sink只计数不保存可导入handle，不冒称客户端导入。证据full-package-read-verification.json；资产相同SHA可复用同一物理member，logicalOriginalBytes为逐asset验证字节累计，uniqueOriginalBytes另列避免与容器大小混淆。私有final-full-package-handoff.json统一索引维护前后全集合备份、首真实key/auth/身份/登记备份、fresh capture/两冲突指纹、source事务与最终包，不再扩候选。

### 归篇开关完整设置补核（后继包门槛）

首包2f789的密码学/成员/原件校验与历史owner coverage回执保持，但新逐字段核验确认：fresh588十房link.rooms均有明确enabled/category（9true、1false），原projection只取category，十个已签conversation实体均缺enabled和配置存在性。旧coverage未评估该字段，不再据此宣称全部会话设置齐，交付暂hold等待补齐后继包。私有journal-link-package-audit.json逐成员SHA/来源字段留证；journal-link-enrichment-plan.json SHA176da9defe15010602ca99875534fc276b1aba0b551a14aa6fa5a6e4ca6232ad按87cf原conversation-save/CAS仅增clientMetadata.desktop.journalLink={version:1,configured:源配置存在性,enabled:原bool,category:原值}，不带source ACK/runtime字段，不执行原归篇开关、不迁owner。COW验证仅metadata/profile及原registry版本递进，Entry/media/rawroom/程序/绑定保持；原recipe保此remote额外metadata且reuse，无需新部署。当前只计划未正式API写；实际后须新sourceOperation回执、十房逐字段与原proof相等、新签名后继包/同key备份，保首包不改。

### 2026-10-20 全房持续消息接续（隔离候选）

未归篇消息第二冻及受控PC数据runtime采集/调度已成可审闭环，固定chat-ingest-sent不操作归篇enabled、不造Entry，同unit显式绑定/原ledger终态和HLC保留。backend162/453 `64086c07…`、同schema禁新ingest/HLC fallback `f20649dd…`、client70 `b0d914b4…`，均未部署、待独审。原87cf/client66/QA APK不自动兼容新marker/requiredFeatures；只在新launcher候选做真正JSON marker→feature floor，当前正式launcher未改。设置floor已登记但本冻无其业务实现，合包须单一执行者语义合并app/replication/service与feature集合。首冻bound校验扩太宽导致旧例失败，已保原日志并窄修，13核心+原例1过/42相邻复用。PC真实媒体resolver/页面启用仍未接，本次继续独立媒体overlay，continuousSyncReady保持false。准确SHA、证据和未验边界见[验证](validation/2026-10-20-unbound-chat.md)。

### 2026-10-20 持续消息最新候选补正（待独审）

第二冻因独审300→301真实接缝P1继续hold；第三冻在原chat-ingest可选body-free withdrawals内同owner先撤回再后继，端口先撤回batch/outbox/checkpoint再新消息，首次无旧正文只保有证据的null-body链，缺时间不伪造。当前后继client71补默认verified documents resolver，实际shared media分块上传/原UUID复用/断ACK续传，并仅一个Java源增已知chat feature。backend162/453 `ecabbfa1…`与fallback `f0389654…`复用，client71 `344529817ec1e5f07447a8c6d65fe02b3c4ad8efb47723cd5cdb3547b39d415b`；统一 `candidate-1792482750598/handoff.json`。冻结18、native6+原probe30、lint36源0；未独审终验/部署/设备，continuousSyncReady=false。准确范围与失败→新通过见[验证](validation/2026-10-20-unbound-chat.md)，不以旧第二冻或17/18项数量覆盖真实产品启用缺口。

### 2026-10-20 appearance 数据接缝后继（已独审、未部署）

已批准的6a10/b020/1fca组合另出窄后继，语义纳入既审b5五源，保server proof与source路由原字节及e8a导出会话。新main `f2d25859…`、同源码四flagfalse fallback `faf07f20…`、client `08021598…`，167源/483边及72客户端源；原冻结不覆盖。runtime显式可信source resolver同owner，默认后来新图走原media上传耐久收据→mediaUUID→原偏好CAS，不造source完整性。known appearance key/2MiB/图片签名字节+fullSHA-size-type/一般262144预算保持；坏偏好只保留该key旧checkpoint或owner值，不删值，其他偏好与sent继续。当前rawHash只为当前读取绑定，不冒称server见过当前raw；原capture/member/raw收据与新图上传两种证明分别记载。真实588原收据1,158,568B raw及三条隔离HTTP bootstrap链、2纯反例定向通过，native22/Android bundle原SHA及旧19/native6复用。没有新采集/重签/正式HTTP、localStorage/renderer/UI/设备或部署；详见[本轮验证](validation/2026-10-20-composed-appearance.md)。

非作者直接相邻补正后最终client为 `65673563c2891659a4f6069a1d7af1161993564563b7532cd49add30955d1c9d`，统一 `outputs/2026-10-20-composed-appearance/candidate-1792488052384/handoff.json`；main/fallback原f2d/faf字节复用。仅隔离异步directoryPort.ready失败，不吞owner/client/uploadJobs启动失败，另实证目录snapshot throw而既有耐久sent仍HTTP落库。原client080215与其6项冻结验证保留，最终catch另1项通过，合7项直接证据，不称整矩阵重跑。作者索引 `c8106c52…c996` 保留；准确后继已获非作者第17批限定批准，新approved索引SHA `1b4cbbd2…83df32`，原组合current-review-locator已实际指向新handoff及8个非作者证据引用。没有部署/设备或交付许可。
