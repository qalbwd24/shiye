# 电脑后端与 Android 内容接入契约

2026-10-19电脑源对账复用原纯格式：`src/server/shared-sync/desktop-journal-format.mjs`只将现`previews/telegram-chat/shiye-journal.js`的纯`formatText`函数原body逐字提取为`formatDesktopJournalText`，不导产品app/不eval/不调整算法。body SHA256为`cb58a22dabd52166982f0cd76e16dedc27a752f2cfff66dd1d92c914fe100a7a`，定向测试同时核原body字节与AST一致；UTF16实体offset及粗体/斜体/删除线/代码原规则保持。此提取只用于可信源对账，未来共同纯module由前端协调归并；不争PC journal所有权、不把本机pending/retry当已发消息。本轮真实对账5条格式差异由同原formatter消除，2条缺编辑版本证据的真正冲突仍保双方待核，不按sentAt猜更新。

2026-10-19数据会话已同步用户新确认：PC与Android都需完整本地优先，首次导入资料包后可立即离线读写；服务独立、PC暂为host，迁URL不换library/epoch/业务身份。后续v2原owner签名manifest/显式TOFU公钥pin及实际验签、本地durable outbox、联网先delta/redactions后原身份合流由数据会话实施/独审，未接UI不能称已可用。消息合流区分sentAt原发送时与真正editedAt/HLC/causal stamp，不按到达次序；思绪长文真并发正文保双版，旧缺编辑时钟继续保已确认冲突双版。参照[种子契约](SHARED-SEED-V1.md)、[编辑时钟草案](SHARED-EDIT-CLOCK-DRAFT.md)及数据接续，当前PC冻结legacy/replacement原格式不擅改。

同日PC用户新确认手动分篇：同思绪时间戳快捷键、仅随想前台，确认窗默认聚焦确认/方向键取消/Esc取消；确认边界后首条新消息强制时间分隔，草稿不自动发、旧替代链仍原篇。分篇属共同业务、按键仅PC交互，持久segment/原件晚到归属/离线幂等须先共同协议，不可拿close-idle冒充；见[原归篇需求](CHAT-JOURNAL-REQUIREMENTS.md)。

2026-10-19 PC转发端内候选边界：按原[聊天需求](CHAT-JOURNAL-REQUIREMENTS.md)补本机TL ForwardMessages串行确认及可选localForward请求回执，复用原普通消息正文/媒体/归篇，不把源程序/评论/owner/replacement状态移到目标。localForward/fwdFrom本机接线不等于新跨端来源schema，后端HTTP消息白名单/seed业务结构与Android源保持；数据会话已确认与replacementMediaIntent相同的端内边界，新增逻辑采集也剥离retry元数据。可实施隔离候选，仍须独审才可合包。当前仍未启用本轮PC候选，也不要求Android改UI或owner。

2026-10-18随想ui33已标准保存/快照/升级启用：/候选默认可见5行（设置1–5），所有匹配保留、方向键向下滚动；笑脸按钮移除，管理统一到设置→表情包，单列名称/缩略图与上移/下移/置顶/置底、名称排序/反转/常用排序。顺序是独立本机显示偏好、重开保留，不改消息或收藏身份，尚不跨端同步。39项候选＋39项安装资产UI、4项Node通过，11项原生看图复用字节未变ui31证据；11915安装hash/原生ready/API0.9.25核验，3014旧长文/295旧消息及媒体/原收藏/回看关联保留。Android按[需求与偏好格式](STICKER-SORT-FIVE.md)独立适配，未部署APK，也未混入并行共享收藏客户端候选。[验收](validation/2026-10-18-sticker-sort-five.md)。产物outputs/sticker-sort-five，临时tmp/sticker-sort-five。


2026-10-18电脑媒体配套升级：ui31/API0.9.25已标准保存、快照、升级并实际运行，metadata=1；11915安装hash、40项安装资产隔离UI、11项原生看图及21项Node通过，3014旧长文/291旧消息/2旧收藏身份与媒体、回看配置/评论/绑定及116%/2屏保持，运行器waiting无错误。空说明Enter、首次收藏本地保存/后台重试、10字表情尺寸（竖图限宽/横图限高）和看图焦点已交付。用户实测QQ动图通过；用户明确放弃微信聊天表情包直拖，不继续适配，也不写成已修复。Android未随电脑部署；两端规则看[跨端媒体说明](STICKER-IMAGE-CROSS-DEVICE.md)，[验收](validation/2026-10-18-chat-media-followup.md)。产物outputs/chat-media-followup，临时tmp/chat-media-followup。


