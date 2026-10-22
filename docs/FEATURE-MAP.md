# 功能与文件索引

电脑随想本轮原始反馈逐项入口：[截图原文与SF01–SF15](WEB-CHAT-SCREENSHOT-FEEDBACK-2026-10-19.md)，与直接提示词同等重要；设置父层级/撤回两分钟/预同步刷新动效/原图/多选均有独立验收。窗口记忆与resize算法见[专项调研](WEB-CHAT-RESIZE-RESEARCH-2026-10-19.md)，当前为需求/调研，不是运行优化收益。

2026-10-19电脑网页聊天改进处于需求/只读调查阶段：[主需求与验收](WEB-CHAT-IMPROVEMENT-2026-10-19.md)、[UI清点](WEB-CHAT-UI-INVENTORY-2026-10-19.md)、[技术调查](WEB-CHAT-TECHNICAL-AUDIT-2026-10-19.md)、[独立规划审核](validation/2026-10-19-web-chat-planning-review.md)。图文重编/原图上传优先，默认压缩/可选原图、逐字段继承、导航/转发、切房/发送解耦与鼠标展开聚焦均逐项登记；未称本轮源码/运行功能已完成。

2026-10-19后端候选：`src/server/sync-product/{preference,notes,chat}-snapshot.mjs`为纯逻辑来源编译，`source-snapshots.mjs`为鉴权接收/版本/原件/原子ledger；`payload-write-policy.mjs`为大正文CAS，原生`ProductPayloadWriter`及DiaryStore/Repository/Coordinator/UiBridge为显式新写口。106不同Node分阶段＋31Android定向，正式未启用、前端021冻结native不混候选；[验收](validation/2026-10-19-backend-source-snapshots.md)。

2026-10-19安卓资料后端候选：`src/server/sync-product/{migration-metadata,computer-data-inventory,legacy-adapter,import,service}.mjs`负责设置/未知字段保留与逐域覆盖；`tools/audit-computer-data.mjs`只读清点，`product-seed export --scope computer`拒绝缺项。Android `ProductSeedFile/SeedInstaller/PayloadReader/Repository/DiaryStore/Transport/UiBridge/MediaBridge/DownloadQueue`为流式文件、事务、原件与固定同步数据端口；`android/sync-tests/verify.ps1`只允许专用QA AVD。42 Node＋20同步＋47种子通过，未部署/未全库导入；[验收](validation/2026-10-19-backend-data-completion.md)、[前后端协作](ANDROID-FRONTEND-BACKEND-COORDINATION.md)。

2026-10-19 随想ui48正式运行：不限时本人编辑/本机持久恢复/撤回提示＋原时原位后继、稳定DOM与长房根组分页；侧栏外部收起与可设左右进入；原子程序设置/多slot/participants及AI角色登记。配套chat-reedit2由“检查拾页运行性能开销”独立上线并保留来源缓存，普通房legacy单写、统一owner与AI执行未启用。[当前验收](validation/2026-10-19-chat-message-reedit.md)列出27定向与25实际UI/范围复用、安装运行证据和未验边界；[后端回执](validation/2026-10-19-chat-reedit-backend.md)。产物outputs/2026-10-19-chat-message-reedit、临时tmp/chat-message-reedit，下方ui44/候选为历史。

2026-10-19 Android020已保留数据运行主AVD，手机保持019；QQ返回列表不再露旧聊天、搜索定位/IME发送、日记无效事务/图文派生/多图顺序与续写/阅读缩略图/空篇/上一篇已按路径核验。默认QQ仍legacy、完整迁移同步待接；用户已取消跨会话消息。源码入口 android/qq-chat/{install,view,legacy-source,panels}.js、android/telegram-adapter/android-chat.js、editor.js/css、MainActivity/DiaryListPage/LocalStore/ProductDiaryStore。 [验收和产物](validation/2026-10-19-android-feedback020.md)

2026-10-19 随想ui44已正常保存/备份/标准升级运行（2026-10-19T11:15:26.0944431Z，聊天PID84424仅快照），API0.9.27本轮未重启。修复即时显示1→2→1：randomId＋chat精确串起local/正式ID，历史先返回仍按同一身份展示，不按正文合并，不延迟首显；5次实际发送逐帧1226采样无重复，同文两条保留。朝花夕拾已接固定catalog/create/bind/request、稳定sourceId会话身份、按实例收件/评论/撤回及独立sender；旧固定房不迁移，解绑原引用保持，撤回重新编辑显式恢复原引用。服务保存等待串行目录/worker持久路由ACK后才成功；冲突保留草稿/实例并可明确重新读取，未知provider只读不假实现AI。60项相关Node分阶段、8真实C#桥、5ACK浏览器＋11服务浏览器通过；12057安装SHA由标准CLI完成，最后仅复核相关边界。116%/两屏偏好保持，旧配置一致、runner=waiting。ui43为中间运行阶段，最终ui44只补5个静态/元信息文件；未跑全库/全媒体/Android/压力。产物outputs/2026-10-19-chat-ack-services，临时tmp/chat-ack-services及tmp/diary-paragraph-messages/build-web/.ui43-ack-services。 [验收](validation/2026-10-19-chat-ack-services.md)

2026-10-19 会话消息后端候选已完成，用户明确本轮不动UI：同会话多个独立程序/AI角色、原子参数、canonical普通消息、会话绑定游标、单条/组/媒体固定评论和legacy别名已实现。68个不同隔离场景分阶段通过（8新HTTP集成；一次Windows rename占用重试，实例归档前缀校验另补28受影响场景），定向lint/格式通过。本轮未部署或重启，无正式写入/迁移；原生/客户端正有并行接线，保留其改动，不纳入本轮验收。前端/worker接线、AI执行器、机器人专用鉴权及多端/云映射仍待接，不能称客户端已可用。产物outputs/2026-10-19-conversation-native、临时tmp/conversation-native。 [接入契约](CONVERSATION-MESSAGING-BACKEND-API.md) · [验收](validation/2026-10-19-conversation-messaging-backend.md)

2026-10-19 随想ui40已正常保存/备份/标准升级启用：朝花夕拾先筛待发评论ID，保留每条实际待发评论的最新撤回/删除/确认核验；78/300合成历史的整库读取82/304→4，真IndexedDB对照约1.14/4.20秒→0.05/0.057秒。17客户端＋27评论撤回＋8浏览器检查通过；实际约125秒整组CPU 9.25→2.59%，前端重启的内存降幅不全归代码。11915安装SHA/116%/2屏，API0.9.27原进程保持；首稿漏版本标记超时已纠正，最终candidate-ui40-final生效。后台来源索引/整库写入仍待优化，长期性能未结案。 [验收](validation/2026-10-19-revisit-read-optimization.md)；产物outputs/2026-10-19-revisit-read-optimization，临时tmp/revisit-read-optimization。

2026-10-19 Android019已依用户要求保留数据覆盖安装并ADB启动Magic7（0.19.0-ui-product/code21，d9a256d0…）。安装前现有QQ草稿flush成功、完整私有备份64,824,832 bytes；首次启动前30持久文件SHA逐个保持。手机实际QQ/偏好/019资产ready、首房6节点无错，header/list/footer均320px、气泡不越屏且旧Tele窗口隐藏，未发送测试消息或启用完整同步。模拟器及手机现均019，下方“手机仍018”为此前阶段。用户已说明实时预览为开发控制面板，效果看App，网页仅手动截图，尚无实时投屏。 [安装/证据](validation/2026-10-19-android-magic7-019-install.md)；产物outputs/2026-10-19-android-integration-019/phone-install，临时tmp/android-integration-019/phone-*，私有备份var/android-backups。


2026-10-19 Android019最终正常包已保留数据覆盖运行主AVD（0.19.0-ui-product/code21，APK d9a256d0…）；手机只读回读仍0.18/code20。修复真实Magic7聊天grid 320→455撑宽、发送夺焦点、旧SW/QQ启动门禁与native早绑定；列表全宽/设置固定真实父级、18px加粗标题/32px工具栏/全宽冻结线/上一篇/空篇丢弃已整合。按最新反馈取消逐条置顶加深，模拟器四主页面复用手机写作页原壁纸，原图不打入APK，保留原偏好备份。长文实际桌面prepare/canonical与同SQLite产品保存、原生消息源接缝已验；默认聊天仍legacy owner，完整保留迁移/seed/持续同步/朝花夕拾真实收件仍待接，不能称全端已互通。最终正常旧三房与列表几何、实际编辑比例/IME连发、14 SQLite/5native消息/19调度等定向按路径验收或复用；QA与正常11,768 assets/DEX一致，不跑无关全量。AVD软件兼容swangle临时60Hz，不承诺真机120FPS。产物outputs/2026-10-19-android-integration-019，临时tmp/android-integration-019，私有备份var/android-backups。 [实现/边界](validation/2026-10-19-android-integration-019.md)。新入口：ProductDiaryStore/ProductUiBridge/ProductMediaBridge、qq-chat/product-source、ui-refinement-019、integration019与stage-integration019.mjs。


2026-10-19 ui38已正常保存/备份/标准升级启动（2026-10-19T07:52:33.7439447Z，聊天PID16628仅快照），API0.9.26未重启。本次ui37卡住已先保全57/58份草稿存储及751KB宿主转储后恢复；独立Chrome明确e0000008，随想renderer仍存/无新Crashpad，初始冻结原因未结案。修复已关闭窗口后的宿主残留：真实本地ACK/明确恢复关闭/严格空初始化许可分开，实际FormClosed后一次5秒后台退出尝试；可见未保存页/无ACK/隐藏不触发，不承诺服务端上传完成。保存阶段/退出许可日志有界，故障不被普通日志预算挤掉。提示文字左偏18px确认为新36紧凑档隐藏按钮仍留宽，CSS修后36/128两场景左右差均0。24真实普通Main断言＋新EXE1微型原件＋2输入对齐场景通过；11915安装SHA复用标准apply逐目标核验，根复核5变化/宿主/journal边界，不重复全套。772×1550/116%/2屏保持，原profile/正式数据位置保持。备份2026-10-19T07-51-04-526Z-80323fa3；产物outputs/2026-10-19-chat-freeze-repeat、临时tmp/chat-freeze-repeat。 [验收](validation/2026-10-19-chat-freeze-repeat.md)

2026-10-19 随想ui37已正常保存/备份/标准升级启动（2026-10-19T07:23:54.4781936Z，PID58012仅快照），API0.9.26未重启。输入手调下限48→36CSS px（小字号外壳44px），仅新低档用4px上下留白/36px按钮，旧48/64与自动高度保持；大字号一行＋8保底，降字号/重开恢复36偏好。即时正常单发/两连发与真实整数ACK基线opacity始终1、白字颜色恒定，未复现用户主观亮闪，不宣称白字原因已确定；本轮清理正常本人root在transient类缺失及live-tail挂载路径的默认淡入/缩放/动画，排除删除/选择。14项定向UI通过，11915安装SHA和772×1550/116%/2屏保持；native15＋看图1仅按未改EXE复用，不跑全套。未改journal/worker/存储/API；不将此UI补丁写成内存问题结案。产物outputs/2026-10-19-chat-instant-flash、临时tmp/chat-instant-flash。 [验收](validation/2026-10-19-chat-instant-flash.md)

2026-10-19 随想ui36/API0.9.26已正常保存、备份、安装及启动（2026-10-19T06:59:56.7289594Z，聊天PID67772/API86988仅快照）。手调输入下限64→48CSS px，大字号按行高＋12保底并保留原偏好；平滑发送只沿Y向上，三次实绘X范围均0。journal空闲20秒不再整媒体库复制，保存/强制flush/失败重试及5分钟保底保持；API空feed/全替代页延迟建来源目录。同包17UI＋7journal、8撤回语义与1镜像分阶段、8lazy feed＋4来源/段落定向通过；15原生＋1图片按未改ui35 EXE/资产复用，不跑全套。11915安装SHA和772×1550/116%/2屏偏好保持；3150篇/3127媒体及收藏/规则/评论hash保持，自动续推正常。实际内存仍有冷解析与周期波动，不把重启降幅当优化收益，物理120FPS/长期泄漏未验。备份2026-10-19T06-57-33-828Z-fc8e34fa，产物outputs/2026-10-19-chat-compact-memory、临时tmp/chat-compact-memory；后续先status。 [验收](validation/2026-10-19-chat-compact-memory.md)

2026-10-19 随想ui35已正常保存/备份/标准升级启动（2026-10-19T06:30:52.4812540Z，PID45876仅快照）。已确认两次renderer OOM（0xe0000008）：申请77.18MiB，异常采样可提交额度68.72/16.84MiB，不能据此认定随想JS泄漏；首次故障已保全profile/dump后临时恢复旧ui34。修复完整保存期限（派发＋ACK共10秒）、迟到响应/导航代际、ProcessFailed撤ready及原生重试保存/重新加载/关闭入口；不自动丢稿或OOM重载风暴。自动收起实际通过正常离开路径、派发悬挂10秒后揭回/清双锁及不重复尝试，故障态不再弹旧ConfirmHide模态。最终10辅助＋15原生＋1微型原件看图定向通过，非全app/全库/媒体矩阵或物理120FPS验收。生产仅DesktopPreview.cs及修订/cache元信息，静态worker/bridge/API保持；11915安装SHA、972×1440/116%/2屏保持，API0.9.25未重启。备份2026-10-19T06-29-23-341Z-39568c22。产物outputs/2026-10-19-chat-hang-recovery，临时tmp/chat-hang-recovery；后续先status。 [验收](validation/2026-10-19-chat-hang-recovery.md)

