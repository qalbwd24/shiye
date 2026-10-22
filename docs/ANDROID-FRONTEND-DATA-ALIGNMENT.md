# Android 前端与既定正文契约对齐

2026-10-18表情包后端衔接已部署：新增catalog与from-message，chat/unit来源核验后复用db.stickers，原消息/GIF/时钟/引用保持，多图明确选择、同资源去重/恢复。11收藏与15相邻回归、12条实际来源副本预检通过；正式API0.9.24 health.stickerCollection.version=1可用，ui28原生已标准恢复；3014旧篇/源字段/旧收藏保持。桌面桥与Android菜单面板仍未接，旧本地素材须保留式映射。两端按[实际接口](STICKER-BACKEND-API.md)接入，运行回读见[验收](validation/2026-10-18-sticker-message-backend.md)。产物outputs/sticker-message-backend，临时tmp/sticker-message-backend。

2026-10-18 回看气泡残留缩进已仅在展示层修复：按diary顶层段落去Unicode段首空白，marks前处理，代码/嵌套结构/聊天及原body/ID/时间/评论保持。13定向＋12实际隔离前端及2共用fixture测试通过；API0.9.24 paragraphIndentation=1已重启，标准恢复ui28原生ready、116%/2屏。冷解析曾timeout后沿原游标自动重试成功；3014旧篇/源字段与11737安装hash保持。用户明确要求安卓复用电脑格式/算法，新增[实际内容契约](DESKTOP-ANDROID-CONTENT-CONTRACT.md)及合成fixture，写清canonical正式开关仍false、只读投影/现有聊天写口和Android差距，不冒称已全端统一。见[验收](validation/2026-10-18-revisit-indent-and-content-contract.md)，产物outputs/revisit-paragraph-indent，临时tmp/revisit-paragraph-indent。

2026-10-17。本文最初是源码只读核对与前端适配约束；后续Android0.6样式实现及AVD运行验收见 [实时迭代](ANDROID-UI-LIVE-ITERATION.md)，不沿用早期“未调用ADB”描述当前全项目。本文没有宣布 Android 已接入服务端，实际接口变化按下文更新与代码核对。

## 用户确认与本轮边界

用户认可的是入口结构：默认会话列表、快捷新建写日记、底部导航切到日记查看；不代表认可各页内部样式。当前优先把前端样式、排版与交互细节做好。按三部分分别验收：会话列表/消息页，长日记编辑，长日记阅读列表/详情。

后端内容格式已确定，Android 负责渲染既定格式与提交新内容，不另设计后端格式、数据库或切分算法。既定格式与“所有远程同步接口已经可用”是两件事；本轮不以暂未开放云端为由重做内容模型，也不将本机接口直接开放到网络。

专题产物使用 `outputs/2026-10-17-android-frontend-polish/`，临时文件使用 `tmp/android-frontend-polish/`。本次核对只新增本文。

## 哪份文档代表实际协议

1. [MESSAGE-UNITS-IMPLEMENTATION.md](MESSAGE-UNITS-IMPLEMENTATION.md) 与当前 `src/server/domain/message-store.mjs`、`public/shared/message-units.js` 是已实现消息主体协议。`db.messageStore={version:1,units,layouts}`；每条活动 unit 的 `body` 是 `shiye-richdoc` v1。
2. [DATA-MODEL.md](DATA-MODEL.md) 顶部 2026-10-17 实施记录描述同一模型。长文整篇保存继续走 Entry API，由服务端在同一事务切分/重组；聊天走已有 chat-journal 写口，由服务端转换共同正文。
3. [UNIFIED-DATA-CONTRACT-V1.md](UNIFIED-DATA-CONTRACT-V1.md) 自称草案，其 `Record/JournalPage/categoryId` 等设计字段不能直接冒充现存 API。较新的实现及明确用户决定优先。
4. [CONTENT-PREPARATION-V1.md](CONTENT-PREPARATION-V1.md) 描述早期纯处理器，`shiye-prepared-content` 是派生输出，不是第三份权威正文或新写入协议。当前逐消息持久切分以 `message-units.js` 为准。
5. [FRONTEND-DATA-COMPATIBILITY.md](FRONTEND-DATA-COMPATIBILITY.md) 仍提供保真和唯一正文原则，但旧“尚未实现”的逐项缺口须对照最新代码。例如当前 Entry 服务端已拒绝改写聊天归篇正文，分类变更也不再把正文时钟推到现在。

