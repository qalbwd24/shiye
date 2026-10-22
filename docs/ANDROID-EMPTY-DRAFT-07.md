# Android 0.7 空白编辑草稿与正式日记边界

2026-10-17，源码候选。用户要求已有自动保存保留，新建空白日记不能成为正式日记，现有数据不能删除。此文件只记录 LocalStore 部分；页面、Activity 集成和实际安装由本轮主交接记录。

## 接口与存储

- `createEntryDraft`：沿用原默认分类算法、原 richdoc v1 空段落，生成稳定 UUID、revision 1。完整临时编辑信封写入现有 SQLite `meta` 的 `draft:<UUID>`，返回 `draftOnly:true`；不写 `entries`。
- `getEntry {id}`：优先读取正式日记，其次读取同 ID 临时草稿。草稿在关库重开后仍可用原 ID 读取。`bootstrap` 列表和 `exportSnapshot.entries` 不包含草稿；恢复编辑入口需要调用方保存当前 ID，此接口不新增草稿列表。
- `saveEntry`：仍要求 `baseRevision`，继续检查日期、分类、标签、完整 richdoc 和媒体引用。空白临时草稿只更新原 meta 信封并返回递增 revision；第一次有内容时以同 ID、原 createdAt 写正式 entries、递增 revision、移除 meta。正式返回省略 `draftOnly`。所有 dispatch 操作保留既有同步方法和事务边界。
- `discardEmptyEntryDraft {id}`：关闭前自动保存完成，再显式调用。仅重新确认没有正式 entry、meta 草稿依然无内容后删除这一条 meta；不操作 entries、媒体表和原件。同 ID 已正式保存或草稿不存在时返回 `discarded:false`。可选 `baseRevision` 若给定必须匹配，否则 conflict。
- 正式日记被清空的保存返回 `empty_entry` 和 `current` 原件；拒绝覆盖，保留既有正文/版本。不自动删除或自动恢复编辑器。历史已经为空的正式行也不删除，空白覆盖同样拒绝。
- 原 `createEntry` 为种子及既有兼容调用保留；它不是新日记 UI 入口。未新增表、未提升数据库 version、未做 schema/旧数据迁移。Android 仍为既有离线 SQLite 原型，不代表已完成与电脑的最终存储统一或同步。

## 与电脑内容判定一致

实际依据为 `public/shared/quick-capture.js` 的 `hasQuickContent`，不是按字数/预览字符串推断：

- 标题按 ECMAScript trim 后有字符即算内容。
- richdoc 递归节点仅正文文字在移除 U+200B/U+FEFF 并 trim 后非空，或 image/video 节点算内容。
- 全角缩进、NBSP、JS 全套空白、换行/hardBreak、横线、空任务（含已勾选）、空列表/空段落，以及分类/日期/标签均不算内容。
- 零宽标题 U+200B 按电脑现有规则算有标题；正文 U+200B 不算。U+0085 不是 ECMAScript trim 空白，两端均算正文。这些边界保持实际算法一致，不擅自扩大清理。
- 媒体出现前仍执行原验证：已有 asset、匹配 MIME、稳定 blockId/occurrenceId 和 insertedAt 等属性，不接受为满足“有内容”而伪造媒体引用。

对齐范围为当前Android能表达的标题与richdoc正文。电脑版还把独立`attachments`视为有内容；Android尚未接完整Entry独立附件信封，因此这21组不能证明所有桌面Entry已能无损往返，也不替代统一消息切分/远程版本/分类映射的后续适配。

## 本轮定向证据

产物：`outputs/2026-10-17-android-diary-editor-07/empty/`。临时脚本、编译类、依赖和隔离合成数据库：`tmp/android-diary-editor-07/empty/`。

1. 生产 `LocalStore.java` 使用本机 Android API 36 android.jar 离线 javac 编译通过。
2. `desktop-meaningful.json`：实际导入电脑 `hasQuickContent`，21 组共享合成 fixtures 均符合预期。
3. `java-meaningful.json`：反射调用生产 Java 实际私有内容判定，同 21 组 fixtures 全一致。
4. `store-jvm-report.json`：生产 `LocalStore.dispatch` 配合临时 Android API 薄适配运行真实 SQLite JDBC，全新合成库 24 项通过。覆盖不入正式列表/导出、空白自动保存 ACK/revision、分类日期标签、关库重开、旧版本冲突回滚、首内容同 ID 提升、清空正式篇保护、标题/图片/视频单独提升及身份保持、关闭不删媒体原件、可选关闭版本冲突、格式错误回滚、旧 createEntry 兼容、三篇原合成种子未改、提升后 meta 移除。

JVM 薄适配只复现当前代码使用的 Android 数据库 API，并使用 SQLite JDBC，不能当成 Android framework、WebView、Activity 生命周期、IME、AVD 或手机实测。没有访问 ADB、手机、真实日记库，没有跑全库检查或安装。本轮 Java/JS 与事务证据只覆盖上述受影响路径。
