# 共同业务主链独立需求审批

2026-10-19，独立 Sol 高测试审批代理。结论针对所审源码与隔离样本，不授权部署，不代替设备或日常页面验收。实现者自验 99/99 与相邻 72/72 是参考证据，不能代替本报告的独立需求判断。当前首轮结论：**不通过**。已确认四处 P1 数据/身份/传输缺陷；修复后须独立复审。

本代理已读项目维护、工作区、开发交接、实时协调、TESTING-POLICY，以及电脑实际能力矩阵、shared/v1、Android runtime、共享目录、会话消息/程序、Product seed 与前后端隔离契约。审查基准是同服、同业务 owner、同等读写及完整持续资料，而非模块数量。未修改任何生产代码、前端冻结文件、手机/5554或正式库/服务。

## 需求验收矩阵（首轮）

| 需求 | 独立判断 | 当前证据/阻塞 | 负责范围 |
| --- | --- | --- | --- |
| 复用成熟 PC JSON 业务 owner、同 ID、不重写编辑算法 | 限定通过 | service 固定动作复用原路由与 storage；独立重跑原 API→shared→原 API、真实库文件重开、丢 ACK、异库拒绝等 4 项 HTTP 通过；真实生产兼容只复用已注明的私有副本证据 | 后端 |
| 业务/增量/最小回执同次提交，未知字段/原件身份保留 | 限定通过 | 读 commit/service/replication；独立重跑核心 HTTP、IDB 原子 checkpoint、媒体相关 11 项通过；不冒称完整真实媒体扫描 | 后端/公共 client |
| 日记双方编辑、远端并发不静默覆盖 | **P1 不通过** | 远端新版本已收到后 localRevision 仍 0，旧编辑 save 自动使用最新 base.revision，覆盖远端而未冲突 | 公共 client |
| 草稿/普通消息 outbox、丢 ACK 重开恢复 | 范围复用，未全面批准 | 已有普通本人消息测试与公共 client 回执设计可复用；本轮独立 IDB 测试只补关键反例；不能据此推断所有朝花/评论收件持久化 | 公共 client/data source |
| 朝花来信、固定评论/目标离线收件重开保持 | **P1 不通过** | 真实 HTTP 11 条 history，IDB close/reopen 后离线为 0；history 仅内存保存 | 数据 source/公共收件层 |
| 程序/未来机器人消息身份、署名/方向保持 | **P1 不通过** | AI actor 原接口发信，source actor.kind=ai 却 outgoing=true；canonical chat: 身份被展示为内部数字 1。统一 owner 的发送仍显式拒绝，不得称完全同权可用 | 数据 source |
| 合法大聊天/评论收件经过真实 native response cap | **P1 不通过** | 20条各500000字符普通消息，shared conversation-feed 返回10010212字节，超过8MiB native上限；snapshot分块不能覆盖此query口 | 共享固定读口/后端分页 |
| 空房/目录、pin/archive/order 共同 owner 与多 slot 参数 | 已有隔离证据，尚未端到端批准 | 候选固定数据口存在，需 PC 实际 bootstrap/持续收件端口与 Android023 合并；日常 PC 未激活 | 后端端口与前端分别完成 |
| 完整 PC 资料打包、原件、受限解压导入 shared 可写库 | **未完成阻塞** | 旧 Product .syseed/ZIP 不进入同一个 shared owner；不能据其通过批准本轮全资料迁移。实现者已继续补新 shared seed 路径，待独立反例审查 | 后端/公共 client/native 固定口 |
| PC 持续目录登记、远端普通消息收件 | **未完成阻塞** | 仅可调用 directory data port；日常 bootstrap/远端消息消费尚未接。实现者继续补无可见页面的固定 data port | PC 后端接线 |
| 所有设置/程序/日记页面实际编辑、冲突与恢复入口 | 未验/前端接续 | Android runtime 已暴露数据口，完整页面仍由「安卓ui」023合并；后端不可争用其 renderer/MainActivity/editor 等文件。不把缺页面误写成后端无接口，也不把接口当页面完成 | 独立前端会话 |
| 023最新追加每会话共享壁纸图/独立开关与独立显示参数 | 待契约/未批准 | 最新开发交接要求默认同步图，可关闭为各端独立图，重新同步保留独立资源；旧sanitizer排除wallpaper/roomBackgrounds的device-local规则不足。须和023定义assetId、开关、CAS/ACK，位置/缩放/遮罩各端独立 | 跨端接口与前端分别完成 |
| 不同网络出口同库权限、Bearer/库身份隔离 | 隔离证据可复用，真实网络未验 | 本地真实 HTTP Bearer 已有证据；真实远程 HTTPS、多出口/设备最终运行未验 | 后端/部署 |
| 后台升级不循环安装 APK、前后端分离 | 当前边界符合 | 固定协议与配置选择，候选未部署；本轮不安装手机、不控制5554。最终13口仅编译，早期29 Android与49 host Java不同范围不能相加冒称最终 APK 通过 | 构建/后续发布 |
| 正式实际启用 | **尚未启用** | 独立只读 config/backend-runtime.local.json 仍 chat-reedit2；shared-backend.local.json 不存在。未做正式服务控制或写入 | 后续明确发布 |

## 首轮确定缺陷与最小复现

测试脚本 `tmp/shared-business-independent-review/independent-cases.mjs` 使用每例独立 UUID tmp 数据目录、127.0.0.1 port 0、真实 HTTP server 与 fake-indexeddb 的实际 IDB transaction/close/reopen API。所有正文为人工合成。运行 `node --test tmp/shared-business-independent-review/independent-cases.mjs`，首轮 **0/3（3个需求断言失败）**。失败日志为 `outputs/2026-10-19-shared-business-independent-review/initial-independent-cases.log`；源码 SHA 为同目录 `initial-review-source-hashes.json`。这些是发现缺陷的反例，不能称“已验收通过”。

### P1：已收到的远端修改绕过旧编辑版本保护

位置：`public/shared/shared-business-client.js` 的 accept（首轮315–335），`public/shared/shared-diary-client.js` 的 save（首轮68–94）。accept 替换 base 不递增 localRevision；save 重新读取当前 record 后拿其当前 base.data.revision 组装旧编辑 wire。

触发：原 API 建立 revision1 → shared diary.read 留住 localRevision0 → 原 API 改标题至 revision2 → client.sync → localRevision 仍0 → diary.save(id,旧草稿,0) 成功。预期应拒绝旧编辑，保留草稿让用户明确重新读取/合并；实际使用 revision2 继续写，旧标题覆盖新标题。首轮日志同时列出 openedBusinessRevision1/receivedBusinessRevision2 与两个 localRevision0。

### P1：朝花收件只存内存，离线重开消失

位置：`android/qq-chat/shared-source.js` 的 refresh/localSnapshot（首轮242、282–348）；`src/server/shared-sync/replication.mjs` 的 flatten 只发布 service 配置而非投递收件。refresh 中 history 只进入进程内 cache Map，唯一 writeCache 是 messageRevisions。

触发：合成朝花实例由真实 HTTP tick 产生11条history，source.refresh显示11条 → dispose → IDB close/reopen（原事务库保留）→断网→新 source.refresh。实际 history 为0。服务端原投递没有丢失，但已收件本机无法离线查看/保留固定目标，不满足持久 inbox。应把完整规范收件/固定目标与红action存入独立同房持久事务，并验证分页与重开。

### P1：程序消息被当本人且 canonical 身份丢失

位置：`android/qq-chat/shared-source.js` project（首轮151–180，outgoing:true），refresh（首轮308过滤普通 kind:'message' feed，只使用归篇消息投影）。

触发：通过原 state 口明确建立 conversation-services-v1 owner（没有迁移任何旧房），登记 AI actor，原 conversation send 写入一条 AI 普通消息。服务器返回 messageId `chat:<hash>`；source snapshot 返回内部数字 id `1`、actor.kind `ai`、outgoing `true`。方向应由 actor 判定；canonical稳定消息/引用身份应保留，不应借内部号替代。source 对统一 owner 的发送显式 UNIFIED_OWNER_ADAPTER_REQUIRED 属未实现能力，不能掩盖读投影错误。

### P1：聊天query分页未受native响应字节上限保护

位置：`src/server/shared-sync/service.mjs` execute将conversation-feed原响应直接返回；`src/server/conversation-services/conversations.mjs` conversationFeed仅按条数limit分页；`android/qq-chat/shared-source.js` refresh固定请求limit100。新snapshot/pull的descriptor与900KiB分页并未覆盖query响应。

独立追加第4例：合法旧归篇包含20条、每条500000字符（chat-journal原验证上限）→真实shared command conversation-feed(limit100)返回10010212字节，超过SharedBackendTransport 8MiB response cap。单独命令 `node --test --test-name-pattern='native response cap' tmp/shared-business-independent-review/independent-cases.mjs`，需求断言失败。错误阻止source取得消息revision，撤回依赖revision，因此不能把它只当展示吞吐问题。修复需有字节分页/固定可复现的降页策略，并考虑单条canonical body和redactions额外字节。不是16GiB压力或全量设备测试。

## 独立正向复核与边界

独立实际执行 `tests/shared-business-http.test.mjs`、`tests/shared-media-http.test.mjs`、`tests/shared-client-cache-commit.test.mjs`，**11/11**，日志 `outputs/2026-10-19-shared-business-independent-review/selected-existing-http-idb.log`。涵盖同owner往返、重启/丢ACK/异库与旧revision拒绝、多slot/目录、原件SHA/断点/缺旧原件不虚假ACK、IDB checkpoint/outbox/projection原子与回滚。它们通过并未发现上述三个漏测场景，因此不能取代逐项需求审查。

审查未启动AVD/ADB、未安装APK、未读取公开产物中的真实日记正文/凭据。真实资料副本3156篇/3132媒体与冻结包121文件等信息只作为实现者证据复用；本代理没有将其说成完整媒体、全部页面或正式多出口互通验收。完成修复与新seed/PC接线后在本报告追加独立复审，保留首轮失败。

## 分项独立复审：stale editor（修复后）

实现者在accept真正base升版时递增可见编辑token，第一次baseline仍为0，保持既有调用契约。独立再次执行原始反例已通过（0→1、旧token明确拒绝），日志 `recheck-stale-editor.log`；另独立实际执行 `tests/shared-editor-generation.test.mjs` 3/3，日志 `recheck-editor-generation.log`。该组覆盖元数据同正文更新、无变化重复读取不失效、两个本地并发save只一个入队，以及晚ACK保留更新的本机乐观副本/草稿与前命令回执。

最终版另为setDeleted增加可选options.expectedLocalRevision，旧确认页面须传该token，先读与enqueue同事务双层guard；省略保持旧fresh-read语义。独立读源码并复跑最终4/4（增加canonical/history/unknown/state与equal/older replay）通过，日志 `recheck-editor-generation-final.log`，源码SHA在 `recheck-editor-source-hashes.json`。

仅原stale editor缺陷分项通过，旧页面是否实际带guard仍属前端合并验收；不自动批准其它P1或总体双端互通。首轮失败不删除，当前冻结运行包亦未因工作区修复自动更新/部署。

## 分项独立复审：history持久收件（修复后）

新增公共shared-inbox以每个canonical消息单独实体保存，meta只存同房消息ID/发布代际。source先读完所有页后一次replaceInbox事务发布，旧generation不能覆盖新收件，缺失旧消息擦除正文。审读实现后独立执行：

- 原真实HTTP+IDB反例扩展为11条history+1条固定目标comment，重开离线保持完整canonical ID/固定commentTarget，并能离线回复原history排队。注入第2页网络故障，第一部分伪变更不发布。通过，日志 `recheck-history-http-idb.log`。
- 独立新脚本 `tmp/shared-business-independent-review/independent-inbox-boundaries.mjs` 2/2：100条总量超过2MiB正常逐实体持久/重开；旧代际拒绝；IDB publication故障回滚保留全部旧集；withdrawn/unavailable清理已知/未知正文、来源及附件；缺失旧行message=null并重开核验。日志 `recheck-inbox-boundaries.log`。

该P1按上述存储与source范围分项通过。actor方向和canonical ID原问题已过，但独立扩展5条同秒程序消息曾发现排序仍退到chat:hash字典序，第四/第五条与权威lane sequence相反。实现者随后按lane及BigInt(sequence)优先修复；独立再执行该5条反例通过，日志 `recheck-actor-canonical-order.log`。

另外独立实际重跑旧source6/6通过，日志 `recheck-existing-source.log`，覆盖legacy20位ID/引用/撤回、离线/丢ACK重开、replacement和迟到切房、QQ panels/原件、晚ACK保新草稿。actor/canonical身份的原P1及相邻同秒排序按所测读投影分项通过。统一owner发送/撤回仍明确UNIFIED_OWNER_ADAPTER_REQUIRED，这是真实未实现能力；既有生产普通房未迁owner，不能称完整统一owner双向读写已交付。

## 分项独立复审：feed传输字节上限（修复后）

新增shared-only conversation-feed字节分页，保持旧PC readConversationFeed默认行为；消息lane按精确position推进，redactions独立分页。单条超512KiB返回descriptor，固定feed-item/read最多256KiB分块，公共query在完整SHA/UTF8/同房/同ID/状态/order校验后hydrate。分页与分块都带shared watermark及额外feedRevision，后者覆盖未进入shared实体seq的程序deliveries/comments变化。

独立原第4例重新执行通过：每页约501.7KiB，共20页，全部sequence1–20不skip/dup，日志 `recheck-native-feed-cap.log`。独立实际执行 `tests/shared-feed-byte-pages.test.mjs` 3/3通过，日志 `recheck-feed-byte-pages.log`：1500个redaction独立完整推进；100000中文字符comment+body分块；真实HTTP大canonical/markdown分块、原PC feed兼容，以及库或程序feed状态中途变化拒绝，不发布半个结果。只读核对Android native新增sharedFeedItemRead固定映射存在。

此P1在源码/隔离传输层分项通过；没有运行最终新增native口的Android APK。最终协议文档/固定口数量、冻结包、真实网络与设备仍需各自更新/验证，旧13口编译证据不覆盖新增口。

四个原反例（含同范围扩展）合并独立复跑最终4/4通过，日志 `four-regressions-after-fixes.log`，对应源码SHA `four-regressions-source-hashes.json`。当前含义是发现的四个P1已在这些源码路径内修复，不是总体双端功能已审批。

## 新seed路径待审范围（实施中的边界提醒）

实现者继续补shared独立格式raw .syseed、只读owner导出、私有原件stage、验证后同storage导入；与旧Product格式明确分开。审读到的设计仍有两项整体需求门槛，已立即通知实现者，待其最终实现后复审：

- 目前resolve只接受manifest.watermark恰等于服务器当前seq且完整roster匹配的包。正常导出后PC新增一条，会使包quarantined；原件adopt分支在空cache执行receive整库snapshot，尚不满足从已传包水位只追增量、不重下所有正文的初始包目的。不能通过信任自报游标解决，应有可信导出登记/历史包证明与最新redaction门禁。
- 当前raw reader拒绝所有ZIP包装，抛ZIP_WRAPPER_REQUIRED。拒绝坏ZIP是安全行为，不能作为已实现受限data.syseed解压。旧Product受限ZIP读取及格式校验不自动等价于新shared格式读包口。此项须补接或明确仍未完成，不能在完整资料导入验收中略去。

最终Android文件选择/持久原件sink、最终APK和真实资料迁移继续在未验范围；本独立代理不会为验收越过不装手机/不控5554限制。

## 新增原生序列化与受限ZIP独立复核

实现者通过真实org.json发现descriptor JSON对象键序变化引发合法409，已把服务端比较改为递归canonical结构比较。独立自写 `independent-transfer-boundaries.mjs` 第1例以真实HTTP对payload/cursor等所有对象递归反转key顺序，完整分块原文SHA/UTF8结果保持，已通过，不能以此前JS保序测试替代该结论。

shared新ZIP reader已真实接入raw shared prepare。独立第2例创建真实deflate+无签名data descriptor ZIP，shared内容成功验证；Unix symlink属性、加密标志、ZIP64头拒绝，取消后无本任务残留，通过。ZIP64是明确不支持的包装格式，超过经典ZIP容量应使用raw .syseed，不能说任意ZIP/解压工具已支持。

独立第3例发现新增P2：readSharedSeed及unwrapSharedSeedZip在创建私有stage后、try外open输入。选择文件后原文件已消失时，两者ENOENT都留下自己的stage。日志 `transfer-boundaries-before-cleanup-fix.log` 同时记录rawLeft/zipLeft非空；要求失败/取消清理自身临时文件，因此已交实现者修复，待复审。首份 `transfer-boundaries-first.log` 含一个测试regex对ZIP64错误码的夹具误写，已修正；它不是产品ZIP64缺陷。

根已同步最新用户壁纸答复：desktop/android独立图同样由服务器保留，显示参数各端独立；手机现有测试资料暂不迁移/分类/删除，后续批量处理。本报告不把旧device-local壁纸排除条款当成这项新需求已完成，也没有操作手机资料。

随后open已移入try，独立原第3例及同脚本另两例合并3/3通过，rawLeft/zipLeft均为空，日志 `recheck-transfer-boundaries.log`。P2失败清理分项通过。

## 新seed历史登记、增量接续及原生文件口复审

可信export登记已在同JSON持久metadata-only身份/manifestSHA/水位/roster digest，登记前核对原业务完整信封与真实原件；历史包resolve验证登记后先在未发布集合追增量/墓碑，再与权威副本/游标一起事务发布。不能以自报UUID或future checkpoint直接发布。压缩日志已超过包水位时允许安全全snapshot回退，并明确它会重新下载正文；这与普通已登记历史包只追增量区分。

独立自写 `independent-transfer-boundaries.mjs` 第4例真实HTTP+IDB通过：raw包离线quarantine不显示正文，IDB close/reopen后PC改原篇并新增篇，resolve从包水位只pull（0次snapshot），保留草稿/原pending wire，随后shared diary写回原API同Entry ID。日志 `recheck-independent-seed-delta.log`。这解除先前严格等水位导致普通历史包无法接续的范围门槛。

独立实际执行shared seed+ZIP现有9/9通过，日志 `recheck-shared-seed.log`，包含>2MiB正文/未知字段/本机Blob、伪造future水位/不完整roster、导出后撤回不复活、导出复制期间PC写入后刷新/登记、未发布delta期间不暴露旧正文、过期游标安全回snapshot及源first-watermark。新真实受限ZIP成功与错误包门槛也已解除；经典ZIP64仍不支持，raw .syseed可以到声明的较大容量，但本轮没有16GiB压力。

原生文件口及固定网络口审读遵循 `SHARED-SEED-NATIVE-V1.md`。独立执行host Java文件口23断言、fixed HTTP62断言分别通过，日志 `recheck-native-seed-host.log` / `recheck-native-fixed-host.log` 指向独立生成的sources.json产物。Android Context/SharedPreferences/Looper由host port替代；最终Android生产Java只按编译产物复用证据，未运行设备、未接文件picker/UI。不能把这些断言写成手机全资料已导入。

## 新壁纸数据域独立复审

审读新壁纸契约/domain/fixed action/公共helper后发现P2：默认null/rev0与用户首次显式null清图被存成完全同值，前端无法分辨应允许旧本机fallback还是尊重显式清除。独立HTTP反例失败保留在 `wallpaper-null-first.log`。

实现者最小修为首次显式图片引用（包括null）推进该scope版本，之后同值+当前版本仍no-op。独立反例扩展为三域并发nullclear，均成为各自revision1，重复同值并发清除均不误增；通过，日志 `recheck-wallpaper-null-concurrent.log`。独立实际重跑既有两真实HTTP客户端测试2/2，日志 `recheck-wallpaper-http.log`，覆盖shared/desktop/android三份服务器图片、重新开启恢复旧shared而保留独立图、各域CAS/房间隔离、重放不覆盖后来图、缺/坏原件及旧state不触此域。

后端字段与公共adapter按上述scope有条件通过；真实旧图映射/fallback、图片像素解码、crop/zoom/mask与IME仍前端合并/设备未验。服务端只有SHA/大小/MIME+文件头预检，不冒称完整图片解码。source移入公共shared-chat-source后，独立history/actor两个原反例定向2/2再过，日志 `recheck-public-source-move.log`；其它未改路径未重复全套。

