# 数据模型与兼容规则

2026-10-19共享目录候选仅在既有`db.conversationServices.directory`保存version/sourceId/revision/order/states/creations，与原room/资料同一JSON事务。canonical旧desktop:source:room身份保持；新server namespace持久一次分配，负room号保留字符串。states的每房revision与资料/目录/绑定/config版本分离，未知字段保留，不迁messageOwner。用户明确pin/archive/order共享，不能继续当各端权威偏好。详情[候选契约](SHARED-CONVERSATION-DIRECTORY-V1.md)；未部署，不将旧profile来源快照当可写共享目录。

2026-10-19候选新增来源接收ledger `product:source-snapshots`，仅在独立sync SQLite metadata保存来源kind/sourceId/revision/hash与owned实体revision/hash，和业务行/receipt同事务；不变成手机游标。偏好namespace根对象/数组、便签workspace与sourceMetadata、chat稳定实体通过既有product kind保留，`_product.sourceSnapshot`区分来源只读owner与旧业务消息投影。大正文完整值原件+小指针、严格CAS见[来源接收](SOURCE-SNAPSHOT-INGESTION-V1.md)与[写口](PRODUCT-PAYLOAD-WRITES-V1.md)。未改正式日记schema或生产owner，未部署。

2026-10-19后端资料候选为向后兼容新增：Product `profile`已有实体类型中新增scope=migration-metadata/schema=1/values/coverage并标readOnlyProjection，保留settings/模板/程序参数等非机密配置；日常diary.json schema不变。Android沿用product017表，仅metadata新增seedPackages/seedPolicy/seedCatchUpRequired、payload原件下载索引标记。导入事务保留既有intent/业务命令，base始终为原wire信封；大正文完整读取是经hash验证的只读副本，不替换base。凭据/本机窗口/后台私有运行状态不进通用资料包；未映射消息子域明确报告而不复制撤回正文。未部署到正式库/APK，详见[契约](PRODUCT-SEED-API.md)。

2026-10-19后端源码候选：conversationServices可选conversations资料和settingsOperations幂等回执；实例保留conversationId历史归属，允许同房多个独立程序。新统一会话普通消息复用chatJournal/messageStore，增加可选actor快照、operationId/operationHash，旧字段与旧正文不迁移。显式messageOwner切换后仅新消息走强制canonical路径，不全局打开旧长文转换。历史来信仍是引用投射；评论仍为comment unit不进回看；旧db.revisit以legacy别名访问，SourceRef/投递ID/进度保持。前端/独立同步库/安卓/云端映射尚待接，正式API未启用；详见[数据与调用契约](CONVERSATION-MESSAGING-BACKEND-API.md)和[验收](validation/2026-10-19-conversation-messaging-backend.md)。

2026-10-18种子协议v1：[实际包与接续](PRODUCT-SEED-API.md)。包成员是既有增量信封/原件hash，不带旧ZIP/整个diary.json/设备凭据/私有运行器state。长文richdoc/_canonical原子一致，旧非canonical规范化沿用只读candidate单元ID并以revisitSourceIdentity的snapshot+正文/时间绑定保留旧SourceRef；真实正文改变失效、不改绑评论。回收站带正文deleted单元可参与原文重组，body=null退役/撤回单元不参与。收藏tags为可选共享字符串数组，省略兼容/[]清空；不是日记taxonomy ID。客户端seedPackages/checkpoint/seedCatchUpRequired与base/intent在同事务更新，本机壁纸不写入共同业务变更。旧正式schema/canonical开关未切，Android入口待接。

2026-10-18最新边界：[SYNC-DATA-SCOPES](SYNC-DATA-SCOPES.md)。资源字节与引用、客户端显示角色分开；导入会话图片不自动改安卓壁纸，本机外观不反向覆盖电脑。表情包稳定ID/name/note/group及后续共用标签必须一致，多标签尚未实现；名称修改不更换媒体ID/消息时钟。本轮仅澄清后续协议范围，不删除旧会话字段或移动本机外观权威。

2026-10-18按用户授权合入安卓v3备份的新125篇，采用既有richdoc＋messageStore.units/layouts权威及只读HTML兼容投影；233消息均有独立身份/时间，旧附件独立单元、insertedAt=null并按原编辑时间推定。手打时间逆序的一篇保留文字顺序与原时间，不排序改写。68重复篇及3014原长文保持，1修改版独立身份/冲突保留，原ZIP/legacy字段留作追溯。本轮没有开全库canonical或改schema；实际回执见[验收](validation/2026-10-18-android-backup-merge.md)。

2026-10-18 Android017候选LocalStore schema3→4仅增ProductRepository事务表，旧entries/body/revision/null内容时钟保持，实际迁移已验；完整信封/base/local、不可变wire、命令队列、冲突、身份映射和接收cursor在同一连接事务内提交。ProductOriginals的noBackup私有断点/原件独立，正文/任务引用与全局调度仍由Repository调用者负责。候选未部署，手机/主AVD016；旧TL/长文生产权威与写口未切，canonical编辑默认拒绝，不能把新增表误当完整同步已启用。见[017验收](validation/2026-10-18-android-product-017.md)、[实现门槛](ANDROID-PRODUCT-017-IMPLEMENTATION.md)。下文旧阶段“未改schema”按当时范围保留。

