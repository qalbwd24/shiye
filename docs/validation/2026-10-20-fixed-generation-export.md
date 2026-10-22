# 2026-10-20 真实资料包收尾与固定代际导出

本记录只覆盖资料包与导出数据口；共享协调顶层由 root 维护。前段为只读恢复及私有候选，后段记录 root 协调停写窗口内正式启用 e8a；没有操作设备或直接修改生产 JSON。

## 已存在的后继包

恢复时只读发现暂停报告之后已经落盘的后继包及签名备份，因此没有重放十次 CAS/source apply，也没有另签一份追当前消息。真实候选为 `computer-full-settings.syseed`，SHA `83f936b50b9cf0c4c605f1fb232def3716d5499bc783e500a2dcc5bb104690d3`，1,838,024,686 字节；manifest SHA `a3a7e503b2cbdf4e74f03dec69093a7b02bd416725ef66e2ef7640e40224b215`，水位 6476、签发时间 `2026-10-20T00:07:24.343Z`。原库/epoch/签名 key 保持。6407 实体、3153 原件引用、2952 物理原件、10 房 624 行及 10 redactions。

执行方一遍全容器读取核对全部 9369 成员大小/SHA、实体与 feed canonical JSON、feed roster、已知引用/MIME 及 Ed25519。原 link typed member→精确 plan176da9de→十份 API 回执→source apply→签名备份→包→当前原归篇 metadata 全链一致，configured10、enabled9开1关；这里只保存原值，不改变实际归篇行为。原首包2f789另全文 SHA 保持。

同代际签名备份 receipt SHA `a35e7764b9afc04e334e62add7a16974b4fd7a60a2dde8dc281b0823ae269a25`，业务 JSON、永久登记、source receipt、canonical config 及四份 auth 备份逐 SHA 核过，签名 key 备份与 live 只比较文件 SHA。该材料是签名后 live owner 稳定材料备份，不能称再次停机全库备份。

`producer-verification.json` 保留当时 live freshness=false 的真实四项原因。另以备份实际水位6476/业务 JSON完整重建所有历史 feed，`snapshot-generation-verification.json` 的该代际 snapshotBlockers=[]；后来正常写入不使历史包失效。包与 PC 来源采集时点仍分别受限，不声称包后的全部 PC 本机消息已持续登记。

独立复核已批准这个精确快照产物，见 [恢复独审第二批](2026-10-20-backend-resumption-independent-review.md)。`snapshotArtifactApproved=true`，QA首导未完成，所以 `deliveryReady=false`。私有定位沿 `current-maintenance-locator.json` 的目录以及新增 `successor-package-handoff-20261020.json`；原包保持。

另对原588 capture有界检查：一行存在本机传输 metadata 字段，但 localForward/replacementMediaIntent 无真值；受旧 pending 判别误排的正整数耐久行及备份 owner 实际遗漏均为0。`source-local-metadata-audit.json` 只证明这个既有 capture；旧 predicate 的潜在缺陷交持续消息 owner 收口，未据此重新采集或签包。

## 固定代际导出候选

基正式87cf冻结树，新增本机已鉴权固定口 `/api/source-collection/seed-export/{open,read,register,coverage,close}`。原 Host/Origin/peer/password 门槛保持，Bearer/device 凭据不能成为签发权限。read 仅允许原固定 info/snapshot/pull/entity-read/feed-item-read/media-read；command 唯一允许 conversation-feed。禁止任意命令、路径、调用方 db/current/complete 输入。

open 用实际 store.getDb() 钉一个不可变 COW 对象，以进程内 WeakMap 品牌绑定原 store/身份/来源回执；随机32字节会话 token只在本机传输，不进包或业务 JSON。每owner最多一个活动会话、固定30分钟绝对TTL、retained JSON上限256MiB；到期/关闭/服务结束释放。超过TTL的大导出明确失败，未承诺64GiB上限包必在该期限内完成。

CLI参数接口不变，改为 open→同代际实体/feed/原件→原队列签名登记→同代际覆盖→finally close。原件仍按真实文件大小/分块SHA与全文SHA核验；活库可继续前进，后来消息不混进本包，不重复复制已验原件。登记内部只接受品牌代际，未持有品牌的旧 seed-register 继续严格核当前；历史 resolve 及同seq撤回刷新规则不放宽。持久登记新增的 exportGeneration 仅含钉住时间/水位/source operation引用，不含 token 或第二份业务正文。

coverage 把真实 pin 与该包永久登记组合后重建同代际完整 feed/来源覆盖，分别返回 snapshotWatermark、currentOwnerWatermark、currentOwnerAdvanced、currentFeedGenerationChanged。仅签名登记引起的COW更换不会假报业务已过期。旧server没有能力会明确失败，不静默回到追当前循环。普通本机发送和持续消息端口没有因此接通。