## PC显式bootstrap与远端普通消息数据口

新PC入口复用公共shared-chat-source/持久inbox，保持原TL worker与journal owner，返回rendererAttached:false。独立只读预警大正文preparePayload遗漏后，实现者已接；新自写测试首跑即通过，未将预警当成已实际复现失败。

`independent-desktop-runtime.mjs` 真实HTTP+IDB综合例通过，日志 `recheck-desktop-runtime-foreign-offline-large.log`：disabled零I/O；start经注入的现有directory snapshot port启动持续登记；超过3MiB中文日记本机Blob/ref上传后原API同Entry全文一致；foreign source UUID、负20位roomID及20位messageID普通消息收件；dispose+真实IDB close/reopen后断网仍可读取同ID/正文。没有渲染器接管或Number强转，没有把独立PC数据口等同日常PC UI已装配。

当前只是数据接线分项通过；实际ChatJournalBridge C#固定口编译/HTTP由独立host证据另核对，日常PC bootstrap激活、UI显示、旧独立WebView头像/壁纸Blob映射仍未验。seed.complete表示服务器已登记shared公共数据的完整集合，不能反推所有PC独立来源原件已完成采集。

## 新G7媒体队列进行中

新增持久媒体job层及root source/runtime接线仍实施中，不能沿用先前source发送或原件分块测试批准G7。原任务已实际暴露“媒体初始时间早1秒、后发文字先ACK，媒体完成被旧journal早时校验拒绝”边界，后端正在补受控deferredMedia证明/原时插入；审批尚未给出归篇语义背书。

本代理已要求明确契约：稳定operation/message ID、原sentAt/引用/附件顺序；只受验证的同库媒体完成可走晚到例外；旧legacy早时仍拒；不重写closed/手改正文、不重挂邻居；取消及失败保留任务、丢ACK/重启不重复；归篇firstAt/lastAt与过老媒体隔离策略需实现者按需求定稿后验证。没有替用户决定新的产品归篇语义。

根随后明确并实施最小deferredMedia语义：完备同库原件receipt+实际SHA证明，claim身份/业务/命令receipt同commit；安全open归篇前插并保留replacement整组，firstAt=min、lastAt/deadline=max；closed/manual/hidden/draft/窗外/分类变则独立closed归篇，旧邻居不变。独立读实现并实际执行jobs9+deferred3共12/12通过，日志 `recheck-media-jobs-deferred.log`，包括legacy伪造不放宽、证明不可跨job复用、实际rename失败全回滚、断点与丢ACK恢复、取消不发布、两任务并发第三排队、Blob/opaque SHA及同事务draftClear。读审中提示caption只限2MiB与旧500000字符上限不一致，已在任务冻结前补拒绝；独立实际执行此场景通过，未把它作为已有用户实机故障。

独立自写 `independent-media-source.mjs` 真实HTTP+IDB+公共source综合例通过，日志 `recheck-independent-media-source.log`：同messageID进度占位，上传挂起而后发文字先ACK；切房后保留另一房新草稿；两原件与caption在原sentAt一次提交；切回只有原messageID一条、先后顺序保持，另一房无串信。G7数据层按此范围有条件通过，OS后台常驻/真实UI进度、物理动效及实际Android仍未验，不能批准整个G7界面门槛。

PC实际C#桥独立执行31断言通过，日志 `recheck-pc-native-bridge.log` 指向自建console harness/临时config/真实ephemeral业务HTTP产物，未开产品窗口。PC通用serializer 8MiB字符与大seed manifest 32MiB仍是明确容量边界，不能套Android固定seed34MiB回执；需要该上限时应单独固定seed serializer接线/验证。

## 当前独立审批结论（源码/隔离数据层）

**有条件通过：共同JSON后端、公共持久client、明确启用的PC/Android数据口、shared种子/原件、壁纸业务域及G7媒体任务数据层。** 首轮发现的4个P1、source同秒排序，以及原件reader失败清理/首次壁纸nullclear两个P2均保留原失败后修复复审；上述分项按对应日志通过。

| 层次 | 当前结论 |
| --- | --- |
| 本报告已读的源码和隔离数据路径 | 按逐项scope通过，未通过单纯测试数量背书 |
| 新shared seed/PC bootstrap/媒体job所需最终重冻后端包 | 128文件新候选已独立核SHA/依赖及相邻能力；具体包与证据见下节，未部署 |
| 最终原生Android | host Java数据/HTTP通过，生产Java编译证据仅按相同scope复用；无设备/APK运行 |
| PC原生 | 独立真实C# console/HTTP通过；rendererAttached:false，未接管日常窗口 |
| 完整两端页面、旧本机头像/壁纸Blob映射、全部PC独立来源覆盖 | 未完成/前端接续，不因seed.complete或API存在而通过 |
| 真实整包导入、真实多出口HTTPS、最终WebView/Magic7、长期/上限压力 | 未验；不越过手机/5554/正式数据边界执行 |
| 正式部署与启用 | 未执行、未批准；前述只读正式指针为chat-reedit2，之后发布前应重新status |

因此对用户原始“所有资料与两端日常功能已经全面互通”目标，**尚不能宣称完成或全面通过**。剩余是明确的页面合并、旧独立来源/原件采集映射、真实资料/网络/设备及最终发布验收，不能用本报告的数据层审批替代。

## 最小追加复审：跨窗口媒体租约与最终后端冻结包

独立审读持久lease的同事务claim、owner/token写入fence、active续租、release与dispose路径，并实际执行新增5个双连接/controller定向场景，5/5通过，日志 `recheck-job-lease-final-five.log`。包括第二控制器不启动重复uploader、过期接管后旧worker晚progress/failure不能覆盖ACK、dispose只释放自身lease，以及持有有效租约时冷重开先等待、遇续租重排、死owner到期自动接管；dispose清理等待timer且保留另一owner的lease。时钟/timer受控注入，无60秒阻塞sleep。这里的IDB是fake-indexeddb两独立连接及实际事务实现，不是物理设备运行。

早期仅“过期后显式resume/retry”的边界已被最终自动wake补强解除；每个被占任务按expiry单次等待，到期重新事务claim，若续租则再次按新expiry等待，不忙轮询原件。独立只读确认Android/PC runtime均 `await uploadJobs.dispose()` 后才关闭自身storage。maxConcurrent依然是每controller任务数限制，未验证全IDB所有不同任务的统一全局并发上限；无OS后台常驻/系统杀进程设备结论。本次仅追加租约与关闭顺序，不重复无变化的归篇/原件完整套测试。

新冻结候选 `outputs/backend-runtimes/20261019-shared-business-1792436698865/runtime-manifest.json` 独立核验通过，manifest SHA256为 `6a25c951a5a4dac26c051f257191ddbf2eaeeea8664d4d27f3c6ef72739e2e4b`。独立脚本 `tmp/shared-business-independent-review/verify-current-freeze.mjs` 验证128/128文件SHA；使用AST重新提取全部339相对依赖并核闭合，与dependency-audit边逐一一致；99个原冻结baseline文件保持，server入口仅预期shared配置注入，来源session-cache SHA保持。workspace overlay与所冻源码无漂移，原配置路径锚点保持。

只使用合成UUID tmp库/port0实际启动该冻结createDiaryServer并读取health：sourceSessionCache、atomicConversationSettings、conversationMessaging均1。独立结果保存在 `final-freeze-independent.json`。正式配置指针只读仍为chat-reedit2，未切包、未启动正式服务、未操作手机/5554。新client数据/原生桥交付清单若另冻结仍需按其具体文件SHA单独对应，不能被这份后端包核验自动覆盖。

追加结论：**租约数据层与该冻结后端候选按上述scope通过；总体仍为有条件通过，未批准部署或完整双端UI。**

## 新需求审批矩阵：独立机器人/程序/AI服务（待实现）

用户新增硬需求：机器人/程序/AI独立于前端作为后端服务，像本人一样参与授权会话；显示名称允许修改和同名，以稳定ID区分，消息明确标记来源。此项不在已核对的128文件冻结候选内，旧actorId署名及程序配置登记不构成独立服务认证或实际执行证据。已把以下门槛发给实现者；当前全部待实现/待独立验证，不能沿用旧消息测试批准。

| 验收项 | 必须观察到的行为与定向反例 | 当前状态 |
| --- | --- | --- |
| 独立服务认证 | 真实HTTP独立高熵credential，服务端只存不可逆摘要，绑定库/epoch/instance/binding/conversation；伪造self、他actor、他库/房均拒绝且无副作用 | 待验 |
| 最小权限 | read/send/reply/media/comment/withdrawself逐动作deny-by-default；无库管理或任意路径/URL/进程执行能力 | 待验 |
| 失效与重启 | disable/unbind/rebind/revoke/rotate后旧token立即失效，重启保持；原slot重绑不能让旧token借同instance继续写 | 待验 |
| 来源与同名身份 | 两程序同名可独立参与，改名不合并ID、不改变历史归属；消息保留稳定author/instance与sourceKind，自本人方向不由name推断 | 待验 |
| 原owner兼容 | 已存在legacy房原消息/引用/替代链/邻居保持；程序可读写同一房而无需前端迁canonical owner，内部许可不能由普通body选项伪造 | 待验 |
| 媒体与评论边界 | 本房引用/本人上传授权贯穿meta/chunk/read/upload，不因知道同库assetId绕过；评论精确目标，程序仅撤回本actor消息/评论 | 待验 |
| 幂等与凭据隐私 | 同operation重放仍原消息，异文409，换token不换actor幂等身份；明文token不进入receipt、共享seed/replication或公开证据 | 待验 |
| 无前端运行 | 合成worker实际发行独立token，以HTTP读参数/本人来信并回复、媒体、评论、自撤回，服务重启后继续；不是用owner代发或仅直接调内部函数 | 待验 |
| AI/外部程序真实边界 | 无外部AIkey只登记并明确未执行，不假生成；不任意spawn程序或安装插件；外部服务正式部署单独验收 | 待验 |

独立验证仍只用合成tmp库/port0，不部署、不开产品UI、不操作设备。实现者最终接口与token发行边界确定后再选最少真实HTTP反例；页面显示来源和用户改名入口由前端合并另验，不能因后端字段存在便声称页面完成。

用户随后明确：前端停留密码锁定页时，已授权后台机器人仍凭独立服务授权继续读写，可单独撤销。此答复覆盖独立审查曾建议的“锁库即暂停服务”默认门槛。最终改验无前端cookie/密码页状态不撤销显式后台授权，普通前端锁保护保持；服务库/epoch/绑定/enabled/scope/撤销逐次核对。显示名称明确允许改名及同名，以稳定ID区分，不增加唯一handle要求。

## 纯client/native数据候选冻结核验

新data候选 `outputs/2026-10-19-shared-business-integration/data-candidate-1792437266516/data-manifest.json` 按接线范围通过。独立核对manifest SHA256 `57144530ccb2cb63570ed228005422c25cb7390987186360de994de6a7e2d59b` 与56/56源码快照SHA（含21个Java），最终lease与两个runtime对应已验版本。Android/PC分别27/28个解析输入、15/17个实际输出输入；相对依赖均在快照中，无外部import、无页面入口。两个rich editor解析依赖均parseOnly且输出0字节。

独立脚本 `tmp/shared-business-independent-review/verify-data-freeze.mjs` 使用冻结sources重新构建，两bundle与候选逐字节一致：Android155149字节/SHA `d665055d5741ae2b995c91cab42b5efc1c71c49e748e43924c0a93993ccf73be`；PC162101字节/SHA `142ff2eaa196083277f11d580eaa63113b12a28c37d88e6a37cefd8155aa3938`。证据 `data-freeze-independent.json`。

可交前端作为已验数据接线候选；observedOnly旧PC journal/prepare/C#等仍只按新seams批准，非全文件验收；目录view helper快照不是完整页面发布。没有APK/日常窗口部署或默认启用；不含新增机器人服务，也不把manifest的uiIncluded:false理解成这些旧文件所有分支都不存在UI代码。

## 独立程序后端：权限缺陷、修复复审与新增冻结

审读新program-auth/service/client/synthetic-worker、可信CLI及app/shared窄接线，确认它不是把旧actorId署名当作身份认证。独立Bearer摘要/授权在私有SQLite，业务仍在同JSON；固定程序口强制稳定actor，legacy兼容只由内部选项授予，未迁移旧房owner。后台授权按用户答复独立于前端密码session。没有前端mint接口、自动模型/任意spawn或正式凭据发行。

独立新增真实HTTP反例发现P1：程序调用withdraw，kind=comment、本房history instance与尚不存在的operationId，原实现返回200并创建无author的withdrawn墓碑，能提前占用以后合法评论操作，超出withdrawself权限。定位旧 `conversations.mjs` withdraw评论只在comment存在时比较author，missing继续走planRevisitWithdrawal的管理员离线墓碑语义。原失败保留 `program-boundaries-first.log`，不能因实现者7项或总29项通过便批准。问题包 `20261019-shared-business-1792438254620` 不可发布，未作为最终包批准。

实现者已增加仅内部serviceParticipant门禁，program-service强制使用；未知评论先404 PROGRAM_COMMENT_NOT_FOUND，原管理员未传选项仍保留离线先撤回兼容。独立原反例扩展为拒绝后整份diary.json逐字不变、同operation随后本人正常发送成功、同名另一actor不可撤回、本人重复撤回不复活，修后通过。

独立脚本 `independent-program-boundaries.mjs` 最终3/3真实HTTP通过，日志 `recheck-independent-program-boundaries.log`：

- 上述未知评论/同名稳定actor撤回门槛。
- 包外程序SDK实际800000字节原件上传/分块下载逐字一致；未发送前另一程序不可读，发送形成同房可见引用后可读，撤回清引用后该程序立即不可读；超过1MiB中文feed完整分块发布，分块中另一程序配置变化导致409，整页不返回半成品。
- send权限不自动授予reply，五种actor/sender来源注入均拒绝；HTTP已发headers但body尚未结束时撤销token，续读完body后401、原JSON无消息写入。

独立实际执行既有program7+SDK3共10/10，日志 `recheck-program-existing-http-sdk.log`，覆盖无UI合成worker以独立token回复既有本人消息、legacy owner/原human保持、同名与改名历史快照、rotate与重启同op幂等/异文409、自撤回、device Bearer/伪actor/跨房/跨库/epoch、disabled/rebind/revoke、前端密码页仍可后台授权send而普通前端401、媒体私有/他房/未完upload接管拒绝、明确history context与评论、旧时间和手改段保护。CLI EEXIST/注入ENOSPC回滚issuer/rotate、不新增grant、不覆盖文件、旧token重启可用与成功轮换后旧token失效也由该真实HTTP测试实际执行。修后只追加执行受影响的评论定向1/1，含trusted admin未知评论墓碑兼容，日志 `recheck-program-comment-final.log`，不重复无变化全套。被审源码指纹在 `program-reviewed-source-hashes.json`；指纹不表示每个旧文件所有分支全面验收。

新增审批矩阵结论：前述独立认证、权限、失效重启、同名改名/来源、legacy兼容、媒体评论、幂等/凭据、无UIworker八项按所测数据接线scope通过；AI只登记不执行的边界通过，真实AI/外部程序部署与执行器未验。机器人replacement明确未实现，不外推为支持本人ui48所有重编辑能力；实际页面来源标记/改名入口继续由前端合并另验。

修后最终后端包 `outputs/backend-runtimes/20261019-shared-business-1792438691897/runtime-manifest.json` 独立核验通过，SHA256 `b81067ab725038646bc63b14fb5cd7cf2036f485b3c8b45daef2d59b7d6c2428`：134/134文件SHA，AST重新提取352相对边全部闭合且与audit一致，99个原baseline保持，session-cache原SHA保持，overlay无漂移。独立port0合成库实际启动新包，三个相邻health能力保持1，并用包内SDK+独立token经真实HTTP在legacy房发送/收件，actor/sourceKind落原业务，owner仍legacy。证据 `program-final-freeze-independent.json`；旧128包/56源client包未改。

根另提供私有实库副本兼容回执 `real-private-copy-134-program-fixed-compatibility.json`，3157篇/3137媒体、除shared索引外原业务保持、sourceSessionCache1；本独立代理只读核对该回执对应新包SHA，未重新读取/打印真实正文，也未把实现者副本验证冒称独立全库验证。正式指针仍chat-reedit2，无shared默认配置/部署/手机操作。

## PC固定seed容量独立窄审

独立审读C#仅两固定seed动作使用34MiB serializer并同时限UTF8请求bytes、声明响应及流式累计bytes；普通shared仍8MiB。实际独立执行 `node tools/verify-shared-pc-capacity.mjs` 22/22通过，日志 `recheck-pc-seed-capacity.log` 对应产物 `pc-capacity-9bd70c86-9303-4935-8f46-e40388e8433f`：真实小roster登记/resolve成功，9526553字节合成大roster到达实际业务后按集合不符409（不冒充有效整包），独立HTTP transport fixture两seed大请求/响应成功，UTF8超限/35MiB请求、chunked及声明超限响应拒绝，普通8MiB保持。

独立核对四文件delta全部SHA及manifest SHA `183f9d51c43d2e7c53cda15be4d85eee6f3f479c5ad2b555165745a860711429`，C#桥SHA `0292628ce236861d6f640da25b0e27cdde5e8a35696f089ff099b70bcdb33ffb`，证据 `pc-capacity-delta-independent.json`。此delta接在旧client56候选后，未重冻或纳入并行前端其它prepare改动。旧31业务回执按实现者补丁后相同C#证据复用，本次没有为容量再独立重复31套。

仅批准**C# bridge→HTTP两seed容量**。DesktopPreview外层WebView双向8MiB解析未改，实际PC UI的大manifest仍不能据此宣称32MiB端到端已接；无产品窗口启动、renderer接管或正式启用。

最终追加结论：**独立程序授权/SDK/CLI数据接线与修后134后端候选，以及PC固定seed容量delta按上述scope通过；整个项目仍有条件通过。** 未完成的前端合并、旧独立来源全量采集、实际网络/设备/真实整包和发布门槛不因新增程序功能而消失。本审批不授权部署。

## 新任务预审：真实电脑整包、导入前端与一本日记持续过渡

用户要求继续真实采集，产出能直接导入的资料包并接前端，同时继续在“一本日记”写作、之后在电脑转换自己的格式再同步。本节是开工验收矩阵，不提前批准尚未交付的CLI/包/页面。开工已重读当前维护入口、shared seed/集成/原生契约、旧转换方案与导入冲突规则，并向根及两执行Sol同步。

首要实际边界：正式chat-reedit2尚无shared身份。私有副本若首次初始化libraryId/epoch，不能冒充原owner的可续同步包。可以先生成明确unbound的私有恢复材料并验证完整性；原owner真实启用身份、完成前端来源登记和trusted seed-register后，才能交付该owner可直接续同步的shared包。两种产物的格式/状态/用途必须分清；unbound材料不得被前端当作活动shared库自动绑定。

根随后同步用户本轮目标的授权更新：必须交付实际可导入包，不能停在quarantine结项；完成目标所需原owner后台上线须先提出受控方案，经独审/前端协调后由根统一推进。按正常保存/排空/稳定私有备份及候选SHA/健康能力/原业务保持/回滚门槛执行，不直接改正式JSON或强杀写作窗口。此更新覆盖上一阶段“完全不动正式后台”的边界；本代理不会自行部署。手机与5554仍不操作。

另已明确用户仍在外部App“一本日记”写作，后续导出位置为`F:/<个人目录>/备份下载`，此前已导过旧资料。本轮只交可靠显式接续接口及合成反例，不自动扫描重导旧文件。未来新导出仍按原来源ID与版本/冲突规则接续，不把外部App写作冒称已直接联网同步。

