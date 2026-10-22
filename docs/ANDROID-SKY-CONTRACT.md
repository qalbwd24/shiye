# Android 浅蓝界面：日期时间与图片展示契约

2026-10-17。只读核对与合成验证；本子任务只写本文及专题证据，不改后端、编辑公共核、Android 应用源码或数据库，不操作窗口、ADB、运行 API 或真实日记。新图的浅蓝背景、黑色文字是视觉参考，图中文字不作为额外开发指令。

产物：`outputs/2026-10-17-android-sky-ui/contract/`；临时脚本：`tmp/android-sky-ui/contract/`。本轮只验证两个直接接缝，遵循 [TESTING-POLICY.md](TESTING-POLICY.md)，不重跑全项目检查。

## 协议与版本依据

以 [ANDROID-FRONTEND-DATA-ALIGNMENT.md](ANDROID-FRONTEND-DATA-ALIGNMENT.md)、[DATA-MODEL.md](DATA-MODEL.md)、[MESSAGE-UNITS-IMPLEMENTATION.md](MESSAGE-UNITS-IMPLEMENTATION.md) 及实际源码为准；[UNIFIED-DATA-CONTRACT-V1.md](UNIFIED-DATA-CONTRACT-V1.md) 是草案，不替换现有协议。样机的 SQLite 本地库、Telegram IDB 和服务端 MessageUnit 仍是不同接缝，不能把界面变更称为远程同步已接通。工作区 `package.json` 为 0.9.24；核对时 Android Gradle 为 `0.3.0-frontend` / code 5，这些是源码版本，不是运行状态回执。

## 电脑思绪日期时间的完整路径

| 层次          | 真实实现                                                                                               | 契约                                                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| 按键声明      | `public/shared/hotkeys.js` 的 `datetime`、`effectiveShortcuts`、`match`                                | 默认 Alt+T，仅正文；扩展关闭时保留此默认，其余旧自定义绑定不自动启用                                                          |
| 页面调度      | `public/app/main.js` 的 document keydown、`runCommand`、`insertDate`                                   | 拦截 IME 事件及打开的弹窗；工具栏日期按钮与按键共用 `offline.editorInput.insertDateTime()`                                    |
| 时间文本      | `public/features/editor-input.js` 的 `formatLocalDateTime`                                             | 调用共享 `dateParts`，输出 `[YYYY/MM/DD  HH:mm:ss]`，日期与时间之间恰为两个 ASCII 空格；补零、24 小时制、有秒、无 offset      |
| 时区选择      | `public/shared/time-zone.js`；`public/features/preferences.js` 的偏好应用                              | `dateParts` 读取当前选定时区；桌面偏好默认 `Asia/Shanghai`，用户可选系统或其他时区。不能把函数名 Local 当成无条件设备本地时区 |
| 编辑入口      | `public/features/editor-input.js` 的 `insertDateTime`；`public/editor/quick-document-editor.js` 的委托 | 优先由当前结构化/Markdown 编辑器处理；只读阅读态吞掉插入；HTML 兼容态最后才走 DOM 路径                                        |
| richdoc 插入  | `public/editor/rich-body-adapter.js` 的 `insertDateTime`                                               | 在当前 ProseMirror 选区做交易，复用公共 `dateTimeEdit`，不整篇转纯文本，不重建周围格式                                        |
| 共用文本规则  | `public/shared/date-time-edit.js` 的 `dateTimeEdit`                                                    | 下表中的换行、选区及缩进规则                                                                                                  |
| HTML 兼容     | `public/editor/rich-date-time.js` 的 `mapRichBlock`、`richDateTimeInsertion`                           | 将 BR 投影为换行、媒体为占位，保持原 DOM range 一侧和富文本，用一次原生 insertText 完成                                       |
| Markdown 兼容 | `public/editor/body-editor.js` 的 `insertDateTime`                                                     | 复用同一编辑规则，方括号在 Markdown 源码中转义，保留显示结果；Code/List/Blockquote/Heading/Table 语义内走内联                 |

普通 richdoc 段落的行为：

