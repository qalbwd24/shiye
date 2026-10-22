# 朝花夕拾：前后端分工与联调契约

2026-10-19 12:20Z 最终运行：ui48及配套chat-reedit2已分别标准发布，source-cache保留，health两个会话能力均1。下方候选/交接文字保留阶段边界；生产普通房仍legacy journal单写，统一send不支持replacement，AI只有参数/角色登记。当前[前端回执](../validation/2026-10-19-chat-message-reedit.md)与[后端回执](../validation/2026-10-19-chat-reedit-backend.md)为运行依据。

2026-10-19 12:17Z chat-reedit2配套后端已正式启用：受控replacementOf/replacementRootId原时原位后继、原子程序设置与多角色登记上线，来源缓存及路径锚点保持。独立72项相关测试＋9项真实HTTP及真实库副本兼容通过；正常保存/排空运行器/私有稳定快照后切包，3139旧日记、媒体/规则/评论/旧chatJournal/messageStore及旧78投递身份保持。普通房仍legacy单写，统一send未接replacement；AI只登记。ui44仅正常恢复ready/116%/两屏，已通知前端会话接续ui48标准升级，不能把后端上线当作ui48已安装。当前运行由config/backend-runtime.local.json选择chat-reedit2，source-cache1单功能运行状态为历史。见[配套后端验收](../validation/2026-10-19-chat-reedit-backend.md)与[实时协调](../ACTIVE-SESSION-COORDINATION.md)。产物outputs/2026-10-19-chat-reedit-backend，临时tmp/chat-reedit-backend。


2026-10-19 编辑与多程序适配补充：已验前端候选ui48，后端交接给用户指定的“检查拾页运行性能开销”，尚待正式运行切换。参数写入必须原子settings接口/CAS且等待本机路由ACK，旧固定房不迁规则。评论编辑沿原instance/batch/delivery/occurrence，不猜当前绑定或最新来信，先旧withdraw ACK，再新operationId；普通消息保持legacy journal单写，原位后继通过replacementOf/replacementRootId/原sentAt。撤回正文和失败编辑稿只在本机IDB保留，服务端旧条无正文；统一send尚未实现替代字段，禁止据legacy支持隐式切owner。详见[需求及边界](../CHAT-MESSAGE-REEDIT-2026-10-19.md)、[核心验收](../validation/2026-10-19-chat-message-reedit.md)和[持续协调](../ACTIVE-SESSION-COORDINATION.md)。

2026-10-19 11:39Z 来源缓存运行边界：source-cache1已独立上线，既有来源/评论/撤回/实例请求契约保持；正式数据核验通过。本轮不包含正在进行的不限时编辑、本机恢复、原位replacementOf及统一消息候选。服务启动受config/backend-runtime.local.json选包约束，后续发布须保留来源缓存/失效机制，按health检查实际能力。所有参与会话须及时同步[协调记录](../ACTIVE-SESSION-COORDINATION.md)及各自契约；新编辑需求见[需求文档](../CHAT-MESSAGE-REEDIT-2026-10-19.md)，已上线范围见[性能验收](../validation/2026-10-19-revisit-backend-index.md)。


2026-10-19 ui44已接真实四固定桥及按实例worker/收件/来源/评论/撤回；原固定房不迁移。目录驱动provider，只实现revisit，未知类型只读。旧“其他房间缺原生worker”是ui42历史，本轮隔离两房/双窗/解绑回归及C#真实桥分别通过，正式未建测试实例。设置后端成功需等待本机路由ACK；分步部分成功和409有显式恢复。AI执行、完整多程序编辑、云同步仍未实现。后端settings新候选不随本包部署。见[最新验收](../validation/2026-10-19-chat-ack-services.md)。