2026-10-18表情媒体增量：源码/隔离候选0.9.25/ui30支持收藏可选`note`（2000 UTF-16码元）、catalog.limits和health.stickerCollection.metadata=1，原图片/GIF媒体ID、消息正文格式、引用及时间不变。收藏元数据不进消息caption；192px首帧缩略图仅缓存，重发用原件。新增64MiB收藏/表情发送上限，旧超限收藏保留。Android按[后端API](STICKER-BACKEND-API.md)和[客户端接入](STICKER-FRONTEND-INTEGRATION.md)适配direct-send hook及素材归一化；旧冻结Composer不会因复制面板就自动具备直发。**正式仍ui29/API0.9.24，本轮未部署APK**，勿按package版本认定已上线；[验证边界](validation/2026-10-18-chat-external-media-drop.md)。

2026-10-18 Android接入增量：手机0.11只用于UI手测；电脑/AVD0.12候选新增INTERNET与原生固定服务发现/status客户端，WebView联网拦截保留。只读目录快照不代替完整本地资料，未实现云同步/身份迁移/绑定或自动收件；最新后端仍按实际health能力与路由，不按package0.9.25猜已上线。见[接入与后续](ANDROID-SERVER-CONNECTION-012.md)及[实际验收](validation/2026-10-18-android-service-adaptation.md)，下方无联网权限等为先前0.11及更早阶段。


2026-10-18 新增独立网络同步接缝：参见[SYNC-BACKEND-IMPLEMENTATION](SYNC-BACKEND-IMPLEMENTATION.md)。`api/sync/v1`与日常正式API分离，业务data保留现有Entry/规范消息/richdoc；同步外壳版本不替换业务revision，资产原件分流。主库、TL IDB、Android SQLite/私有媒体尚未接此outbox/inbox，不能跳过内容语义写口及身份映射直接做双权威写入。当前只在独立合成库测试，正式运行入口未改。

2026-10-18更新：电脑端ui29已正式接通图片/GIF右键收藏与面板重发，保留旧本地UUID/Blob和斜杠映射，共用后端catalog/from-message/原收藏口。Android共用客户端/源接缝已准备，未部署APK或接云同步。当前接入状态见[客户端接口](STICKER-FRONTEND-INTEGRATION.md)与[运行验收](validation/2026-10-18-sticker-frontend.md)，下方待实施字样为此前阶段。


2026-10-18用户明确：安卓手机长期完整保存本地数据/文件，云端只负责与电脑同步；离线可写改读，本地保存ACK与同步状态分开。本地事务＋outbox、完整Entry/消息/原件/未知字段保留为后续框架约束，当前SQLite/私有媒体/TL IDB继续保留，不以未来缓存定位删除旧库。完整新Repository/可靠同步尚未实现。见[本地优先存储](ANDROID-LOCAL-FIRST-STORAGE.md)。本次为需求/架构记录，不改设备数据。

核对日期：2026-10-18。本文由电脑后端维护，是安卓适配**现有实现**的总入口，不是新造数据库，也不宣称安卓已接通。发生冲突时以最新用户确认、实际能力查询、当前源码及验收回执为依据；旧Record/JournalPage等草案不是现存写口。

## 1. 先看运行能力，分清四种版本

本次实际回读：API/package `0.9.24`，桌面UI `20261017-ui28`，`contentFormats=[html,markdown,richdoc]`，`inlineMedia=[image,video]`，`entryReadingDocuments=true`；`messageUnits={version:1,enabled:false}`；`revisit`含`paragraphMessages:1,paragraphIndentation:1,autoStart:true`；`conversationServices.version=1`。

2026-10-18后端后续更新已正式加载`stickerCollection={version:1,catalog:true,fromMessage:true,sourceKinds:['chat','unit']}`，原收藏记录及消息格式不变，前端按[收藏接口](STICKER-BACKEND-API.md)适配；原生桥/菜单与Android收藏仍待接，旧本地素材须保留式映射。

本轮测试/文档完成后，用户要求正式恢复每日随机：daily-random/北京时间08:00，来源日期范围2025-10-01起/无截止，本周期2025-11-04。此前六个月间隔是测试配置，保留旧来信但不作为当前模式；这段是运行快照，不是客户端硬编码默认，实际调用仍以status/config回执为准。

- 应用版本、richdoc正文版本、规范MessageUnit版本、派生段落算法版本分别维护，不能只看到0.9.24就推断所有能力打开。
- **已在运行：**新长文保存richdoc、旧篇只读图文投影、旧/新日记及聊天作为回看来源、段落消息投影与独立媒体时间、投递/评论/多实例后端。
- **规范消息持久化仍受开关控制：**新篇是否写`messageStore`要看`health.messageUnits.enabled`；现有canonical篇仍保留权威关系。回看可只读适配旧Entry/聊天，因此“能回看”不等于已把全库迁成canonical文件。历史转换批次也是另存候选，不能当已覆盖正式库。
- **Android目前未完成：**整篇Entry信封、canonical units/layout持久化与身份映射、电脑chat-journal写口、会话服务绑定、可靠跨设备同步。现有SQLite思绪＋独立TL IndexedDB随想不等于电脑数据层已经接通。

