# Android 标准数据与后端调用契约 v1

2026-10-19后端候选已有原生流式.syseed/ZIP解压/事务安装端口，UI只提供受控InputStream和进度，不传任意文件路径或拼解压命令。`ProductSeedFile.prepare`→固定seed resolve→`ProductSeedInstaller`→Repository事务→先pull再push；同步失败不触发APK或插件安装。`ProductPayloadReader`保留wire base，提供大正文只读解引用；大正文编辑重打包端口仍待接。设置/模板/参数以兼容只读profile保真接收，不隐式覆盖安卓本机壁纸或执行电脑程序。用户要求本轮暂停前端调整，候选未安装正式包，旧QQ权威切换/首次导入UI/正式PC持续登记仍是未完成门槛；详见[后端记录](BACKEND-DATA-COMPLETION-2026-10-19.md)。

2026-10-18初始数据包后端v1已实现，实际根地址继续18789（隔离产品库）。新增导出任务/Range、分块上传/校验导入及包→真实checkpoint接续；Android入口与LocalStore文件安装由Android会话接。[实际API/14字节magic/字段/事务步骤](PRODUCT-SEED-API.md)和[完整合成包](contracts/product-seed-v1.fixture.json)是规范，不能再按旧“格式未定”自行另建ZIP。共用`createSyncClient().importSeed`已验证保留outbox、原子安装、先补pull再push、断线恢复及包后墓碑；原生实现须同等验收。壁纸取本机，表情包name/note/group及可选tags共享；后端支持标签不等于旧两端UI已接标签编辑。

2026-10-18最新范围：[共享数据与本机展示](SYNC-DATA-SCOPES.md)。表情包名称/备注/分组/标签必须跨端一致；安卓壁纸属于本机外观，电脑会话用图可作头像但不自动作安卓壁纸。首次资料可由电脑通过USB预置独立数据包，App自动导入内容/分类/会话/素材，不要求手工解压分类；APK与私密资料包分开。包规范与后端导出/导入已实现，Android本机入口待接，按[实际接口](PRODUCT-SEED-API.md)实施。正式日常同步以新版图文/消息结构为目标，原HTML/旧导出留在兼容导入与追溯层；现有普通兼容API尚未全局拒绝旧格式，不能提前删字段。

2026-10-18用户要求：Android按标准数据格式做好前端后，可直接使用现有后端。本文是Android开发的接入入口，数据/服务实现归后端会话，Android负责Repository、传输适配和UI；不要求UI自己设计另一套正文格式或同步算法。

适用源码：`public/shared/sync-product.js`、`sync-product-client.js`、`sync-v2-client.js`及`src/server/sync-product/`。完整端点见[产品API](PRODUCT-SYNC-API.md)，正文事实见[跨端内容契约](DESKTOP-ANDROID-CONTENT-CONTRACT.md)，Android现状/分阶段接线见[015交接](ANDROID-BACKEND-015-HANDOFF.md)。这些入口共同维护，历史阶段说明不能覆盖本协议的现存端点。

## 1. 已提供的能力与启用门槛

| 层        | 实际能力                                                          | Android接线                                                  |
| --------- | ----------------------------------------------------------------- | ------------------------------------------------------------ |
| 数据/算法 | Entry保真、richdoc/units/layout、稳定身份、媒体出现时间、兼容阅读 | 复用共用模块，保存完整信封；界面只取投影，不重新实现时间切分 |
| 增量服务  | Bearer配对、snapshot/pull/watch、幂等push、冲突、原件分块         | 实现完整本地Repository和storage port；本地提交后异步交换增量 |
| 业务服务  | 随想归篇/引用/撤回，朝花夕拾配置/收件/来源/评论                   | 按固定方法调用，不把消息直接写进只读归篇                     |
| 尚未完成  | 正式电脑保存增量登记、Android权威Repository切换、产品双端实测     | 界面完成后还须完成这些接线/验收，未达标不显示“已全量同步”    |

当前隔离产品服务地址以`var/product-sync-lab/runtime.json`及health/info为准，上轮为`http://100.77.215.104:18789/`，仅合成资料。18779是另一份网络测试库；日常旧API是另一种访问协议。不要在它们之间仅替换URL而复用错误令牌/游标。新端口手机正式包是否可达需单独验证，电脑自身100请求不等于真机已验。

## 2. 标准版本、身份与时间