2026-10-19新增后端候选，用户明确本轮不动UI：多程序/AI参与者、原子会话设置、canonical普通消息、独立游标和冻结评论目标已做隔离验证；旧朝花夕拾legacy别名不迁进度。外部AI只提供角色/参数/读写通道，无模型执行器。原生bridge/worker/UI由接入方按[新完整契约](../CONVERSATION-MESSAGING-BACKEND-API.md)实现，包含同会话同槽位、多窗口CAS、保存后ACK、消息所有权切换和旧房去重要求。本轮未操作正式API/客户端，不把源码能力写成已部署。

2026-10-19会话程序UI已启用ui42：入口统一到自己的会话设置，再进入程序参数；原固定朝花夕拾沿用真实桥，普通房间的配置视图通过显式port适配，通道未接不允许保存。前端普通资料/服务配置分别提交，配置与绑定revision分别校验；跨窗口通知只触发读权威值，dirty草稿不覆盖。17项合成隔离检查通过；尚未接通任意会话的原生桥及worker feed/评论scope。见[UI端口与后续接线](../CONVERSATION-SERVICES-UI-PORT.md)、[本轮运行边界](../validation/2026-10-19-conversation-services-ui.md)。

2026-10-19 随想ui40已正常保存/备份/标准升级启用：朝花夕拾先筛待发评论ID，保留每条实际待发评论的最新撤回/删除/确认核验；78/300合成历史的整库读取82/304→4，真IndexedDB对照约1.14/4.20秒→0.05/0.057秒。17客户端＋27评论撤回＋8浏览器检查通过；实际约125秒整组CPU 9.25→2.59%，前端重启的内存降幅不全归代码。11915安装SHA/116%/2屏，API0.9.27原进程保持；首稿漏版本标记超时已纠正，最终candidate-ui40-final生效。后台来源索引/整库写入仍待优化，长期性能未结案。 [验收](../validation/2026-10-19-revisit-read-optimization.md)；产物outputs/2026-10-19-revisit-read-optimization，临时tmp/revisit-read-optimization。

2026-10-19API0.9.27/ui39已正式启用：health新增inertLegacyParsing/idleTickPreflight，两项均1；原业务参数/来源/评论/规则与游标保持。现有朝花夕拾会话齿轮直达顶部持久开关，总设置首项仅管理导航。用户再次确认会话选provider后独立开关与规则，同会话多窗口共用；任意会话的选择器、实例bridge/worker仍待独立接入，本轮不伪装成已完成。真实内存测量与保留边界见[验收](../validation/2026-10-19-revisit-live-update.md)，下方未部署为旧阶段。

2026-10-19 后端缩峰源码候选完成、未部署：无Window旧HTML解析与写队列内waiting/disabled预检。公开请求/响应、来源/评论及推送窗口语义保持，前端无需变更；后台更新须后续标准维护，不因源码已改推断当前日常进程生效。11新增＋93相邻隔离通过，真实整库/长期收益仍待验。见[核验](../validation/2026-10-19-revisit-algorithm-review.md)。

2026-10-19 ui38：宿主仅在获准关闭且FormClosed后的残留退出兜底，本机ACK不等于journal HTTP上传完成；无ACK可见页继续保留。提示与正文输入左边缘修正，历史来源/评论/规则及journal/worker/API0.9.26不改，API未重启。24真实Main＋1原件及2输入对齐定向，未发正式测试评论；见[验收](../validation/2026-10-19-chat-freeze-repeat.md)。

2026-10-19 ui37：更低手调输入下限及即时正常本人气泡默认过渡防护；历史来源/评论/规则、journal/worker/API0.9.26保持，后台未重启。本人即时确认与相邻输入定向通过，未冒称主观闪感根治；见[验收](../validation/2026-10-19-chat-instant-flash.md)。

2026-10-19 ui36/API0.9.26：历史/本人共用的输入高度与平滑Y轴修正，journal门控保留保存/撤回ACK；feed无新消息不再建全来源目录。config/来源/身份/评论/段落/自动游标保持，3150篇及相关分项hash一致、runner正常；8lazy＋4来源/段落与撤回邻近定向通过，没有发送正式测试评论。长期冷解析峰值仍未解决，见[本轮验收](../validation/2026-10-19-chat-compact-memory.md)。