当前部署开关不能由应用版本号推断：`/api/health.messageUnits.enabled` 才表示该服务是否为新内容启用消息主体。本文未访问运行 API，不报告实时开关状态。旧转换候选也不等于已导入正式库。

## 三部分当前接缝

| 前端范围            | Android 当前实际来源                                                                                                                                     | 既定内容来源                                                                      | 直接差距与最小处理                                                                                                                                           |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 会话列表/消息页     | `TelegramFrontend.java` 装载冻结 Web A；`shiye-android-telegram-v2` IndexedDB 保存 Telegram 本地 TL 模型；`android-chat.js` 经 BroadcastChannel 控制会话 | `chatJournal.rooms` 元数据，MessageUnit 正文/关系；旧聊天兼容缓存为 Markdown 消息 | TL 仅作渲染/交互模型，不能作为新的公开正文格式。保留来源 ID 映射，把业务状态适配到 Web A。不要把 SQLite 旧手写消息表误当当前随想数据源                       |
| 长日记编辑          | `LocalStore.entries.body` 为 richdoc，`editor.js` 已复用公共 `createRichBodyAdapter`；MessagePort 调用 `saveEntry`                                       | Entry 整篇 `body`，服务端生成 unit/layout；richdoc 的块/媒体出现身份保持          | richdoc 核心已有直接复用路径；桥的 `baseRevision`、`categoryId`、媒体本地 ID 与现存服务端 Entry 字段需映射。前端不自行切分 unit，也不同时可编辑 HTML 与 body |
| 长日记阅读列表/详情 | `LocalStore.bootstrap/getEntry` 提供列表摘要/全文；当前 editor 只接 richdoc                                                                              | Entry 元数据；原生 richdoc 或旧格式 `reading-document` 只读投影                   | 当前无法据此声称覆盖旧 HTML/Markdown/聊天归篇。列表与详情分开取数，旧篇使用服务端投影；原格式未知/不完整时只读兼容，不保存投影回原件                         |

### 已经相同的 richdoc

公共 `rich-document.js` 约定为 `{format:'shiye-richdoc',version:1,content:[...]}`，支持段落、标题、引用、列表/任务、代码、分割线、表格、图片和视频。非文本节点带稳定 `attrs.blockId`；图片/视频含 `assetId,occurrenceId,insertedAt,widthRatio,align,caption,alt`。

Android Gradle 的 `syncEditorAssets` 从公共源码复制编辑器/adapter/校验器，不能在打包副本另建一套正文规范。`LocalStore.validateBody` 是本地 Java 校验实现，能力与上限比通用校验更窄，且验证本地资源存在；接收到不能完整保留的节点/字段时须保留原件并展示明确只读状态，不能删字段后保存。

### 身份、分类、版本、媒体的实际区别