2026-10-18 Android018独立QQ候选已在专属QA运行0.18/code20：Astra中视觉/富文本CSS、桌面实际Markdown/richdoc安全reader、ACK锚点/测高/阅读位置和短动效接入；32项内容浏览器、6项实际Android内容与6项设置返回/触摸防误调通过，既有真实worker/原件/冷启证据按路径复用。正常APK03a63c09…与QA assets/DEX一致，但正常手机/主AVD未更新、手机未连接；017 Repository/生产写权威、种子导入/完整同步仍待接。见[需求执行单](ANDROID-018-REQUIREMENTS-AND-DELIVERY-PLAN.md)、[验收](validation/2026-10-18-android-qq-rebuild-018.md)。产物outputs/2026-10-18-android-qq-018，临时tmp/android-qq-018。


2026-10-18初始数据包：server/sync-product的portable/seed-package/seed-service负责规范化、流式包、任务/Range/缺块/空库原子初始化；shared/product-seed及product-seed-client定义manifest/显示边界/固定传输，sync-v2-client.importSeed负责安装base/intent/cursor和接续围栏。sources/identity+catalog仅对带绑定的规范化旧篇保留原snapshot，普通旧来源不变。工具product-seed/audit-product-seed/verify-product-seed/verify-product-seed-running；10个种子定向及相邻测试见[验收](validation/2026-10-18-product-seed.md)。规范[PRODUCT-SEED-API](PRODUCT-SEED-API.md)，Android按同一DTO接原生入口；未改APK或日常UI。

2026-10-18 ui34侧栏三态已标准安装启动：`shiye-room-workspace.js`仅pin变量、`shiye-preview.css`普通透明／pin浅底／真实键盘focus深底，已打开房不持久占深色，hover不加第四色。11项实际定向、11915安装SHA及原生ready通过，972×1824／116%／2屏保持，API0.9.25未重启。首次保存退出失败未替换文件；后用户授权先保留profile前后快照再结束卡死进程，CLI停托盘后以already-stopped标准升级成功。不是审批拒绝或标准保存成功，不保证未落盘草稿，卡死根因仍未定位。见[需求](CHAT-SIDEBAR-THREE-STATES-2026-10-18.md)、[验收及恢复](validation/2026-10-18-sidebar-three-states.md)。

2026-10-18 Android独立QQ聊天候选：`android/qq-chat/{view,legacy-source,panels,install}.js`、样式和无脚本shell，`android/qq-rebuild`及`android/tools/stage-qq-rebuild.py`固定016资料/原生基线；不复用TL聊天DOM，不另建消息writer。当前实施/验证中，见[需求](ANDROID-QQ-018-REBUILD.md)、[首次导入字段清单](ANDROID-FIRST-IMPORT-018-MAP.md)。

2026-10-18安卓时间段备份导入：`tools/merge-android-backup-20261018.mjs`是明确单批次工具，prepare/verify/apply分别构建canonical包、隔离HTTP重放和正式API事务合入，不是通用自动扫描导入器。复用原解压/解码/转换/恢复模块，193篇对照后125篇新格式合入、68重复跳过；[实际验收](validation/2026-10-18-android-backup-merge.md)。USB首次数据包与Android自动导入入口仍为后续要求，见[种子计划](SERVER-SEED-AND-MIGRATION-PLAN.md)。

2026-10-18 Android017候选索引：`AndroidSyncTransport`固定产品/增量/原件口，`ProductRepository`与LocalStore schema4增表同连接事务，`ProductSyncCoordinator`显式接收/prepare-push-ACK/固定命令，`ProductOriginals`私有断点与SHA原件；`android/product-adapter/product-content.js`、`android/tools/stage-product-preview.mjs`、`android/product-preview`与`android/repository-tests`负责共用内容冻结及隔离构建/验证。正常APK bd1e6a86…已构建未部署，手机/主AVD016；旧UI写口/权威及完整同步未切，四图UI需求未实施。证据与接续门槛见[017验收](validation/2026-10-18-android-product-017.md)、[实施](ANDROID-PRODUCT-017-IMPLEMENTATION.md)。

2026-10-18 Android016 QQ皮肤：`android/telegram-adapter/android-qq-{skin,gestures}.js`、`android-qq-skin.css`，保留原消息与偏好通路；`android/tools/stage-qq-skin.py`和`android/qq-skin`固定0.14独立打包。主AVD/手机均0.16/code18、数据保留；参数/数据保持与测试边界见[验收](validation/2026-10-18-android-qq-skin-016.md)，需求见[016](ANDROID-QQ-016-REQUIREMENTS.md)。015后端候选仍另行接入，后续版本code19以上。

2026-10-18Android跨端标准入口：[ANDROID-PRODUCT-SYNC-CONTRACT](ANDROID-PRODUCT-SYNC-CONTRACT.md)、`docs/contracts/android-product-sync-v1.fixture.json`和`tools/verify-android-sync-contract.mjs`。数据字段/时钟/权威、事务Repository、wire/业务端点和错误恢复按同一契约实现，9个合成信封通过共用校验。纯文档/样本交付，不切正式客户端；见[验收](validation/2026-10-18-android-product-contract.md)。

2026-10-18产品同步扩展：`src/server/sync-product/{service,legacy-adapter,import}.mjs`、`public/shared/sync-product{,-client}.js`、`tools/product-sync-server.mjs`与`audit-product-sync.mjs`。18789合成库复用sync-v2认证/游标/原件，提供聊天归篇/撤回及服务器朝花夕拾接缝；正式电脑持续增量登记与Android Repository尚未接。先读[实际API](PRODUCT-SYNC-API.md)，范围见[实施入口](PRODUCT-SYNC-INTEGRATION.md)，验收见[记录](validation/2026-10-18-product-sync.md)。

2026-10-18 Android后端015候选已完成配对/库身份守卫/系统密封凭据设置页及完整Entry保存前准备，code17仅独立QA运行，手机和主AVD继续0.14/code16。97真实隔离HTTP、7实际Android配对/重开/返回检查、6长文定向及实际WebView与桌面fixture逐对象一致通过；没有启用内容同步或改生产保存权威。完整Repository/单事务outbox-inbox、长文生产写口和朝花夕拾绑定/收件仍未完成；下一阶段见015交接。全库check停并行sync-product两个未使用变量，未代改。产物outputs/2026-10-18-android-backend-015，临时tmp/android-backend-015；自有QA包/服务/转发和配对码已清理。 [候选验收](validation/2026-10-18-android-backend-015.md)。

2026-10-18随想ui33已标准保存/快照/升级启用：/候选默认可见5行（设置1–5），所有匹配保留、方向键向下滚动；笑脸按钮移除，管理统一到设置→表情包，单列名称/缩略图与上移/下移/置顶/置底、名称排序/反转/常用排序。顺序是独立本机显示偏好、重开保留，不改消息或收藏身份，尚不跨端同步。39项候选＋39项安装资产UI、4项Node通过，11项原生看图复用字节未变ui31证据；11915安装hash/原生ready/API0.9.25核验，3014旧长文/295旧消息及媒体/原收藏/回看关联保留。Android按[需求与偏好格式](STICKER-SORT-FIVE.md)独立适配，未部署APK，也未混入并行共享收藏客户端候选。[验收](validation/2026-10-18-sticker-sort-five.md)。产物outputs/sticker-sort-five，临时tmp/sticker-sort-five。


2026-10-18 Android0.14/code16已保留数据覆盖运行Magic7及主AVD（APK29865bf4…）：发送统一原小飞机，单一缩略图库/点选原件直发、长按备注管理与本机拖动排序；实际收藏DTO/名称备注分组时钟及未知字段保真，原生固定收藏API/原件分块和本地文字联想已接。真实隔离Android16项媒体闭环＋4项图库、136原生HTTP、17图库浏览器及7共享测试通过；手机25/AVD37持久文件安装前后hash保持，完整私有备份保留。全库check停40共享/历史格式告警，未混改。用户继续手机UI手测；完整消息/长文Repository同步与朝花夕拾绑定收件仍待接，015按新接缝继续，不把收藏成功当全数据已互通。产物outputs/2026-10-18-android-media-014、临时tmp/android-media-014、备份var/android-backups。 [验收](validation/2026-10-18-android-media-014.md)。

2026-10-18随想ui32已标准保存/快照/升级启用：/后仅检索收藏名称与旧sticker别名，候选缩略预览、方向键选择、Enter直接发送；原图片/时间/搜索/表情/表情包命令移除，旧emoji映射只保留数据。21项候选及21项安装资产隔离UI、3项Node通过，原生看图复用字节未变ui31的11项证据；11915安装hash及原生ready/API0.9.25核对，3014旧长文/294旧消息/原收藏、分类与回看关联保留。Android命名检索按[使用/接入规则](STICKER-NAME-SEARCH.md)适配，未部署APK，不改其普通文字联想候选。QQ动图既有用户验收保持，微信直拖已按用户要求放弃。[验收](validation/2026-10-18-sticker-name-search.md)。产物outputs/sticker-name-search，临时tmp/sticker-name-search。


2026-10-18网络接入：[FlClash内嵌Tailscale与云复刻](FLCLASH-TAILSCALE-RUNBOOK.md)已完成本机测试后台100地址的真实Android双向/增量验收，独立Tailscale关闭；[证据](validation/2026-10-18-flclash-tailscale.md)。原代理配置对照保持，公网专项检查受审批拦截未执行。正式两端Repository与云服务器部署仍按SYNC-FRONTEND-CONTRACT继续，不能混同已完成。

2026-10-18电脑媒体配套升级：ui31/API0.9.25已标准保存、快照、升级并实际运行，metadata=1；11915安装hash、40项安装资产隔离UI、11项原生看图及21项Node通过，3014旧长文/291旧消息/2旧收藏身份与媒体、回看配置/评论/绑定及116%/2屏保持，运行器waiting无错误。空说明Enter、首次收藏本地保存/后台重试、10字表情尺寸（竖图限宽/横图限高）和看图焦点已交付。用户实测QQ动图通过；用户明确放弃微信聊天表情包直拖，不继续适配，也不写成已修复。Android未随电脑部署；两端规则看[跨端媒体说明](STICKER-IMAGE-CROSS-DEVICE.md)，[验收](validation/2026-10-18-chat-media-followup.md)。产物outputs/chat-media-followup，临时tmp/chat-media-followup。


2026-10-18 Android0.13/code15已保留数据覆盖运行主AVD（APKc52752b4…），手机仍0.11继续用户手测。统一全局浅/深前景与透明色调、分别管理思绪列表/写作/随想scope壁纸；按用户新纠正去掉思绪大圆角卡片，改连续摘要/小字/细分割线，置顶仅轻微平面色调。应用内字号解除系统重复放大与WebView8px夹限，实际13/8推荐和6/5下限、27.5px短气泡/44px输入/36px按钮、PNG/GIF直接本地ACK已验；写作去成功保存闪字、稳定字数/IME、分类单页拖动/默认/返回验收。修复覆盖升级的SW旧模块缓存，版本化精确导入且保留IDB。0.12服务接缝保留，新同步协议另按SYNC-FRONTEND-CONTRACT接Repository，未称云同步已完成。373模块/ESLint和38共享核通过，全库check停在共享/历史格式告警；不承诺120FPS或系统picker已重验。产物outputs/2026-10-18-android-compact-013，临时tmp/android-compact-013，备份var/android-backups。 [验收](validation/2026-10-18-android-compact-013.md)。

2026-10-18 前端同步接入入口：[SYNC-FRONTEND-CONTRACT](SYNC-FRONTEND-CONTRACT.md)列服务区分、参数/状态所有权、配对/增量/媒体与编辑基线要求。新18779测试库已在真实手机FlClash运行时用独立临时应用完成5项双向通信/增量，测试包已移除；现有产品Repository未接。工具tools/test-sync-device.mjs与tools/sync-device-probe，证据outputs/sync-device-test；[验收](validation/2026-10-18-sync-device-test.md)。3个源码别名补齐后check-files373模块无错。

2026-10-18电脑图片/表情媒体ui30候选完成：源码0.9.25，19项Node/30项实际构建UI及vendor TypeScript+改动文件lint通过。修复空/错MIME拖图，增加收藏命名备注、64MiB新收藏/发送上限、192px首帧缓存与原动图重发、默认表情包/键盘直发并保留草稿。旧消息/收藏ID/映射保留，未操作正式数据或APK。**尚未部署：自动审批拒绝后台重启相关命令，返回blocked by policy，未执行或绕过；最终维护status仍ui29/API0.9.24且ready**，不能只换前端。微信/QQ物理拖拽未验，全库check-files遇并行sync-lab三个尚未生成assets未代改；不宣称全库检查通过。产物outputs/chat-external-media-drop（candidate-ui30及SHA清单），临时tmp/chat-external-media-drop；[验收与接入边界](validation/2026-10-18-chat-external-media-drop.md)。


2026-10-18 Android0.12服务连接候选已构建、保留数据覆盖运行AVD（code14，APK59cf45a5…）；手机保持用户已安装的0.11/code13继续UI手测。新增原生固定服务客户端、独立网络队列、离线/连接地址与服务目录快照、朝花夕拾实例只读状态；99项真实隔离HTTP断言、10服务回归和最终AVD9正常/4失败返回检查通过。未改正式监听/Host/Origin/访问锁，未自动上传/绑定/改规则；测试仅AVD转发隔离合成库。完整仓库/同步、create-bind UI、自动收件、认证和云部署仍未完成。当前共享工作区0.9.25 check停在sync-lab三个未生成assets，独立lint通过，未代改并行后端。 [验收](validation/2026-10-18-android-service-adaptation.md)；接口后续顺序见ANDROID-SERVER-CONNECTION-012，产物outputs/2026-10-18-android-service-adaptation，临时tmp/android-service-adaptation。