2026-10-19 ui35仅宿主保存/收起/故障恢复，历史与本人消息共用宿主路径；既有source/评论目标、worker及API契约不改，本轮不发送正式测试评论。全app/朝花夕拾消息回归未重跑，按静态资产未变复用；定向原生生命周期见[验收](../validation/2026-10-19-chat-hang-recovery.md)。

2026-10-18初始数据包协议已交付，见[PRODUCT-SEED-API](../PRODUCT-SEED-API.md)。旧日记规范化保留原候选单元ID及绑定后的旧snapshot，SourceRef/评论原目标不改；真实正文变动使旧snapshot不可用，不能悄悄回指新的段落。服务公开资料可随业务包传输，服务器私有游标/抽选进度/配对签名不在包内；已有服务迁移仍按一致快照处理。手机安装事务需先应用resolve.redactions、保留本机待发评论命令，先补完增量后再flush；Android具体入口与收件UI另接。

2026-10-18Android开发统一使用[标准数据与调用契约v1](../ANDROID-PRODUCT-SYNC-CONTRACT.md)及实际PRODUCT-SYNC-API。现有沉浸式默认回复最近历史单条保持：未点引用按钮仍需传固定deliveryId，API省略deliveryId才表示固定组。完整信封/SourceRef/评论及本地收件游标同事务保存，评论不作为来源。产品18789只提供独立库级服务，日常多实例registry接口另列，不能互相推断已挂载。只更新开发约束/合成DTO，无UI或运行切换。

2026-10-18 云化方向已由用户确认：服务器按客户端配置独立执行朝花夕拾，客户端渲染/读写本地资料并同步配置、结果和评论。运行调度cursor/抽选/去重仅服务器写，每设备同步游标独立；原实例/SourceRef/评论关联不因跨端改变。后续按[同步协议草案](../SYNC-PROTOCOL-DRAFT.md)适配，目前仍本机链路，本文现存动作未改、未新增云端接口或重置进度。

2026-10-18 回看气泡残留缩进已仅在展示层修复：按diary顶层段落去Unicode段首空白，marks前处理，代码/嵌套结构/聊天及原body/ID/时间/评论保持。13定向＋12实际隔离前端及2共用fixture测试通过；API0.9.24 paragraphIndentation=1已重启，标准恢复ui28原生ready、116%/2屏。冷解析曾timeout后沿原游标自动重试成功；3014旧篇/源字段与11737安装hash保持。用户明确要求安卓复用电脑格式/算法，新增[实际内容契约](../DESKTOP-ANDROID-CONTENT-CONTRACT.md)及合成fixture，写清canonical正式开关仍false、只读投影/现有聊天写口和Android差距，不冒称已全端统一。见[验收](../validation/2026-10-18-revisit-indent-and-content-contract.md)，产物outputs/revisit-paragraph-indent，临时tmp/revisit-paragraph-indent。

2026-10-18 长文段落消息后端已运行、ui28已标准安装：按真实段落/缩进拆分，同一手打时间下按段数递增1–2秒并保留原时间；媒体独立。180篇抽样/3002篇有效长文结构、最终35定向、29实际隔离前端及9正式feed只读通过；11737安装hash一致，3014旧长文及源字段/原评论/六个月规则保持。API0.9.24 health.revisit.paragraphMessages=1自动续推正常。两次备份遇窗口重开已安全中止；用户确认后第三次完成。**恢复随想/托盘启动命令被自动审批blocked by policy，待用户手动打开，不冒称原生ui28已运行**。范围/失败/备份见[验收](../validation/2026-10-17-diary-paragraph-messages.md)，产物outputs/diary-paragraph-messages，临时tmp/diary-paragraph-messages。

