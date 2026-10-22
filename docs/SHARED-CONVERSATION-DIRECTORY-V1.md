# 共享会话目录 v1（开发候选）

2026-10-21 多作者/历史引用后继已准确冻待审：candidate-1792574765950 main4dd14ae0…/fallbackfcaf146b…，171源/18delta，新增authors/history-ref能力及reader floors，详见[新WIRE](../outputs/2026-10-21-pc-groups-broadcast/backend/candidate-1792574765950/WIRE.md)。目录组选取/独立成员/本机固定名单原规则保持；真实作者、来源引用和传播来源分离。六冻准入不代该增量；目标自身program read SDK相邻还将另冻，新activation exact pins/前端/维护仍待，正式未变。

2026-10-21 最新人类广播作者澄清沿[原会话管理](CHAT-ROOM-MANAGEMENT-2026-10-17.md)：接收成员仍是稳定conversationId；群内实际作者可为self或已登记程序/AI，作者与目录成员及广播来源三者不可混淆。所有作者同接口、同名单快照投递链到成员会话，旧第六冻本人范围准入不覆盖多actor后继；准确新wire及能力/reader门槛待冻结另审，本节不改既有已答按组批量加入语义。

2026-10-21 PC接续分组与广播的必要私有实现，尚未冻结完整候选、独立验收或正式启用。共同规则沿用[原会话管理需求](CHAT-ROOM-MANAGEMENT-2026-10-17.md)：目录组多对多、可嵌套；删组只解散本层并提升子组，保原会话身份及消息。用户已确认广播群“按组批量加入现有会话，之后在广播群独立增删成员”：选组时有界展开当前子组并按canonical ID去重，保存广播群自己的成员列表，不订阅目录组后续变化。目录展开/置顶保留等本机视图记忆与共享成员关系分开；精确新wire/能力门槛待准确冻结后补入本契约，不能凭旧sharedDirectory=1声称支持新功能。

### 2026-10-21 分组/广播目录 wire（私有内核准入，前端/启用待验）

当前准确第六冻`candidate-1792567636819`，main `8de0c240c13eeb8e2da9c64020b6784a2cc385b72e3999d4e71f91eb3cda111a` / fallback `648be0c15d6ce65ef5f74d127ea65f7a0aa9dee60b03b2377e8c2862710db70c`，168源；[最新WIRE](../outputs/2026-10-21-pc-groups-broadcast/backend/candidate-1792567636819/WIRE.md)与[独审报告](../outputs/2026-10-21-pc-groups-broadcast/backend/review/kernel-independent.json)（ebd43d4f…）已准入内核scope。下方首冻/第四/第五冻是过程，CAS显式复核/放弃与永久旧UUID守卫已独立闭环；仍不代真实UI、整包或部署。

准确入口为[本轮 locator](../outputs/2026-10-21-pc-groups-broadcast/backend/current-review-locator.json)，首冻 `candidate-1792564377876`（main `5cb450f9…`，同schema只禁新组织写的fallback `7c198056…`）。完整字段以该候选[WIRE](../outputs/2026-10-21-pc-groups-broadcast/backend/candidate-1792564377876/WIRE.md)为审查对象；这不是正式部署回执。

固定 `POST /api/shared/v1/command` 使用原库 `libraryId/epoch`、UUID `operationId`、`action/input`及支持能力集。新增组织schema要求 `conversation-groups-broadcast-v1`，不能沿旧目录能力猜测支持。分组/广播设置首次本地持久接受后允许离线连续操作，以同scope父操作回执推进服务器CAS；同op重放先查原回执，异载荷409，不用猜测未来revision。