2026-10-18 独立增量同步实现并启动18769：`src/server/sync-v2/{store,auth,server,media}.mjs`、`public/shared/sync-v2-{client,media,media-cache}.js`、`public/sync-lab/`、`tools/sync-server.mjs`；稳定回执/分页断点、最新主版+冲突旁支、媒体续传/原件缓存及配对通知。81项定向/相邻Node、7实际页面＋2 Tailscale HTTP通过；常驻库var/sync-lab，正式电脑/Android入口未接。详见[实现与API](SYNC-BACKEND-IMPLEMENTATION.md)及[验收](validation/2026-10-18-sync-backend.md)。

2026-10-18 Android0.11/code13已保留数据覆盖运行主AVD（APK1914ba64…）：紧凑可调气泡/小时间戳、全局与会话外观、独立列表壁纸、冷蓝深色/系统栏、回车发送/真实引用撤回、QQ式刷新反馈与失败后切思绪恢复、思绪Aa/分割线/小图、分类长按拖动与返回层级已落地。AVD按Magic7实测设1264×2800/632dpi/font1.3/320dp，虚拟120Hz不代表物理120FPS。真实聊天8/导航9/分类8/最终编辑8及软件键盘几何通过；主矩阵与最终包的未改JS/DEx字节复用边界见验收。手机仍0.10手测、本轮未覆盖；完整本地Repository/outbox/云同步未完成，手机完整本地存储为后续明确约束。 [验收](validation/2026-10-18-android-refinement-011.md)，产物outputs/2026-10-18-android-refinement-011，临时tmp/android-refinement-011；先重查设备状态再操作。


2026-10-18 增量同步研究：[SYNC-ALGORITHM-RESEARCH-2026-10-18.md](SYNC-ALGORITHM-RESEARCH-2026-10-18.md)盘点20源码/跨端对象并比较成熟机制；[SYNC-PROTOCOL-DRAFT.md](SYNC-PROTOCOL-DRAFT.md)定义候选同步对象、版本/序号、事务outbox/inbox、快照/日志过期、字段冲突、媒体与服务器朝花夕拾边界。只文档，不是已实现API；验证与源SHA在[本轮记录](validation/2026-10-18-sync-research.md)，产物outputs/sync-research-2026-10-18、临时tmp/sync-research-2026-10-18。

2026-10-18电脑表情包前端ui29已标准升级启用（05:24:08Z核验，API0.9.24）：PNG/GIF消息右键收藏、表情面板选择重发、原GIF字节/旧本地收藏与斜杠映射保留，固定桥接现有后端；12项Node、13项实际构建UI和7项C#桥隔离通过。11798安装hash、3014旧篇/原收藏/回看规则/评论及116%/2屏保持。Android仅共用客户端与读取/菜单源接缝，APK/手机未动，网络服务未接；安卓刷新/富文本补充另行交接。 [接入/验收](STICKER-FRONTEND-INTEGRATION.md)。产物outputs/sticker-frontend，临时tmp/sticker-frontend。


2026-10-18用户明确：安卓手机长期完整保存本地数据/文件，云端只负责与电脑同步；离线可写改读，本地保存ACK与同步状态分开。本地事务＋outbox、完整Entry/消息/原件/未知字段保留为后续框架约束，当前SQLite/私有媒体/TL IDB继续保留，不以未来缓存定位删除旧库。完整新Repository/可靠同步尚未实现。见[本地优先存储](ANDROID-LOCAL-FIRST-STORAGE.md)。本次为需求/架构记录，不改设备数据。

2026-10-18表情包后端衔接已部署：新增catalog与from-message，chat/unit来源核验后复用db.stickers，原消息/GIF/时钟/引用保持，多图明确选择、同资源去重/恢复。11收藏与15相邻回归、12条实际来源副本预检通过；正式API0.9.24 health.stickerCollection.version=1可用，ui28原生已标准恢复；3014旧篇/源字段/旧收藏保持。桌面桥与Android菜单面板仍未接，旧本地素材须保留式映射。两端按[实际接口](STICKER-BACKEND-API.md)接入，运行回读见[验收](validation/2026-10-18-sticker-message-backend.md)。产物outputs/sticker-message-backend，临时tmp/sticker-message-backend。

2026-10-18 Android0.10/code12已保留数据覆盖运行主AVD（APKc54bf181…），用户重新授权后标准ADB启动成功。按后端最新实际内容契约共用分段/时间/富文本模块；完整fixture在真实WebView与桌面逐对象一致、实际Tiptap往返及原生保存ACK通过，DBv3内容时钟/迁移5项实际回读通过，另3Node/16浏览器/37SQLite合成定向通过。0.9思绪列表/搜索日期/置顶、页面复用静默刷新、IME底栏隐藏恢复15项已验，按未改UI来源复用。完整Entry持久化/分类映射/canonical/TL消息身份/云同步/表情包收藏仍未接，不支持格式提前只读。手机仍0.6、不操作桌面运行版。[验收](validation/2026-10-18-android-content-contract-010.md)。产物outputs/2026-10-18-android-content-contract，临时tmp/android-content-contract-010，备份var/android-backups。

2026-10-18图片/GIF收藏为表情包的后续需求见[STICKER-MEDIA-CONTRACT](STICKER-MEDIA-CONTRACT.md)：已有routes/stickers.mjs＋domain/stickers.mjs可复用资源收藏/去重/软删除；普通消息菜单、缩略图库与桌面/Android正式收藏映射仍待接入。本轮文档更新，不改正文或运行版。

2026-10-18依用户要求，测试与[跨端内容契约](DESKTOP-ANDROID-CONTENT-CONTRACT.md)完成后，已通过正式API恢复daily-random/北京时间08:00，历史范围2025-10-01起/无截止，本周期2025-11-04；新ruleRevision=5，从切换时刻继续，未补发过去时段。原17回执/评论/源篇保持，运行器正常，安装ui28＋正式feed只读11项含去缩进、图文、引用、去重及随机提示通过。旧六个月为测试配置；[回执](validation/2026-10-18-revisit-indent-and-content-contract.md)。

2026-10-18 回看气泡残留缩进已仅在展示层修复：按diary顶层段落去Unicode段首空白，marks前处理，代码/嵌套结构/聊天及原body/ID/时间/评论保持。13定向＋12实际隔离前端及2共用fixture测试通过；API0.9.24 paragraphIndentation=1已重启，标准恢复ui28原生ready、116%/2屏。冷解析曾timeout后沿原游标自动重试成功；3014旧篇/源字段与11737安装hash保持。用户明确要求安卓复用电脑格式/算法，新增[实际内容契约](DESKTOP-ANDROID-CONTENT-CONTRACT.md)及合成fixture，写清canonical正式开关仍false、只读投影/现有聊天写口和Android差距，不冒称已全端统一。见[验收](validation/2026-10-18-revisit-indent-and-content-contract.md)，产物outputs/revisit-paragraph-indent，临时tmp/revisit-paragraph-indent。

2026-10-17 Android0.8 UI：telegram-adapter/android-chat.js/css负责矩形气泡/时间戳/底部本地表情库、宽度与房间背景引用/刷新反馈；ChatBackgrounds原生选图与私有资源/头像、TelegramFrontend桥、AttachmentPicker opt-in图/视频。Entry/长文算法未改，归档待共用worker。17浏览器＋Java编译通过、AVD已安装待手动运行；手机仍0.6。[验收](validation/2026-10-17-android-chat-ui-08.md)。

2026-10-18 长文段落消息后端已运行、ui28已标准安装：按真实段落/缩进拆分，同一手打时间下按段数递增1–2秒并保留原时间；媒体独立。180篇抽样/3002篇有效长文结构、最终35定向、29实际隔离前端及9正式feed只读通过；11737安装hash一致，3014旧长文及源字段/原评论/六个月规则保持。API0.9.24 health.revisit.paragraphMessages=1自动续推正常。两次备份遇窗口重开已安全中止；用户确认后第三次完成。**恢复随想/托盘启动命令被自动审批blocked by policy，待用户手动打开，不冒称原生ui28已运行**。范围/失败/备份见[验收](validation/2026-10-17-diary-paragraph-messages.md)，产物outputs/diary-paragraph-messages，临时tmp/diary-paragraph-messages。

2026-10-17 Android0.7/code9已AVD运行：editor三资产紧凑UI/独立排版/主题膜；`android-editor-input.js`局部复用共享Enter与时间戳，精确非取消分段和选择token保护；LocalStore `createEntryDraft/discardEmptyEntryDraft`将空白留meta，首内容同ID正式化，旧篇清空保护；DiaryAppearance原生设置与MainActivity系统栏、图标复用public/icons。无新增schema/全局快捷键；分阶段定向和AVD实测见[验收](validation/2026-10-17-android-diary-editor-07.md)。完整跨端算法/存储适配未齐，见[统一接入](ANDROID-DATA-UNIFICATION-PLAN.md)，手机仍0.6。

2026-10-17朝花夕拾模式切换ui27：shiye-revisit-view.js管理history-day/history-interval/null清理；client明确刷新/保存排队后新请求；shiye-revisit.js消费两类提示并接起止日期表单、保存后状态更新。后端配置/算法本轮未改，多实例选择UI仍独立待接。[验收](validation/2026-10-17-revisit-mode-switch.md)。

2026-10-17 Android0.6/code8已在AVD实际运行：`android/tools/live-preview/`实时CSS参数/源码watch；列表/消息适配CSS，思绪editor外壳，MainActivity统一系统栏/新建标记；`chooseCategoryOnCreate`是本机呈现偏好，默认true且显式false保持，不写Entry。26＋22＋3组为分阶段定向，实际安装包核心路径见[验收](validation/2026-10-17-android-ui-preview.md)，[跨端接缝](ANDROID-CROSS-DEVICE-ADAPTATION.md)未声称同步已接。手机保持0.5，实时控制台19384。

2026-10-17历史日期范围在daily-random.mjs过滤来源本地日期、configuration.mjs校验范围/版本、archive.mjs验证持久范围；会话服务registry暴露字段。前端范围表单待UI接入，见[实际API](CONVERSATION-SERVICES-API.md)与[验收](validation/2026-10-17-revisit-date-floor.md)。

2026-10-17 ui26入口重排已标准备份、升级并启用：`shiye-preview.js`设置入口／按房间ID缓存及动态父页；`shiye-room-workspace.js`统一navigation管理区与自身状态事件装配；`shiye-preview.css`紧凑行，侧栏第二排移除。13项是10项布局状态＋3项新建修复累计，原首报告整体false保留。没有Vite、worker、API、原生变更或ui25存储重复验收。见[最新需求](CHAT-ROOM-MANAGEMENT-2026-10-17.md)、[本轮验收](validation/2026-10-17-room-management-layout.md)。

2026-10-17会话多实例后端已实现并部署：注册/实例/绑定在src/server/conversation-services/registry.mjs，运行器管理host.mjs，HTTP入口src/server/routes/conversation-services.mjs，隔离覆盖tests/conversation-services.test.mjs。前端选择器/worker/桥仍待按[实际API](CONVERSATION-SERVICES-API.md)接入；ui25保持。[验收](validation/2026-10-17-conversation-services.md)含正式后台/旧数据保留证据。

2026-10-17 Android实时样式工具：`android/tools/live-preview/`连接显式指定的调试设备，仅watch聊天/思绪CSS；控制台临时参数、源hash冲突保护与手动截图。AVD实际改色/恢复且无重载已验，原生/HTML/JS仍需构建。逐页优化及跨端数据适配约束入口[ANDROID-UI-LIVE-ITERATION](ANDROID-UI-LIVE-ITERATION.md)，协议差距[ANDROID-CROSS-DEVICE-ADAPTATION](ANDROID-CROSS-DEVICE-ADAPTATION.md)；没有声称已同步。

2026-10-17 随想ui25会话管理已标准备份、升级并启动：明确新增／管理入口，活跃及已归档管理、置顶加深且组内保留手工顺序、归档恢复保留ID／消息／草稿／已归篇日记。当前附件与编辑未处理时阻止归档；朝花夕拾系统房可置顶但禁归档，不影响后台推送。wrapper入口在`shiye-room-workspace.js`、样式在`shiye-preview.css`，worker状态在`shiyeLocal.ts`、主列表排序过滤在`folderManager.ts`。20项为15＋3＋2分包累计，未重跑原生实机／全库。见[需求与使用](CHAT-ROOM-MANAGEMENT-2026-10-17.md)、[验收](validation/2026-10-17-room-management.md)。

2026-10-17 Android参考分工由用户明确：Telegram负责随想线性消息页UI，QQ负责会话列表/页面及状态栏管理，一本日记负责思绪写作与数据管理界面；具体功能/数据仍对齐电脑拾页，已有安卓明确选择保留。已通过MT定点分析私有一本日记0.1.2、新Telegram13.0.3和QQ9.3.70，旧Telegram12.10.0单列历史；个人日记偏好值未读，不冒称已继承。只读研究，无产品/数据/部署变更。见ANDROID-REFERENCE-REVIEW和ANDROID-DEBUG-WORKFLOW。产物outputs/2026-10-17-android-mt-{diary,telegram-13,qq}-reference，临时tmp/android-mt-mcp。