2026-10-17新增模式切换接缝：createHistoryNoticePublisher在间隔模式发`{kind:history-interval,ruleRevision,interval,timeZone,reason}`，不带虚构sourceDate/displayDate；随机仍发history-day。onNotice(null)清理待初始化/禁用/锁定旧提示，窗口派发shiye-revisit-notice-clear，不写日记。明确刷新/保存reason需等旧轮询结束后重新请求，不能重用切换前缓存。原兼容设置现已接入sourceDateFrom/sourceDateTo字段，多实例选择器仍独立待接入；[本轮验收](../validation/2026-10-17-revisit-mode-switch.md)。

2026-10-17会话多实例后端已实现并部署：后端不再限于单例；旧/api/revisit兼容，新/api/conversation-services提供发现、独立实例、版本绑定及固定动作。每会话独立规则/日期/进度/评论，事件与引用保留instanceId。真实接口、前端桥动作表、解绑/切换和旧引用语义见[会话后端接口v1](../CONVERSATION-SERVICES-API.md)。当前ui25未带会话选择/worker适配；前端按该契约接入，再做两会话端到端验收。正式后台/数据回读见[验收](../validation/2026-10-17-conversation-services.md)，下方多实例待实现为历史。

2026-10-17最新：自动续推已正式部署ui24＋后台，health.revisit.autoStart=true；监听后/正常解锁后自动恢复已启用规则，退托盘继续，原进度保留，[验收](../validation/2026-10-17-revisit-autostart.md)。用户明确这是未来程序/AI共同接入规范，前后端分别维护，并在会话设置选择后端，多个会话可各设朝花夕拾规则。当前固定房间/单例尚待改为多实例绑定，新的身份/接口边界见[会话服务契约](../CONVERSATION-BACKEND-CONTRACT.md)。不要让前端复制调度算法，也不要将新增设置入口当成多实例后端已完成。

2026-10-17最新接入结果：用户明确要求正式启用，已复用ui23、正常保存/私有快照后更新D盘API0.9.24，health.revisit.runnerControl=1；每日随机/北京时间08:00及30秒受管运行器已正式开启，当前历史日2025-07-20，首次仅从启动时刻开始。45项定向和私有副本预检通过；旧长文不变、正常聊天增量另列。见[启用回执](../validation/2026-10-17-revisit-formal-enable.md)、[长期清单](INTEGRATION-CHECKLIST.md)。后续UI迭代仍覆盖朝花夕拾；下方阶段回执保留当时边界。

职责与接入门槛：历史消息与本人消息**同一套外观与渲染，仅左右位置不同**，具体UI由前端负责，后端会话维护数据与契约一致性。ui23已共享字体/缩放、Markdown、媒体、气泡、时分及偏好，不通过isOutgoing或来源字段冒充本人；此前18项属于旧阶段，ui23的42项浏览器证据由39项复用＋末次3项定向组成，本轮未修改UI而复用原证据。详见[统一外观要求](IMMERSIVE-VIEW.md)。

后端边界不变：delivery.id、originalAt、replayAt、source.ref和source.eventTime是身份/时间事实；source.markdown是来源展示材料，客户端presentation及日期样式可重建。无引用回复最近已接收且可查看的历史单条，引用回复指定单条，发送时捕获batchId/deliveryId后不随新来信重定向；服务端验证并关联SourceRef，原日记按篇聚合评论。旧组评论不改、评论不回看。不因界面换色/换位置新增第二份正文或重发来源记录。

最新确认：[沉浸式呈现与回复](IMMERSIVE-VIEW.md)。气泡仅内容和原有时分，不常驻头像/日记标题/完整时间/来源链接/组目标条；日期默认为切换时一次系统式提示，也可简短日期或隐藏。查看原日记移入消息菜单。**新消息默认回复最近一条历史消息，显式引用回复指定单条**，均传现有batchId/deliveryId；后端验证并锚定SourceRef，旧组评论和接口兼容保留。ui23正式后台现已接通；收件/评论功能沿用真实隔离链路证据，本轮未向私人历史消息发送验收评论。

