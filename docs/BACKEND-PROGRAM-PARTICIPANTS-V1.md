# 后端程序参与身份 V1（源码候选）

2026-10-19。独立于UI的程序/机器人/未来AI服务，复用原`conversationServices.instances/bindings`、原JSON会话与消息owner，不新建业务数据库。显示名称沿`config.sender.name`和发送时`actor.name`快照，允许同名及改名；稳定身份为`program:<instance UUID>`。不新增唯一username字段。历史署名不随改名覆盖，消息保存`actor.kind/providerId/instanceId/sourceKind:'backend-service'`。

现有本机管理员API的`actorId`是库主人授权代署，仍不是机器人凭据。普通共享客户端命令只能省略actorId或使用self，不能凭配对device token冒充program。新固定`POST /api/shared/v1/program/*`只接受独立程序Bearer，服务端根据凭据强制署名，拒绝客户端actor/sender覆盖。旧legacy房不迁owner；受限内部allowLegacyService仍调用原appendChatMessages/commitChatUnit，保留消息ID、引用、幂等和归篇/手改/旧时间保护，不提供程序replacement能力。

凭据由可信Node调用`server.programIssuer.issue({instanceId,scopes})`，或显式`tools/program-credential.mjs --data-dir <绝对路径> --action issue --instance <UUID> --scopes read,feed,send,reply --output <dataDir>/.program-auth/<名字>.credential.json`发给后台worker。没有前端mint/取token端点。SQLite仅保存不可逆token摘要、库/epoch、实例、binding ID/revision、会话及权限、撤销和上传授权；原件/业务仍在原JSON/媒体目录。CLI凭据文件是backend私有文件，不能放public目录、seed或日志；输出仅回凭据ID/路径。rotate/revoke由同一可信入口操作，重启保留。解绑/重绑、关闭实例或撤销立即阻止后续请求；写事务内重新核对，不凭缓存绑定继续写。

CLI发行/轮换在私有鉴权SQLite事务内同步独占创建输出文件、写入并fsync后才提交授权；输出已存在、写盘或提交失败会回滚新grant和旧token撤销，已有文件不覆盖，只清理本次创建的失败输出。可信内部`auth.issue/rotate`可选同步persist回调使用同一边界，不能传异步回调。文件与SQLite不是跨介质崩溃原子事务：提交前进程中止可能留下尚未生效的私有文件，但不会提前撤销旧token；发行结果仍须以实际认证成功为准。

固定动作：`info/read`需read，`feed/feed-item/read`需feed，`context`需context，`send`按kind需send或comment，普通reply另需reply，`withdraw`需withdraw且只能撤回稳定actor本人的消息/评论；`media/read`需media:read，`media/begin|chunk|complete`需media:upload。未授予动作默认拒绝。媒体须是授权会话仍可见引用或本实例上传授权，上传op不能跨实例接管，不能借assetId读全库。配置读取用既有portableConfiguration过滤已知凭据与设备字段，不承诺识别暗藏密码。

请求隐含凭据绑定会话；可传相同conversationId，传其他会话明确403。没有任意entry/read、目录/参数修改、实例管理、前端解锁或发凭据动作。context只解析本会话既有程序的明确batch/delivery/媒体来源引用，不是全库日记搜索。媒体读和begin/chunk/complete全部沿同独立服务鉴权，复用原media目录及共享上传算法，SQLite仅记授权归属。

send参数沿原`{operationId:UUID,kind:'message'|'comment',text,attachments?,replyToMessageId?,displayedTarget?,reply?}`，不得发送actorId/actor/sender/providerId/sourceKind。服务端署名落原chatJournal.message和canonical messageStore，不只装饰回包。普通返回的messageId是canonical chatUnitId；localMessageId只是原数字journal ID别名，不能把两个ID当两条消息。replyToMessageId使用该房canonical ID。原operationHash绑定稳定actorId和完整意图，不绑定当前显示名或token：改名/rotate后同op仍回原身份，相同op异内容409，写入失败与业务原JSON rename一起回滚。

withdraw沿原`{kind:'message',messageId,expectedRevision,operationId}`或明确源实例comment operationId，只能撤回本人稳定actor的内容；另一同名程序无权撤回。撤回后的历史actor快照保留，正文/附件按原域规则清除。程序replacement未实现，传replacementOf/replacementRootId明确拒绝；不能把本候选称机器人已支持ui48全部重编辑能力。程序普通写保留旧时间409保护，closed当前段/手改/隐藏/草稿的危险覆盖明确409，不借内部legacy兼容例外放宽。

程序comment撤回必须已存在且author为该稳定actor；不存在的operationId明确404 `PROGRAM_COMMENT_NOT_FOUND`，不创建墓碑、不占用他人未来operationId、不推进业务/共享索引或回执。此限制由已认证program路径内部选项施加，不能从请求body授予；原可信本机管理员预先离线撤回的兼容语义保持。本人已撤回评论重放仍可成功。

普通改sender.name/公开parameters不改变instance、actor或有效binding revision，不无故失效token。解绑/重绑会推进binding revision，即使旧token期间未请求也不能复活；须trusted issuer重新授权。凭据撤销/轮换跨重启保持；授权token不在business JSON、共享实体、回执、种子或前端native存储中。

网络继续使用实际loopback/Host/Origin保护；远程只在显式sharedRemote启用并通过其knownHost/Origin后进入program认证，不接受device Bearer。**用户2026-10-19明确确认：前端停在资料库密码锁定页时，已授权后台机器人仍独立凭服务授权读写，可单独撤销。** trusted issuer每次发行的credential明确backgroundAccess=true，不依赖frontend cookie，不解锁前端；普通窗口/API的密码保护保持。服务每请求和写事务仍核库/epoch/实例/binding/启用/权限/撤销。没有正式发行token，没有自动启动进程。

`synthetic-worker.mjs`只提供显式一次step：固定口读参数与有界feed，再按配置syntheticReply回复本人消息，稳定operationId可重试；无UI、无定时器、无安装、无任意spawn或模型调用。kind=ai明确返回未执行，不能把provider登记/合成程序回声当AI已运行。本轮是源码及隔离验证候选，未部署正式服务/设备。

可信后台可通过`createBackendProgramClient`（`src/server/conversation-services/program-client.mjs`）接入同一固定HTTP契约。token只保存在调用闭包，非TLS只允许实际loopback地址，重定向拒绝；单次请求2MiB、响应1MiB、默认30秒并可dispose中止。不自动重试写入，由调用者持久保存operationId表达同一意图。`feed`对大消息描述符按256KiB分块核对水位/身份/分块及全文SHA，全部成功才交付整页；`media()`复用流式原件客户端，需要可信发行结果中的libraryId/epoch。SDK不是常驻服务管理器，synthetic worker只证明无UI参与接缝，真实外部程序的部署与执行器仍独立接入。