每次接入先GET `/api/health`，保存能力快照；能力不支持时只读保留，不猜字段或降级回存。

## 2. 数据的权威关系

```text
旧Entry HTML/Markdown ─只读转换─┐
新Entry richdoc正文 ──────────┼─ prepareDiaryUnits → 父MessageUnits + layout
                            │       └→ paragraphMessages：回看段落投影
聊天Markdown/附件/回复 ──────┴─ chat adapter → 同一种richdoc MessageUnit

父/段落SourceRef → 回看投递delivery → 气泡展示
                     └→ 评论：固定SourceRef，不写回过去正文
```

物理存储可以不同：电脑现在是`data/diary.json`＋`media/`，安卓是SQLite/私有文件/IndexedDB。但两端业务对象、ID、时间、正文、引用语义必须相同。TL对象、SQLite行、HTML阅读投影和气泡Markdown均不是另一个可编辑权威正文。

未使用canonical的篇：`Entry.body`（richdoc）或原格式正文权威。使用canonical的篇：`Entry.messageUnits.authority='messageStore'`，正文由units/layout重组；Entry.body/content为兼容投影，写前须核对一致。不得让两个副本都各自编辑。开关关闭不允许丢弃已有canonical数据。

## 3. Entry：长文写入与可变属性

| 字段 | 实际含义 |
| --- | --- |
| `id/revision` | 服务端长文ID和乐观版本；更新发送当前revision，冲突409，保留本地输入 |
| `title/category/tags` | 名称及可变归属。当前`categories`是名称字符串数组、tags是字符串数组，尚无统一分类UUID协议 |
| `date` | 用户选的篇日期/时刻；不能当每段消息的事件时间 |
| `createdAt/updatedAt` | 条目创建/最近写入时钟；updatedAt可能因属性改动而变，不作同步游标 |
| `contentEditedAt` | 正文/附件内容编辑时间；仅改标题、分类、标签不推进。缺字段的旧篇按原updatedAt保守兜底；显式null继续表示未知 |
| `contentFormat` | `html`、`markdown`或`richdoc`；新图文推荐richdoc |
| `body` | richdoc v1权威内容（canonical篇为兼容投影），只在明确richdoc格式时提交 |
| `content/markdownSource/markdownHtml/editorOriginalHtml` | 既有兼容/原文信息，须按原格式保留，不能让过期HTML或Markdown覆盖body |
| `attachments` | 关联资源ID数组；正文出现的媒体assetId必须包含在其中，但数组不代表正文位置 |
| `hidden/draft/deleted/pinned` | 当前可见性/状态；回看默认过滤隐藏、草稿、删除 |
| `chatJournal/messageUnits/history/legacy` | 已有业务/保留字段，不能当未知垃圾字段清掉 |

调用：`POST /api/entries`创建；`GET /api/entries/:id`读完整对象；`PUT /api/entries/:id`更新，**不是PATCH**。读取完整旧对象后修改需要的字段，携带revision及有效完整保存字段（title/date/category/tags/attachments/contentFormat/body等），遇409重新协调，不重置版本或静默覆盖。服务端保留字段不需要客户端自造；未知原件另存保留，不能仅保留UI能显示的几个字段后做整库上传。

`PUT`不能修改`chatJournal`归篇正文/附件；分类标签可以修改。聊天的真实修改只走聊天撤回/新号重发。新长文仍整篇输入、撤销、自动保存，不强迫用户以消息为单位写作。

## 4. richdoc v1：两端共用的正文

信封固定为`{format:'shiye-richdoc',version:1,content:[节点...]}`，不是ProseMirror原始`{type:'doc'}`。使用`toEditorJSON/fromEditorJSON`连接编辑器；已有blockId不得每次重建。

| 类型 | 关键结构/属性 |
| --- | --- |
| `paragraph/heading` | inline内容；heading level=1–6 |
| `text` | text字符串，可有marks；不带attrs/blockId |
| `hardBreak/horizontalRule` | 显式软换行/分割线；与屏幕自动折行不同 |
| `blockquote` | 块级内容，不能因内容像时间而抽出新时间标记 |
| `bulletList/orderedList/listItem` | 保留层级；orderedList可有start/type，listItem先有paragraph |
| `taskList/taskItem` | checked布尔值；不是待办跨端协议自动完成的证明 |
| `codeBlock` | language可选，内部空格/换行原样保留，不解析手打时间 |
| `table/tableRow/tableCell/tableHeader` | 单元格colspan/rowspan/colwidth按实际schema保留 |
| `image/video` | 独立资源引用和出现身份，见下一节 |