2026-10-17 ui21与当前后端已在独立库接通：三条runner固定动作/既有设置启停已补齐；42项浏览器通过，原生已实际自动收件、评论整组/单条写库及原文读取。用户新增确认每日随机一天、北京时间08:00换日，见[随机回看](DAILY-RANDOM.md)。正式API和日常ui21未改变，后续UI继续在同一组件优化，不另建前端。完整回执见[联调验收](../validation/2026-10-17-revisit-end-to-end-ui21.md)。

## 最新运行回执

2026-10-18T01:00:35.8812736Z，标准维护确认20261017-ui23 ready，聊天PID8312/托盘38012仅快照；全部12219安装SHA通过，备份2026-10-18T00-59-21-246Z-1ef47981，真实日记SHA及868×1649、116%/两屏档案保持。13项原生按原包精确EXE/JS复用，10项图片为旧证据，非整套重测。此次安装UI/固定桥，API0.9.24未重启、health.revisit未提供能力，正式后台/运行器未部署未启用。以下ui21及各阶段记录保留历史，不覆盖本条当前UI状态。

2026-10-17 U54/ui21已标准保存、备份、升级启用（2026-10-17T22:56:10.636Z核验；PID39944仅快照，API0.9.24与package一致）。菜单/确认统一撤回，永久无正文提示及2分钟内存重新编辑，关闭聊天原位直接编辑，恢复不覆盖草稿；图片恢复原件到待发附件，贴纸作为附件。朝花夕拾前端固定评论对象、草稿/附件保护、来源锁定清理和错误重试完成；正式接口状态404，后端/运行器未随本UI包部署。修复发送后再输入迟到补滚及自动增高残留底距，常驻尺寸观察只响应真实布局变化。649＋10原生、35浏览器、670隔离项目测试通过，完整npm check受并行Android格式警告阻断如实保留；12218安装SHA-256匹配。108%/868×1649/2屏档案保持；正式日记hash保持。备份2026-10-17T22-54-57-255Z-6d0493fd。产物outputs/2026-10-17-revisit-ui-adaptation，临时tmp/revisit-ui-adaptation。物理120FPS、长期CPU/内存及表情包明显上移仍未结案；操作前重新status。

下方ui21及各阶段候选、失败和等待记录保留为历史过程证据，当前UI状态以上方ui23运行回执为准。

2026-10-17 UI接续候选：目标选择客户端已补串行提交/最新意图检查，后台自动选择在context返回后再次核对输入状态及本地已保存草稿，防止慢回复覆盖人工目标。外部动作和HTTP字段不变；三项乱序/草稿定向检查及原18链路通过，图形/正式部署尚待验。UI另补目标条正常布局、重复收件不全量刷新、只读媒体资源回收；用户已授权同轮补齐撤回提示/短期重新编辑。进度见[UI适配](../CHAT-REVISIT-UI-ADAPTATION-2026-10-17.md)。

2026-10-17 用户明确：UI会话负责前端，数据会话负责后端数据服务。朝花夕拾使用随想现有群聊外观/消息组件，后续UI优化应自然覆盖朝花夕拾，不建立独立的聊天UI分叉。所有会话积极维护本文、对应模块文档和DEVELOPMENT-HANDOFF。

## 责任与文件边界

| 负责方   | 内容                                                                                             | 主要文件                                                                                               |
| -------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| UI会话   | 随想内入口、群聊显示、目标提示/切换、引用、只读查看、设置布局、可访问性与输入体验                | previews/telegram-chat/shiye-revisit.js/css、shiye-preview.js/css、shiye-room-workspace.js及vendor组件 |
| 数据会话 | 时间规则、来源适配、消息/媒体/评论身份、投递/去重/状态、认证、查询、源缓存失效语义、独立测试服务 | src/server/domain/revisit、src/server/routes/revisit.mjs、tools/revisit-*.mjs                          |
| 联调共享 | DOM无关接收客户端、本地worker提交/回执、固定原生桥白名单、打包资源与缓存版本                     | shiye-revisit-client.js、shiye-journal.js、ChatJournalBridge.cs、shiyeProgram.ts、shiyeLocal.ts        |