| 字段/标识                          | 规范                                                                                                 |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------- |
| sync `protocol`、`_product.schema` | 当前均1；richdoc自身format/version由共用rich-document模块定义，不能当同一个版本号                    |
| `libraryId + epoch`                | 连接绑定的库身份；切地址先验证同库。不同库/epoch暂停、保留本地资料和队列，不能清库重试               |
| `entityType + entityId`            | 同步主体身份。未知类型保真接收、暂只读；不要过滤后推进cursor                                         |
| `data.id`                          | 业务原ID，Entry/media/sticker保持；不要用标题、分类名、文件路径或列表序号重建                        |
| `sourceId`                         | 会话来源UUID；同一会话在两端使用同一origin，不用当前设备ID替代                                       |
| `roomId / message.id / replyTo`    | 原十进制字符串，包括可能的负roomId；不转换Java double/JS number，不能截断长整数                      |
| 会话/消息复合ID                    | 只用`productConversationId/productMessageId`，后者与既有chatUnitId相同；Java移植需通过golden fixture |
| taxonomy ID                        | 分类/标签稳定ID；可变名称和排序独立。Android本地分类数值ID必须持久映射                               |
| 外壳`revision`                     | 服务器同步版本。与Entry.revision、本地localRevision、配置expectedRevision各自独立                    |
| `operationId`                      | 一次不可变wire/业务评论操作；重试保持ID和载荷，新编辑另排intent                                      |
| `cursor`                           | sync签名不透明串，原样保存，不解析、不用设备时间生成                                                 |
| `feed.after/next`                  | 朝花夕拾投递序号，与sync cursor不同；按流分别保存                                                    |
| 内容时间                           | 完整ISO instant及原eventTime依据保留；显示默认北京时间，可选系统时间；VPN/IP不改时间                 |
| `updatedAt / contentEditedAt`      | 元数据/内容编辑时钟分开；改分类、标签、标题不能推进正文时间；缺省与显式null不混同                    |

手打时间戳仍保留原文，由共享算法解释。图片/视频新出现使用`insertedAt`；同一asset多次出现各有`occurrenceId`。旧独立附件按旧日记编辑时间推定，保留推定来源，不伪造实际插入时刻。不把媒体importedAt、EXIF、发送ACK时间、服务器接收时间混成同一个eventTime。

消息ID允许20位十进制，可能超过Java有符号long；线上和权威本地字段都用字符串/TEXT，不能经long/double中转。TL展示若要求数值ID，另外持久映射。golden fixture故意包含超过long范围的消息ID及其引用，必须逐字符往返。

## 3. 必须持久保留的信封

```text
SyncEntity {
  entityType, entityId, revision, state, data, updatedAt, ...服务器扩展字段
}
data = 完整原业务对象 + _product{schema,kind,refs,...} + 可选_canonical
```

- 完整Entry含旧HTML/Markdown、richdoc body、独立attachments、历史和未知字段。UI DTO可以精简，持久权威不可以用精简DTO重建。
- `_canonical={units,layout}`与同篇正文一起保存；`productValue()`取业务值会移除该传输注解，调用方须保留完整信封。只存它返回的Entry会丢掉canonical，不能当完整Repository。
- `messageUnits.authority=messageStore`时，body是兼容重组投影；可编辑必须经`prepareProductEntry()`保留previousRecord/units/layout再提交。未具备能力先只读，不降级编辑。
- 旧未启用canonical的篇保持现有权威，不能因为接收成功批量重写正文或开启全库canonical。HTML旧排版的保守阅读适配与真正保存分开。
- 聊天`message`正文为主体；归篇Entry只读引用消息，不能让两端分别编辑两份正文。引用用原messageId；服务端确定归篇entryId后回填本地映射。
- `withdrawn`实体的`data={}`是有效最终墓碑；保留身份/顺序并清理本地旧正文及缓存，不能当作字段缺失去“修复”原文。消息/评论撤回后重发是新身份/新发送时间。
- 同一实体被并发修改时，较晚服务器提交为主版、旧版在该实体冲突历史；不造第二篇日记。结构冲突保留本地待发内容，由可信新基线重新处理，不能换ID绕过。

