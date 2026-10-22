# 会话消息后端与客户端接入契约

第九冻最新仍HOLD/P1：七冻publication误伤同ref已关闭，但永久publication撤回墓碑会被同ref可逆source available盖过，使未知目标旧feed迟到复活。后继必须分永久publication终态与可逆entry/reference水位，同一high仅复准确反例/cold/targets及identity；第八冻目标自身program SDK全文/原件权限与迟到source读已独验过，未授最终UI/维护/部署。准确记录见[验收](validation/2026-10-21-pc-groups-broadcast.md)，下方旧阶段不代此P1关闭。

第七冻最新独审HOLD：单个publication撤回不能把相同SourceRef的其他合法publication一起判不可读；actualHTTP＋同IDB已复现client水位范围误扩大、server仍active。须分publication终态和source entry/reference可见性，作者与目标program read SDK小增量另冻再交同一high。证据及状态见[验收](validation/2026-10-21-pc-groups-broadcast.md)，后文待审/5项通过不覆盖此新失败。

2026-10-21 多作者/SourceRef准确后继待独审：`candidate-1792574765950`（main4dd14ae0…/fallbackfcaf146b…，171源/18delta），[本次WIRE](../outputs/2026-10-21-pc-groups-broadcast/backend/candidate-1792574765950/WIRE.md)。既有conversations/send/edit/withdraw/restore及原program SDK按真实广播容器分流同_sharedCommands规范化ledger，actorId纳入不可变wire；row.actor是真作者，row.broadcast.deliverySource是传播来源，control独立给同作者可管理性。统一send kind:message允许任一合法actor给sourceReference定位，服务查真实SourceRef，禁止夹带独立正文/上传原件变副本。readSource纯读，source-bound media逐chunk重验，entry/reference水位精确失效旧cache、允许后来真实复显。新增authors/history-ref feature/marker/seed/loader与同schemafallback，旧六冻不能覆盖。作者5项过不代独审/最终UI；目标自身program read SDK尚有唯一相邻后继，原普通房owner及正式UI57/4a97保持。

2026-10-21 最新人类澄清要求广播群沿本文既有统一actor契约：本人、已登记机器人/程序/AI均可发言，地位及接口一致，所有作者的群消息均投递到全部接收成员会话；保发送时actor身份/快照，与广播来源分离。下方“仅本人广播”旧限定被[原会话管理最新规则](CHAT-ROOM-MANAGEMENT-2026-10-17.md)覆盖。第六冻本人范围已过证据不代多actor通过；统一send/feed/控制接口及必要feature/reader/seed/fallback后继正在准确接线，尚未冻结新wire或部署，不先宣称程序可在真实广播群端到端发言。

现有revisit自动`history/SourceRef`输出不经send，需补同广播链；人类已选择保留来源引用，原文隐藏/删除后也不可读，见原会话管理最新节。新delivery同ledger/固定名单及SourceRef关联、源/目标内容与原件读取重验，不独立复制原文、不回填旧history、不排除内置机器人，不将普通program发言通过外推全部provider输出通过。

2026-10-21 PC已接续广播必要私有实现，尚未完整冻结、独立验收或正式启用。用户已确认：选目录组时批量加入当时的会话，广播群之后独立增删成员；不动态订阅目录组。每条广播在本机耐久接受时原子保存原条、附件原件/引用、当时成员快照及待发任务，携可信成员版本或同scope父操作证明；重试保持同一操作/名单，远端冲突明确保留原待发，不静默重算。TL消息库仅作可重建显示投影，普通房仍原legacy单写owner。准确新wire及reader/marker/seed/loader/fallback门槛冻结后另补，不把私有内核局部测试写成生产或双端完成。共同规则见[会话管理](CHAT-ROOM-MANAGEMENT-2026-10-17.md)。

