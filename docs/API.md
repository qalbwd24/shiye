# 本地 API 说明

2026-10-19共享目录工作区候选：原conversation-services新增GET/POST `/conversations`及PUT `/conversations/list-state`、`/conversations/order`；沿同一JSON业务库与原认证，双端同等读写，pin/archive/order共享。新建稳定ID/永久回执、独立列表/资料/参数版本见[目录契约](SHARED-CONVERSATION-DIRECTORY-V1.md)。46项定向通过但未部署，正式health暂无sharedDirectory，客户端不能仅改URL视为已接；先读[现有后端核查矩阵](COMPUTER-BACKEND-COMPATIBILITY-AUDIT-2026-10-19.md)。

2026-10-18 独立网络同步API请另读[SYNC-FRONTEND-CONTRACT](SYNC-FRONTEND-CONTRACT.md)：`api/sync/v1`与本文日常本地业务口分离。新18779测试库已真机双向验证，前端须接入配对/设备认证、Repository/outbox/inbox及媒体任务，不能只改现有服务连接地址。后端维护事务、版本/回执/冲突、增量水位与媒体。本文原有entries/revisit等业务语义继续保留，正式客户端尚未切换。

2026-10-18表情包后端衔接已部署：新增catalog与from-message，chat/unit来源核验后复用db.stickers，原消息/GIF/时钟/引用保持，多图明确选择、同资源去重/恢复。11收藏与15相邻回归、12条实际来源副本预检通过；正式API0.9.24 health.stickerCollection.version=1可用，ui28原生已标准恢复；3014旧篇/源字段/旧收藏保持。桌面桥与Android菜单面板仍未接，旧本地素材须保留式映射。两端按[实际接口](STICKER-BACKEND-API.md)接入，运行回读见[验收](validation/2026-10-18-sticker-message-backend.md)。产物outputs/sticker-message-backend，临时tmp/sticker-message-backend。

2026-10-18依用户要求，测试与[跨端内容契约](DESKTOP-ANDROID-CONTENT-CONTRACT.md)完成后，已通过正式API恢复daily-random/北京时间08:00，历史范围2025-10-01起/无截止，本周期2025-11-04；新ruleRevision=5，从切换时刻继续，未补发过去时段。原17回执/评论/源篇保持，运行器正常，安装ui28＋正式feed只读11项含去缩进、图文、引用、去重及随机提示通过。旧六个月为测试配置；[回执](validation/2026-10-18-revisit-indent-and-content-contract.md)。

2026-10-18 回看气泡残留缩进已仅在展示层修复：按diary顶层段落去Unicode段首空白，marks前处理，代码/嵌套结构/聊天及原body/ID/时间/评论保持。13定向＋12实际隔离前端及2共用fixture测试通过；API0.9.24 paragraphIndentation=1已重启，标准恢复ui28原生ready、116%/2屏。冷解析曾timeout后沿原游标自动重试成功；3014旧篇/源字段与11737安装hash保持。用户明确要求安卓复用电脑格式/算法，新增[实际内容契约](DESKTOP-ANDROID-CONTENT-CONTRACT.md)及合成fixture，写清canonical正式开关仍false、只读投影/现有聊天写口和Android差距，不冒称已全端统一。见[验收](validation/2026-10-18-revisit-indent-and-content-contract.md)，产物outputs/revisit-paragraph-indent，临时tmp/revisit-paragraph-indent。

2026-10-18 长文段落消息后端已运行、ui28已标准安装：按真实段落/缩进拆分，同一手打时间下按段数递增1–2秒并保留原时间；媒体独立。180篇抽样/3002篇有效长文结构、最终35定向、29实际隔离前端及9正式feed只读通过；11737安装hash一致，3014旧长文及源字段/原评论/六个月规则保持。API0.9.24 health.revisit.paragraphMessages=1自动续推正常。两次备份遇窗口重开已安全中止；用户确认后第三次完成。**恢复随想/托盘启动命令被自动审批blocked by policy，待用户手动打开，不冒称原生ui28已运行**。范围/失败/备份见[验收](validation/2026-10-17-diary-paragraph-messages.md)，产物outputs/diary-paragraph-messages，临时tmp/diary-paragraph-messages。