| action | 候选字段与职责 |
| --- | --- |
| `organization-read` | `{}`；有界只读分组、广播头、真实接收会话及能力；不创建namespace/回执，不推进revision或读整库日记正文 |
| `groups-read` | `{}`；`{version:1,scope:'groups:library',revision,groups,limits}` |
| `groups-save` | `{expectedRevision,groups}`或可信`baseOperationId`；全图原子更新，group为`{id:UUID,parentId:UUID或null,name,order,conversationIds}` |
| `groups-delete` | `{expectedRevision或baseOperationId,groupId}`；提升子组到原位置，保其他身份与消息 |
| `broadcast-create` | `{conversationId,title,memberConversationIds}`；沿原source和持久负数字映射分配canonical ID，不另造source或普通房 |
| `broadcast-save` | `{conversationId,expectedRevision或baseOperationId,title?,memberConversationIds?,disabled?}`；独立成员/标题/停用；无硬删历史口 |
| `broadcast-read` | `{conversationId}`；设置/目标能力/消息计数及末20条摘要，完整消息另走原feed分页 |

当前窄候选上限为256组、16层、总4096成员引用；最多128广播房、每群128成员。全图校验父级/环与真实canonical成员；组选取有界递归并集只用于批量加入。表单必须核打开时的本机revision，后台刷新不得静默将旧表单覆盖成新revision。canonical ID到本机TL数字view ID和普通create共用耐久分配队列，不能按标题合并或跨source复用同数字房号。广播发送/终态、附件原件与本地ACK见[消息契约](CONVERSATION-MESSAGING-BACKEND-API.md)。

第四冻`candidate-1792565948671`新增空普通房接缝：`registerLocalConversation({conversationId,title,category?,idleHours?,mode?,selfName?},{operationId?})`复用原`conversation-create-local`加`registerOnly:true`，不传/切换messageOwner。已存在ID只回原资料，不覆盖他端新title/category/owner；未知ID仅登记同source/同房元数据，不造消息/Entry/来源。登记头和pending同shared事务；groups-save及广播成员create/save对所选待登记房存显式dependencies，等登记成功再提交，不靠UUID/同毫秒排序。该冻原7反例已独立过，但并发CAS冲突后再保存仍永久pending，保持HOLD，后继须提供保稿/读取最新值/明确复核后新op的真实恢复路径；不得静默改变旧wire或沿blocked父链假成功。

第五冻`candidate-1792567563235`（main `85aeacc7…`、fallback `8e720229…`）正独审上述恢复增量，准确[WIRE](../outputs/2026-10-21-pc-groups-broadcast/backend/candidate-1792567563235/WIRE.md)。新增本机`resolveBlocked({operationId,mode:'review'或'discard'})`显式归档该blocked操作及完整依赖分支，保存每项不可变wire/optimistic草稿/原件/冲突，返回`archivedOperationIds`；`readOperation`冷开仍可查。旧UUID永久拒重入，未显式处理时同scope新save/send明确返回`ORGANIZATION_CONFLICT_REVIEW_REQUIRED`，不再挂死新子op。UI必须显示保留草稿及最新共享revision供用户复核，再明确新op；refresh本身不退役旧操作，也不静默重算名单/覆盖他端新组。真实UI入口尚待接线验收，不能只凭facade方法存在勾通过。

### 既有目录契约与过程记录

2026-10-19 Android023新增共同壁纸图片/每房同步开关，字段/CAS/媒体ACK与本机显示参数分离的提案见[壁纸契约](SHARED-CONVERSATION-WALLPAPER-V1.md)。缺字段默认同步、无绑定，不自动迁旧本机图；未实现/未独立审批，不据此显示已保存。旧“壁纸全本机”规则仅继续适用于独立图及显示参数。

2026-10-19用户要求电脑/Android同服、同组数据、同等读写，并明确置顶/归档/手工顺序共享。此候选补既有正式JSON业务后端的目录缺口，不把独立SQLite同步库/只读profile改成会话权威。尚未部署、客户端尚未接，不据源码能力显示已同步。

在既有health的conversationServices.sharedDirectory=1及catalog.sharedDirectory.version=1探测。所有接口仍继承库级认证/访问锁/同源保护，`X-Diary-Client: desktop`是旧协议标识，不是赋予PC高于Android的权限。当前仅本地业务接缝，不宣称云端认证、远程网络和增量协议已贯通。