2026-10-20 新增广播接续设计在原[会话管理](CHAT-ROOM-MANAGEMENT-2026-10-17.md)顶部：一房多目录组；广播独立成员容器，逐条目标快照、逐目标稳定回执及明确program来源，单跳避免环。选组/名单冻结时点以2026-10-21人类确认规则为准。尚无新增生产接口/owner迁移，不能前端循环普通send冒称可靠广播；后续须固定广播原条、接收投递/归篇引用、编辑撤回、幂等/CAS及schema feature门槛后实施。当前cut和unbound各自候选不自动覆盖本新增功能。

2026-10-19 12:20Z 前端接续完成：ui48已标准升级运行，原子程序设置/多slot登记正式接入；普通消息仍legacy journal单写，受控replacement仅该口支持。统一消息client尚无生产store/owner迁移，AI执行器仍未实现；不能把接口可用写成完整机器人已运行。见[前端及交接验收](validation/2026-10-19-chat-message-reedit.md)。

2026-10-19 12:17Z 运行更新：独立chat-reedit2后端已启用，health.conversationServices.atomicConversationSettings=1/conversationMessaging=1，来源缓存保留。旧房未迁owner，前端ui48安装由其负责会话接续；下方“未部署”记录是原候选阶段。配套发布及数据核验见[后端验收](validation/2026-10-19-chat-reedit-backend.md)。

2026-10-19 前端正在适配原子设置/多slot，另按用户确认实现“本机无限期恢复、撤回占位＋原时间后继”。legacy journal新增受控 `replacementOf` 候选；此字段尚未接统一 `/conversations/send`，当前不得跨写口套用。普通房仍旧journal单写，不自动切owner。具体请求、幂等/CAS、引用保护及部署边界实时见 [参与会话协调](ACTIVE-SESSION-COORDINATION.md) 与 [编辑需求](CHAT-MESSAGE-REEDIT-2026-10-19.md)。source-cache1运行包保持，后续新后台包显式选择，不重启加载全部工作区候选。

2026-10-19 源码/隔离验证版。**本轮未重启或部署日常API/客户端；收尾只读观察为并行工作已启用ui43、API0.9.27仍缺新增能力。** 本文是前端、原生传输与后续后端适配的交接入口。验证证据见[本轮验收](validation/2026-10-19-conversation-messaging-backend.md)。

## 模型与职责

### 2026-10-21 广播 shared wire（私有内核准入，前端/启用待验）

当前准确第六冻`candidate-1792567636819`（main `8de0c240…`/fallback `648be0c1…`），[最新WIRE](../outputs/2026-10-21-pc-groups-broadcast/backend/candidate-1792567636819/WIRE.md)及[非作者high报告](../outputs/2026-10-21-pc-groups-broadcast/backend/review/kernel-independent.json)（ebd43d4f…）已准入私有内核scope。新restore feature/marker、原件/终态、CAS解冲突、seed/旧reader拒及exact同schemafallback均有独立实证；原时闭合篇/二次恢复亦过。以下首冻/第四/第五冻作为字段与修复过程，实际前端、最终包及维护仍未准，不能混用中间版本或把内核准入当正式启用。

与[目录扩展](SHARED-CONVERSATION-DIRECTORY-V1.md)共用 `candidate-1792564377876`，main `5cb450f9…`/同schema fallback `7c198056…`；准确字段和依赖记录见其[WIRE](../outputs/2026-10-21-pc-groups-broadcast/backend/candidate-1792564377876/WIRE.md)与[locator](../outputs/2026-10-21-pc-groups-broadcast/backend/current-review-locator.json)。以下沿固定shared command认证和库身份，不新增公开匿名发送口。

| action | 候选字段与职责 |
| --- | --- |
| `broadcast-send` | `{conversationId,text,attachments:verifiedMediaUUID[],sentAt?,replyToMessageId?,targetSnapshot,memberRevision或memberBaseOperationId,mediaOperations?}`；精确验证本地接受时冻结的名单及可信成员代际，过期409保原待发，不静默改名单 |
| `broadcast-edit` | `{conversationId,messageId,expectedRevision或baseOperationId,text,attachments,mediaOperations?}`；仅本人原条，沿原目标快照更新，含未完成目标 |
| `broadcast-withdraw` | 同原条身份及CAS、不带正文；原条终态与已物化派生脱敏同事务，迟到投递仅墓碑 |
| `broadcast-retry` | `{conversationId,messageId}`；仅原失败目标重入pending，原操作/名单/目标ID不换 |

