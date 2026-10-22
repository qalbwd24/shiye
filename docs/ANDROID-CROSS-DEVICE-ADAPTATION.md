# Android 跨设备数据适配边界

2026-10-18 Android接入增量：手机0.11只用于UI手测；电脑/AVD0.12候选新增INTERNET与原生固定服务发现/status客户端，WebView联网拦截保留。只读目录快照不代替完整本地资料，未实现云同步/身份迁移/绑定或自动收件；最新后端仍按实际health能力与路由，不按package0.9.25猜已上线。见[接入与后续](ANDROID-SERVER-CONNECTION-012.md)及[实际验收](validation/2026-10-18-android-service-adaptation.md)，下方无联网权限等为先前0.11及更早阶段。


2026-10-18用户明确：安卓手机长期完整保存本地数据/文件，云端只负责与电脑同步；离线可写改读，本地保存ACK与同步状态分开。本地事务＋outbox、完整Entry/消息/原件/未知字段保留为后续框架约束，当前SQLite/私有媒体/TL IDB继续保留，不以未来缓存定位删除旧库。完整新Repository/可靠同步尚未实现。见[本地优先存储](ANDROID-LOCAL-FIRST-STORAGE.md)。本次为需求/架构记录，不改设备数据。

2026-10-18 回看气泡残留缩进已仅在展示层修复：按diary顶层段落去Unicode段首空白，marks前处理，代码/嵌套结构/聊天及原body/ID/时间/评论保持。13定向＋12实际隔离前端及2共用fixture测试通过；API0.9.24 paragraphIndentation=1已重启，标准恢复ui28原生ready、116%/2屏。冷解析曾timeout后沿原游标自动重试成功；3014旧篇/源字段与11737安装hash保持。用户明确要求安卓复用电脑格式/算法，新增[实际内容契约](DESKTOP-ANDROID-CONTENT-CONTRACT.md)及合成fixture，写清canonical正式开关仍false、只读投影/现有聊天写口和Android差距，不冒称已全端统一。见[验收](validation/2026-10-18-revisit-indent-and-content-contract.md)，产物outputs/revisit-paragraph-indent，临时tmp/revisit-paragraph-indent。

2026-10-17用户再次强调算法/写入格式统一。0.7已完成当前标题/richdoc范围的空白新建规则对照、继续共用编辑/时间戳，但规范MessageUnit切分重组、完整Entry/附件及双本地聊天存储适配仍未接齐。不得用“对齐约束”冒充完成；后续共享模块、同输入往返和迁移边界见[统一接入顺序](ANDROID-DATA-UNIFICATION-PLAN.md)。手机0.6真实内容未迁移。

2026-10-17：用户确认手机、电脑以后互通。本轮先优化 Android 页面，现有内容与接口保持可适配；不把样式优化扩成云传输、认证、数据迁移或全套同步实施。本文根据源码只读核对，不表示手机已联网同步。近期同步职责以 [SYNC-V2-DESIGN](SYNC-V2-DESIGN.md) 为准：客户端先保存本地，同步异步处理；服务器负责同步与持久存储，AI/提醒及云端朝花夕拾后议。

## 契约来源与维护顺序

| 入口                                                                  | 用途                                                                         |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| [ANDROID-FRONTEND-DATA-ALIGNMENT](ANDROID-FRONTEND-DATA-ALIGNMENT.md) | Android 实际存储、桥与桌面现有读写口的字段映射                               |
| [DATA-MODEL](DATA-MODEL.md)                                           | 唯一正文、原件保护、媒体身份、版本及历史数据边界                             |
| [MESSAGE-UNITS-IMPLEMENTATION](MESSAGE-UNITS-IMPLEMENTATION.md)       | 实际 MessageUnit、时间来源、规范 ID、撤回和 Entry 保存语义                   |
| [SYNC-V2-DESIGN](SYNC-V2-DESIGN.md)                                   | 之后两端本地优先、队列、变更序号和媒体同步的设计，尚非已开放 API             |
| [CONVERSATION-BACKEND-CONTRACT](CONVERSATION-BACKEND-CONTRACT.md)     | 会话后端实例/绑定的职责与身份；跨设备不能只按本机房间号路由                  |
| [CONVERSATION-SERVICES-API](CONVERSATION-SERVICES-API.md)             | 已部署的本机会话后端 v1 实际端点、实例作用域、版本与错误码；Android 尚未接入 |

后续改接口时同时核对相应路由与调用方，再更新对齐表；示例字段不替代实际接口。实施、隔离验证、安装和正式启用分别记录。桌面文档正在并行更新，不能只凭旧日期/版本号判断能力；需要实际能力响应和相应版本/hash。本文本轮只维护本文件，不覆盖并行共享文档。

## 已实现、可继续复用