2026-10-17随机回看配置支持sourceDateFrom/sourceDateTo自定义历史日期范围，含起止、null不限制；错误日期或反向范围400，省略保留。PUT /api/revisit/config及独立实例config同样支持，服务发现提供可空日期字段描述。前端表单接口见[实际契约](CONVERSATION-SERVICES-API.md)。

2026-10-17会话多实例后端已实现并部署：GET /api/conversation-services、POST /instances、PUT /bindings、POST /request及GET /comments均以该namespace为前缀，另有实例REST；health.conversationServices.version=1。参数、revision/幂等、scope、认证与动作白名单见[会话后端接口v1](CONVERSATION-SERVICES-API.md)。保留/api/revisit旧单例，前端桥/worker由UI后续适配。实际验收见[回执](validation/2026-10-17-conversation-services.md)，下方“没有新端点”为历史。

2026-10-17正式后台已更新，health.revisit新增autoStart=true：正式server入口监听后/正常解锁后自动恢复已启用的朝花夕拾，既有runner/start/stop兼容，stop暂停本次后台；不改进度/日期/评论字段。见[自动续推](revisit/AUTO-START.md)、[实际验收](validation/2026-10-17-revisit-autostart.md)。用户新确认的会话选择后端、多会话独立实例是后续接口范围，见[接入设计](CONVERSATION-BACKEND-CONTRACT.md)，当前没有这些新端点，不能按方案名称调用。

2026-10-17 ui21联调新增可选配置mode=`daily-random|interval`及dailyTime=`HH:mm`，北京时间08:00每日随机一个有历史来源的日期；缺mode的旧配置保持interval。GET /api/revisit在随机模式另返回当前randomDay（未启动或未抽选可为null）。抽选与游标同事务保存，既有feed/评论/媒体协议不变；固定桥新增revisit-runner-status/start/stop。详见[时间规则与状态](revisit/DAILY-RANDOM.md)、[联调验收](validation/2026-10-17-revisit-end-to-end-ui21.md)。仅独立库，正式后端仍未更新。

2026-10-17 朝花夕拾第六步隔离候选：新增GET /api/revisit/runner和POST /api/revisit/runner/start、stop，复用访问锁。start仅接收可选intervalSeconds（5–3600秒），stop空对象；借用当前已认证会话，仅内存保存。运行器默认停止，重复start单飞，停止取消请求/退避/授权，不锁用户UI；认证失效等用户重新解锁再start。health.revisit.runnerControl=1可检测能力，当前正式API未重启。状态/错误/前端映射见[运行器](revisit/06-runner.md)及[协作契约](revisit/FRONTEND-BACKEND-CONTRACT.md)。

2026-10-17 朝花夕拾第四步隔离候选：旧POST comments/withdraw和source.comments形状保持。新增POST /api/revisit/comments/context（batchId，可选deliveryId/occurrenceId），只读返回固定选择scope/targets/replyTo/commentOn及当前条目元数据；新增GET /api/revisit/comments?entryId=...，按篇评论附context.targets的本篇消息/媒体位置与available。active同operationId更换text/batch/delivery/occurrence/显式发送时刻返回409，精确重试返回原ID和时间；撤回墓碑优先。详细协议见[评论与上下文](revisit/04-comments.md)、[阶段4验收](validation/2026-10-17-revisit-decoupling-stage4.md)。只做隔离，正式运行后端未重启。

2026-10-17 朝花夕拾第三步隔离候选：原配置/tick/feed响应兼容，新增GET /api/revisit/archive导出shiye-revisit-state v1状态包；PUT同路径接收{archive,expectedToken}，expectedToken须先从目标库GET包的targetToken读取。要求精确同源、校验和/序号/组/评论关联合法；仅空进度库可恢复，完全相同状态幂等，已有不同进度/评论或来源改变409，坏包400。走现有访问锁与共享mutate，不写源日记，暂未接通用备份ID重映射。细节见[状态服务](revisit/03-delivery.md)、[验收](validation/2026-10-17-revisit-decoupling-stage3.md)；运行窗口与正式后端未更新。

