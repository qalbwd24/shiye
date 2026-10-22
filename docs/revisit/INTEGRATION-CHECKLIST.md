# 朝花夕拾作为随想正式功能的接入清单

2026-10-19 12:20Z 最终运行：ui48已标准保存/备份/安装启动，指定后端会话已独立发布chat-reedit2，来源缓存及原子设置/会话消息能力均1；下方“候选/等待”是原阶段。原子程序设置、多slot登记及评论原引用重新编辑接线已启用，普通房仍legacy单写，AI执行/统一owner未启用。未向正式来源发验收评论，数据与运行回执分别见[前端验收](../validation/2026-10-19-chat-message-reedit.md)、[后端验收](../validation/2026-10-19-chat-reedit-backend.md)。

2026-10-19 12:17Z chat-reedit2配套后端已正式启用：受控replacementOf/replacementRootId原时原位后继、原子程序设置与多角色登记上线，来源缓存及路径锚点保持。独立72项相关测试＋9项真实HTTP及真实库副本兼容通过；正常保存/排空运行器/私有稳定快照后切包，3139旧日记、媒体/规则/评论/旧chatJournal/messageStore及旧78投递身份保持。普通房仍legacy单写，统一send未接replacement；AI只登记。ui44仅正常恢复ready/116%/两屏，已通知前端会话接续ui48标准升级，不能把后端上线当作ui48已安装。当前运行由config/backend-runtime.local.json选择chat-reedit2，source-cache1单功能运行状态为历史。见[配套后端验收](../validation/2026-10-19-chat-reedit-backend.md)与[实时协调](../ACTIVE-SESSION-COORDINATION.md)。产物outputs/2026-10-19-chat-reedit-backend，临时tmp/chat-reedit-backend。


2026-10-19 ui48前端候选已完成本轮核心验证，待指定后端会话审查发布后再安装：原子settings/read/save、多槽位/participants与程序/AI角色登记（无AI执行器），固定旧房保持原进度。评论重新编辑保留原instance/固定引用、新operationId及旧withdraw真实ACK先序；普通房仍legacy journal单写，本机撤回恢复正文不入后台。用户不限时/原位/原时间要求、长房重开与满页裁剪验证见[编辑验收](../validation/2026-10-19-chat-message-reedit.md)，消息/参数能力以实际health和所选不可变包为准，不把候选验收当作运行启用。

2026-10-19 11:39Z 来源缓存运行边界：source-cache1已独立上线，既有来源/评论/撤回/实例请求契约保持；正式数据核验通过。本轮不包含正在进行的不限时编辑、本机恢复、原位replacementOf及统一消息候选。服务启动受config/backend-runtime.local.json选包约束，后续发布须保留来源缓存/失效机制，按health检查实际能力。所有参与会话须及时同步[协调记录](../ACTIVE-SESSION-COORDINATION.md)及各自契约；新编辑需求见[需求文档](../CHAT-MESSAGE-REEDIT-2026-10-19.md)，已上线范围见[性能验收](../validation/2026-10-19-revisit-backend-index.md)。


2026-10-19 ui44已接真实四固定桥及按实例worker/收件/来源/评论/撤回；原固定房不迁移。目录驱动provider，只实现revisit，未知类型只读。旧“其他房间缺原生worker”是ui42历史，本轮隔离两房/双窗/解绑回归及C#真实桥分别通过，正式未建测试实例。设置后端成功需等待本机路由ACK；分步部分成功和409有显式恢复。AI执行、完整多程序编辑、云同步仍未实现。后端settings新候选不随本包部署。见[最新验收](../validation/2026-10-19-chat-ack-services.md)。

2026-10-19仅后端候选：会话状态/多程序身份/原子设置/统一收发/按lane游标/单条组媒体评论与legacy别名已完成隔离验证。前端待办仍包括固定原生动作、worker按scope保存与ACK、同房同槽位、多窗口冲突、所有权切换、墓碑清除、来源重验与跨设备接缝；本轮UI/正式API未动。外部程序/AI通道不含模型执行或专用机器人鉴权。[后端接入契约](../CONVERSATION-MESSAGING-BACKEND-API.md)列出全部接口与门槛；完整证据见[本轮验收](../validation/2026-10-19-conversation-messaging-backend.md)。