| 接口                                                      | 输入/含义                                                                                                                                                                |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET `/api/conversation-services/conversations`            | 返回服务器已登记会话目录及其原canonical ID、资料/程序、共享列表状态与目录版本                                                                                            |
| POST 同路径                                               | `{operationId,title,category,idleHours,mode,selfName,description?}`，服务器登记新会话；operationId为首次持久生成的UUID，失败/重试不能换载荷或重建ID                      |
| PUT `/api/conversation-services/conversations/list-state` | `{conversationId,expectedRevision,pinned?,archived?,expectedDirectoryRevision?}`；expectedRevision是本房共享列表状态版本，避免一端旧状态覆盖另一端；不同房互不争同一版本 |
| PUT `/api/conversation-services/conversations/order`      | `{expectedRevision,order:[canonicalID...]}`；此版本是目录revision，order须包含全部真实会话且各一次，含已归档/置顶房，不隐式丢弃隐藏房                                    |
| POST/PUT 既有 `/conversations/state`                      | 继续读写资料、mode、selfName、分类、归篇间隔；现补description可选字符串<=2000，未传保留，空串清除；读取补idleHours/description                                           |
| 既有 `/settings/read`、`/settings/save`、实例request      | 程序/朝花/AI角色及多slot参数沿原接口，目录不再维护另一份规则/绑定/游标                                                                                                   |

身份保持现有`desktop:<sourceUUID>:<roomId字符串>`；desktop前缀为历史兼容身份，不代表只允许电脑编辑。旧房不重新编号。新建在同一mutate中持久分配server namespace/负数字房号、业务room、conversation资料与不可变创建回执。两端必须保存返回的同一conversationId和原legacy origin映射，不能自己再生成sourceId或按同名/正文合并。本机空房/草稿尚未登记的不能假装已在服务器；后续保留式采集/登记需显式映射。

创建相同operation及同载荷重放返回同一会话，不能覆盖后来已改资料；同operation不同载荷409。新建默认保留legacy消息owner，不迁普通房统一send，不重发消息。目录、状态和排序均在原JSON同次事务保存后ACK，失败不部分提交。未知普通持久字段保留。归档只改列表状态，不删除消息、程序、评论、草稿或原件；恢复沿用原ID。固定旧朝花夕拾房不能归档，仍用原推送开关。

GET返回`{version:1,sourceId,revision,order,conversations}`；未初始化目录的sourceId为null，读取不会写namespace。行包含原describeConversation资料/participants/programs，以及selfName、idleHours、description、pinned、archived、listStateRevision。新建返回该行加directoryRevision/replayed；重放返回原ID的当前资料，不用最初旧快照覆盖后来的修改。list-state返回该行加directoryRevision；order返回完整目录。目录最多1024房，创建回执同上限永久保留，满额明确拒绝、不淘汰旧回执导致重复建房。

创建重放使用同一operationId及完整原请求（包含原expectedDirectoryRevision时也不换值），先检查原回执再判断新建CAS。list-state/order没有独立操作ID历史，版本过期可返回409；丢ACK时重读同一ID/状态确认，不自动重建房或反复强写。相同当前版本且无值变化的设置不增加目录版本；普通JSON存储仍沿原保存事务，不能将本补丁当高频无写盘优化。

手工order为全部会话的共享基准，显示时可按pinned优先分组，不能用一次置顶覆盖全局顺序。列表state版本、目录order版本、会话资料revision、bindingRevision与config.revision分别使用，不能混作一个expectedRevision。迟到保存409要保留草稿、明确重新读取，不能清本机资料或换ID绕过。

客户端前置要求：桌面worker与Android实际worker都要接固定目录/状态动作；当前Android022 worker仅list/create/update/search/flush/withdrawal-ack，不能把新desktop worker当Android已支持。先保证空房跨端同ID与设置同值，再迁消息读写；原时原位编辑和精确评论仍是独立硬门槛。UI、正式部署、真实资料迁移、网络/复制链未在本候选完成。
