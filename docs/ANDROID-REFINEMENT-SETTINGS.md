# Android 0.5 原生设置与分类

2026-10-17。用户要求补全可用设置和写作分类入口，延续电脑偏好组织方式；不是只改外观。当前两文件实现完成并经 JDK/Android 36 javac 编译；尚未 APK 安装或实际 UI/SQLite instrumentation 运行。本子任务不操作 ADB/手机，不修改 MainActivity、DiaryListPage 或 TelegramFrontend，接入由主代理负责。

## 设置层级

`AppSettings(MainActivity).show()` 打开全局设置。首页三项：

- 启动与写作：启动时打开、分类管理（含排序草稿）、新日记默认分类、思绪列表刷新。
- 思绪外观：委托已有 DiaryAppearance，独立壁纸偏好，不修改正文。
- 数据与关于：导出思绪与先前记录、查看先前随想、关于。

分类管理返回“启动与写作”，后者/数据页返回“设置”，设置首页关闭回原入口。底部返回按钮与 Android 返回键走同一父级，不跳到无关首页。启动/默认分类/刷新选择器、分类新增/改名/删除确认均为当前页子对话框，取消回真实父页。保存失败保留输入并显示错误。全局 show() 最外层关闭时，若仍处 home/tab0 且日记列表实例存在，调用其 refresh(false)，让新增/改名分类及筛选立即更新；同 Activity 对话框关闭不会自行触发 onResume。showCategories 则只走自身桥 callback。

`showCategories(Runnable callback)` 供编辑器直接进入分类管理；callback **只在最外分类管理关闭时触发一次**，不因子对话框关闭、改名或删除切换而触发。编辑页应先 flush，管理结束后重新 bootstrap/getEntry，处理可能推进的 revision，不能拿旧 categoryId/revision 保存。

## LocalStore dispatch 契约

所有下列操作继续由已有 dispatch 的串行 SQLite 事务包围，返回值只有 endTransaction 成功后才由调用方收到：

| op | 输入 | 返回/效果 |
| --- | --- | --- |
| createCategory | name | `{id,name}`；trim 后 1–80 UTF-16 字符，拒绝控制字符和忽略大小写同名 |
| renameCategory | id,name | `{id,name}`；稳定 id；不重写日记正文/版本 |
| deleteCategory | id | `{id,deleted,affectedEntries,affectedRooms,defaultCategoryReset,writingPreferences}` |
| getWritingPreferences | 无 | 原始 `{version:1,revision,defaultCategoryId:string|null,categoryOrder:[id],...}` 对象 |
| saveWritingPreferences | defaultCategoryId:string 或 null | 原始偏好对象；引用必须存在；保留未知已有偏好字段 |
| saveCategoryOrder | categoryOrder:[id],baseRevision | 完整分类ID数组；单事务检查版本并保存，返回原始偏好对象 |
| bootstrap | 既有输入 | 原有字段不变，新增 `writingPreferences`；categories 按 categoryOrder 派生排列 |

默认分类保存于原生 SQLite.meta 独立 key `android-diary-writing-preferences-v1`。选择原生 meta 而非分开 SharedPreferences 的原因是：删除分类、清引用、纠正默认值必须同一事务原子完成。没有 schema/version 迁移，不改其他 meta。

删除分类不删记录：entries（含软删记录）categoryId 置 null，仅 revision+1；updatedAt/createdAt/date/body/tags/图片 occurrence/insertedAt 全部不变。分类改名也不修改日记内容时钟。此项按最新 [数据对齐契约](ANDROID-FRONTEND-DATA-ALIGNMENT.md) 修正早期“推进 updatedAt”的安排，避免后续无手打时间的内容兜底变成分类操作时刻。旧 rooms.categoryId 也置 null 以满足既有外键，不删旧会话/消息。若删除项是默认分类，同事务将默认值置 null。不存在 id、重复名、非法输入会抛现有 StoreException 并回滚；旧编辑页继续保存触发 revision conflict，避免复活已删分类。

saveEntry 只修改分类、标签或 date 且标题不变、body 结构等价时，revision 仍推进，但保留旧 updatedAt。结构比较忽略对象键顺序，保留数组顺序与字符串全部空白；标题或正文真实改变才推进 updatedAt。当前本地没有服务端独立 contentEditedAt 字段，这是避免元数据污染内容时钟的本地兼容处理，不表示全云契约已接通。

createEntry 缺少 categoryId 或传空字符串时走默认分类；显式 JSON null 强制未分类；有效具体 id 优先。saveEntry 原分类清空/验证语义保持。没有用户设置时默认未分类，已有新篇行为保持；无效/已不存在的默认引用读取为 null，不阻断写作。

## SharedPreferences 与根代理接入