所有非text节点均有唯一、稳定的`attrs.blockId`。marks为`bold/italic/highlight/strike/code/underline/link`；链接仅允许http(s)/mailto，attrs范围和结构以`validateRenderableRichDocument`为准。普通JSON校验通过不等于编辑器能完整渲染，须同时通过renderer/schema往返校验。未知版本、节点、属性必须保留原件并只读，不删掉后保存。

空行、段首全角空格、Tab、文本marks、代码、列表结构都属于原文。Markdown输入`---`预处理避开Setext把上一段变大；fenced code保持。Markdown是输入/兼容格式，不要求所有正文节点都有可逆Markdown写法。

**展示保真边界：**richdoc/body与完整只读HTML保留支持的全部结构；回看`markdown`是气泡兼容投影，不是富文档的可逆序列化，例如underline没有完整等价Markdown表示。不能把该气泡字符串回存成原文或宣称所有富文档样式已经无损映射到TL。安卓优先共用richdoc渲染核；不能完整表达时提供完整只读原文入口，不能静默丢格式。

源码：`public/shared/rich-document.js`、`rich-document-renderer.js`、`public/editor/rich-document-editor.js`、`rich-body-adapter.js`、`rich-date-time.js`及`public/features/editor-input.js`。编辑器本体来自现有`public/vendor/rich-editor.js`，不要在Android assets副本另改一套规则。

## 5. 图片、视频与附件

2026-10-18用户追加并授权实施：图片/GIF先作为普通消息发出，再“保存为表情包”，通过缩略图库选用。后端已新增`/api/stickers/from-message`与`/api/stickers/catalog`，共用旧收藏，chat/unit来源校验、去重/恢复及目录DTO见[实际接口](STICKER-BACKEND-API.md)；原消息/资源字节不改。缩略图仍为前端缓存，thumbnailUrl=null；聊天菜单、原生固定桥和Android全链路仍待接入，运行能力以health.stickerCollection为准。

媒体节点例子和完整可运行样本在[合成fixture](../tests/fixtures/cross-device-content-v1.json)。attrs必须保留：

```json
{"blockId":"image-1","assetId":"fixture-image","occurrenceId":"appearance-1","insertedAt":"2025-10-18T00:31:00.000Z","widthRatio":0.5,"align":"center","caption":"图注","alt":"替代文本"}
```

- `assetId`是资源实体ID，不是磁盘路径、临时blob URL、TL document整数ID或文件名。正文不嵌base64原件；原字节独立存放。
- `occurrenceId`是该资源本次出现ID；同一asset出现两次必须有两个occurrence，可有不同插入时间、图注和宽度。评论图片时指occurrence，不能只指文件。
- `insertedAt`为本次实际插入的UTC ISO时间；旧图未知时保留null。不能将EXIF拍摄时间、ZIP文件时间、上传时间当插入时间。
- `widthRatio`为0.1–1，align为left/center/right，caption/alt为字符串。编辑图注/排版、重开或跨端下载不重生成occurrenceId/insertedAt。
- 新图/视频依原插入时刻成为独立内容单元；旧独立附件先放只读阅读开头，事件时间按原日记内容编辑时间推定，媒体节点的insertedAt仍是null，不伪造原始插入时间。
- 资源实体含id/name/type/size及可选sha256等来源元数据；Android本地`mime`需要明确映到电脑`type`，本地文件路径/下载状态留在本机侧车数据。
- 普通上传`POST /api/media`或聊天`POST /api/chat-journal/media`使用原始二进制请求体、Content-Type与URL编码X-File-Name；**不要发自造multipart/base64 JSON**。返回实际资源ID，SHA去重可能返回已有ID，必须使用回执。读取`GET /media/:id`支持Range；视频不要整段转base64放JSON。

独立附件还可能含文件/音频，目前richdoc v1不能完整内联它们；reading-document返回兼容区域/不完整标记，不能删资源后假装成为完整body。

## 6. MessageUnit及多种ID

共同单元的活动body仍是richdoc v1：

```json
{"id":"unit-opaque-id","revision":1,"state":"active","origin":{"kind":"diary","entryId":"11111111-1111-4111-8111-111111111111"},"body":{"format":"shiye-richdoc","version":1,"content":[{"type":"paragraph","attrs":{"blockId":"p-demo"},"content":[{"type":"text","text":"正文"}]}]},"eventTime":{"instant":"2025-10-18T00:30:00.000Z","timeZone":"Asia/Shanghai","precision":"second","source":"manual-marker","sourceField":"body"},"replyTo":null,"sourceSpans":[]}
```

