# 产品同步后端：Android / 电脑接入接口

2026-10-19新增兼容能力`migrationMetadata:1`与`GET api/product/v1/migration/coverage`（同一Bearer），catalog给出只读保留语义、版本1及覆盖端点；旧sync/product/seed v1路由、配对、库身份不变。新metadata profile保留settings/模板/快捷键/程序参数/未知非环境字段；明确排除凭据/本机展示与私有运行状态，并报告未映射子域。`completeComputerExport=false`不得被UI推断成“所有电脑资料已打包”。真实HTTP已验证旧v1客户端在独立服务重启后保留配对和库身份；本轮不替换前端资产、不切正式后台运行包。具体见[完整资料后端](BACKEND-DATA-COMPLETION-2026-10-19.md)。

2026-10-18新增[初始包实际接口v1](PRODUCT-SEED-API.md)：catalog.seed/version=1、stickerTags=true；`api/product/v1/seed/*`负责完整图文/原件包的任务、Range、分块导入与可信游标确认。手机安装走本机Repository事务，不调用服务器initialize-empty来假装本地导入。新版包严格要求richdoc/canonical或聊天引用投影，转换只发生在独立同步库；日常旧库不动。产品普通兼容API仍保留历史保真能力，不能把包门槛等同全库schema已切换。当前运行/验证见[验收](validation/2026-10-18-product-seed.md)。

2026-10-18。实际实现，不是UI草图。所有路径相对于用户设置的服务根地址，保留反代前缀。当前隔离服务为 `http://100.77.215.104:18789/`（电脑loopback为127.0.0.1）；库为 `var/product-sync-lab`，只有合成资料。18779保留上一轮网络试验，不要混用库身份。未经接入的日常客户端不会自动同步。

分工已由用户确认：同步后端/共用数据适配由后端会话维护，Android界面和实际本地Repository切换由Android会话负责。不要把旧BackendServices的URL改过来就认为协议已接通。

Android统一接入入口为[标准数据与调用契约v1](ANDROID-PRODUCT-SYNC-CONTRACT.md)，包含字段/时钟/权威、真正事务边界、调用顺序、容量和错误状态，以及[可执行合成样本](contracts/android-product-sync-v1.fixture.json)。界面开发使用它约束Repository/DTO，不能只保留列表展示字段后重新生成原件。

## 一条连接，两类端点

认证、配对、快照、增量、通知、冲突和原件继续使用 [SYNC-FRONTEND-CONTRACT](SYNC-FRONTEND-CONTRACT.md) 的 `api/sync/v1/*`。新增的 `api/product/v1/*` 复用同一Bearer、库身份及Host/Origin校验，没有第二套密码，也没有Telegram服务。

先health→本机local-pairing→每台设备pair→Bearer info核对libraryId/epoch→catalog→snapshot。配对码仅电脑loopback管理员口可生成，不能从手机远程生成。不要把token、原文、原件或配对码写进调试报告。

| 方法 | 路径                                          | 参数 / 结果                                                                                                |
| ---- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| GET  | `api/product/v1/catalog`                      | schema、libraryId、epoch、业务types、readOnlyKinds、revisit服务入口                                        |
| GET  | `api/product/v1/library`                      | 完整兼容阅读视图，用于初次检查；常规接收必须pull，不能不断下载这个全量接口                                 |
| POST | `api/product/v1/chat/room`                    | `{sourceId,id,title,category,idleHours,configuration?}`；创建/保存归篇配置                                 |
| POST | `api/product/v1/chat/send`                    | `{sourceId,roomId,messages:[{id,sentAt,text,attachments,replyTo?}]}`，返回`accepted:[{id,entryId}]`        |
| POST | `api/product/v1/chat/withdraw`                | `{sourceId,roomId,messageId,sentAt?,operationId?}`；已存在消息可不传sentAt，未知消息墓碑须传原发送时间     |
| GET  | `api/product/v1/revisit`                      | config、categories、cursor及随机日状态；只读，运行游标不能任意写入                                         |
| PUT  | `api/product/v1/revisit/config`               | `{expectedRevision,...规则变更}`，复用现有规则校验；冲突409时刷新设置，不清本地内容                        |
| POST | `api/product/v1/revisit/tick`                 | 自动`{}`；手动`{manual:true,from,to}`，不能提前推送未来时段                                                |
| POST | `api/product/v1/revisit/feed`                 | `{after,limit}`，回`deliveries,batches,next,total,config`；after是该业务投递序号，不是sync opaque cursor   |
| POST | `api/product/v1/revisit/comments/context`     | `{batchId,deliveryId?,occurrenceId?}`，固定待评论对象；图片/视频位置必须同时引用其delivery                 |
| POST | `api/product/v1/revisit/comments`             | `{operationId,batchId,deliveryId?,occurrenceId?,text,sentAt?}`；不传deliveryId为固定组；传deliveryId为单条 |
| POST | `api/product/v1/revisit/comments/withdraw`    | `{operationId:原评论的operationId}`，仅留墓碑                                                              |
| GET  | `api/product/v1/revisit/comments?entryId=...` | 按篇查看评论及其单条/媒体位置标记                                                                          |
| POST | `api/product/v1/revisit/source`               | `{deliveryId}`，来源可用性、原篇HTML、媒体引用和评论；前端只读查看                                         |