第五冻`candidate-1792567563235`（main `85aeacc7…`/fallback `8e720229…`）新增受控`broadcast-restore`，正由同一非作者高审，不属于上表首冻能力：`{conversationId,messageId:已撤回root,expectedRevision或baseOperationId,text,attachments,mediaOperations?}`，新feature `conversation-broadcast-restore-v1`和marker `_conversationBroadcastRestoreVersion:1`。显式新operation/CAS、本机正文与原件，创建独立新root/message/unit，`initialRootId/previousRootId`串直接前驱/最初根，原withdrawn实体/unit永久墓碑、flatten与transport均`{}`，不能重新active；domain只可补脱敏`successorMessageId`并防分叉。名单/标题/原sentAt沿原root，原时原位，停用/归档群禁新恢复；离线可信withdraw父回执及媒体依赖沿共享事务。新loader真实拒第四冻/4a97打开新restore marker；新seed reader/fallback同四feature闭包，旧第四冻reader拒新feature。准确[WIRE](../outputs/2026-10-21-pc-groups-broadcast/backend/candidate-1792567563235/WIRE.md)，共同语义见[恢复要求](CHAT-MESSAGE-REEDIT-2026-10-19.md)。

同冻facade新增`prepareRecovery(rootId)`只读最近本机确认前的`text/attachments/localAttachments/sentAt/targetSnapshot/recoveryRevision`，确认edit/withdraw同shared事务写私有`entity.localRecovery`，不进wire/replication/seed；取消不写。`restore(input,{operationId?})`沿原件job/同事务ACK，离线withdraw→restore父依赖及丢ACK冷开重试仍同wire。附件保留/移除必须显式；`readAttachment(assetUUID)`经本机asset→Blob/SHA别名读取，缺失才沿固定media-read有界分块并核完整SHA后缓存，不能因asset去重而误把uploadOp当assetID，也不降成纯文字假成功。此为候选接缝，真实composer/恢复准备/取消/原时定位及最终包尚待独审。

原条稳定根ID为`broadcast:<发送operation UUID>`；逐目标稳定delivery定位锚和原条分开，源标题/名单/回执持久，受控来源为`providerId:'controlled-broadcast'`。**2026-10-21审核中已明确，首冻同unit.id递增revision的编辑实现不满足准入：每个版本须有独立canonical message/unit身份与直接前驱，确认后旧条空墓碑＋新条原时原位接续，取消不动；不得在服务保留旧正文。第四冻`dfe73657…`/`939d5d16…`的该修复及原7反例已独立通过，但CAS409恢复仍HOLD、受控restore后继未冻，不能把局部通过或首冻wire当整包准入。** 目标引用真实source/room，归篇开关与原分类由既有owner处理；关闭归篇或无分类只写同canonical message unit的显式null-entry，不造隐藏Entry或双写原journal。接收派生只读、可定位原条、不能再次触发广播。业务message/local ID可能是超出JS安全整数范围的十进制字符串，TL数字显示投影必须保原身份可逆，不允许Number截断或碰撞。

客户端`installGroupsBroadcastFacade`复用原shared IndexedDB/transaction port，先核真实info的库绑定，随后可沿原绑定离线冷开；`refresh`只读小型organization。实际composer早期`acceptSend`在同事务保存原条、新原件Blob/metadata、附件引用、名单证明及不可变pending，成功才ACK并允许TL显示投影。上传复用既有begin/chunk/complete及可信媒体receipt，原wire中的UUID/SHA/size/type不在重试时换；新图片失败不阻塞无依赖的后续纯文字。媒体/原条完整接线仍须真实页面定向验收，host测试不能代过。

