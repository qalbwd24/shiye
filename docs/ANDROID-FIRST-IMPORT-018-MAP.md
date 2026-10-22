# Android 首次全量导入：018 数据映射与门槛

2026-10-18后端更新：初始包导出、文件校验/空服务器导入及手机bootstrap→增量衔接协议已完成，实际规范是[PRODUCT-SEED-API](PRODUCT-SEED-API.md)、[合成原包fixture](contracts/product-seed-v1.fixture.json)，根地址仍18789。`.syseed`不是ZIP，magic为14字节；Android只接本机文件流/同库resolve/同一LocalStore安装事务，不调用服务器initialize-empty作本机导入。包带真实checkpoint，包后redactions在发布UI前应用；第一次先pull完整一轮再push，保留本机outbox和壁纸。新产品后端支持收藏可选tags数组，name/note/group/tags共用同一实体。018生产权威/文件入口/原件发布仍须本会话接入与实测，不因后端交付自动切换。

2026-10-18。用户正在考虑首次全量导入，并要求先搞清日记、分类、标签、评论属性、会话头像与表情包元数据。**这不是本轮执行真实全量导入的授权。** 本文只读核对当前源码/开发文档及合成fixture，不读取真实正文，不打包/导入手机库，不迁移日常服务。

入口依据：[Android标准契约](ANDROID-PRODUCT-SYNC-CONTRACT.md)、[产品API](PRODUCT-SYNC-API.md)、[数据模型](DATA-MODEL.md)、[同步接入](SYNC-FRONTEND-CONTRACT.md)、[共享与本机展示](SYNC-DATA-SCOPES.md)、[种子与迁移计划](SERVER-SEED-AND-MIGRATION-PLAN.md)。它们的最新要求优先于旧导入讨论。

## 当前能力不能混写

`ProductRepository` 已能在 LocalStore 同一 SQLite 连接中保真接收完整信封、可信 base、未知字段、canonical、20位字符串ID和墓碑，并同事务推进接收位置；017独立Android SQLite验证通过不等于生产页面已读写该权威。

当前思绪生产编辑仍是旧 LocalStore 支持字段写口；独立 QQ 聊天的 `legacy-source.js` 继续适配既有 TL/IDB worker/actions。QQ 独立渲染改造不执行存储迁移，也不把产品收件抄到另一套消息权威。首次接收、已有资料并库、旧UI切换和媒体离线齐备是分别需要验收的步骤。

当前冻结worker的GetHistory实际返回整房消息，global.byId持有完整已加载历史，不能把Telegram的40/80条viewport窗口误当数据已截断。独立source现先投影末80条，`hasOlder/loadOlder`每次向前展开80条；同房新消息保留首可见ID、继续接到尾端，切房重置。240条合成历史的80→160→240与ID不变已定向验证；这是既有owner完整缓存上的只读窗口，未来真实产品后端分页必须由对应Adapter接opaque cursor，不复用此本机窗口冒充服务端分页。

首次资料可按已确认方向由电脑经USB预置独立资料包，App自动导入；APK与私密包分开，不要求用户解压/分类或手工搬头像图片。**包规范与后端导出器已交付，App自动导入入口尚未交付**；不能把已有 `shiye-bundle`/普通ZIP或任意JSON直接当作新的`.syseed`种子包。

## 字段与页面映射

下表“保真接收”指完整信封可存入产品Repository，不表示当前已有对应编辑控件或业务调度。

