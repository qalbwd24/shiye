# 客户端逻辑偏好快照 v1

2026-10-19后端候选；纯编译模块 `src/server/sync-product/preference-snapshot.mjs`，不读取本机路径、WebView/localStorage，不应用UI偏好，不安装或启动程序。真实来源的显式快照收集与服务器内部事务提交由独立接线负责；本契约不代表已导出电脑全部资料。

## 输入与编译

`compilePreferenceSnapshot(snapshot)`接受完整纯JSON对象：

```json
{
  "format": "shiye-client-preferences",
  "version": 1,
  "sourceId": "desktop:stable-source",
  "revision": 1,
  "namespaces": {
    "shiye.android.diary.presentation.v2": {
      "futureSetting": { "preserved": true }
    },
    "shiye.desktop.application.preferences.v1": {
      "shortcuts": { "key": "Alt+T" }
    }
  }
}
```

`sourceId`由来源维护，使用现有产品身份字符集`[A-Za-z0-9_:@.-]`、1–160字符；不同设备不得临时冒用同一个源ID。`revision`是该来源快照的正安全整数，不是同步服务器revision，不使用墙钟替代。顶层只允许上述五字段；新增顶层协议字段须明确升版或兼容契约，不能静默忽略。

namespace身份为1–160字符、小写字母开头，后续小写字母/数字及点、下划线、连字符分段；每个值是完整JSON对象或数组，保留原类型与数组顺序。允许未知namespace，未知键和嵌套数组/空值完整保留。当前声明`shiye.android.diary.presentation.v2`、`shiye.android.diary.entry-image-width.v1`、`shiye.desktop.application.preferences.v1`、`shiye.desktop.chat.presentation.v1`、`shiye.desktop.notes.presentation.v1`；声明仅说明来源范围，所有记录仍只读、不自动执行或应用。安卓presentation新增默认标题、工具栏或图片参数不需要后端按UI白名单重建。

前端UI022已确认entry-image-width.v1实际值为最多100个`{id,width,...未知键}`的数组，后端不强行包成对象或改变稳定entryId。后续以entryId+occurrenceId标识的单图sidecar键尚待前端定稿，按未知命名空间保留能力接续，不能先宣称已采集。上述键实际仍在localStorage，需要显式快照收集才进入种子。

最多64个namespace、100000个JSON节点、64层深度、输入规范JSON不超过4MiB；每条最终产品record不超过950000 UTF-8字节。超限明确拒绝整个编译，不截断字段或只返回部分namespace。不接受undefined、非有限数、BigInt、Date/类实例、函数、Symbol、getter、非枚举字段、稀疏数组或循环引用，避免JSON序列化时静默丢值或执行代码。

## 输出、身份与hash

```js
{
  schema: 1,
  sourceId,
  snapshotKind: 'preferences',
  snapshotRevision: input.revision,
  sourceSha256,
  records, // 无服务器revision的productRecord
  coverage,
  issues: []
}
```

每个namespace编译成现有`profile` kind/entityType。实体ID固定为`profile:preferences:`拼接`SHA256(UTF8(JSON.stringify([sourceId, namespace])))`，源revision或内容变化不换ID，不同source/namespace保持隔离。data包含`scope:'client-preferences'`、`schema:1`、`sourceId`、`namespace`、`snapshotKind:'preferences'`、`snapshotRevision`、`sourceSha256`与完整过滤后`values`；`_product.readOnlyProjection=true`。既有`productLibraryView().profiles`可原样往返，未新增前端存储权威。

`sourceSha256`绑定完整原输入：对象键递归按JS字符串比较排序、数组顺序保持，再以`JSON.stringify`编码UTF-8并SHA256。对象插入顺序与原文件缩进不影响hash；输入revision或任何原值变化影响hash。它是规范内容hash，不是原文件字节hash，也不是签名/游标/可信来源证明。已知凭据虽被排除，hash仍绑定其原值；不得把该hash当凭据安全审计或公开认证材料。编译器不比较旧revision；内部提交层负责同源revision/hash的幂等、冲突与回退约束。

## 私密与展示边界

所有namespace共用既有`portableConfiguration()`，剔除已知凭据字段、设备窗口/DPI/私有路径及原始归档；HTTP(S)配置URL剔除用户凭据和已知凭据query。`excluded`只包含配置路径与原因，不包含原值。未知普通字段保留。此过滤只覆盖已知字段名与明确URL结构，不能承诺识别任意暗藏密码。

coverage记录每个namespace的只读归属、字段数与排除项，固定`completeComputerExport=false`、`automaticApplication=false`；本机壁纸继续`device-local`，表情元数据继续`shared`。保留配置值不等于覆盖另一设备壁纸/窗口，也不执行命令映射或程序参数。未知namespace保留只读，未来应用须通过独立明确的适配口。

## 验证边界

`node --test tests/preference-snapshot.test.mjs`覆盖完整namespace/product profile往返、未知键/未知namespace、共享凭据过滤、稳定身份与规范hash、非法JSON/身份、容量与深度。没有读取真实偏好、操作前端localStorage、运行正式进程或导入正式资料。