新持久marker为`_conversationGroupsBroadcastVersion:1`与`_conversationOrganization`；必要null-entry另有`_chatMessageUnitsVersion:1`。reader/replication新增groups、broadcast-conversation和broadcast-message实体并保持seed requiredFeatures。首次写入前必须准确启用识别真实marker的稳定loader及同schema fallback；旧4a97由新loader拒载新库，不能声称绕过loader的历史直启程序会自动识别。`chat-units-unbound-v1`在本窄候选只提供显式null-entry schema读写接缝，不意味着已接先前持续本人ingest或恢复数据QA。

- 会话`conversationId`是消息容器，不由某个机器人独占；个人记录`session`可改为`group`。一个群聊可绑定多个独立程序实例，同一实例不跨会话复用。接入程序时，已保存的个人会话自动提升为group并增加会话revision。
- 参与者`actor`包含`id/kind/name/providerId?/instanceId?/avatarAssetId?`。本人ID为`self`；程序/AI为`program:<instanceId>`，kind为`program`或`ai`。展示用名字不是主键。新普通消息保存发送时的actor快照；旧消息无快照时按本人兼容显示，不反写旧数据。
- 当前provider有`revisit`和`external-program`。后者仅登记外部程序/AI角色、开关与JSON参数，并允许其通过会话口读写。**不执行AI、不启动任意脚本、不访问任意URL**；真正的模型或业务进程另实现，并自行遵守开关。
- 本机日常JSON库是当前实现的权威。新普通消息复用既有chatJournal和messageStore，强制生成canonical richdoc消息；图文附件引用既有media ID，原文件仍单独保存。历史来信只投射来源，不复制原日记；评论复用既有comment unit/SourceRef，永不作为回看来源。
- 前端只处理页面、收件/待发队列与参数提交。规则、游标、去重、来源校验、消息写入和评论关联均由后端处理。不得用窗口标题、会话名称或本地localStorage配置替代稳定身份。

## 身份、能力与安全边界

当前会话身份沿用已有`desktop:<journalSourceId UUID>:<roomId数字>`。手机同步后应复用同一conversationId，不能根据手机自己的临时数字房间号另造身份；将来切换独立UUID需显式保留映射，本轮没有迁移旧ID。

沿用现有库级认证、锁定与`X-Diary-Client: desktop`等合法客户端请求要求。`actorId`是已认证库所有者授权下的消息署名，**不是独立机器人登录凭据或隔离沙箱**。外部不受信任程序的专用token/最小权限、云端多用户与推送通道尚未交付，不能把本接口直接开放为公共匿名机器人入口。程序在本会话可读写，不得借另一个会话的actor/实例/游标串流。

源码health新增`conversationServices.atomicConversationSettings=1`和`conversationMessaging=1`；catalog的`participantModel`明确多程序、角色及`aiExecution:false`。客户端先探测能力。现有已运行API没有这两项，须待后续明确部署，不能只凭同为0.9.27版本号判断。

## 设置接口：原子提交与多窗口

所有路径位于`/api/conversation-services`；除下表特别注明外均POST，JSON对象。

| 路径                   | 参数与用途                                                                                                                                                  |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET 根路径             | 实际providers、instances、bindings、conversations与能力；不创建任何数据                                                                                     |
| `/settings/read`       | `{conversationId,slotId?或bindingId?}`，读取一个程序的权威快照                                                                                              |
| `/settings/save`       | `{conversationId,slotId?或bindingId?,instanceId?,providerId,expectedBindingRevision,expectedConfigRevision?,config?}`，在一次存储事务内创建/绑定/改参或解除 |
| `/conversations/state` | POST读取`{conversationId}`的会话资料、participants、bindings、programs                                                                                      |
| `/conversations/state` | PUT保存`{conversationId,expectedRevision,mode,title,selfName,category,idleHours,messageOwner?}`                                                             |

首次接入建议显式`slotId:'history'`，第二个程序如`slotId:'assistant'`；槽位只能含字母/数字/下划线/横线，长度1–64。同一conversationId+slot稳定得到同一实例/绑定，**同一会话的所有窗口必须使用同一槽位**。多个绑定时不允许无目标地读取第一项，必须给slotId或bindingId；返回409表示需明确选择。

