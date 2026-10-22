# 电脑后端与安卓互通兼容核查

2026-10-19。用户要求先核查既有电脑后端，不重复开发，并明确互通目标：思绪日记、随想会话、朝花夕拾与未来AI/机器人服务，共用同一服务器、同一组业务数据及同等读写权限；不同网络出口不产生另一个业务库。电脑便签不纳入本轮。置顶、归档、手工排列三项已明确全部跨端共用。

核查阶段只读正式选择、冻结包、能力回读与实际客户端源码，当时未新增生产代码，未操作正式数据/服务/设备或安装手机。产物 `outputs/2026-10-19-computer-backend-compatibility-audit/runtime-audit.json`记录该阶段时间及hash；运行核查脚本在 `tmp/computer-backend-compatibility-audit/audit-runtime.mjs`。随后共享目录候选的源码/验证另记，不将候选变化混作正式运行状态。

## 核查结论

电脑已有成熟业务后端，应复用。我的既有候选主要补持久同步传输、原件、种子和导入校验；它们没有完成双端业务互通，不能直接切成正式电脑后端。来源只读profile适用于保真输入/迁移，不满足双方平等编辑会话、日记和程序的目标。

用户观察到“安卓新建会话无法对应电脑”有实际结构原因：两端当前主会话列表分别在自己的IndexedDB建立本地房，正式后端尚不是完整会话目录。电脑新建空房也可能未注册到后端，Android正在使用的QQ仍为legacy source，而新ProductChatSource只有定义未启用。因此不能仅让安卓补一个同名按钮或修改服务地址就宣称接通。

## 实际运行与版本

- 配置选择 `outputs/backend-runtimes/20261019-chat-reedit2/runtime-manifest.json`；107个冻结文件逐SHA全部匹配，105个也与工作区相同，仅稳定入口server.mjs与路径配置config.mjs不同。冻结manifest没有sync-v2/sync-product模块。
- 正式18765的GET `/api/health`实际返回0.9.27、atomicConversationSettings=1、conversationMessaging=1、sourceSessionCache=1、autoStart=true；messageUnits.enabled=false。已有canonical记录仍须保留，不因开关为false降级。
- 18779与18789的正确sync health路径本次均ECONNREFUSED，未启动或更改它们。历史测试服务地址不能作为当前已运行状态。
- manifest.deployed=false是构建时静态字段，不能推翻既有正式发布回执。配置选择、包hash、运行能力分别核对，不仅凭0.9.27判断加载内容。

## 电脑已有能力与我们的工作

| 范围               | 电脑已具备，应复用                                                                                              | 与候选的关系及缺口                                                                                                       |
| ------------------ | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 保存与冲突         | library-store.mutate统一串行copy-on-write/preflight、临时文件rename后ACK；Entry revision校验及canonical领域处理 | 新SQLite同步事务不是正式JSON业务owner；缺同次业务提交的耐久变更登记/恢复桥，不能只在保存后随手发一次HTTP                 |
| 日记与媒体完整备份 | backup-manifest克隆完整db，列media及imports原件SHA；vault2分块加密；恢复校验/合并有现成接口                     | syvault2与可移植syseed用途/格式不同，不可改扩展名代替转换；备份不自动含独立WebView资料                                   |
| 原件               | 原ID、SHA/size/type去重、流式上传、Range读取                                                                    | 同步/种子512MiB单件与电脑16GiB上传上限不一致，超限须明确报告/适配，不能声称任意原件全量迁移                              |
| 普通设置           | preferences/profile/appearance/layout、shortcuts、templates已有持久口                                           | 新preference snapshot仅补独立来源保真，不应覆盖或重做正式业务写口                                                        |
| 程序/朝花/AI角色   | 正式多实例、多slot、原子设置、绑定CAS、实例游标/评论/来源、后台续推均有实现                                     | 新product服务仅单revisit门面，registry只读profile不是同一实例可读写；后续应接同一正式实例/绑定，而非再跑一套规则         |
| 消息编辑           | legacy journal已有replacementOf/root、新ID原时原位后继、墓碑/回执/分叉保护                                      | product service复用同一domain算法，不能重复造；Android没有接原位链，统一conversation send也还没有该契约，不能静默迁owner |
| 增量协议           | sync-v2已有配对、身份、seq、snapshot/pull/watch、不可变receipt、冲突、原件通道                                  | 尚未接正式JSON提交；一次性seed和只读source快照不等于持续登记，两套数据库不能各自成为业务真源                             |