2026-10-17 朝花夕拾独立候选新增/api/revisit配置、tick、feed、source、media、comments与comments/withdraw；/api/health声明revisit.version:1/scheduler:external。通过现有本地来源和访问锁；不启动窗口、不自动运行调度。参数/上限见[接口协议](REVISIT-PUSH.md)，运行中的旧API不因源码更新自动支持这些路由。

2026-10-17 新增隔离候选接口：GET /api/message-units（过滤/分页/时间范围、默认排除评论及隐藏等）、GET /api/message-units/:id；POST /api/chat-journal/withdraw（身份/版本/可选operationId、离线待归档sentAt），receipts增加state/revision/unitId。comments新增commentOn篇/消息/媒体出现引用。详见 [实际接口与启用边界](MESSAGE-UNITS-IMPLEMENTATION.md)。PUT聊天原消息明确405，要求撤回后新号重发；旧篇仅candidate读取不落库。正式进程本轮未启用。

0.9.23：GET /api/health增加inlineMedia:[image,video]与entryReadingDocuments:true。GET /api/entries/:id/reading-document经现有访问锁/本地同源保护返回只读实时投影，不写db或MRU：format/version/readOnly/mode/body/bodyComplete/html、source{id,revision,fingerprint,contentFingerprint,mediaFingerprint,contentFormat}及实时metadata。bodyComplete=false时不得保存部分body覆盖原文；html含安全兼容区域。无任意磁盘/迁移包读取API，删除条目沿既有GET策略并标只读。

0.9.18 聊天归篇接口：GET /api/chat-journal 返回分类和已注册对话配置；PUT /api/chat-journal/rooms 保存 sourceId（稳定本机来源 UUID）、id（对话 ID）、title、category、idleHours；POST /api/chat-journal/messages 接收 sourceId、roomId、messages（最多 50 条，每条 id、sentAt、text、attachments、可选 replyTo），返回 accepted:[{id,entryId}]。重复原文返回同一条目，不同内容的同 ID 返回 409；乱序补入早于已归档末尾也返回 409。POST /api/chat-journal/receipts 用来源、对话、ids 批次查询回执；POST /api/chat-journal/close-idle 检查空闲截断。媒体原字节 POST /api/chat-journal/media，沿用 X-File-Name 与串行媒体登记／SHA 去重，增加普通文件类型；非白名单可显示媒体强制下载。全部继承本地来源保护与访问锁。

## 开放数据接口（0.9.10）

`GET /api/open/v1/schema`、`entries`、`entries/:id`、`random`、`anniversary`、`export` 提供独立的版本化 DTO，不返回原始库对象。默认过滤隐藏、草稿、删除记录，评论主动开启；使用 snapshot 保持分页一致。沿用本地锁和同源访问限制，没有新增 CORS。完整字段、示例和互动 SDK 见 [组件与 AI 数据接入](OPEN-DATA.md)。旧 `/api/export` 是内部库导出，不等同于新的白名单结构化接口。

默认地址 `http://127.0.0.1:18765`。JSON成功响应为业务对象，错误响应为 `{ "error": "说明" }`，HTTP状态表达成功或失败。二进制附件和备份下载不返回JSON。

写请求必须带 `X-Diary-Client: desktop`；JSON请求带 `Content-Type: application/json`。浏览器Origin必须匹配本地服务；外部来源请求被拒绝。开启本地锁后，业务API与媒体下载需要服务颁发的会话Cookie。此表不授权任何对外联网或数据上传。