读取返回`{conversationId,providerId,instanceId,bindingId,bindingRevision,config,categories,canSave}`。首次binding/config期望版本均0；之后分别使用当前bindingRevision和config.revision，不能混用。读取后参数表单在前端只保留草稿；保存成功才显示生效。409保留草稿并提供重新读取；同参数丢响应重试幂等，不重新建实例；超过128次其他设置操作后很老的重试可能返回409，仍不会重新创建或覆盖。

`providerId:null`解除指定接入，保留原实例/消息/评论/进度。再次接入同一槽位/绑定恢复原实例；不同类型使用新槽位，不能原地把朝花夕拾变成AI。原实例终身保留其conversationId，换绑后也不允许挪到另一个会话。

revisit的config沿用既有字段：enabled、title、mode、dailyTime、interval、timeZone、categories、sourceDateFrom/sourceDateTo、sender。本原子设置口纯暂停/恢复保留checkpoint；回看规则实际改变仍初始化新规则窗口，旧deliveries/batches/comments不删。旧单例config接口原语义没有改写。

external-program的config为`{enabled,title,sender:{name},kind:'program'|'ai',parameters:{...}}`，parameters最大16KiB，表示公开业务参数；密钥管理需另用凭据方案，不应混进可展示参数。更新可只提交这些可编辑字段的patch，不能把version/revision等服务端字段原样塞入config。外部执行器读取参数后自行执行；关闭后禁止该actor新增消息或作为actor读取群聊，但已成功请求重试仍返回原回执。

旧固定朝花夕拾房`-900000001`使用`legacy-revisit`虚拟实例别名，默认/`slotId:'revisit'`读写原db.revisit，不创建新实例、不迁移旧进度。只能用推送开关暂停；新程序用其他槽位接入。客户端保留旧deliveryId到现有本地消息的映射，不能把同一来信再插一份。

## 统一收件

POST`/conversations/feed`：

```json
{
  "conversationId": "desktop:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:-101",
  "limit": 50,
  "after": {
    "conversationId": "desktop:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:-101",
    "positions": { "messages": 0 }
  }
}
```

首读省略after或传空对象。返回`{version,conversationId,participants,messages,lanes,next,hasMore,redactions,sourceRevalidation}`。**next是含conversationId的完整游标，不是一个数字**，只能原样用于同一会话；其他会话/其他实例的游标键返回400。

messages统一信封包含稳定id、conversationId、kind、actor、sentAt、state和`order:{lane,sequence}`：

- `kind:'message'`：canonical body、markdown兼容文本、attachments、entryId、revision、replyTo。相同时间按权威本地序号排序，不用hash ID决定先后。
- `kind:'history'`：instanceId、deliveryId、batchId、originalAt、source/sourceRef、readOnly。sentAt是呈现时刻，originalAt是原消息时刻，不要混为一谈；source的Markdown预览可能截断，完整原文走既有source接口。
- `kind:'comment'`：instanceId、operationId、body/markdown、replyTo、commentOn和batch/delivery目标，可能由人或已接入程序署名。

每次最多limit条，总量跨lane计算；lanes分别维护普通消息/每实例历史/每实例评论的进度。返回页内已稳定排序，**不是全会话按时间的单一数据库分页**；前端须按稳定id合并各页，按sentAt/order稳定展示，并保持滚动锚点。保存到本地并完成事务后才更新next；崩溃重读同页按id去重，不以名字/正文/时间戳去重。

redactions在增量页也可能出现，必须先清除对应缓存正文/附件再展示；不能只处理messages。隐藏/删除的普通归篇不给正文，已撤回消息为无正文墓碑。历史隐藏/删除及已替代条目会返回不可用提示。旧来源正文真实变更的完整重验需要开启来源时调用服务实例source/media，或新一轮after={}重验缓存；本口不是通用所有字段变更日志，不替代既有多端同步协议。

## 发送、引用、评论与撤回

POST`/conversations/send`普通消息：