| 字段         | Android 现状                                                                     | 现存服务端协议                                                                                                                                                |
| ------------ | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 分类         | SQLite `categories={id,name}`，Entry 用 `categoryId`                             | 库 `categories` 仍是名称数组，Entry/room 使用 `category` 名称；尚未强制分类 UUID                                                                              |
| 长文版本     | `saveEntry({id,baseRevision,...})`                                               | `PUT /api/entries/:id` 要完整 Entry 字段及 `revision`，冲突 409；不是 PATCH                                                                                   |
| 本地旧聊天   | SQLite UUID message/room/clientId，单独 `assetId`；与新 Web A 随想不自动同步     | chat 输入 `sourceId` UUID；roomId 是有符号十进制字符串，messageId 是正十进制字符串；全库 canonical ID 由服务器生成 `chat:sha256([sourceId,roomId,messageId])` |
| Web A 新聊天 | TL `id,date(秒),message,entities,media,replyToMsgId`；媒体字节在 local documents | 输入为 `id,sentAt(UTC),text(Markdown),attachments(media IDs),replyTo(本地号)`；canonical 使用 `body,eventTime,origin,replyTo(全库 unit ID)`                   |
| 媒体         | app 私有文件 + 本地 assets/IDB documents；SQLite `mime`                          | 正式 media 资源表用 `type`，上传得到稳定 ID；正文每次出现另外保留 `occurrenceId` 和 `insertedAt`，不拿 blob URL/本地文件路径当正式 ID                         |
| 时间         | SQLite 消息 `eventTime` 列是字符串，输出 `sentAt`；Web A date 为秒               | `unit.eventTime={instant,timeZone,precision,source,sourceField}`；允许明确 unknown。新媒体实际插入时间与文件入库/拍摄时间分开                                 |
| 属性/界面    | 置顶原生 meta，外观 localStorage                                                 | unit 的 `attributes` 在读取时从 Entry/room 展开；UI 外观/草稿不写入正文，分类/标签改动不重置内容时钟                                                          |

SQLite 旧消息 ID 不能通过简单去掉 UUID 符号当服务端 messageId；原有数据需要明确映射/导入事务，该工作不属于本次样式优化。现有 Web A 使用的数字房间与消息号可由适配层保留，但跨设备身份分配/共享会话注册应沿后端工作接入，不能由 UI 随机改号。

## 可直接复用的读写路径

| 动作          | 真实现有接口/模块                                                                                       | 前端责任                                                                                                                                                                               |
| ------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 能力检查      | `GET /api/health`：contentFormats、inlineMedia、entryReadingDocuments、messageUnits                     | 根据能力渲染/限制保存，不能只看 0.9.24                                                                                                                                                 |
| 篇列表/元数据 | 现有 `GET /api/library` 返回完整库；`GET /api/entries/:id` 返回 Entry                                   | 本地 Repository 可抽出轻量列表视图；不要在 UI 每次重绘重复反序列化整库；本轮不新增服务端分页口                                                                                         |
| 长文新建/保存 | `POST /api/entries`；`PUT /api/entries/:id`，快捷写另有 `POST /api/quick-entries`/token 恢复握手        | 提交原 Entry 元数据、`contentFormat:'richdoc'`、完整 body、attachments 和 revision；服务端完成 canonical/layout。失败保留编辑器及草稿                                                  |
| 旧篇阅读      | `GET /api/entries/:id/reading-document`                                                                 | 响应 `format:'shiye-entry-reading-document',readOnly:true,body,bodyComplete,html,source,metadata,issues`；严格绑定 `source.id/revision`，附件区域/兼容 HTML 不丢；投影不得参与自动保存 |
| 消息读取      | `GET /api/message-units` 与 `GET /api/message-units/:id`，前者 sourceId/roomId/entryId/time/filter 分页 | 尊重默认可见性，显式处理撤回占位；`candidate.readOnly` 与 `persisted` 分开，GET 不触发旧库迁移                                                                                         |
| 会话设置      | `GET /api/chat-journal`；`PUT /api/chat-journal/rooms`                                                  | 提交 `sourceId,id,title,category,idleHours`；不要发送草案中的 `idleSeconds/categoryId`                                                                                                 |
| 新消息写入    | `POST /api/chat-journal/messages`，每批最多 50                                                          | 提交稳定 id、UTC sentAt、Markdown text、正式 attachments、可选 replyTo。这个口不接受任意 MessageUnit/body；当前没有通用 `POST /api/message-units`                                      |
| 回执/撤回     | `POST /api/chat-journal/receipts`；`POST /api/chat-journal/withdraw`；消息 PUT 返回 405                 | 本地确认和服务端确认区分；无正文撤回队列优先于延迟上传；重复操作使用原身份。编辑原消息须按撤回/新 ID 重发规则，不能将 Web A 本地编辑误映成服务端覆盖                                   |
| 媒体上传/读取 | `POST /api/media` 或 `/api/chat-journal/media` 传原始字节，`GET /media/:id` 支持 Range                  | 上传成功取得正式 ID 后绑定 body/消息。失败不提前显示“已同步”或清空输入                                                                                                                 |