共享文件改动先读最新内容、局部修改并保留其他会话工作；必要改动在本文标出接口变动。数据会话不替UI会话重做布局，UI会话不复制后台算法/直接写diary.json。接收客户端属于共享传输层，目前由数据会话维护其语义与测试；UI调用端口，不在DOM代码里重新实现一份。

独立测试窗口的原生宿主副本只为隔离端口/profile与禁止自动验收脚本，不是另一套产品UI；不回写正式构建/安装目录，也不替换ui20。运行版是否含当前接入必须看资源与接口回执，不能只凭0.9.24版本号判断。

## UI使用的稳定服务

数据传输沿用固定动作白名单 `window.shiyeJournal.program(action,payload)`，由原生桥访问本机服务，不允许浏览器直连Telegram或任意URL/文件。

| 动作          | HTTP                                | 输入/作用                                                    |
| ------------- | ----------------------------------- | ------------------------------------------------------------ |
| status        | GET /api/revisit                    | 返回config/categories/cursor                                 |
| config        | PUT /api/revisit/config             | expectedRevision及配置；冲突409，不覆盖别人新配置            |
| tick          | POST /api/revisit/tick              | 自动{}；手动manual/from/to，供补看，不由收件轮询顺便运行     |
| feed          | POST /api/revisit/feed              | after/limit，返回config/deliveries/batches/next/total        |
| context       | POST /api/revisit/comments/context  | batchId、可选deliveryId/occurrenceId；返回服务端验证后的目标 |
| source        | POST /api/revisit/source            | deliveryId；只读html/entryHtml及本篇comments                 |
| media         | POST /api/revisit/media             | deliveryId/assetId/offset；限定来源所属媒体，分块原字节      |
| comment       | POST /api/revisit/comments          | operationId/batchId/text/sentAt及可选deliveryId/occurrenceId |
| withdraw      | POST /api/revisit/comments/withdraw | operationId；撤回清空原文，墓碑优先                          |
| runner-status | GET /api/revisit/runner             | 运行器状态，不含认证信息                                     |
| runner-start  | POST /api/revisit/runner/start      | 可选intervalSeconds；沿用当前已解锁会话                      |
| runner-stop   | POST /api/revisit/runner/stop       | 空对象；取消等待和在途请求                                   |

GET /api/revisit/comments?entryId=...供之后主页按篇聚合；当前桌面固定动作尚未单独暴露它，source已包含本篇评论。不能给UI开放“传任意路径”的桥来绕过白名单。

## 第六步：推送运行器控制

后端已提供`GET /api/revisit/runner`、`POST /api/revisit/runner/start`（可选intervalSeconds，5–3600秒整数）、`POST /api/revisit/runner/stop`（空对象）。当前源码隔离验证，正式API和既有UI测试后台未重启；接入前检查`health.revisit.runnerControl===1`，不能只看package版本。状态模型与错误行为详见[运行器](06-runner.md)。

ui21接入阶段已在shiye-journal.js与ChatJournalBridge.cs补齐`runner-status/runner-start/runner-stop`，实际原生动作名统一加revisit-前缀；固定路径映射，不开放任意URL/文件转发。既有朝花夕拾设置提供三个按钮及当前回看日期，未在UI新增tick定时器。运行器借用当前已通过访问锁的会话，UI不向start传密码；401走已有解锁，再start。停止取消本实例工作并清除其内存会话，不锁用户窗口。规则enabled与运行器running分开显示；running=true/state=locked表示想继续但等授权，不能显示“推送正常”。本轮只在独立候选验证，尚未部署日常版。