媒体原件走 `api/sync/v1/media/*`，授权Range/分块下载；`source`中的媒体ID可以直接走该通道。不在新服务重用旧日常后台的磁盘`revisit/media`接口，也不公开archive恢复或任意服务器路径。

`sourceId`为UUID，room.id/roomId及message.id/replyTo都是原十进制**字符串**，不能转JS number。继续使用服务器给出的会话origin；不要在每台设备为同一会话生成另一个sourceId。新会话需生成不冲突的字符串房号。消息重试保持ID、正文、sentAt；撤回后重发使用新ID和新发送时间。旧configuration字段仍保真保留，但显示角色遵循[共享范围](SYNC-DATA-SCOPES.md)：电脑wallpaperAssetId可供安卓头像引用，安卓实际壁纸/铺图参数取本机，不能直接套用电脑背景。原件必须走asset通道，禁止Blob URL、本机路径及认证密钥。

当前服务有一个库级朝花夕拾规则/收件流，并在catalog提供入口。并未在本轮实现多服务实例绑定、Android系统通知/后台保活或云部署；不得把configuration中的backend名字当成已创建的服务实例。多会话绑定仍遵守CONVERSATION-BACKEND-CONTRACT。

## 业务信封与身份

共用实现：`public/shared/sync-product.js`。

```js
{
  entityType: 'journalAggregate', entityId: '原Entry.id',
  revision: 7, state: 'active', // 同步外壳，由服务维护
  data: {
    ...完整Entry,             // date、updatedAt、body、未知历史字段保持
    _product: {schema: 1, kind: 'entry', refs: {
      category: '稳定分类ID', tags: ['稳定标签ID'], assets: ['原assetId']
    }},
    _canonical: {units: [...], layout: {...}} // 已启用统一消息的长文才有
  }
}
```

`_product`与`_canonical`是新增同步信封保留字段，不写回旧Entry。用`productValue()`取原业务值，用`productLibraryView()`重建分类名称/兼容视图。分类名变更只改变taxonomy对象，内容时间、单元ID、旧评论关联不跟着改。标签/排序也是独立对象。引用不存在的分类/标签或删除仍被使用的分类/标签会409；改归属和删除需要放在同一原子push批次。

| kind                                  | entityType / ID                                                | 权威与写口                                                        |
| ------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------- |
| entry                                 | journalAggregate / 原Entry.id                                  | 长文完整信封；普通修改走增量push，富文本先共用prepareProductEntry |
| message                               | chatMessage / `chat:SHA256(JSON([sourceId,roomId,messageId]))` | 与既有chatUnitId一致；正文只在这里，写入/撤回走chat业务命令       |
| conversation                          | conversation / `room:SHA256(JSON([sourceId,roomId]))`          | 完整会话配置；核心归篇设置走chat/room，外观字段可push             |
| taxonomy / order                      | taxonomy / order                                               | 稳定分类/标签ID及显式ID排序；旧字符串导入映射持久化               |
| media                                 | relation / 原assetId                                           | 原媒体元数据；原件另由asset实体发布，允许文字先到、原件暂未就绪   |
| sticker                               | sticker / 原收藏ID                                             | 名称/备注/分组及mediaId原样保留；不重复复制GIF/图片               |
| appearance / profile / commandMapping | 同名类型                                                       | 完整业务属性；本地窗口DPI/坐标、密码、设备令牌不加入              |
| serviceConfig / delivery / comment    | 服务配置 / relation / comment                                  | 服务器发布，只能通过业务接口改变；评论不作为回看来源              |

聊天归篇是只读投影：保留Entry身份、元数据及有序消息引用，只保存消息ID/时间外壳，不再把聊天原文复制进content、history或canonical缓存。GET library由当前消息重新生成阅读HTML。这样撤回会同时清除变更历史、回执及当前阅读中的原文，不另存一个旧投影。

朝花夕拾运行状态保存在私有元数据，实体/回执/变更与运行游标在同一SQLite事务提交。客户端不能覆盖这个state。自动调度30秒一次，失败留原游标后续重试；不以通知次数当作投递次数。

## 长文写入与大正文