2026-10-18Android标准化入口为[ANDROID-PRODUCT-SYNC-CONTRACT](ANDROID-PRODUCT-SYNC-CONTRACT.md)，与产品API及golden合成DTO共同定义跨端格式：完整信封保留_canonical/未知字段，UI DTO不可重建权威；各种ID/revision/cursor分开，完整时间/媒体出现时间保留，接收与本地intent分别入事务。9个样本通过现有校验；本轮不改变schema、正式存储或canonical开关。

2026-10-18新增独立产品同步信封：原Entry/媒体/收藏字段保留在data，`_product`保存kind/稳定refs，`_canonical`保存同aggregate的长文units/layout；二者都是传输保留字段，不写回旧Entry。聊天正文只有独立message权威，归篇只保存有序ID/时间壳并生成只读投影；不保留可在撤回后读出的旧文本副本。分类名与ID分开，metadata改动不改内容时钟。服务器回看state只放私有事务元数据，客户端用业务接口配置/评论。细节见[实际契约](PRODUCT-SYNC-API.md)；当前只隔离服务/只读旧库预检，正式schema与写口未切换。

2026-10-18 ui33新增本机显示偏好`preference:sticker-order-v1`（现有资产IDB独立记录version/mode/ids）及`shiye-input-commands-v1.visibleCount`（1–5）；不新增diary.json/消息/媒体或后端收藏字段，不改原数据和时间，也不自动跨端同步本机资产ID。格式、串行保存和Android边界见[表情排序](STICKER-SORT-FIVE.md)。


2026-10-18 增量同步仅新增[候选协议文档](SYNC-PROTOCOL-DRAFT.md)，未修改现存schema或写口。未来同步信封的serverRevision/changeSeq/operationId与业务ID/eventTime、现有Entry revision、服务调度cursor分开；外观/分类/会话/资料/资源为独立可同步对象。现有电脑分类名与Android ID、TL房号需稳定映射，不因本设计改写旧库；长文及unit/layout仍原子协调，不新增第二份可编辑正文。服务器朝花夕拾配置可双端改，运行进度由服务端独占；未部署新同步。

2026-10-18表情包后端衔接已部署：新增catalog与from-message，chat/unit来源核验后复用db.stickers，原消息/GIF/时钟/引用保持，多图明确选择、同资源去重/恢复。11收藏与15相邻回归、12条实际来源副本预检通过；正式API0.9.24 health.stickerCollection.version=1可用，ui28原生已标准恢复；3014旧篇/源字段/旧收藏保持。桌面桥与Android菜单面板仍未接，旧本地素材须保留式映射。两端按[实际接口](STICKER-BACKEND-API.md)接入，运行回读见[验收](validation/2026-10-18-sticker-message-backend.md)。产物outputs/sticker-message-backend，临时tmp/sticker-message-backend。

2026-10-18 回看气泡残留缩进已仅在展示层修复：按diary顶层段落去Unicode段首空白，marks前处理，代码/嵌套结构/聊天及原body/ID/时间/评论保持。13定向＋12实际隔离前端及2共用fixture测试通过；API0.9.24 paragraphIndentation=1已重启，标准恢复ui28原生ready、116%/2屏。冷解析曾timeout后沿原游标自动重试成功；3014旧篇/源字段与11737安装hash保持。用户明确要求安卓复用电脑格式/算法，新增[实际内容契约](DESKTOP-ANDROID-CONTENT-CONTRACT.md)及合成fixture，写清canonical正式开关仍false、只读投影/现有聊天写口和Android差距，不冒称已全端统一。见[验收](validation/2026-10-18-revisit-indent-and-content-contract.md)，产物outputs/revisit-paragraph-indent，临时tmp/revisit-paragraph-indent。

2026-10-18 长文段落消息后端已运行、ui28已标准安装：按真实段落/缩进拆分，同一手打时间下按段数递增1–2秒并保留原时间；媒体独立。180篇抽样/3002篇有效长文结构、最终35定向、29实际隔离前端及9正式feed只读通过；11737安装hash一致，3014旧长文及源字段/原评论/六个月规则保持。API0.9.24 health.revisit.paragraphMessages=1自动续推正常。两次备份遇窗口重开已安全中止；用户确认后第三次完成。**恢复随想/托盘启动命令被自动审批blocked by policy，待用户手动打开，不冒称原生ui28已运行**。范围/失败/备份见[验收](validation/2026-10-17-diary-paragraph-messages.md)，产物outputs/diary-paragraph-messages，临时tmp/diary-paragraph-messages。

2026-10-17ui27模式提示为前端可重建元数据：history-interval含interval/ruleRevision/timeZone，无伪造sourceDate；onNotice(null)清除失效提示，不写正文/消息或更改SourceRef。客户端明确刷新队列重新取状态；旧来信/评论/草稿保留，保存不自动补发整日。范围表单只写已支持的config字段；后端模型本轮无变化。[验收](validation/2026-10-17-revisit-mode-switch.md)。

2026-10-17revisit.config可选新增sourceDateFrom/sourceDateTo，YYYY-MM-DD或null，约束随机来源日期（含边界）；省略更新保留/null清除，更改触发新ruleRevision/初始化游标，旧randomDays及投递/评论不删。旧配置缺字段不限，实例字段相同而独立。原Entry/MessageUnit时间无改动，归档验证新增日期/顺序校验。见[范围验收](validation/2026-10-17-revisit-date-floor.md)。