| 方法与路径                                   | 行为                                             | 所属模块       |
| -------------------------------------------- | ------------------------------------------------ | -------------- |
| GET /api/health                              | 应用标识与版本                                   | app            |
| GET /api/library                             | 全部库元数据                                     | app            |
| POST /api/entries                            | 创建完整日记对象                                 | entries        |
| PUT /api/entries/:id                         | 完整对象+revision更新，冲突409                   | entries        |
| POST /api/categories                         | 添加分类名称                                     | entries        |
| PUT /api/settings                            | 更新shortcuts命令绑定                            | settings       |
| PUT /api/preferences                         | 更新允许的偏好字段                               | organization   |
| POST /api/taxonomy                           | kind/category或tag，from、to、action重命名／移除 | organization   |
| POST /api/templates                          | 新增模板                                         | organization   |
| PUT /api/templates/:id                       | 编辑、删除标记或恢复模板                         | organization   |
| POST /api/media                              | 原始媒体流；Content-Type及URL编码X-File-Name     | media          |
| GET /media/:id                               | 读取媒体，支持Range                              | media          |
| POST /api/import-upload                      | 原备份流暂存，返回id                             | imports        |
| POST /api/import-upload/:id/commit           | 解压、读取旧格式、合并库；重复原件409            | imports        |
| GET /api/original/:id                        | 下载逐字节保留的原件                             | legacy-backups |
| GET /api/export                              | 明文元数据JSON，不含附件实体                     | legacy-backups |
| GET /api/bundle                              | 旧版整包数据，128MiB上限                         | legacy-backups |
| POST /api/import                             | 旧内存上传接口，保留兼容                         | legacy-backups |
| POST /api/restore                            | 恢复旧解密bundle                                 | legacy-backups |
| GET /api/backup-manifest                     | 日记快照、所有文件大小／哈希                     | backups        |
| GET /api/backup-file/:folder/:id             | Range读取media或originals供浏览器加密            | backups        |
| GET /api/backups                             | 列出完整syvault2文件                             | backups        |
| POST /api/backups                            | 创建备份会话，body为格式头                       | backups        |
| POST /api/backups/:id/record                 | 追加有序加密记录                                 | backups        |
| POST /api/backups/:id/finish                 | 核对记录数，发布完整备份                         | backups        |
| POST /api/backups/:id/cancel                 | 取消当前会话及其临时文件                         | backups        |
| GET /api/backups/:id                         | 下载完整加密备份                                 | backups        |
| POST /api/restore-jobs                       | 用已解密manifest建立暂存会话                     | backups        |
| POST /api/restore-jobs/:job/file/:folder/:id | 文件块，X-Offset保证顺序                         | backups        |
| POST /api/restore-jobs/:job/commit           | 全文件哈希校验通过后追加库                       | backups        |
| POST /api/restore-jobs/:job/cancel           | 清理本会话暂存                                   | backups        |
| GET /api/access                              | 查询启用与解锁状态                               | access         |
| PUT /api/access                              | 设置／修改／关闭本地锁                           | access         |
| POST /api/unlock                             | 校验密码并颁发会话                               | access         |
| POST /api/lock                               | 撤销当前会话                                     | access         |
| GET /api/sync/status                         | 云同步地址、用户名及最近同步状态                 | sync           |
| POST /api/sync                               | 测试、只拉取合并或合并并上传 WebDAV              | sync           |

新增／修改日记示例仅用于隔离开发库：

```json
{
  "title": "合成样本",
  "content": "<p>测试正文</p>",
  "date": "2026-09-14T08:00:00.000Z",
  "category": "开发测试",
  "tags": [],
  "attachments": [],
  "mood": "",
  "weather": "",
  "location": ""
}
```

更新时先GET库取得日记完整对象，修改所需字段，携带原revision执行PUT。删除是同样的PUT将deleted设为true；恢复设为false。当前不提供永久删除日记或自动清除所有未引用媒体的接口。

完整备份协议由 public/shared/vault2.js 驱动；调用方必须验证结束记录，不能只收到部分文件就提交恢复。服务器不知道备份密码，不能代替客户端验证AES认证标签。

### WebDAV 同步

