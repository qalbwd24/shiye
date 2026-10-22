# Android 018 内容与后端接入只读审计

2026-10-18。本审计供 018 需求确认和实施排序使用。只读取工作区源码与文档；未修改 Android 源码、设备、正式数据或服务配置，未执行真实资料导入。当前手机/主 AVD 正常包是 016/code18；017/code19 product preview 是已隔离验证、未部署的候选；018 独立 QQ renderer 使用 `android/qq-chat/legacy-source.js` 对接旧 TL/IDB worker，仍以旧 owner 的保存与真实 ACK 为过渡。QQ 仅规定聊天窗口、视觉和交互，不重新定义正文、时间、富文本或资源身份。

## 实际就绪边界

- 18789 的 `var/product-sync-lab` 是独立合成产品库，不是日常日记权威。`src/server/sync-product/service.mjs` 的 features 现含 `seed:1`、`stickerTags:1`，catalog 返回 `.syseed` 入口与收藏标签能力；`seed-service.mjs` 已实现导出任务、Range 下载、resolve、空服务器缺块上传及提交。已通过的后端隔离验收见 `docs/validation/2026-10-18-product-seed.md`。因此“后端还没有种子协议/标签校验”是过时说法。
- 产品服务的固定业务端口已存在：`api/product/v1/{catalog,library,chat/room,chat/send,chat/withdraw,revisit...}`；增量、认证、冲突、原件走 `api/sync/v1/*`。catalog 是一个库级朝花夕拾入口，不等于生产会话多实例已在新产品流中绑定。旧日常 API 的 `api/conversation-services/*` 已有多实例后端，但不能把其旧库状态或 token/cursor 直接套进 18789 产品库。
- `android/app/.../AndroidSyncTransport.java` 固定实现 product/sync 接口、库身份验证和原件分块；`ProductRepository.java` 与 `LocalStore.java` schema4 在同一 SQLite 实例保留完整信封、remote base、本地 intent/命令、身份映射和整页 cursor 事务；`android/product-adapter/product-content.js` 直接导出 `public/shared/sync-product.js`，没有 Android 私造的时间切分。其实际候选验证见 `docs/validation/2026-10-18-android-product-017.md`。这些代码可复用，但尚未把 018 消息、思绪生产编辑、UI 收件切为单一权威。
- 日常桌面保存到产品库的持续增量登记、手机 `.syseed` 文件入口与同库安装事务、018 生产 owner/草稿/媒体映射、端到端离线往返、朝花夕拾完整 UI 均未交付。不能把“接口可达”“收到了完整信封”写成完整同步或全端统一。

## 对象、真实 API 与接入差额

