# 显式来源快照接收 v1

2026-10-19 工作区后端候选，未部署正式桌面后台或手机。能力通过 catalog/health 的 `sourceSnapshots.version=1` 查询；缺少能力时客户端继续使用原本本地数据。协议不安装程序、不下载执行插件、不替换前端资产。

接口沿 product v1 的配对 Bearer 鉴权、库身份与独立同步库，不读取生产 WebView profile，也不扫描电脑目录。

| 请求                                                  | 内容                                                                                                  |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| GET `api/product/v1/migration/snapshots`              | 能力、已提交来源 heads、覆盖明细；不返回原始正文或内部所有权表                                        |
| POST `api/product/v1/migration/snapshots/preferences` | `{snapshot}`，格式见 CLIENT-PREFERENCE-SNAPSHOT-V1.md                                                 |
| POST `api/product/v1/migration/snapshots/notes`       | `{snapshot,sourceId,snapshotRevision?}`，现有 exportDrafts 格式，见 NOTES-SNAPSHOT-PRESERVATION-V1.md |
| POST `api/product/v1/migration/snapshots/chat`        | `{snapshot}`，格式见 CHAT-SNAPSHOT-PRESERVATION-V1.md                                                 |

外层可显式提供 sourceId/snapshotRevision，但必须与编译结果一致。来源 ID 必须稳定，revision 为来源自身版本，不是服务器实体 revision；便签取 workspace.revision（可为0），缺失时必须明确提供。便签 exportedAt 是捕获信息，不参与逻辑身份。请求上限为偏好4MiB、便签48MiB、聊天16MiB，加4KiB封装余量；来源最多64个，所有来源登记实体合计8192个。删除命名空间或省略记录不代表删除目标，旧资料保留。

成功200返回 kind/sourceId/snapshotRevision/sourceSha256/recordCount/changedRecords/assetCount/replayed，`completeComputerExport` 始终 false。相同来源、kind、revision及hash重试返回原回执且不增加业务序列；同版本异内容409 `SOURCE_REVISION_CONFLICT`，旧版本409 `SOURCE_REVISION_OLD`。源hash用于幂等，不能当作账号身份或完整性签名。

每个来源只更新自己已登记且目标 revision/hash 未改变的记录；目标被其他写者改变返回409 `SOURCE_TARGET_CHANGED`，新来源与现有不同值碰撞返回 `SOURCE_TARGET_EXISTS`。已有同值可登记，消息原ID正文不可修改（`SOURCE_MESSAGE_IMMUTABLE`）；显式撤回生成空正文永久墓碑，不能复活（`SOURCE_TOMBSTONE_FINAL`）。profile与conversation可按新来源版本完整替换，不用字段merge残留已删除字段。

来源资料是保真只读投影，不自动应用设置、不切换生产消息写权威。普通push拒绝 readOnlyProjection，既有chat/room、send、withdraw业务口也拒绝修改来源会话（`PRODUCT_SOURCE_READ_ONLY`）；修改其他普通房仅提交该房，不能重建所有房并去掉只读标记。正式编辑/发送继续由原业务口维护；来源会话后续成为可编辑owner需另立契约。

便签附件先按精确SHA/size/MIME发布与核验，聊天声明附件必须已实际上传且可分段读取核验，缺件不提交业务记录。源名称等在assetMapping.sourceMetadata保留；同字节改名不变资源ID，已有原件目录元信息不因改名覆盖。源快照和全部业务行、操作回执、所有权表在同一SQLite事务提交。不可变原件文件先于事务准备，文件或数据库失败可能留下可复用的已校验孤立原件，但不会产生半份来源回执或半份业务记录；不把两种持久化平面声称为同一文件系统事务。

来源偏好、便签、会话/消息及引用原件参加既有library种子导出/哈希/引用校验。来源接收head只属于接收服务，不成为手机游标。原始profile恢复档不属于可移植业务快照。真实资料收集、桌面持续登记、设备私有设置应用和完整电脑覆盖仍未接，`--scope computer` 导出门槛继续阻止不完整包冒称全量。

来源记录另外带 `_product.sourceSnapshot={version:1,kind,sourceId}`，与既有聊天消息“只允许业务口写入”的 readOnlyProjection 区分。普通旧聊天仍可由原业务口撤回；来源只读保护不能阻断旧业务语义。该标记随种子保留，不作为用户可编辑字段。

本轮验证见 validation/2026-10-19-backend-source-snapshots.md；源码、隔离验证、模拟器QA、手机安装和正式启用分开记录。