`POST /api/sync` 的 JSON body 为 `{action:"test"|"pull"|"sync",url,username,password,allowUnencrypted}`。请求由本地 Node 服务执行 WebDAV，浏览器不直接跨域访问服务器。`sync` 先读取 `<url>/diary/diary.json`，按稳定 UUID 合并日记并下载引用的媒体；发现冲突时只保存本地副本与云端原件，不上传覆盖。上传动作必须明确传 `allowUnencrypted:true`，因为兼容原版的 `diary.json` 不是端到端加密容器；没有强 ETag 的服务器也会拒绝覆盖。密码不会写入 `data/diary.json`；`/api/sync/status` 只返回地址、用户名、哈希、时间和加密限制说明。

## 0.5.0 接口扩展

- POST /api/backgrounds：图片原始字节，X-File-Name 为 URL 编码文件名；20 MiB 上限，签名识别 PNG/JPEG/WebP/GIF。返回 media 元数据，purpose=background，使用现有 GET /media/:id 读取。
- PUT /api/preferences：支持 appearance 和 layout，服务端规范化且核对背景归属；错误不写入部分设置。
- POST /api/taxonomy：action 新增 create；kind=tag 可创建独立标签。rename/merge 同步分类模板与回忆筛选，remove 不删除日记。
- POST /api/restore-jobs：原 manifest 之外可带 restoreAppearance:true，经过整包校验后应用外观；不传则保留本机偏好。

## 0.6 新增接口

- `PUT /api/taxonomy/order`：`{kind:"category"|"tag", order:string[]}`，必须包含该类型完整、不重复的名称集合；过期顺序返回409；保存后该类型切换到手动排序。
- `PUT /api/preferences`：增加 categorySort/tagSort，值 manual/name/count。
- `PUT /api/conflicts/:id`：`{choice:"both"|"left"|"right", title?:string, leftRevision?:number, rightRevision?:number}`；title 可修改导入侧名称；日记冲突要求两边 revision 匹配。结果进入 conflicts 处理记录。
- 旧导入和加密恢复响应新增 mergedEntries、mergedMedia、conflicts。entries/media 表示实际新增量。
- 普通媒体上传返回的 ID 可能是已有相同文件的 ID，客户端必须按 ID 去重，不得重复追加附件。

规则详见 IMPORT-CONFLICTS.md。

## 0.7 接口

- POST /api/entries/:id/comments：body、attachments、authorName、authorAvatarId、replyTo、entryRevision。
- PUT /api/entries/:id/comments/:commentId：body/attachments/deleted，entryRevision 和评论 revision 必填；返回最新 Entry。
- POST /api/media-compression-upload?quality=balanced|high：视频原始请求体，X-File-Name、Content-Type、X-File-Last-Modified。202 返回任务id；GET /api/media-compression/:id 查询queued/processing/done/error及media。
- 原 /api/media 支持 X-Original-Size、X-Media-Compression、X-Source-Captured-At/Offset/Tag；元信息独立于文件字节，非法编码在写盘前拒绝。
- 旧媒体冲突选择携带 targets:[{id,revision}]；禁止隐式全库替换。撤销条件和负载见 routes/conflicts.mjs，必须保持后续编辑不被覆盖。

# 启动主题提示（0.9.8）

`GET /startup-theme.json`、`GET /startup-theme.json?quick=1`：仅返回 `{ "theme": "light" | "dark" | "system" }`，支持 HEAD，Cache-Control 为 no-store。用于原生窗口在显示前确定底色。此非敏感显示提示与公共 HTML 壳一致，锁定时仍可读取；不包含其他偏好、日记或媒体信息。`/api/library` 和 `/media/` 的锁保护不变。

## 候选接口设计：统一数据 v1（未开放）

候选 /api/unified/v1 路径与能力边界见 [统一数据契约 v1](UNIFIED-DATA-CONTRACT-V1.md)。当前服务没有开放这些候选接口，仍使用上文既有接口；本次无运行变更。