2026-10-17自动续推已正式启用：server.mjs生产入口＋app监听/解锁恢复＋routes/revisit-runner单飞控制；ui24仅提示与修订，25项定向及12219安装hash通过，[回执](validation/2026-10-17-revisit-autostart.md)。通用程序/AI前后端分离与会话选择后端、多会话独立规则新要求见[会话服务契约](CONVERSATION-BACKEND-CONTRACT.md)；后者尚未实现，不与单例自动启动混淆。

2026-10-17 朝花夕拾已正式启用：ui23＋D盘API0.9.24，daily-random、北京时间08:00、30秒受管运行器正常；45项定向/实际库副本通过，旧长文保持，聊天增量另记。后续UI继续覆盖同款气泡、日期提示、引用与只读来源；状态见[正式启用回执](validation/2026-10-17-revisit-formal-enable.md)及[长期清单](revisit/INTEGRATION-CHECKLIST.md)。此前接口404/未启用条目为历史阶段。

2026-10-17 Android0.5.0/code7功能版已在主AVD运行（APKc60bac46…），278原私有文件覆盖前后hash一致，原7会话消息hash保持；表情按钮/PNG/GIF实际多帧与冷重开、普通文件选择发送另存取消、分类默认排序/设置层级/字号、刷新核心路径已验。手机保持0.4。性能核查未达标：60Hz AVD发送44/58、切房40/62官方jank；同平台Settings仅1/121，去背景滤镜无改善，不能归咎模拟器或承诺120FPS。保留原背景/偏好，已回默认会话列表并flush。Sol中代理完成；后续重点是WebView/渲染队列性能定位，不重复无关矩阵。 见[验收与未完成项](validation/2026-10-17-android-refinement.md)。产物outputs/2026-10-17-android-refinement，临时tmp/android-refinement。

2026-10-17 Android 0.5.0/code7第二候选已在主AVD运行，手机保持0.4。按电脑需求收敛入口，完善置顶底色、表情收藏、文件另存、设置父子层级与分类排序/默认、日记正文排版和刷新。第一包暴露Android零大小File元数据问题，第二候选已修，实际复验与帧采样仍在进行，不能标作全部验收。详见[本轮验收](validation/2026-10-17-android-refinement.md)和需求映射；产物 outputs/2026-10-17-android-refinement，临时 tmp/android-refinement。

朝花夕拾是随想正式功能范围，后续所有消息UI/外观/菜单/输入更新须覆盖，维护入口为[长期接入与验收清单](revisit/INTEGRATION-CHECKLIST.md)。ui23 UI已标准升级启动：Message共享本人/历史视觉和媒体圆角，shiye-revisit.js/css消费onNotice/refresh/readNotice/clear，居中提示约4秒且不推滚，日期偏好离线可调；保留来源菜单与最新单条/显式引用。42浏览器为39复用＋末次3定向，13原生按精确EXE/JS复用，10图片为旧证据，12219安装SHA通过；真实日记SHA及868×1649、116%/两屏档案保持。API0.9.24未重启，正式朝花夕拾后台未部署、推送未启用。见[ui23验收](validation/2026-10-17-revisit-ui-unification.md)，产物outputs/2026-10-17-revisit-ui-unification、临时tmp/revisit-ui-unification。

2026-10-17 U55/ui22已自动备份、标准升级并启动（2026-10-18T00:04:48.998Z核验，聊天PID37820/托盘25832仅快照；API0.9.24与package一致且未重启）。修复600ms收缩锁迟到8px上弹及快速连发确认换ID重排；平滑消息从输入文字区域出发，保留即时默认和原平滑选项。按最新精简策略，最终包原生只验单发来源、平滑/即时多行三连发3核心场景，32断言/12实绘图，确认后晚窗位移均0；7排序与25维护定向通过，未重复649全套。12218安装SHA一致，日记SHA及108%/868×1649/2屏档案保持。备份2026-10-18T00-03-41-418Z-a19c821c；产物outputs/2026-10-17-send-settle、临时tmp/send-settle。共享源码全库697项696过/1项revisit-client关联失败已单独复现，本包不含该共享client/后端；不宣称全库通过。物理120FPS、长期CPU/内存仍未结案。 见[最终验收](validation/2026-10-17-send-settle.md)。后续操作先重新status。

Android天蓝样式0.4.0已在主AVD运行：浅天蓝/黑字、独立时间戳、附件视觉/媒体身份与UTC、思绪独立壁纸。37项实际定向通过，旧数据hash保持，手机仍0.3.0未覆盖；未接同步或重定后端格式。见[需求](ANDROID-SKY-UI-REQUIREMENTS.md)、[验收](validation/2026-10-17-android-sky-ui.md)、[契约](ANDROID-SKY-CONTRACT.md)。

2026-10-17 朝花夕拾沉浸式候选已在独立窗口打开：去头像/发送者名/来源标题/重复完整时间/常驻链接与组目标栏，日期默认切换时提示一次，可短日期或隐藏；查看原日记在普通消息右键菜单。最新回复约定替代原整组默认：无引用回复最近可见历史单条，显式引用固定所引单条，既有后端验证deliveryId/SourceRef，旧组评论不改。18项真实浏览器、原生只读查看及700项项目测试通过（1桌面跳过）；完整check格式被并行文档告警阻断，非完整check通过。冻结ui21，不覆盖ui22，不重启后台或日常窗口/改旧日记。 [最新约定与验收](validation/2026-10-17-revisit-immersive.md)。产物outputs/revisit-immersive，临时tmp/revisit-immersive。

2026-10-17 维护诊断：tools/desktop-control.mjs新增doctor与只读--human展示；tools/lib/desktop-maintenance.mjs保留失败动作/完成阶段及nextAction，复用原安装引擎。测试在tests/desktop-maintenance.test.mjs（25项），说明与边界见[维护CLI](DESKTOP-MAINTENANCE.md)、[验收](validation/2026-10-17-maintenance-diagnostics.md)。

2026-10-17 朝花夕拾定时模拟：tmp/revisit-timed-demo/scenario.mjs仅服务独立测试库，可指定未来ISO时点，正常API保存富文档并核验4条/2组投递。message-store.mjs以深结构相等验证重组，避免键序误拒；回归在message-store.test.mjs。见[验收](validation/2026-10-17-revisit-timed-demo.md)。

朝花夕拾ui21联调：daily-random.mjs提供每日随机日期/08:00周期和同事务持久选择；planning复用原投递/评论身份，修复已追平时误判当前未闭合分钟为积压导致250ms空轮询。shiye-journal/ChatJournalBridge固定映射三条runner动作，shiye-revisit既有设置接模式/时间/启停；只读来信方向在本群与自己相反。42浏览器及原生真实自动收件/评论通过，正式日常不动，详见[实现](revisit/DAILY-RANDOM.md)、[验收](validation/2026-10-17-revisit-end-to-end-ui21.md)。

随想发送起点／二次上弹候选（2026-10-17，ui22未构建部署）：[方案与状态](CHAT-SEND-ORIGIN-DESIGN.md)、[诊断与A/B](CHAT-SEND-SETTLE-2026-10-17.md)。核心为shiye-chat-ui.js、preview CSS/设置、messageListReserves.ts及MessageList首条淡入精确补丁。正式运行仍ui21。

2026-10-17 U54/ui21已标准保存、备份、升级启用（2026-10-17T22:56:10.636Z核验；PID39944仅快照，API0.9.24与package一致）。菜单/确认统一撤回，永久无正文提示及2分钟内存重新编辑，关闭聊天原位直接编辑，恢复不覆盖草稿；图片恢复原件到待发附件，贴纸作为附件。朝花夕拾前端固定评论对象、草稿/附件保护、来源锁定清理和错误重试完成；正式接口状态404，后端/运行器未随本UI包部署。修复发送后再输入迟到补滚及自动增高残留底距，常驻尺寸观察只响应真实布局变化。649＋10原生、35浏览器、670隔离项目测试通过，完整npm check受并行Android格式警告阻断如实保留；12218安装SHA-256匹配。108%/868×1649/2屏档案保持；正式日记hash保持。备份2026-10-17T22-54-57-255Z-6d0493fd。产物outputs/2026-10-17-revisit-ui-adaptation，临时tmp/revisit-ui-adaptation。物理120FPS、长期CPU/内存及表情包明显上移仍未结案；操作前重新status。 见[本轮验收](validation/2026-10-17-withdrawal-ui.md)。

多端同步近期方案：[SYNC-V2-DESIGN.md](SYNC-V2-DESIGN.md)。现有Entry/MessageUnit/richdoc与媒体保持，客户端本地优先＋持久待发队列，服务端版本/幂等/增量日志；先独立双模拟客户端打通，再真客户端/局域网/云端。AI/提醒/云调度后置，本轮仅文档，未声明互通已实现。

2026-10-17 Android前端0.3.0已在主AVD运行：三入口保留，分别细化Telegram移动消息、一本日记式长文写读和原生月份列表/导航。新建房ApiChat投影保护修复多段草稿；32项实机模拟器定向验收通过，原数据/媒体/pin保持。既定格式沿用，同步Repository与云端尚未接入；手机未更新。见[细化入口](ANDROID-FRONTEND-POLISH.md)、[验收](validation/2026-10-17-android-frontend-polish.md)。

电脑/Android自建云后端规划：见[CLOUD-BACKEND-ROADMAP.md](CLOUD-BACKEND-ROADMAP.md)。划清已有本地算法与未实现云端接入，列跨端契约、事务存储/设备身份、增量同步/媒体、后台调度/通知和部署验收顺序；仅方案，不代表云端已经可用。

朝花夕拾第六步：src/server/revisit-runner/client.mjs、runtime.mjs及routes/revisit-runner.mjs提供固定回环认证、可取消控制/退避/追赶，tools/revisit/提供CLI和JSON行宿主协议，tools/revisit-push.mjs旧入口保持。21项专项隔离通过，UI仅需按[契约](revisit/FRONTEND-BACKEND-CONTRACT.md)接三个runner动作；未改前端或运行窗口。见[模块](revisit/06-runner.md)、[验收](validation/2026-10-17-revisit-decoupling-stage6.md)。

2026-10-17 用户明确朝花夕拾前后端分工：UI会话负责前端布局/交互及随想内朝花夕拾入口的统一优化；本会话负责后端数据服务、接口契约、独立测试库和联调工具，不另行设计或覆盖UI。已获授权打开独立测试窗口，日常ui20保持；独立窗口已打开，实际来信/图片、一次评论回写及只读原文关联已验；本轮3篇合成日记/4投递/1评论，IME及其他图形流程仍待验，见[联调记录](validation/2026-10-17-revisit-ui-preview.md)。联调契约见[朝花夕拾前后端协作](revisit/FRONTEND-BACKEND-CONTRACT.md)。产物outputs/revisit-ui-preview，临时tmp/revisit-ui-preview；测试源快照不改共享vendor。

U53/ui20：shiye-chat-ui.js三处footer预留统一按实际高度；shiye-preview.css紧凑内容/placeholder居中、footer顶部4px、Composer底部4px，保留上游与预测一致的底部inset。仅局部冻结资产升级，见[验收](validation/2026-10-17-composer-spacing.md)。

Android前端0.2.0：随想默认会话/置顶→消息，独立快捷写与思绪阅读，冷启动可直接新建。源码android/，实际复用Telegram Web A移动消息前端；[需求与入口](ANDROID-FRONTEND-V2.md)、[验收](validation/2026-10-17-android-frontend-v2.md)。旧SQLite不变，新随想独立IDB，未接电脑/云端。

2026-10-17 用户授权继续朝花夕拾第五步，但仅在独立后台模拟接入，不使用前端/屏幕、不启动或重启正式窗口。新增无DOM的shiye-revisit-client.js，并由现有随想包装层复用；固定原生白名单增加context，HTTP错误保留状态码。实际Node后端＋现有日记桥＋真实本地worker/持久化代码（fake-indexeddb存储替身）已完成18条链路检查，含60条新投递跨页、回执丢失/重启防重、单条/整组评论、撤回优先、锁定后源缓存清理和普通归篇排除。临时数据仅合成库，未连接正式服务或Telegram；原生桥执行/视觉UI/IME尚未验，候选未部署。详见[阶段5后台验收](validation/2026-10-17-revisit-stage5-background-integration.md)，产物outputs/revisit-decoupling/stage5，临时tmp/revisit-decoupling/stage5。

2026-10-17 朝花夕拾第四步：domain/revisit/comments抽出context/content/persistence/query/service；原评论/撤回POST和兼容导出保留，新只读context与按篇注释GET为UI准备。单条/整组/occurrenceId固定关联、幂等冲突409、撤回不复活、评论不回看；96组正常对照、60针对性及635完整隔离测试通过，桌面项跳过，未部署。见[子项目4](revisit/04-comments.md)、[验收](validation/2026-10-17-revisit-decoupling-stage4.md)。

2026-10-17 用户进一步收敛核心：**思绪实现一本日记安卓端的长日记编辑体验，随想实现 Telegram 的聊天页面与消息前端**；优先复用成熟实现，服务器/AI/回顾/便签暂缓。一本日记原版1.96.55已在独立断网API30参考AVD实际走过新建、标题、两段输入、缩进、返回保存、阅读/继续编辑与简洁模式；原版相册导入/Markdown等分支尚未验证完成。当前双入口样机已安装主AVD；原生手写聊天仍是验证层，正式组件待适配验收。见[参考与复用](ANDROID-REFERENCE-REVIEW.md)、[样机](ANDROID-PROTOTYPE.md)及[验收](validation/2026-10-17-android-dual-prototype.md)。