2026-10-19会话程序UI已正常升级启用ui42，通过17项定向浏览器检查：自身会话设置→程序与服务→嵌套参数，普通资料草稿/原连接保持；两合成会话独立、同会话双窗口共用与409冲突保护通过。现有固定房真实桥可用，其他房间无原生适配时保存禁用。未实现任意会话的bridge/worker路由，后续仍须两真实房间收件/引用/默认目标/旧实例解绑后回复联调，不能将UI交付等同全部完成。见[接缝](../CONVERSATION-SERVICES-UI-PORT.md)及[部署验收](../validation/2026-10-19-conversation-services-ui.md)；ui40性能修复保持。

2026-10-19 随想ui40已正常保存/备份/标准升级启用：朝花夕拾先筛待发评论ID，保留每条实际待发评论的最新撤回/删除/确认核验；78/300合成历史的整库读取82/304→4，真IndexedDB对照约1.14/4.20秒→0.05/0.057秒。17客户端＋27评论撤回＋8浏览器检查通过；实际约125秒整组CPU 9.25→2.59%，前端重启的内存降幅不全归代码。11915安装SHA/116%/2屏，API0.9.27原进程保持；首稿漏版本标记超时已纠正，最终candidate-ui40-final生效。后台来源索引/整库写入仍待优化，长期性能未结案。 [验收](../validation/2026-10-19-revisit-read-optimization.md)；产物outputs/2026-10-19-revisit-read-optimization，临时tmp/revisit-read-optimization。

2026-10-19缩峰与开关正式启用：API0.9.27/ui39、3150篇/3128媒体元数据及78原投递/评论/进度保持，真实120秒私有提交中位553MiB/高值1048MiB。现有会话设置顶部开关、总设置第一项状态已实际看到；任意会话选择provider/参数与bridge/worker scope仍待接，不能将兼容单例等同多会话完成。用户确认同会话跨窗口共用配置。见[正式验收](../validation/2026-10-19-revisit-live-update.md)，下方候选未部署为旧阶段。

2026-10-19 后端解析与waiting缩峰候选已验证，未切换日常API：无Window HTML解析、原队列内no-op跳过全库事务；11新增＋93相邻隔离通过，SourceRef/评论/时间及公开UI契约保持。前端无需为本轮改接字段。真实推进仍全来源/整库事务，旧“no-op待实施”仅为历史。见[核验](../validation/2026-10-19-revisit-algorithm-review.md)。

2026-10-19 ui38：宿主仅在获准关闭且FormClosed后的残留退出兜底，本机ACK不等于journal HTTP上传完成；无ACK可见页继续保留。提示与正文输入左边缘修正，历史来源/评论/规则及journal/worker/API0.9.26不改，API未重启。24真实Main＋1原件及2输入对齐定向，未发正式测试评论；见[验收](../validation/2026-10-19-chat-freeze-repeat.md)。

2026-10-19 ui37：更低手调输入下限及即时正常本人气泡默认过渡防护；历史来源/评论/规则、journal/worker/API0.9.26保持，后台未重启。本人即时确认与相邻输入定向通过，未冒称主观闪感根治；见[验收](../validation/2026-10-19-chat-instant-flash.md)。

2026-10-19 ui36/API0.9.26：历史/本人共用的输入高度与平滑Y轴修正，journal门控保留保存/撤回ACK；feed无新消息不再建全来源目录。config/来源/身份/评论/段落/自动游标保持，3150篇及相关分项hash一致、runner正常；8lazy＋4来源/段落与撤回邻近定向通过，没有发送正式测试评论。长期冷解析峰值仍未解决，见[本轮验收](../validation/2026-10-19-chat-compact-memory.md)。

2026-10-19 ui35仅宿主保存/收起/故障恢复，历史与本人消息共用宿主路径；既有source/评论目标、worker及API契约不改，本轮不发送正式测试评论。全app/朝花夕拾消息回归未重跑，按静态资产未变复用；定向原生生命周期见[验收](../validation/2026-10-19-chat-hang-recovery.md)。

2026-10-18初始包接入更新：[实际种子接口](../PRODUCT-SEED-API.md)保留旧非canonical长文的候选单元ID与SourceRef.snapshot，正文/时间绑定校验后沿用原评论目标；分类/标签改变不改绑，真实正文改变后旧来源失效而非重定向。包后墓碑先应用再发布本地资料，增量先pull完再push。私有运行器日期/进度/认证不在业务包中，迁云仍需单独一致快照，不能将新空库资料初始化等同已迁移自动续推状态。Android入口与UI权威映射仍待接；未改日常回看状态。