冻结目录 `outputs/2026-10-20-package-completion/candidate-1792482012758`，runtime manifest SHA `e8a5e6d960656b563c391c06a69976fbf918ae0353d6d262e6ccd4ac41c2ef21`；158源/445相对AST依赖。相对87cf仅4改（app、computer-export、seed-package、seed）和2新（seed-generation、seed-export-session）。测试专用capture/fixture单列，不属于正式runtime闭包。精确旧/新源SHA见 `session-candidate.json`。

## 定向验证与失败保留

15项通过（6项新范围＋9项直接相邻），日志 `outputs/2026-10-20-package-completion/session-and-adjacent-tests.log`；7文件定向lint通过。新范围为原87cf导出在每次登记前合法写入时四次catchup失败→新CLI复制/登记两时点都写消息仍单次签发；每个原件仅复制一次；登记本身不假报freshness变化；同shared seq程序撤回保pin feed且resolve仍强制刷新；假品牌/token/容量/TTL/越权命令/路径拒绝；损坏原件明确失败、关闭会话、不登记、不发布。

相邻范围为原固定HTTP导出/未启用shared/私有capture保护、签名持久与丢key/调用方签名拒绝、v2大feed/原程序评论/v1显式core及同seq旧投影不能新登记。没有跑无关全矩阵、实际1.8GB新会话导出、设备或普通前端导入。

首、二次新测试启动因复用夹具的两个未在runtime中的闲置import/依赖而失败，已删闲置import并单列必要测试capture源，原日志保留。第三次实际产品反例发现本机固定route的SHARED错误字符串被transport掩为通用错误，已修受限ASCII错误码透传，第四次原例通过。最后新增quiet freshness相邻断言并统一15项通过；不记作首次全过。无源回写、无正式构建切换、无新实际签包。

精确e8a5已通过 [恢复独审第四批](2026-10-20-backend-resumption-independent-review.md)：158源/445边/6support SHA；独立每read前提交共12次正常写入仍open1/register1、4原件各读1次，pin23/live35、delta和实际Ed25519/原key一致；真实http的Host/Origin/Bearer/device拒绝也通过。只批准导出数据增量，不外推未归篇/离线设置/原生首导或正式上线。

## 受控部署准备（以下为启用前历史）

同e8a5全部158源及manifest原字节另置 canonical launcher 允许目录 `outputs/backend-runtimes/20261020-fixed-generation-export-1792482012758`，SHA完全不变。稳定selectedBackend只读校验加载通过，没有创建server或改pointer。`deployable-runtime-staging.json`。

新增一项直接回退实证：候选实际签发产生exportGeneration登记，仅复制合成JSON/原件/合成签名key给87cf原loader；旧版启动、snapshot和原seed-resolve成功，再在旧版经真实HTTP发普通消息触发COW，永久登记逐字段保持、library/epoch/key保持、历史包resolve与catchup继续正常。没有新持久feature marker，登记不增加业务seq；不含settings或unbound。证据 `rollback-87cf-compatibility.json/log`；不是对其他候选的回退批准。

复用现 `tools/shared-backend-rollout.mjs`/rollout-guard 的准确draft v2已准备。私有plan SHA `45d7e49974c7ebb2f9e97d024cecd8c6b6b0052d3d0307d22c35f219bf9c684b`，定位 `deployment-plan-locator.json`。预备只核精确候选/87cf回退/原client freeze SHA、canonical launcher/pointer/config及reparse边界；07:43实际ui53 ready、两前端进程、后端一连接、无锁，不能用先前LocalSaveAck声称前端已停止或写入已排空。

draft的evidence=[]与backupSHA=null刻意保留，原标准check实际返回 `ROLLOUT_SCOPE_INVALID`，没有执行stop、备份或switch。需root一次协调正常维护窗，重新绑定当前进程/原库SHA/空闲deadline、五类真实fresh保存停止/runner/外部writer/上传导入回执；正常备份五根及核SHA后再check/switch，启动后完成原身份/业务/签名key与后备份，才归还客户端。旧过时回执不复用为当前。本地准备最初draft的候选还位于审核输出目录；v2已改为实际允许的backend-runtimes目录并以canonical loader验证，旧draft和初次guard失败原件保留。

## e8a 正式启用与维护交还

root 与 PC owner 交接正常停写窗口后，仅部署已审 e8a，没有混入 unbound、离线设置、cut 或 UI。原 `07:46:50.0054754Z` form-closed/LocalSaveAck 保留原文件 SHA 与时间；新的观察只证明持续停止，`saveHttpAcknowledged:false`。实际原 close-idle HTTP200/closed0 与前后 library SHA 相同，另作 server FIFO barrier，未伪称每条本机 outbox 的发送回执。