2026-10-17会话多实例后端已实现并部署：可选db.conversationServices={version:1,revision,instances,bindings}，instance含id/providerId/name/creationKey/state，state沿用revisit模型；binding含id/conversationId/instanceId/active/revision。创建/绑定才新增，纯读取不落盘；每instance的config/cursor/randomDays/batches/deliveries/comments独立，投递身份加实例范围，SourceRef不变。解绑保留记录，分类改名更新对应筛选及config.revision；不迁移Entry、媒体、统一消息或旧db.revisit。完整快照保留新字段；通用合并恢复因尚无ID映射明确422拒绝新registry，原备份路径保持。schema/接口及限制见[实际契约](CONVERSATION-SERVICES-API.md)、[验收](validation/2026-10-17-conversation-services.md)。下方“schema尚待实现”为历史。

2026-10-17 ui25会话管理已标准升级运行，并通过15＋3＋2项分阶段定向，标准安装回执见[本轮验收](validation/2026-10-17-room-management.md)。本机状态更新采用复制保存，并在等待期间检测写revision；遇到并发发送／草稿新写时从最新库重放状态，避免旧clone覆盖正文。实际置顶与发送并发后重开保留精确1条消息；存储故障仅代码审阅，未做故障注入。下文`shiyeRooms.isPinned/isArchived`字段兼容说明保持，不代表多会话后端绑定已实现。

2026-10-17自动续推已正式启用：只改后台宿主生命周期，仍使用原db.revisit配置/抽选/游标/投递/评论，无新增落盘字段、正文迁移或密码持久化；重启配置与日期不重抽，旧长文保持。[验收](validation/2026-10-17-revisit-autostart.md)。新确认的多会话服务绑定将区分服务类型、独立实例和会话绑定；实例隔离规则/进度/评论，旧单例与稳定SourceRef保留。具体schema尚待实现，设计见[会话服务契约](CONVERSATION-BACKEND-CONTRACT.md)，不能把该设计当已落库字段。

2026-10-17 Android0.4思绪外观偏好是纯本机展示配置：Activity SharedPreferences键`android-diary-appearance-v1`，壁纸文件私有`files/appearance/`，不写Entry/MessageUnit/richdoc/media表、不参与内容时间及导出ZIP。日记附件网格仍由canonical image投影，保留blockId/assetId/occurrenceId/insertedAt，未新增权威附件数组或变更后端schema；时间戳复用电脑共享规则，当前明确北京时间默认，自定义库时区接入后置。见[契约核对](ANDROID-SKY-CONTRACT.md)、[原生外观](ANDROID-SKY-NATIVE.md)。

2026-10-17 发送停稳候选新增仅前端内存的`ApiMessage.previousLocalDate`，与既有`previousLocalId`共同保持本地发送的视图排序身份；只在mock本机确认updater从原待发消息捕获，真实确认`date`仍保留。消息列表用该发送日期作只读浅投影，避免跨秒/午夜确认改变排序与分组；普通消息保留对象引用，非mock分支不变。缓存投影显式清除两个previousLocal字段，不进入本地worker消息存储、日记、备份或数据schema，不迁移旧消息。重开仍按既有持久date/id恢复；不能将任意乱序服务端分配都承诺为持久发送意图顺序。见[候选浏览器验收](validation/2026-10-17-send-settle-browser.md)，当前排序候选已独立构建与浏览器验收，实际升级以标准维护回执为准。

2026-10-17 随机日回看可选新增revisit.config.mode/dailyTime与revisit.randomDays；每周期固定记录ruleRevision、cycleStart/cycleEnd、历史date、timeZone/resetTime/createdAt，不复制日记正文。旧配置和投递/评论身份兼容；源entries/messageStore/media不迁移，当前候选不回写正式库。更换模式/时间只开新规则，旧评论不改绑。同源状态归档校验日期/周期/唯一性并保留抽选；通用备份合并映射仍未完成。见[每日随机一天](revisit/DAILY-RANDOM.md)。

2026-10-17 朝花夕拾第六步不新增持久日记字段：runner状态/会话只在内存；密码、Cookie、运行器本地进度均不写入diary.json或配置。投递/游标/评论继续使用db.revisit，旧entries/media/messageStore不迁移、不重写。重试只调用原tick，由原事务和投递编号去重；停止不回滚已提交记录。详见[运行器](revisit/06-runner.md)。

2026-10-17 朝花夕拾第四步隔离候选继续只在db.revisit.comments保存一个权威评论MessageUnit/richdoc，跨篇按targets读取；不把它复制进Entry.comments或messageStore。选定组固定targets，引用保存单条replyTo，commentOn指消息或媒体occurrenceId，旧来源变更只标不可用不重绑。text仍为旧API兼容缓存，与body一致性校验；撤回清空text/body并保留原关系或先撤回墓碑，评论origin排除回看。新增context/按篇注释均只读，不新增持久目标或草稿表，详见[第四步](revisit/04-comments.md)。旧日记/普通Entry评论未迁移、运行窗口未更新。

2026-10-17 朝花夕拾第三步隔离候选仍使用原db.revisit={version,config,cursor,batches,deliveries,comments}，未改变源Entry/MessageUnit格式。计划expectedToken仅计算/提交期间使用，不作为数据库新字段；投递、固定组、sequence和游标同一串行事务提交。shiye-revisit-state v1是状态导出信封（sourceFingerprint/state/checksum/targetToken），不是新的日记正文。恢复要求同源且目标无不同进度，不能借状态包改写原日记或重绑来源。通用备份合并重映射仍未接入，详情见[状态服务](revisit/03-delivery.md)。