2026-10-18Android标准接缝已文档化：[Android统一契约v1](../ANDROID-PRODUCT-SYNC-CONTRACT.md)与golden fixture约束完整信封、同事务收件/outbox、单条/组/媒体评论及原件恢复。产品18789当前为独立库级revisit端点，不等同既有日常多实例绑定已挂入；Android需按服务能力接线再验。默认最近历史单条在HTTP中同样要带deliveryId，只传batchId是兼容组评论。此轮不改UI/运行器或旧评论；[文档验收](../validation/2026-10-18-android-product-contract.md)。

2026-10-18 长文段落消息后端已运行、ui28已标准安装：按真实段落/缩进拆分，同一手打时间下按段数递增1–2秒并保留原时间；媒体独立。180篇抽样/3002篇有效长文结构、最终35定向、29实际隔离前端及9正式feed只读通过；11737安装hash一致，3014旧长文及源字段/原评论/六个月规则保持。API0.9.24 health.revisit.paragraphMessages=1自动续推正常。两次备份遇窗口重开已安全中止；用户确认后第三次完成。**恢复随想/托盘启动命令被自动审批blocked by policy，待用户手动打开，不冒称原生ui28已运行**。范围/失败/备份见[验收](../validation/2026-10-17-diary-paragraph-messages.md)，产物outputs/diary-paragraph-messages，临时tmp/diary-paragraph-messages。

2026-10-17当前ui27补看链路实测：北京时间今日过去时段正式新增2、相同请求0，自动随后新增1；安装资产消费正式feed/渲染/刷新/引用框9项只读通过，六个月图文＋实际引用/默认最近单条回复23项合成通过，旧正文保持、正式没有测试评论。实际范围/时钟/无图边界见[补看验收](../validation/2026-10-17-revisit-backfill-today.md)。

2026-10-17ui27新增已验接缝：随机/间隔往返、保存与poll竞态、重开及明确刷新不得显示过期日期；history-interval/null清理需纳入后续UI。原兼容设置起止日期/启停/错误反馈已验，25逻辑＋18实际前端通过并正式更新；多实例选择器仍待独立接入。[验收](../validation/2026-10-17-revisit-mode-switch.md)。

2026-10-17会话多实例后端已实现并部署：9新增隔离及投递/备份兼容回归通过，正式health.conversationServices v1可用，原单例自动续推与来源保留。后端发现/实例/绑定/隔离调度/评论已完成；前端UI、固定桥、worker实例路由和真实两会话联调仍未完成。前端接入必须覆盖不同规则/换日、收件游标、引用及无引用、旧实例解绑后回复、重开与重启不重发，并保留现有固定房。见[实际接口](../CONVERSATION-SERVICES-API.md)、[验收边界](../validation/2026-10-17-conversation-services.md)。下方当前单例等记录保留历史。

2026-10-17最新运行与新范围：ui24＋正式后台已自动续推，health.revisit.autoStart=true；后台无窗口重启即恢复，进度/日期/评论保持，25项定向与12219安装hash通过，[回执](../validation/2026-10-17-revisit-autostart.md)。用户进一步确认未来程序/AI前后端分离、会话设置选择后端、多个会话各有回看规则；新多实例绑定尚未实现，按[通用接入设计](../CONVERSATION-BACKEND-CONTRACT.md)推进。以下ui23表保留上一阶段外观/正式启用证据，当前生命周期以本条与AUTO-START.md为准。

2026-10-17用户最新明确授权“优化完毕，正式启用”：ui23与D盘后台已正式接通，推送已开启。后续UI迭代仍将朝花夕拾视为随想功能之一；数据会话维护后端/传输与一致性，前端会话维护具体UI。实际回执见[正式启用](../validation/2026-10-17-revisit-formal-enable.md)，此前未部署状态为历史阶段。

## 本轮实际门槛

| 项目                                        | 当前结果                                                                                              | 负责方      |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------- |
| 当前随想UI                                  | 标准维护status于2026-10-18T01:00:35Z确认20261017-ui23 ready，12219安装SHA通过                         | 集成        |
| 来源、随机08:00周期、身份/评论、防重/运行器 | 当前45项定向通过，正式库私有副本预检通过；3014篇旧长文保持，聊天正常增量单列                          | 后端        |
| 正式API能力                                 | 已更新D盘API0.9.24，health.revisit.runnerControl=1，正式status/config/runner正常                      | 后端/维护   |
| 同一气泡外观，只改位置                      | ui23已安装；真实隔离worker/后台验证文字、Markdown、图注和媒体分组圆角一致，方向/来源/outgoing语义保持 | 前端        |
| 启用/刷新时居中系统提示                     | UI已消费生命周期事件，约4秒、不推滚、普通poll不重启；避开浮动时分且不透明背景可读；未写日记/评论      | 前端/接收桥 |
| 正式推送开启                                | 已开启daily-random/08:00/Asia-Shanghai，30秒运行器waiting；首次从启用时刻开始，当前抽中2025-07-20     | 集成        |