| 范围 | 权威对象与实际端口 | 017 可复用能力 | 018 当前缺口与不丢数据的规则 |
| --- | --- | --- | --- |
| 日记与属性 | `journalAggregate/entityId=Entry.id` 的完整 `data`、`_product.refs`；分类/标签是独立 `taxonomy`，排序是 `order`。增量 `api/sync/v1/{snapshot,pull,push}`；兼容检查 `GET api/product/v1/library` | Repository 保留完整信封、未知字段、base、局部编辑意图和 cursor；共享 `prepareProductEntry` | 旧思绪 `LocalStore` 生产 DTO/页面仍是旧写口。列表和编辑器须映射稳定 category/tag ID、日期与完整 ISO 时刻、状态、独立普通 `Entry.comments`、未知字段；不能从精简 UI DTO 重建信封，也不能按名称造新 taxonomy 身份 |
| 富正文与规范消息 | `Entry.body` 为 `shiye-richdoc` v1；已启用时 `messageUnits.authority='messageStore'`，`_canonical.units/layout` 与正文同信封。`public/shared/{rich-document,message-units,content-preparation,sync-product}.js` | `android/product-adapter/product-content.js` 直连共享算法；017 WebView 合成对象往返已验 | 018 QQ 文本气泡只是聊天呈现；长日记沿桌面思绪 Tiptap/richdoc 的阅读与编辑规则。保留段落、marks、真实 Tab 缩进、块/行内图视频、blockId/occurrenceId；不支持的旧 HTML/节点须完整只读或拒写，不能用 Markdown 投影回存覆盖富文档。canonical 与兼容投影不能各自独立编辑 |
| 时间与身份 | `eventTime.instant/timeZone/precision/source/sourceField`；手打标记、段落拆分、旧附件兜底由共享算法；`sentAt` UTC 原值保留 | 共用 content adapter 与 Java 字符串 ID 校验 | 不以今日、服务器 ACK、文件导入、EXIF 代替原手打/内容编辑时间；显式 null 和未知时间保持。`sourceId` UUID、`roomId/messageId/replyTo` 十进制字符串（可达20位），不得经 JS Number/Java double。QQ 隐藏逐条时间仅为展示选择 |
| 普通聊天、回复与撤回 | `chatMessage`，ID 为 `chat:SHA256(JSON([sourceId,roomId,messageId]))`；业务写口 `POST api/product/v1/chat/{room,send,withdraw}`；普通归篇只存引用，正文权威在消息 | 固定 transport、Repository 本地命令同事务排队和迟到 ACK 防护 | `legacy-source.js` 仍投影旧 owner 的整房历史（每次视窗展开80条）、草稿与发送；没有产品消息生产映射。旧 TL ID/IDB、产品 20 位 ID 与引用建立稳定对照后才切读写；草稿、发送、撤回与同事务 outbox 要同一个权威。现有 chat/send 只接 Markdown text/附件，不支持任意富 `body` 上传；需要保留式协议时单独实现，不能把富文本降成纯字串后声称无损 |
| 普通评论与朝花评论 | `Entry.comments` 随完整 Entry 保留；朝花为独立 `comment` 信封/业务命令，固定 `batchId`、可选 `deliveryId/occurrenceId`、`SourceRef`、`replyTo/commentOn`。产品 `api/product/v1/revisit/{feed,comments/context,comments,comments/withdraw,source}` | transport 已有固定路由，Repository 可保留 comment 信封和命令 | 默认回复最近历史**单条**必须传 deliveryId；显式整组才只传 batchId。评论目标在打开输入/排队时冻结，新来信或切房不改目标。普通日记评论与朝花评论不可互抄；来源 `SourceRef={entryId,unitId,snapshot?}` 不从气泡 Markdown 重新计算 |
| 媒体原件与出现 | `relation(kind=media)` 是业务元数据，`assetId/hash/size/MIME` 指原件；`api/sync/v1/media/*` 为受保护、Range/分块原件接口。正文每次出现有独立 `occurrenceId/insertedAt` | transport/原件下载 runner 有分块、续传、SHA、私有发布候选 | 018 独立图片/GIF/视频/文件查看须在 UI 引用稳定 asset，而非缩略图或 Blob URL 充原件；同 asset 多次出现不合并 occurrence。原件待取时明确状态，下载 hash 验证后才称离线可用；上传业务 media 元数据和原件分别确认 |
| 表情收藏 | 旧正式 API0.9.25：`GET /api/stickers/catalog`、`POST /api/stickers/from-message`、`POST /api/stickers`、`PUT /api/stickers/:id`，原字节 `/media/:id`。产品库 `sticker/entityId=原收藏ID` 同一信封增量，`name/note/group/tags/mediaId/deleted` | 原有 014 收藏传输及 017 信封可作接缝；产品后端 `stickerTags=1` 已校验可选 tags | 旧本地素材先保留原件并映射旧 ID↔稳定收藏 ID；不能用名称、Blob URL、TL 临时 ID 去重。电脑/安卓同一收藏 ID 共用名称、备注、分组、标签；旧日常标签完整 UI 链路尚未接。面板发原 GIF，缩略图仅预览。安卓本机壁纸不被 seed 或电脑会话用图覆盖；电脑会话用图可映为头像 |
| 首次种子、增量与设备 | `.syseed` 是独立 APK 的流式文件；`api/product/v1/seed/{exports,resolve,...}`；配对/身份/snapshot/pull/push 在 `api/sync/v1/*`。同库必须核 `libraryId/epoch` | transport/Repository 可作身份、事务收件基础 | 手机文件选择、逐成员 hash/长度校验、同库 resolve、单一 LocalStore 安装、包后墓碑、真实 checkpoint 接续尚缺。先 pull 完整一轮再 push，保留已有本机 outbox、原件、本机壁纸；不能用服务器 `initialize-empty` 冒充手机安装。USB 全量真实包/导入不在本次授权内 |
| 朝花服务与会话 | 18789 产品 catalog 当前一个库级 revisit；旧正式 `/api/conversation-services` 有实例/binding/request 与独立游标。产品 `revisit/feed.after` 是投递序号，sync cursor 是另一套 | product transport 有 status/feed/context/comment/source；旧后端多实例协议已有明确身份 | 018 应先把单实例 feed/SourceRef/评论完成，再为新产品会话绑定订明确协议；不能把旧 `configuration.backend` 当已建实例。旧单例收件和评论须保留，不能重发或改归属 |