- Android Gradle `syncEditorAssets` 复制共享 rich-document、rich-body-adapter 及时间模块；不在 APK 副本维护另一种正文格式。
- 长文保存完整 `shiye-richdoc` v1；Java 校验拒绝未知字段/节点、重复 blockId/occurrenceId 和无效媒体引用。editor 对未知格式或无法无损装载的内容阻止编辑保存，不转纯文本覆盖。
- 图片/视频按 body 内的 `assetId` 引用原件，每次出现另有 `blockId/occurrenceId/insertedAt`；历史未知插入时间允许 null，宽度/对齐/图注不替代身份。
- 本地长文保存使用 `baseRevision`；失败保留页面输入。正文 JSON 比较忽略对象键序、保留数组次序与字符串空白；分类/标签调整不把正文 updatedAt 推到现在。
- 外观与本机置顶偏好独立于正文；媒体附件网格是正文投影，不能另立一份可编辑权威附件正文。

上述为代码路径核对，不重复宣布既有真机/AVD回归，也不证明当前运行包含有每一项源码变动。

## 桌面并行更新：会话后端 v1 已部署，Android 未接入

本轮追加重读 CHANGELOG、最新会话设计/实际API及[后端验收](validation/2026-10-17-conversation-services.md)：后端独立实例、绑定与运行器已实现并部署，不能再笼统写“多实例后端尚待实现”。该验收记录2026-10-18T02:47:36Z的正式后台0.9.24能力为 `health.conversationServices={version:1,providers:['revisit'],isolatedInstances:true,autoStart:true}`。这是引用该次回执，不是本轮再次访问正式API；版本0.9.24单独不能证明具备此能力。

实际现有端点为 GET `/api/conversation-services`、POST `/api/conversation-services/instances`、PUT `/api/conversation-services/bindings`、POST `/api/conversation-services/request`，以及按篇评论聚合 GET `/api/conversation-services/comments?entryId=...`。固定request提交 `{instanceId,action,payload}`；payload即使无参数也为对象。只有 `revisit` 已实际可用；这些是已有本机业务接口，不是云端同步/设备认证入口。

交付前再次核对实际API已有历史日期范围 `sourceDateFrom/sourceDateTo`：按实例时区的来源消息日期过滤、包含两端；null清除，省略保留，不能将空白直接发空字符串。改变范围推进ruleRevision但保留旧投递/评论。未来安卓表单须读取服务configuration的实际能力，不能把日期范围与时区选择混为一个开关；本轮没有接入该表单或改当前规则。

Android之后接入应直接遵循以下实际协议，不自行重拟：

- `providerId`表示服务类型，调用方生成并保留UUID `instanceId`；同创建参数重试使用原ID，不重置后续进度。每会话绑定一个实例，每实例最多一个活动会话；多个会话选择同类服务时使用不同实例。
- `bindingId`独立稳定，`conversationId`带来源命名空间；桌面临时使用 `desktop:<shiyeJournal sourceId>:<roomId>`，跨设备规范会话UUID仍需后续同步接入统一。不得由Android拿裸TL房间号、标题或分类名冒充该会话身份。
- 新建绑定 `expectedRevision=0`，后续使用当前绑定revision；配置动作使用该实例自己的config.revision，两者不能混用。解除沿用原bindingId/conversationId和最新版本，提交 `instanceId:null`，历史实例和原消息关系保留。
- 响应 `scope={instanceId,providerId,bindingId,bindingRevision}`须进入业务映射；feed的sequence/游标按实例保存。消息、草稿、引用、ack/outbox及撤回保留原instanceId及deliveryId/batchId，切换绑定不重定向旧评论；普通UI不能把所有实例消息写入固定系统房。
- `db.conversationServices`只在显式创建/绑定时初始化；旧单例 `db.revisit`、`/api/revisit`与固定房保持兼容，不自动迁移。未绑定实例不自动推送；只有活动且启用实例自动恢复。

当前桌面会话选择UI、worker与原生固定桥仍未接入这些新接口，Android也未接入；后端验收通过不代表两端已能选后端或跨设备同步。后续Android只接固定业务动作，不因已有本机端点而开放任意网络请求。带conversationServices的通用备份合并恢复当前明确422拒绝，实例/来源ID重映射未完成，不能声称此状态已可跨设备导入往返。

## 已确认的真实接缝与最小处理