本例说明字段，正文内容与可渲染层级仍须校验。state为active/deleted/withdrawn，撤回body=null；退休单元以无正文墓碑保留ID。origin为diary/chat/comment；chat再含sourceId/roomId/messageId。`replyTo`可能是canonical unit ID，也可能是回看SourceRef对象，不能强转同一种裸整数。`sourceSpans`是版本内块/范围映射（UTF-16半开区间），不作永久评论身份。

| 身份 | 要点 |
| --- | --- |
| Entry ID / unit.id | 分别是整篇与内容单元；标题/分类/时间戳不是ID |
| sourceId + roomId + messageId | 原聊天复合身份，三个字段都参与去重 |
| canonical聊天ID | `chat:`＋SHA-256(UTF-8 `JSON.stringify([sourceId,String(roomId),String(messageId)])`) |
| candidate ID | 旧篇只读候选编号，必须带SourceRef.snapshot；不是独立可上传canonical身份 |
| 段落ID | `父unit.id:paragraph-v1:r父revision:六位段序`；不作为另一份正文写入 |
| blockId / occurrenceId / assetId | 正文结构、媒体出现、资源实体，三者不能互相代替 |
| deliveryId / batchId / sequence | 回看某次投递、固定组、分页序号；不是原内容ID或事件时间 |
| operationId / revision | 同一操作幂等身份与对象乐观版本，不能混为一个序列 |

所有不透明ID保持字符串。聊天roomId当前为有符号十进制字符串（最多20位），messageId为十进制数字串（最多20位，实际校验`^\d{1,20}$`）；不能经JavaScript Number/有损Double来回转，超过2^53的值也必须保真。

## 7. 时间算法：复用代码，不写近似版本

| 层 | 唯一实现入口 | 行为 |
| --- | --- | --- |
| 手打标记识别 | `public/shared/content-preparation.js:readManualTime`、`legacy-time-segments.js:buildLegacyTimeSegments` | 独立完整日期时间、括号形式/显式时区；日期＋紧邻时间行有明确推导来源。纯钟点无日期不从今天或编辑日猜日期；代码/引用不造新锚点 |
| 正文拆分与重组 | `public/shared/message-units.js:prepareDiaryUnits/reassembleDiaryUnits` | 同一次使用整篇、时区、媒体上下文及previousUnits；layout保存原结构/引用，重组必须与原body逐结构一致 |
| 回看段落 | `public/shared/diary-paragraph-messages.js:projectDiaryParagraphMessages` | 顶层段落/真实换行后缩进/空行切分，屏幕折行不切；代码/列表/引用/表格内部保留 |
| 回看展示 | `src/server/domain/revisit-markdown.mjs`、`previews/telegram-chat/shiye-revisit-view.js` | 气泡去匹配的首时间标记与写作缩进，保留原body/时间/ID；嵌套结构和代码缩进不统一trim |

时间字段必须区分：UTC `instant`，解释来源的`timeZone`，precision（unknown/day/minute/second/millisecond），source/sourceField，以及派生时的附加依据。默认解释手打本地时间为Asia/Shanghai；用户选system时由运行端解析实际IANA时区并传入，不通过VPN/IP猜时区。

正文前没有有效标记的段落：优先`contentEditedAt`，字段缺失才用原updatedAt；显式null不转成现在。eventTime.source=`edit-fallback`并记录sourceField，未知为instant=null/precision=unknown/source=legacy-unknown。识别失败、时间倒序记录issues并保留原文，不自动改日期。

媒体：insertedAt非null→`media-inserted`；null→同样的正文编辑时间兜底；body内insertedAt不改。不能让文字手打时间覆盖图片真实插入时间。

段落：首段原起点，2–8段且下个真实更晚标记留得下时每段+2秒，否则+1秒；不足空间限制在下个真实标记之前并标clamped。同秒用稳定段序排序。派生source=`paragraph-estimated`，保留baseInstant/baseSource/offsetMilliseconds。单段原ID保持；多段父ID仍可解析，派生sourceSpans不冒充全文精确范围。详见[算法](DIARY-PARAGRAPH-MESSAGES.md)。

**纯JS模块可以在Android WebView/JS worker复用。** legacy HTML转换、存储哈希和回看服务另含Node/jsdom依赖，不可直接复制进Java/WebView。可以在公共运行层封装服务/移植外壳，但输入、输出、身份、时区和回归样本必须一致；业务部署在手机、电脑还是自有云以后确定，不据此重写算法。

## 8. 聊天写入、引用、归篇和撤回

实际桌面写口仍是`chat-journal`：先PUT `/api/chat-journal/rooms`配置sourceId、id、title、实时category、idleHours；再POST `/api/chat-journal/messages`：