## 最小安全实施顺序与门槛

1. **冻结需求和样本**：确认 QQ 仅聊天窗口/动作；长文沿桌面思绪的 richdoc 与阅读核，Markdown 仅聊天写口或兼容投影。以 `docs/contracts/android-product-sync-v1.fixture.json`、`docs/contracts/product-seed-v1.fixture.json` 和跨端时间样本作同对象往返标准；明确旧 HTML、普通评论、未知顶层资料的只读/导入规则。
2. **先接唯一本机权威**：对 016 旧库/草稿/原件做保留式映射，017 Repository 接 018 source 与思绪编辑。生产发送、草稿、撤回、Entry 保存必须与 intent/命令同一 SQLite 事务提交；旧 TL reader 在切换后只能兼容读，不能继续后台覆盖新草稿。保留冷启动/强杀/迟到 ACK 可恢复状态。
3. **再接资源与富正文**：共享 prepare/validate、完整信封与 canonical 一致校验；原件私有下载、hash/size/类型核对及待取显示。实际长文多段、缩进、marks、行内重复媒体、旧 HTML 与评论关联全量保真后开放编辑。普通聊天 richdoc 上传若超出当前 `chat/send` 文字能力，先保持已有受支持写口并明确 UI 能力限制。
4. **接种子入口与日常增量**：先合成包断点/重试/错库/墓碑/已有本机未发资料验，再让用户执行真实 USB 全量导入；电脑日常保存持续登记是双端同步前置门槛。首轮包后 pull 完整再 push，业务依赖顺序为 taxonomy/会话/媒体→消息与评论命令→收件；原件状态单独显示。
5. **最后按业务发布**：真机及主 AVD 保留数据升级验证；实际 18789 身份/服务可达、离线编辑双端往返与冲突、20 位 ID、草稿/引用/撤回、冷启、GIF 原件和安卓本机壁纸保护。朝花需 feed、固定单条/整组/媒体评论、来源失效与旧单例兼容。只有生产页面读写同一 Repository、正式日常源增量运行且回执/原件/冲突可解释时，才能称“完整同步已交付”。

## 需求决策建议交给主任务确认

应把 018 需求文本明确写为：“QQ 是聊天窗口和交互参考；日记的 richdoc/Tiptap 结构、桌面共用内容与时间算法、稳定 ID、评论来源和媒体原件协议保持为产品契约。” 发布可以分级：先独立 QQ 的真实数据/草稿稳定性，再接 017 产品权威与本机完整保存，最后启用 USB 首次导入和持续同步。每级应标出未接通能力，不能用新版视觉覆盖数据迁移缺口。真实全量导入另需明确任务授权。

依据：`docs/DEVELOPMENT-HANDOFF.md`、`docs/DESKTOP-ANDROID-CONTENT-CONTRACT.md`、`docs/ANDROID-PRODUCT-SYNC-CONTRACT.md`、`docs/PRODUCT-SYNC-API.md`、`docs/PRODUCT-SEED-API.md`、`docs/SERVER-SEED-AND-MIGRATION-PLAN.md`、`docs/SYNC-DATA-SCOPES.md`、`docs/STICKER-BACKEND-API.md`、`docs/CONVERSATION-SERVICES-API.md`、`docs/ANDROID-FIRST-IMPORT-018-MAP.md`、`docs/ANDROID-PRODUCT-017-IMPLEMENTATION.md` 及本文点名源码。本文没有进行带凭据的实时产品 catalog/info 请求；运行服务能力以正式接线前重新读取的 health/info/catalog 为准。
