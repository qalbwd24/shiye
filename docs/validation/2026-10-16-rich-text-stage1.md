# 2026-10-16 富文本第一步：独立原型

## 当前结论

用户授权核对 D 盘切换并开始第一步。已新增图文试写及共享内容适配层，**未达到替换正式编辑器的放行条件**：模型与无界面集成通过，实际中文输入法/窗口显示/图片原件导出恢复仍待验。统一记录接口和朝花夕拾没有实施。

## 切换与运行回读

只读结果 `outputs/rich-text-stage1/live-status.json`：

- 正式 18765 `/api/health` 为 **0.9.20**，PID 66756，命令为 `D:/拾页/server.mjs`；根 package.json 同为 0.9.20。
- 开发 18766 仍为先前启动的 **0.9.19** 进程 PID 37328；本轮没有为静态试验页面重启该进程。
- 开发服务已能 HTTP 200 读取新 HTML、feature、适配器和离线 vendor bundle。**静态资源可读取不等于实际 UI 已验收。**
- 正式数据路径未改，本轮试验模块不调用日记/聊天库 API，未迁移或修改旧正文、附件、profile。

## 实现与文件范围

新增独立 `public/rich-text-lab.html`、`features/rich-text-lab*.js`、`styles/rich-text-lab.css`，内容层 `shared/rich-document.js`，编辑器适配 `editor/rich-document-editor.js`。主功能装配和组件数据设置只加入口；现有 body-editor、聊天 MessageInput、ChatJournalBridge 和服务存储未改。

固定 Tiptap 3.31.3 根依赖，`tools/build-rich-editor.mjs` 生成 488970 字节离线 bundle 及 37 个依赖的许可证说明，不需 Telegram 网络或 CDN。jsdom/fake-indexeddb 只作 Node 开发测试，不进浏览器 bundle。

图像 Blob 原件独立保存；正文用 assetId、occurrenceId、blockId、insertedAt、widthRatio、align、caption、alt 描述这次出现。JSON 原件为权威，Markdown 为输入/有损文本投影；导入拒绝未知节点、丢失属性、不安全链接与媒体校验失败。独立 `---` 预处理保持代码围栏，避免前文变成标题。

## 检查结果

1. 实施前段执行过完整 `npm run check`，当时 **308/308** 通过。此后新增 DOM 集成与分割线用例及修复，不能将这个旧计数当最终全套结果。
2. 用户说明其他会话正在操作界面后，使用 `node tools/check-rich-text-stage1.mjs`：模块路径、ESLint、全项目格式检查均通过；最终 **309/309 Node 测试通过**。主动排除会打开原生窗口的 `tests/quick-desktop.test.mjs`，未把它算作本轮重验通过。
3. 新增 7 项模型/DOM 用例覆盖真实 Markdown 解析、中文/空格/标点/emoji 数据、格式与表格/代码、分割线、稳定定位、同图不同位置、图片原字节及尺寸/图注重开、未知字段拒绝、恶意链接、编辑/只读同内容呈现、事务失败回滚和 4% 缩放/组合事件避让。
4. DOM 用例直接经试验页的 Markdown/文件输入/保存事件，模拟 IndexedDB 读取后新建编辑器并比对完整 JSON 和图像字节。**不是系统键盘、真实粘贴/IME、WebView2 生命周期或物理显示验证。**
5. `F:/agent规范` 的数据模型主题及 catalog 已同步，20 个主题索引检查通过，仍为 candidate。

日志与机器结果在 `outputs/rich-text-stage1/`；本轮未生成额外临时测试目录。既有完整测试前段生成的原生隔离临时文件位于 `tmp/shiye-quick-host-*`，保留供核对，不作正式程序。

## 界面协作与限制

试图检查 Edge 时，Computer Use 因无法可靠确认当前浏览器 URL 而拒绝，说明“could not determine the current browser URL … enforce policy”。没有改用其他界面工具绕过。用户随后说明另一会话正在操作界面，本会话停止窗口操作、切窗及重启；用户误触后要求继续时，继续已授权的代码与无界面收尾。

