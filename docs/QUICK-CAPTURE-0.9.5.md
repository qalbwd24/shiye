# 0.9.5 快捷窗口交接（2026-09-30）

## 用户需求与本轮范围

快捷页不必写到末行才能下拉；单独记住壁纸来源及参数、字体字号粗细；支持多开；修复“上一篇”首击无结果。快捷页继续复用主页面编辑核心与保存队列，不另造一套正文存储。

用户授权只读检查近期本地日记。检查范围为 9 月 20 日至本地最新的 9 月 29 日，归纳而不复制私人正文：

- 快捷窗缩进需验证首行及连续回车。
- 标题与正文自动保存、直接关窗不能丢失。
- 主页面应在快捷窗保存后更新，尤其切回主窗时。
- 自有云与手机端互通仍需真机验证，属于后续跨设备工作；不能把本地验证当成手机验收。
  更近设备上的未同步日记未读取；无修改、删除或重新同步真实日记。

## 使用

- 每次运行根目录“拾页快捷记录.exe”打开独立窗口；“新一篇”仍在当前窗口创建。
- 正文末尾预留约 75% 窗口高度，可以滚轮下拉；留白是 CSS 空间，不是保存的空行。
- 顶部“外观”支持跟随主页面、独立壁纸或不使用壁纸。上传 PNG/JPEG/WebP/GIF（20 MiB 内），调不透明度、铺满/完整/平铺、位置、模糊。
- 取消“字体跟随主页面”后，可独立选字体类别、正文字号/字重/行距和标题字号/字重。保存后重开仍保留；其他快捷窗采用同一套快捷外观，不是每个窗口单独一份。
- “上一篇”第一次就读取已更新历史；跳过空白、删除、缺失项。它是快捷编辑历史，不是全部日记按日期倒序。
- 多窗同时编辑不同文章各自保存；同篇版本分歧仍经现有冲突选择，不无条件覆盖。
- 主窗在返回前台、收到同配置环境广播时申请刷新；正文/标题聚焦或保存未完成时延后，离开编辑区后更新。不会主动跳到另一窗的文章。Edge 与 WebView2 的广播不互通，跨环境以返回前台刷新兜底，未新增服务器推送。

## 代码职责

| 功能                       | 位置                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------- |
| 滚动留白及小窗单独滚动     | public/styles/quick-capture.css                                                       |
| 上一篇先刷新后取历史       | public/features/quick-capture-session.js                                              |
| 独立外观 UI 与预览         | public/features/quick-appearance.js                                                   |
| 外观规则及样式             | public/shared/quick-appearance.js、public/styles/quick-appearance.css                 |
| 装配                       | public/features/index.js、public/features/quick-capture-window.js、public/app/main.js |
| 设置与备份引用校验         | src/server/routes/preferences.mjs、src/server/routes/backups.mjs                      |
| 多开、服务启动锁、关窗握手 | desktop/QuickCapture.cs                                                               |
| 防止异步刷新覆盖输入       | public/features/window-refresh.js                                                     |

独立外观位于 settings.preferences.quickAppearance，背景引用既有 background 用途媒体。默认继承，不修改主页面 appearance/fontSize 等字段。加密备份选择恢复外观时重映射快捷壁纸 ID；不选择则保留本机外观。旧原件不删除。单窗编辑对象和草稿 token 不共享。

## 测试与维护

- tests/quick-capture.test.mjs：第一次加载空历史后异步替换、连续上一篇、刚保存新 ID 后返回。
- tests/quick-appearance.test.mjs：参数边界、主窗设置独立、背景用途、持久化；vault2-roundtrip 覆盖还原引用。
- tests/quick-desktop.test.mjs：真实隔离 WebView2 双窗同时运行，各自拒绝/同意关闭、窗口错位、原子状态文件。
- tests/window-refresh.test.mjs：忙时通知、请求期间新输入、切换选中、失效响应、串行及错误重试。
- 正式服务默认 18765；本轮页面验收仅使用 var/quick-095-acceptance 与 18769。
- 窗口原生二进制由 tools/build-quick-launcher.ps1 构建。不要只改源码却不更新 exe。