2026-10-17 U52/ui19 已启用：修复输入框软折临界区紧凑/展开反复反馈造成的抖动，手动高度继续保留；修复快速切回复用节点卡住和旧动画等待造成的切房空白。侧栏新增可反向接续的短过渡，可选立即，并修复展开时键盘焦点恢复顺序。消息/输入字号独立，placeholder及图片说明跟随输入字号，气泡留白固定CSS px；设置参数滚动与保存/关闭分开，返回真实父页，保留未提交编辑。实现位于shiye-chat-ui.js、shiye-sidebar-motion.js、shiye-preview.js/css、shiye-input.js、shiye-room-workspace.js及本地客户端coordinator/Composer/MiddleColumn/Main。103项最终浏览器、649＋10原生、643项完整项目检查和12216安装文件SHA-256通过；见[U52验收](validation/2026-10-17-room-switch-fix.md)和[需求](CHAT-ROOM-SWITCH-2026-10-17.md)。

2026-10-17 朝花夕拾第三步：domain/revisit/delivery抽出配置、计划/提交、分页、共享库端口、服务与同源状态归档；原导出/API保留。长期自动续推、并发、真实写失败与提交后重试已隔离验证；新GET/PUT /api/revisit/archive支持同源状态包，通用备份ID映射仍另议。144组兼容、42项针对性通过；未部署/未动正式库和运行窗口，见[子项目3](revisit/03-delivery.md)、[验收](validation/2026-10-17-revisit-decoupling-stage3.md)。

2026-10-17 用户已选自有安卓App路线并授权制作思绪/随想双入口样机，在AVD展示；要求主要功能向电脑端对齐、长日记按一本日记式整篇体验，新增尽量参考Telegram设计/功能代码，特别附件即开图片网格与动效。源码android/采用原生Java Views/SQLite＋共享richdoc局部WebView；首次构建安装已成功，交互/保存/图片面板正在验收。无INTERNET、虚构种子、独立dev.shiye.app，不占手机/不动桌面正式数据。见[样机需求与对齐清单](ANDROID-PROTOTYPE.md)。产物outputs/2026-10-17-android-dual-prototype，临时tmp/android-dual-prototype。

2026-10-17 朝花夕拾解耦第二步：domain/revisit/sources的library-port捕获只读快照、diary-adapter/chat-adapter适配新旧格式、catalog索引来源、presentation读取正文/媒体；旧revisit-sources.mjs导出及API兼容。正常路径32组/416来源精确对照通过，正式数据/窗口未动，详见[子项目2](revisit/02-sources.md)、[阶段2验收](validation/2026-10-17-revisit-decoupling-stage2.md)。状态/评论等仍待后续拆分。

Android 环境/实测入口：[Studio与AVD、并行方案比较](ANDROID-DEVELOPMENT-ENVIRONMENT.md)、[本轮验收](validation/2026-10-17-android-client-setup.md)。工具已可用，真实richdoc万字图文隔离验证通过；完整双入口客户端/框架未定，Magic7未占用。

上轮安卓客户端构思入口：[双入口需求/开源调研/工具盘点](ANDROID-CLIENT-PLAN.md)、[本轮记录](validation/2026-10-17-android-client-research.md)。思绪长日记参考一本日记安卓端，随想自聊同为刚需；AVD日常测试，Magic7后续短时抽验；尚未创建Android工程或选定框架。

随想U50/ui17已启用：MessageListContent.tsx用本地mock稳定首条key复用发送组；shiye-chat-ui.js采用160ms稀疏连续让位与80%起始/80ms密集单层淡入。冻结index的精确importmap/CSP hash版本化补丁chunk，原profile不清缓存505＋10原生、7发送14阶段身份保持通过；verify-responsive.js保存逐根/组身份及合法viewport裁剪诊断。新cache-stage同组/多行/query/CSP、图片IDB重开和12215安装哈希通过。窗口EXE不变，实际120Hz/反向已测但长帧、物理120FPS/长期CPU内存仍保留边界；root591/单组件lint通过，vendor14条并行TS错误未过，mock编辑重开/删除即时边界未修。见[动效第二轮验收](validation/2026-10-17-motion-refinement.md)及[规划](CHAT-MOTION-REFINEMENT-2026-10-17.md)。

全项目性能优化入口：[规划与调研](PROJECT-PERFORMANCE-PLAN.md)、[本轮证据与验收](validation/2026-10-17-project-performance.md)。覆盖随想素材前缀读取、便签素材提交去重、主页/思绪共享正文提交缓存及桌面宿主CPU定位；实现、候选与运行状态以验收记录区分。

随想内存与动画延迟的专用接手入口：[CHAT-PERFORMANCE-HANDOFF.md](CHAT-PERFORMANCE-HANDOFF.md)，包含代码定位、测量脚本、当前证据、未解决项和验收边界。后续性能会话持续维护。

随想 U51/ui18 已启用：shiye-chat-ui.js 管理 instant/smooth 发送事务、迟到媒体布局跟随和独立手动输入高度；shiye-preview.js/css 提供消息呈现、均匀留白/原有紧凑、6–24px 留白与满宽编辑区；EdgeDock.cs/DesktopPreview.cs 提供 responsive/classic 贴边曲线及本机偏好。验收和正式启用状态见 [U51 记录](validation/2026-10-17-instant-message.md)。

随想U49/ui15已启用：shiye-chat-ui.js复用布局调度器、减少密集列表逐帧扫描与重复淡入；shiye-room-workspace.js生成192px头像并管理URL生命周期，useShiyeInput.measure用于未来完整构建。verify-responsive.js补实际Enter事件/有效可见时延。见[验收与边界](validation/2026-10-17-chat-performance-ui15.md)。

随想U49：ui14发送反馈时延与进程树资源测量见[性能记录](validation/2026-10-17-chat-performance.md)。本轮是测量/需求更新，运行版本不变；首帧与长帧、WebView内存尚待优化。

随想U48/ui14已启用：shiye-chat-ui.js移除旧气泡FLIP反向补偿；ownSendScroll统一事务写入，scrollMode走原生smooth，revealBubble对未满屏新增行及新时间分隔增加占位，footerReserve暂留并联动页脚。verify-responsive.js在发送前采样、按编号重取旧节点、拒绝空样本并通过原生截图桥取6张画面；427＋10/580检查与像素对照、运行证据见[实际绘制检查](validation/2026-10-17-message-paint.md)。

随想U47/ui13已启用：shiye-chat-ui.js的ownSendScroll仅代理当前列表实例的发送尾部定位，releaseMotionClip在事务/动画结束还原overflow；视觉位移不撑大滚动范围，淡入按enteredAt独立计时，同批轨迹共用关键帧。verify-responsive.js同时采样实际气泡/五条旧消息/透明度/rAF，禁止用静态外框和结束后稳定代替首帧验证。413＋10原生/580项目检查与安装核对见[U47记录](validation/2026-10-17-message-jitter.md)。

2026-10-17 朝花夕拾分步解耦：六子项目索引在[revisit/README](revisit/README.md)；首步domain/revisit/engine以SourceRef/UTC时间/分类+显式时区/窗口为输入，产出候选计划，不依赖数据源、HTTP、编辑器或时钟。revisit.mjs兼容层继续负责游标/投递/评论，现有API和数据不变。验收见[阶段1](validation/2026-10-17-revisit-decoupling-stage1.md)。

2026-10-17 便签UI7取色修正：NotesFramePalette.cs后台SPI读取桌面壁纸、去饱和灰调渐变及无HWND统一绘制坐标；NotesPreview退回无WS_CAPTION/原8grip布局，取消失败的Mica/NCCALCSIZE/alpha扩展路径。NotesWindowFrame仍44/48DIP、大glyph；前端frameMaterial默认wallpaper并兼容旧mica。新70组前端、54用例5517断言、135配色/接缝及13标题检查通过，实际新候选待手动打开，见[UI7记录](validation/2026-10-17-notes-sides-material.md)。

2026-10-17 朝花夕拾候选：domain/revisit-sources.mjs只读来源适配，revisit.mjs管理规则/游标/固定组/评论，revisit-markdown.mjs派生气泡预览；routes/revisit.mjs固定本地接口，tools/revisit-push.mjs独立轮询。随想shiye-revisit.js/css、shiyeProgram.ts与ChatJournalBridge白名单接群聊、中文设置和只读查看；不随窗口启动、不进入普通归篇。旧日记未改、运行窗口未重启，见[协议](REVISIT-PUSH.md)与[验收](validation/2026-10-17-revisit-push.md)。

随想ui12：shiye-chat-ui.js的sampleBubbleSpring/buildBubbleFrames以临界阻尼解析位置/速度，几何重定向与同编号DOM重建保留动量/淡入进度，WAAPI负责显示插值。仅从ui11已验证资源补动效与缓存版本，复用原宿主，不带入当前共享源码的归档/朝花夕拾候选。已启用/检查边界见[Apple调研与验收](validation/2026-10-17-message-continuity.md)。

2026-10-17 便签UI7候选：notes-workspace/notes.html/notes-workspace.css增加outlineSide换侧/两侧拖宽及frameMaterial偏好；NotesWindowFrame真实glyph22–24DIP/44DIP栏/48DIP按钮及alpha-aware材质绘制，NotesPreview接DWM38/39/扩展区与NCCALCSIZE。前端70组及54用例离屏通过，真实材质/运行状态见[UI7验收](validation/2026-10-17-notes-sides-material.md)，不据API成功宣称视觉通过。

随想ui11已启用：shiye-chat-ui.js按稳定消息ID驱动气泡180ms淡入/位移与旧消息位置补偿，页脚/贴底同次提交、移除定时补偿，滚动/导航/减少动画可取消；EdgeDock.cs按屏幕刷新率计算高精度deadline，浮点时间/Hermite曲线及反向速度接续。边框不在本轮。393＋10原生隔离、564完整项目检查和12215安装哈希通过，保留显示屏记忆；真实120Hz呈现仍待用户观感确认，见[发送动画验收](validation/2026-10-17-message-motion.md)与[窗口专项](validation/2026-10-17-window-motion.md)。

2026-10-17 便签UI6：NotesWindowFrame.cs提供40DIP原生栏/46DIP按钮和8个NotesResizeGrip，NotesPreview.cs明确划分WebView内容区、保存几何/最大化/置顶并输出不含正文的runtime-status；notes-structure.js按coordsAtPos测量中文缩进文字位置。notes-workspace.js同步原生主题并兼容旧宿主置顶；QuickCapture.cs配置思绪DWM中性灰边。隔离构建支持OutputDirectory。实际启用、初次Dock回归及鼠标/多屏边界见[UI6验收](validation/2026-10-17-notes-frame-memory.md)，用户偏好见[UI-PREFERENCES](UI-PREFERENCES.md)。

随想ui10：shiye-room-workspace.js的sidebar模式控制实际#LeftColumn行焦点和预选，保留direct/list/manual；shiye-preview.js的shiye-set-sidebar/changed统一按钮、Esc、窄窗状态并保护侧栏焦点；shiye-preview.css清除此按钮普通鼠标focus默认环，保留focus-visible。接口/证据见[侧栏验收](validation/2026-10-17-sidebar-toggle.md)。

2026-10-17 规划文档入口：FUTURE-EXTENSIONS.md汇总待使用习惯明确后再考虑的生活管理/桌面/多端等扩展；便签属于正在开发的入口，独立待办/日程/习惯等不因此成为已实现功能或当前迭代。草案背景为PERSONAL-DATA-ARCHITECTURE-DRAFT.md与NOTES-DATA-INTEGRATION-DRAFT.md。命名以PRODUCT-NAMING.md为准。

2026-10-17 便签UI5：editor/notes-smart-indent.js为普通段落处理自然Enter/Tab层级，保留原空白和富媒体，设置可禁用；notes-structure.js增加可取消180ms收展、稳定SVG状态同步。notes.html目录移body同层，styles/notes-workspace.css停靠grid/透明共背景/细竖线/26px折叠命中区；notes-workspace.js保存常驻/宽度、复用目录行、跟随编辑/滚动当前层级。见 [UI5验收](validation/2026-10-17-notes-natural-docked-motion.md)。

2026-10-17 便签UI4：editor/notes-structure.js只读派生六级标题/可选缩进结构，PM装饰负责标题和子任务折叠，光标/目录跳转进入时展开祖先；foldedIds仅独立快照视图状态。notes-workspace.js装配目录、仅空普通段落占位、设置保存等待和默认关闭的标签快捷键。notes-markdown-preview.js兼容源横线与原生H1～H6；notes.html/settings-body和固定页头页脚分离。见 [UI4验收](validation/2026-10-17-notes-outline-folding.md)。

2026-10-17 二级名称统一为主页／思绪／随想／便签，约定见 [产品命名](PRODUCT-NAMING.md)。index.html控制主页标题，quick-capture-window.js与QuickCapture.cs控制思绪，shiye-preview.js与DesktopPreview.cs控制随想，notes.html／notes-workspace.js与NotesPreview.cs控制便签；不改EXE、存储或用户会话名。

随想ui9标题栏入口与焦点：DesktopPreview.cs／FrameGlyphButton布局“思绪/便签”，WorkspaceLaunchers.cs固定白名单并复用既有启动，build-window.ps1编入宿主；启动过程中对应按钮禁用，失败用shiye-chat-ui.js状态提示。EdgeDock.cs以DockActivateOnHover控制悬停激活，shiye-preview.js设置和startup/resume保护。原生window-state附入口布局、维护回执附不含正文的焦点信息。接口／证据见 [ui9验收](validation/2026-10-16-room-position-transition.md)。

