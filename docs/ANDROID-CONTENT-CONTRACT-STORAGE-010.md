# Android 0.10 长文内容时钟与现有格式薄适配

2026-10-18。依据 [电脑内容契约](DESKTOP-ANDROID-CONTENT-CONTRACT.md)、`src/server/domain/entries.mjs`、`public/shared/limits.js` 和现有 renderer/schema 的实际校验，本阶段只修改 `LocalStore.java`。不新造正文/切分算法，不实现完整原始 Entry 信封、独立附件表或跨设备同步，不改后端及共享 JS；手机、AVD和正式库均未由本子任务操作。

## 已实现范围

- SQLite schema 升为3，保留数据库原文件名。新库 `entries.contentEditedAt` 为可空 TEXT。v1→3先执行原v2的 `pinned` 增列，再执行v3内容时钟增列；v2→3仅增内容时钟列。仅新增列一次性按每行原 `updatedAt` 回填，旧 `updatedAt/body/revision` 等不改。已是v3的显式NULL不回填，继续表示未知。迁移由 SQLiteOpenHelper 原事务管理。
- 新篇/新草稿显式初始化内容时钟。旧草稿meta信封缺字段时只在读取DTO按原 `updatedAt` 保守补；显式null保持null，不自动更新未知时间。保存正文使用已有 `jsonEquivalent` 深比较，忽略对象key顺序，保留数组顺序、字符串空白和节点身份差异。真实body变化才推进 `contentEditedAt`；标题、分类、标签、日期、置顶和删除等属性写口不推进它。显式null在属性修改和重开后保留，实际正文编辑后才获得真实新时钟。没有把置顶的 `updatedAt` 当新的正文时间；既有 `updatedAt` 行为不在此阶段全面重定义。
- 完整Entry及摘要DTO都返回 `contentFormat:'richdoc'`、`contentEditedAt` 和 `attachments`。附件清单仅从现有body的image/video节点真实 `assetId` 提取，按首次出现顺序去重；同资源多次出现仍各自保留body的occurrenceId/insertedAt，清单不代表位置，也不把文件重造内联节点。
- 保存未提供attachments时兼容原安卓编辑器；若显式提供，则要求是字符串数组且集合与body媒体引用相等。多余独立文件、缺少正文引用、错误类型均返回 `unsupported`，事务不修改原件，避免普通文件被忽略后丢失。显式非richdoc格式也拒写；不自动降级其他正文。
- 已核实上限对齐电脑：正文50,000节点、节点深度64（顶层0）、标题≤500 UTF-16单元、标签≤50且单项<100。标签按原字符串精确去重，不trim、不裁剪，合法空串/前后空白保留。长文body保存增加电脑现有2,000,000 UTF-16字符检查；旧超限文档仍原样可读，写入拒绝而不裁剪。底层现有消息写口的字节上限没有擅自重定义。

## 明确边界

本阶段只做已有可验证范围。Java现有ID校验仍较严格（最多100、字符范围较小），电脑允许的一些blockId/occurrenceId/assetId仍可能被本地写口保守拒绝；未知版本/节点/属性继续拒写，原读取对象不截断。这不等于完整renderer/schema已由Java复刻或所有旧Entry可编辑。完整原始信封与独立附件存储待后续单独适配；现有assets的本地mime字段仍需外层映射到电脑type，不能把本DTO字段补齐称为同步完成。

## 定向证据

`tmp/android-content-contract-010/storage/StorageContractQa.java` 复用先前pin测试的Android API→SQLiteJDBC薄适配，只创建合成数据库，未打开用户库。37项通过，结果见 `outputs/2026-10-18-android-content-contract/storage/qa.json`：

- v1/v2升级后原行body、updatedAt、createdAt、revision、标题/分类/标签等逐值保持；pinned默认/既有状态保留；schema为3及新增内容时间等于原updatedAt。
- 新篇/草稿内容时钟；标题、分类、标签、置顶不推进；对象key顺序不误判；实际正文推进；显式NULL及旧草稿缺字段/显式NULL重开保留。
- 独立附件、缺少内联引用和无效附件类型拒写；同图多处仅DTO去重，body出现保持；未知body拒写且原件保持。
- 标题500/501、标签50/99/100与空白空串、50,000/50,001节点、64/65层及64层空段落边界。

最终LocalStore针对Android36 API编译通过。Java8过时提示、SQLiteJDBC无日志绑定提示是工具环境提示，测试通过不等于安装库迁移/真实端侧存取已验。根会话负责0.10打包及AVD对照，手机维持用户正在测试的版本。编译/源码SHA回执位于同产物目录；JVM类、测试脚本和合成库全部位于指定tmp目录（已有pin适配器与jar只读复用）。