```json
{"sourceId":"22222222-2222-4222-8222-222222222222","roomId":"-20","messages":[{"id":"9007199254740993","sentAt":"2025-10-18T00:32:00.123Z","text":"**正文**与==高亮==","attachments":[],"replyTo":"90"}]}
```

示例引用90须实际存在才有可用目标；示例只作格式，不向正式库发送。每批最多50条；服务端归一sentAt为UTC，正文Markdown经GFM＋高亮扩展转安全结构；媒体字节先上传，attachments用返回资源ID。输入本来就是完整richdoc的客户端不能丢成plain text后塞进text来假装无损：**现有写口没有通用`body`上传能力，需另行保留式适配/新增明确协议，不能冒称已支持。**

相同复合ID相同消息重试返回原回执；不同内容同ID409；回执可POST `/api/chat-journal/receipts`查询，避免未知确认时改号重复创建。原始消息PUT明确405，撤回POST `/api/chat-journal/withdraw`，以身份/版本及operationId等现有规则处理。撤回优先于迟到消息，永久存储不保留原文，只保提示/关系/墓碑；编辑后发送是新号＋重发时刻。

归篇由idleHours控制，默认使用已保存的会话规则；连续发送未超过空闲窗口持续同篇，归篇只改归属/投影。五小时不是每条定时切，也不是复制另一套可独立修改长文。正文端只读，分类/标签可变。`sentAt`是原消息时间，不等于本地TL整数秒date、入库时刻或回看投递时刻。

## 9. 读取旧日记、canonical和回看

| 路由 | 安卓应消费的结果与限制 |
| --- | --- |
| GET `/api/entries/:id` | 实际Entry；按contentFormat选编辑器，不把HTML当richdoc |
| GET `/api/entries/:id/reading-document` | 只读信封format/version/readOnly/mode/body/bodyComplete/html/source/metadata/附件区域。bodyComplete=false不得回存部分body；source绑定版本/指纹 |
| GET `/api/message-units?entryId=...` | version/enabled/persisted/units/分页；可能另有只读candidate。units为空不等于旧篇没有内容，须检查candidate |
| GET `/api/message-units/:id` | 已持久规范单元，不承诺任意candidate或派生段落ID都可通过此路由直取 |
| POST `/api/revisit/feed` | after/limit→deliveries/batches/next/total；回看投递与当前可用来源，按原始分页序号推进 |
| POST `/api/revisit/source` | deliveryId→原消息及完整只读日记，不用菜单显示内容作为可编辑原件 |

SourceRef是`{entryId,unitId,snapshot?}`。旧篇snapshot是内容身份指纹，内容变更后旧ref标不可用；分类标签实时取Entry，不能因改名重指另一段。canonical来源直接保留规范ID。客户端不得自行重算/替换已收到的ref。

已有父长消息拆段后，父receipt保留，feed返回superseded=true；首段带replacesDeliveryId，前端复用原本地消息号，其余段正常加入。**分页必须按完整原始页推进next/total，再过滤展示**；隐藏父项不是删序号。后端生成稳定投递ID保证重试去重，客户端按deliveryId做幂等应用。详见[来源](revisit/02-sources.md)、[推送状态](revisit/03-delivery.md)。

## 10. 朝花夕拾、评论与服务实例

interval按来源时区的日历年/月/日整数倍回看，不把六个月写成180天；不存在的日期按当前skip策略。daily-random每天按保存的dailyTime（用户此前指定08:00）与时区固定一个有内容的历史日期，保存抽选，重启不重抽；周期内按原钟点推送，早于重置钟点的原消息落在周期次日。sourceDateFrom/To只过滤随机历史日期、边界双含，不是时区设置。

实际算法入口`src/server/domain/revisit/engine/`与`delivery/daily-random.mjs`；不由前端随机选日/写游标。首次从启动时刻，过去时段用显式manual补看；自动tick按完整分钟续进度，事务内投递/固定组/游标一起提交。

用户最新回复语义：**无引用回复当前会话最近已收到历史单条；有引用指向被引用单条。** 后端仍支持显式固定组评论，因此只传batchId会评论固定组，不会猜“最近”。前端发送前冻结`instanceId（如有）+batchId+deliveryId`，新来信/切房/改规则不改草稿原目标。图片可另传occurrenceId。

评论是独立MessageUnit（origin.kind=comment），保存createdAt/receivedAt、body/text缓存、targets、replyTo、commentOn、operationId及状态；只存一个主体，按篇聚合看，消息/媒体定位具体锚点。评论不参与来源目录/再次回看。旧普通Entry评论与回看评论目前是不同存储，不能复制一份相同评论到两处。