2026-10-17 便签UI3实时预览：editor/notes-markdown-preview.js按活动文字块显示源码、非活动块用PM decorations呈现，支持IME保护与节点解析WeakMap缓存；styles/notes-markdown-preview.css独立作用。rich-document-editor.js新增默认true的enableInputRules/enablePasteRules选项，仅便签用列表白名单/禁立即Markdown替换；rich-editor-vendor-entry增加既有PM Decoration/Set导出并重建，无依赖升级。媒体与其他入口默认行为不改。见 [验收](validation/2026-10-17-notes-live-markdown.md)。

2026-10-17 第二轮旧日记复核：tools/lib/message-unit-review.mjs只在脱离运行库的副本上处理时钟历史证据、时间标记恢复、折叠伴随及音频独立引用；tools/message-unit-review.mjs冻结源hash/算法hash、校验媒体原件、生成私人离线对照，输出路径强制新批次并禁止覆盖/链接绕出。tests/message-unit-review.test.mjs有8项合成回归；不改运行路由或前端装配。见 [第二轮验收](validation/2026-10-17-message-unit-review.md)。

2026-10-17 便签UI2：notes-workspace.js按最近listItem/taskItem显式sink/lift处理Tab层级，orderedList工具与既有编辑器输入规则负责编号/续项；notes-background.js管理本机壁纸原图与透明度/模糊/填充/位置，引用进入同一独立快照事务、不成为正文附件。notes.html/css改为单行标签、折叠格式、轻量状态与层级引导。见 [精简/步骤验收](validation/2026-10-17-notes-ui-simplify-outline.md)。

2026-10-17 统一消息隔离候选：shared/message-units.js纯切分/重组/ID映射；server/domain/message-store.mjs和routes/message-units.mjs负责原子保存及过滤查询；message-comments.mjs校验篇/消息/媒体评论；message-store-archive.mjs负责恢复映射/撤回优先；conflicts.mjs同步媒体替换/撤销。chat-journal域/路由接canonical与无正文撤回登记；聊天shiye-journal、shiyeLocal/MockClient、ChatJournalBridge只作本地outbox投递适配。旧候选生成tools/message-unit-candidates.mjs、独立validator；不改UI。见 [实现](MESSAGE-UNITS-IMPLEMENTATION.md)。

2026-10-17 拾页便签独立 UI：`public/notes.html` 显式装配 `features/notes-workspace.js`，`styles/notes-workspace.css` 管标签/标题/待办/图文/主题；`notes-preview-store.js` 管独立 IndexedDB 快照/图片与 revision。`shared/hotkeys.js` 的 notesWorkspaceCommands 仅作用便签页。`desktop/NotesPreview.cs`、`tools/build-notes-preview.ps1` 与 `start-notes-preview.ps1` 提供独立原生预览；`serve-notes-preview.mjs` 仅静态资源。尚未接入正式主窗/便签后端。见 [便签验收](validation/2026-10-17-notes-ui.md)。

聊天ui9图片说明焦点：shiye-preview.js的modalFocusTarget／focusTarget与媒体观察器统一初始、shiye-resume和热键回激活；WeakSet标记用户交互及一次末尾定位，保护选区／IME。verify-clipboard-focus.js复用原生输入桥做确认／发送／取消集成检查；真实Win+V面板完整操作仍单列待验。

2026-10-16 便签规划：[NOTES-REQUIREMENTS.md](NOTES-REQUIREMENTS.md) 记录已确认的多标签图文草稿本、自动保存/恢复与接入路径。便签功能尚未装配；拟复用 public/editor 的图文能力及现有串行保存，不将规划模块列为现有实现。

聊天ui9：vendor/web-a/src/util/shiyeRoomViewport.ts保存本机阅读锚点和进入过渡；global/actions/ui/chats.ts切出前捕获，global/actions/api/messages.ts围绕保存锚点加载，MessageList.tsx恢复并即时记滚动。shiye-chat-ui.js在所有切换路径取消发送跟随；shiye-preview.js／css管理透明大点击区、参数滚动与固定保存栏；shiye-room-workspace.js新增manual列表模式。原生隔离入口见 [ui9验收](validation/2026-10-16-room-position-transition.md)。

2026-10-16 0.9.24：editor/rich-body-adapter.js 管正文 Tab/Shift+Tab、多段与全选后光标同步；body-editor.js / features/editor-input.js 补旧格式编辑。main.js 不再用扩展 Tab 快捷键抢占正文结构；features/media-batch.js 的 immediateImageBatch 供日记图片跳过确认，原队列持有目标篇/光标/保存校验。rich-document-editor.js 的图片 NodeView 显示“编辑信息”，quick-document-editor.js 接既有按出现排版事务；按钮不进入持久投影。见 validation/2026-10-16-editor-indent-images.md。

0.9.23：core/clipboard-files快照和可信恢复；media-import支持异步文件/空文件拦截/准备中门禁。shared rich-document/renderer与editor支持video，generic媒体索引用于archive/entries/import恢复。server domain entry-reading-document＋legacy-reading-converter/html与只读route生成实时旧篇视图，features/entry-reading-document在index装配，wrapper只读显示不参加commit。main/gallery接通媒体及阅读投影，quick设置可返回原文编辑。见 validation/2026-10-16-rich-media-legacy-reading.md。

0.9.22：quick-capture-session/window区分查看与编辑MRU，新增latest与后台resumeLatest；quick-resume-position按篇记选区/滚动。editor/dom-resume-position和rich-body-adapter提供跨重挂载专用恢复接口，不放宽上传书签身份校验；rich-template-document仅适配新篇模板。gallery过滤已入正文的图片卡片，mergeGalleryOrder保留隐藏引用位置；main在正文图片集合变化时刷新附件面板并登记模板图片。验收 [正文插图与编辑篇恢复](validation/2026-10-16-quick-inline-resume.md)。

0.9.21：tools/legacy-conversion-review.mjs独立处理29项，保留源/第一轮hash和安全只读兼容视图；quick-document-editor/rich-body-adapter提供图片排版及同资源多次插入，quick-window-settings接统一入口，main按服务能力默认新图文。entries保护归篇只读/内容时钟，legacy-webdav拒绝有损推送，import-reconciliation修正链式图片映射。见 [二次复核与运行升级](validation/2026-10-16-review-and-quick-update.md)。

2026-10-16 聊天ui8：shiye-preview.js管理每会话独立外观及继承；shiye-room-workspace.js管理Esc立即／列表模式与会话顺序，folderManager.ts和ChatList.tsx同步侧栏。shiye-preview.css缩小缩略图、移除语音占位，DesktopPreview.cs／DisplayMemory.cs／EdgeDock.cs统一360 DIP最小宽度；ImageViewer.cs／ImageWindowMemory.cs按DPI恢复看图尺寸。Message.tsx提前识别本机纯表情，MessageList.tsx与animateScroll.ts避免发送后竞争动画，shiye-chat-ui.js直接桥接媒体drop并管理发送跟随。新增verify-responsive.js和verify-conversation-settings.js覆盖真实原生窄窗与设置往返，实际结果见 [ui8验收](validation/2026-10-16-thumbnail-narrow.md)。

2026-10-16 全量旧篇独立转换：tools/legacy-conversion-all.mjs（只GET、不可覆盖快照/候选、哈希续跑、异常及十月清单）。快捷窗候选：editor/quick-document-editor.js路由新旧控件、rich-body-adapter.js负责事务/IME/图片位置，shared/rich-document-renderer.js负责纯安全投影；domain/entries.mjs验证权威body，import-reconciliation.mjs映射恢复图片。使用 [开发候选](QUICK-RICHDOC-CANDIDATE.md)，验收 [全量与快捷窗](validation/2026-10-16-full-conversion-quick-richdoc.md)。

ui7自动高度与简化输入：shiye-chat-ui.js负责自动上限／临时拖动／清空与换会话恢复、消息尾部跟随；shiye-preview.css移除放大／AI／附件按钮并留内边距。verify-composer.js覆盖真实鼠标／滚轮／按键及生成媒体的paste/drop处理链，验收见 [本轮记录](validation/2026-10-16-composer-auto.md)。

2026-10-16 [700篇转换验收](validation/2026-10-16-legacy-conversion-expanded.md)：tools/lib/legacy-content-converter.mjs、legacy-conversion-validator.mjs、shared/legacy-time-segments.js 和 tools/legacy-conversion-sample.mjs。独立对照页 legacy-conversion-lab.html、features/legacy-conversion-lab.js、styles/legacy-conversion-lab.css 与只读token服务 tools/serve-legacy-conversion-lab.mjs，尚未在线启动；私有离线对照已生成。新代码不装配到正式快捷窗。

2026-10-16 [旧日记转换迭代方案](LEGACY-CONVERSION-ITERATION-PLAN.md)：旧附件置顶的新副本规则、保真/结构/引用/时间/前端分层校验、固定失败集与新抽样/批量例外队列，以及 DSH 单目标桥现状和候选并行分工。本轮仅讨论建档，未批量转换或启动外部任务。

ui6 输入／看图：shiye-preview.css统一input-scroller高度及排版，shiye-chat-ui.js管理真实拖动和图片传输忙碌；MediaViewer.tsx直交原生图像窗口，ImageWindowMemory.cs独立保存每屏图片窗口；verify-composer.js补指针／滚轮／字号回归。见 [验收](validation/2026-10-16-composer-image.md)。

2026-10-16 真实日记只读抽样：tmp/diary-sample-processing/run.mjs 随机 30 篇＋补充覆盖，共 35 篇，使用当前真实解析器/处理器，报告不含正文。差异与原库回读检查见 outputs/diary-sample-processing/report.json、validation/2026-10-16-real-diary-sample.md；无生产写入或 UI 变更。

2026-10-16 [前端数据兼容合同](FRONTEND-DATA-COMPATIBILITY.md) 约束快捷窗/聊天/旧篇和可变分类标签。`content-preparation.js` v2 接可选内容编辑时钟、复用已解析时区；`tests/content-compatibility.test.mjs` 补旧格式属性保真/混合库聊天回执等 5 项。tmp/content-compatibility 下的虚构缺口/性能核对结果在 outputs/content-compatibility/；真实 UI、双向收发与旧篇来源适配尚未接入。

ui5 分屏记忆：previews/telegram-chat/DisplayMemory.cs 解析显示屏身份、DPI 与每屏窗口／字号档案；DesktopPreview.cs 保存兼容设置，EdgeDock.cs 在拖动／DPI／拓扑变化时恢复。verify-ui.js 调用实际原生切换流程进行合成双屏往返测试；实际部署和硬件缺口见 [分屏验收](validation/2026-10-16-display-memory.md)。

2026-10-16 统一内容处理第一版：`public/shared/content-preparation.js` 对已验证 richdoc 生成不改原文的时间/媒体/搜索派生信息及来源指纹；`tests/content-preparation.test.mjs` 覆盖重复处理、实际 Markdown、撤回占位和来源精度等。设计/保存衔接见 [CONTENT-PREPARATION-V1.md](CONTENT-PREPARATION-V1.md)，虚构产物在 outputs/content-preparation/。尚未接正式保存、旧格式转换或 UI。

2026-10-16 历史时间可行性只读核对：`tmp/diary-time-audit/audit.mjs` 只 GET 本机完整库，汇总正文完整时间行、原始创建/记录/修改时间和媒体时间覆盖，不输出私密正文。18 个虚构断言通过；统计在 outputs/diary-time-audit/summary.json，说明见 validation/2026-10-16-diary-time-audit.md。不是运行时索引或旧库迁移。

协作入口：[DEVELOPMENT-HANDOFF.md](DEVELOPMENT-HANDOFF.md)，明确各会话维护需求／实现／验收／运行状态的责任。维护入口 tools/desktop-control.mjs 与 .ps1，核心 tools/lib/desktop-maintenance.mjs 和 Windows 适配 desktop-runtime.mjs；用法见 [DESKTOP-MAINTENANCE.md](DESKTOP-MAINTENANCE.md)。ui4 宿主写实际页面修订回执，流程测试位于 tests/desktop-maintenance.test.mjs。

2026-10-16 快捷长文迁移审计：[继承基线](QUICK-RICHDOC-INHERITANCE.md) 与 `contracts/quick-richdoc-inheritance-v1.json` 列出 40 项写作/图片/窗口/数据/时间来源验收。对照 0.9.1–0.9.17 升级记录、原便签需求及当前源码；新图文编辑器尚未接入。旧路径重点回归 127/127，通过不等于新编辑器兼容；证据在 outputs/quick-richdoc-inheritance-audit/。

富文本原件与恢复加固：`shared/rich-document-archive.js` 统一试验原件编解码、媒体签名/哈希校验；`features/rich-text-lab-store.js` 用草稿 revision 检测并发，与导入前草稿/图片原件原子提交。`tests/rich-document-archive.test.mjs`、`rich-document-store.test.mjs` 与扩展 DOM 用例覆盖导出恢复、重复图/引用、失败回滚、校验中输入及保存冲突后导出；不触碰正式聊天撤回存储。

附件布局修订 ui3：AttachmentModal.tsx 在本地模式给弹窗／输入行／发送按钮声明稳定的自有样式标记，避免框架重渲染覆盖；shiye-preview.css 约束按钮宽度、取消不换行、输入可缩小与图标大小；verify-ui.js 增加六组字号／宽度检查，DesktopPreview.cs 仅在 verify 模式保存附件截图。见 validation/2026-10-16-attachment-layout.md。

2026-10-16 富文本第一步：独立 `rich-text-lab.html`，`features/rich-text-lab*.js` 管理试验草稿/原图，`editor/rich-document-editor.js` 适配 Tiptap，`shared/rich-document.js` 校验版本、块/图片出现 ID 与字段保留。`features/index.js` 装配试写入口至组件与 AI 数据设置。模型/DOM 模拟验证不等于真实 IME 与窗口验收；正式正文及聊天不换格式。见 [使用与支持矩阵](RICH-TEXT-STAGE1.md)。