| 编号 | 必须实际观察的验收证据 | 当前状态 |
| --- | --- | --- |
| C01 原owner身份 | 原owner受控上线后，包内libraryId/epoch、水位、export登记来自该owner；copy/unbound材料不能自报可信checkpoint。最终必须可resolve+持续增量，导入后同Entry写回该owner，ID不换 | 最终交付硬门槛待验；不能仅以阶段quarantine结项 |
| C02 完整来源覆盖 | coverage逐源列已采/未采/排除理由及计数/hash，覆盖原JSON日记/历史/未知字段、原会话与PC worker空房/资料/pin/archive/order、朝花/AI程序参数、可移植偏好及相关本机资源。便签按用户范围排除，凭据/设备私项明确排除。server rooms计数不能代替worker全目录 | 待验 |
| C03 一致快照与持续写 | 只读capture有明确代际/前后摘要；持续写期间新增/修改/撤回不混成假完整代际。shared导出页首watermark+复制期间刷新与可信登记，包后写入导入时增量接续；不得停用户写作来掩盖缺口 | 待验 |
| C04 全量原件 | 每个有效引用均解析原件、逐件完整size/SHA核验，不以元数据/Range可读冒充；正文/独立附件/历史/头像/贴纸/壁纸引用覆盖明确。缺失、损坏、读取中变化明确失败，不发布complete成功包 | 待验 |
| C05 容器与可恢复性 | 显式私有路径、不会覆盖旧输入/包，原件有界流式处理；限制ZIP路径/范围/压缩/CRC，false complete/缺成员/尾部/超限拒绝。断点/失败/取消只清本任务stage，保留旧包及原件 | 待验 |
| C06 一本文档稳定身份 | 同来源命名空间+原UUID/登记稳定键重复转换/导入不重复篇/附件/评论；无UUID不得仅按同title/date/同文指纹合并两篇。部分时间范围导出缺席不当删除 | 待验 |
| C07 来源修改与冲突 | 原篇变更标记旧转换过期，沿原身份重新转换；PC也编辑过则冲突保留双方及恢复路径，CAS拒绝stale覆盖。规则升级不靠新ID或改变时间去重 | 待验 |
| C08 内容与资源保真 | 未知字段/原时间依据/历史/评论引用保持；旧附件按原序置顶且标legacy-default-start，insertedAt未知仍未知；同图不同occurrence保留，asset去重不删真实出现，同名不同字节不覆盖 | 待验 |
| C09 真实导入调用链 | 前端实际入口经受限file stream/native固定口进入prepare→stageOriginal→公共shared import→quarantine/resolve→同IDB事务发布，有调用证据；只直接调内部JS或host reader不能称页面已接 | 待验 |
| C10 大manifest全链 | 超8MiB合成manifest必须经过真实外层入口，逐段受限传输；已有C#桥34MiB不替代WebView外层8MiB接线。若入口未合并，则明确该门槛未完成 | 待验 |
| C11 离线/错误与手机保留 | 用户最新硬要求：受信signed full seed首次完全离线即可活动读写/原件可用，TOFU/pin和业务/clock/outbox同事务；unsigned quarantine只兼容，不能结项。旧包不得复活本机已知墓碑/覆盖新稿。异库/epoch/事务abort不半批、不清现有test资料/draft/outbox/Blob，完成handle重开仍读 | 新signed离线实现待验；旧quarantine分项不能替代 |
| C12 真实包独立复核 | 真实输入/输出仅私有，公开证据只数量/hash/覆盖和异常码；独立全成员校验与原来源计数/hash对照，原件全SHA而非仅抽样，报告明确原件是否全部覆盖 | 待验 |
| C13 安装与正式启用 | 不装手机、不操作5554；后台必要上线先给受控方案/独审/正常排空备份，由根统一推进。文件/数据接线/页面证据/实际启用分层，不把unbound恢复材料写成日常同owner互通 | 部署方案待审；尚未执行 |

最小独立实测组合计划：①合成真实HTTP导出→受限读取→实际IDB导入/重开→同Entry写回，保留既有草稿/待发；②复制/包后PC新增修改撤回，再trusted delta接续不复活旧正文；③一本日记同原UUID重导、无UUID同文双篇、来源与PC双改、部分导出缺席；④缺/坏/变化原件、false complete、异owner与事务取消无半批；⑤前端实际导入入口和大manifest外层调用证据；⑥对真实私有材料只做本地全成员hash/覆盖比对。无变化的容器算法与旧定向证据按冻结SHA复用，不重复无关全库/设备矩阵。

## 首批采集独审进行中：宿主维护前置分项通过

独立审读固定capture host及无app/worker依赖的数据模块。初读旧宿主只查路径祖先reparse，内部EBWebView/IndexedDB junction可能被递归文件枚举跟随，已立即通知根暂停真实profile维护。实现者在本代理首次编译前已补整树逐层拒绝和全祖先检查；因此独立首跑是修后拒绝成功，**没有将旧版隐患写成独立实际复现失败**。

独立 `independent-host-junction.mjs` 实际WebView合成流程通过：EBWebView指向private-root外的合成junction在文件枚举/内存预检前拒绝，无成功输出；正常profile包含可选assets Blob/previewBlob及withdrawal恢复记录，8成员逐个size/SHA核对通过；重复输出、输出在profile内、任意module路径均拒绝。host SHA `7d41538e451d65bd736c0fff52d0bbe96592260a66e32bee87dba476e05612cd`，module SHA `9098a502b2e0d79b70aebd8cd9f461d380619e39bd752e7b57ea4d39365245e9`，证据 `host-capture-independent.json` / `recheck-host-capture-final.log`。宿主固定空白origin和三资源allowlist、绕过旧service-worker、ACK背压及成员hash；没有进入产品app/worker、初始化source或正式profile。

**分项允许根协调标准保存ACK→正常stop/运行器排空→稳定私有profile备份→原版重开→仅另工作副本逻辑采集。** 必须先拒绝源profile全树及祖先reparse，固定私有绝对路径；稳定双读/逐文件hash证明备份完整，原备份不打开不改，工作副本独立目录并核映射hash。保存ACK须说明pending/File准备是否已完成，不能把flush等同全部异步任务已提交；未竟材料只作私有恢复，不能升为已发业务。实际工作副本必须过IDB大小/提交内存余量门槛；失败不打开活跃原profile、不做危险递归删除或强杀写作窗口。此结论不授权后台部署，也不等于完整来源投影/真实资料包/导入页面通过。

另独立实际反例发现一本日记来源P1：旧无谱系原记录uuid=A/id=B；新显式来源原记录uuid=B/id=C，正文/日期相同，当前oneDiaryCandidates把新主UUID匹配旧备用id，再被忽略uuid/id的内容fingerprint错误合并成一篇并绑定旧来源。`independent-collection-cases.mjs` 原第1例实际失败保留 `collection-cases-first.log`，已交实现者修复；同文不同稳定主ID必须保留两篇，不能跨uuid/id字段碰撞。初始第2例使用文件symlink被Windows EPERM阻止是测试环境限制，已换目录junction，不当产品失败。一本日记分项此时暂不通过，不影响独立只读capture宿主的前置维护结论。

原owner上线C01最终证据按根补充收口：个人真实正文不为测试修改。成功同Entry写回、冲突和撤回用合成owner真实HTTP验证；正式上线只读核实际library/epoch、trusted登记/resolve、实体/原件全量一致与正常用户写入的可观察增量，不发正式测试消息/评论或增删测试日记，不伪造生产写入归因。

### 首批修复复审与真实恢复材料全量核验

一本日记P1已窄修：来源保存recordType=uuid/id，优先有效uuid、缺席才id；旧无谱系记录及本轮早期缺recordType的记录亦按同一主键规则推断，禁止跨字段/类型碰撞。独立原2反例实际2/2通过，日志 `recheck-independent-collection.log`：同文不同主UUID保留两篇；媒体目录junction/坏JSON均不生成成功marker。现有capture/export、逻辑快照及显式来源12项独立实际执行通过，日志 `recheck-collection-existing.log`，含真实HTTP旧Entry保留/变化冲突、跨类型身份、generation变更/sink失败无complete、缺库不初始化、可选Blob资源/恢复私有图。来源P1按这个接口范围修复通过；generic导入保持原路径，未导入真实旧备份。

独立本地读取私有真实capture并对**全部3140个原件完整流式SHA**，逐件核size、与private roster及JSON索引对应，无重复/缺件；并核原JSON和公开summary SHA/数量一致。结果：3157篇、3137媒体、3导入档案、9个已登记server房、8模板；原件总3,327,019,485字节，JSON21,951,871字节，SHA `f2744707d1011b196250e832ba7b28646029b14659ca02bf747296fb03590814`，原件roster SHA `7b7b903ddf4ffd29a60bd2c2afc9ef792a151ce98bc56d1b0f09d9c264acb276`。证据 `real-recovery-capture-independent.json` / `recheck-real-recovery-capture.log`。真实正文、原件、逐文件ID和私有路径均未输出公开证据。

只批准**该代际恢复材料的JSON/已索引原件完整性**。sharedIdentity=false、directlyImportable=false、completeComputerExport=false已独立确认；PC worker本机目录/偏好/未送journal消息与资源的portable映射、原owner真实上线和最终shared包/导入仍未完成。capture失败保留无marker的私有阶段目录是当前明确设计，不冒称cleanup已完成或视为成功资料包。

### 原owner受控发布计划的必要门槛

已发根具体门槛，供其提出/统一推进发布方案；本代理没有自行部署：

1. 锁定精确已审冻包SHA/依赖及配置差异，最小sharedSync=true、remote=false、实际loopback，不混工作区候选。已审134包不含本轮显式一本日记新接口，不能同时宣称该接口上线。
2. 正常保存ACK并确认pending/草稿的恢复回执、运行器排空，标准stop且核当前进程身份，不强杀/直接编辑业务JSON。
3. 停后稳定私有JSON/原件/profile备份并保前后业务域hash清单；旧capture只证明其代际，维护时如有新写需刷新。原备份不打开，工作副本另目录且逐层拒reparse。
4. 由原owner既有mutate/rename首次持久身份与index，核业务/Entry/legacy owner/来源cache等保持；library/epoch唯一且可重启保留，health启用shared而remote仍关。不写正式测试内容。
5. 用真实包trusted登记/resolve及实体/原件完整hash核生产状态，同Entry保存/冲突/撤回等仍在合成owner完成；真实正常用户写入若发生可只读观察delta，不伪归因为测试写入。
6. 预置同shared schema/能力的回滚候选并保首次identity/log。若必须退无增量旧包，先停shared客户端，明确epoch/re-snapshot方案，不允许旧cursor被当作无损续同步。
7. 原owner步骤通过不等于前端/source映射或实际整包交付；未审页面不主动启用，不装手机、不控5554。最终C01–C12剩余门槛继续逐项验。

## 第二批独审：真实PC逻辑材料与导入base冻结

### 新恢复键窄delta与真实材料

采集模块仅追加四个PC私有恢复/迁移键，tt-last-activity只列键名与排除理由，绝不getItem取值。模块SHA `bd2b4a8f46a35d872d71a03c96a2d9fc0d6779f523e6d7ce29c1a8008d051172` 已独立核对。独立自写2例＋原fake-IDB3例共5/5通过，日志 `recheck-capture-preference-delta.log`：四键raw值保存；activity值变化不污染/中止快照且spy证明无读取；包含的新恢复键在emit期间改变则拒绝complete。**允许只重跑既有工作副本**，无需再维护真实profile，不改变原66成员/旧9098模块证据。仍为私有恢复材料，不应用owner业务或恢复设备活动时间。

对实际维护回执及私有备份独立逐文件hash：846文件、233,901,420字节全部与稳定roster吻合，roster SHA `df3b1570ac33e07b5866f4192e551d46a9773fa8ec464e8b59cf250a6c2df9c0`。根提供正常stop→备份→重开ui48回执，API未动；本代理未打开原profile或备份运行WebView。工作副本已运行后会有正常缓存变化，因此不把当前work目录与停机原backup逐字相等当作错误门槛。

原9098模块真实逻辑capture的66成员、113,356,672字节已独立全部size/SHA验证，manifest SHA `df8965ff4e244b24c360a23a4f2fd7e12d756be3b62987c1eb982bc19a480097`，聚合content SHA `0347c10586671a5781af605302ebda82c983a91629c4f7b511190141fadfe7dc`。独立解码typed graph确认525消息/10房桶、59 documents、10房、17 asset records、3 recovery records、61二进制成员。原summary.messages=10是房桶计数，原文件未篡改；公开统计另标messageRooms=10/messages=525，不将原10误当消息条数。证据 `real-logical-capture-independent.json` / `recheck-real-logical-capture.log`；无真实正文/逐项ID/原件输出。

planner/纯formatter现有3定向独立执行通过，日志 `recheck-desktop-source-plan.log`，确认原formatText函数body SHA `cb58a22dabd52166982f0cd76e16dedc27a752f2cfff66dd1d92c914fe100a7a` 与AST逐字一致、精确身份/pending/撤回保护及损坏成员/graph拒绝。真实dryrun公开431 exact、3后继、79原程序评论域、10 demo、2冲突仍仅只读计划；本代理独立核真实消息总量与材料完整性，没有把同一planner的分类汇总当已经实施的业务映射。2冲突待用户选择，不自动覆盖。不存在为10个原journal排除demo新增“缺历史”或晚写例外的验收依据。

### 冻结base身份、独立QA与原件反例

本批base为 `outputs/2026-10-19-shared-business-integration/data-candidate-1792441652751/data-manifest.json`，SHA `6ae242a9b1888910d099600641cc82ab00da2d3aa38a7c0d7216af0bcc36472a`。独立核59/59源SHA、22 Java，Android30解析/18输出输入，PC32解析/21输出输入；闭包无外部import、无页面入口，两个rich editor解析例外输出仍0字节。用冻结sources重建逐字节相同：Android183412字节/SHA `1e62596124ef1e4b50fa981d7173ba95835450900b10c99420e34d46d8c9767d`，PC194596字节/SHA `6b4cd24992a5dd171cd196da7a1b8b9cac2bd3e9c08b6c4ce73a3b22beffe456`。证据 `import-base-freeze-independent.json`。

为避免工作区下一feature漂移，本代理新建独立QA目录，底座使用已审134后端冻结文件，覆盖此59源冻结；测试使用实施者保存的actual-idb-abort-latest快照及明确记录的host测试夹具，不使用后续工作区shared-seed/client/core生产改动。实际执行6/6通过，日志 `recheck-frozen-import-base.log`：

- raw File→shared quarantine/catchup→真实IDB分块/重开→合成owner原Entry可写，旧草稿/outbox保留。
- 离线隔离正文不可见，联网trusted delta后一次发布；错库/hash/cancel/实际IDB package/entity/meta写后commit前abort均不半批。
- 同包重导保留旧active handle，只清本轮新stage；native Java选定文件→小ticket→manifest/member/stage固定口→JS同IDB发布→native关闭/进程重开仍读原件。
- 两runtime断网从已导入IDB原件读媒体并在dispose撤销URL，无网络回退或Product库写入。

独立再自写2反例，在同一冻结QA生产模块上通过，日志 `independent-frozen-import-boundaries.log`：每次原件read重新检查active索引，取消active后旧source拒读；篡改本机chunk并重算该chunk哈希仍被全文SHA拒绝，sink.finish不调用。small-wire首块后取消会恰好一次native stage cancel且不发送finish。首写测试曾把storage参数误用name而不是受限dbName，修正夹具后通过，未归因为产品修复。

### PC小消息与私有auth窄接线

冻结QA中的真实C# console/合成HTTP独立执行DPAPI/device auth19项、容量与small-wire29项分别通过，日志 `recheck-frozen-pc-auth.log` / `recheck-frozen-pc-smallwire.log`。独立审读四个固定auth动作、DPAPI root+固定地址scope、named Mutex与原子写盘、pair代际和旧401不清新凭据；token不回页面。两固定seed使用128KiB块/小于256KiB帧传递超过旧8MiB的manifest请求，经原outer模拟封包到真实C#桥/HTTP，非任意URL或调用方可调大通用限额。真实大roster集合不符仍409，不假称整包登记成功。

这解除此前**固定seed请求**必须整块经过外层8MiB的接缝限制；真正产品DesktopPreview/WebView资料按钮与picker/renderer仍未挂载验证。C#仅shared seam观察快照，不批准用此整个C#或journal文件覆盖并行前端；prepare/write-manifest为构建参考SHA未复制、不在批准发布白名单。native25与harness编译只按同SHA复用已有host/编译范围，没有设备实跑。

### 第二批结论与剩余门槛

**本批真实私有逻辑材料完整性、四恢复键窄delta、59源导入controller/原件/replay/事务/小消息与私有auth数据接缝分项通过。** 无新生产缺陷被这些独立反例复现。仅可作为前端合作接线base，不能以此关闭C01–C12。

该base没有79程序/评论的离线feed种子投影；下一feature须保canonical ID/actor/sourceKind、精确comment target/history scope与墓碑/hidden/deleted/draft，不能复制成self普通journal或把本机恢复正文发布。可信coverage必须在原owner同JSON回执绑定身份/epoch/水位；sourcePlan.complete=false不是采集应用或全量覆盖证明。原owner仍未shared上线，实际portable映射、2冲突决策、最终真实可导入包和前端入口/设备磁盘预算仍待实际交付/验收。本代理未部署或操作设备。

## 新离线首启基线与第三批分项审批

用户最新硬要求：PC/Android都是本地优先的完整离线客户端，当前电脑只是暂托管服务。受信signed full seed首次完全断网就须能活动阅读/写入/读原件；unsigned quarantine只作兼容路径，不能作为最终成果。未来服务器迁移须保持libraryId、epoch、message/source身份与原签名信任，服务地址只是locator。C11已按此更新，旧quarantine通过记录仅是旧兼容范围，不外推为新首启已验。原owner真实身份/私有key仍未上线，此批没有正式key/服务/设备操作。

### ticket guard baseguard59：修复通过

前端独立反馈的P1是原59导入controller在进入try前校验ticket manifest，合法已分配native container遇非法manifest guard时没有close。原实际Java失败由发现者保存在ticket-guard证据old-failure.log；此前本报告的6项没有覆盖这条先行guard，不能继续把旧base作为已修候选。旧59其余范围与原失败均保留。

新baseguard `data-candidate-baseguard-1792442617373` manifest SHA `662ad726f6df819d8d1ca09296ec05263fefceb063a9ced88d67768b17b3179f` 已独立核59/59 SHA、22Java与两bundle闭包/重建逐字节一致；与旧59逐源比较唯一生产delta为shared-seed-import.js，SHA `3c68f134d59b12e336a9bd334fb4860aa7f0d3fc92c8a7221fb2cb89ae1a58cb`。合法UUID token归属确认后，manifest/identity/cancel均在try/finally；nested finally保证discard失败仍close，非法token不路由到其它任务。

本代理在独立QA用这个冻结59覆盖已审134底座，重放保存的patched-baseline测试，6/6实际通过（含真实Java ticket、manifest/identity/cancel/success恰一次close、非法token不影响另一任务），日志 `recheck-baseguard-native.log`；未使用live v2客户端/后端。证据 `baseguard-freeze-independent.json`。Android bundle SHA `b15e13fe3b0fba6863d2a6159e9245c3de5f3c455504c59757a7ef07d3bd4807`，PC `1c02a5acb896997217f5f9facb0f6aa445bd8eef6692a76b09ae802a19b16e34`。**仅baseguard delta通过**，不代替新signed离线实现验收。

### feeds与Ed25519签发：发现P2后窄修复通过

新服务器签发key在私有.shared-auth绑定library，原子首次胜者、重启同key，已签登记后丢key拒绝静默轮换；签名绑定去attestation的完整canonical manifest和库/epoch/package/水位/export身份，私钥不进业务JSON/包。feed按既有公开canonical投影分parts，保程序/评论来源与明确引用，不复制为self journal；签发前钉住COW generation并核实际原件。该生成代际的签名不是“包含签发后所有新撤回”的承诺，联网接续须继续刷新最新feed。

旧142候选 `1792443012642` / manifest SHA `57c7bd87dca0bca204f3d2e64e965a3c5b2a7e27d2cad1ed1f15a23aeff5b1da` 的5个签名/feeds真实HTTP专项，本代理实际执行5/5通过，日志 `recheck-frozen-signer-feeds.log`。但独立新增真实HTTP反例发现P2：取实际导出的v2包，去attestation/换packageId，仅将某实体member.size及总bytes/entityBytes各加1，保持其逻辑指纹/path/SHA，seed-register仍签名并永久登记。该full manifest无法通过实际成员长度校验。原因是verifyCurrentSeed只核descriptor指纹/path，未核对应完整canonical信封成员长度。原失败 `signer-boundaries-first.log` 保留，**该旧142不可发布**。