| 接缝           | 实际代码与风险                                                                                                                                                                                                      | 之后接入所需最小处理                                                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Entry 完整信封 | `LocalStore.entry/saveEntry` 只读写本机列；没有桌面 Entry 的 attachments、contentEditedAt、chatJournal 等完整信封。把接口响应直接塞进现有表再重建 PUT 会漏掉元数据；桌面保存还要求完整 attachments 并校验正文内引用 | 保留原始 Entry/版本与未知字段；保存命令从当前原件合并明确修改项。正文内媒体引用映射到正式资源 ID，保留独立附件；不能只导出当前 UI 表单字段       |
| 日期与时区     | 本机 `date` 仅 YYYY-MM-DD，Java 保存用 LocalDate 严格校验；桌面 Entry.date 可含完整可解析时刻。editor 当前显示默认北京时间，未接入库的自定义时区                                                                    | 显示日期与原始 Entry.date 分开保存，未修改日期时原样回传完整值；明确修改日历日期时按共享时区规则处理，不能偷偷截断时刻。显示默认值不写成来源时间 |
| 元数据能力范围 | Android 标题上限300、标签32个/每个80；当前桌面标题500、标签50个/每个小于100。有效桌面篇不保证能从当前安卓表单保存                                                                                                   | 接入时对已有超限值提供只读/保留原值路径，再统一明确能力；禁止为通过本机校验裁剪标题或标签                                                        |
| 分类与版本     | 本机 categoryId 指本机分类 UUID，桌面 category 是名称；本机 baseRevision 和桌面 PUT revision 不是同名请求。当前本机 revision 是本地保存次数                                                                         | 明确分类映射与未分类语义；服务端基准版本独立于离线本地编辑计数。冲突保留双方，不把本地较大数字当服务端版本或无条件重试                           |
| 随想权威来源   | 当前 Web A 使用 IndexedDB TL 模型；SQLite 旧 messages 是另一套本机内容。Android 打包排除桌面 shiye-journal.js，尚无当前 Web A→统一数据服务写入链                                                                    | 在现有业务/桥边界接命令和确认，不把 TL 或旧 SQLite 表直接当 MessageUnit。保留原来源三元组及 canonical ID 映射，不因重开、切页或同步重新编号      |
| 时间保真       | TL date 为秒级显示时间；MessageUnit.eventTime 含原 instant、precision、source、sourceField，媒体 insertedAt 另有语义                                                                                                | 规范时间在业务映射中原样保留，TL 秒数只供显示。未知来源不补造 UTC/毫秒精度；本机保存、发送、接收和媒体入库时刻不得互换                           |
| 媒体可用性     | Java 校验当前要求媒体已在本机 assets 且 MIME匹配；Web A documents 与日记 assets 也不共用一个公开资源表                                                                                                              | 后续区分资源身份/元数据与字节是否已下载。缺字节显示占位并保留引用，不据此清空 body；同步成功前完成正式媒体映射和原件 hash/大小确认               |
| 回执与撤回     | 本机消息状态不等于服务端确认；现有桌面消息接口禁止 PUT 覆盖原消息，撤回墓碑先于延迟上传                                                                                                                             | 保留 operationId、原消息来源与版本；明确本地已保存/待上传/已确认，撤回重试不能复活原文，编辑按明确撤回/新号重发语义处理                          |

这些差距会阻断直接接入，当前没有将该链路开放，因此没有证据表明正在发生跨设备丢失。为本轮样式修改新增空 Repository、未使用接口或提前迁移表结构不能消除上述差距。

## 现有接口与本轮不应混用的入口

长文继续沿 `POST /api/entries`、`PUT /api/entries/:id` 的完整 Entry 命令；统一消息读口和聊天写口见数据对齐文档。旧篇兼容阅读使用 `GET /api/entries/:id/reading-document`，绑定 source.id/revision，投影不可自动保存回原件。

现有 `src/server/routes/sync.mjs` 的 `/api/sync` 是旧 WebDAV diary.json 兼容入口；`legacy-webdav.mjs:toDiarySource` 对可上传 richdoc 明确返回409，不能把该口称作本项目新 Android 的无损同步。现有本机 HTTP 访问限制也不代表已具备远程传输和设备认证；本轮不更改网络配置。

## 本轮样式改动应守住的最少回归

1. 用合成篇保存/重开：正文、空白、块序、blockId 不变；同一资源重复出现保持两个 occurrenceId，原 insertedAt（含 null）不变。
2. 阅读/编辑模式切换、附件网格、标题/属性操作不把投影当正文保存；未知格式只读保护仍有效。
3. 保存冲突或桥失败保留草稿，未取得 ACK 不显示保存成功；UI重绘不改消息号、引用目标或媒体资源身份。
4. 时区/日期和超出本机能力的桌面篇作为后续接入合成用例；本轮尚未实施远程装载，不能将这些列成已经通过的两端往返测试。

本轮为只读接缝审计及本文件记录：未读取真实日记、未操作 ADB/手机、未访问运行 API、未更改源码/网络配置、未运行全库测试。实际同步、队列事务/恢复、认证、跨端冲突、媒体下载及既有两套本机聊天的迁移均未实现/未验证，按后续明确任务逐项接入。


## 2026-10-18 0.10实际接入进展

已将桌面纯JS分段/时间算法及richdoc/Tiptap原样打包；真实WebView整份合成fixture与桌面逐对象一致，Tiptap整篇往返保持。SQLite schema3补contentEditedAt与明确已核实的限额/引用DTO；未知或本地不能完整保存的完整信封只读阻写。详见[0.10验收](validation/2026-10-18-android-content-contract-010.md)。这不是完整互通：完整Entry持久化/分类名映射、canonical units/layout与消息复合身份、chat-journal写口、资源ID/上传回执、可靠outbox和冲突协调仍未实现。旧HTML/Markdown需原只读转换服务；算法部署在客户端还是云仍未定。正式图片/GIF收藏按[共同契约](STICKER-MEDIA-CONTRACT.md)，未新造独立收藏协议。手机0.6保持。
