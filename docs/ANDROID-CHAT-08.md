# Android 0.8 随想显示适配

2026-10-17，源码适配与隔离浏览器验证完成，设备构建/安装由主会话集成。本页不代表手机或 AVD 已更新。

## 已实现

- 已有消息字号/输入字号、气泡留白/圆角/间距设置保持；新增最大气泡宽度55–100%，同 native preferences commit ACK 保存，保留显式旧值与未知字段。
- 本人/普通消息使用统一白色圆角矩形，去尾尖；纯表情也进入相同留白/圆角，不再以自定义外形的横向 flex 布局挤压时间戳。表情时间戳移到正文之后独立一行。
- 空内容常驻禁用发送占位；有内容继续使用已有成熟发送按钮，不新增发送算法或写库路径。
- 复用现有本地表情/表情包库，仅将其专属 dialog 的 showModal 接缝改为非模态300px底部键盘区域；输入栏位于面板上方。返回、切房、再次点击入口、聚焦编辑框、视口高度下降均清理面板状态。未添加远端贴纸服务。
- 会话菜单新增“会话背景”：调用 `window.shiyeAndroidBackground.choose()`，回执 `{assetId,url,avatarUrl,position}` 保存到 native prefs `roomBackgrounds[roomId]`，背景与头像分别消费 url/头像缩略图；只接受同源 `/telegram/local-background/` URL。恢复默认仅删除此房间引用，不清除私有资源。缩略图192px居中cover/WebP85沿用电脑规则，由原生桥执行。
- 随想设置仅列聊天显示/表情/会话管理；原生通用设置独立标为“应用设置”。会话类型仅根据现有 ApiChat.type 展示，不新建虚假个人/群后端类型。刷新现有入口增加本机加载/完成/失败状态；本轮未增加新的下拉手势。

## 明确未接入

Android ui18冻结worker不支持set-state，直接调用会超时。归档入口明确禁用并说明等待共用会话能力，不建立本地archivedIds副本，不删除/移动消息草稿。详见 [归档接缝审计](ANDROID-ARCHIVE-SEAM-08.md)。多端canonical消息/归篇算法与云同步不在此UI适配内。

## 定向验证

使用既有隔离浏览器资产，路由覆盖本轮两个adapter文件。最终17项实际页面检查通过：空发送、底部非模态panel/编辑插入/真实发送、时间戳无重叠及实际有对比的颜色、圆角留白、宽度native ACK与未知字段保留、禁用归档、房间背景保存与清除、延迟选图关闭后不commit且保留旧背景、返回清理、键盘式视口缩小清理、打开会话清理、消息裁切不伸入footer和panel、末条可滚到抬高的输入栏以上、无页面错误。360px及412px截图已生成并查看。只使用合成库，不操作手机/AVD或正式日记。

复核修正：custom-shape上游白字会覆盖纯表情时间戳，现为正文metadata直接指定颜色并让子项继承；底部面板同时增加真正的messages-container底部留白与裁切，不仅遮掉消息。面板前已在底部时保留末尾锚定。背景chooser返回后及排队写入前均检查弹窗仍连接/打开、当前会话与上下文版本仍一致；关闭或切房代表取消，不晚到覆盖偏好。

定向 ESLint、Prettier 与 node语法检查通过。未重复全库、原生长帧/性能矩阵；真实IME/原生背景文件与手机观感由主会话集成验收，不以浏览器视口模拟冒充完成。

产物：`outputs/2026-10-17-android-chat-ui-08/chat/`（`chat-check.json`、`emoji-keyboard.png`、`emoji-sent.png`、`chat-narrow-360.png`）。临时验证脚本：`tmp/android-chat-ui-08/chat/verify-chat.mjs`。

## 0.9 增量：复用本地页面与静默恢复

2026-10-18 新增公开 `window.shiyeAndroidChat.resume()`，返回 Promise，成功回执 `{resumed:true,refreshed:true,roomId}`。由原生复用同一 WebView 后调用，不重载文档、不回会话列表、不清草稿/消息DOM。`refreshLocalList({silent:true})` 在后台走原有flush和本地list读；相同房间metadata不再触发上游loading参数重置。真正变化沿用原有投影刷新，不重造worker/归篇/发送算法。

visibilitychange使用相同静默路径，in-flight Promise合并并在成功后1500ms内复用刚读结果，避免原生resume/媒体返回重复触发。静默模式不创建toast/遮罩；错误Promise保留reject供原生处理，visibility错误只记录简短警告。显式设置内刷新继续有加载/完成/失败反馈，复用同一状态元素。修正此前刷新链多余的`.catch(...)()`调用。

9项实际浏览器增量检查通过：立即保留草稿和房间、消息/编辑器/文档身份保持、并发resume与visibility仅一次list读、未变化不重置loading/无overlay、Promise回执、独立worker后台更新标题后静默显示且DOM/草稿/房间保留、显式反馈、列表路由复用同一缓存行、无页面错误。证据`resume-check.json`、`resume-explicit-feedback.png`，临时`verify-resume.mjs`均在上方专属目录。CSS、设备、构建与flush/assetWrite权威函数未修改；未来联网异步发送不在本次实现。
