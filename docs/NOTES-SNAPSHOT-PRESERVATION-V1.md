# 便签界面快照保真编译候选

2026-10-19。源码与合成验证候选；未接正式便签API、未迁移真实资料、未部署后台或APK。便签保持独立文档，不强套Entry/canonical，不参与朝花夕拾，不定义正式Note schema。

## 输入事实

`public/features/notes-workspace.js` 的 `exportDrafts()` 当前实际输出 `kind:'shiye-notes-ui-snapshot'`、`experimental:true`、`exportedAt`、`workspace`、`assets:[{id,name,type,dataUrl}]`，**目前没有version字段**。`dataUrl`来自FileReader读取真实Blob，正文与背景持久引用采用assetId；临时blob URL不能替代原件。

编译器接受上述实际格式，及显式`version:1`的同字段格式；其他显式版本拒绝。workspace.revision源于工作台保存版本；当前未落盘窗口可能没有revision，因此缺失时必须由调用方显式提供`options.snapshotRevision`，不猜时间或自动补零。两者均有且不一致时拒绝。sourceId必须由调用者指定稳定来源，建议每个profile/工作台一个源，不能用导出时刻随机生成。

## 接口

`src/server/sync-product/notes-snapshot.mjs` 导出同步纯函数 `compileNotesSnapshot(input, {sourceId, snapshotRevision?, limits?})`。input为惰性JSON对象、JSON字符串或UTF-8 Buffer；不读取磁盘、网络、数据库和设备，不执行用户原始内容，不写回原对象。对象输入仅接受普通JSON值，拒绝getter、函数、toJSON和循环。

返回 `{schema:1,sourceId,snapshotKind:'notes',snapshotRevision,sourceSha256,captureInfo,records,assets,coverage,issues:[]}`。records是单个既有profile记录，scope=`notes-workspace-snapshot`、`_product.readOnlyProjection=true`。workspace原样保留正文、未知字段、草稿、原便签ID、标签顺序、选区和滚动状态；外观值只保留，绝不自动应用。

`sourceSha256`对sourceId/revision/workspace及按传输ID排序的原件身份、实际hash/size、MIME和名称作键排序规范JSON后计算SHA256，排除volatile exportedAt。重复点击现有exportDrafts导致导出时间变化时逻辑hash与records保持一致。导出时间仅在`plan.captureInfo.exportedAt`保留，不写profile；根集成按相同sourceSha256回执no-op，因此不会因时间变化制造业务更新。captureInfo若由上层作为首次provenance存档，重复提交不覆盖首次值。正文或原件业务元数据变化仍产生不同sourceSha256，同revision异hash由上层冲突检测处理。

`assetMapping[].sourceMetadata`保留原asset对象除原件编码/字节及明确私有元信息外的完整惰性JSON：id/name/type、未知普通字段、可选size/sha256均保留。dataUrl/base64/rawBytes/bytes/blob不复制入记录，路径/认证/本机恢复字段通过元信息过滤排除，coverage.excluded只报告路径/原因，不含值。原name是字面文件名称，不按URL过滤或自动执行。sourceMetadata同时参与逻辑sourceSha256，因此同revision改名可检测冲突，新revision同字节改名可保真；assetId仍仅由稳定来源、原ID和实际字节SHA生成，改名不重造ID。传输原件库保留首次名称也不影响映射内最新源名称，统一提交不可仅因名称不同拒绝相同assetId/字节。

profile身份为`profile:notes:SHA256(sourceId)`；快照身份为`notes-snapshot:SHA256(JSON([sourceId,revision]))`。同一来源后续revision复用profile身份；source/revision相同必须由上层保持同一逻辑快照，注册冲突检测不由本纯编译器承担。

assets输出 `{assetId,sha256,size,mime,name,bytes:Buffer}`，不含目录路径或dataUrl。assetId为`notes-asset-`加`SHA256(JSON([sourceId,originalAssetId,contentSha256]))`，遵守现有media.safeId与Android ProductOriginals.Spec的`[A-Za-z0-9][A-Za-z0-9_-]{0,127}`。独立命名空间及源隔离避免与diary原件或另一工作台同名原件混淆。profile中的`assetMapping`保存原assetId到传输assetId与真实SHA/size；workspace保留原ID，通过映射解析。`_product.refs.assets`登记所有导出原件，包括当前未引用但仍被exportDrafts保留的原件。不把base64写进profile正文，不根据name读写文件。

## 校验与容量

所有assetId引用（包括背景和未知结构内的assetId）都必须有真实解码原件；image/video节点不能缺assetId。缺原件、重复身份、悬空tab引用、临时blob URL或内联base64资源、非严格base64、MIME声明冲突、声明size/hash与实值不符，以及sha256源ID与实值不符，均整plan拒绝，无部分应用。SHA/size由实际字节计算；未声明size/hash的当前导出同样计算。媒体MIME是导出声明的一致性验证，不是文件安全鉴定或自动执行许可。

默认上限JSON 48MiB、单原件20MiB、所有原件32MiB、2048原件、JSON深度128/节点200000。limits可逐项收紧，不能放宽。该输入是有界JSON草稿导出，未设计GB级base64处理；后续.syseed包装复用独立原始bytes，不把JSON容量伪装成流式大包能力。

coverage只声明本次快照保真完成，`completeComputerExport:false`、`productionNoteSchema:false`、`participatesInRevisit:false`。未验证快照跨多个来源采集的一致时刻；未接持续变更登记、正式便签编辑或手机界面使用。本函数不会据文件名、未知字段或旧运行状态把“完整电脑同步”标记为true。

## 定向证据

`node --test tests/notes-snapshot.test.mjs`：14项合成测试通过，覆盖实际格式/显式v1、对象/字符串/Buffer、逐字段保留、稳定源与快照身份、多源资源隔离、孤立原件、缺件/错误引用、严格base64、hash/size/MIME、临时URL、容量、惰性JSON不执行，新增重复导出时间变化幂等hash、现有media/原件runner安全ID兼容及同字节改名ID保持/源元信息保留/逻辑hash变化。未读真实库、未操作设备、未修改前端；集成与API由根会话另行完成并回执。