ui23证据见[统一UI验收](../validation/2026-10-17-revisit-ui-unification.md)，产物outputs/2026-10-17-revisit-ui-unification，临时tmp/revisit-ui-unification。42浏览器证据为39复用＋末次3定向，13原生按精确EXE/JS复用，10图片为旧证据，非整套重测。真实日记SHA及868×1649、116%/两屏档案保持。旧ui22外观未对齐的记录保留在outputs/revisit-activation，不代表当前UI状态。

## 稳定连接与职责

当前受管运行器与API同寿命；退出随想到托盘继续推送，API/电脑重启后自动恢复已启用的规则，持久日期/游标保留。访问锁正常解锁后自动继续，不绕过认证。尚未向私人历史消息发测试评论；新多会话接入由独立实例契约负责。

数据传输沿用[固定桥契约](FRONTEND-BACKEND-CONTRACT.md)，只更新本机固定路径白名单，不开放任意URL/文件接口。

- 接收：shiye-revisit-client.js；生命周期/纯展示数据：shiye-revisit-view.js。
- 原生调用：shiye-journal.js＋ChatJournalBridge.cs，需包含runner-status/start/stop，不能仅更新网页资源。
- 本地持久化适配：vendor/web-a/src/lib/gramjs/client/shiyeProgram.ts及mockUtils/MockTypes.ts；保留ui22消息排序/确认修复。普通消息收件使用原worker提交/确认，不通过DOM伪造消息。
- UI：shiye-revisit.js/css、现有Message组件/菜单。前端复用本人消息的同一套外观和渲染，将视觉与isOutgoing/历史来源语义分开；所有既有外观偏好同步应用。
- 后端：src/server/domain/revisit、routes/revisit.mjs、routes/revisit-runner.mjs和revisit-runner。不以UI重排改源ID、原始/回放时间或评论关联，不直接改运行中的diary.json。

## 居中系统提示的数据接缝

`createRevisitClient`接受`onNotice(notice)`；state公开config、randomDay、timeZone。默认首次启用和所选周期变化发布一次，普通poll不重复；`client.sync({reason:'refresh'})`明确表示用户刷新，必定再次发布当前历史日。现有入口转发为`shiye-revisit-notice`浏览器事件，`window.shiyeRevisit.refresh()`执行明确刷新，`readNotice()`可供组件稍后挂载时回读。锁定/禁用后发`shiye-revisit-notice-clear`，前端清除旧提示；不在正式库保存这些系统式提示。

```json
{
  "kind": "history-day",
  "reason": "enable",
  "cycleStart": "2026-10-17T00:00:00.000Z",
  "sourceDate": "2024-10-17",
  "displayDate": "24-10-17",
  "timeZone": "Asia/Shanghai"
}
```

reason为enable/refresh/day-change；sourceDate为null时显示暂无可回看的日期。提示居中，前端自行落实具体样式，内容应能说明本次回看哪一天。它不是过去的消息，不分配SourceRef、deliveryId、评论目标，不计入回看来源。刷新界面/提示不得重抽日期、倒回服务端游标或复制投递。

## 后续每轮UI更新的核心验证

1. 同内容的本人/历史文字、Markdown和图片使用相同样式/渲染；左右交换后仅位置变化，缩放/外观偏好一起生效。
2. 进入朝花夕拾、启用与用户明确刷新，居中显示正确历史日；收件轮询不刷屏，锁定后不残留历史来源。
3. 无引用回复最近可查看历史单条；普通引用回复指定单条，回复后有新来信也不改已捕获的目标。源日记按篇可查回评论，评论不参加回看。
4. 来源菜单只读查看、媒体/图注、已有草稿和错误重试，按实际改动选少量核心场景；未改模块按hash复用证据，遵循TESTING-POLICY。
5. 启用前保存/备份/标准升级，确认API health.revisit.runnerControl===1及固定桥，配置daily-random、08:00、Asia/Shanghai；第一次只从启动时刻推送。使用正式API配置，绝不将合成测试库复制到正式库。
6. 最终回读实际运行修订、健康能力、runner状态/所选日期和来源Entry哈希保持；更新本表、交接与验收。任何一项未通过，明确记录，不写成已经启用。