- `startup` 仍使用已有 chats/write/last；选择器实际 commit 完成后提示下次生效。
- `diary-refresh-mode` 使用 auto/manual，默认 auto；设置说明“自动：回到前台时更新”或“手动：点击刷新按钮更新”。列表实际自动/手动刷新由根代理接入，不宣称只保存偏好就完成刷新行为。
- 默认新篇分类无需根代理自己读 SharedPreferences：startNewDiary 继续传空字符串即可由 LocalStore 使用默认。显式选择列表分类的 id 优先。
- MainActivity 的 homeMenu/WebRPC showAppSettings 委托 AppSettings.show；showCategories 包装编辑器请求时，需在外层 callback 中刷新数据并返回完成 ACK。

## 导出边界

继续调用已有 exportBackup：只含本地思绪、先前原生随想及其媒体；**不包含新版 Telegram 随想，也不包含独立外观设置**。界面与关于页明确说明，不能称完整备份、已同步或已恢复。没有清理/清库/批量删除入口。

## 验证与产物

源码：`android/app/src/main/java/dev/shiye/app/AppSettings.java` 与 `LocalStore.java`。编译中间文件 `tmp/android-refinement/native/classes/`；合成事务 instrumentation 源码与 manifest 在同目录的上层，使用每次 UUID 独立数据库/媒体命名空间，不打开实际原库。当前仅编译准备，不是运行通过。

后续定向验证：新增/重复拒绝/改名 id 稳定；设置默认后快捷写；删除分类保留正文和旧消息、默认纠正、旧 revision 冲突、无关篇精确保持；重开偏好；全局设置和分类页返回父级；列表 auto/manual 真正生效；编辑分类管理结束刷新。只用 QA 前缀合成记录，不重跑旧无关矩阵。正式回执目录 `outputs/2026-10-17-android-refinement/native/`，临时 `tmp/android-refinement/native/`。

定向 QA 准备已建 `tmp/android-refinement/qa/`，回执输出 `outputs/2026-10-17-android-refinement/qa/`；ADB 必须有根代理正式交接、`--run` 与 `SHIYE_REFINEMENT_QA_HANDOFF=emulator-5554`。`native/build-category-test.ps1` 只打包合成 instrumentation；`qa/category-store-check.mjs` 等 0.5 安装后才可运行（26 个 SQLite 不变量断言），当前未打包运行/未调用 ADB。后续实际 UI 聚焦分类管理→默认新篇→删除后正文及时间保持、父级返回、设置关闭分类 chips 刷新及 auto/manual、合成文件 native 保存取消与实际 bytes hash；不重跑旧无关矩阵。最终继续保护原 SQLite/IDB/媒体并留默认列表。

## 分类排序草稿与并发保护

依据 QUICK-REQUIREMENTS-AUDIT「基本输入与窗口」原确认：分类排序不用拖动，提供搜索、上移/下移/置顶/置底/指定序号，草稿预览后一次保存。分类管理中新增“调整排序”子页，所有移动与搜索只操作内存草稿；保存才调用一次 saveCategoryOrder。返回未保存草稿有继续/放弃确认，不会自动提交；外层分类 callback 不因排序子页切换触发。

categoryOrder 是写作偏好内的稳定分类ID数组，不改分类行 id/rowid；旧偏好没有此字段时，读取沿原 rowid 顺序派生，缺失ID追加、删除ID移除，其他未知偏好字段保留。bootstrap.categories 使用该偏好派生排序，原列表、编辑器和默认分类选择共用顺序。新增分类同事务追加到末尾，删除分类同事务移除自己，旧行不重排。

偏好 revision 缺失按0，保存默认分类、分类增删/改名及保存排序都会在同事务推进。saveCategoryOrder 必须提交读取时的 baseRevision 和完整、无重复的当前分类ID集合。版本不一致返回 conflict；排序草稿保留，并给“重新载入排序”显式放弃后读取最新，不自动重发或静默覆盖。重复/缺失/失效ID被拒绝，事务不落部分顺序。此为既有 native meta 的向后兼容字段扩展，不另建云端 schema。

新增隔离断言覆盖排序一次提交/派生结果、旧版本拒绝、无效草稿原子性、默认分类保存保留顺序、期间分类变更冲突、删除仅移除自己的顺序ID；另覆盖分类/标签/date-only 保存及对象键序差异保留时钟，而字符串空白/数组顺序/标题改变推进时钟。当前仅 javac 编译通过，运行仍待根代理明确AVD交接。

## 实际AVD进展（2026-10-17）

26项隔离SQLite断言已运行通过，以上“仅编译”是准备时历史。真实界面已验分类新增、固定底部排序保存按钮、放弃排序草稿、保存后返回父页、默认新篇与直接分类入口。编辑器进入全局设置前flush、外层关闭后重读分类/revision，保留正文及未提交排版草稿；删除分类后正文hash不变、revision推进，再输入保存无冲突。最终回执由 QA 明细记录，尚不能据此推定全部刷新/动画已通过。
