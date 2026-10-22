# Android 随想前端打磨（2026-10-17）

本轮用户仅认可入口结构：默认会话列表、快捷写日记、底部导航切日记阅读。具体样式需继续完善。本文件由 Telegram 移动适配代理维护；原生导航、日记列表、打包与模拟器验收由主代理负责。

## 范围与来源

只修改 android/telegram-adapter 自有 JS/CSS/构建接缝，继续复用已验冻结 ui18 的 Web A 列表、消息、Tiptap 输入、媒体预览、发送及移动转场；不改 vendor、worker、消息 schema、Java 或后端。冻结包为 outputs/desktop-maintenance/releases/2026-10-17T18-38-43-932Z-3b4b2c77/app，上游 Web A 090e38f1dffec3e0a9aefbec8159a9931fbeec8f。完整来源、源码映射、许可证与逐文件哈希随独立 telegram 产物保留。未混入桌面 ui20 候选。

新静态资源：tmp/android-frontend-polish/telegram-build/assets/telegram。清单/许可/对应源码：outputs/2026-10-17-android-frontend-polish/telegram。合成测试与截图：outputs/2026-10-17-android-frontend-polish/chat。浏览器临时文件：tmp/android-frontend-polish/chat。

## 五段草稿失败：已定位的接缝

旧 QA 合成新会话 -103 有 54 字、5 个真实 p 节点（含一个空段和 emoji img alt），但 IDB 草稿为空。冻结构建在隔离 headless CDP Input.insertText 使用完全相同类型 fixture 复现：worker 已保存新会话，global.chats.byId[id] 尚缺失；Web A 自己的 saveDraft 在 ApiChat 不存在时直接返回，未进入 updateDraft。并非多段 formatter 把内容丢掉。

保留的 draft-baseline.json 记录旧包首次 flush 超时；只派发现有 shiye-refresh-rooms（不改输入/正文/存储），等原 loadAllChats 投影完成，同一个 54 字 DOM 再 flush 即得到真实 IDB 精确相等与 worker ACK。主代理随后在旧 0.2.2 Android WebView 的原 -103 现场执行同一既有事件，真实 flush ACK、IDB 正文 SHA 精确相等，已独立备份。此为接缝原因的 Android 证据，仍不能替代新版安装验收。

适配层新增 ensureChatProjection：create/update 回执、openRoom、flush 在继续前等待原 Web A ApiChat 投影；只派发既有刷新事件，不写平行正文、不变更保存内容、不建新存储。创建表单随后使用已经投影完成的 openRoom，避免重复异步 refresh(id) 在用户返回后又打开新会话。

草稿 fixture 保留空行、两个半角空格、全角空格和 emoji；实际 IDB message 按逐字符相等检查，不 trim、不空白归一。flush 仍等待真实消息保存链、IDB 草稿和 worker 队列 ACK。

## 手机界面调整

保留 Web A 虚拟列表既有行高/布局及消息气泡与转场，只调整层级与触控接缝：列表主次字号/时间、稳定头像渐变、SVG 更多/置顶、44px 触点；消息顶栏采用一致 SVG 返回/更多。会话操作改为底部面板，重命名/置顶/置顶首位功能均保留；新建与搜索表单有明确标题、关闭按钮、输入焦点与搜索结果层级。未实现的 AI composer 入口隐藏，表情、附件、展开编辑与发送沿用原组件。没有给 Teact 管理的节点插入/替换子树。

附件继续由原生现有 capture 接缝将附件按钮转到 Web A 照片/视频项，最终调用原生图片网格；适配未复制媒体存储或 file chooser。Android 真网格/键盘/手势由统一 QA 验证。

## 重建

首次建立独立资源：

```powershell
node android/telegram-adapter/build.mjs --work-dir tmp/android-frontend-polish/telegram-build --output-dir outputs/2026-10-17-android-frontend-polish/telegram
```

随后只更新适配文件（保留冻结 worker/消息实现）：

```powershell
node android/telegram-adapter/build.mjs --adapter-only --work-dir tmp/android-frontend-polish/telegram-build --output-dir outputs/2026-10-17-android-frontend-polish/telegram
node android/telegram-adapter/verify-polish.mjs
```

## 验证边界