2026-10-17 U51/ui18已启用，仅新增本机展示偏好，不改日记/消息/媒体schema：浏览器localStorage `shiye-message-render-mode=instant|smooth`（默认instant）、`shiye-bubble-spacing=comfortable|compact`（默认comfortable）、`shiye-bubble-padding`（6–24整数px、默认12）与 `shiye-input-manual-height-v1`（64–2000px期望值，缺失为自动）。manual值在小视口只夹紧显示、不覆盖期望值，发送/清空/换会话不删除；Home/双击明确删除该偏好。旧 `shiye-input-cap-v2`继续只表示自动上限，不能推断其为手动模式；下方ui7清空解除manual属于旧行为，已被用户本轮要求覆盖。原生window.json兼容新增 `DockMotionStyle=responsive|classic`，缺失/无效归responsive，旧尺寸/字号/显示屏字段继续保留，style按每段动画捕获。正式部署状态见[U51计划与验收入口](CHAT-INSTANT-RENDER-2026-10-17.md)。

ui9窗口全局偏好兼容新增DockActivateOnHover:boolean，缺省false；旧窗口文件没有该字段时不自动激活。启动／唤回焦点回执仅包含受限输入框ID、pageFocused／foreground和时间，不含正文。快捷写作／便签入口复用原工作区，不新增、复制或迁移任何正文存储。

2026-10-17聊天ui9的DockHideDelayMs只降低校验下限至0，上限3000、缺省350保持；读取与原生接收都保留显式0。JSON字段和每屏档案格式不变，旧100ms等值继续原样有效；不改变日记或消息格式。

2026-10-17 消息主体实施为隔离候选：db.messageStore={version:1,units,layouts}；Entry.messageUnits仅索引/authority，body/content是兼容投影。unit richdoc、时间来源、稳定origin/replyTo/commentOn与媒体出现身份见 [实际协议](MESSAGE-UNITS-IMPLEMENTATION.md)。分类标签由Entry实时展开；旧原件不迁移覆盖。db.chatJournal.withdrawals仅身份/时间，优先级高于延迟上传及旧备份。开发启用、正式未启用的边界见验收，历史“方案”段保留。

2026-10-16 ui9新增浏览器本机偏好shiye-room-viewports-v1：最多96个会话／线程／列表类型的阅读位置，保存消息ID锚点、相对视口顶部偏移、距底部偏移与是否停在底部，不含消息正文或媒体字节。切出时同步保存，回到会话按消息锚点恢复；可重建的UI偏好不修改chatJournal、日记正文或消息格式。损坏／不可写时退回会话内存；无记忆的本机会话显示最新，显式搜索／引用跳转优先。

ui9向既有shiye-room-switch-mode-v1兼容新增manual值，对应无倒计时的Esc手动列表；direct默认值、list预选及既有排列保持。保存栏的dirty状态仅在当前表单内存，不新增后端字段。

0.9.23：持久richdoc v1向后兼容新增video节点，attrs与image同形（blockId/assetId/occurrenceId/insertedAt UTC或null/widthRatio/align/caption/alt），generic richMediaReferences供资产可达性、server MIME关联与恢复映射；richImageReferences保持图片专用。旧客户端不能降级覆盖，未知节点/属性仍拒绝静默丢弃。原图/视频保存在原media目录，HTML只是阅读投影。旧篇reading-document仅内存转换/有界缓存、当前source版本绑定，分类标签/评论实时；不写旧Entry、body或时钟，旧图/视频插入时间未知保持null。jsdom 30.1.1从开发依赖移到运行依赖供生产只读解析。旧实验包保留，新增核心能力改变旧依赖hash，禁止原批次强行续跑。

0.9.21正式/开发新快捷篇默认richdoc，旧篇/模板不批量转换；分类/标签修改缺contentEditedAt时冻结previous.updatedAt（仅有效旧值），明确null保留，不用本次now。chatJournal正文/附件只读但属性可改；旧安卓push/both遇richdoc明确409，pull-only正常，防止有损同步。二次29候选另存review-20261016-a，compatibilityView可承载音视频附件区域或安全原HTML，未扩richdoc v1支持文件/折叠节点，也未导入正式库；原警告、依据、第一轮hash保留。

2026-10-16 开发候选增加向后兼容Entry正文格式 `contentFormat:'richdoc'`、`body:shiye-richdoc/v1`，body权威，content由服务端安全生成。当前/历史图片assetId恢复时重映射，occurrence/block ID及插入时间保留；旧客户端仅同投影的属性修改允许，正文降级409。contentEditedAt由服务端维护，分类标签不推进；旧篇不因属性修改补造该时钟。仅显式开发入口新篇启用，正式旧库不转换。全量转换3015条另存私有候选包，不能视为已导入Entry。见 QUICK-RICHDOC-CANDIDATE.md。

2026-10-16 ui8新增聊天浏览器本机偏好：shiye-room-switch-mode-v1（direct／list，默认direct）、shiye-room-order-v1（稳定会话ID数组）和shiye-room-appearance-v1（会话ID→可选theme/shade/bubble/radius/messageGap）。缺省继续全局外观，取消独立设置只删除当前会话覆盖项；字号与窗口仍按显示屏记忆。均不改变日记、消息、媒体、chatJournal及后端API格式。窗口最小宽度360 DIP是展示约束，不是数据迁移。