会话选择服务遵循[实际会话服务API](CONVERSATION-SERVICES-API.md)：providerId=revisit，instances各自state，bindings用独立revision。多个会话选同一类型时建不同实例；每实例规则/游标/投递/评论独立。POST `/api/conversation-services/request`用instanceId/action/payload；来自旧实例的引用仍指旧实例，不能用当前绑定重解释。桌面兼容UI目前仍使用固定朝花夕拾房和旧单例，不能照搬裸`-900000001`作为跨设备唯一会话ID；多实例选择UI/worker/原生桥还需接入。

## 11. Android字段映射和当前缺口

2026-10-18 Android后续回读：0.10/code12已保留数据安装并ADB启动主AVD；同一fixture在真实WebView与桌面逐对象一致，实际Tiptap整篇往返、原生保存ACK及schema3回读通过。下面更新的是安卓实际状态；不改变上文电脑API/开关，也不代表已经接通远端Repository。详见[端侧验收](validation/2026-10-18-android-content-contract-010.md)。手机仍0.6。

| Android当前对象 | 电脑既定对象/需要补齐 |
| --- | --- |
| SQLite entry.body | 共用richdoc/Tiptap、严格renderer校验和完整fixture往返已验；DTO补正文媒体refs attachments。完整Entry原信封、独立附件、旧格式和规范unit/layout持久化仍缺，不能完整保存的信封提前只读 |
| contentEditedAt | schema3新增nullable时钟，旧行按原updatedAt一次回填；正文变化推进，标题/标签/分类/置顶保持，显式null保留。不是同步游标 |
| baseRevision | 转成Entry更新revision；必须保留服务器回执，不用本地updatedAt猜版本 |
| categoryId | 本地表ID↔现有category名称的明确映射；改名要同步，不能把UUID直接发为用户分类名 |
| 本机asset mime/路径 | 映到资源type/assetId；下载路径留本机，同资源多occurrence不合并出现身份 |
| TL/IndexedDB消息 | 仅显示缓存。保留sourceId/roomId/messageId/canonical ID映射及原sentAt精度；不上传TL大JSON当正文 |
| 旧SQLite messages表 | UUID/message/body/assetId不是当前Web A随想权威来源，不能当它已与新TL或电脑联通 |
| Java validateBody | 0.10已对齐50,000节点/深度64、正文2,000,000 UTF-16等核实限制；资源/条目ID的本地较窄约束等仍有差异，不能据此宣称所有信封可写。未知body由实际编辑能力校验阻写，不裁剪 |
| Gradle syncEditorAssets | 0.10已原样复制message-units/legacy-time-segments/diary-paragraph-messages/content-preparation/renderer及11模块依赖闭包；APK来源逐字节、WebView同fixture逐对象已核。仅纯算法可用，未打开canonical存储或运行Node/jsdom旧格式转换 |

保留未知原件/字段与“当前编辑器不能写未知节点”并不冲突：完整Entry纯adapter已深克隆保留式合并，当前本地sink不能持久化的完整日期/扩展字段/独立附件会提前只读；尚未实现远端原件Repository/侧车持久化，不冒称已保存。未经明确转换不得裁剪未知body后保存。手机私有库与旧IDB不动；AVD仅经明确schema3迁移，完整Entry和云互通仍待后续。

## 12. 通信、导出和后续同步边界

现存本机API只接受127.0.0.1/localhost，写请求X-Diary-Client:desktop，JSON内容头；Origin须匹配，开启锁后沿现有Cookie。它不是可直接给安卓远程访问的云API；不要为连接手机关闭Host/Origin/访问锁。之后自有服务另设受保护入口，复用业务契约，身份/鉴权不冒用本机协议头。

完整备份含媒体/未知字段等；`/api/export`只给元数据JSON，不含媒体原字节；`/api/open/v1`是白名单只读DTO，不是完整恢复信封；`shiye-revisit-state`仅同源回看状态，不是整库。现有旧WebDAV走一本日记兼容容器，与新自研Android实时同步不同，不能用旧协议降级回写richdoc。通用合并恢复含conversationServices时因未完成ID映射明确拒绝，不悄悄丢实例记录。

未来operationId/基准版本/设备游标/媒体状态与离线队列见[同步路线](SYNC-V2-DESIGN.md)，仍是待实施设计，不假装已有云增量/WS接口。本轮不搬数据、不启用消息存储开关、不改安卓库或云服务。

## 13. 共用验收与维护

合成样本：`tests/fixtures/cross-device-content-v1.json`，不含真实日记，媒体只有虚构元数据。执行：

```powershell
node --test tests/cross-device-content-contract.test.mjs tests/revisit-paragraph-indent.test.mjs tests/diary-paragraph-messages.test.mjs
```