隔离 Chrome 使用 412×780 / 360×740 手机尺寸、触控与 Android UA，本机 appassets 路由、网络拒绝，native preferences 是明确标注的 JS 替身。只使用合成会话，不访问真实日记/桌面 API。headless 不证明 Android 触控、中文 IME、系统图片网格或强杀落盘。原 0.2.1 IDB strict ACK/强杀失败证据及 0.2.2 原生偏好权威方案均保持在 ANDROID-INPUT-REFINEMENT.md，未覆写历史失败。

## 冻结交付与实际回归

2026-10-17T22:52:16.597Z 冻结适配源码及打包资产，交主代理统一构建 0.3.0/code5。build-manifest.json SHA-256：836fe8d0407f5adfef65bb11054d7811363597f2bc648d9a2c34d28380b1bba6。之后只补本文档，未刷新资源。自有 JS 与 verifier 的独立 ESLint 退出 0；仅自有 JS/CSS/verifier/本文档已 Prettier。全项目检查、APK 安装与 Android 总验收以主代理记录为准。

最终 chat-check.json 实际执行 22 条断言并退出 0，errors=[]，无 failure。以下均为 headless 合成库证据：

- 新会话创建后原 ApiChat 投影存在；CDP 输入确为五个 p（含空 p），Tiptap getText 原样保留 54 字；flush 返回 worker ACK、实际 IDB 草稿逐字符相同；真实列表点击重进后草稿相同。
- 真实发送按钮清草稿并获得保存 ACK，消息可见；已发 IDB message 仍逐字符等于原 54 字。冻结 Markdown renderer 原本把双换行变成两个 p、单换行变成 br，正文没有丢失。按 p/br 重建可见语义仍精确等于 fixture；相邻 p 的真实几何间距现为 24px，等于 lineHeight=24px，空段可见。只补 CSS 段距，未改 parser/正文。
- 第二次短消息真实发送后立刻 flush 也通过；单行成熟气泡实际高度小于 70 CSS px。flush 的正文快照放在原两帧 UI 调度边界之后，避免发送清框尚未完成时捕获将被发送的旧输入；仍按实际 IDB 与 worker ACK 判断完成。
- 原附件菜单真实触发 filechooser（多选能力），合成图片进入原 Web A 图片预览，实际 modal-dialog 宽高均大于 200px、visibility=visible，有像素截图；取消后仍在会话。此前把高度本来为 0 的固定定位 Modal 外根当可见目标导致 selector 超时，该中间失败未作成功证据。最终检查目标是有实际尺寸的内层 modal-dialog。未使用或冒充原生 Android 图库。
- 实际菜单置顶等待 native preferences JS 替身 commit，列表置顶标记更新；原 worker 搜索找到已发正文；新建表单创建并打开已投影的会话。返回调用、360px 冷重载默认列表、无横向溢出及列表 back()=false 通过。动态旋转/手势由 Android QA 另验。
- 无 Teact、页面或未捕获错误。native preferences 替身只验证接缝，未验证原生落盘。

已逐张查看最终列表、消息、菜单、创建、搜索与附件图片。中文字体栈使用 HONOR Sans CN / Noto Sans SC / Microsoft YaHei / system-ui / sans-serif（显式中文字体先于可能内置宋体 fallback 的 system-ui），菜单与顶栏更多触点 44px，图标为 SVG；表单焦点只保留轻单层边框。消息输入、气泡布局和附件预览仍复用 Web A。

最终可读截图：

- [360px 会话列表](../outputs/2026-10-17-android-frontend-polish/chat/list-360.png)
- [五段与单行气泡](../outputs/2026-10-17-android-frontend-polish/chat/chat-bubbles.png)
- [会话操作面板](../outputs/2026-10-17-android-frontend-polish/chat/room-menu.png)
- [新建会话](../outputs/2026-10-17-android-frontend-polish/chat/new-room.png)
- [消息搜索](../outputs/2026-10-17-android-frontend-polish/chat/search.png)
- [成熟图片预览](../outputs/2026-10-17-android-frontend-polish/chat/attachment-preview.png)
- [22 项实际断言和几何/正文回执](../outputs/2026-10-17-android-frontend-polish/chat/chat-check.json)

本代理没有操作任何模拟器、ADB、手机或桌面运行版。新版安装后的触控、真实中文 IME、图片网格、重启与旧消息保护仍需统一 Android QA，不能以这份 headless 结果结案。