实现者仅seed.mjs补member存在、size=实际canonical bytes.byteLength、member.sha=实际bytes hash，新冻 `outputs/backend-runtimes/20261019-shared-business-1792443368922/runtime-manifest.json` / SHA `d11f5eeb8b2330a4ff8489efd71cbbb01fcce8ed106729d95c25e24a239f9e20`。独立确认唯一生产delta；原反例与必要邻近3/3通过，日志 `recheck-signer-member-boundaries.log`：实体size伪造拒绝；feed part和原件asset/member长度伪造均拒绝且registry/seq不变；第一次非法unsigned full登记在生成key前拒绝，原JSON逐字不变、无key、无发布包。邻近测试初写漏传合成原件openOriginal端口曾报fixture错误，修正后通过，不归因为产品缺陷。

新包142/142文件SHA、376 AST相对边闭合与audit一致已独立核对，95个原baseline保持（另四个原imports文件已转为第一批已审显式来源overlay），来源session-cache SHA保持；合成port0 health三个相邻能力1，包内独立program SDK实际HTTP收发保持legacy owner。证据 `signer-fixed-freeze-independent.json`。比较工作区时发现trust/app/export/config/replication/library-store/tools等7个并行源码已漂移，校验器对“工作区必须相等”的断言如实报警；**不把报警当冻包损坏，也不批准这些live新版本**。本批真实HTTP反例和5专项直接import稳定冻包，未拿工作区测试冒称旧包通过。

**修后142的feeds/签名/注册/导出服务器范围分项通过**，unsigned prepare预检不自动取得离线信任。新native/client TOFU+pin、首次离线活动读写/全文与原件/重开/联网CAS仍待另冻交审，没有将本批签发通过外推为完整离线客户端完成。

### 纯编辑时钟：P1未过，禁止自动正文合流

原8项独立实际复跑通过，覆盖HLC持久重开、时间回拨、ACK重试不重盖时间、同毫秒顺序、撤回终态、正文并发与旧未知时间；自写有效同实体多级因果链亦过。但独立第1反例失败：当前同一diary/body两操作均baseRevision=7，right.parent指向foreign-bridge；history中另一篇diary的foreign-bridge.parent指向left。descends不验证history实体/type/scope，错误返回causal-successor而直接覆盖一个真正同基线正文版本。证据 `edit-clock-first.log`，脚本 `independent-edit-clock.mjs`。已发作者/根，当前尚未接线，无正式数据影响；修复前**不批准自动正文合流**。

可复用的有限范围是纯HLC生成/比较、不可变retry和经owner验证的输入规划。接线还必须：server由自身登记的op/版本验证因果，不信客户端自报parent或resultRevision==baseRevision；按业务根/字段维护版本，不借Entry聚合revision决定正文胜负；校验history范围/唯一操作ID/循环。withdraw planner的recoverableRevisions目前可携带原正文，不得默认为远端持久/种子内容；须输出无正文墓碑，本机恢复另显式私有路径。已知墓碑只能由原replacement规则与显式授权恢复，不由普通late edit复活。当前两个真实冲突无可靠editedAt，继续保留双方，不用HLC回填历史或猜胜者。

下一离线feature必须补反例：程序/评论撤回可不推进shared seq，同watermark而不同feedRevision的旧signed包不可覆盖本机已知墓碑/更高message revision或离线新稿；feedRevision是hash不能排序。服务器地址迁移、鉴权凭据再配对不得重建业务library/epoch/source/message身份，也不应把配对credential deviceId当作可随server地址重置的本机编辑clock身份。本批不审批实际接线、迁移或正式部署。

## 第四批独审：来源冲突144、signed offline61与clock续审

### 来源冲突仅保留两版：接口与冻结分项通过

候选 `outputs/backend-runtimes/20261019-shared-business-1792443736495/runtime-manifest.json`，SHA `ed1c8b757986e1d3f330d1076004cb5df5affd8dd0114c0b94099b0c9492eebd`；独立核144/144文件SHA、385 AST相对边与audit闭合，95原baseline/来源cache保持，包内program SDK合成port0收发仍legacy owner，三个原相邻health能力为1。证据 `source144-freeze-independent.json` / `recheck-source144-freeze.log`。不使用当前文件是否相等替代冻结校验；本次核验时这个后端范围恰无workspaceDrift，不代表之后的新工作区被批准。

稳定 `server.mjs` SHA `32de7406881597a51146eae77c5d65c63580cda3fd1b58bfe86eaddfdff9851a` 已独立核，并实际从稳定入口、显式DIARY_BACKEND_MANIFEST/共享配置与合成data启动，固定来源口返回预期400而非404；日志 `recheck-source144-stable-launcher.log`，1/1通过，未启动正式监听或改指针。配置默认关闭，仅enabled且绝对exports根启用；actual loopback/原Host、Origin、解锁管理员保护不接受Bearer/device身份替代。

冻结原4项＋独立新增3项真实HTTP共7/7通过，日志 `recheck-source144-boundaries.log`。独立反例验证：成员损坏、manifest替换、exports内junction和调用方sourcePayload均拒绝且整个JSON不提交；登记前第二条父消息已撤回使整批拒绝，不先提交第一条；登记后原withdraw同JSON提交清掉冲突两版及嵌套字段，在pull与重新实际导出/prepare的signed syseed中均无旧source正文，重启同op重放仍terminal。原4项另覆盖精确两条CAS第二项失败全部回滚、坏proof品牌、未知ACK沿耐久同op、隐藏/草稿/删除/缺父终态。新增撤回前拒绝用实际HTTP，未冒称另做了重复parent ID动态反例。测试只用合成私有tmp/port0。

**只批准这两个无可靠版本证据的纯文本冲突的受控保留域及只读shared投影。** 未选择胜者，不改原消息/Entry，不开放一般来源写入或自动晚写；真实两条冲突未提交。原件、设置/目录映射与完整sourceReceipt/coverage不是此接口的成功含义。

### 受控rollout方案：方向可用，待精确执行门槛

已读COMPUTER-COLLECTION-CONTINUOUS-SYNC本轮七步方案，正常LocalSaveAck、runner await停止、所有writer真实排空、idle deadline窗口、整集合备份、原owner身份初始化、同schema回退方向符合要求。该文档目前是方案，不能直接当执行脚本放行。执行前仍须根提交精确已审最终候选与同schema安全回退包、原配置/稳定launcher SHA、当时进程路径/创建时间/指针，以及当前所有writer/runner/upload/导入请求的有限排空回执；原FIFO无barrier就不能虚构，有路径未证即停。必须把实际最近idle deadline和中止门槛纳入有限维护窗口，不靠固定sleep猜排空。

私有备份应包含JSON/原件/导入档/.shared-auth签名key及授权数据库WAL/配置/指针/profile恢复材料，全树拒reparse、前后逐件SHA；旧脚本PID/指针常量不可直接使用。Windows核身份Stop-Process只能在上述条件满足后称已排空停止，不能称优雅SIGTERM。首次key生成后补入备份；产生新shared回执后禁止静默退旧nonshared包并沿旧cursor继续。**本代理未批准实际部署或执行维护**，正式指针仍chat-reedit2。

### signed offline61：首启离线数据能力分项通过

冻结 `data-candidate-1792443858794/data-manifest.json` SHA `4049342476d981ca083e624ef56bcfd4be57081dae22f1d4aa04d785436e639e`。独立61/61源SHA、22Java、两个bundle闭包/重建逐字节相同，无owned页面入口；两个rich editor解析例外输出仍0字节。Android219776B/SHA `e97d47342f7a16dde0e5cb1b2968d621f11ee3380c3f5f40015681ccf5457a77`，PC231524B/SHA `5ba7399a46e36867e15a501d3d23d74d00da19c15e576a3a598d0e35548bcea3`。证据 `signed-offline61-freeze-independent.json` / `recheck-signed-offline61-freeze.log`。

独立新建QA，后端取上述144已冻结文件、客户端只覆盖本61源，测试/Java probe取signed-offline原证据快照并逐SHA对照，不使用随后localACK/clock生产漂移。原20项实际复跑20/20，日志 `recheck-signedoffline61-existing.log`，含静态无runtime inspect、首次显式TOFU后active实体/feed/原件/游标与pin、两runtime零网络构造/断网start/冷重建、同seq不同feedRevision旧包不复活已知撤回、重连先权威撤回再发送离线改稿、换key/假品牌拒绝、IDB pin发布事务abort、同原owner改URL、真实Java ticket/容器所有权与Ed25519正反签名。实际Java是host执行，不是Android设备；Android36编译按实施者证据及同SHA范围复用，不称安装或设备验签。

独立新增5个反例5/5通过，日志 `recheck-independent-signedoffline61-boundaries-final.log`：

- inspect成功只给完整字节/真实签名摘要，不pin、不发布；用户看到指纹后源包成员被改，import再次全hash拒绝且草稿保留，原好包随后全离线成功，冷重开未知Entry字段保持。
- 异步信任确认回调内取消，关闭重开后仍无pin/active实体，原草稿保留。
- 已初始化库的旧同包离线重导不盖较新的完整评论inbox/本地正文/outbox；不仅覆盖withdraw单一情形，feedsPublished=0且已有outbox逐字相同。
- native inspect面对真实坏签名直接拒绝，不调用返回true的fallback；只close自己已归属ticket一次。
- 首次含程序评论feed的发布，在真实IDB事务已写inbox及pin后、commit前注入abort，pin、active正文与inbox共同回滚，旧草稿保留，不半批可见。

自写脚本最初两项夹具误用read记录的data层级、save漏expectedLocalRevision导致错误；修正夹具后通过，初日志 `independent-signedoffline61-boundaries.log` 保留，不归因为产品修复。脚本 `tmp/shared-business-independent-review/independent-signedoffline-template.mjs` 复制至冻结QA执行，原20项未因此重复跑。

**只批准signed full首次离线激活与显式sync:false本机持久改稿的data seam。** 默认shared-diary保存仍await sync、create/settings optimistic尚有后续接线工作，PC产品Entry页面仍原HTTP；因此用户要求的两端完整离线页面、默认本机ACK、停本机backend的实际产品冷开读写没有通过。也未验真实3.33GB全包/全量UI/手机或5554、实际原owner上线。首次指纹必须用户显式选择，迁址不重建library/epoch/key/message/source；未知key或网络失败只阻同步，不抹本机数据。新localACK/clock工作树须下一独立scope，不能借本61冻结外推。

### clock续审：原跨实体修复通过，撤回重放另有P1

交审clock候选 `0c88917208abd8d6296b82f602f9d6346f4098bd55650c9a230da871cf2ab2bd` 的原跨实体history反例与有效同scope链已通过。新增raw resultRevision不作因果、仅显式owner verifiedRevisionEdges、未知edge/cycle/op碰撞边界亦通过；原10＋独立原2＋新3合计14/15通过，日志 `recheck-edit-clock-second.log`。

新增P1：同operationId相等分支在withdraw scrub前返回same/原op/variants=[op]。正常撤回重放已违反空revisions；若旧撤回对象含value或unknown.nestedBody则原样出现在winner/recoverable中，实际独立小证明containsBody=true。这会让owner按planner持久恢复历史/种子时泄漏墓碑正文。`independent-edit-clock-recheck.mjs` 第3例失败，已交根/作者，原证据保留；同op碰撞仍须拒绝，但相同撤回也必须白名单tombstone+空variants/recoverable。当前未接线/无正式影响，修复前clock自动正文合流及撤回规划仍不放行。

作者随后仅补相同withdraw操作的白名单分支，最终纯模块SHA `686528491297be4fd58d0238961ea5e8f1ad061cd44a57d33906bfce47aa87e5`；独立原15例实际15/15通过，日志 `recheck-edit-clock-terminal-replay.log`。原跨实体P1与本轮withdraw replay P1均按原例修复通过；旧失败/旧候选不覆盖。配套草案此次SHA `f8be494dc264770a34ae47b9806c87092b5379e72698ca349325ec3323280ce8`。**仅纯时钟/成对规划算法分项通过**：调用者仍须从原owner登记账本构造经过校验的同根同字段操作和verifiedRevisionEdges，不能把客户端自报parent/结果版本当授权；真正本机clock+业务+outbox同事务、服务端因果认证、多头版本/消息根/后继接线与实际页面均待后续候选。此批准不等于允许把raw wire直接交planner自动覆盖正文，也不等于本轮两个真实旧冲突可用新时钟猜胜者。

## 第五批进行中：local-first窄冻结发现两项阻断

已独立核backend144 `20261019-shared-local-first-1792445098721` manifest SHA `4275b15e8d41fdedddbe87cd93fba2f43ca7ec77617548ecb3102c6da40a5e57`、client61 `local-first-client-1792445098721` manifest SHA `2d8af5d6f0fed0b94baa4fcec41df375e49efac523a35d8abde33ffc23ef2909`，只分别覆盖已审144/61上的三文件，无额外生产增量；backend390 AST相对依赖闭合/audit相等。隔离QA仅复制这些冻结源。两个bundle逐字节重建，Android236679B/SHA `c46a843dcb0624c4cf81db144bd7f40b3ec0f325a4f33fb21cc9fb3c0bbf2112`，PC248683B/SHA `3e32e47e4be9e09ff9e56a942f2c67004d1b3a0205b1caacbf45bb492a061adb`；元数据闭包无外部imports，两editor parseOnly仍0输出。证据 `localfirst-freeze-independent.json` / `localfirst-bundles-independent.json`。通用旧bundle校验器第一次因新metafile路径含冻结目录前缀断言失败，已独立按其精确prefix校验/重建，不当作生产缺陷。

与六文件直接有关的本机/HTTP原12场景实际12/12，日志 `recheck-localfirst-existing.log`；新增四场景2过2失败，日志 `independent-localfirst-second.log`，脚本 `independent-localfirst-template.mjs`。通过的是新Entry离线create→两次save→冷重开→服务实际提交后丢ACK→同wire排空，最终同ID仅一Entry；foreign Entry可信回执不能授权另一Entry，拒绝后JSON/receipt不变。未重复旧完整81/设备/全库矩阵。

- **P1：已有权威Entry的第二次断网保存失败。** 第一次save以原entry-save入队，第二次save看见该pending head后抛SHARED_ENTRY_DEPENDENCY_UNSUPPORTED，尚未本机提交第二份正文。依赖选择与server白名单只支持entry-create-local/entry-save-local，不能把默认本机ACK解释为已支持导入老日记的持续离线编辑。定位交审diary-client的head白名单及service依赖action验证；须保不可变旧wire和同owner receipt/CAS，不能换op覆盖旧pending。
- **P1：合法省略可选字段的新房不能接着离线改名。** create仅传title/category/idleHours/mode已返回本机ACK，接着update title从未规范化本地投影拿到undefined的selfName/description等，wire inert报SHARED_INVALID_JSON；完整字段夹具未覆盖。定位directory-client.create optimistic和update完整输入构造。应将本机默认值与原server规范化口径对齐，不能等首次网络ACK才变为可编辑。

已立即交根与作者原反例，**此候选尚不放行**，旧签名61/来源144范围保持。首写独立夹具误把原POST201当200已纠正，第二轮日志是实际上述失败；不归因该夹具错误为生产缺陷。修复后仅原反例及必要相邻续审，不拿后续live源套旧冻结。

随后第二冻backend144 `20261019-shared-local-first-1792445580309` / SHA `34c22185093319c8fd283ca24e4bb0cf3005d39d7ae520b1408740a51927781b`，client61 `local-first-client-1792445580309` / SHA `cd8ef5c248e5e5104e4b58b5409137130f4933e40cd4df4755bf7887661e2048`，独立再次确认只是同六overlay、390 AST闭包，重建新的冻结QA，不替换原失败包。原两P1与独立6例实际6/6通过，日志 `recheck-localfirst-fixed-originals.log`：已有Entry同库旧entry-save/ref/delete/restore回执现可作为可信依赖且仍CAS；partial新房两端默认一致，create/edit/两次list-state/order/真实journal-send沿同一source/room排空；默认本机ACK确实在后台info仍等待时返回；旧cap服务blocked后显式retry-unchanged可在升级后原wire提交。首冻仍保留不可发布记录，第二冻此时没有被当作全面通过。

必要同类相邻又复现**P1：已有权威会话的连续离线编辑会与自己冲突**。导入或新房第一次ACK后，断网两次directory.update均本机成功，但两条仍是conversation-save、相同expectedRevision，第二条不指向第一条；联网排空第一条成功、第二条409 SHARED_BUSINESS_CONFLICT。本机正文未丢，但已知同端因果被错误当并发且不能完成接续。`independent-localfirst-template.mjs` 最后一例，日志 `independent-localfirst-existing-room.log`，实际隔离第二冻。须把同房普通conversation-save可信回执纳入依赖，不放宽跨房/CAS或修改已提交wire。已交根/作者；**第二冻在此反例修复前仍不放行**。

第三冻backend144 `20261019-shared-local-first-1792445944342` / SHA `c25201b8a96625e54632e630250757f87fec298eafb43b7de1240689b07a46b6`、client61 `local-first-client-1792445944342` / SHA `04ab9c02280e688ae345106b64727e562c4d6a886b6aa34f12926f005712f71d` 已独立再核144/61逐SHA、相对已审base精确六overlay和390 AST/audit闭包。第三冻修同房普通conversation-save可信parent，新增state专用conversation-state-local，分别取同房listStateRevision，order只取目录revision；旧已提交wire不改写。原12项中未变的本机enqueue/committedLocalRevision/strict错误/Entry回执边界按精确diff复用，不重跑整45或旧81。

独立原7例及必要2邻近实际覆盖9个场景：原7和no-op状态链通过，日志 `recheck-localfirst-third-boundaries.log`；foreign-parent夹具最初省略原conversation-save必需完整字段导致400，补齐夹具后该项单独通过，日志 `recheck-localfirst-third-foreign-parent.log`，未改生产。原三个P1按原例均已通过。新增确认跨房profile parent与同房错域state parent不能授权，原JSON/receipt逐字保持；先对已置顶房再次置顶（server no-op），再离线归档/排序，实际同owner排空成功，不用猜递增revision。这是实际HTTP/IDB，未把施工方原7/5的自测直接算作本代理执行。

第三冻双bundle闭包/逐字节重建通过：Android237590B/SHA `2d6eca2d0592ceb9a4169c52efe224e9c1b4beae445b9e75b2aa324a0a84e47d`，PC249594B/SHA `a1506256031bf8936c737f76b97bb8e3b8cd303f3faf870e894324036a0b6b40`，证据 `localfirst-third-freeze-independent.json` / `localfirst-third-bundles-independent.json`。**第三冻local-first Entry/会话创建与连续本机编辑、不可变依赖、默认本机ACK及指定回执/CAS范围分项通过**；首/第二问题包保留失败，不可发布。

仍未验大于4MiB的新Entry路径、全部设置规范化/恢复、真实UI/Repository与停本机backend的实际产品冷开；编辑clock与业务/outbox同事务尚未接，普通消息edit domain另候选。测试没有把>4MiB、所有设置或页面扩为通过。新组合如同时合入knownrefs/source149或消息编辑，须另做精确组合冻结，不可把几个独立包任意拼接后称本次已审；本代理没有正式部署/手机/5554操作。

### 来源采集recipe/同owner receipt149：分项通过

候选 `outputs/backend-runtimes/20261019-shared-business-1792445229399` manifest SHA `633399b4960abd38be666bef6348e4714e37ffe15758a9661bf2a77f5286f50d` 独立149/149 SHA、410 AST相对边/audit闭合。实际相对144为12个不同/新增路径：本scope九路径及三新增纯投影依赖；三依赖directory adapter/port/preference-capture逐SHA等已审61。五个新增文件包括这三个依赖与recipe/commit两个模块；未混localfirst的service/directory/entries三源。证据 `source149-freeze-independent.json`，不把两个并行包互相替代。

冻结内原11项实际11/11，日志 `recheck-source149-existing.log`；独立新增4项4/4，日志 `recheck-independent-source149-boundaries-final.log`，覆盖：

