# 初始数据包 v1：后端与Android接入

2026-10-19第二轮来源候选已验证：显式偏好命名空间、便签workspace及原件、chat稳定ID/墓碑按[SOURCE-SNAPSHOT-INGESTION-V1](SOURCE-SNAPSHOT-INGESTION-V1.md)进入既有种子导出；真实HTTP下载.syseed并逐SHA/引用解包通过。来源owner只读，settings不自动应用；source接收ledger不变成手机游标。实际WebView捕获/PC持续登记未接，完整电脑coverage仍false，导出门槛保持。此轮仅候选，未替换正式运行包。

2026-10-19后端补齐候选：Android `ProductSeedFile` 有界流式读取原.syseed及ZIP传输包装；ZIP仅允许`data.syseed`与可选`coverage.json`，解析中央目录后才创建ZipFile索引，拒绝伪造条目数/重复/越界/附加可执行件/CRC或SHA不符。`Prepared.close()`释放本任务staging；失败/取消清理自身临时文件。`ProductSeedInstaller`先固定API取得resolve证明并发布校验原件，再由现有`ProductRepository.importSeed`同事务提交信封/墓碑/原件索引/checkpoint；保留实体intent和业务命令，已初始化库不可回退、同包重试幂等。`seedCatchUpRequired`未清除前禁止push；只有最终pull页可解除。新源码尚未安装到正式Android、没有正式电脑整库导入；入口接线与实际运行分开，见[本轮后端记录](BACKEND-DATA-COMPLETION-2026-10-19.md)。

设置参数不再默默省略：库中settings、模板、程序参数及未知普通根字段通过只读`profile(scope=migration-metadata)`保留；凭据、本机窗口/路径与后台私有运行状态明确列为排除。`GET api/product/v1/migration/coverage`报告逐域覆盖/缺项；`product-seed export --scope computer`在资料源未齐全时拒绝发布。普通.syseed不是电脑灾备全备；聊天WebView、便签草稿和独立应用偏好必须单独清点，原始profile恢复归档不能当作可跨端导入资料。覆盖报告不是对未知JSON凭据的通用脱敏认证，实际打包前仍要按来源契约审计。

大正文：wire base保持payload指针，Android `ProductPayloadReader.hydrate`校验私有映射、原件SHA/大小/UTF-8/kind/refs后给出只读完整副本；不把副本写回远端基线。增量payload已登记下载依赖。当前大正文编辑/重新打包上传端口仍未实现，原生读口显式`payloadReadOnly/readOnlyReason`，保存明确拒绝；不能称该类大正文已具备编辑同步。asset墓碑禁止旧映射读取，普通消息撤回不删除共享原件。

2026-10-18实际源码接口。Android负责本机文件选择入口、文件流与SQLite端口，本轮不改APK/UI。正式日记继续保留，导出转换只升级独立产品同步库，不覆写源`diary.json`。共享范围遵循[SYNC-DATA-SCOPES](SYNC-DATA-SCOPES.md)。

## 两种用途

1. **手机首次预置**：电脑从既定产品同步服务器导出`.syseed`，可用USB复制到手机；Android校验文件后向原服务器确认包与库身份，原子安装到Repository，直接从包的checkpoint继续pull，不再下载一遍snapshot或已有媒体。已有本机待发intent保留并重放；第一次接续先pull，再push。
2. **空服务器初始化**：上传同一业务资料包至一台空的产品同步服务，明确使用`initialize-empty`。保留业务ID和原件，目标建立自己的libraryId/epoch、revision和增量序列，需要重新配对/快照；原服务器的游标不能移用。已有业务对象的服务器拒绝此操作。

它不是整个服务的灾备搬家：配对密钥、游标签名密钥、幂等回执、冲突历史和服务器私有朝花夕拾运行状态不在包里。需要保持已配对设备身份的服务器迁移仍须一致数据库备份。服务器朝花夕拾公开配置/历史实体可导出，但新服务器的私有运行状态和实例绑定需另行恢复，不能把初始包等同完整运行器迁移。

## 地址与认证

下表路径相对于服务根地址，支持原有反代前缀、Tailscale与HTTPS。所有seed端点与sync/product共用Bearer认证、Host/Origin和设备撤销检查。先读取catalog.seed/version及`info.libraryId/epoch`，禁止对旧日常`18765/api`直接调用新协议。

