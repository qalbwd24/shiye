# 大正文候选写口 v1

2026-10-19 后端/原生候选，未合并到正式手机APK或桌面运行包。catalog 的 `payloadWrites={version:1,conflict:'strict-base-revision',maxBytes:67108864}` 表示服务器支持完整值写入。普通短篇字段合并保持原契约。

超过786432字节的完整Entry data以 `application/vnd.shiye.product+json` 原件承载，wire仅保留 `_product` 与 payload 指针；64MiB上限在服务器读取原件前检查，实际字节/SHA/元数据及canonical结构继续校验。完整值写入遇到旧baseRevision返回409 `PRODUCT_PAYLOAD_REBASE_REQUIRED`，不能按普通字段merge把另一端新内容覆盖。相同operationId与相同wire先重放原回执；更换内容不得复用operationId。事务内策略回调同步执行，异步回调拒绝并回滚。

候选原生固定接口为 `productPayloadCapabilities`、`productPayloadEntryRead({entryId})`、`productPayloadEntrySave({preparedRecord,dirtyFields,expectedLocalRevision})` 和 `productPayloadEntryQueueLocal({entryId,expectedLocalRevision})`。现有默认DiaryStore保持大正文只读；只有显式构造带writer及已验证能力的端口才能编辑，页面未自动切换。返回payloadReadOnly/readOnlyReason须尊重，不能显示已启用编辑。

本地完整快照先在私有原件目录校验、fsync并原子落盘；SQLite仅存小指针，避免大TEXT触发CursorWindow限制。原件映射、本地修订、完整值intent和冻结wire在同一事务提交；文件准备后本地revision或base变化时事务拒绝，已存在内容寻址文件可复用。未知字段、canonical单位及资源引用保留；不会为重试重生成操作身份或篡改wire。连续编辑按前一冻结操作预留下一baseRevision。

上传顺序为完整值原件、其他引用原件、业务push；先能力协商，不通过安装APK补能力。服务器409时保留本地完整快照、原wire及操作ID，标记blocked并阻止自动循环重试；解决冲突须另设明确重读/合并流程。本轮尚未提供该前端冲突处理页面，不自动覆盖远端。

能力缓存绑定现有library/epoch metadata；离线保存不做网络请求。普通本地草稿、首次种子catch-up、未知字段保留和原有业务命令队列沿用原所有权。此候选不切legacy聊天写入owner，不替换前端页面。