2026-10-16 ui7输入高度仅新增聊天浏览器本机偏好shiye-input-cap-v2，默认160px；旧shiye-input-height字段保留但不再作为空框最小高度。拖动保存自动上限，当前固定高度仅在内存中，清空／发送／换会话解除。此项不改变日记、消息、媒体或图片窗口每屏记忆格式，见 validation/2026-10-16-composer-auto.md。

2026-10-16 候选转换仅写 var/migration-lab 私有副本，不改正式Entry/schema：包内保存原来源快照、candidate.body、attachmentPlacements/provenance、段内temporal、prepared及独立validation。图片出现稳定ID、历史insertedAt=null，附件描述原序前置；临时range绑定源revision/hash。700篇验证与8篇例外见 validation/2026-10-16-legacy-conversion-expanded.md；该实验包不是正式统一API/可恢复媒体备份协议。

2026-10-16 用户确认后续旧日记转换生成独立新副本、源库保留；旧附件按原列表顺序放正文开头，位置标为转换规则 legacy-default-start，不能补造历史 insertedAt。结构/内容/引用/时间/渲染多层校验与分批例外方案见 LEGACY-CONVERSION-ITERATION-PLAN.md；本轮仅讨论，不改存储 schema 或运行代码。

2026-10-16 ui6图片窗口偏好独立存于聊天状态目录image-window.json，Displays字典复用每屏DIP位置／尺寸、Maximized结构，TextScale固定1且不改变主聊天文字比例。不改日记、聊天消息、媒体身份或备份协议；旧文件缺省按当前屏建立首条记录。

2026-10-16 可变属性兼容约束：分类/标签等与规范正文独立维护，ID/图片出现/评论关联不随改名改变；属性 updatedAt 不等于正文编辑时刻。纯处理器 v2 新增可选 contentEditedAt 上下文，候选持久字段尚未落库；旧 Entry/HTML/Markdown 继续原路径。当前分类改名未同步全部 chatJournal 关联、归篇只读服务端边界未齐、聊天桥尚非完整双向，这些必须在正式适配前修复验证，见 FRONTEND-DATA-COMPATIBILITY.md。

2026-10-16 ui5 仅扩展聊天窗口本机 window.json：可选 LastDisplayId 与 Displays 字典，每屏记录工作区相对 DIP 位置／尺寸、TextScale 和 Maximized。保留旧顶层字段，旧设置迁入首次当前屏，断开屏的记录保留；不改变 diary.json、聊天消息或备份协议。实现 DisplayMemory.cs，验证见 validation/2026-10-16-display-memory.md。

2026-10-16 新增独立 content-preparation 纯处理器：规范 richdoc 正文不改，生成可重建块时间/媒体引用/纯文本/版本指纹；消息时间与评论时间分别处理，撤回仅接受空正文。`shiye-prepared-content` 是处理结果，尚非正式持久 schema；edit-fallback 等派生来源需在后续统一接口适配时映射。当前未改变 Entry 字段或存储写入。见 CONTENT-PREPARATION-V1.md。

2026-10-16 历史时间只读审计：用户指定长文明确时间戳优先、无时间戳按编辑时间兜底。当前库的 2915 篇旧格式原对象均保留 createTime/recordTime/updateTime，3 篇原始/当前修改时间有差异；新索引需保留来源和精度，不改原文。3046 个图片资源尚无登记的每次插入时间，文件修改/入库不等于插入；未扫描图像字节 EXIF。见 validation/2026-10-16-diary-time-audit.md；本轮未增加存储字段或迁移。

2026-10-16 快捷长文继承审计仅新增文档/机器验收清单，未改运行格式。新试验图像节点已有每次文件插入的 UTC insertedAt；旧正式媒体 importedAt 只表示入库（且文件去重可复用旧媒体），lastModified/EXIF 不是正文插入时间。长文手打时间与 Entry 日期/保存时间必须区分，历史未知不能补造。手打时间锚点读取、上下文继承和图片复制/移动时间规则仍为待实现建议，见 QUICK-RICHDOC-INHERITANCE.md。

2026-10-16 富文本第一步仅为独立浏览器试验库 `shiye-rich-text-lab-v1`：drafts/current 可增加 revision，旧草稿缺字段按 0，保存采用 expectedRevision 冲突检查；drafts/before-import 保存上次导入前的试验草稿，与相关图像 Blob 同事务提交，失败整体回滚。试验 JSON 导出仍为 shiye-richdoc-lab v1，新增严格字段/媒体签名/哈希校验，不改正式 `.syvault2`、Entry 或聊天格式。这个恢复副本机制不能用于已确认只留占位提示的聊天撤回原文。

0.9.20 部署只增加本机 config/deployment.local.json，代码与既有 data／var 位置分离，不改日记格式；用户手动打开后 API 已为 0.9.20，读取原 F 盘库，见 validation/2026-10-16-desktop-entry-switch.md。

0.9.19 开发版：聊天时间分隔缺省改为 15 分钟，已有显式数值保留。窗口偏好新增 TextScale，将旧 ZoomFactor 迁为文字比例，WebView 本身固定为 1；未迁移时缺省使用旧比例。新增本机输入高度 shiye-input-height、表情频次 shiye-symbol-usage-v1、切换停顿 shiye-switch-delay（缺省 800ms，可调 400–3000）及外观 messageGap（缺省 10px）。这些只属当前 profile，不改变日记格式、原消息、媒体 ID 或备份协议。

