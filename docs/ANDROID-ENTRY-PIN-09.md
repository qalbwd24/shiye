# Android 思绪 Entry.pinned 薄适配

2026-10-17，按用户新增思绪列表置顶需求，仅在 `LocalStore.java` 接入电脑既有 `Entry.pinned` 布尔状态。桌面依据：`docs/DATA-MODEL.md` Entry 状态、`src/server/domain/entries.mjs` 的 `pinned: !!v.pinned`，以及 `public/features/context-menu.js` 的置顶/取消置顶。没有新增正文格式、置顶排序算法、共享模块或云端协议；列表呈现由本轮思绪列表 UI 负责。

## 已实现契约

本地 SQLite 数据库名保持 `shiye-local-v1.db`，内部 `user_version` 从 1 升至 2。新表及唯一明确的 1→2 升级都使用 `pinned INTEGER NOT NULL DEFAULT 0`；旧行按 false，其他列不重写、不删表。其他未定义迁移继续报错。此修改只进入源码，未打开或升级任何手机/AVD真实库。

新增 dispatch 请求：`{op:"setEntryPinned",id,baseRevision,pinned}`。`pinned` 必须是真布尔值；沿现有单请求事务检查当前 Entry revision，版本不符返回 `conflict` 并携带当前完整 Entry。不存在返回 `not_found`；meta 中的 pending draft 或已删除 Entry 返回 `invalid`。有效操作仅更新 `pinned`、`revision + 1`、`updatedAt`，返回同 ID 完整 Entry。revision 达到整数上限时拒绝继续写。调用方按返回 Entry 更新缓存，失败不乐观持久化；不自动吞掉冲突重放用户命令。

`entry()` 为 bootstrap/getEntry/exportSnapshot 的正式记录统一返回 `pinned` bool。`saveEntry` 仍只更新原有正文列，不消费请求中 `pinned`，所以新旧正文自动保存均不能清除此状态；保存须使用置顶后最新 revision。空白临时草稿仍在 meta 中且不可置顶，第一次有效内容提升沿旧 ID 并使用默认 false。

## 定向证据

20 项真实 SQLiteJDBC/JVM 定向通过：新库默认值、合成 v1 原表迁移及 3 旧行字段保持、置顶/恢复同 ID 版本变化、正文/date/category/tags 不变、旧 revision/漏 revision 冲突、严格 bool、旧正文保存冲突、当前正文自动保存即使传入 false 也不覆盖 true、pending draft/deleted 拒绝、关闭重开、snapshot bool、最终 schema 2。

fixture 编译和执行实际产品 `LocalStore.java`，只用 Android API 薄 adapter 与真实 SQLiteJDBC。0.7 helper 未模拟 schema 版本，本轮在专属临时副本补齐 `PRAGMA user_version` 和事务升级流程，再以合成数据库重建旧 entries 表执行真实 ALTER；未修改原 fixture 或其他产品 Java。SQLiteJDBC 3.46.1.0 与 SLF4J API 1.7.36 从 Maven Central 官方仓库下载，仅供测试，来源/SHA-256 存入清单，不打包产品。SLF4J 缺少 logger binding 的 NOP 提示不影响测试。

产品源码校验 SHA-256：`b8bff49a0135e7843fdbf2d9c05104853144c065c5bbdf9e76bea9ff33462d46`。若并行会话后续改动本文件，应重新取 hash，不能将本次结果称为后续版本全量验收。

- 通过回执：`outputs/2026-10-17-android-diary-list-09/pin/jvm-pin-report.json`
- 来源和哈希：`outputs/2026-10-17-android-diary-list-09/pin/source-manifest.json`
- fixture/adapter/classes/测试依赖与合成库：`tmp/android-diary-list-09/pin`

本轮未跑全库、AVD/手机或正式升级；真实 Android SQLiteOpenHelper 生命周期和 UI 操作由主会话后续候选验收，不将 JVM 测试等同设备运行完成。同步 Repository/完整 Entry 封套仍按现有跨端计划后续实施。
