# Android 0.10 同源内容算法接缝

2026-10-18，按电脑后端最新 `DESKTOP-ANDROID-CONTENT-CONTRACT.md` 和 `tests/fixtures/cross-device-content-v1.json` 适配。此交付只新增纯 JS facade 与同源资产打包项，没有迁移 SQLite、改正文、接 API/云、写 canonical Store 或重生成已接收的 ID。

## 模块和能力

`android/app/src/main/assets/content-algorithms.js` 在真实资产 origin 下使用 `import('/content-algorithms.js')`。它直接导出电脑同源 `prepareDiaryUnits`、`reassembleDiaryUnits`、`projectDiaryParagraphMessages`、`buildLegacyTimeSegments`、`readManualTime`、`validateMessageUnit`、`validateRichDocument`、`validateRenderableRichDocument` 与既有 richdoc 编辑器转换/资源引用函数，没有移植近似算法。

`inspectRichDocument(body)` 同时执行现有通用与真实 renderer/schema 严格校验，返回 `{supported,readOnly,reason?}`。未知节点/属性不裁剪、不重写原件；能力不足返回只读。此判断只涉及 JS 编辑核，不能把它当作 Java LocalStore 已支持完整电脑 Entry 信封或所有大小/深度上限。

`currentCanonicalEnabled=false` 明确描述当前 Android 写入路径；加载算法不意味着开启 canonical 持久化。正式 Entry 如已携带规范身份仍须原样保留。`prepareDiaryUnits` 仅为显式准备纯函数，不能用 fixture ID 工厂处理真实已接收记录。

## 递归依赖闭包

Gradle `syncEditorAssets` 原样复制并新增五个 include：

- `public/shared/message-units.js`
- `public/shared/legacy-time-segments.js`
- `public/shared/diary-paragraph-messages.js`
- `public/shared/content-preparation.js`
- `public/shared/rich-document-renderer.js`

递归静态依赖复用已在列表的 `rich-document.js`、`limits.js`、`time-zone.js`、`public/editor/rich-document-editor.js` 和打包的 `public/vendor/rich-editor.js`。共 11 个模块包括 facade，逐文件来源 SHA-256 存入验收清单。未修改 public/vendor 或其中许可证；原有 `RICH-EDITOR-LICENSES.txt` 继续打包。原生资源白名单须允许 facade 与上述五项，主会话负责该局部入口。

## 同 fixture 计算和验收

浏览器可执行 `runContentFixture(fixture)`，其中 fixture 必须为版本 1 的合成样本。函数使用测试同一固定 `fixture-unit-N` ID factory 和样本 `timeZone`，返回完整 `prepared/projected/reassembled/editorRoundtrip/summary`，并检测原输入未修改。`summary` 给出两个手打/段落时刻、两图真实/兜底时刻、occurrenceIds、未知图 null insertedAt。函数只计算，不写任何库。固定工厂只用于合成 QA，不导入用户库。

Node 定向命令：`node --test tests/android-content-algorithms.test.mjs tests/cross-device-content-contract.test.mjs`，3 项通过。专属测试模拟 Android 资产目录，递归复制同源依赖并逐项断言 Gradle include 完整；真实 facade 输出逐对象等于桌面直调，整篇/layout 与编辑器往返相同，固定预期时间/媒体出现身份/空白/marks保持；未知属性转只读且原件不变。桌面测试继续验证气泡 Markdown 与超过 2^53 的字符串聊天复合身份。Node 回看 Markdown 仍走服务端原实现，未将 Node/jsdom 服务伪装成 WebView 模块。

主会话的真实 WebView 复验应加载同一 fixture，运行 `runContentFixture`，将返回对象与 `desktop-expected.json` 逐结构对比；不能只验模块可导入。富文本 UI 仍需验证读取严格校验、只读失败保护和既有编辑交互。

本子任务只跑 Node，不操作设备。真实 Android WebView 回执由主会话补充，当前不声称已在端侧验证。

产物：`outputs/2026-10-18-android-content-contract/algorithms/{desktop-expected,source-manifest,node-report}.json`。临时模块 staging：`tmp/android-content-contract-010/algorithms`。专属自动测试：`tests/android-content-algorithms.test.mjs`。