聊天动画修订 ui2：EdgeDock.cs 的 DockFramePump 使用高精度等待计时器，合并积压帧并在空闲停止；DesktopPreview.cs 持久保存 DockHideDelayMs；shiye-preview.js 提供收起与 Esc 设置和迁移，shiye-room-workspace.js 使用同一等待设置。见 validation/2026-10-16-chat-animation.md。

0.9.20 当前状态：用户手动打开后已只读核验：正式 API 为 0.9.20，服务／聊天／托盘从 D 盘运行，旧后台退出；四个快捷方式指向 D 盘，API 完整库与 F 盘原日记一致，聊天使用原 profile。任务栏实际点击、快捷键唤醒和真实多屏仍待验。 300 项项目／70＋9 项隔离 UI 检查为前轮证据；实际运行回读见 validation/2026-10-16-desktop-entry-switch.md。

0.9.19 开发版：`shiye-room-workspace.js` 仅用 Esc 唤起菜单，菜单内连按／方向键／停顿选择；`MessageInput.tsx` 排除空输入 ↑ 误编辑；`shiye-input.js` 管理素材频次与网格键盘；`shiye-chat-ui.js` 管理输入高度、滚动补偿、图片桥及程序端口预留；`EdgeDock.cs` 管理贴边动画、显示适配、字体生命周期和开发热键；`ImageViewer.cs`、`shiye-image-viewer.html/js` 管理独立图片窗。`DesktopPreview.cs` 隔离当前工作区并迁移文字比例；`MockClient.ts` 修复原图加载。验收入口为 `verify-ui.js`／`verify-image.js` 和 [实施记录](validation/2026-10-16-chat-ui-implementation.md)。

2026-10-16 新增 [聊天 UI 15 项需求、代码定位与验收条件](CHAT-UI-OPTIMIZATION-2026-10-16.md)。本轮仅文档核对，默认 15 分钟、Esc 连按停顿进入等新目标均待实施，现有功能代码保持原状。

0.9.18：聊天自动归篇由 previews/telegram-chat/shiye-journal.js（本地消息、失败重试与回执）、ChatJournalBridge.cs（限定本机日记接口）、src/server/routes/chat-journal.mjs 和 domain/chat-journal.mjs（串行归篇与 Markdown 投影）组成。逐对话分类选择在 shiye-preview.js，测试为 tests/chat-journal.test.mjs 和 previews/telegram-chat/verify-journal.js；验证见 validation/2026-10-15-chat-journal.md。

窗口外框：`DesktopPreview.cs` 的 FrameGlyphButton、ResizeBounds、原生鼠标捕获拉伸条 管理统一图标与八处拉伸捕获。上游 Chat.tsx 提供逐个对话齿轮和设置右键项，自有 shiye-preview.js 按目标 ID 打开设置并保留当前对话；shiye-preview.css 管理紧凑气泡与缩放补偿。

聊天布局：`shiye-room-workspace.js` 管理对话独立壁纸、头像与键盘切换；`DesktopPreview.cs` 提供灰色边框、图钉、保存隐藏与工作区磁吸；`parseShiyeMarkdown.ts` 保留原文；`shiyeMarkdown.ts` 与 `MessageText.tsx` 统一显示 CommonMark/GFM、高亮与既有富文本，并区分纯 emoji／混排。`groupMessages.ts` 和 `shiyeTime.ts` 按空闲间隔与所选时区生成时间分隔。

聊天别名与桌面入口：`shiye-input.js` 管理自定义 `/xxx`，`shiye-local-assets.js` 用事务保存／改名；`desktop/QuickHost.cs` 统一接收 F14/F15、提供单一托盘和热键设置；`DesktopPreview.cs` 处理单实例窗口、置顶与主动草稿保存；`useDraft.ts`／`shiyeLocal.ts` 处理保存和提交确认。`desktop/ChatEntry.cs`、`tools/install-chat-entry.ps1` 提供固定 EXE 和开始菜单入口，热键索引在 shared/hotkeys.js 的 desktopWindowCommands。

聊天预览入口与输入：上游 `LeftMainHeader` 直接提供齿轮/搜索/新建话题，`HeaderActions` 本地模式不挂载服务菜单；`SymbolMenuButton` 走本地面板。自有 `shiye-input.js` 管理表情包与斜杠命令，`useShiyeInput.ts` 用编辑器事务操作选区，`shiye-local-assets.js` 保存 Blob，`shiye-ime.js` 恢复 WebView2 候选锚点。正式应用版本仍为 0.9.17，本轮仅更新独立聊天预览。

0.9.17：`shared/image-viewport.js` 提供图片独立缩放、原始像素与拖动；`features/gallery.js` 在主页面及快捷窗共用，快捷窗全局缩放避让图片查看器。聊天实验窗的本地会话管理、中文设置、Markdown 实体与共享图片处理见 `previews/telegram-chat/`、CHAT-UI-REQUIREMENTS-AUDIT.md。验证记录见 validation/0.9.17-validation.md。

0.9.16：`shared/time-zone.js` 提供时区选择、日期拆分、墙钟输入转换；`features/preferences.js`、`workbench.js` 与 `routes/preferences.mjs` 保存/显示设置，默认北京时间。`core/dom.js`、时间插入、统计与回忆模块共用转换，不改日记时间戳。隔离验收见 validation/0.9.16-validation.md。独立 Telegram Web A 预览在 `previews/telegram-chat/`，说明见 TELEGRAM-CHAT-PREVIEW.md，不进入正式网页资源。

0.9.15：`styles/dialogs.css` 的通用选项悬浮取消固定浅色背景，改为 5% 主题色透明覆盖、轻边框和内侧 3px 细线；`workbench.css` 对齐完整设置导航及次要按钮，`quick-capture.css` 对齐快捷设置次要按钮。不改变布局或焦点逻辑。隔离深浅色及窄窗检查见 validation/0.9.15-validation.md。

0.9.14：`desktop/QuickHost.cs` 管理后台窗口期限与 MRU 恢复，`QuickCapture.cs` 管理保存后隐藏/明确销毁和普通启动恢复意图。`features/quick-resume-position.js` 只保留进程内视图快照，`body-editor.js` 提供 Markdown/HTML 选区读写；`quick-capture-window.js` 保存前捕获、保存后重绑身份、后台暂停同步、唤回消费快照；`quick-window-settings.js` 提供时限和独立新开/彻底关闭。测试 quick-desktop、quick-resume-position，交付 QUICK-CAPTURE-0.9.14.md。

0.9.13：`core/drag-scroll.js` 是嵌套滚动容器的拖动边缘滚动，`drag-sort.js` 接入/清理；`organization.js` 与快捷窗样式处理管理返回、滚动保留和正文隐藏；`media-batch.js` 管理默认确认、左右/Enter/Esc 和取消无上传。说明 QUICK-CAPTURE-0.9.13.md，测试 drag-scroll 和隔离界面。

0.9.12：`features/quick-window-settings.js` 收拢快捷窗低频动作，`quick-capture-window.js` 保留四个写作/导航操作与设置入口；`category-picker.js` 管理整个弹窗方向键，`QuickCapture.cs` 恢复原生焦点并明确保存 4% 缩放指令。交付见 QUICK-CAPTURE-0.9.12.md，全部需求缺口见 QUICK-REQUIREMENTS-AUDIT.md。

0.9.11：`features/category-order.js` 提供设置内预览排序，taxonomy 路由以 expectedOrder 防止并发覆盖；`title-navigation.js` 与 `body-editor.atStart()` 管理边界焦点，quickInitialFocus 可选初始位置。`desktop/QuickHost.cs` 是原生托盘热键/输入/进程意图宿主，QuickCapture.cs 记忆缩放及保存关闭。详见 QUICK-CAPTURE-0.9.11.md 与 validation/0.9.11-validation.md。AI 与非线性布局不在本轮。

0.9.10：`public/shared/open-data.js` 负责版本化白名单投影，`src/server/routes/open-data.mjs` 负责筛选、快照分页和回忆读取；`features/export.js` 提供 JSON 导出，`features/open-data.js` 与 `workbench.js` 提供设置入口；`public/integrations/diary-client.js` 是独立客户端，`public/components/diary-card.*` 为展示示例。测试：open-data、open-data-export、diary-client；说明：OPEN-DATA.md。与现有编辑、备份和同步模块分开。

0.9.9：`shared/date-time-edit.js` 规划日期时间的文本事务，`editor/body-editor.js` 在 CodeMirror 中执行，`editor/rich-date-time.js` 映射旧富文本段落与 BR，`features/editor-input.js` 执行原生插入；`features/title-navigation.js` 只处理标题 Enter 焦点转移。`category-picker.js` 与 `quick-capture-session.js` 提供独立上一篇入口；`media-import.js` 在附件关联保存成功后收起队列；`editor/live-preview.js` 管理分割线点击还原源码。测试见 date-time-edit、rich-date-time、editor-input、title-navigation、quick-capture、media-import-queue、markdown-live-preview。

0.9.8：`shared/theme.js` 选择启动主题，`routes/static.mjs` 注入白名单 HTML 属性并提供仅含 theme 的 `/startup-theme.json`；`public/theme-start.js` 在文档头同步设置主题，`features/theme.js` 接管运行时监听。`desktop/QuickCapture.cs` 在创建窗口时设置同色背景。测试见 `theme-startup.test.mjs` 与 `quick-desktop.test.mjs`。

0.9.7：快捷窗“设置”由 `quick-capture-window.js` 接入既有 `workbench.js` 设置中心。`shared/hotkeys.js` 的 effectiveShortcuts / pausedShortcut 统一执行默认仅时间策略，`preferences.extendedShortcuts` 为显式恢复开关，默认 false，不重写旧 shortcuts 映射；回归见 `tests/shortcuts.test.mjs`。

| 功能／改动                         | 前端位置                              | 后端／共享逻辑                                                    | 回归测试                            |
| ---------------------------------- | ------------------------------------- | ----------------------------------------------------------------- | ----------------------------------- |
| 新建、编辑、自动保存、历史、回收站 | public/app/main.js                    | domain/entries.mjs、routes/entries.mjs、storage/library-store.mjs | entries.test.mjs                    |
| 页面壳与编辑器DOM                  | public/index.html、public/app/main.js | routes/static.mjs                                                 | architecture.test.mjs + 界面        |
| 富文本清洗、搜索文本、字符统计输入 | public/core/dom.js                    | 无                                                                | 界面 + insights.test.mjs            |
| Markdown、隐藏、草稿               | features/editor-tools.js              | routes/entries.mjs                                                | entries.test.mjs                    |
| 分类、标签管理                     | features/organization.js              | routes/organization.mjs                                           | entries.test.mjs                    |
| 模板                               | features/templates.js                 | routes/organization.mjs                                           | entries.test.mjs                    |
| 显示偏好、提醒、自动锁             | features/preferences.js               | routes/organization.mjs、security/access.mjs                      | entries.test.mjs、security.test.mjs |
| 筛选                               | features/search.js                    | 应用本地筛选                                                      | 界面                                |
| 统计、周期回忆、地点               | features/insights.js                  | shared/insights.js                                                | insights.test.mjs                   |
| 随机回忆                           | app/main.js                           | shared/memories.js                                                | insights.test.mjs                   |
| 快捷键                             | app/main.js                           | shared/hotkeys.js、routes/settings.mjs                            | shortcuts.test.mjs                  |
| 绘画、裁剪、录音、朗读             | features/media-tools.js               | routes/media.mjs                                                  | vault.test.mjs + 界面／设备         |
| TXT、HTML、PDF、PNG 导出           | features/export.js、core/downloads.js | 无                                                                | 界面                                |
| 大备份创建／恢复                   | features/backups.js                   | shared/vault2.js、routes/backups.mjs                              | vault2-roundtrip.test.mjs           |
| 旧整包加密备份与旧格式入口         | features/legacy-backups.js            | shared/vault.js、routes/legacy-backups.mjs                        | vault.test.mjs、imports.test.mjs    |
| 自建服务器同步                     | features/cloud-sync.js、workbench.js  | sync/legacy-webdav.mjs、routes/sync.mjs、import-reconciliation    | sync.test.mjs、0.9.4-validation     |
| ZIP64、大备份导入                  | core/api.js 上传辅助                  | routes/imports.mjs、imports/zip-stream.mjs、imports/legacy.mjs    | imports.test.mjs                    |
| 可支持容量／块大小                 | 界面提示需同步                        | public/shared/limits.js                                           | 对应导入／备份测试                  |
| 应用端口、标识、版本               | 启动器构建                            | config/app.json、package.json、src/server/config.mjs              | architecture.test.mjs               |
| 样式、适配、深色、打印             | public/styles/                        | 无                                                                | 桌面与窄屏界面                      |
| 功能入口增加／删减                 | public/features/index.js              | src/server/app.mjs 路由列表                                       | 文件依赖检查 + 对应功能测试         |

表中 features、core、shared 相对于 public；domain、routes、imports、storage、security 相对于 src/server；测试文件相对于 tests。

定位建议：先按表找到模块，再搜索接口路径或命令ID。新增功能更新本表；原安卓特色功能的兼容进度仍以项目上级 research 中的“离线功能对照与验收”报告为依据，避免在不同文档里写出相互矛盾的完成状态。

## 0.5 新增模块