- actual apply拒绝调用方computerComplete和错误epoch，JSON不提交；合法apply明确computerComplete=false。随后用户通过实际shared口改偏好，再重启、同op重放，保持用户新值与原receipt逐字不动，不重新套旧source。
- 已完整核capture及server原件、获得私有品牌后，原消息目标在commit前变化则SOURCE_COLLECTION_TARGET_CHANGED，无receipt；手造recipe/complete对象不能替代私有品牌。
- 新增sticker.mediaId及desktop固定global wallpaperAssetId两种已知引用缺原件会拒绝；未知偏好字符串不被猜成asset。
- 用真实canonical信封/成员SHA构造旧core包，执行实际streamed prepare；只缺新增已知指针的原件仍明确拒绝，不是仅测试字符串或调用一个未接入函数。

原11项另覆盖四个真实原件上传/全文SHA与图片格式头校验、晚sticker失败使profiles/order/preferences/wallpaper/receipt原JSON全回滚、CLI丢ACK耐久同op/重启无重复、实际signed导出读取保原件。图片检查为原既有格式/MIME头预检，不外推全像素解码。新增第1夹具最初经computerOwnerTransport期待具体409 code，而该transport对这类后端格式只报COMPUTER_OWNER_REQUEST_FAILED；已改用实际raw HTTP确认409/SHARED_LIBRARY_MISMATCH，无产品修复，初失败日志保留。

**批准原owner有界采集提交器、耐久历史receipt及public shared-seed.js已知引用校验exact delta。** 新shared-seed.js直接来自149冻结并实际prepare验证；原61的旧bundle没有此增量，不能称已包含新校验，最终client组合冻结仍须精确纳入。CLI只走固定HTTP/原owner，未另进程写业务JSON。实际owner/两条真实冲突/四个真实缺SHA均未提交；真实原件整包及前端恢复未验。

这个receipt是当时已核映射的历史回执，不是当前仍新鲜的全电脑证明。rendererRestoration仍pending、computerComplete=false；关闭自动归篇或无link新房的后续消息持续端口仍未接。source capture当时525条无missing不能消除该缺口，可信freshness/最终coverage evaluator尚未交审；不能发布final actual package或以backendMapped当完整交付。本批无正式维护、部署、手机/5554操作。

随后补交对应knownrefs单源客户端冻结 `data-knownrefs-1792445885744`，manifest SHA `a2e96f9ae2ce07d97b52adb903bc8fd31f84fdca36faa959953fbde1ec02c081`。独立核61/61源与22Java、相对approved61唯一shared-seed.js，且该模块SHA完全等上述149已测版本，故复用已知引用/实际streamed prepare反例，不重复同SHA aux测试。双bundle闭包及冻结sources重建逐字节一致：Android SHA `0ff570755001127c31d43952f94500991820bb386a46f4fe0c978a156bf88f96`，PC `93080d2182cd04da5ecc2e20c8689cd92e9a92c1f9388aaef0651542fb8562be`，证据 `knownrefs61-freeze-independent.json` / `recheck-knownrefs61-bundles.log`。**knownrefs客户端delta通过**，没有混localfirst/UI；两并行client包的任意拼接仍须最终精确组合冻结，不称新组合已审。

## 第六批进行中：普通消息编辑域独立冻结

候选 `outputs/2026-10-19-local-message-edits/candidate-1792445465815/manifest.json` SHA `401a95ed36011bdfb7ec36b4658a2be0c7247a2ab07b4912e70c6014a399f4fd`，domain SHA `623a75b0653e03199c65936b3c3cd52715e9657ed1ddf9e515e0d83fd892ce0d`。独立70/70 SHA及174 AST相对边与manifest闭合，证据 `message-edit-freeze-independent.json`。这是domain/实际store＋测试夹具闭包，不是可部署后端包；没有产品service、鉴权路由或client HLC接线。冻结原16域场景实际16/16，日志 `recheck-message-edit-domain16.log`；原pure clock与replacement代码未改，22旧邻近按同SHA复用，不重复跑38全组。运行仅小合成tmp/port0及静态校验，未进行设备、3GB全hash或压力测试，不称全机空载。

独立新增同毫秒/同device/同logical仅operationId决胜的双到达顺序，以及root终态/冷重开迟到编辑均通过；ledger与回执不携正文，旧valid base不能复活。第3个独立边界（脚本中第1例）发现**P1：历史操作回执借当前head/version**：A实际applied→headA/version1，之后B实际applied→headB/version2，再重放A原wire，operationId仍A/outcome applied却返回headB/version2/baseB。原因prepare命中previous后调用receipt(record当前root)，没有使用已登记operations中的A head/version，晚ACK会让B授权代际冒成A。本代理实际失败 `independent-message-edits-first.log`、脚本 `independent-message-edits.mjs`；root已认可应历史committed映射与current head分字段，terminal继续优先无正文，禁止回生。**此旧候选不可接service/UI，待作者修复后原例复审**。当前无正式/客户端影响，本代理不修改生产代码。

上一批被问到的两份实际证据已再次只读核实存在：`D:/拾页/outputs/2026-10-19-shared-business-independent-review/recheck-localfirst-third-boundaries.log`（2237B，8过及1个夹具字段失败保留），`D:/拾页/outputs/2026-10-19-shared-business-independent-review/recheck-localfirst-third-foreign-parent.log`（248B，补齐原API完整字段后该1例独立通过）。报告的9个distinct场景是跨两日志，不冒称首日志本身9/9；无需重跑或覆盖失败。

### 第六批消息编辑域P1：仅domain范围复审通过

最终窄修 `outputs/2026-10-19-local-message-edits/receipt-fix-1792446892416/manifest.json` SHA `0230e7a05a10e738a484ea39ada98323850889fe91c4fe107ea1318639b3fd5d`，独立70/70源SHA、174 AST闭合；相对旧401a精确只有domain与测试两项。原3个独立场景3/3通过，日志 `outputs/2026-10-19-shared-business-independent-review/independent-message-edits-receipt-final.log`。另定向复跑新增历史applied与superseded回执、重启、root终态1例通过，日志 `recheck-message-receipt-history-reopen.log`。A重放保留A提交时head/version/base，当前B另列currentHead；撤回terminal优先body-free/base:null，旧回执不复活。冻结证据 `message-edit-fixed-freeze-independent.json`。其余原16与22邻近按未改SHA复用，不另跑39全组。

中间 `candidate-1792446459246` manifest f3c1989...虽原例3/3通过，但实际误抓live directory.mjs成为第三delta，本代理独立检出且作者确认冻结工具scope错误；该包弃用作漂移证据。最终0230已从旧70重新取68原字节及两修复源，没有继承这项漂移。旧401a仍保留历史P1失败。**批准最终0230独立编辑domain/store行为；不是产品固定action、鉴权接线、客户端HLC/outbox或UI验收，不能拿此包直接部署。**

## 第七批：source149＋localfirst组合与source152覆盖/维护保护

组合后端 `outputs/backend-runtimes/20261019-shared-composed-1792446215857/runtime-manifest.json` SHA `8082e4ee404d4a170c5bc48e8d2e486f74767223e9298b91f9d2c1fa98093274`：独立149/149 SHA、415 AST闭合，相对已审source149精确仅directory/service/entries三源，逐SHA等已审第三localfirst。组合客户端 `outputs/2026-10-19-shared-business-integration/data-composed-1792446232119/data-manifest.json` SHA `e3eec1e75f44a28bf7e2a0eb11f9a6fcfdb0de96b395075b4f6e3639ff55bf20`：独立61/61及22Java保持，相对knownrefs61仅business/diary/directory三源，逐SHA等第三localfirst；两个bundle由冻结sources独立重建逐字节一致、无外部依赖/UI入口，Android SHA `b8d5feced9dc4b140c544b8e5adc8b79d169b98aa343a379837a52593598db04`，PC `3ee1357b5ef9c5f3a2ceb8f05683950fbc42067ba61a1142b1bdbd56e6d7d8eb`。证据 `source152-composed-freeze-independent.json`、`composed61-bundles-independent.json`、`composed61-bundles.log`。

独立QA仅用这两个冻结源拼接；分别实际通过source四原件＋冲突/映射→signed seed，以及离线Entry＋新房依赖队列回原owner两个直接整合场景。第一轮QA遗漏不属于runtime闭包的已审capture测试辅助文件，故source测试模块未加载、offline例已通过；只补从149冻结取得的辅助capture模块后单独source例通过。原日志 `composed-two-integration.log` 保留，补后 `composed-source-integration-fixed-fixture.log`。**批准此149/61精确数据组合；未包含下述152 coverage/rollout、query port、消息编辑service、产品页面或正式启用。** 原先>4MiB新Entry、全部设置恢复、真实产品停backend冷开、大包/设备边界继续未验。

### source152：P1完整性虚报，暂不通过

`outputs/backend-runtimes/20261019-shared-business-1792446001549/runtime-manifest.json` SHA `76b7171cd298a380851af44991730747f45637641cd095d1250a6a16b5bffc6c`，独立152/152 SHA与418 AST闭合，相对已审149精确五路径（coverage/export/rollout guard与两CLI），没有localfirst半段。冻结原7个小合成测试实际7/7，证据 `recheck-source152-existing.log`；这不能消除以下反例。

**P1：当前shared seq/index不证明legacy feed新鲜，旧包被错误标完整。** 独立实际HTTP先提交source映射，导出并永久登记signed v2 full seed，baseline snapshotComplete=true；随后通过原legacy服务口撤回程序评论，确认shared seq保持、feedRevision改变且当前评论为withdrawn。对原signed包调用evaluateComputerExportCoverage却仍返回snapshotComplete/completeComputerExport=true。该函数只核静态已登记feedRosterDigest及当前shared index，未核当前legacy消息流代际，可能把已撤回正文所在旧包称为完整当前采集材料。脚本 `tmp/shared-business-independent-review/independent-source152.mjs` / `source152-fixture.mjs`，真实失败 `outputs/2026-10-19-shared-business-independent-review/independent-source152-large-comment.log`。本例全部合成数据；0.57MiB文字只用于触发原既有descriptor/完整canonical投影，没有真实正文或凭据输出。

最初手造小评论基线在register报SHARED_SEED_INVALID_JSON；尚未排除缺fixture字段，不作为另一产品缺陷、不把那几份基线失败当覆盖P1证据。只有上述已实际完成导出/登记baseline后失败的日志支持此P1。root/data已收到，须以当前feedRevision/实际feed roster代际补一致性证据后原例复审；**旧152不能批准complete判定或final actual package，原149历史receipt批准保持。**

### rollout guard：只批准静态/合成保护范围，不批准实际维护

只读审查确认：显式planSHA＋execute才可能变更；默认check；核包/客户端/原launcher/pointer/config/JSON SHA、PID路径/启动时刻/命令行、五类近期排空证据与raw ACK、全部revisit实例、无连接、归篇deadline余量；全dataDir含private key/auth/WAL、profile及配置逐SHA备份；拒reparse；重启后同owner/epoch与health核对，返回clientsMayResume=false并要求新身份后备份。没有把Windows Stop-Process称SIGTERM或正常保存，实际Windows停止/切pointer/启动分支均未执行。

独立额外小合成验证：复用PID但启动时刻变、错library身份、遗漏实际runner实例均拒绝；内层junction递归前拒绝。证据 `independent-rollout152.log`（前者通过，后者实际已拒但夹具预期code错写POINT而失败保留）；纠正为真实ROLLOUT_REPARSE后只重跑该例通过，`independent-rollout152-junction-code.log`。这只是guard行为验证，不是实机维护放行。正式执行仍须root统一协调：实际前端正常保存/标准停、原件准备/上传/导入/外部writer及后台runner真实排空，近期原始ACK与process精确身份、稳定私有全量备份/可用容量、已审最终同schema组合与rollback、共享loopback配置、窗口deadline余量及恢复方案；不得以这三类synthetic测试或手填complete替代。原owner首次真实identity及随后实际包resolve/全SHA还未发生，不能结项。

本批均小型合成tmp/port0＋静态冻结核验；未执行维护/部署、个人正文修改、手机/5554、3GB哈希或设备压力测试，不宣称全机空载。查询sidecar/新message service为下一独立scope，本报告不越权外推。

## 第八批：coverage P1窄修与日记查询骨架

### coverage：三源修复复审通过

新 `outputs/backend-runtimes/20261019-shared-coverage-fix-1792447177016/runtime-manifest.json` SHA `2835995054d7ad0135f757eb659fb0ac400af61904a37e18c06e9d516b7ed29e`，独立152/152源SHA、422 AST闭合，相对问题76b7仅computer-coverage/computer-export/source-collection三源，证据 `outputs/2026-10-19-shared-business-independent-review/coverage-fix-freeze-independent.json`。未混live localfirst/query/message service源。

原独立脚本与原fixture保留；新增runner副本仅切全部app/helper imports到新冻结，并追加实际coverage HTTP断言。signed export/永久登记基线仍snapshotComplete=true；实际legacy comment withdraw后同shared seq、feedRevision变化，新actual owner coverage与detached预览均false，明确current-feed-generation-not-packaged。原失败例实际1/1通过，`independent-source152-fixed.log`。另只复跑新正向四原件signed映射与current owner feed proof两个直接邻近（同seq edit/withdraw、旧合法register重放、旧db不能true、中途COW变化busy）2/2通过，`recheck-coverage-fix-neighbors.log`。没有重跑原7或无关库/设备矩阵。

修复将同步evaluate降为缺私有current proof时永不true；只读localadmin `/api/source-collection/coverage` 从原store getDb钉一个不可变COW，核当前global feedRevision、完整feed descriptor/parts/roster，末getDb身份变则409 SOURCE_COVERAGE_BUSY。CLI显式sourceOperation时从actual owner固定HTTP取证明，不拿本机读出的旧JSON自证当前。**该三源coverage范围P1关闭，可分项通过；旧76b7判定仍不可发布。** 历史包可合法resolve不意味着其为当前完整代际，这两类语义保留。

正式maintenanceReady仍false：当前read-only preflight并未证明uploads/imports/所有其他requests排空，没有actual stop/config/write。本次不授权维护；前述真实quiescence/最终同schema包/全私有备份与恢复门槛继续有效。

### diary-port62：分页/索引骨架局部通过，sidecar CAS有P1

冻结 `outputs/2026-10-19-shared-business-integration/diary-port-client-1792446929563/data-manifest.json` SHA `e6a78ecbc70db7f7bc06b84d328959202b4f8fd73fdb799c327f8abc0d78a4b4`，独立62/62源SHA、22Java保持；相对已审第三localfirst61精确五overlay＋shared-diary-index一个新增。两bundle冻结sources独立重建逐字节一致，Android SHA `244453c14a747a7578695739632f1cff069f8a5dedcbbd4db5ea2453d73f20af`，PC `dc55992c023265a640ad86f437d461b16a2c4cb63c42d03e27ce31b2286c105d`，闭包无UI入口/外部依赖，证据 `diary-port62-freeze-independent.json` / `diary-port62-bundles-independent.json`。工作树测试已进入后续product sort，故未用live测试冒充本冻结；从首冻结保留的6项aux测试复制到本冻结QA并实际6/6，aux SHA已记录，日志 `recheck-diary-port62-six.log`。

独立真实fake-IDB事务（三例，使用两独立storage连接）通过的两例为：400个filtered header扫描后空页仍可正确续读，后两页各20、无重复、最后hasMore=false；任一header代际提交使旧cursor stale。实体/header/outbox写后注入abort，页及queryRevision逐字保持、outbox无残留。日志 `independent-diary-port62-first.log` 2过1失败，脚本 `tmp/shared-business-independent-review/independent-diary-port62.mjs`。

**P1：丢弃草稿删除CAS记录导致ABA，可复活旧稿。** 同一Entry localRevision保持1；连接A以draft expectedRevision0保存→rev1，再以expected1 discard，返回rev2但read为null且底层删除记录。旧连接B仍持有最初expected0，保存旧正文被接受（应该冲突），实际复活已丢弃稿。定位冻结 `public/shared/sync-v2-client.js` 的writeDiarySidecar：safe===null直接delete(key)，随后prior?.revision??0把版本归零。discard返回2也无法作为下一保存的有效代际，因库中已无2。应保留无正文的单调tombstone/fence，且调用方能取得当前draft代际后继续正常保存；不能仅把readDraft改null而丢版本。已报root及原作者，待窄修原例复审；本代理不改生产代码。**当前sidecar CAS范围不通过；列表分页/索引和schema升级仅骨架局部通过，不授权该整个62作最终交付。**

该骨架的storage-id-v1不是产品pin/createdAt顺序，query/sort/category/day明确NOT_IMPLEMENTED；search/统计/日历/neighbor/建议标题及Android 31 Java golden仍另批。没有声称产品列表/思绪页面已接，没有真实backend-stop产品冷开、大Entry、完整离线原件编辑或设备验收。新message actualservice153只收到候选信息，未纳入本批。没有新增真实profile采集/读取正文原件，也未扩大SF16发送测试；正式ui49/API与手机/5554未动。

## 第九批：实际message edit service 153分项通过

候选 `outputs/backend-runtimes/20261019-message-edits-1792447465520/runtime-manifest.json` SHA `786abbd316a79058b1c4334da7bde60c772579cf197ab72c8c7c4b6eeed5c84d`，独立153/153源码SHA、424 AST边与audit闭合。相对已审composed149精确六路径：service、replication、domain、message-edit-projection、public protocol和已审同SHA pure clock；未混coverage152/query62/client半段。test-manifest各测试SHA及旧index/签名包夹具所指approved149 manifest `633399b...`亦已独立核。证据 `outputs/2026-10-19-shared-business-independent-review/message153-freeze-independent.json`。

复用0230已审纯domain边界，本scope新增共享协议将headSHA固定为浏览器/服务器相同canonical message＋真实headRevision，去掉transport editBase注解；实际domain仍校canonical unit compatibility、源/作者/原投影与真实head。新authenticatedDeviceId只记真实传输principal，HLC writerUUID不冒充actor。不同于纯域，本批实际shared command分支先核identity/outerop和原鉴权，专门执行domain而不被通用prior receipt提前短路；accepted结果才存全局receipt，unknown-stale诊断提交后再409，无成功ACK。readonly head为派生clone，非新writer，父篇hidden/deleted/draft不泄漏head能力。

实际只重跑新12项服务/升级直接测试，12/12，`recheck-message153-actual-http.log`，没有跑施工方58全组或未改22邻近。覆盖实际command、真实paired Bearer/revoke/re-pair/新port、历史A/currentB分字段、rootterminal优先/旧alias、unknown-stale durable409、作者/伪base/readonly head、signed full实际验签→IDB重开→离线builder→原owner编辑，以及精确approved149旧index/已登记seed迁移并发与写盘失败、marker1禁新编辑写fallback。

独立另加3项实际HTTP反例全部通过，`independent-message153.log`，脚本 `tmp/shared-business-independent-review/independent-message153.mjs`，全部imports从本冻结取：

- 旧149 index且尚未触发shared info时，无Bearer info/describe均401，JSON逐字不变、不生成marker；合法鉴权后才迁marker1。
- 首次migration的JSON.tmp注入故障，info/snapshot/preferences-write三请求并发均500，原JSON/旧index/identity保持；去故障后原immutable preferences op重试只登记一次，library/epoch保持。
- 合法message base搭配错误outer operationId或错误library均拒绝，JSON逐字保持；原正确wire仍可实际applied。

**本批actual backend service/新投影metadata升级范围通过。** `_messageEditProjectionVersion`缺省/0仍旧flatten，首次原owner同COW迁1且禁旧fingerprint快复用；并发gate只迁一次，失败marker/index/body同回滚。旧已登记signed包仍可历史resolve并从原watermark续delta；这不意味着旧包可作当前完整覆盖证明。未shared启用的旧库请求404，不造新identity。原库业务message/Entry保持，新增editBase只在传输clone。

**回退边界不能外推：** marker1已发布后，旧149无projection不能作same-schema回退。只能采用本候选支持marker1且`SHIYE_MESSAGE_EDIT_WRITES=0`的禁新编辑写模式：实际重开保持projection/base/head读，新edit/withdraw503且JSON不变。现独立152 rollout guard对sameSchemaRollback的四文件存在性检查本身不能证明marker1兼容（旧149也具有那些文件）；最终组合/维护plan必须明确锁定已审marker1兼容fallback，若要工具自动拒绝旧149，需要另加能力校验定向审查。该工具不在本153范围，本批不声称维护保护已覆盖此新schema。