0.9.18 向后兼容扩展：顶层可选 chatJournal={version:1,rooms:[{sourceId,id,title,category,idleHours}]}。由聊天生成的普通 Entry 附 chatJournal={version:1,sourceId,roomId,title,category,idleHours,status:open|closed,firstAt,lastAt,deadline,messages,projectionHash}，messages 使用稳定本地 id、UTC sentAt、Markdown text、attachments（正式 media ID）、可选 replyTo，保存原文而不存 Telegram 协议对象。content 是可阅读的安全 HTML 投影，date 为首条消息时间，显示时间默认北京；图片原字节登记在 media/ 并进入原有备份。状态由最后消息时间加该篇间隔计算，服务启动及每分钟补检查；即使未运行也在下次启动恢复，下一消息的精确分篇不依赖计时器准点。projectionHash 检测人工修改，避免覆盖；未知历史日记字段继续保留。备份恢复 remapEntryMedia 同时映射嵌套消息附件，合并对话配置只补缺失，不覆盖当前配置。

聊天预览的新消息保留 Markdown 原文及既有 entities，显示时解析，不批量改写历史消息。`shiye-time-gap-minutes` 为本机时间分隔偏好，缺省 30；时区继续使用外观中的 timeZone（默认 Asia/Shanghai），不改消息 UTC 时间戳。

聊天预览 shiyeRooms 增加可选 wallpaperAssetId，关联独立 assets 库的 wallpaper:room:<UUID> Blob；元信息编辑保留未知字段。messageAlign=left|right 为本机外观偏好，EdgeSnap 为本机窗口吸附开关，旧配置缺省为开启。均不改变正式日记格式。

2026-10-17 会话管理在本机 IndexedDB `shiyeRooms` 中增加可选 `isPinned`、`isArchived`，缺失均按 false；已有ID、消息、草稿、媒体、归篇及未知元字段保留。归档只将现有dialog在active/archived数组之间移动，恢复沿用原ID，不是日记自动归篇开关。`set-state`复制当前库、事务保存成功后才替换内存并确认；本机localStorage `shiye-room-state-v1`仅缓存这两个状态，worker返回的房间列表为权威。普通导航过滤已归档项，置顶优先、组内保留`shiye-room-order-v1`。朝花夕拾系统会话暂禁归档，置顶不改变后台服务/绑定/运行器。此字段不扩展后端API或正式日记schema，多会话后端绑定仍按[接入契约](CONVERSATION-BACKEND-CONTRACT.md)独立实施。候选运行/验收状态见[会话管理](CHAT-ROOM-MANAGEMENT-2026-10-17.md)。

本地聊天映射追加 `assets` 中的 `mapping:<name>`，字段 name、kind=emoji|sticker、value 或 assetId。名称用 NFKC／小写规范化，改名用同一事务检查新名称并移除旧键；已发送消息不引用这个可变映射。正常窗口 `window.json` 新增 TopMost 与 ConfirmHide。共享 `var/quick-host.json` 新增 ChatVirtualKey（默认 F15=126），保留现有 VirtualKey/Modifiers；旧文件缺少新字段时由构造默认值兼容。不属于正式日记或同步格式。

2026-10-15 聊天预览输入更新不改变正式 schema。独立 profile 增加 `shiye-preview-assets-v1` 的 `assets` 表，键为 `wallpaper` 或 `sticker:<UUID>`，值含 Blob 与文件名。外观偏好增加 `sidebarCollapsed`，斜杠命令开关位于 `shiye-input-commands-v1`；都属于本机预览偏好，不作为正式消息／日记同步格式。消息发送后仍由原有隔离消息库保存附件字节，移除素材收藏不级联删除消息媒体。

0.9.16 增加可选 `settings.preferences.timeZone`，为 `system` 或有效 IANA 时区，界面缺省使用 `Asia/Shanghai`。日记 date/createdAt/updatedAt 的绝对时间不迁移；输入框墙钟日期按选定时区转换 UTC，日历/统计/回忆共用民用日期。实验聊天库独立，未在正式 schema 中引入 Telegram 协议对象。

0.9.14 仍不迁移日记 schema。`var/quick-host.json` 新增本机 `ResumeHours`，旧配置缺字段默认 5；有限数值 0–168 小时，0 禁用。开始时间与正文/标题选区、滚动位置仅在存活窗口内存中保存，不写入日记或同步。成功保存后才隐藏，过期仅销毁已保存的后台窗口；正在编辑的窗口不受时限清理。明确退出进程不保留位置快照。

0.9.11 没有迁移日记 schema 或重写历史正文。新增偏好 `settings.preferences.quickInitialFocus=body|title`；本机托盘热键/输入模式位于 var/quick-host.json，窗口比例位于 var/quick-window.json 的 ZoomFactor，不是日记字段。分类 order PUT 可带 expectedOrder 进行并发核对；省略时维持旧客户端行为。

## 本地库 schema 1

`data/diary.json` 的顶层为 `schema、entries、media、categories、imports、templates、settings`。存储层保留未知顶层字段。schema 与应用版本不同：应用0.3.0不意味着需要把数据schema改成3。