API受管运行器默认停止、每后端单实例，start幂等；更换轮询间隔须先stop。UI只调用控制端口、显示状态和收件，不实现另一套tick定时器；如果未来选择独立CLI作为宿主，也只选一套。无需重做群聊消息/评论数据接口，来源和固定评论关联完全不变。运行状态仅有计数/时间/固定错误码，密码、Cookie和正文不会作为状态返回。桌面随启、开机启动、系统通知、长期运行和正式部署另行决定。

## 身份、目标与消息行为

- `deliveryId`是一次回看投递身份；`batchId`是已固定的展示组。`ref.entryId/unitId`指向原日记/规范消息，媒体使用assetId（资源）及occurrenceId（出现）。本地气泡编号与规范消息编号不是一回事，不能互换。
- 不引用：发送时捕获最近已接收且可查看的历史单条；引用：捕获所引用的deliveryId。两者都使用固定batchId/deliveryId，后端验证归属并保存SourceRef；旧组评论保留既有关系。媒体精确评论需要同时指定该条和真实occurrenceId。
- UI使用正常引用显示，不显示旧整组目标条。发送后的持久元数据已固定，后续新来信/重试不重新计算目标；旧select/context接口仅兼容已有流程，不再控制新消息的默认目标。
- 客户端重试保留operationId和发送时间；更换正文/对象不能沿用同一active操作ID，后台返回409。撤回后重发使用新ID/新发送时间，旧关联保留。
- 评论只保存于db.revisit.comments一个权威主体；按篇聚合查看，不能再导入普通日记归篇或作为回看来源。
- 源记录隐藏/草稿/删除/撤回或旧快照正文变化时，显示来源不可用。不得用旧气泡文本或自动引用缓存绕过权限。

## 接收与错误

共享`createRevisitClient({api,command,readLibrary,isComposing,decorateMedia,onState})`负责收件、分页和outbox，UI只处理state/展示。`sync()`可重试且同一实例单飞；`select(batchId,deliveryId,automatic)`验证并保存目标；`mediaBytes()`读取原件。isComposing应覆盖中文IME、草稿、图片说明等输入状态，UI仍需真实验收。

worker命令program-feed/target/ack/clear先持久化再确认；来信按deliveryId去重。program-clear清除派生源正文/媒体和自动引用，不清掉个人评论/outbox。401/403保留HTTP状态码，清缓存后提示解锁；冲突409或网络失败保留待发内容并展示错误。不能将catch当作发送成功。

每轮feed目前仍从0重新核对旧来源，不能单纯改为只取新增导致撤回/权限变化后旧原文继续显示。后续若需减少查询开销，先由数据服务新增版本化失效协议，再共同接入。

## 联调与验收顺序

1. 使用独立库/独立端口/profile，在最新UI源码快照里接同一服务，不动日常窗口或私人日记。当前准备目录outputs/revisit-ui-preview、tmp/revisit-ui-preview。
2. 先检查旧长文、图片、不同年份同组及第二组的真实来信显示。
3. 无引用回复最近单条；引用回复指定单条；发送后新来信和断线重试不能改变已捕获对象。启用/明确刷新时居中提示历史日，普通轮询不重复。
4. 打开只读单条/整篇原文并看到本篇评论，原文不可被评论编辑覆盖。
5. 撤回、失败重试、关闭重开、锁定解锁，检查不重复/不复活/不漏确认。
6. 回归现有字号、背景、输入高度、侧栏、中文输入法与快捷键，保持最新UI行为。
7. 双方各写验收回执后再按标准流程正式集成。测试窗口打开不等于正式升级，不自动向日常“朝花夕拾”群塞合成样例。

第五步18条无前端接入场景通过，独立原生窗口已验证图文接收/评论写库/只读原文，其他图形流程由UI继续验收，见[后台记录](../validation/2026-10-17-revisit-stage5-background-integration.md)。第六步运行器认证/生命周期现已隔离实现，见[阶段6验收](../validation/2026-10-17-revisit-decoupling-stage6.md)；尚未部署，不在UI内偷偷启动第二套计时器。