旧401a历史ACK P1、f3误抓directory漂移和6d29旧index升级缺陷包均保持不可交付。当前153不含coverage修复、diary query/sidecar、客户端clock/op/outbox/history同IDB事务、两runtime/native action或产品页面；不能称前端支持普通消息HLC编辑，也未验实际页面/真实资料包/手机。最终合包需精确组合再审，不能任意拼已审切片。本批未触正式运行态、配置、资料正文、profile、设备或5554；没有真实stop/升级/维护执行。

## 第十批：产品日记query候选，ABA关闭但全文P1及两项兼容P2未过

最终审指针为 `outputs/2026-10-19-shared-business-integration/diary-product-query-client-1792447883022/data-manifest.json` SHA `ae5474fb96a2215c971a08ea8e5c0f1c1e60cc30f5d7d6f0b4e145f2fb3a40f2`。前一efeb仅格式前候选保留，本批所有实际执行均指向最终ae。独立62/62源SHA、22Java保持；相对e6a骨架仅四个公共模块（index/storage/business/diary），两runtime与其余58源逐字节同基线；两bundle闭包及冻源独立重建逐字节一致，Android SHA `b4ca5c331bb2f18ed8ad076025acd8d42e641e2c8c7d49c543d72af6a692b389`，PC `4c6d2f896b956732f88c6ed11224f116caf4cf0f9bd3a99d629841e96a95546f`。证据 `diary-product62-freeze-independent.json`、`diary-product62-bundles-independent.json`。

**原sidecar ABA P1关闭，仅此修复分项通过。** 原双连接失败脚本保留，新runner只将imports切最终ae，实际1/1通过，日志 `recheck-diary-product62-aba.log`。新增cold reopen实际证明readDraft仍null，readDraftState为无正文revision2/discarded/value:null，旧版本0拒绝，当前fence2可继续保存得3，墓碑不残留被丢弃正文；该独立例通过。e6a旧冻结仍有缺陷，不能倒推旧包通过。

冻结自带12项实际12/12，日志 `recheck-diary-product62-twelve.log`。其中31输入golden与8段source-spans SHA独立核对为原实际JDK结果，分别 `417843b86d898248ce472af3bb4e1f16b3f9d413e456060bd694c36473407156` / `7f9280f5ccd2cbcf7813cb4718d3554d4c2ea8da7f62e66ad14ed08406c123e2`；对照覆盖产品排序/日期/搜索/日历/neighbor/标题算法，但其query输入已是包含searchText的catalog，不能证明真实shared Entry派生完成。新增v2→v3 search投影超限失败例通过：旧schema v2、实体、sidecar保持，未留下diarySearch半升级；不只复用旧v1失败测试。

**P1：正常shared Entry正文未纳入全文索引。** 独立用最终公共diary.create实际创建标准HTML Entry（仅content含唯一词、title无该词、未提供派生searchText，sync:false），随后diary.listPage按该正文词搜索实际[]，应返回该Entry。diarySearchFromEntity只读取调用者data.searchText/title/preview/tags，没有从真实Entry content/canonical派生；正常create/save/seed/pull不能依靠页面提供一个正确且持续刷新的searchText背书。原失败脚本 `tmp/shared-business-independent-review/independent-diary-product-boundaries.mjs` 第1例，实际日志 `outputs/2026-10-19-shared-business-independent-review/independent-diary-product-boundaries.log`（另cold fence与v2失败原子性2例通过）。root已确认P1，要求作者后续以实际create/save/seed/pull路径验证正文格式派生，不以预生成catalog fixture替代。

必要小JDK对照另发现两个**P2查询兼容差异**，均实际重新编译原verbatim Java wrapper：独立核8段冻结source-spans都逐字包含，org.json jar SHA同原31证据，只新增两个合成输入，不重跑/改写原golden：

- 日期token边界：标题x、日期2026-10-19，query `x2026-10-19`，Java原数字负向边界识别日期并留下词x，结果[x]；新JS DATE_TOKEN的\\b不识别ASCII字母邻接日期，实际[]。
- haystack字段隔断：query `null2026`，Java tags与day之间空格使结果[]；新JS拼接少这一个空格，未设置tags时null与2026粘连，错误命中[x]。

证据 `diary-product-java-boundaries.json` / `diary-product-java-boundaries.log`，脚本 `tmp/shared-business-independent-review/independent-diary-java-boundaries.mjs`。这两项是原查询算法的直接移植偏差，不是Android设备/native UI行为，也不把当前JDK wrapper当真实SQLite/native adapter验收。

**最终ae整个产品query候选不通过，需修全文P1与上述两P2后窄复审；ABA修复及已列事务/排序夹具局部证据保持。** suggestedTitle的sourceCoverage.complete/productComplete仍是调用者信封前提，不视为已经验证native真实来源完整；未连接adapter时不批准产品标题计数/页面。当前仅公共port候选，没有真实产品冷开/停止backend、原件新增编辑/大包/设备/正式部署结论。仅小合成IDB与2个JDK查询输入；无真实profile新采、正文/原件读取、正式发送或SF16扩矩阵，未动正式运行态/5554/手机。新156维护组合与客户端HLC是后续独立scope，已收到但未纳入本批。

## 第十一批：最终维护组合156通过；query修复原例通过、两项新P2待修

### 156候选与同码回退：没有新增候选代码blocking，实际维护仍待真实排空

主候选 `outputs/backend-runtimes/20261019-shared-rollout-marker1-1792447921466/runtime-manifest.json` SHA `9e080882a802e9a364c87e0760432ca5bf4543ca0ad9f03117f00e37000a1ad2`；回退副本 `outputs/backend-runtimes/20261019-shared-marker1-fallback-1792447921466/runtime-manifest.json` SHA `11708e630ea1a3a8810eb16b4fffd1402c14847bfafbdff35e692860cff44da7`。独立两包各156源全SHA核对、所有生产源彼此逐字节相同、主436 AST闭合；相对已审786a仅四个coverage/export/route/CLI源逐SHA等已审2835，加两个新guard/tool。未抓live query/HLC源，回退是同代码的可信启动环境 `SHIYE_MESSAGE_EDIT_WRITES=0`，不是另一套业务实现。证据 `outputs/2026-10-19-shared-business-independent-review/rollout156-freeze-independent.json`。

新守卫hard-pin六个marker1实现模块SHA，逐项核等已审786a（clock/protocol/domain/projection/replication/service），先核实际所有文件，再核这些固定SHA；独立实际verifyFrozenRelease接受主/回退，旧149虽有四个同名文件仍拒绝ROLLOUT_MARKER1_READER_REQUIRED。CLI要求plan.messageEditWrites明确bool，rollback启动环境强制0；正常switch亦显式覆盖该变量，不能继承旧环境误开新编辑。禁写fallback仍保持marker1投影、head/base与索引读取，edit/withdraw503。

只复跑四个直接整合场景，实际4/4：source四原件/冲突/映射→signed full、同seq runtime变化的覆盖拒绝、marker1同码禁写实际重开、旧149硬拒/新reader通过。日志 `recheck-rollout156-four.log`。已过同SHA原owner业务/媒体/身份/clock等继续复用，不重复全组。**本156代码组合及维护工具范围通过，没有发现新增代码阻塞。** 此结论允许root继续准备受控维护方案，不代表当前机器已排空。

**实际执行blocking仍明确存在：** 尚无本轮同一窗口内完整近期前端正常保存＋标准停/File准备/附件/编辑明确false、legacy及conversation runner运行/在途与完整实例、上传/导入及其他请求/外部writer已停的原始ACK/status。必须由root统一窗口收齐原始证据和精确process/launcher/pointer/config/JSON SHA、无连接与idle期限；不能用既有synthetic或complete封套自己证明排空。全dataDir含原件/key/auth/WAL、PC profile与配置/launcher必须私有稳定全SHA备份、实际容量充分；再核近期ACK后才允许受控切换。新owner启动后保持clientsMayResume=false、postInitializationBackupRequired=true，核原identity/key/auth并做后备份、确认runner状态后才恢复客户端。没有把health成功当完成维护，没有授权丢新写回旧JSON，也没有把旧149当回退。实际Windows Stop/Start分支本代理未运行，正式服务/profile/设备未动。

### query修复63：原HTML P1及Java两P2关闭，两项新格式/缓存P2未过

候选 `outputs/2026-10-19-shared-business-integration/diary-query-repair-client-1792449026276/data-manifest.json` SHA `445347a16b2faf9825f1349ca9177b2140cf9b0f6b048d64a7aedf201daba215`。独立63/63源SHA、22Java保持；相对ae仅shared-diary-index.js及新增public/editor/content.js。后者是原只读sanitize/textOf纯工具，未引编辑器renderer/schema/UI入口；两个bundle冻结源重建逐字节一致，Android `abe3f29d0956738327dc15dd35ad89a4c6cec9f8d5756382208d8feea78aad51`、PC `dbf6a4e225ac497f77d53104e3b33d63c7b5dbad8419a0e6672102803d36cb34`，无外部依赖。证据 `diary-repair63-freeze-independent.json` / `diary-repair63-bundles-independent.json`。

原正常public diary.create仅HTML content含词的全文P1，原runner切冻结imports后实际通过，`diary-repair-original-p1.log`。两项原真Java小对照（字母邻接日期token、tags/day空格）以原JDK wrapper再次实际核均相等，`diary-repair-original-java.log` / `diary-repair-java-boundaries.json`，原两P2关闭。5个直接新增邻近实际5/5，`recheck-diary-repair-five.log`：create/save、snapshot/pull替换索引、原Java差异、真实DOMParser中文/实体/隐藏脚本及richdoc、1.1MiB markup仅少量可见正文按可见投影预算处理。旧ABA/升级/其余golden路径同SHA证据复用，未重复17全组。

实际signed seed索引另1/1：先核原辅助测试SHA为manifest登记的 `61630ab6...`，复制runner仅把server imports固定到已审156、client imports固定到本63，各自相对闭包保原冻结，不把两套重叠模块任意覆盖；实际导出签名包→断服务显式pin导入→正文搜索→IDB冷重开仍可查，日志 `diary-repair-signed-seed.log`。不是只伪造snapshot或调用者complete信封。

独立格式/缓存三例1过2失败，`independent-diary-repair-formats.log`，脚本 `tmp/shared-business-independent-review/independent-diary-repair-formats.mjs`。带已渲染HTML的Markdown及canonical richdoc通过。两个新**P2**已一次汇总给root，待作者窄修：

- source-only Markdown：合法离线public diary.create，content为空、markdownSource为代码 `` `<sourcecodeneedle>` ``；真实DOMParser路径把Markdown原源码当HTML，角括号代码词丢失，query结果[]。此分支源码注释称source-only draft保持可检索，实际不成立。须按Markdown/plain-source语义处理，不要求页面先联网生成HTML。
- 过期body cache：公共storage writer复用同一个record.local.data对象，提交第一正文后原对象更新正文＋localRevision，再实际putEntity；WeakMap只以data对象身份缓存，实体已为新正文而derived search/preview仍旧，新词查询[]。应绑定真实content/body/format输入版本或只在一次派生内复用，不把可变公共写口数据默认为永久不可变。

**query整体仍条件未过，原HTML全文P1与Java两P2关闭；上述两个新P2修后原例复审。** 不把sourceCoverage.complete/productComplete调用方信封当已验证native adapter，真实页面/native数据源、设备/大包仍未验。root已接收并安排一次窄修；本批未向前端会话发通知、未抢其源码/设备。156通过结论不受query未过影响，最终客户端整合另冻另审。本代理没有正式维护、profile新采、正文原件读取/改写、SF16发送泛测或手机/5554操作。

## 第十二批：最终query两P2窄修通过，公共日记port分项批准

最终 `outputs/2026-10-19-shared-business-integration/diary-query-final-client-1792449420689/data-manifest.json` SHA `a360f6dababaeea03652c6c375db45576e82a1ffc4b622bca20c67eefda6f596`。独立63/63源SHA、22Java保持；相对445347精确只有public/shared/shared-diary-index.js变化，其余62生产源逐字节不变。新代码移除以data对象身份为键的跨调用bodyText WeakMap；每次put派生按当前正文处理，source-only Markdown直接以源码文本检索，不再当HTML解析。最终双bundle从冻结sources独立重建逐字节一致，闭包无外部/UI入口：Android `c76bbb1ef1b0e250b2f27caff9ddd00eed7bcf1418a52c24c0cf5a9f98f0750e`（283685B），PC `76ca6c74694772345903559fc8122d69d971fac212fd6d6200c52a5915c3f889`（295682B）。证据 `outputs/2026-10-19-shared-business-independent-review/diary-final63-freeze-independent.json`、`diary-final63-bundles-independent.json`。

原独立格式脚本保留，副本仅切最终冻结imports，实际3/3：真实DOMParser下source-only Markdown角括号代码词可搜；同一个data对象改正文＋localRevision再次put后新词可搜/旧词消失；直接相邻渲染后Markdown和canonical richdoc仍可搜。日志 `independent-diary-final-formats.log`，脚本 `tmp/shared-business-independent-review/independent-diary-final-formats.mjs`。**前批两个新P2关闭。** 未重跑作者19全组；已过正常HTML create/save、snapshot/pull、真实signedseed离线导入/冷开、Java两原反例及31golden、ABA fence、v1/v2→v3失败原子性、分页预算/游标代际等按相同依赖及不受本次两处窄改影响的证据复用。

**最终a360公共日记query/sidecar port范围通过，原HTML全文P1、ABA P1及后续四项P2均有实际反例修复闭合。** 批准范围为原契约支持的有界本机索引/查询、事务/版本与草稿sidecar数据口；不把sourceCoverage.complete/productComplete调用者信封当native来源完整证明，不把catalog算法夹具当SQLite/native adapter/产品页面已接。真实页面及cold-stop产品路径、旧来源覆盖/title adapter、离线新原件sink、大Entry与HLC业务/outbox同事务、已审knownrefs等最终客户端组合仍须各自接线/精确组合冻结；未因query通过而扩大为所有同步已完成。

156后端候选通过与实际维护证据边界不变。当前无法证明用户是否有未确认编辑/附件，root已询问缺失实际状态；答复及真实同窗排空证据未齐前不关窗，本代理不执行维护。没有真实资料/原件/profile读取或修改、前端通信、SF16泛测、设备或5554操作。

## 第十三批：维护LocalSaveAck/FIFO证明分离窄审通过，实际执行需刷新check

维护门槛独立快照 `outputs/2026-10-19-computer-collection/maintenance-fifo-gate-1792449906283/maintenance-manifest.json` SHA `ba15174b772f676a63077e6d5c4109fc279a84267bba24cbf272c333792605fc`，仅guard/tool两源独立核SHA及原156 baseSHA；tool逐字节等已审156，guard只新增LocalSaveAck与实际server FIFO提交证明分支，未改156业务runtime。证据 `fifo-gate-freeze-independent.json`。不把ui49正常stop的LocalSaveAck填成journal逐条HTTP ACK：实际frontend封套继续saveHttpAcknowledged:false。

定向合成一个场景内实际核合法分支及八类拒绝：仅LocalAck缺FIFO、HTTP500、closed1、错误endpoint/method、前后librarySHA不一致、pinned原文件SHA改变、活跃连接均拒绝；被同一reference SHA钉住的POST close-idle/200/closed0/正确librarySHA才可补本机保存证明。日志 `outputs/2026-10-19-shared-business-independent-review/independent-fifo-gate.log`（实际1/1），不重跑156/备份/rollback全组。

独立读实际旧chat-reedit2 route/store/domain并核三源冻结SHA：app context直接共享同store；close-idle路由reply在await mutate之后；mutate加入原FIFO、await writeFile与rename、替换COW后才resolve，closeIdle仅到期篇会改变状态。原明确stop把automaticPaused置true，后续普通API的autoStart不会越过该暂停。故在已知writer全部暂停、无到期deadline且返回closed0/业务字节未变的限定维护窗口，一次已授权真实close-idle可作为此前已进入同FIFO工作的提交屏障；它不是只读动作，也不证明本机每条消息已经HTTP送达，更不能代替PC profile/原件和草稿保全。

按私有current-maintenance-locator定位，只公开计数/哈希与门槛，不输出正文/密钥。独立核验时间2026-10-19T22:48:05Z时：正常stop原回执stopped=true且剩余前端进程0、用户准备四项明确false；真实barrier为stop之后的POST200/closed0，before/after与此刻原JSON SHA相同；现plan的五类证据文件及各raw引用SHA全匹配，已记录runner停/inFlight0、实例0、stage目录空、uploading/unindexed0、连接0及deadline余量。5roots/4066files私有备份marker SHA `453c618b0c3e1848ab8a5baa551ab811395e9126bb2e0794c1a851c81ae1d792` 与plan/稳定备份回执匹配；按已审备份算法复用源前后/目标逐SHA执行证据，未重复3GB原件全扫。证据 `fifo-private-window-evidence-independent.json`，仅历史当窗事实核验。

**分支代码通过；上述当窗FIFO/正常stop/备份原始依据可接受。但核验时旧plan不能直接switch：** frontend envelope还没有serverFifoBarrier引用，观测已约364秒，超120秒限制。执行方必须重新取得真实当前已停状态/runner/staging/连接/JSON/deadline观测，以新封套保持saveHttpAcknowledged:false、引用已pinned真实barrier与原stop/raw ACK，再执行新guard/tool的近期check；不能只改observedAt或借旧0值。所有真实窗口条件仍符合且check成功后，root统一窗口可继续已授权受控switch，不由本代理操作；出现新活动/请求/暂存/业务SHA或期限变化即中止。未把本次合成验证称实际排空、未要求重复用户已授权动作。

新增实际完成门槛：当前shared config仅在私有exports、启动依赖DIARY_SHARED_CONFIG；成功后须expected-absent/CAS原子发布已验配置到canonical `config/shared-backend.local.json`，纳入后备份，并验证默认无env读取同enabled/remote:false/loopback/exports配置，不能把当次env运行通过外推标准重启持久。此为配置持久交付证据，不改业务156源码、不要求额外正式重启。后初始化identity/index/auth/key/回执完整备份与真实能力核验前保持clientsMayResume:false；成功前端由PC owner后续正常ui50流程处理，失败保原保护恢复。本代理未停止API、改pointer/config、操作设备或改正式资料。


## 第十四批：156实际维护最终证据链通过，不含来源提交/完整签名包

按私有current-maintenance-locator定位maintenance-final-receipt（2026-10-19T22:52:44.787Z），独立只读核当窗原始check、switch、前后备份marker、原JSON业务对象及canonical配置。结果 `outputs/2026-10-19-shared-business-independent-review/maintenance-final-evidence-independent.json`；未重跑156测试或3GB原件全文hash。

实际五类近期证据及所有raw引用SHA匹配plan；新的frontend封套已挂pinned FIFO barrier，保持saveHttpAcknowledged:false、localSavedAcknowledged/fifoBarrierApplied:true。check 22:49:17.121Z的60秒窗口内完成22:50:09.470Z的healthy shared-owner-started；原PID与停前journal一致，新PID当前只读核仍匹配原Node与稳定launcher。精确156主/fallback与ba151 gate不变；pointer已指156。该次Windows停止不称SIGTERM或逐条journal HTTP ACK。

前备份5roots/4066files marker SHA `453c618b...`，初始化后5roots/4069files marker SHA `b685c91693f374d0e835b514d2995d225636c416426cab98d401bcaf17fe22a6` 均与对应计划/原回执匹配；复用已审备份算法和执行roster证据，不再整扫原件。本代理另实际读取两份私有JSON，只在本地计算对象哈希：3158篇entries、3147媒体完全一致；所有原顶层业务对象保持，revisit内部唯一变化是cursor，原规则/评论/投递保持。marker1初始化，library/epoch与switch、postbackup及info一致；不是副本新身份冒原owner。health保sourceSessionCache=1及旧服务能力，原30秒runner恢复；receipt当时聊天/托盘仍正常退出，桌面资源归PC owner后续ui50，本代理没有启动或操作前端。

canonical config已expected-absent且原子不覆盖发布，当前SHA `4bab105874391219d7c0ff5d9190b1cb094f85873c3d450af37da9fb7fbc91d1`，原absence引用SHA及单独post-publish-config副本SHA独立匹配；实际调用已审runtimeConfig({})无环境变量，仍同原dataDir、sharedSync:true、remote:false、127.0.0.1。证明默认重启配置加载持久，不把原env运行外推；没有为此额外重启正式服务。