| 当前选区/位置                          | 插入结果                                                           |
| -------------------------------------- | ------------------------------------------------------------------ |
| 有非空选区                             | 在真实选区直接替换为时间文本，不额外换行                           |
| 句中或段首，光标后仍有正文             | 在光标插入时间文本，不拆结构                                       |
| 有内容的一行末尾                       | 插入 `\n\n`、当前缩进、时间、`\n`、当前缩进；光标停在新缩进行      |
| 空白/仅缩进行                          | 复用该行；前面有正文且不足一个空白分隔时补一个分隔，不重复叠加缩进 |
| 列表、引用、标题、代码、表格等语义容器 | 内联插入，不强制套用普通段末换行                                   |
| 关闭段落缩进                           | 上述缩进为空字符串，换行规则不变                                   |

缩进是两个全角空格 `U+3000 U+3000`，不是 CSS。richdoc 将上述逻辑换行插成带身份的 `hardBreak` 节点，不承诺每个逻辑行都是新的 paragraph。公共适配器在插入前后关闭相邻历史组，一次 undo 可独立撤销时间插入；原有文字 marks、媒体和外层容器保持。

IME：适配器的 `canEdit` 同时检查当前篇/删除状态、内部 `composing`、`justComposed`、ProseMirror `view.composing`。`compositionend` 后到下一微任务前仍禁止命令，避免确认候选时误插入。Android 新按钮应调用公共适配器，不能绕过这些条件拼接 `entry.body` 或 innerHTML。按键绑定不需要复制到 Android；本轮新增的是明确的工具按钮，不注册全局快捷键。

本轮协调决定：Android 新日期时间按钮显式 `setTimeZone(DEFAULT_TIME_ZONE)`，即北京时间 `Asia/Shanghai`，再用同一 `formatLocalDateTime` 与 `adapter.insertDateTime`，界面说明北京时间。这样与现存服务端默认解析时区一致，不加 offset、不改正文模型。此项为本轮实施约束；本子任务不宣称按钮已经部署。

仍有边界：服务端 `src/server/domain/message-store.mjs` 在持久切分时采用 `db.settings.preferences.timeZone || 'Asia/Shanghai'`。Android 未来接入 Repository 后应沿实际库时区设置；现阶段没有完成任意自定义库时区的对齐。无 offset 的手打时间不能跨不同解读时区自动得到相同 instant。媒体的 UTC `insertedAt` 不受该问题影响。

## 图片可以显示为附件网格，权威节点仍保留

本轮采用“正文保留媒体锚点，附件区从 body 派生网格”的界面方案。网格是呈现，不是第二份可编辑正文；卡片操作通过原 `occurrenceId` 定位原节点。不得通过过滤图片后重新保存正文来实现隐藏，也不能只把图片 ID 放入附件数组、删除 body 的 canonical image。

| 字段/关系                      | 必须保留的含义                                                                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `assetId`                      | 原资源身份；同一资源可在同篇出现多次，不能用 blob URL 或私有路径替换                                                                                    |
| `attrs.blockId`                | 原节点身份及所在结构/顺序；重新打开和切换布局不重新生成                                                                                                 |
| `occurrenceId`                 | 每一次出现的身份；同 asset 的两次出现分别保留，不按 assetId 去重成一个节点                                                                              |
| `insertedAt`                   | 该次插入的 UTC ISO 时间，旧未知值是显式 null；不能在保存/重绘时刷新成现在                                                                               |
| `widthRatio,align,caption,alt` | 原排版与信息；附件式显示也不能剥掉，编辑信息只能改这些排版信息                                                                                          |
| 正文位置与周围内容             | 原 AST 顺序、paragraph/hardBreak、空白、marks、容器仍来自原 body，不用网格顺序回写改排                                                                  |
| Entry `attachments`（服务端）  | 资源关联数组，用于登记/备份，不具备每次出现身份或插入时间；不能替代 body 媒体                                                                           |
| Media 时间                     | `importedAt,lastModified,sourceCapturedAtRaw/sourceCapturedOffset/sourceCapturedTag` 与插入时间独立；不把 EXIF 拍摄时间、文件修改或入库时间冒充出现时间 |

`rich-body-adapter.insertMedia` 仅在真正新插入时生成 blockId、occurrenceId、UTC insertedAt；已有节点显示、保存、排版编辑不重新生成。其 `updateSelectedMedia` 仅接受 widthRatio/align/caption/alt；定位以 occurrenceId 为准。媒体字节仍由既有资源表管理，不因取消卡片展示就删除文件。