| 对象            | 主要字段                                                 | 约束                                                   |
| --------------- | -------------------------------------------------------- | ------------------------------------------------------ |
| 日记 Entry      | id、title、content、date、createdAt、updatedAt、revision | id稳定；content是HTML；日期使用可解析的时间字符串      |
| 分类与标签      | category、tags                                           | 分类是名称字符串，标签是去重字符串数组                 |
| 状态            | pinned、deleted、hidden、draft、demo                     | 隐藏／草稿／删除按视图过滤；删除是可恢复状态           |
| Markdown        | markdownSource、markdownHtml                             | HTML仍等于生成时快照才复用源码；直接改富文本后源码失效 |
| 媒体关联        | attachments                                              | 数组元素是media.id；不是路径或文件名                   |
| 编辑历史        | history                                                  | 保存之前的日记快照，最多20项，不递归保存history本身    |
| 原格式信息      | legacy.original、legacy.mediaReferences及其他legacy字段  | 原始未知字段、媒体缺失信息继续保留，不展示不等于可删除 |
| 媒体 Media      | id、name、type、size、sha256（可能有）                   | 实体文件为data/media/id；name只用于展示／下载          |
| 导入原件 Import | id、name、kind、sha256、tables等                         | 实体文件为data/originals/id；按原件哈希判断重复导入    |
| 模板            | id、name、content、category、deleted等                   | 删除标记可恢复；旧模板原字段保留                       |
| 设置            | settings.shortcuts、settings.preferences                 | 偏好与快捷键分别更新，避免互相覆盖                     |

访问锁另存在 `data/access.json`，保存盐和密码派生哈希，不保存明文密码。访问会话只驻留进程内存，重启后可能需要重新解锁。

## 写入与并发

所有数据库写入由 library-store 的 mutate 串行执行。先复制当前库，在副本上修改，写 diary.json.tmp，rename成功后才发布新内存库；回调抛错时不提交。

日记更新携带 revision。后端发现旧revision返回409，前端保留编辑内容供用户处理。不要用“无条件重试覆盖”掩盖冲突。不要在服务运行时外部编辑JSON，它可能被进程中的旧快照覆盖。

## 旧格式映射

Android `createTime` → 新 `date`；`recordTime` → 新 `createdAt`。分类／标签ID映射为名字，原对象同时留在legacy。contentType=1转Markdown HTML；复杂自定义富文本和媒体位置还不是完全一比一。

原始加密字节保存在originals。resources/legacy/backup_reader.py提供既有格式的静态兼容常量；Node仅读取其定义，不执行Python，不向浏览器公开该文件。格式常量不等于用户新备份密码，不应作为日志或文档示例输出。

## 新旧备份协议

- `.syvault`：version 1整包JSON加密，旧容量边界保留。
- `.syvault2`：version 2逐行记录；头、manifest、文件分块、认证结束记录。当前记录压缩标记为gzip-records；旧未压缩v2仍可读取。每个分块有序号，头和序号参与AES-GCM认证。
- 密钥派生与加密参数属于协议，不是可随意调整的性能设置。变化必须有新版本、向后读取分支和错误密码／篡改／截断测试。
- 恢复先暂存并核对每个文件大小与SHA-256，再追加日记；重映射日记与媒体ID，以及历史里的附件引用。不能仅恢复当前正文而丢掉历史关联。
- 恢复默认保留当前偏好和快捷键，不用外部库设置覆盖正在使用的配置。

## 容量与保存边界

上限统一在 public/shared/limits.js。旧格式元数据、完整库JSON和备份manifest仍整体处理；大附件采用流式/分块流程。不能把64GiB ZIP上限理解成任意大小文本库都能运行。

本地库、媒体、开发验收副本都是明文；只有新加密备份和保留的旧加密原件带加密层。本地访问锁不是磁盘加密。

## 将来进行结构迁移

先复制工作库并校验原件，迁移在隔离目录运行；每个版本有明确输入schema、输出schema、默认值与失败回退。验证记录数、ID唯一性、分类、日期、未知字段、媒体哈希和历史关联。全部通过后再切换正式数据位置。当前0.3.0结构整理没有对工作库执行schema迁移。

## 0.5.0 向后兼容扩展

- 顶层可选 tags:string[] 用于保存尚未附到日记上的独立标签；显示与 entries[].tags 取并集。
- media[].purpose=background 标记外观图片；文件仍是 media/id，MIME 按文件签名识别。相册与日记统计仍只计算日记实际引用的媒体。
- settings.preferences.appearance={accent,backgrounds:[{region,id,opacity,fill,position}]}；region 为 app/sidebar/list/editor/topbar，opacity 为 0–1，fill 为 cover/contain/tile，position 为 center/top/bottom/left/right。
- settings.preferences.layout={categories,tags,list}，布尔值 true 表示折叠。兼容读取旧 shiye.collapsed 浏览器偏好，首次切换后保存到库。
- 首次升级复制第四版被引用的 data/backgrounds 图片到 media 并登记引用；旧文件保留，缺失原件不编造。
- .syvault2 仍使用相同加密协议。恢复请求可选 restoreAppearance:true；仅此时恢复 theme、appearance、layout，并映射背景 ID。默认保留当前偏好。旧 .syvault 设置恢复行为不变。

## 0.6 数据扩展

增加可选 conflicts 数组保存重复导入的比较记录及人工处理结果；media.sha256 用于复用完全相同的附件。categorySort/tagSort 在 settings.preferences 中，手动顺序保存在 categories/tags。

启动阶段可补齐旧日记的 hidden、mood、markdownSource/markdownHtml；只在缺失且能核对原始字段时修复。发生修复的日记提高 revision，保持正文、日期、分类标签、原字段和媒体关联不变。修复前在 data 下生成 before-legacy-metadata-v06-时间.json 快照，migrations.legacyMetadataV06 标记已执行。

日期/分类/标题相同不等于重复，导入冲突依据见 IMPORT-CONFLICTS.md。syvault2 加密协议未变。不要把跨库重复识别当作已实现多设备同步。