**本次原owner 156受控维护/身份初始化/配置持久与初始化后备份证据通过。** postinit inventory中已有program auth集合按当时状态保存，shared auth/key不存在者如实记录；签名key在该备份时尚不存在，绝不写‘已备份签名key’。首个真实seed-register生成key后，仍必须备份key＋永久登记/sourceReceipt/log/原件与相应当前代际，再独审真实完整签名包。source业务登记、fresh source映射及signedFullPackageComplete仍未作为本次批准，普通legacy前端资源可归还与完整包交付分开。

本代理只读审核，未stop/start API、改配置/pointer/原JSON、打开原profile、操作手机/5554；真实维护由执行方已完成，页面/UI50、native客户端HLC及真实整包继续各自scope。后续正常用户或source写入不冒称维护测试写；上面业务哈希结论针对该维护前后两个固定私有代际。

## 第十五批：最终客户端message HLC数据接缝66分项通过

候选 `outputs/2026-10-19-local-message-edits/client-1792450149596/data-manifest.json` SHA `ddc740abf119fcd747c2e7c5e45cb82c1f115c22be87a9efc1d491483a05743e`。独立66/66生产源在sources及qa两处全SHA、22Java与15个fixture SHA核对；相对approved query63精确10路径（7覆盖＋3新增），shared-seed.js逐SHA等已审knownrefs a2e，其余未改query/信任验证等沿已审证据。两个bundle从冻结sources独立重建逐字节一致、输入依赖闭合、无页面入口/外部依赖，Android `095e3d978782557b34f66319947a900a370c5f7c59dce53d3575ccfa33c7e181`（317146B），PC `206d5a23575369fe95140a73e017c4fbfdf2a040f594e19e17f1475634425255`（328050B）。证据 `outputs/2026-10-19-shared-business-independent-review/message-client66-freeze-independent.json`。actual HTTP夹具仍锁已审786a，只合成tmp库，不操作现正式156。

只实际执行本scope新增15项，15/15，`recheck-message-client66-new15.log`；不重复旧36邻近、6seed旧邻近或作者57全组。覆盖signed首包离线编辑、同库两controller writerUUID/HLC与回拨、真实IDB abort使clock/outbox/history/Entry/index/原件引用同回滚、未就绪媒体拒绝保草稿、旧能力block及原wire retry、lostACK/换URL/重配对writer及历史回执保持、新root终态/后继和未知旧时间、source同槽投影、Android离线newroom原ID重复/冷重开、query同事务、签名staging和旧包重导清正文＋resolve后强制snapshot恢复。

独立新增3个实际HTTP＋双层真实fake-IDB事务反例均通过，`independent-message-client66.log`，脚本 `tmp/shared-business-independent-review/independent-message-client66.mjs`：

- 同operation改正文或借另一root均SHARED_OPERATION_REUSED，整个meta/clock/entities/pending逐字不变；不新发HLC或替wire。
- 同一Entry的root1远端终态，只清root1待发/私有history；root2待发编辑、正文与queue保留，之后真实同步成功。终态不会按Entry整篇误清邻居业务。
- 本地离线root终态后，新操作再编辑拒绝，clock/queue/entities保持；恢复服务后实际server仍withdrawn，旧正文不复活。

实际重新javac/java编译本冻结QA的生产transport/bridge及host最小stub，9个固定action（6已审local-first＋3message）deep-equal wire/Exchange9，通过；三个未知别名在Exchange前拒绝。`message-client66-java-fixed.log`。仍为host Java，不是Android设备/APK安装或WebView验证。

真实Chrome六个定向证据按同SHA复用而未重跑：独立核最终66生产SHA与该browser执行候选全相同，检查probe脚本只从自身冻结sources提供模块、真正Chrome persistent context及IndexedDB；browser-probe.json/log分别记录完整签名首导无服务、事务abort、两页writer/HLC、整Chrome冷重开同wire/正文/草稿、真实786a HTTP以及终态清正文。未把fake-IDB15项说成真实Chrome，也未把Chrome空白数据页说成产品UI。

**最终ddc74公共客户端HLC/immutable outbox/原子乐观后继/终态清理，以及本scope source/inbox/seed与Android fixed动作数据接缝通过。** writerUUID/HLC/op/history与Entry/index在同IDB事务，不把wire device标签当服务授权；历史committed ACK与currentHead区分；本机终态拒绝意图与远端已确认终态在readOperation分开；私有seed staging脱敏不改签名manifest/原件handle，下一resolve要求权威snapshot，旧seed重导受本机终态fence过滤。

批准有明确边界：新stage媒体编辑仍明确unsupported，不清稿假成功；继承原query投影大小/事务失败保护，并非放开大Entry/大正文全部上限。未包含真实产品编辑入口/native adapter完整接线、UI恢复按钮、设备/5554/完整3.33GB真实包或正式客户端部署；不能说页面已具备跨端编辑或资料已完整导入。backend schema/marker1未变，源服务与已实际维护156分开批准；最终页面/桥组合及真实包仍须实际接线证据。全批未跨前端通信、未操作正式API/profile/设备或写真实资料，原失败包与失败回执继续保留。

## 第十六批：可信来源MIME规范与签包映射两源窄修通过

候选 `outputs/backend-runtimes/20261019-shared-source-mime-1792450987398/runtime-manifest.json` SHA `87cf12665b03f0c17c7c41f3ae34ce72e5032e7dab0e5cf83aaa3df7191ca52f`。独立核156个源文件SHA、Espree AST全部436条相对依赖及audit相等；相对已维护156/9e080，生产差异确实仅 `desktop-collection-commit.mjs`、`seed-package.mjs`。执行QA的156份生产源码逐SHA等此冻结，未用live工作树。证据 `outputs/2026-10-19-shared-business-independent-review/source-mime-freeze-independent.json`，复现脚本 `tmp/shared-business-independent-review/verify-source-mime.mjs`。原两条PNG roundtrip/prepare相邻按同源及无受影响路径复用，不重跑全组。

重新实际执行6项窄定向：可信PNG声明/JPEG字节的同ID规范、错误magic或全文SHA拒绝、非known/global严格校验不放宽、prepare后metadata/file变更拒绝、后段sticker失败真实JSON全事务回滚、签包权威type/旧mime/非图片兼容。6/6，日志 `source-mime-targeted.log`（均在上述独立证据目录）。签包用真实HTTP原owner导出/登记、实际readSharedSeed校验，媒体entity字段/asset MIME/SHA/原件一致，coverage对该合成代际为true。

另自写2项独立真实HTTP反例均过：一是仅旧mime字段、没有type的记录，通过私有capture proof规范后仍无新type字段，mime成为image/jpeg，原ID/全文字节/SHA/size不变；真实签名导出与重新prepare后的media envelope和manifest asset MIME一致。二是伪造plain proof不能取得私有brand；首次成功后模拟本owner后续metadata变化并重启，旧operation replay仍只回原receipt，media/entries/sourceCollections均保持后续状态，绝不再纠正或覆盖。脚本 `tmp/shared-business-independent-review/independent-source-mime.mjs`，日志 `independent-source-mime.log`，2/2。

独立测试首轮有一处测具断言过严：直接写入合成JSON的compact文本后，要求正常owner replay逐字节保持该手工序列化。原store正常写盘会排版/维护派生索引，和本项“不得重改业务metadata”不同；改断言为media/entries/sourceCollections实际对象不变及原历史receipt相等后通过。原测具失败输出保留 `source-mime-fixture-byte-assert-before.log`，不作产品P1、不删除或伪称首轮全绿。

**本两源修复scope通过，未发现新增阻塞。** 放行的规范路径仍必须是已校验capture私有brand、required已知资源、全文SHA/size与原metadata一致、JPEG头符合且原件代际不变；commit再核metadata/目录/偏好CAS，并与绑定和source receipt在同原JSON事务发布。只支持明确PNG声明→JPEG检测这一种历史差异；普通壁纸校验不放宽，原件不重编码、不换ID。图片校验为全文hash加格式头，不能声称全像素解码。seed仅优先权威 `type || mime || application/octet-stream`，无新schema。

这是冻结代码/合成资料审批，不是正式source apply或完整包交付。实际新API窗口须由root协调当前PC状态并重新排空/备份，不能复用上次维护的人工无未确认操作证明；本代理未操作正式API、资料、profile或设备。正式fresh source receipt、真实完整签名包、首签key及永久登记/回执的对应备份、真实双端页面导入和continuous缺口仍未由本批验收，不以MIME通过扩大结项。

## 第十七批：实际私有COW预演核验及专用QA交接分项

### A. 真实同库clone预演范围通过

公开 `outputs/2026-10-19-computer-collection/source-mime-real-private-cow-summary.json` SHA `cd914994a9bc43dcbab3f4ae03d0bb281205f62695fa3d83102e4e3caa1b6f2b` 与私有同名摘要逐字段一致。实际私有preview文件SHA `476cfd78a02ede850980078b155ed2970f7c73b0f2a51072a2d0386c34badba8`，明确format为private-cow-preview-not-a-formal-owner、isFormalOwner:false、authoritativeReceipt:false；所含simulatedReceipt与私有clone的receipt相同。独立核sourceManifest/sourceGeneration、targets/originals roster哈希、10房/10壁纸/3贴纸/2保留冲突及2次PNG→JPEG格式纠正，均与摘要相符。原操作在实际只读owner中没有source receipt，不可将预演回执用于resolve或声称正式采集完成。

历史摘要的inputOwnerJson SHA不再等于核验时实际库：已有后续正常业务写入。preview没有保留原始输入JSON preimage，故不把该历史摘要中的currentOwnerJsonStillMatchesReadGeneration:true外推到现在，也不伪称已逐对象重验历史输入。为独立验证当前适用性，使用精确87cf冻结模块，读取当时当前原库代际并仅在内存structuredClone：真实加载采集proof、核14条required引用/10个去重原件、对这10件共18,972,608字节执行全文SHA/size与格式头校验，再在clone提交。未重扫3GB原件档案，未重新运行前批合成矩阵。

本次独立内存预演成功：同library/epoch、2条原media仅权威MIME改变，ID/size/SHA/其他字段与原件字节身份保持；entries/messageStore/revisit/sourceMessageConflicts及其余列明的原业务域哈希保持，原`_sharedMedia`上传回执也保持。prepareSharedCommit只作用内存clone。读取前后实际JSON字节SHA相同；未发HTTP、未写正式JSON/原件/配置、未落盘新私有clone、未创建签名key。脚本 `tmp/shared-business-independent-review/verify-real-source-mime-cow.mjs`，公开仅数量/hash/布尔证据 `outputs/2026-10-19-shared-business-independent-review/real-source-mime-cow-independent.json` 与同名log；无正文/真实ID/私有路径外发。

**A分项通过：真实同库数据适用性及预演非权威边界得到独立核实；不是正式source apply/receipt、签名整包或维护授权。** API87cf新窗口仍由root协调PC正常保存stop与当前排空/备份，前批已审两源不重审；实际状态后续变化不得套此刻JSON SHA。

### B. 专用QA APK与driver冻结交接待审

本次A分项落盘时尚未收到最终APK/driver冻结指针，保留当时未批准记录；后续精确组合审核结果见第十九批。**没有启动设备或写安装approval**，不能以A分项或既有data公共层通过提前放行APK安装。

## 第十八批：appearance已知资源前置读取独立补丁通过

独立patch `outputs/2026-10-19-computer-collection/appearance-resource-1792452129456/patch-manifest.json` SHA `b5c3832f528d978b2bad1c3415a58d3cf2bc9e74164d1810853f1de27fb6b8e6`。核5个生产增量及原beforeSHA/两项expectedAbsent、base156/9e080不变；158源与QA逐SHA一致、AST442相对依赖闭合，50个辅助/测试源SHA匹配。证据 `outputs/2026-10-19-shared-business-independent-review/appearance-resource-freeze-independent.json`。此补丁runtimeSelectable:false，未组合87cf两源，不作为可直接部署runtime或最终APK组合审批；未重复156/87cf业务矩阵或真实原件档案。

实际复跑本增量8项纯数据及2项真实HTTP，分别见 `appearance-resource-pure8.log`、`appearance-resource-http2.log`，10/10。核false/未知稀疏值、本机dataURL不修改、原预算、仅known字段替换、缺receipt及坏proof/COW/损坏原件拒绝、实际local-admin口拒Bearer/device/外Origin、远端pointer变更拒绝。响应的captureRawSha256来自受私有brand保护的原capture raw；sourceMemberSha256是整个preferences成员，二者不同。当前rawSha256只回显调用端当前原串指纹，reader在await后核原串未变；允许同一已验证图片下普通设置后续修改，不能声称后端已核当前raw全文，也不要求它等于采集时raw SHA。

另自写2个独立用例通过，脚本 `tmp/shared-business-independent-review/independent-appearance-resource.mjs`、日志 `independent-appearance-resource.log`：真实HTTP首次缺receipt拒绝后，实际同owner完成source提交即可由同reader恢复，server重启后继续可读；超预算普通字段及冲突local pointer均拒绝且保旧原串/原owner业务，不缓存失败或丢图；去掉冲突后false/未知值恢复。另核resolver构造时固定owner/source副本、外部原对象后来变化不改请求上下文，不在选中名单的scope完全不读取desktop raw。

预算边界如实记录：本批没有修改既有generic reader/sanitizer/server，其所谓256KiB实际沿原代码按字符串/JSON的262,144个UTF16 code unit上限，而非UTF8 byte；90,000个中文字因此仍可通过，270,000个ASCII普通字段拒绝。新资源前置raw上限2MiB才是TextEncoder UTF8字节限制，超过时在resolver前拒绝。独立脚本首轮把旧generic预算误当UTF8字节而期望拒绝90,000中文，原测具失败保留 `appearance-unicode-budget-first-assert.log`；核源码后按原边界重验通过，不把该旧规则误报为补丁新增回归或偷偷放宽限制。

**本5源独立数据补丁scope通过，无新增阻塞。** 只授权受实际sourceReceipt、已知binding/原件全文SHA及当前同owner pointer/COW保护的desktop投影；原localStorage与显示图不写，未知资源不猜、不静默删图。实际PC runtime/native fixed桥对新action的产品接线、与87cf的精确组合冻结/维护、正式source receipt/真实签名整包与连续房消息lane仍未由本批证明。未部署、未接触正式source或任何设备；第十七批B的APK/driver冻结交接仍待审，不因appearance通过产生安装approval。

## 第十九批：专用full-seed data QA APK组合与driver代码范围通过

候选 `outputs/2026-10-19-full-seed-data-qa/candidate-1792451236003/candidate-manifest.json` SHA `c623cef5662d8fb5b24636789c861c267f20c57e28265673674175129ff43cbc`。独立核36项交付artifact、11,824个stage输入、11775个实际APK assets全部SHA/集合一致；其中46Java为已审import UI v3.1/c7659fe基础，精确叠已审data66/ddc740ab的22Java及Android bundle095e3d97。两import UI模块与v3.1原字节一致；11,771项其余support资产逐件匹配f42普通APK，只读取support ZIP，不复用其DEX。QA新增仅独立manifest/minimal res/network resource、网络禁用数据页与driver，无live UI023/MainActivity混入。两DEX SHA/大小等候选清单，原环境只读guard79c21784与冻结拷贝一致。证据 `outputs/2026-10-19-shared-business-independent-review/fullseed-qa-combination-independent.json`，脚本 `tmp/shared-business-independent-review/verify-fullseed-qa.py`。

实际独立执行apksigner读取该APK，v2签名/单签者成功，证书 `24e2b783a4e9a1f574e6403734be6aeefc9b702db5aaba0106828c502899dfe6`；aapt2从实际APK确认独包 `dev.shiye.dataqa.fullseed`、code1、min26/target35/compile36及MainActivity入口，APK SHA `a793ddbd18b575800416c137c81e2af9c12686a2d70292c7fc0febaca76cc394`，92,422,309字节。对应 `fullseed-qa-apksigner-independent.log`/`fullseed-qa-badging-independent.log`。沿实际stage sourceSet与Gradle initial全34任务成功/final12秒成功日志复用真实编译证据，未重复Gradle或误称设备运行。

静态核实际链AppSettings→MainActivity→TelegramFrontend动态导入已封闭shared-import-ui→fixed choose→SharedImportPicker ACTION_OPEN_DOCUMENT/onActivityResult；在独包中具备入口依赖，未拿源码字符串当系统picker成功。作者同SHA DOM5/真实IDB helper8证据复用；另实际Chrome隔离重验**新QA页面本身的按钮路径**，仅从逐SHA冻结assets加载：同shared IDB的合成普通HTML Entry，实体计数/40项分页/点击正文，按钮保存完整body草稿和提交，原HTML及转义追加/未知false保持；关闭QA页释放runtime后再开，回读同draft operationId并重复提交只复用pending。网络/原生请求0，未真实导入seed或原件。脚本 `tmp/shared-business-independent-review/independent-fullseed-qa-dom.mjs`，日志 `independent-fullseed-qa-dom.log`。首轮独立测具漏config.version与关闭dispose未await两处错误已修，原日志分别保留 `fullseed-qa-dom-fixture-version-before.log`/`fullseed-qa-dom-fixture-dispose-before.log`，不作产品失败或首轮全绿。

driver12个mock guard用例实际重新执行通过，`fullseed-qa-driver12.log`。另自写3项隔离故障/并发反例，均mock所有subprocess/ADB：两个并发install_once只有一个durable x预约获胜、只一次install；fsync失败不发install且不留可用permit；最底层安装调用超时后permit已消费、不能复用。`tmp/shared-business-independent-review/independent-fullseed-driver.py`、`independent-fullseed-driver.log`，3/3。未调用driver真实inspect/安装/ADB。

代码守卫限定serial5582/独有package，原marker＋实际SDK qemu/PID/AVD/headless port/无data override/唯一目标进程；拒默认/手机/5554/5580。每个非plan操作须独审marker绑定整candidate与APK，逐artifact拒漂移；安装前已有package即拒，安装预约先fsync、无-r、无重装/循环/超时重试。启动资源D≥96GiB/物理≥3GiB/commit≥4.5GiB须fresh核；真实包/data≥24GiB且≥4×包大小＋2GiB；截图/XML落专有私有state。正式18765 forward/reverse和配置地址拒绝，配置只能空/offline或固定19483未来clone；driver无AVD/backend启动、任意adb/配对/同步命令，QA页自身只给本机原件read固定动作，其他native request拒绝。允许19483不等于已经存在/审过clone，后续仍需独立同身份clone及真实包binding。

**本候选组合、QA新增数据页面及driver代码范围通过，未发现本scope阻塞。** 可作为root后续独有5582测试计划的已审候选依据；本次没有写private approval marker、启动AVD、安装APK、读取/传输真实整包、触及18765/5554/正式profile或个人正文。现有prelaunch资源只是历史观测，不代替实际窗口fresh check。系统ContentResolver/picker、真实签名包指纹交互、3.33GB导入/磁盘取消清理、设备原件/正文/草稿冷开及隔离clone回写均未验；Product原生日记主页仍未消费shared IDB。不得以该专用QA宿主或公共data通过宣称普通页面/真机交付已完成。

## 第二十批：87cf实际维护、真实source登记、首签包与限定QA许可

### A. 实际87cf维护证据通过

公开 `mime-maintenance-summary.json` 与新私有current-maintenance-locator所指原回执相符，previous及原locator副本保留。独立核新plan/window、五类近期观测与所有raw引用SHA、真实FIFO POST close-idle/200/closed0及前后library SHA：per-message saveHttpAcknowledged仍false，LocalSaveAck＋FIFO证明分开，不编造队列计数。check 23:24:51.908Z的60秒窗口内，23:25:30.044Z healthy切87cf，PID13428→57156；本轮只读CIM确认新PID仍为原Node/稳定server.mjs。pre/post marker分别 `c1135c0150fdefa485d5ee63826cd322ee943491b0c97e3d0d7a186c63d65638`、`fff4dfd156ec50f5ac8d33f96045f6ebcbc58b2f4a644b0bf2536ad3db21c076`，均5根/4088文件，复用已审备份算法/实际roster执行证据，未重扫全原件档案。