```json
{
  "conversationId": "desktop:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:-101",
  "operationId": "11111111-1111-4111-8111-111111111111",
  "actorId": "self",
  "kind": "message",
  "text": "**今天的想法**",
  "attachments": [],
  "sentAt": "2026-10-19T04:00:00.000Z"
}
```

程序/AI使用`actorId:'program:<instanceId>'`，其它格式一致，可读取同一群聊并回复其它发送者。普通引用使用`replyToMessageId`（服务端稳定消息id），不能发本地临时数字ID。附件先上传到现有媒体接口，再传media ID；后端不接收任意磁盘路径/外部URL。未给sentAt时后端用首次接收时刻；离线队列建议生成一次sentAt并保持。操作ID首次生成后，断线/重试不得改正文、发送者或目标；相同operation返回同一消息，差异409，撤回后重试不复活。

普通消息返回`{kind,conversationId,messageId,localMessageId,entryId,state,revision}`。localMessageId是服务端归档内部数字号，不能当全局主键。新消息会原子写入既有chatJournal并生成同格式canonical richdoc unit；自动归篇仍按会话idleHours（默认由前端设5小时）与分类边界。

评论也走send，`kind:'comment'`。引用优先传`reply:{instanceId,batchId,deliveryId,occurrenceId?}`；无引用传`displayedTarget:{instanceId,batchId}`，表示输入框当前显示的最近一组/用户选定组。**后端不猜“发送瞬间最新的一组”**：多程序下那可能不是用户刚看到的对象。前端在开始写或切换对象时调用`/conversations/context`校验，保存这一冻结对象到草稿和待发队列；切房/新推送不改它。精确图片/视频评论还需occurrenceId；文本评论本身暂不接受附件，普通群聊消息可发图文。

评论返回权威comment unit，关联原日记按篇聚合且保留单条/媒体位置。新规则、换绑、解绑后仍可回复原会话的旧实例，不能把历史评论转给新实例或其它会话。评论不会进入之后回看。

POST`/conversations/withdraw`：普通消息`{conversationId,actorId,kind:'message',messageId,expectedRevision,operationId?}`；评论`{conversationId,actorId,kind:'comment',instanceId,operationId}`（此operationId为原评论发送操作ID）。只撤回相同actor的消息，不替人删除旧来源；返回墓碑，后续feed给redactions。后台不保留撤回正文，客户端可仅在本机持久保存恢复材料；本轮原时原位重新编辑只接下述legacy journal，统一send尚未支持replacement字段，不得跨owner套用。

### 旧journal的原位替代

普通旧房继续单写 `POST /api/chat-journal/messages`，新消息携带 `replacementOf`（直接前驱数字字符串）和可选 `replacementRootId`（链根数字字符串，仅伴随replacementOf），保留原sentAt；新消息使用新ID，禁止复活原ID或借previousLocalId表示替代。先等原withdraw真实ACK再append；取消编辑不撤回。

后台校验同source/room/作者、原时和已撤回目标，只允许一个直接后继；同ID完整请求重试幂等，异文/分叉/手改篇/已删篇返回409。根已归篇、直接前驱未上传即撤回时，沿全部已撤回的唯一链末端补无正文前驱，再接新条回原篇，不动当前篇deadline；从未归篇则独立closed历史篇。未上传的中间版不承诺全部补到后台，本机提示链由前端保存。详细示例见[编辑需求](CHAT-MESSAGE-REEDIT-2026-10-19.md)；冲突保留本机待发，不自动改时间绕过。

## 前端切换写口的硬边界

普通旧会话当前仍由桌面journal归档写口维护。**不要同时调用两个写口**。客户端先持久保存/确认已有outbox、暂停该房旧journal发送，再PUT会话资料时显式指定`messageOwner:'conversation-services-v1'`。后端据此启用统一send，拒绝该房旧归档append/withdraw入口，防重复和绕过发送者校验；不自动迁移/改写历史正文。一次切换只是所有权标记，不清消息或进度；本轮没有对正式库执行。

前端须将消息上传和回复操作串行按发送时间提交，沿用现有归档的时间顺序约束；回执冲突保留本地待发，不改内容重试。设置窗口关闭不删除未确认草稿。壁纸/设备字号/窗口记忆继续各端维护，不塞进程序运行state。