## 0.7 扩展

entry.comments 可选数组：id、body（纯文本）、authorName、authorAvatarId、createdAt、updatedAt、revision、deleted、replyTo、replyPreview、attachments。作者和回复摘要在创建时保存快照；编辑不改变当时身份和时间。评论和回复图片、头像随加密全备份保存，恢复时与历史一起映射 media ID。普通日记 PUT 保留评论字段。

媒体增加 importedAt（入库时间）、lastModified（源文件修改时间）、sourceCapturedAtRaw（EXIF日期原文）、sourceCapturedOffset、sourceCapturedTag。DateTimeOriginal 是原拍摄字段，DateTime 可能是编辑时间；没有时区不擅自转成 UTC。图片压缩副本不保留完整EXIF，以上字段单独保存；原件模式保留字节。compression 描述压缩方式和原大小。排序不改变任何媒体字段或文件字节。

视频处理仅对新上传的暂存文件进行，成功只登记较小的结果；较大时保留原上传视频。旧库不自动转码。任务状态只驻留进程，关闭服务可能中断；客户端在原页面可继续查询同一任务，错误后保留File可重试。

布局增加 sidebar、media、mediaPosition、mediaWidth、listWidth；专业写作临时布局不覆盖阅读布局设置。默认身份保存在settings.preferences.profile，包括authorName、motto、authorAvatarId和authorAvatarCrop；评论保存当时的身份及裁剪快照。顶层stickers数组保存收藏、分组和软删除状态，备份恢复重映射mediaId并去重。

## 0.8 编辑文档扩展

Entry 增加可选 `contentFormat: markdown | html`。Markdown 日记以 `markdownSource` 为编辑源，`content` 与 `markdownHtml` 是相同的已清洗 HTML 投影，继续供统计、搜索、导出和旧客户端读取。缺省格式且存在匹配源码时按 Markdown 打开，否则按原 HTML 打开；显式 html 不自动转换。旧客户端直接改 HTML 导致快照不匹配时，回退为 HTML。

`editorOriginalHtml` 只在第一次由 HTML 转 Markdown 时由服务端从 previous.content 保存，普通更新不能覆盖。仅前端核对确认后转换，不做全库启动迁移。普通保存省略原 HTML 和历史数组，避免重复上传大字段；历史仍由后端生成。历史恢复同步恢复格式和 Markdown 源码。

HTML 投影只允许本地 `/media/<id>` 图片；编辑时发现已登记的本地图片引用，会关联到 attachments，避免完整备份遗漏。恢复备份重映射正文、Markdown 源码和原 HTML 中的媒体 ID。顶层 schema 和加密协议不变，旧格式原件和未知 legacy 字段继续保留。

## 聊天实验库的本轮扩展

正式日记 schema 不增加 Telegram 协议对象。独立 IndexedDB 的 `shiyeVersion=2`、`shiyeRooms` 保存会话 id/title/category/description/idleHours/kind/participants；当前参与者 kind=self，预留 bot/recollection。旧合成私聊转换为本地群聊式会话时保留消息与媒体，内部使用负数会话 ID；上游 TL 边界转换为正数 chatId。此结构为实验适配层，不是最终跨端公共格式。普通草稿保存上游 DraftMessage，Markdown 仅在发送时转换为文本与格式实体，保持草稿选区长度一致。

## Android 样机本机偏好

Android 独立样机 0.2.2 的本机置顶偏好使用已有 SQLite `meta` 表的专用 key `android-chat-ui-preferences-v1`，值为 JSON `{version:1,pinIds:[会话ID],...未知字段}`；不升级 DB 版本，不改日记/消息表。读取与提交在原有串行 `LocalStore.dispatch` 事务内完成，桥在 `endTransaction` 返回后 ACK。`commit(null)` 仅重置这个已知偏好 key，不影响其他 meta 或正文。原生 key 存在的空列表是有效值；仅原生缺失时只读迁移旧 IDB `preview/android-ui-preferences-v1`（其存在的空列表优先），旧 key 缺失再读旧 localStorage。迁移后原生唯一权威，旧 IDB 不双写，localStorage 仅重建排序缓存。此偏好尚不进入样机 ZIP manifest，不代表跨端共享数据契约。背景与真实验收见 [Android 本地状态优化](ANDROID-INPUT-REFINEMENT.md)。

## 设计草案：统一记录 v1（未接入）

分类、会话、时间锚点、图文/媒体、只读聊天归篇及评论关系的候选契约见 [统一数据契约 v1](UNIFIED-DATA-CONTRACT-V1.md)。本节仅提供设计入口，不改变本文现有 schema；旧数据先不动。

# 2026-10-17 朝花夕拾附加状态（开发候选）

`db.revisit`保存config/revision/ruleRevision、cursor、固定batches、仅含SourceRef的deliveries及comments。旧Entry不改；读取旧长文临时生成带快照指纹的单元，聊天沿sourceId/roomId/messageId稳定身份。评论是相同MessageUnit/richdoc契约，origin.kind=comment，UTC发送/接收时间分开，commentOn关联单条/组/可选媒体位置，统一查询includeComments时读取；不再成为回看来源。text为兼容显示缓存，撤回清空text和body。配置元数据不冒充源正文。此候选完整备份导出可包含原字段，但旧恢复合并/开放数据导出尚未适配，不能宣称已可往返；未启用正式库。详细见[REVISIT-PUSH](REVISIT-PUSH.md)。