| 内容             | 既定对象/身份/字段                                                                                                                    | 当前保真接收                                | 当前UI与必须补的映射                                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 日记身份与元数据 | `journalAggregate/entityId=Entry.id`；title/date/category/tags、createdAt/updatedAt/contentEditedAt、业务revision、状态及未知扩展     | 可；完整ISO与显式null不截成日期或补当前时间 | 旧LocalStore生产DTO只接有限本地字段，日期为YYYY-MM-DD；完整时刻/未知字段不能经旧saveEntry重建覆盖                                         |
| 图文/规范单元    | richdoc format/version、body；`messageUnits.authority`，`_canonical.units/layout`；blockId/occurrenceId/原顺序                        | 可；canonical与正文在一个信封中             | 既有共享rich editor可渲染已支持节点；messageStore权威仍只读保护。必须接共享prepareProductEntry/previousRecord/units/layout后才开放写入    |
| 旧内容与追溯     | HTML/Markdown、独立attachments、history、legacy.original及未知字段                                                                    | 兼容产品接口目前可保留，不能擅自删          | 正式日常同步目标为统一新版结构；旧原件留兼容导入/追溯层。旧HTML需独立转换/复核与安全只读阅读；套_product外壳不等于已转换新版              |
| 日记状态/属性    | pinned/deleted/hidden/draft/demo；mood/weather/location等已有字段                                                                     | 可；未显示的字段仍保留                      | 列表筛选与详情展示需逐项映射；隐藏/删除不等于永久丢弃；属性修改不推进正文时钟或重建消息ID                                                 |
| 分类             | `taxonomy(kind=category)`稳定entityId、name；Entry `_product.refs.category`                                                           | 可                                          | SQLite categoryId必须持久映射到taxonomy ID；改名改名称对象，不按新名称生成新身份。顶层分类即使暂无篇目也保留                              |
| 标签             | `taxonomy(kind=tag)`、Entry `_product.refs.tags`稳定ID数组                                                                            | 可                                          | 现有文本标签输入不能替代稳定ID关系；独立未被引用标签也保留，改名不重写正文/时间/评论关联                                                  |
| 分类/标签顺序    | `order`，kind及有序ids                                                                                                                | 可                                          | UI按order及合法补全项展示；不能把排序当正文修改，不能按标题/中文排序覆盖用户顺序                                                          |
| 普通日记评论     | Entry完整comments：id/body/authorName/authorAvatarId、createdAt/updatedAt/revision/deleted、replyTo/replyPreview、attachments等原字段 | 随Entry完整保留                             | 当前安卓详情/评论编辑与来源定位尚需适配，不能因为新QQ输入框可用就把旧评论自动转成今日消息                                                 |
| 朝花夕拾评论     | `comment`信封、operationId、完整目标/SourceRef、replyTo/commentOn；batchId/deliveryId/occurrenceId                                    | 可保留现有对象                              | 与Entry.comments不是同一份可任意互抄的正文。默认回复最近历史单条须固定deliveryId；显式整组仅batchId。按篇汇总/媒体定位/撤回由业务接口处理 |
| 普通聊天         | `chatMessage`，`productMessageId(sourceId,roomId,messageId)`；text、sentAt、attachments、replyTo                                      | 可；20位message/reply ID始终TEXT/string     | QQ当前legacy源仍读本地TL数字ID；不能用Number强塞20位ID。产品消息→独立UI需显式映射，发送/撤回走业务命令及同事务本地权威                    |
| 聊天归篇         | 原Entry.id与只读消息引用；`_product.refs.messages/conversation`                                                                       | 可                                          | 长文入口只读。不得再存一份可编辑聊天正文到Entry.content/history/canonical缓存；阅读按当前消息投影，撤回不复活旧正文                       |
| 会话             | `conversation`，`productConversationId(sourceId,roomId)`；原来源、title/category/idleHours/configuration                              | 可                                          | TL本地房号/标题不能当跨端身份；会话选择、归档/置顶/草稿等先明确共用范围与映射，不能导入后按标题合并                                       |
| 会话识别图/头像  | `avatarAssetId`及refs.assets；兼容电脑会话用图字段                                                                                    | 可保留字段和资源引用                        | 用户希望电脑会话用图在安卓可作头像；旧wallpaper字段→头像角色尚无正式迁移schema，须明确映射后应用，不能偷偷改原字段                        |
| 安卓壁纸         | Android本机appearance、布局/铺图偏好                                                                                                  | 资源可保留；应用行为本机独立                | 首次导入/电脑刷新不能覆盖安卓当前壁纸。安卓换壁纸也不回写电脑背景；素材存在不等于应用同一显示角色                                         |
| 表情收藏         | `sticker`稳定id，mediaId、name/note/group、创建/修改/删除状态与未知字段                                                               | 可；fixture已含note和未来扩展字段           | 当前014收藏scope/本地素材ID须保留式映射到产品收藏，不按名称/URL重建ID。名称/备注/分组必须可展示/编辑并跨端沿同ID更新                      |
| 表情多标签       | 用户要求两端一致；现接口主要name/note/group                                                                                           | 接收未知字段可保留                          | 共用多标签字段/标签ID及后端校验全链路尚未实现；不得只在安卓localStorage新增tags就宣称已同步                                               |
| 资料/头像配置    | `profile`与业务头像assetId，独立作者快照/身份                                                                                         | 支持完整保真对象                            | seed仅对显式extras生成profile等对象，不会自动抓齐散落浏览器资料；需列出资料来源/角色并逐项接UI，不混淆历史评论作者快照                    |
| 外观/命令映射    | appearance、commandMapping及声明为共用的业务属性                                                                                      | 可保留完整对象                              | 不自动应用电脑窗口/快捷键/DPI；跨端只共享已确定范围。本机候选排序/频次/行数暂不自动同步                                                   |
| 媒体             | `relation(kind=media)`业务元数据＋独立asset原件；id/hash/size/MIME/name                                                               | 元数据可先到；原件任务独立                  | 正文、头像、收藏引用同asset；同资源多处出现保留各occurrence。未下载显示等待，不用缩略图假装离线原件齐备                                   |
| 服务配置/收件    | serviceConfig、delivery索引、固定feed.after/next                                                                                      | 可保留，但只接受服务业务写口改变            | sync cursor不是feed序号；delivery索引不保证携带完整可渲染来源。当前产品catalog一个库级流，不因导入binding就宣布创建了多实例               |

尚未有产品实体种类或明确导出规则的模板、导入原包、未知顶层资料，必须在种子清单中明确“保留/追溯/待适配”，不能从“完整Entry已保留”推断“完整库所有顶层资料已转换”。`planLegacyProductImport`实际生成分类/标签/顺序、媒体、chatJournal会话、日记/消息、收藏与筛选后的appearance；profile/commandMapping等需显式extras，revisit运行数据另由service导入。此事实不授权运行真实seed。