| 方法 | 路径                                            | 参数与结果                                                                                                                                               |
| ---- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST | `api/product/v1/seed/exports`                   | `{operationId}` → 202任务。相同operationId返回同一个任务；失败/撤销后用新operationId重新生成                                                             |
| GET  | `api/product/v1/seed/exports/:id`               | `building/ready/failed/interrupted/revoked`，ready包含manifest/文件size/sha256；不返回服务器路径                                                         |
| GET  | `api/product/v1/seed/exports/:id/content`       | 原始文件流，支持`Range: bytes=start-end`与sha256 ETag，客户端可续传                                                                                      |
| POST | `api/product/v1/seed/resolve`                   | `{packageId,sha256,libraryId,epoch,checkpoint}` → 认证核对包、原库、真实游标，返回`verified,watermark,checkpoint,policy,redactions,catchUpRequired:true` |
| POST | `api/product/v1/seed/imports`                   | `{mode:"initialize-empty",sha256,size}` → 201，服务端空库初始化上传任务；**不是手机本地导入入口**                                                        |
| GET  | `api/product/v1/seed/imports/:id`               | 上传状态、chunkSize、received索引、提交结果；仅创建者可读写                                                                                              |
| PUT  | `api/product/v1/seed/imports/:id/chunks/:index` | 二进制块，4MiB/块，末块精确剩余长度；可选`X-Chunk-Sha256`。相同块可重试，不同字节409                                                                     |
| POST | `api/product/v1/seed/imports/:id/commit`        | 202校验/初始化任务；所有块齐全后才启动。`committing/committed/failed/interrupted`；同一包重试不重复写入                                                  |

导出任务及包注册存于独立同步库的`product-seeds/`，重启后ready包、上传块和已提交回执保持。运行中未完成的生成/提交会标为interrupted；导出用新operationId重建快照，导入可再次commit，媒体缺块和已提交回执会复用。异常目录不作为完整资料发布。

来源发生删除/撤回后，旧导出文件停止下载并移除服务端该包的正文缓存；已通过USB复制的旧包仍可resolve，返回最新墓碑redactions。本机必须在安装事务内先应用这些墓碑，之后才发布数据；再从原checkpoint追增量，不强迫整包媒体重传。私人离线副本无法远程抹除，更新状态依赖重新连接。

## 文件格式：`.syseed`

独立资料文件，**不是ZIP，也不嵌入APK**。为了避免GB级base64和解压库依赖，使用简单可流式读取的容器：

```text
14字节 UTF-8 magic: SHIYE-SEED-V1\n
4字节 无符号大端 manifest JSON字节长度
N字节 UTF-8 manifest JSON
按manifest.members顺序逐件紧接原始字节（无填充、无压缩、无额外成员头）
EOF，长度必须精确匹配
```

Java可用DataInputStream读取magic与4字节长度，随后按成员size使用有界文件流。成员偏移/总长度使用long，不转int分配整件。manifest上限32MiB、成员最多100001；records.ndjson上限256MiB、每行2MiB；单媒体512MiB、业务包成员总量64GiB。当前空服务器原子初始化还限定10000操作/60MiB事务，超过时明确拒绝，不部分写入。

```json
{
  "format": "shiye-product-seed",
  "version": 1,
  "mode": "product-bootstrap",
  "packageId": "导出任务UUID",
  "libraryId": "来源库ID",
  "epoch": "来源epoch",
  "watermark": 123,
  "checkpoint": "服务端签名的pull游标",
  "createdAt": "UTC ISO",
  "entityCount": 10,
  "assetCount": 2,
  "bytes": 456,
  "policy": {
    "clientWallpaper": "device-local",
    "stickerMetadata": "shared",
    "conversationImage": "avatar-fallback"
  },
  "containsCredentials": false,
  "containsSourceArchives": false,
  "members": [
    { "path": "records.ndjson", "size": 100, "sha256": "64位小写hex" },
    { "path": "media/内容sha256", "size": 356, "sha256": "同一内容sha256" }
  ]
}
```

示例数值仅演示字段，不能直接通过真实校验。完整可执行合成包见[product-seed-v1.fixture.json](contracts/product-seed-v1.fixture.json)，含实际manifest、base64原包、预期SHA与标签；`node tools/verify-product-seed.mjs`验证既有样本和CLI全流程，不自动重写样本。显式`--write-fixture`才重建。manifest.members是唯一成员清单：首件固定records.ndjson，其余只允许`media/<sha256>`，拒绝重复、路径越界、缺件、多余成员、长度或hash不符。

records.ndjson每行是**现有增量协议完整实体信封**，保留entityType/entityId/revision/state/lastSeq/data及未知字段，没有另一套UI专用存储格式。媒体asset实体保留assetId→sha256/size/mime关系；相同hash的原件在包内只写一份。长文须为richdoc＋_canonical units/layout，聊天归篇仍是只读消息引用，消息实体保留时间、附件、引用和墓碑。大正文继续采用既有payload资产，解引用后再验证canonical，不裁剪正文。