实际两代私有diary JSON在本地逐原业务域计算哈希：3158篇/3151媒体保持，所有顶层业务变化仅revisit.cursor；原library/epoch/marker1不变。canonical配置仍4bab1058并有本窗备份，无env runtimeConfig仍同owner/shared:true/remote:false/loopback。原30秒runner恢复；switch/post-backup的clientsMayResume:false保持，与维护最终回执desktopResourcesMayReturn:true分开，后者只归还PC owner正常ui51流程，不代表尚未验收的shared客户端已可恢复。维护备份当时key仍不存在。证据 `outputs/2026-10-19-shared-business-independent-review/mime-maintenance-source-independent.json/log`，脚本 `tmp/shared-business-independent-review/verify-mime-maintenance-source.mjs`。测具首探误把post-backup clientsMayResume也预期true，核真实保守字段后修断言；原 `mime-maintenance-source-probe-before.log` 保留，未改真实证据。

### B. 实际新source登记通过，未覆盖旧业务

独立从同私有locator读取真实apply result、owner永久source receipt及新capture proof，并重新推导planner counts：588消息/10房/71binary＝493 exact＋4原后继保护＋79原程序/评论域＋2旧冲突＋10示例私有。新source manifest SHA `0148028bf91dbf2524789d8da616afe5c928338d35b8c3052772ae5af4c3fe40`；两条旧冲突的owner/source双方fingerprint与原record逐项保持，未重选或覆盖版本。真实receipt status backend-mapped，apply backendMapped:true但completeComputerExport:false；targets为10房/10壁纸/10去重已知原件/3贴纸/2冲突与2次PNG→JPEG纠正，绑定同库原identity。

独立对维护post快照和首签backup实际原业务对账：media只有对应2条type改变，原ID/其他metadata保持；原entries无丢失，全部既有chatJournal消息逐ID的整行哈希及全部旧canonical units保持，layout/设置/模板/导入元数据/分类/冲突/上传回执等保护域不变。期间只有1原篇新增6条消息（137→143），旧137条全部保持；不将正常用户后续写入冒称本代理测试或source覆盖。source receipt SHA `e5e2b21a4427eca1a8d0a5c0904b9c1fc9f7b5f7d87107e137de0dd7fb71cd98`，targets SHA `15872fe6069148708d7bd7077d914e1cba791f03c965f031c4df627003fa8def`。本代理仅只读，未调用source apply/正式写口，未修改资料/profile。

### C. 首个真实signed full快照及首签备份通过

真实包1,837,784,748字节，容器SHA `2f789dcd052fc968959de984f85257993008e4543607d0325cb07e75b6c367c5`，manifest SHA `1c6e7841d49c0dac8b57d0ee470074a3c1d1a0cbd848948ac92f59cd6a7b6e3c`。独立有界流式解析实际raw容器，完整容器及每个有序成员size/SHA、canonical entity/feed JSON、无越界/尾部、6404实体描述符、3151资产与media实体MIME/ID/size/SHA、全部已知资源引用均通过；10 feeds含594行/10 redactions，roster/分块与墓碑无active正文冲突。物理去重2950原件成员/1,817,783,273字节，逻辑3151资产引用/1,860,635,934字节，不能将201条共用内容引用误认缺件或重复物理包。实际pkg读校验不是再次遍历3GB源档案。

直接Ed25519验证manifest attestation成功，公钥指纹只在私有绑定比对；同原library/epoch/watermark、永久registry的exportId/manifestSHA/payloadSHA/完整entity roster/feed roster/attestation逐项相同。实际首签backup marker SHA `df842fff9d44fada50f744db72294f7d728cc8eddb11783bd4d3934f2d607cc3`，原diary/config的备份SHA匹配，含该source receipt与永久seed登记；shared key及program auth SQLite/WAL/SHM共4文件逐size/SHA核对，key备份哈希等live文件，仅算hash、不解码或输出私钥。复用执行方auth原/目标/原再次全roster相等及原件已由前后维护备份覆盖的证据；这是live owner首签稳定材料备份，明确notFullQuiescentDatabaseBackup:true，不能说再次停机全库备份。

**signed full的snapshotComplete:true限定2026-10-19T23:31:55.590Z签发代际及所登记capture；continuousSyncReady:false（disabled/unlinked房消息port未接），rendererRestoration仍pending-explicit-pc-resolver。** 后续用户写入应走既有同身份增量，旧包不证明核验时实时所有写入已包含。未客户端导入/设备验证；shared业务快照不包含凭据、原profile或raw来源档案私有恢复材料，不把包等同整机备份。

独立证据 `real-full-package-independent.json/log`，脚本 `tmp/shared-business-independent-review/verify-real-full-package.mjs`。复用数据Sol同包readSharedSeed全读证明（公开验证摘要SHA bfa14de152ee21d1e8ed573003f5754616d946bdda6dd421bcc54406eb2147ca），本代理另实际核完整容器/成员及签名/引用。独立解析首探错误按entities/目录判定业务entity，但feed part也合法存于该目录；改为manifest descriptors定类型。随后核公开coverage时误要求私有sourceId/notes也逐字相同，已按实际删节边界比公开字段及两个source SHA。原测具失败 `full-package-framing-probe-before.log`、`full-package-public-coverage-probe-before.log` 保留，不作真实包缺陷；最终实际全部检查通过，无正文/真实ID/指纹/私钥公开。

### D. 真实seed绑定缺口已修，限定私有QA approval已写

真实包待准入时新增可复现缺口：旧c623 driver只把approval绑定APK/candidate，seed_binding可接受替换为另一合法SHA/library的seed-input，无法落实root要求“仅此真实seed”。独立失败原例 `tmp/shared-business-independent-review/independent-fullseed-seed-approval.py` 与 `fullseed-seed-approval-before.log` 保留；因此原driver不用于本次真实seed执行许可，APK/QA页面同SHA范围通过不撤销。

修复窄冻 `outputs/2026-10-19-full-seed-data-qa/driver-seedbound-1792453032478/candidate-manifest.json` SHA `d761e0e18897b4e5c49148530a65e7c51cd476665a0e67404482d8bdcdf8ac84`，13交付artifact逐SHA通过；APK仍a793ddbd、base仍c623，input/policy不变，同原candidateId/privateState，不重置单次安装台账。独立AST核17原函数及所有旧常量不变，仅approval/seed_binding/push_seed/ui_step与新validator/SEED_FIELDS窄改。新guard强制approvedSeed完整7字段、绝对固定path、size/完整SHA及hash期间文件代际；push/select/confirm/两次cold-open的guard均在inspect/ADB/reserve之前。原换seed反例副本实际重验通过，新增7小反例实际过，逐7字段×5动作均拒且零设备调用；旧12＋独立3安装/fsync并发证据按相同AST复用。证据 `seedbound-driver-freeze-independent.json`、`seedbound-driver7.log`、`fullseed-seed-approval-recheck.log`。

按root此轮明确授权，在原私有state以wx/fsync写approval.json，绑定**新d761 driver＋原c623/a793 APK＋本次2f789dcd真实包的全部七字段**；与actual manifest/永久登记/私有seed-input和pending descriptor逐项比对，真实ID/指纹/原件路径只留私有。许可文件SHA `25eca351a4da78a116206a94a5cdba7d03ad25de73112edb32bc0a86a431b3d9`，冻结driver只读approval gate实际接受，安装attempt仍不存在。公开回执 `fullseed-private-approval-receipt.json` / `fullseed-private-approval-gate.log`，写入脚本 `tmp/shared-business-independent-review/write-fullseed-private-approval.mjs`。

该许可只供root统一安排独有5582 fresh资源/marker核验→单次安装→本包真实离线系统picker/TOFU首导→冷开本机原件/HTML正文与草稿流程，严格禁止正式同步，不授予AVD/其他package/端口或其他seed的通用许可。本代理未启动设备、安装/推包、触及18765/5554或正式前端；系统picker/规模导入/磁盘取消清理/设备冷开/页面与后继孤立clone收敛仍待实际回执，Product原生主页仍未接shared数据。**A维护/B来源/C指定快照/D绑定代码及限定许可分别通过，不是整个产品或连续同步结项。**

## 第二十一批checkpoint：离线程序设置ACK cache遮住已同步更新，P1未过

独立对象为最终 `outputs/2026-10-19-offline-settings/candidate-1792453175773`，client manifest `378be5049bd0fdbcdb0032a39fb132e29ca84cf587020cc00480c51a140cb706`、backend manifest `252a749f5be07017893d3b4d735b3af807f491b8c52693cc90940ab67fc18645`，不使用旧1792452960458。当前未完成全增量审批，先记录真实阻塞，不拿作者7项通过替代独立结论。

**P1实际反例：已ACK的本机settings cache永久遮住已经receive的新远端配置。** 小合成实际HTTP原owner＋真实IDB事务：本端directory.saveSettings A（sync:true）ACK→另一端原service-settings-save成功改B→本端client.receive后实际service实体中明确已有B→断网调用directory.settings同房/slot仍返A。无需另一端仍在线，缺陷发生在纯本机默认读取。精确脚本 `tmp/shared-business-independent-review/independent-offline-settings.mjs`，原失败 `outputs/2026-10-19-shared-business-independent-review/offline-settings-independent-before.log`，actual local-A/expected remote-B。

定位该冻结 `client/public/shared/shared-directory-client.js` 的ACK分支约405–420：只在derived版本与旧effective cache版本相等时才采用derived，较新已同步版本不等时反而回旧cache；saveSettings同样以cached/effective旧版本及原父operation起新意图，不能据此称可离线继续编辑已同步B。修复需保未ACK/blocked本机意图，同时让已ACK cache在可信本地新config/解绑状态下退让；新离线修改须基于B的真实版本，不错误继承A的父receipt。应补B receive后断网读及新C本机ACK→联网原CAS成功，另验原真正并发仍拒。已向root提交，直接followup作者遇agent thread limit未成功，由root统一空槽协调；本代理不修改产品。

此候选不在正式87cf、已签真实包或a793 QA APK中，上述实际维护/签包/QA许可结论不扩展为离线程序参数已在现包可用。按root最新优先级先暂停本scope，接执行方发现的固定pm path不存在返回exit1的driver窄修；不新增设备操作或扩大设置矩阵。

## 第二十二批：实际安装前pm path absent窄修通过，同台账许可CAS更新

root已授权执行方在独有5582实际fresh资源/marker与SDK qemu/AVD/port核验后执行。实际driver首次install-once停于固定 `shell pm path dev.shiye.dataqa.fullseed`：未安装包正常exit1，而原check_output抛异常。独立只读核同privateState原install-command.err完整调用栈、空stdout、initial inspect/失败摘要以及attempt/result均不存在；异常落在reserve/唯一install调用之前。这是“安装前查询不兼容”，不能描述成APK安装失败，也不能因此重置预算或授权失败安装重试。执行方已正常关闭自身5582，设备操作由其完成，本代理未启动/观察设备。

新driver-only冻结 `outputs/2026-10-19-full-seed-data-qa/driver-pm-absent-1792453548902/candidate-manifest.json` SHA `2e373f891c337babfe5bb0e91664b99945d558a92220f7451b1f83143b37ddab`，13artifact SHA通过，base d761、APK a793/input/policy/CDP逐字节不变，原candidateId/privateState及单次安装台账不变。独立AST核仅adb函数改变，另21函数及所有非函数AST不变；旧12＋3＋7同scope证据复用，不重跑APK/数据/安装通套。`pm-absent-freeze-independent.json`，脚本 `tmp/shared-business-independent-review/verify-pm-absent-driver.py`。

实际重跑新4项定向通过，`pm-absent-driver4.log`。独立另补1个case内6组边界：stdout或stderr为None、仅换行/空白、其他exit、exit0却未捕获stderr等均拒绝，确认subprocess.run显式stdout=PIPE/stderr=PIPE/text=True/check=False；错误路径无install subprocess、无permit、无attempt。`tmp/shared-business-independent-review/independent-pm-absent-driver.py`、`independent-pm-absent-driver.log`。仅exact QA包的text pm path在exit1且两条**实际捕获流严格空串**才视为absent；exit0仍返回paths令安装已有包拒绝，其他ADB/二进制查询与一次permit不放宽。所有测试均mock设备subprocess，无真实ADB。

**本实际平台查询窄修通过。** 按root随后明确授权，以旧approval SHA `25eca351a4da78a116206a94a5cdba7d03ad25de73112edb32bc0a86a431b3d9` 做锁定/CAS原子更新，同privateState保存 `approval-before-pm-absent.json` 原字节和 `approval-pm-absent-audit.json` 审计。新approval SHA `6f346cac210d64128a615ecb75c446baf1876e3e5f6da398015bd84bc1b75b4c`，仅更新driver审批manifest/审核证据，a793 APK与2f789真实seed全部七字段严格相同；更新前再核attempt/result均不存在，未重置/删除任何安装回执或另开台账。新冻结driver的本机只读approval gate实际接受，attempt仍缺席。脚本 `tmp/shared-business-independent-review/update-pm-absent-approval.mjs`，证据 `pm-absent-approval-cas-independent.json`、`pm-absent-approval-gate.log`。

已一次回执native执行方：只可按root授权重新fresh资源/自有AVD实际身份核后继续**尚未发出的第一次**install-once；若发现attempt/result或真实install已发即禁止重试。许可仍仅该包离线首导/冷开本机正文/草稿/原件，不准正式同步；真实设备/系统picker/full-size导入与结果仍未由此通过。离线设置第二十一批P1保持未过，二者不混审批。

## 第二十三批：离线设置cache原P1修复通过，旧库升级首同步新P1仍阻断

最终修冻 `outputs/2026-10-19-offline-settings/candidate-1792453849121`：client manifest `bdd347a003d05f839ff41f7e450ab5e65aaa9711190cedc3940a199fa2031d82`、backend manifest `57ac9d41bdd5fb5b033cb0b00b71e8b6f05cf509370ee7d36750fb9141689ef7`。独立核66client/156backend全SHA、相对已审基线仅3client/2backend，修坏冻仅directory-client一源，无live漂移；438后端AST相对边与实际bundle emitted闭包通过，两bundle从冻源重建SHA一致。`offline-settings-freeze-independent.json`及同名log。独立闭包测具最初误扫observed legacy journal动态URL、以及esbuild cwd产生路径注释差异，原probe日志保留，不作产品失败。

原cache反例按同原owner实际HTTP/真实IDB重验通过：A ACK→远端B→receive→断网默认读B→后续本机C使用B双版本、wire不再带A父receipt→联网同CAS成功。`tmp/shared-business-independent-review/independent-offline-settings-recheck.mjs`、`offline-settings-independent-recheck.log`；作者同scope9项实际重跑通过，`offline-settings-frozen9.log`。第二十一批原失败保持，仅该cache P1闭合。

**新增P1：既有87cf `_sharedSync` 索引升级后，首次同步缺新settings catalog。** 自写小合成真实旧87cf建库/建房、正常close，再同library/epoch用此候选启动；不发任何业务写，只info/receive后断网settings，实际抛 `SHARED_SETTINGS_SOURCE_INCOMPLETE`。replication新增catalog的flatten代码不意味着已持久旧索引会在启动发布；library-store仅无_sharedSync时初始化，当前info却宣称localServiceSettings能力。不能依赖任意后续业务mutate碰巧补齐首同步。脚本 `tmp/shared-business-independent-review/independent-settings-upgrade.mjs`，原失败 `outputs/2026-10-19-shared-business-independent-review/offline-settings-upgrade-before.log`。已回执root，由作者另批窄修迁移；本代理不改产品。**此候选整体不通过，未进入正式87cf/首包/a793 APK。**

## 第二十四批：已消费安装的只读取证delta通过，限定许可CAS更新

实际第二窗口唯一install已真正发出并exit0，但旧driver返回文本严格等于Success的断言失败。原stdout未持久，实际文本未知；独立核实际错误栈及原attempt/result，不能推断安装已成功，更不能重装。原attempt SHA `8c7d2fe9af1ca8ae155c27f8471dc55f36b543e6927d318a1eda0f081b397689`、success:false结果 SHA `dee19f7a78c5e87d59918914273d91efbe75fd341aca766bc66d26d131011db2` 保持；单次预算已经消费，原失败不覆盖。设备已由执行方正常停；本代理无设备操作。

窄冻 `outputs/2026-10-19-full-seed-data-qa/driver-install-readonly-1792454065999/candidate-manifest.json` SHA `0b7cf9bffae8987c9e343d809ed716b03f71ec7c8a9615e5a6f3af5106e4c272`，14artifact逐SHA/长度通过；相对2e373仅installed/main两函数、3只读helper及固定AAPT常量，另20函数AST完全相同，adb/install_once/预算/seed binding均不变，APK仍a793。`install-readonly-freeze-independent.json`，脚本 `verify-readonly-driver.py`。新6定向实际重跑通过，`install-readonly-author6.log`；独立追加3项：验证过程中旧回执改变不得产生新授权；已消费attempt在任何设备命令前拒绝再安装；实际pull后发现正式locator拒且本机临时APK移除。均mock subprocess，`independent-install-readonly.py` / `install-readonly-independent.log`，3/3。

新verify-install-readonly先核原失败scope，再fresh自有5582资源/SDK/marker/端口，固定唯一pm base→拉实际base全文SHA→对实际拉出文件apksigner单cert/aapt package/code/name→native安全locator。只在所有通过且原两文件SHA仍一致时wx/fsync另写receipt；缺包、分包、错字节/cert/version、证据变化均停，绝无补装。installed后续仍实际核base字节，并检查独立receipt与原失败SHA链。本scope通过，不代表实际设备取证已完成。

按root明确授权，同privateState旧approval SHA6f346… CAS更新为 `7c375189b6d6ab2d22f04cde4d4a6125849b93473f998430c510156eb3044b75`，保 `approval-before-install-readonly.json` 原字节与独立audit。APK/全部7个seed字段/原attempt/false结果严格不变。许可**仅verify-install-readonly后停止；禁止install/reset、push、launch导入及正式同步**。这项operator授权范围写入executionAuthorization，原driver approval gate没有新增action权限机制，不得据其技术上能调其他action推断已经授权。首包2f789的旧导入许可此时暂停；后继新包不得自动继承。脚本 `update-readonly-approval.mjs`，回执 `install-readonly-approval-cas-independent.json`。已一次通知root/native，未操作ADB。

## 第二十五批：十房归篇开关补全计划通过，首包完整设置交付暂停

独立核私有精确plan SHA `176da9defe15010602ca99875534fc276b1aba0b551a14aa6fa5a6e4ca6232ad`，基正式87cf及原588 capture manifest0148028b。同本地私有5个逻辑成员重新核SHA/roster并解typed graph，原link十房均配置存在，9个enabled:true、1个enabled:false；逐实际首包头与10个有界conversation成员SHA核验，十房均无clientMetadata.desktop.journalLink。本批共读取包4,272,001B，复用已独立通过的全容器/原件SHA，不再扫1.8GB包或3GB原件档案。

逐当前原owner JSON的library/epoch、十房profile revision及完整metadata/title/category/idle/mode/selfName核CAS，plan仅原conversation-save允许字段；新增精确 `{version:1,configured:true,enabled:原bool,category:原值}`，保false及其他metadata。对私有COW逐条运行已冻saveConversation，只有十房metadata及正常profile/registry revision+10，所有Entry/media/rawroom/program/binding/其他邻居逐hash保持；recipe所有房profile仍reuse且无blocker。审核结束再次读取原库，十房CAS/metadata未变。`tmp/shared-business-independent-review/verify-journal-link-plan.mjs`，证据 `journal-link-plan-independent.json/log`。首probe误将Uint8Array签名信封字节当JSON对象hash，测具修正后通过，原 `journal-link-plan-framing-probe-before.log` 保留，不作包损坏。

**该精确补全plan可由root/data按已授权原owner API执行，本代理未写正式库。** 十条是各自CAS，非全局原子；执行时逐房近期read/CAS、保分项回执，版本变化必须停，不能覆盖。后续同588 capture新source operation需更新targets，再同原key签后继包并补永久登记/签名key与回执备份，另批独审。首包2f789的字节/签名通过保持，但旧coverage算法未检查本新字段，不能继续作为“全部会话设置齐”交付。**旧包push/导入保持HOLD，后继包需具体新SHA独审及root授权；未批连续全房同步或原生主页。**