上述接口仍受 `src/server/http.mjs` 的本机 Host、同源、写请求头和本地访问锁约束。它们证明业务契约已存在，不代表 Android 现在可以直接通过公网连接。近期跨端同步以 [SYNC-V2-DESIGN](SYNC-V2-DESIGN.md) 为准，远程传输/认证/增量同步仍待实现，前端不绕过限制。

2026-10-17更新：电脑多实例会话后端v1已部署，实际服务发现/实例/绑定/收件/评论等接口见 [CONVERSATION-SERVICES-API](CONVERSATION-SERVICES-API.md)，能力由health.conversationServices判断；不是通用跨端同步入口。桌面选择UI/worker/固定桥和Android尚未接入，实例/绑定独立revision与每实例游标的适配见 [ANDROID-CROSS-DEVICE-ADAPTATION](ANDROID-CROSS-DEVICE-ADAPTATION.md)。

## 最小前端 adapter 建议（尚未实施）

保留当前三类 UI，只在平台桥与界面之间设一层 Repository。它输出业务对象/状态，TL 对象、SQLite 行和 HTTP 信封分别留在各自边界；不重建后端算法。

1. 长文 adapter：`loadEntry/createEntry/saveEntry` 保留完整 Entry 原字段；旧本地 `baseRevision` 映到现存 `revision`，当前 categoryId 用明确表映到服务端 category。媒体通过 `resolveAsset/uploadAsset` 接缝；界面继续使用公共 rich-body-adapter。标题、日期、分类/标签和原 body 分别取最新快照。
2. 阅读 adapter：`listEntries/readEntry` 输出列表元数据和不可编辑详情；原生 body 用共享 renderer，旧格式消费服务端 reading-document，保留 source/revision/bodyComplete/compatibility 与附件区域。用户明确进入原文编辑时才采用可编辑源；聊天归篇一直只读。
3. 消息 adapter：Web A 的 TL 仅在渲染边界构造，原 `unit.id/origin/revision/state/eventTime/body/replyTo` 以映射保留，不能用 TL 的 Number 时间/ID 回写覆盖原精度和身份。richdoc 若无法完整映射成 Web A 气泡，使用只读富文档内容视图/原文入口，不转纯文本后宣称无损。
4. 发信 adapter：沿用 `shiye-journal.js` 已有 TL→Markdown/媒体上传/回执/撤回思路，但它目前绑定桌面 `chrome.webview`，且 Android build 明确排除该文件；不能原样添加就声称接通。格式转换必须检查链接、下划线、高亮、嵌套实体、媒体说明等支持范围，未能保真时保留输入，不能静默降级。
5. 本轮 UI 优化只需守住当前读写接缝和内容身份，可先使用合成 fixture 检验三类页面。新 Repository/远程同步和既有数据迁移的实际接入应由后续明确任务实施；不为本轮前端样式调整变更 SQLite schema、公开 API 或后端存储。

## 后续验收边界

- UI：分别验证会话/消息、长文编辑、阅读列表/详情，不把入口结构认可当作页面设计验收。
- 契约：同一虚构 richdoc 经保存/重开后内容、blockId、occurrenceId、insertedAt、空白与样式一致；同媒体重复出现保持两个 occurrence；未知能力只读保护。
- 长文保存：标题/属性修改不意外清空媒体或未知字段；revision 冲突保留输入；旧篇投影不触发保存/转换。
- 消息：保留 sentAt 精度与原来源 ID、引用目标、上传失败输入和服务端回执状态；撤回不复活原文，编辑采用明确撤回/重发语义。
- 运行：本文只核对源码，未验当前服务开关、Android 联网、云同步、正式旧库导入、实际手机或 Android 强杀恢复。历史 AVD/真机证据引用原验收记录，不被本文重复宣布。

当前待明确的只有接入任务责任/时序、远程传输与既有本地两套内容的无损迁移方案；这些不阻断本轮三部分前端样式细化，也不重开已确定的正文格式讨论。
