# Android 浅天蓝思绪与附件视图

2026-10-17。当前记录日记 WebView 的源码与定向浏览器验收；APK 构建、原生外观设置和 AVD 回读由主会话负责。本页不把浏览器证据写成手机或 Android 输入法验收。

## 用户确认与本轮范围

保留默认会话列表、独立快捷写日记、底部进入思绪阅读三入口。内部改为浅天蓝主调、黑字；常驻写作栏只留时间戳，历史正文格式从顶部更多进入。图片以附件缩略网格展示，避免正文大图打断阅读。用户参考图仅作为配色和版式依据，没有作为背景资源或测试素材。

修改范围仅 `android/app/src/main/assets/editor.html`、`editor.css`、`editor.js`。沿用真实共享 richdoc/Tiptap，不另造编辑器、附件权威模型或壁纸存储。

## 时间戳直接复用电脑实现

- 格式直接导入 `public/features/editor-input.js` 的 `formatLocalDateTime`，精确为 `[YYYY/MM/DD  HH:mm:ss]`，日期和时间之间两个半角空格。
- 操作直接调用既有 `rich-body-adapter.insertDateTime`，其内部调用 `public/shared/date-time-edit.js`：句中、选区和语义容器内联插入/替换；普通段末插入双换行、两全角空格、时间戳、换行和下一行两全角缩进；空行复用原行。
- 本轮按主会话确认调用共享 `setTimeZone(DEFAULT_TIME_ZONE)`，即 **Asia/Shanghai／北京时间**，对齐电脑和后端默认解释。按钮说明与更多面板明确写出这个选择，不依赖执行测试的 Windows 主机时区。
- Android 尚未接实际共享库的用户自定义时区偏好，因此不能声称跟随所有电脑自定义时区；后续由 Repository 接入真实偏好。字符串格式和 schema 本轮不改。
- 只提供按钮，不增加默认快捷键。已有组合输入保护和保存 ACK 队列不改。

原封不动打包的新增共享依赖为 `public/features/editor-input.js`、`public/editor/rich-date-time.js`、`public/shared/time-zone.js`；原包已有 `date-time-edit.js`。未修改这些共享源文件。

## 图片附件是 canonical 正文的投影

`body` 中的 image 节点仍是唯一权威。网格直接从已挂载 Tiptap document 的 image 节点派生，不保存一套平行附件数组，不删除或搬移旧图。

编辑时，原位置保留小型、可被选中的“图片附件”锚点；大图与图注不在正文重复显示，底部网格展示缩略图、图注、插入时刻和编辑信息。这样跨段选择仍会看见媒体节点的位置，避免把完全不可见节点藏在可编辑范围内。阅读时正文锚点收起，只显示外部网格；阅读本身不可改正文。预览失败显示“暂时无法预览”，原节点与文件身份保留。

新图通过同一个 Tiptap `insertContentAt(doc.content.size, imageNode)` 追加到全部既有节点之后，先执行共享 `validateRichDocument`。不用当前文字选区替换，不把旧末尾空段当作可丢弃占位。节点沿用现有字段：独立 `blockId`、`occurrenceId`，原资源 `assetId`，UTC `insertedAt`，以及既有 `widthRatio`、`align`、`caption`、`alt`。Tiptap 可能在新图之后新增一个可继续输入的空段；所有原节点仍位于原顺序和位置。

`insertedAt` 在用户启动本次选入/导入操作时独立采集 UTC ISO；不使用文件 EXIF、`importedAt` 或保存时间。取消时不创建节点；构图/校验/插入失败不清旧输入。之后预览、图注编辑、阅读切换和保存不刷新时间。未知旧时间保持 `null`，明确显示未知。三种媒体身份、旧位置和排版元数据保留，见 [契约审查](ANDROID-SKY-CONTRACT.md)。

本轮验证的是本地既有与新增顶层 image。公共 richdoc 校验器和当前 Java 支持的节点范围并不完全相同，未完成“任意桌面 richdoc 导入时自动只读预检”的完整链路，不能据本轮附件成功宣布所有桌面文档均可互通。

## 天空与壁纸 UI 桥

默认天空渐变为 `#B6DEF0 → #EAF7FF`，正文 `#111827`，蓝强调 `#327DB2`，面板浅蓝。文字层保持透明，壁纸位于最底层并有轻遮罩。

打开时调用 `getAppearance`，失败回退天空。顶部更多中的“思绪外观”调用 `showAppearance`，实际选图、私有文件、预览/取消/保存持久化由 native 负责。本页暴露 `window.shiyeApplyAppearance(value)`，仅更新背景 CSS 属性：模式、同源 `/appearance/` 图片、cover/contain/tile、位置、透明度与模糊。限制枚举和资源路径，未接外部图片 URL。

应用背景不会重建编辑器、改正文、重设选区、增加 dirty 或 revision。外观设置不包含内容时区，也不会把壁纸作为日记附件。手机壁纸只影响思绪，聊天仍由其原独立机制负责。

## 定向验收

按 [TESTING-POLICY](TESTING-POLICY.md) 选择受影响路径，未重复全项目或桌面矩阵。Headless Chrome、真实共享 richdoc/Tiptap、mock 原生 MessagePort、全部虚构内容，最终 **33 项检查通过**：

- 时间戳按钮实际写正文；UTC 和 Asia/Shanghai 两个设备时区 context，在固定同一 UTC instant 均输出 `[2026/10/17  17:05:07]`。句中插入、段末双换行、真实两全角缩进和下一缩进行通过。
- 常驻栏不包含历史格式命令；旧图片有可见锚点和独立网格，阅读只显示网格，未知时刻明确保留；模式切换不保存已规范表示的正文。
- 选中文字后添加新图，全部既有 canonical 节点和空白保持为精确前缀；新图在旧节点之后，身份独立、时间为本次 UTC，忽略 mock 的 1999 年 `importedAt`。图注修改后全部媒体身份与插入时间保持。
- 壁纸预览保持同一个编辑器 DOM、原 revision、原保存次数与干净状态；设置入口只调 native 桥。320px 宽、420px 内容高度无整页横向溢出，时间戳栏位于视口内。
- 旧 `content: []` 空段样本经既有共享序列化后可能省略空 content 数组，这是本轮未改的正常化行为；专门验证空段本身、顺序、blockId、hardBreak 与全角/尾部空白仍保持。没有把 JSON 表示变化写成节点丢失，也没有声称原始 JSON 字节完全不变。

三前端文件 Prettier、`editor.js` ESLint 和 `node --check` 通过。既有保存队列、组合输入、图片编辑等未改路径的历史回归仅作基线，不冒充本轮全量重验。

截图已实际查看：`timestamp-editor.png`、`sky-editor-with-attachment.png`、`sky-reading.png`、`sky-more.png`、`custom-wallpaper-preview.png`、`sky-narrow.png`。图片与壁纸均为脚本生成的合成山景；没有复用用户私人截图。当前 headless 截图不代表实际 AVD 或手机结果，原生软键盘、实际文件选择/预览、中文输入法与长期生命周期由后续对应验收确认。

产物与回执：`outputs/2026-10-17-android-sky-ui/diary/`。临时构图、定向验证脚本：`tmp/android-sky-ui/diary/`。没有操作手机、模拟器、桌面窗口或正式日记；旧验收目录未覆盖。