## 后端如何识别时间与媒体

真实处理链为 `message-store.mjs → prepareDiaryUnits`（`public/shared/message-units.js`）→ `buildLegacyTimeSegments`（`legacy-time-segments.js`）→ `readManualTime`（`content-preparation.js`）。它不是 Android 前端自行切分算法。

时间标记必须是合格文本行：完整年月日和时分、可有秒/明确 offset，支持既有成对方括号/中文括号及前后缩进。电脑生成的两空格格式可识别。普通句子中提到时间不切分；codeBlock、blockquote、inline code 中的时间文本不引入新锚点；图片 caption/alt 不参与时间标记识别。识别到独立完整标记后，后续普通正文承接该时间；不完整/有歧义时间保留 issue 与 unknown，不猜今天或下一天。

每次媒体出现独立生成 unit，`identityKey='media:'+occurrenceId`，body 保留该 image/video 节点。已知时间使用 `eventTime.source='media-inserted'`、`sourceField='insertedAt'`；null 走既有 contentEditedAt/updatedAt 编辑时间兜底，且原 body 的 insertedAt 仍为 null。媒体不会承接附近正文时间标记或 caption 内的时间。相同 asset、相同时间都不允许合并两个 occurrence。sourceSpans/layout 用于无损重组与映射，不作为永久评论身份。

## Android 已有兼容限制

`LocalStore.java:validateBody/validateNodes` 是额外的 Java 严格校验，不等同于公共 JS 校验，不能仅凭格式名相同就宣布全量可互换：

- Java 的 paragraph/heading 子节点仅允许 text 与 hardBreak；目前拒绝桌面共享 richdoc 能表示的段内 image。本轮限定既有本地顶层图与新顶层附件链，不迁移桌面任意富文档。
- Java 校验节点/属性白名单、本地资源存在及 MIME，媒体字段必须完整，UTC 由 Instant.parse 检查。新字段不能删掉再保存来“兼容”。
- Java 上限为深度 32、节点 20000，并另受 BODY_LIMIT 限制；资源必须已存在于其本地 assets。服务端 media ID 尚未做远程下载/本地映射。
- 当前 editor 的启动保护基于 contentFormat 和公共 JS validateRichDocument；本核对没有发现将所有 Java 更窄能力预检并自动转只读的完整链。旧 HTML/Markdown 的拒绝编辑保护不等于所有桌面 richdoc 都已有只读兼容。未来导入/接入任务必须补齐能力保护，不得宣称已完成。
- `saveEntry` 本地桥采用 id/baseRevision/categoryId/body；服务端仍是 Entry revision/category/attachments/body。只改附件显示不会自动完成这些映射或 messageUnits 接入。

## 本轮证据

`tmp/android-sky-ui/contract/probe.mjs` 完全使用虚构正文与资源 ID，直接调用现有格式化、时间编辑、时间解析和消息转换器。10 组通过：北京时间/UTC 格式、句末空行与选区、秒级完整时间识别、同资源双出现不同身份与时间、未知插入时间兜底不回写、图注不造时间锚点、无损重组且输入不变、原身份再次保存保持、句中/代码/引用不造完整标记、不同解析时区的实际差异且媒体 instant 不变。统计和当时源码 SHA-256 在 `outputs/2026-10-17-android-sky-ui/contract/synthetic-contract.json`。

另实际执行现有 `tests/quick-rich-body.test.mjs` 中 3 条定向回归（`--test-name-pattern 'timestamp|empty/indented'`），均通过：真实 ProseMirror 时间插入的 marks/一次撤销、选区/列表/代码不拆结构、空行/缩进关闭与合成 IME guard。原测试使用合成 DOM，不等于 Android WebView 或中文输入法实机验收。

首次合成脚本因自建 createId 每轮重置、与 previousUnits 重号而被现有转换器正确拒绝；只修正脚本的 ID 工厂，产品源码未改。未执行 Android JVM、APK 构建/安装、原生窗口、ADB、手机 IME、强杀恢复或真实旧篇导入；未核验当前 API 的 messageUnits 开关。以上不能由纯转换器通过代替。