主要代码：`src/server/storage/library-store.mjs:90`、`src/server/routes/entries.mjs`、`src/server/routes/backups.mjs:35`、`src/server/routes/media.mjs`、`src/server/conversation-services/settings.mjs`、`src/server/domain/chat-journal.mjs`、`src/server/sync-product/import.mjs`。

## 随想逐项对齐

| 功能                          | 电脑当前实际持久归属/接口                                                                             | 安卓当前与共享目标的差距                                                                                                             |
| ----------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 新建、稳定ID、列表            | worker本机负数room ID；journal-link保存source UUID。正式rooms/state口可登记，但新建UI未成为服务器目录 | Android主QQ也独立本地建房；必须共享conversationId及legacy origin映射，不用名称或手机新source认同一房；空房也需注册/出现在两端        |
| 会话名称、分类、归篇间隔      | shiyeRooms本机资料；归篇开启后title/category/idleHours经journal写正式rooms                            | Android需接同一资料和版本；不能只改本机title。分类现成校验及idle算法复用                                                             |
| 会话说明、服务计划            | description/servicePlan当前在本机shiyeRooms                                                           | 正式state写口未持久这两项，是共同schema缺口，不只缺安卓界面                                                                          |
| 个人/群组、本人署名/参与者    | 本机kind与正式state.mode并存；正式已支持mode/selfName/participants/角色                               | 需要统一既有state语义/同房revision；不再各端另存权威mode，不把selfName与全局profile混用                                              |
| 置顶、归档、恢复、手工排列    | 本机IDB isPinned/isArchived/dialogs；手工顺序localStorage shiye-room-order-v1                         | 正式尚无完整共享列表状态口；按用户确认补服务器持久/版本，两端读写同一状态，恢复不重建ID/删消息                                       |
| 房头像、壁纸/外观             | 本机assets Blob及per-room外观；正式media能存原件                                                      | 资源关联/共享房头像尚未完整登记；设备尺寸、字号等不混成房业务字段。壁纸共享范围仍沿既有device-local约定                              |
| 多slot程序/AI登记及参数       | 电脑已接settings/read/save、worker program-bindings持久ACK，实例/绑定/配置CAS                         | 安卓BackendServices目前只有发现和request，缺完整设置桥/页面/多slot路由；参数保留profile不等于可编辑同一程序                          |
| 朝花规则/时间范围/发件人/开关 | 正式每实例独立config/游标/投递；固定旧房legacy-revisit别名保持                                        | 必须共享同一instanceId/bindingId/config.revision，只有服务器调度，不让手机生成第二份推送/游标                                        |
| 消息发送、引用、编辑/撤回     | 普通旧房legacy单写；replacement链/原时间排序；永久空正文墓碑                                          | AndroidProductChatStore未生成replacementOf/root，仍fresh sentAt/普通时间排序；主QQ未启用该ProductSource。旧ID/长数字/原时/链根须对齐 |
| 收件、评论、精确图片/组引用   | conversation feed/context和实例request；instance/batch/delivery/occurrence冻结目标，旧解绑保留引用    | 安卓须按相同scope落盘与幂等ACK，不能拿当前绑定/最新来信替代用户原目标；迟到响应不能串房                                              |
| AI执行                        | external-program仅角色/开关/公开参数/会话读写登记，aiExecution=false                                  | 两端共享配置与消息是本轮范围；实际模型执行器尚未实现，不得把AI角色显示当AI已运行                                                     |

电脑实际路径：`vendor/web-a/src/lib/gramjs/client/shiyeLocal.ts`的create/set-state/persist，`previews/telegram-entry/app/shiye-journal.js`的link/flush/outgoing，`shiye-room-workspace.js`的手工顺序，`shiye-conversation-services.js`的固定设置桥。ui48五个相关wrapper与当前previews源逐SHA相同；Android必须核对自身冻结worker，不能外推工作区桌面worker功能。

安卓实际主路径：`android/telegram-adapter/android-chat.js:668` editRoom→BroadcastChannel shiye-local-rooms→安卓IDB；`android/qq-chat/install.js:14`选择createLegacyChatSource。MainActivity/SQLite原型room CRUD不是当前主QQ路径；ProductChatSource模块存在也不等于被安装页启用。