## 原生/worker/界面待办（本轮未实施）

收尾只读观察：共享原生桥已由并行工作加入service-catalog/create/bind/request，journal也在加载services适配模块；请保留并在此基础上补齐下列固定动作。此观察不是对其实现或运行包的验收，不能把本后端结果当作它已接通。tmp中的早期frontend-transport-draft只是未完成思路，不能执行或当成现成适配代码。

1. 原生`ChatJournalBridge.cs`增加固定白名单到上述catalog/settings/state/feed/context/send/withdraw路径；JS只提交固定动作，不能开放任意URL或命令执行。旧program/revisit通道保持兼容。
2. 先探测health能力再启用“接入/保存”，从已有journal link原子读取sourceId，多个窗口首启不能各生成一个；同会话同槽位共用服务器配置。
3. UI按实际providers/participants显示本人、朝花夕拾、外部程序/AI；外部参与者入口注明“需外部执行器”。程序参数页面和会话资料分开保存，CAS失败保留草稿。
4. Worker去掉固定房/固定PROGRAM_USER假设，以`conversationId+instanceId+message.id`路由、去重与保存ACK。本地数字ID只作视图映射；旧legacy alias映射原消息，不重复插入。
5. 收件游标、目标草稿、评论outbox和撤回均带scope。原生/客户端显示来源时再验证source/media；即时清除redactions和已撤回缓存，不让迟到响应换房后落入新会话。
6. 保留ui40待发ID筛选与逐条最新撤回校验，单调度器管理多个服务，不因多个窗口重复执行服务端推送。可通知其他窗口重新读配置，但通知不能成为权威数据。
7. 真正接入后以两会话不同规则、同会话双窗、legacy旧房+AI角色、精确引用/组/媒体评论、解绑换绑、重启续推、离线待发、撤回墓碑、图片原件分别联调。后台隔离通过不替代这一步。

固定REST实例接口仍见[已有服务API](CONVERSATION-SERVICES-API.md)；前端视图port是[UI适配口](CONVERSATION-SERVICES-UI-PORT.md)，它不是新增HTTP端点；可优先适配本原子设置和统一收件口，不复制一套业务规则。

### 未归篇聊天单元候选（隔离实现，未部署）

关闭自动归篇或未关联分类的真实房也须持久共享已durably发送的本人消息，不强开归篇、不造空/隐藏Entry。候选在原JSON messageStore使用同chatUnitId，chat origin.entryId可显式null；diary/comment仍必须真实Entry。unit.body保持正文authority，chatCompatibility是经compatibilityHash核验的原journal格式缓存；正式归篇沿原append时缓存移到真实Entry、同unit原子关联，身份及引用不换。严格sourceUUID/room/message十进制字符串，pending/demo/program/准备File不得冒充已发消息；异文同ID明确冲突。

新shared固定action chat-ingest-sent与明确chat-units-unbound-v1能力只登记已发消息，不操作归篇开关。新增chat-message只读复制实体，原feed合并同ID去重；撤回及HLC后继使用原_messageEdits与withdrawal ledger，终态脱敏不复活。持久_chatMessageUnitsVersion:1与业务同事务落盘；新seed requiredFeatures增加chat-units-unbound-v1，旧reader拒未知。稳定launcher候选读取实际JSON marker并要求所选manifest businessFeatures显式支持，旧库无marker不受影响；新同schema仅禁写fallback保完整读，旧11708/87cf在出现marker后不得启动。当前仅隔离树候选，未接PC UI/实际持续端口，continuousSyncReady仍false。

### 2026-10-20 未归篇持续消息第二冻（未部署）

