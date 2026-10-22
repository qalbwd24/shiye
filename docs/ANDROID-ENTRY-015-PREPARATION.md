# Android 015-C：完整日记保存前准备

2026-10-18。新增独立模块`android/app/src/main/assets/entry-save-preparation.js`和合成测试`tests/android-entry-save-preparation.test.mjs`。本阶段仅准备与审计，不改editor、desktop-entry-adapter、content-algorithms、LocalStore、Gradle、0.14文件或设备；未接入生产保存、联网Repository、outbox或canonical写入。

## 接口

```js
prepareEntrySave(rawEnvelope, dirtyFields = {}, {
  previousUnits = [], previousLayout = null,
  media = null, timeZone = 'Asia/Shanghai', createId,
} = {})
```

同步纯函数，不读取库、不发RPC、不生成当前时间。接受完整Entry或`{entry,...外层字段}`与真正改动的字段。沿用desktop-entry-adapter白名单与实际richdoc/schema能力判断，不自行转换HTML/Markdown或sanitize后覆盖。

返回`rawOriginal`、`authority`、`capability`、完整`envelope`/`entry`、原`baseRevision`、`dirtyFields`及独立`derivedPlan`。成功时`prepared=true`且`capability.canPrepare=true`，仅代表本次合并及共用算法验证可完成；`stage='preparation-only'`、`canCommit=false`、`currentCanonicalEnabled=false`始终明确保留，不能据此调用旧本地写口或宣布业务PUT已验证。

`derivedPlan`内直接复用content-algorithms导出的真正`prepareDiaryUnits`、`reassembleDiaryUnits`、`projectDiaryParagraphMessages`，包含prepared.units/layout/issues/mappings、重组正文与只读段落投影；标记`authoritative=false,persist=false`。不把units/layout写进Entry，不双写body与规范消息。新候选ID只属于此计划，不能作为独立可上传正文身份；已有ID由共享previousUnits映射保留，不重造映射算法。

完整日期、独立附件、未知Entry/外层字段、媒体occurrence与insertedAt、原revision/contentEditedAt等不因表单重建丢失。显式null与缺失时钟保持差异；本模块不替未来Repository生成内容编辑时刻。准备调用方必须传入已确定的业务原件与真实时区/媒体上下文，未来写命令仍须单独确定内容时钟、验证业务字段、原子保存唯一权威及outbox后才返回ACK。

旧units存在时要求完整previousLayout；先验证entryId/sourceRevision及来源，再共用reassemble核对原body。旧布局过期、来源不同、重组失败均完整保留原件并阻止准备。HTML/Markdown、reading-document/bodyComplete=false、未知richdoc版本/节点/属性/外层版本、未知权威标记均只读。messageStore权威篇继续保留完整原件并只读，不把兼容Entry.body打开为第二编辑副本。

## 当前真实保存流程审计

editor.js现有save会在组词结束后提交adapter、比较明确dirty字段，用mergeEntryChanges保留式合并，再仅构造旧LocalStore支持的id/baseRevision/title/date/categoryId/tags/body及正文媒体refs附件请求；接到递增本地revision后更新内存基线。此路径尚未调用本模块。

LocalStore.saveEntry实际校验本地baseRevision、richdoc、YYYY-MM-DD与分类，attachments必须等于正文引用；空草稿走既有draft保存、已有空白覆盖拒绝。SQLite只持久支持字段，正文改变才推进contentEditedAt。它不是完整桌面信封持久化口，也不是远端base或outbox事务。现有desktop-entry-adapter对完整时刻、独立附件、扩展信封/canonical等提前只读的保护保持，不能因本准备模块能保真合并就移除。

## 验证

`node --test tests/android-entry-save-preparation.test.mjs tests/cross-device-content-contract.test.mjs`：6个定向测试全部通过，改动模块与测试ESLint/Prettier通过。

- 原共享fixture在Node桌面算法与真实Chrome（320×760）中，prepared/重组/段落投影逐对象一致；没有另一套Android分段或时间算法。
- 完整外层扩展、未知Entry字段、独立附件、毫秒日期、原revision、重复同图occurrence和时间均保留；输入fixture不变。
- 真正正文编辑使用previousUnits/layout时，ID、未知单元字段、共享mappings与桌面一致；过期/缺失旧layout拒绝。
- HTML、Markdown、canonical、部分只读投影、未知格式版本/节点/属性保留完整原件且无derivedPlan；revision不能从dirty字段伪造。
- contentEditedAt显式null与缺失分别同桌面算法一致，不被统一补值。

测试在`tmp/android-backend-015/entry/assets`复制实际facade及Gradle使用的共享算法/schema依赖，字节hash记录在`outputs/2026-10-18-android-backend-015/entry/browser-fixture.json`。测试只是隔离闭包装配，不改正式构建或编辑器，不读取个人库。原生SQLite事务、实际Tiptap输入/保存、新Repository、云同步与设备均未在本阶段重验。

模块冻结SHA-256：`DEDE09D102E4E3BAB91C16A600379E41F614BB21C28D4D113FB04F98250F72C4`。