UI022 stage只读快照时间2026-10-19T17:13:39.823Z：`tmp/android-ui-continuation/stage/assets/telegram/android-chat.js` SHA ba6c255a5766f57c8f3cc25c5f344ef656ab354d2ac8adc9b25b6fe0460bfd12，worker-DVw1Ca6d.js SHA cf21c75a7666a69accb02ef651ab0a451e6ad1f1b578d7fffa7d5ba79ea09a8c。前端目录仍在开发，此证据只对应当时文件，不冻结他们的后续改动。实际编辑表单只有名称/已有房说明，idleHours沿旧值或5；归档按钮disabled；pin在本机native偏好，管理页没有全列表手工排序/恢复。已同步前端作为互通待办。

## 思绪日记逐项对齐

| 功能                   | 已匹配/可复用                                                                                                       | 尚未贯通                                                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 完整正文/未知字段/时钟 | editor从previousRecord.data克隆，metadata-only保留canonical，DiaryStore.validatePreserved防丢；内容准备共用现有模块 | 手机SQLite与正式JSON还不是同一业务提交/增量链；保留字段不等于双方同权可编辑                                                        |
| 大正文                 | 已有候选payload原件/严格CAS/冻结wire/冲突保留                                                                       | 普通productEntryGet/Save仍无writer；LocalStore.productEntryView未检查payloadReadOnly，可能显示可写而保存才拒绝，须修投影与页面接入 |
| 属性编辑               | title/date/category/tags/attachments/body/location与pin/delete已分别存在；其他值能保留                              | mood/weather/hidden/draft/cover等未全部有安卓同等编辑入口                                                                          |
| 分类/标签/排序         | 正式taxonomy和排序已有；Android dependencies可生成新分类/标签依赖                                                   | 安卓bootstrap可显示远端taxonomy，rename/delete/order仍操作legacy categories表；远端分类管理未贯通                                  |
| 模板                   | 电脑POST/PUT templates已有                                                                                          | 新同步仅只读profile保留，安卓无相同模板管理动作                                                                                    |
| 删除/恢复              | 正式Entry.deleted true/false恢复沿现有PUT                                                                           | Android只有产品deleted=true及列表过滤，没有回收站恢复动作；envelope restore不会清data.deleted，不能冒充恢复完成                    |
| 编辑历史/冲突          | 正式replaceEntry生成Entry.history；正式conflicts支持选择/恢复并联动canonical                                        | 安卓只沿用history，普通sync更新不追加同样历史；sync versions/conflicts不等同产品编辑历史与冲突处理                                 |
| 日记评论/来源关系      | 正式comments保留作者/回复/图片/版本和commentOn entry/unit/occurrence                                                | 安卓保留entry.comments但无普通日记评论完整CRUD/固定来源写口；product的revisit评论不能替代全部评论语义                              |

## 后续实施与验收门槛

先补共享会话目录、稳定身份与资料/列表状态契约，复用电脑已有state/settings/实例接口，再接双端持久提交和增量发布。新增说明/pin/archive/order等字段应有CAS、丢ACK幂等与冲突保留；旧本机资料通过保留式迁移登记，不能覆盖同ID不同内容。服务端业务状态与复制水位/客户端outbox分层，不把一个只读profile重命名为可写房。

普通消息owner不自动迁。原位编辑能力未等价前，不能因统一API名称存在就切旧房；共享接入必须覆盖旧消息/撤回链/引用/评论和同一程序实例。服务网络出口可以不同，但认证后库身份/业务ID/权限与数据完全相同。离线内容、本地草稿和已发不可变wire保留，网络失败不阻止本地保存。

实际验收需至少覆盖：任一端新建空房另一端出现同ID；两端修改资料/置顶/归档/恢复/顺序并发；多slot参数冲突与丢ACK不重复建实例；手机/电脑离线写后同库合流；原时间原位置替代编辑；固定评论与媒体来源不串；同一服务器重启后规则/游标/消息不重发；日记分类/恢复/历史/评论与完整正文往返。不跑这些场景时不能称两端功能已对齐。当前只完成核查，不将旧候选隔离测试当本轮互通实测。

核查完成后继续开发的最小共享目录见[候选契约](SHARED-CONVERSATION-DIRECTORY-V1.md)，不改变本页对正式运行与当前客户端的结论。新state补说明/归篇间隔读口、保存未知字段不丢；目录候选尚待定向验证，未部署。前端新增packed标题篇序提示已记录到并行维护：payload-only wire不能直接充当日期/分类索引，合并时须可信索引/验证读口。
