# Android 019 日记 ProductRepository 适配

2026-10-19，`android/app/src/main/java/dev/shiye/app/ProductDiaryStore.java` 是独立的原生接缝。本文件记录其代码边界；正式页面、设备、网络、真实导入和持续同步由主任务另行接线与验收。

## 接口

在同一个 `LocalStore` 的 `ProductRepository` 实例上构建：

```java
ProductDiaryStore diaries = new ProductDiaryStore(repository);
JSONObject record = diaries.read(entryId); // 完整 record，含 local/base/unknown/canonical
JSONArray rows = diaries.list();             // 由权威 record 当次派生的列表摘要
JSONObject saved = diaries.save(preparedRecord, dirtyFields, expectedLocalRevision);
JSONObject imported = diaries.preserveLegacyEntry(preparedRecord, legacyId);
JSONObject mapping = diaries.legacyMapping(legacyId);
JSONObject queued = diaries.queueLocalOnly(entryId, expectedLocalRevision);
```

`preparedRecord` 必须是 Android WebView 复制的共享 `prepareProductEntry` 返回值 `{entityType:'journalAggregate',entityId,data}`，不是旧 SQLite `entry()` 的窄 DTO，也不是 `prepareEntrySave` 的预览计划。调用方应把完整旧 record 作为 `previousRecord` 传入共用算法，生成新的 canonical unit/layout，并把用户实际修改字段作为 `dirtyFields`。元数据编辑不改 `contentEditedAt`；旧 HTML、阅读投影、聊天归篇或缺失 canonical 被拒绝保存，用户仍可查看完整原件。

`read` 返回的 `record.local.data` 才是完整本机权威；`list` 每次从 Repository 记录派生，不维护可能在 pull 后失效的第二张索引。`save` 在无库身份或尚未显式排队的 localOnly 记录时以 `Tx.preserveLocalOnly` 提交，允许离线新草稿保留。已绑定库的可上传记录走专用 `ProductRepository.enqueuePreparedEntryIntent(intent,expectedLocalRevision,preparedRecord,commit)`；普通 `enqueueIntent` 继续拒绝 canonical 的直接修改。该专用方法已由主任务加入 Repository，并验证候选完整 data 与 intent 一致；不能以全局取消 `CANONICAL_PREPARATION_REQUIRED` 替代。`save` 仅返回本地持久 ACK，不代表服务端已确认。

`LocalStore.dispatch` 已接 `productEntryGet{id}` 与 `productEntrySave{preparedRecord,dirtyFields,expectedLocalRevision,legacyId?}`。两者在旧 dispatch 外层事务之前分流，由同一 Repository 负责真正事务。`bootstrap` 合并产品 Entry 与 category taxonomy，产品同 ID 取代旧列表摘要；旧行保留。`getEntry` 优先返回产品投影，旧 `saveEntry` 遇产品篇拒绝双写；原生置顶/删除对产品篇用完整 data 的元数据修改与专用 intent，保持正文/canonical/contentEditedAt。`productEntryGet.entry` 是隐藏传输注解的 UI 投影，`record.local.data` 保持全部原件；UI 类别 ID 可指 `_product.refs.category`，不得把显示值自动回存覆盖原数据。wrapper 的 `sourceId` 与 ProductChatStore 共用 `chatSourceId019`。旧 `exportSnapshot` 新增完整产品 records/pending/meta/conflicts/mappings 的保存字段，但 `productRestoreSupported=false`；它仍不是媒体原件齐备的可恢复产品备份。

旧 `createEntryDraft` 仍在旧表暂存空草稿；`productEntrySave` 收到首次空白草稿时返回 `emptyDraft:true`，不建立空产品篇，关闭可继续走 `discardEmptyEntryDraft`。首次有实际标题或正文才保存到 Repository，旧行仍不删。已有产品篇的原生置顶/删除走完整信封元数据更新；删除目前是 `data.deleted=true` 的软删除，产品同步实体 `state=deleted` 的独立协议语义尚待主任务决定和验证，不应称为永久删除或墓碑。

`preserveLegacyEntry` 只处理调用方显式指定的单篇，`legacy-entry` 映射与完整 localOnly 信封在同一 SQLite 事务提交；不遍历旧表，不读取正式库，不自动上传。`queueLocalOnly` 在配对身份与初次收件检查完成后，逐篇显式把保留的完整信封排入创建队列，不把旧数据伪装成 remote base。调用前由主任务从旧 `LocalStore` 安全读取一篇并调用共享 prepare；旧行、草稿、附件原件保持原位。ID/分类/标签不能按名称重造：准备结果的 `_product.refs.category/tags/assets` 必须采用稳定业务 ID。旧本机分类数值 ID 到 taxonomy ID 的映射由接入层明确持久化；没有映射时先保留 localOnly 或只读，不伪造 refs。

## 守卫与仍需主任务完成的部分

- 本适配只做保守形状与保存差异检查。富文档节点、canonical 重组和 HTML 一致性由共用 JS `validateProductRecord` 在准备阶段执行，Repository 专用入队端口还须核实该结果与 intent 逐字段一致；原生形状检查不能冒充完整共享算法。
- `prepareProductEntry` 的 `media` 参数不能默认为空后仍宣称含图旧篇已安全保存；适配层拒绝 canonical `issues` 中的 `missing-media`。仅改 metadata 时应复用旧 `_canonical`/`messageUnits` 与原正文，而非重新运行拆分：合成样本实测重跑会把原媒体标成 missing-media，并无谓更新 layout/mappings。
- 现有 `ProductRepository.Tx.preserveLocalOnly` 支持未配对完整信封与后续本机修订，但不会自动上传。首次包/snapshot 后须由主任务检查同库身份、重复业务 ID、分类/媒体依赖与服务基线，才可逐篇调用 `queueLocalOnly`；不能将旧资料伪造成 remote base。
- 远端 pull 可直接写 `ProductRepository`，但主任务需让 UI 每次从完整 `record.local` 投影，不能继续调用旧 `LocalStore.saveEntry` 回写窄字段。若接在现有 `dispatch` 的外层事务中，应使用 `ProductRepository.inCurrentTransaction`，而不是嵌套调用 `transaction`。
- 媒体原件/附件离线状态、超大 Entry payload、分类和标签 taxonomy 并库、旧 HTML 可读入口、冲突与迟到 ACK 的页面呈现、真机存储恢复不属于此独立适配本身。

当前验证：`node tools/verify-android-sync-contract.mjs` 对 9 条合成记录通过；Android 主工程 Java 编译通过。主工程普通编译首先被已有 `verifyProductContent` 的共享源码 stage 过期拦住，针对本适配的编译跳过了两个旧资产校验任务，日志在 `tmp/android-integration-019/diary-adapter/javac-isolated.log`；不能把这说成完整 APK 构建通过。独立 `ProductDiaryStoreProbe` 合成 Android SQLite QA APK 已编译成功，运行需主任务在隔离 AVD 执行，本子任务未使用 ADB；运行结果尚待回填。定向验证清单与 hash 在 `outputs/2026-10-19-android-integration-019/diary-adapter/verification.json`，临时工程和日志在 `tmp/android-integration-019/diary-adapter/`。未部署手机或模拟器。