## 首次接收/导入应怎样提交

1. **先固定目标与身份。** 分清首次新库种子、已配对同库离线快照包、旧Android本地资料并入、已用服务搬家。manifest记录显式模式、版本、稳定来源、库libraryId/epoch与能力。地址可换，同库身份不能随意换；18779与18789也不能混token/游标。
2. **旧资料保留式清点。** 保留原TL/SQLite/草稿/媒体/profile备份，建立旧ID→业务ID/taxonomy/会话/TL投影ID映射；不把原本local-only对象伪装成可信remote base。发现已有未发队列保留，不清库重试，不仅凭同名分类/同名会话去重。
3. **私有staging验证。** 安全路径、包版本、成员大小/hash、重复ID、媒体元数据与原件、引用可达性、状态/墓碑、canonical重组、未知字段逐项核对；失败保留原包/旧库。不将几千篇正文塞进一个WebMessage或一次UI事件。
4. **事务导入。** 已验证整页/批次的完整信封、base、映射、冲突、资源任务和接收位置同事务提交；崩溃可从最后完整checkpoint续跑。不能先更新cursor再异步写body，也不能先写TL后抄Repository称原子。整包原子发布/分阶段切换策略须由尚待实现的包协议明确，不能把普通分页接收等同完整导入完成。
5. **原件验证发布。** 大原件流式写私有暂存，按hash/大小验证后原子发布；可复用已验证同asset/hash文件，不重压缩GIF/视频。大Entry使用既有payload引用/hydrate校验，未齐不可用空body覆盖。媒体业务元数据与asset原件分别确认。
6. **选择何时切换UI权威。** 收件区完整持久与原件状态可独立显示；只有旧映射/未发资料与原件/回滚方案验证通过后，才让日记/QQ使用新的单一Repository。旧TL reader的版本、冷启动恢复及draft owner需专项验收。不能让两个仍可编辑正文长期双写。
7. **联网接续。** 只有与服务一致快照产生的真实checkpoint才能接pull；任意导出时间不能作cursor。USB包不含配对token/密码/服务器签名密钥；联网由当前设备自行配对并核同库。watch只是通知，不推进接收位置。

## 需要明确展示和验证的完成状态

分别展示“结构已接收”“原件待下载/已验证”“既有本地资料待并入”“页面已映射/只读”“本地已保存/待上传”“服务器已确认/冲突”。不以HTTP200或导入条数相等冒充“所有照片和评论已可离线使用”。

首次小合成包至少包含：完整时刻日记、canonical与重复图片出现、独立附件/空白/样式、分类标签改名与排序、置顶/隐藏/删除、普通评论及作者头像、固定单条/整组/媒体评论、20位消息引用及墓碑、会话头像/本机壁纸隔离、GIF收藏名称/备注/分组、未知字段/未知实体、待取payload/缺原件。故意损坏hash、中断两次、重复导入、错误库/epoch、已有未发编辑与丢ACK都必须保留资料并给可恢复状态。

表情包细节应实际走：收藏输入名称/备注/分组→关开面板/冷启动回读→同ID改名/清空备注→同资源重复收藏不覆盖旧元数据→删除/恢复不生成新身份→按名称搜索发送原GIF→发送后原名/备注/字节/原消息时间不变。旧API note最多2000个UTF-16码元、name沿用250字符，新收藏原件64MiB限制与sync原件512MiB不是同一上限；各端按实际catalog能力显示限制，不借导入静默删超限旧收藏。

## 本轮证据和未做事项

草稿权威边界追加：实际QA发现独立输入保存后，隐藏Telegram composer仍可能经后台/卸载/切房的旧`useDraft`自动保存入口写回陈旧快照。冻结`useConnectionStatus-Dy1kHT8L.js`中`wm`的统一`p`入口覆盖上述路径及`shiye-flush-draft`；两条`ts`排队保存回调也必须在执行时重新检查独立编辑器的永久owner标记。不能仅按当前会话页active门控，不能仅阻止一个DOM flush事件。新source直接调用真实`actions.saveDraft/clearDraft`，应继续保留；只读draft cache修复不能代替关闭旧写口。此次门控的stage/实际重启回读由主会话验收，本文不据静态审计宣称已解决真实冷启动。

核对的golden为 `docs/contracts/android-product-sync-v1.fixture.json`，仅合成数据；包含canonical Entry、category/tag/order、conversation配置/头像资源引用、media、sticker note/未知扩展、超long消息ID和单条/整组/媒体评论请求。它是DTO样本，不是完整媒体备份或手机种子包。

本轮仅核对上述结构及当前源码，未枚举真实库数量/真实正文，未生成实际种子包、未上传个人资料、未导入手机、未承诺所有页面已映射。独立QQsource定向mock证据在 `outputs/2026-10-18-android-qq-018/source/`；测试临时目录 `tmp/android-qq-018/source/`。真实UI/收藏命名及介面端到端由主会话018验收记录；首次真正导入需另有明确任务与完成上述门槛。