旧 ba151 工具曾两次在停止 API 前拒绝：第一次 fresh120 已过期；第二次昂贵的 source+backup 全量重哈希耗尽 fresh120。保留 `switch-guard-refusals.json`，两次均未停旧进程或改指针。随后在明确授权及独审下增加极窄两阶段接缝：真实只读完整 SHA 校验后保留五分钟进程内 WeakMap brand；审批后核同scope、所有成员/fileid/ctime/mtime/size/reparse/realpath，任何变化拒绝且不偷偷退回长哈希。原 fresh120/CIM/FIFO/JSON/pointer 和 stop/spawn/health 代码保持。4项定向及独立同size改字节后恢复mtime的反例均拒绝；旧无proof路径也以合成独占服务验证。

本次精确维护入口为 `tmp/package-completion-20261020/maintenance/run-prepared-session.mjs`（SHA `deead20becaeea2b64c2730477ad8cf883fea3e681a1810899d3dbf6a6aaf503`），gate manifest `tmp/package-completion-20261020/maintenance/gate-v2/maintenance-manifest.json`（SHA `0077239c6718c3304ac354d90168bb4aac89af64869025b260353b849d783492`）。必须传准确 `--reviewed-gate-sha256`；先完整prepare，再新seal送独审，获准确planSHA批准后只向同进程 stdin 送一次 `approvedPlanSha256`。wrapper 先核 literal c7b90c6d…及其 helper26e848…再dynamic import。此入口钉本次 e8a/87cf，不可把其他候选自动套用。下一轮沿此顺序定向复用，不能误回旧工具的“审批后重哈希”顺序，也未覆盖并行根工具。

实际批准与执行 plan SHA `959e669b118f8015d7dc5a6041968f4be03b924cfda33df755df863ea265b7b9`。正式已由87cf切到原字节 e8a5，API PID32952，shared=true、sameBusinessStore=true、loopback/remote=false；library/epoch/签名key及canonical launcher/shared config保持。原 UI53 始终停止，无锁，最终 processes=[]；窗口已交 root/PC owner，未启动聊天。

5根/4124文件前备份 manifest SHA `5ec00766751feb58fbd32f982dc6a36258a124263f1f27823965d86e8722c538`，后备份 SHA `b6d1a103c1a50298fb8e6f9be70b7fbe387b30ee1138f7b9f8bad75d1c968e23`。保护域逐字段核过；启动正常运行器只把 revisit.cursor 从07:55:59.999Z续到08:20:59.999Z，config/batches/deliveries/comments/randomDays及全部其他顶层字段（含_sharedSync/sourceCollections/永久seed登记）保持。首轮严格全JSON相等因此失败，原失败单列，未写成首次全过。新原owner实际 session open→info→close 通过且不登记/签包，读前后JSON SHA不变；sourceSessionCache能力1保持，未声称跨进程保留内存缓存。后备份时新runner已停止，完成后按真实原回执恢复30秒runner。总回执 `outputs/2026-10-20-package-completion/maintenance-completion.json` 与 active-maintenance-locator 的私有原件。

## 当前可用的打包 CLI

实际打包须使用与正式API同e8a5冻结闭包的入口 `D:\拾页\outputs\backend-runtimes\20261020-fixed-generation-export-1792482012758\tools\computer-export.mjs`，CLI SHA `a452a87e654b6998dc2c2d998cd00d29c730dbfbdea54155b841b69889cd24b4`。已重新核全部158冻结文件、真实import闭包和无IO参数拒绝；`deployed-cli-verification.json`。工作区 `tools/computer-export.mjs` 仍相对导入工作区src，不能把它当本次已审固定代际入口；未CAS覆盖并行源码。

需要下一份包时可从 PowerShell 用下列命令；本轮没有再次执行1.8GB导出或追新签包。若密码页已开启，沿原 `--credential-file` 私有cookie凭据；不使用device/Bearer。`--source-operation` 可选指定原owner已存在 backend-mapped receipt，不从调用方声明完整覆盖。

```powershell
$exports = 'F:\<正式目录>\var\exports'
$stem = Join-Path $exports ('seed-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
& 'D:\软件\Apps\NodeJS\node-v24.18.1-win-x64\node.exe' 'D:\拾页\outputs\backend-runtimes\20261020-fixed-generation-export-1792482012758\tools\computer-export.mjs' export --data-dir 'F:\<正式目录>\data' --server 'http://127.0.0.1:18765' --file "$stem.syseed" --work-dir "$stem-members"
```

API健康能力应有 `sharedBusiness.seed.fixedGenerationExport.version=1`；首个有效固定代际无需因新消息重打，包后消息仍按固定水位增量。既有83f后继快照的签名批准保持，设备QA首导未验，deliveryReady继续false；此次API启用不等于持续消息或手机互通已完成。