`prepareProductEntry(entry,{refs,previousRecord,media,timeZone,createId})`在本地提交前准备完整信封：继承现有手打时间戳、媒体insertedAt/旧附件编辑时间兜底算法、单元匹配与布局重组；保留退役单元的无正文墓碑。`_canonical`属于正文冲突域，与可变分类refs分开。服务端在合并事务内再次验证body/units/HTML一致，结构冲突409时保留本地待发内容，重新读取基线后处理，不吞错重建日记。

容量仍是1MiB/操作、4MiB/客户端批次、100操作/批、200实体/页。`prepareProductPayload()`会将大Entry完整JSON转成hash命名的`payload-...`原件，再同步小信封；必须先把该原件持久落本地并续传，之后发送引用。读取用`hydrateProductPayload()`验证hash/长度/身份，不裁掉未知字段或历史。打包后的大aggregate按整体版本处理，不承诺内部字段自动合并。

聊天消息/评论不外置可长期回读的正文payload，避免撤回后仍留一个公开asset副本；UTF-8业务信封超过950000字节明确拒绝，客户端保留草稿并提示拆分发送。不是静默截断。普通媒体原件延续512MiB上限；超限/缺失/原hash不匹配均单独报错，不冒充已传成功。

## 本地事务与断线队列

`createSyncClient`继续负责普通实体outbox/inbox、重试和远端基线。编辑应提供真正dirtyFields；不要为改名称另建同名对象。同步外壳revision与Entry.revision分开。最新主版按服务器提交顺序，不比较设备墙上时间；冲突旧版仍是同实体私有历史。

业务端口在`public/shared/sync-product-client.js`：

- `createProductServiceClient`仅实现上述固定方法，不承包UI和本地库。
- `createProductCommandQueue({storage,client,libraryId,epoch})`支持sendMessages/withdrawMessage/addComment/withdrawComment；使用同一个本地权威transaction port。
- `enqueue(action,input,localCommit)`必须在**同一事务**保存本地消息/评论和命令。localCommit失败全部回滚，先返回本地ACK，再异步`flush(onReceipt)`。
- flush先核对catalog库身份；失败保留原job。收到回执后，在本地事务应用回执和删除该job；迟到ACK不能清除新的草稿。
- 队列不会自行接管Android生命周期或重试计时。UI/Repository拥有唯一调度器：先同步分类/会话/媒体依赖，再flush业务队列，最后pull。按既有退避策略重试，401暂停待认证，409保留待处理内容；不要紧密死循环。
- 此队列提供真实事务端口，**没有自动接进Android LocalStore或Telegram IDB**。不能先写TL，再异步抄进这个独立库并称为原子；切换权威、旧版本DB reader和文件恢复仍由Android会话专项适配。

评论参数另须区分产品交互：API未传deliveryId才是组评论，传deliveryId是固定单条。当前桌面沉浸式规范默认回复最近的历史单条，Android应在默认回复时也传该条deliveryId；不能把“未点引用按钮”直接翻译成“不传deliveryId”。旧组评论兼容且不改原关联。见[Android标准契约的目标说明](ANDROID-PRODUCT-SYNC-CONTRACT.md#6-朝花夕拾与评论目标)。

## 导入、启动和下一接缝

`seedProductLibrary()`从显式旧diary.json和media目录只读生成独立同步库。已完成的seed不因重启再次覆盖后续编辑；原件完成后重启不重新扫描其源文件。缺失/超限原件可后补，报告只有ID/错误/计数。旧朝花夕拾历史可保留，但新独立服务初次导入关闭自动推送，待客户端显式启用。不能把该一次性seed称为日常电脑源的持续增量登记。

```powershell
# 独立合成测试库，当前已启动；不要重复占同一端口
node tools/product-sync-server.mjs --host 0.0.0.0 --port 18789 --data-dir var/product-sync-lab --seed-library var/product-sync-demo-source/diary.json
```

CLI复用锁、runtime.json、路径校验和反代参数；源路径不能作为目标data-dir。正式旧日记从未在本轮切换/覆盖。当前未接入的必做项：电脑日常保存事务持续登记并上传增量、Android完整本地Repository/原件队列与收件投影、真实双产品端离线往返与升级恢复验证。前端接入前先查runtime、health和info；不要把本机100地址HTTP验证冒充手机正式包已经验证。
# 2026-10-19 后端候选增补

显式多来源接收与只读owner见[SOURCE-SNAPSHOT-INGESTION-V1](SOURCE-SNAPSHOT-INGESTION-V1.md)；偏好/便签/chat协议分别有独立输入契约。catalog新增sourceSnapshots能力，既有v1路由不迁移。完整值payload的strict CAS能力及失败保留见[PRODUCT-PAYLOAD-WRITES-V1](PRODUCT-PAYLOAD-WRITES-V1.md)。两者均为工作区候选，未变更正式运行包/手机，不能从源码或version推断已经启用。