待协作空闲后验收：实际中文 IME、空格、选择/粘贴、撤销重做、默认中文唤回、图片动画/大图/放大缩小、原件导出恢复、文本比例与 DPI、窄窗及两边实际接入。当前正式版本保持 0.9.20，实验功能不发布为已完成的数据迁移版本。

完整使用说明、支持矩阵及降级规则：[图文试写](../RICH-TEXT-STAGE1.md)。

## 2026-10-16 继续实施：原件、并发与导入回滚

用户确认另一会话已结束，允许独立试验窗口操作。本轮实际完成：统一试验原件编解码；媒体签名/大小/SHA-256 校验；导出保留稳定快照；导入期间继续输入则拒绝替换；草稿 revision 防止多标签覆盖；存储失败恢复原正文、选区和撤销状态；成功导入原子保留导入前草稿及未自动保存的图片；保存冲突时仍可导出当前内容。恢复副本只用于独立试验草稿，不能用于聊天撤回原文。

完整 npm run check 已通过 317/317，包含 14 项富文本模型/原件/模拟存储/DOM 集成用例。原件编码另验 3 MiB 合成二进制，不能当作真实大图解码显示验收。日志：outputs/rich-text-stage1/check-roundtrip.txt。图片原件 JSON 往返、撤销重做、导入中输入、失败回滚、导入前草稿及未保存图片恢复、冲突后导出均经 Node 集成检查；真实浏览器下载/重新选择文件流程仍待验。

用户允许后，Computer Use 在读取 Edge 当前状态时再次拒绝，原因为无法可靠确认当前浏览器 URL，要求停止本轮界面操作；未换工具绕过，未重启正式服务。本轮没有真实 IME/显示/下载验收，不把自动测试当真实界面完成。可由用户手动打开 http://127.0.0.1:18766/rich-text-lab.html 并保留地址栏后，再在后续轮次检查。正式数据未迁移，未接入第二步统一数据接口。

## 2026-10-16 快捷窗继承与时间来源审计

本轮只读核对旧需求、原便签、0.9.1–0.9.17 升级说明及当前编辑/保存/宿主/媒体/备份接点，完成 docs/QUICK-RICHDOC-INHERITANCE.md。机器清单 docs/contracts/quick-richdoc-inheritance-v1.json 共 40 项：写作 8、图片 7、窗口 12、数据 10、时间来源 3；全部新编辑器验收仍为 not-accepted，不把旧测试计成新侧放行。来源文件存在性与 SHA-256 清单 55 项在 outputs/quick-richdoc-inheritance-audit/source-manifest.json；这只是来源定位，不是 55 项产品验收。

17 个旧路径测试文件重新运行，127/127 通过，0 失败/跳过，日志 legacy-focused-tests.txt。没有业务代码变化，未重复全量测试或操作真实窗口；仅新增审计清单、文档索引与要求引用。生成辅助脚本在 tmp/quick-richdoc-inheritance-audit/，产物/记录在 outputs/quick-richdoc-inheritance-audit/。共享规范索引验证 20 个主题通过。

发现必须适配的差异：新原型缺旧时间命令/换行/标题/身份/位置公共合同；直接插图未复用确认取消；比例范围仍为临时值；旧 input/composition 回调、服务白名单、脏状态比较和媒体恢复不认识 richdoc。正式日记未读写/转换，未重启服务或窗口。

用户追加手打时间与插图时间问题。当前仅新试验页插图已自动存隐藏 UTC insertedAt，旧 media importedAt/lastModified/EXIF 不代表某次文中插入。手打时间分段识别、段落继承、缺时区推定、复制/移动时间规则和回看去重属于后续建议，未改 schema 或宣称实现。评论/撤回与未知旧时间的边界继续保留。