暂停点已在私有 `tmp/unbound-chat-candidate` 接续。原messageStore允许chat `origin.entryId:null`，同chatUnitId/source/room/message保持；关闭归篇或无link房可走固定 `chat-ingest-sent`，不用隐藏Entry或第二业务库。显式原journal-send归篇同事务绑定真实Entry，HLC/引用/原sentAt/终态仍由原ledger维护。持久 `_chatMessageUnitsVersion:1` 与reader/seed/launcher功能门槛已成闭环，客户端未知requiredBusinessFeatures拒绝、旧87cf真实manifest拒marker库；fallback只禁新ingest/HLC，保读与无关写，不是整库只读。通用floor另识别 `service-settings-projection-v1`，本冻不声明/不含其实现，不能用于settings marker库。

PC runtime已导出可调用采集/受控广播轮询调度，以已持久worker整数消息为源，不依归篇enabled，不以目录metadata当持续发送；成功转发/重新编辑的localForward等仅剥字段、不漏正文。媒体resolver本冻仍外置，真实documents上传接缝另overlay补齐，产品页未启用。第二冻backend162/453 manifest `64086c0721aa43662a114cd33f9d834bbc171504a89508d4727025b75bedd21c`、同schema fallback `f20649ddaf023d879f9376bfcf7ce1409a61a008cc554a4d6134309d6997e226`、client70 `b0d914b45b26582581d57d332739b605156a6c4f396207566e49fe631a9a71d4`；13核心过，旧bound校验过宽原失败已窄修，42邻近复用+原例1新过。未独审/部署/设备，continuousSyncReady仍false。入口 `outputs/2026-10-20-unbound-chat/candidate-1792481836707/handoff.json`，详见[验证](validation/2026-10-20-unbound-chat.md)。

### 2026-10-20 源撤回后继与真实原件接缝（当前候选，待独审）

`chat-ingest-sent` input仍为 `{sourceId,roomId,messages}`，现增可选 `withdrawals:[{messageId,sentAt?,operationId?,replacementOf?,replacementRootId?}]`，每批最多50项，只有本人普通源，不收actor/任意额外字段。先原withdrawChatMessage、后原unit ingest，同原COW事务/回执；显式已知时间须等原记录，否则拒。无原正文时只以完整durable tombstone时间建立无正文null-entry单元；旧简化marker只可从真实已有message/withdrawal取时间，缺证据409整批回滚。HLC显式root终态抑制后继正文，legacy单条withdraw不冒root终态。PC端口同原shared IDB先撤回batch/checkpoint，再后继batch/checkpoint，重试/重启保同op。独审原300→301反例作者重放现300withdrawn/301active/pending[]，独立复审待回执；旧第二冻hold。

runtime新增显式 `enableSentMessages:true` 及默认 `createDesktopSentMediaResolver`，只读原IDB source锚，读同durable snapshot的成功整数消息/documents，复用现shared media begin/chunk/complete及server.stage续传，按完整SHA/size/type证明和原owner去重复用原UUID；localCache仅verified receipt，不建第二媒体queue/业务库，不动UI/worker写owner。PNG图文落盘、既有UUID复用、600003B丢chunk/complete ACK同op重试、真实bootstrap默认resolver已隔离通过。Native仅client66的SharedSeedFile.java一个源增已知chat feature/上限3，保持未知拒绝，原21Java不变；host已验不是设备。

当前交审 `outputs/2026-10-20-unbound-chat/candidate-1792482750598/handoff.json`：backend162/453 `ecabbfa12976da716774819d1c96553bcbd4884c533e74609c364894cb457421`、同schema fallback `f03896547e97af7662cf8f6e9501c4fe7aca74f4509002bb4407eced040c8547`复用第三冻；client71/22Java `344529817ec1e5f07447a8c6d65fe02b3c4ad8efb47723cd5cdb3547b39d415b`。冻结18项、native6+原未改30及36源lint0。未启正式/产品/设备，continuousSyncReady仍false，详见[验证](validation/2026-10-20-unbound-chat.md)。

2026-10-20 补回执：上述第三冻 ecabb/f038/6005 已获[独审第五批](validation/2026-10-20-backend-resumption-independent-review.md)限定通过，原300→301与缺前驱/纯withdraw/重启反例闭合。最终client71/media/native `344529…` 仍另审；PC产品opt-in与settings/export组合由对应owner后续处理，本消息切片不争用当前维护窗。