| 功能           | 前端                                                                         | 后端                                                 | 验证                      |
| -------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------- |
| 背景与主题     | features/appearance.js、shared/appearance.js、styles/appearance.css          | routes/appearance.mjs、storage/appearance-compat.mjs | appearance.test.mjs、界面 |
| 右键操作       | features/context-menu.js、features/entry-actions.js、styles/context-menu.css | 复用 entries、organization                           | appearance.test.mjs、界面 |
| 折叠           | features/layout.js、styles/layout.css                                        | preferences.layout                                   | appearance.test.mjs、界面 |
| 背景随备份恢复 | features/backups.js、shared/vault2.js                                        | routes/backups.mjs                                   | vault2-roundtrip.test.mjs |

右键菜单只负责交互与提示，entry-actions 负责带 revision 的库操作；不通过 markDirty 修改删除状态。背景不使用日记附件列表显示。

## 0.6 模块细分与兼容状态

当前完整对照见 [原版功能核对](FEATURE-PARITY.md)，模块职责见 [0.6 工作交接](ITERATION-0.6.md)。这是后续功能增删的首要索引。

| 功能               | 前端                                           | 后端／共享逻辑                                         | 测试                                        |
| ------------------ | ---------------------------------------------- | ------------------------------------------------------ | ------------------------------------------- |
| 文本编辑、保存     | editor/commands.js、content.js、persistence.js | domain/entries.mjs、routes/entries.mjs                 | feature-boundaries、entries                 |
| 分类和标签管理页   | features/organization.js                       | routes/taxonomy.mjs、shared/taxonomy.js                | feature-boundaries                          |
| 模板               | features/templates.js                          | routes/templates.mjs                                   | entries、imports                            |
| 偏好               | features/preferences.js                        | routes/preferences.mjs                                 | entries、appearance                         |
| 统计               | features/statistics.js                         | shared/statistics.js                                   | insights                                    |
| 周期回忆           | features/insights.js                           | shared/recall.js、entry-state.js                       | insights                                    |
| 上传反馈和文件落区 | features/media-import.js、core/api.js          | routes/media.mjs                                       | feature-boundaries、界面                    |
| 去重与冲突管理     | features/conflicts.js                          | domain/import-reconciliation.mjs、routes/conflicts.mjs | feature-boundaries、vault、vault2-roundtrip |
| 旧元信息修复       | shared/legacy-content.js                       | storage/legacy-metadata.mjs、media-hashes.mjs          | feature-boundaries                          |

上表替代旧表对应模块路径。旧转发模块保留以兼容引用，不再承担业务逻辑。

## 0.7 阅读、写作与媒体

工作计划、模块所有权、操作方法见 [ITERATION-0.7.md](ITERATION-0.7.md)。新增 comments.js / routes/comments.mjs 管理评论；gallery.js 管理单张阅读和附件缩略图；drag-sort.js 提供复用排序；workbench.js 组织设置；0.7.1 已用就地编辑取代原阅读／专业写作切换，具体入口见下表；media-batch.js 管理上传前勾选；core/media-compression.js 处理静态图片；routes/media-compression.mjs 处理新视频暂存和转码。数据冲突继续独立于上传界面。

## 0.7.1 工作区与阅读连续性

本表更新本轮交互入口；详细设计、状态保存边界和验收交接见 [ITERATION-0.7.1.md](ITERATION-0.7.1.md)。后端数据与媒体格式无变更。

| 功能                                         | 前端位置（相对 public）                                           | 保存位置／职责                                                                       | 验证入口                                                           |
| -------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| 固定视口、列表／正文／图评独立滚动           | styles/workbench.css、styles/layout.css、index.html               | 窗口布局与窄屏约束，保证图评栏首尾可达                                               | tests/workbench-layout.test.mjs、隔离浏览器尺寸复核                |
| 自然比例单图、图上箭头／计数／圆点、横向拖动 | features/gallery.js、styles/gallery.css                           | 阅读切图与 190 ms 过渡；正文下方编辑附件，完成后同步右侧；减少动态效果时关闭切换动画 | tests/drag-gallery.test.mjs、tests/gallery-browser.mjs、实际浏览器 |
| 页边活页标签、分类展开列表                   | index.html、features/layout.js、app/main.js、styles/workbench.css | 左侧导航／列表，右侧图评；“全部日记”属于“日记分类”组                                 | tests/workbench-layout.test.mjs、实际点击与窄屏复核                |
| 就地编辑图评栏拖宽与开合偏好                 | features/layout.js、features/workbench.js、shared/appearance.js   | 复用 routes/preferences.mjs，保存 settings.preferences.layout；拖动松手后提交        | tests/workbench-layout.test.mjs、拖宽后刷新                        |
| 最近图片位置                                 | features/gallery.js                                               | localStorage 的 shiye.gallery-position.v1；最近 200 篇，仅日记 ID 与媒体 ID          | tests/gallery-browser.mjs、切图后刷新                              |
| 阅读滚动位置                                 | features/reading-position.js、features/index.js、app/main.js      | localStorage 的 shiye.reading-position.v1；最近 200 篇，仅日记 ID 与滚动偏移量       | 独立滚动、切换日记与刷新复核                                       |
| 筛选及更多视图记忆                           | features/search.js、features/index.js                             | localStorage 的 shiye.search-filter.v1 与 shiye.more-views；不写入日记正文           | 刷新后筛选指示与展开状态复核                                       |

源码中的 tests 路径相对于项目根。测试入口不等同于已完成每项真实客户端验收，最终结果由主任务记录在 validation/。

### 回顾模块追加

拾光回顾与往日此时由 `public/features/recollection.js` 统一接管，样式在 `public/styles/recollection.css`，随机资格、洗牌与有限历史在 `public/shared/memories.js`，周期匹配继续使用 `public/shared/recall.js`。`createRecollection(c).render(view, root)` 仅处理 `memories`／`recall`，装配应先于旧 insights 的 recall 分支。

单篇通过根入口提供的 `releaseEntryReader()` 与 `mountEntryReader(container, entryId)` 移动唯一阅读器，复用现有图库和评论；列表卡片使用 `data-open-entry`。切篇、切模式及改范围先等待 `c.flush()` 成功。自动测试见 `tests/recollection.test.mjs`，覆盖轮内／轮间抽取、实时资格、有限 ID 保存和异步保存失败／视图替换；实际挂载效果由根 agent 在隔离浏览器验收。回顾切换在 flush 后执行 100 ms 旧页淡出与 200 ms 新页淡入，并检查动画取消后的容器资格；列表提供每批 80 篇的继续加载，不截断剩余日记。

### 就地编辑与相册

`features/workbench.js` 在 `#editorPanel` 上控制 `inline-editing`，正文和标题聚焦时显示工具，侧栏保持布局。正文下方 `#attachmentEditor` 提供附件缩略图；`features/gallery.js` 在编辑期间冻结同篇右侧展示，完成编辑先 `await flush()`，再同步最新附件。正文和附件仍自动保存，“完成编辑”不是事务提交。入口／样式由 `app/main.js`、`index.html`、workbench 与 gallery 相关模块配合。

相册由 `features/album.js` 与 `styles/album.css` 接管 `gallery` 视图。它按媒体 ID 合并可见日记来源，每批最多 80 项，支持瀑布流／方格／列表、密度、排序与类型；偏好在 `shiye.album.v1`。纯逻辑测试见 `tests/album.test.mjs`。完整阅读器搬移由 `features/entry-reader.js` 与 `styles/entry-reader.css` 负责，供两种回顾复用。

## 0.7.2 输入与侧栏细节

正文初始缩进、原生换段和日期格式：public/features/editor-input.js，features/index.js 装配，main.js 调用；autoIndentParagraph 在 preferences.js 和 routes/preferences.mjs 管理。列表封面：features/entry-cards.js、styles/entry-cards.css；仅引用现有媒体。侧栏边界跟随继续由 layout.js 负责，相册随机种子由 album.js 独立管理。详见 [0.7.2 工作文档](ITERATION-0.7.2.md)。

0.7.3 取消普通正文段落额外的 18px 段后间距，相邻段落按普通换行距离排列；不改变行距或手动输入的空行。段落样式在 public/styles/editor.css 的 .body-editor p 中统一管理，阅读与就地编辑共用。

0.7.4 应用图标由 public/icons/shiye.svg 维护；tools/build-icons.mjs 生成各尺寸资源，tools/build-launcher.ps1 嵌入 Windows 启动器。它与个人头像模块独立，见 [图标维护](ICON.md)。

### 浏览来源返回（0.7.6）

`public/features/return-navigation.js` 管理单层来源、保存前置、重复点击和导航取消；`restoreBrowsePosition` 在短暂布局稳定期恢复滚动，用户开始操作即停止。`public/app/main.js` 对 `#alternateView` 的 `data-open-entry`、`data-day` 统一接入，组装应用筛选、月份、展开状态与滚动位置；`public/styles/return-navigation.css` 负责顶部按钮和窄屏换行。

`features/index.js` 装配相册、回顾的 `captureNavigation()`／`restoreNavigation(snapshot)`。快照只保留偏好、ID 和分页，恢复后重新读取实时库，不复制或回写正文。来源属于当前页面生命周期，不是跨刷新历史栈；主动导航会清空。测试在 `tests/return-navigation.test.mjs`、`tests/album.test.mjs`、`tests/recollection.test.mjs`。

### Markdown 编辑核心（0.8）

- `editor/body-editor.js`：唯一 CodeMirror 实例、富文本兼容分支、源码开关、转换核对、附件插入、可信扩展注册。
- `editor/live-preview.js` + `styles/markdown-editor.css`：选区感知的实时装饰，本地图片、日期非链接、单行颜色与下划线；组词期间只映射装饰。
- `editor/markdown-transforms.js`：格式命令、旧 HTML 转换、普通段落缩进；`editor/markdown-renderer.js`：安全 HTML 投影。
- `shared/editor-document.js` + `src/server/domain/entries.mjs`：正文格式选择和向后兼容校验；`domain/import-reconciliation.mjs`：备份重映射与内容指纹。
- `tools/build-editor.mjs` + `editor-vendor-entry.mjs`：离线构建；运行资源、许可证在 public/vendor，原包在 resources/vendor。
- 新测试为 editor-document、editor-document-api、markdown-transforms、markdown-live-preview；隔离 UI 验收见 validation/0.8-validation.md。

外部模块通过 `c.command` 或 `c.editor` 接口操作正文；严禁把 `.cm-content.innerHTML` 当日记内容保存。增加可信编辑扩展可用 `registerExtension(id, extension)`，返回卸载函数；尚无第三方插件安装器及 Obsidian 运行时。

### 0.8.1 编辑工具收纳与语法修正

`features/editor-toolbox.js` 独立控制工具面板折叠和本地记忆，`features/index.js` 装配。`markdown-transforms.js` 的 markdownStructureEnter 修复日记缩进与块标记，insertHorizontalRule 为明确插入命令；`features/editor-input.js` 转义新时间的方括号。`live-preview.js` 管理日期与转义字符的显示，不改存储。具体边界见 [0.8.1 工作交接](ITERATION-0.8.1.md)。

### 0.8.1 快捷记录与分类选择

| 功能                                 | 前端                                                                                                                         | 后端／宿主                                                  | 验证                                                                               |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 分类键盘选择、默认分类与统一排序     | `features/category-picker.js`、`shared/category-picker.js`、`features/organization.js`、`features/preferences.js`            | `routes/preferences.mjs`、`routes/taxonomy.mjs`             | `category-picker.test.mjs`、`default-category.test.mjs`                            |
| 延迟创建、自动保存、上一篇与冲突选择 | `features/quick-capture-window.js`、`features/quick-capture-session.js`、`features/entry-save.js`、`shared/quick-capture.js` | `domain/quick-entry.mjs`、`routes/entries.mjs`              | `quick-capture.test.mjs`、`quick-persistence.test.mjs`、`quick-entry-api.test.mjs` |
| Windows 快捷小窗                     | `quick-capture.css`                                                                                                          | `desktop/QuickCapture.cs`、`tools/build-quick-launcher.ps1` | `quick-desktop.test.mjs`、隔离 WebView2 自测                                       |

快捷窗口必须通过共享编辑器和保存队列工作，不能复制正文编辑器。原生宿主关闭前等待网页 `close-ready`；收到 `close-failed` 保留窗口。完整设计与未完成的云同步边界见 [快捷记录并行开发交接](QUICK-CAPTURE-DEVELOPMENT.md)。

### 快捷窗口体验（0.9.5）

滚动、外观、上一篇、多开及安全刷新模块、存储边界与测试索引见 [0.9.5 快捷交接](QUICK-CAPTURE-0.9.5.md)。

# 系统主题（0.9.6）

`features/theme.js` 统一监听系统颜色，负责主窗和快捷窗主题优先级；`preferences.js` 接主窗偏好，`quick-appearance.js` 提供快捷窗独立选择与预览。`shared/quick-appearance.js` 校验可选 theme 字段，默认 inherit；`desktop/QuickCapture.cs` 接收可信页面 theme 消息调整原生窗口颜色。测试见 `tests/theme.test.mjs`、`tests/quick-appearance.test.mjs`。

## 设计索引：统一内容与朝花夕拾（未实现）

字段契约与当前代码逐步适配表见 [统一数据契约 v1](UNIFIED-DATA-CONTRACT-V1.md)；机器草案在 docs/contracts。只读归篇、撤回同步和固定组评论是后续实施项，本轮未修改相关业务模块。

2026-10-19 ui38补充：实窗/文档收尾，新增一次STA保存期限边界验证及按需现场采集，产品未改；[核心排查](validation/2026-10-19-chat-freeze-followup.md)。