实体kind/type映射与只读写口以[产品API对象表](PRODUCT-SYNC-API.md#业务信封与身份)及catalog为准。metadata分类refs、会话configuration、头像/壁纸资源ID和收藏字段均保留；DPI/窗口坐标/本机路径/设备密钥留本机。现有014业务收藏scope与sync asset身份不可凭标题或Blob URL拼接，须显式映射。

## 4. 本地Repository端口

以下为Android要实现的业务职责名，**不是当前Java类已存在的方法承诺**。持久表名/版本由Android实现维护，wire格式不随本地表名改变。

| 端口职责               | 事务边界/返回条件                                                                 |
| ---------------------- | --------------------------------------------------------------------------------- |
| 读取完整信封与编辑能力 | 返回原件、未知扩展、源格式、canonical权威、远端base、本地revision；列表是派生索引 |
| 保存Entry intent       | 准备/校验整篇→同事务保存信封、索引、本地revision、outbox→本地ACK；不等网络        |
| 保存消息/评论命令      | 同事务保存本地消息/附件任务引用及固定目标命令，再显示“本地已保存/待同步”          |
| 应用snapshot/pull页    | 验库身份→同事务保真落整页、远端base、冲突及cursor；失败全部回滚，接收不再出队     |
| 应用发送ACK            | 只确认已发快照，保留ACK之后的新修改/草稿/光标/IME，重建后续intent                 |
| 原件任务               | 私有文件持久落盘后登记上传/下载任务；断点/hash/状态独立，不用缩略图替代原件       |

若采用JS共用状态机，storage.transaction内实际接口为getMeta/setMeta、getEntity/putEntity/listEntities、listPending/putPending/deletePending、listConflicts/putConflict。所有写入串行、异常回滚、持久commit后才返回；不得每个tx方法单独原生commit，也不得跨网络一直持有SQLite事务。

若采用原生状态机，复用相同协议与fixture证明一致，不能重新定义幂等、冲突、墓碑或分段逻辑。旧TL IDB、SQLite、草稿、原件迁移前保留，身份映射显式持久化。独立sync IDB只可用于隔离原型；先写TL后异步抄到另一个库不是同事务。空服务器或未完成快照不能清除旧local-only资料。

## 5. 调用顺序与依赖

1. 连接：health→用户输入配对码pair→私有保存deviceId/token→info核对libraryId/epoch/product能力→catalog。远程客户端不能生成配对码。
2. 初收：分阶段snapshot，整页事务落盘，完成后使用checkpoint接pull；兼容未知实体和asset，不能丢弃再推进。不要将旧本地库伪造为远端base。
3. 长文保存：共享prepare/validate→唯一权威本地事务→异步push真正dirtyFields。富文本按完整正文/相关canonical一致更新，身份和内容时间保持。
4. 随想发送：先本地命令事务；会话/分类依赖保存成功，媒体元数据及必需原件就绪后，调chat/send。返回accepted中的entryId用于归篇映射；不是新建一份普通长文再发消息。
5. 原件异步：普通正文引用可先接收，UI显示待下载；发送附件前确保后台已经有该media元数据和原件。原件完成的asset回执不能代替media业务元数据，两者都要处理。
6. 业务队列：`createProductCommandQueue`支持sendMessages/withdrawMessage/addComment/withdrawComment，要求真正localCommit事务；flush前验证库身份。配置/新建会话不在该队列白名单，按各自版本/身份处理，不能硬塞。
7. 接收：watch只通知有变化，触发pull；同时按朝花夕拾流的after/next拉feed并持久入收件箱。sync通知中的delivery实体只是服务输出索引，不是另一份可编辑聊天消息，也不能假定它包含全部渲染来源。
8. 恢复：一个生命周期调度器，断网指数退避，watch超时覆盖25秒并可取消；30秒轮询兜底。不要UI每重绘就另启动同步循环。

较大Entry走`prepareProductPayload()`→本地完整JSON原件及任务→续传原件→小引用信封；接收先落信封和待取任务，再`hydrateProductPayload()`校验/重组，未取齐不可另建空正文覆盖。现存`productLibraryView()`需要已hydrate记录，不能直接把未取齐payload喂给它。

fixture的`wireExamples.pushCreate`和`pushTitleOnly`是POST `api/sync/v1/push`的完整JSON结构，初次snapshot请求见`initialSnapshot`。wire中只用可信远端baseRevision；新建为0，标题修改示例假定该实体远端为1。实际接入由Repository为当前队列形成wire，不能原样复用fixture的操作ID/示例基线。fixture的`requests`分别对应产品业务方法，不需要再包operations。transportExample是接收结果，不是可以直接POST的写入对象。

## 6. 朝花夕拾与评论目标

产品同步18789当前只有一个库级revisit流；既有日常服务的多实例registry/绑定是另一组端点。新服务catalog未声明多实例，不显示“已绑定多个实例”。以后后端发布该能力再按CONVERSATION-SERVICES-API接，不能push一条binding实体就当运行器已经创建。

**界面未显式引用，不等于HTTP未传deliveryId。** 当前桌面[沉浸式规范](revisit/IMMERSIVE-VIEW.md)已将默认回复设为最近可查看的历史单条，Android与其统一时，发送默认也带固定batchId和deliveryId。旧的整组评论继续兼容：只传batchId表示该固定组。媒体评论额外带occurrenceId，仍须同一deliveryId；不能拿一个媒体ID代替出现位置。

进入输入/首次排队时捕获并持久目标：实例/流身份、batchId、deliveryId可选、SourceRef和occurrenceId可选。新来信、切房、改规则和重试不能偷偷换目标；显式切换对象先更新草稿目标。服务端commentContext校验，客户端不能自造targets/commentOn。评论按篇聚合展示、保留单条/媒体定位，永不作为下一轮回看来源。旧评论关联不因新的默认交互被重写。

## 7. 容量、错误与完成状态

| 边界                             | 必须处理                                                                    |
| -------------------------------- | --------------------------------------------------------------------------- |
| 100操作/批、4MiB/批、1MiB/操作   | 按UTF-8 wire字节计数，不用字符数；本地编辑上限不等于传输上限                |
| 200实体/页                       | 条数不是总字节预算；大记录与payload分块落地，不塞进一个超大WebMessage       |
| 消息/评论950000字节信封          | 超限明确413，保留本地内容并提示拆分；不外置一个撤回后可永久读回的正文asset  |
| sync原件512MiB，默认256KiB块     | 与014业务收藏64MiB/131072桥块、本机import限制分别处理；失败保留完整本地原件 |
| 401                              | 暂停待认证，保留全部待发和私有资料                                          |
| 403/PRODUCT_USE_BUSINESS_COMMAND | 使用正确业务端点，不能换普通实体类型绕过权威限制                            |
| 409/基线、目标、结构或身份冲突   | 保留原intent/草稿；刷新真实基线/目标后处理；不反复新建副本                  |
| 413/422                          | 容量或hash错误，保留原件/正文与任务并显示可恢复原因                         |
| 网络/429/5xx                     | 有退避的重试，固定已发载荷；不重复创建ID，不无条件清队列                    |

“本地已保存”“待上传/同步中”“服务器已确认”“原件待下载”“冲突/认证待处理”由Repository状态产生。HTTP200、通知到达、全量阅读接口返回成功都不能冒充完整离线副本已就绪。服务器UTC字段不因显示北京时区重写。

## 8. 接入验收与后续变更

golden合成样本：[android-product-sync-v1.fixture.json](contracts/android-product-sync-v1.fixture.json)，含Entry/canonical、媒体、类别、会话、收藏、消息命令和身份预期。执行`node tools/verify-android-sync-contract.mjs`核对共用格式；Android用同样样本做逐对象往返和原生数值/时区/未知字段保真验证。该验证不代替手机的事务、强杀恢复、输入法或网络实测。

上线前逐项记录：完整信封往返；旧资料/草稿不丢；空远端不清本地；断网冷启动；本地保存与队列同时强杀恢复；丢ACK和发送中新编辑；分类/会话/收藏跨端改动；墓碑清理；图片/GIF/视频原件续传；源篇只读与默认单条/显式组/媒体评论；错误库/epoch/前缀；两台真实产品端离线冲突及恢复。达到相应门槛再开启对应能力。

后端改变DTO/字段语义/身份或限制时，同步更新本文件、PRODUCT-SYNC-API、fixture与验证工具、Android015交接和DEVELOPMENT-HANDOFF。保留未知字段、添加可选字段优先；破坏性变更必须显式版本/能力协商和保留式迁移，不让UI依赖一份过期聊天摘要。
# 2026-10-19 后端候选接缝

新增大正文写口需显式能力协商与新productPayloadEntry*固定桥，默认DiaryStore/当前UI仍保留原行为；完整值冲突不能自动rebase或丢本机原件，见[PRODUCT-PAYLOAD-WRITES-V1](PRODUCT-PAYLOAD-WRITES-V1.md)。来源profile、会话及消息保真只读，按[SOURCE-SNAPSHOT-INGESTION-V1](SOURCE-SNAPSHOT-INGESTION-V1.md)进入种子与同步，不能在Android直接改写这些只读owner。真实偏好命名空间捕获与生产写owner仍另待接；本轮不安装正式APK。