旧长文提升为canonical时沿用原只读适配器`candidate:entryId:index`单元编号，并保存有正文/时间绑定校验的revisitSourceIdentity；朝花夕拾仍能解析原SourceRef/snapshot，分类/标签改名不改旧评论目标。已有canonical ID不重新编号；真实正文改变后旧snapshot失效并显示来源已改变，不把评论悄悄移到另一段。

旧资料转换保留原时间依据，旧附件insertedAt未知时保持null并按内容编辑时间推定。回收站长文可保留带正文的deleted单元用于恢复，退役/撤回的无正文单元不会被重组。极少数旧details/summary折叠样式保存带body hash的只读兼容显示；正文改变后兼容显示立即失效。Android按`productSeedEntryPresentation()`选择显示路径，HTML仍走现有sanitize，不能直接innerHTML。

原始导入ZIP、整个旧diary.json、认证/私有进度不进入包。原来Entry的追溯/未知字段可保留，HTML兼容缓存不成为另一份可编辑权威。

## Android本机安装步骤

1. 文件选择器读入私有staging；校验magic/版本/边界/成员hash、记录唯一性、完整引用及整包sha256。媒体流式写入私有`.part`，整件hash通过后原子发布。不得按包内路径直接覆盖本机任意文件。
2. 连接既定root并配对，核对info库身份，再调用seed/resolve。离线只保存待导入文件；第一次正式安装需一次很小的认证请求，以验证游标与当前墓碑。不要把旧包的任意JSON字段当成可信签名。
3. 后台暂停同步调度，**同一LocalStore事务**写入远端base、保留并重放本机intent/业务命令、写initialized/cursor/seedCatchUpRequired、记录包hash幂等标记；应用resolve.redactions。失败回滚所有实体与cursor。本机壁纸不在这个事务的业务变更范围。
4. 不把种子实体重新加入outbox，也不直接替换整个SQLite文件。已初始化的Repository拒绝用另一包回退；相同包重试为no-op，继续原有增量。
5. 重启同步，先pull至一次稳定watermark，处理所有期间新增/修改/撤回，再flush本机待发修改，再常规pull/watch。事务中清除seedCatchUpRequired；断线/强杀后仍先补pull。
6. 媒体全部在本地且结构提交完成才显示“完整离线资料已就绪”；导入进度与联网同步状态分开。首次接收未完成前不以旧包内容冒充最新消息。

共用JS真实实现：`createSyncClient().importSeed({manifest,records,sha256})`，输入由已校验的文件读取器产生；不是让UI自己拼records。使用`createProductSeedClient`处理任务/Range/上传；原生Android按相同DTO和状态机实现文件流与Repository方法，界面只调用它。LocalStore本机外观表/SharedPreferences不被覆盖。

## 壁纸与表情包

- `productConversationPresentation(record, localAppearance)`：服务器会话用图只作avatar候选；wallpaperAssetId/opacity取本机设置。导入素材和从服务器收到配置均不自动应用电脑壁纸。
- 表情包`id/name/note/group/mediaId/tags`共用同一实体。新增tags是可选字符串数组，最多50个不重复非空标签、每个最多100个UTF-16码元；省略保留旧资料，明确`[]`清空。它是收藏标签，不冒充日记taxonomy ID。
- 改名称/备注/分组/标签用既有原子push/updateFields与baseRevision，保留ID/原件及其它未知字段。按既定服务器提交顺序处理同字段冲突，不生成新收藏。双端UI仍需接此字段和保存口；新增后端校验不等于旧桌面/Android界面已提供标签编辑器。

## 命令行工具

```powershell
node tools/product-seed.mjs export --server http://127.0.0.1:18789/ --token-file D:/拾页/var/PRIVATE/token.json --file D:/拾页/var/PRIVATE/first.syseed --operation-id first-seed-001
node tools/product-seed.mjs inspect --file D:/拾页/var/PRIVATE/first.syseed --work-dir D:/拾页/var/PRIVATE/check
node tools/product-seed.mjs initialize-empty --server https://YOUR-SERVER/ --token-file D:/拾页/var/PRIVATE/cloud-token.json --file D:/拾页/var/PRIVATE/first.syseed
```

PRIVATE路径是示意，必须明确选择实际私有目录；token文件可为纯token或`{"token":"..."}`，不把token直接写进命令行/日志。export不覆盖同名输出；失败保留带job ID的partial，用相同operation-id续传。inspect只读检查并写私有验证目录。initialize-empty不得指向已有业务资料的库，也不是已有配对服务的灾备恢复。