基准覆盖整篇↔units/layout↔原篇、手打北京时间→UTC、段落2秒、同图两处/未知insertedAt按编辑时间、原body缩进保留与气泡去缩进、marks保留，以及大于2^53的聊天字符串身份。它证明电脑当前样本符合契约，**不代替Android实际运行同输入的对照测试**。安卓接入需复用样本并比较输出/时间/身份，随后补媒体上传/引用/撤回/冲突/强杀恢复/网络重试的实际端到端证据。

每次修改正文schema、节点/marks、时间算法、ID/引用、API、能力开关或部署状态，后端更新本文、DATA-MODEL/API/算法专题与交接；安卓更新字段映射/打包模块清单及端侧验收。共同fixture预期变化必须解释兼容策略，不能为通过测试自行重建ID、丢未知字段或改旧样本原文。

本轮缩进修复与运行验证见[2026-10-18验收](validation/2026-10-18-revisit-indent-and-content-contract.md)。

## 2026-10-19 最新离线资料与合流接续要求（未实现）

用户新要求首次导入完全离线立即读写，PC/phone均完整本地客户端、PC暂host。后端owned签名离线v2正在制定：原owner Ed25519签包，native真实验签后显示verified库身份/公钥指纹，用户显式信任独立库、本机pin后active；联网核库/epoch/key，先delta/redactions再幂等outbox。旧首次必须配对/在线resolve路线不能替代此要求；具体API以SHARED-SEED-V1及后端最终v2修订为准，不猜接口或清旧测试资料。

普通消息按真正editedAt较后合流，sentAt不是edit时间；真并发修改过去思绪长文保双版；历史无editedAt且内容不同也保两版冲突。合流算法由后端持有，UI仅真实展示冲突/双版本与离线可编辑状态。当前Android导入UI安全candidate-v2并未实现上述新能力，不作为完整互通或离线启用验收。

### 首次导入票据、身份与保存ACK边界（拟接口，待后端冻结）

`inspectSharedSeedFile(file)` / `inspectSharedSeedNativeTicket(ticket,{nativeRequest})` 拟由后端提供，需逐成员SHA与真实验签后仅返小verified summary（libraryId/epoch/packageId/keyFingerprintSha256/bytesVerified）。UI显式展示并确认指纹，通过后端库选择口选/建相同verified identity runtime；不能自行造身份、从未验证manifest自动bind或要求先配对。再调用既有导入器的拟 `offlineTrust:{explicit:true,keyFingerprintSha256}`，重验全包、事务pin/active后完全离线读写。最终SHA/失败disposition/库选择口未给前不得按此拟名自实现，原SHARED-SEED及ANDROID-SHARED-RUNTIME由后端共同维护。

inspectNative成功UI仍持票；inspect失败/取消负责关闭一次。成功inspect后未交importer的拒绝/返回/选库失败由UI关闭；调用importNativeTicket即全finally责任移交importer，UI按新协议移除安全v2的盲outer重复close，不复制检验器推断handoff。真实关闭数、owner代际及失败disposition须定向验，不能只证明回执被丢弃。

已initialized同库重导不得覆盖权威inbox/known撤回、outbox/draft，即使包水位相同亦不能按feedRevision hash大小/差异推断先后。旧测试库并存保留。联网先核library/epoch/key，接权威delta/redactions后才幂等发送既有outbox；错库/错key不发正文。

本机durable保存ACK与remote同步状态独立。pending代表远端尚未确认，不否定已durable的本机保存；本机成功即可返回/退出，重开保同一operationId及内容。只有用户明确立即同步动作才等待远端ACK；断网/超时不重造op、不丢稿，不把本地projection readback写成服务器新鲜ACK。具体可执行场景见原ANDROID-UI-CONTINUATION的018验收表；新能力均未实现/未验，不属于导入安全v2通过范围。

2026-10-19执行更新：Android导入UI v3已在独立候选采用实际signedoffline61冻结接口（manifest40493424…，bundle e97d4734…）：inspect/明确指纹信任/同verified identity临时runtime及导入后选择激活已隔离接线，11真实模块/fake IDB+4 Java验签host/API36编译通过，仍待独审。完整import事务成功前不覆盖原activation或旧库选择；之后以seed.status+seed.trust核实际库/包/key及initialized/pinned再写选择。config失败保恢复提示，重建同库核持久状态只激活，不重导；native inspect成功仍UI持票、失败按disposition、调用importer即全finally转交，v3移除旧outer盲重复close。此只更新入口实施状态，完整页面/默认rawDiary保存/离线create/原生日记主页面及冲突展示仍未接验。见原[导入回执](validation/2026-10-19-android-shared-import-ui.md)，不把v3候选或数据61未终审视作正式启用。
