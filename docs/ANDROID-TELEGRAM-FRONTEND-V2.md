# Android 随想：冻结 Web A 手机前端候选

2026-10-17 用户确认的方向是：随想以 QQ/微信式会话列表为入口，点击会话进入 Telegram 式消息前端；长日记独立为写日记与思绪阅读入口。成熟消息组件优先直接复用。本文件只记录 Android 随想适配，不把桌面、SQLite 原生旧聊天或未来服务器功能写成同一运行库。

## 实际复用与产物

本轮直接复制桌面已经验证的 `outputs/desktop-maintenance/releases/2026-10-17T18-38-43-932Z-3b4b2c77/app`，上游 Telegram Web A 12.0.46，固定 commit `090e38f1dffec3e0a9aefbec8159a9931fbeec8f`，冻结 UI 标识 `20261017-ui18`。没有从当前 vendor 工作树重新打包，不带入其他会话的数据桥、朝花夕拾或 ui19 候选。

真实复用 Web A 的 Teact 全局状态、手机两栏切换、会话行、消息列表、Composer、编辑/回复消息、附件预览/媒体与 worker 请求链。消息不是重新用 Android TextView 或仿制 HTML 气泡实现。新增的 `android/telegram-adapter` 只负责资源转换、本地会话设置、手机最小标题栏、原生导航接缝和隔离检查。

可打包 assets 根目录为 `tmp/android-frontend-v2/telegram-build/assets`，其中 `telegram/` 直接映射到 `https://appassets.androidplatform.net/telegram/`。入口是 `/telegram/index.html`。最终适配交接清单的 `atUtc` 为 **2026-10-17T20:48:20.571Z**；APK 与原生壳最终构建/安装回执由主任务的验收文档记录。

上述为 0.2.0 冻结记录。后续 0.2.1 的置顶事务与多段草稿修复沿用同一 ui18 来源，另存 `tmp/android-input-refinement/telegram-build/assets`；实现和 15＋6 项 headless 回执见[本轮说明](ANDROID-INPUT-REFINEMENT.md)，安装/AVD 状态见[总验收](validation/2026-10-17-android-input-refinement.md)，不覆盖上述清单。

更新：0.2.1 的置顶 IDB 权威在 Android WebView 133 立即强杀后回退，真实失败保留；0.2.2 改为原生 `LocalStore.meta` 唯一偏好权威。旧 15＋6 项只是历史电脑回执，新适配的 13 项 native-mock 测试只验证桥契约，不证明 Android 持久化通过。具体失败、当前原生 API 和 AVD 回执仍以上述本轮说明/总验收为准。

后续只读日志已确认 0.2.2 首启在 native 最小验证链之前检测原 origin LevelDB 损坏并重建，旧消息检查因此暂停；不能写成 native 偏好删除 IDB。冻结主 worker 的库名和正文未变化，读不到 library 时仅返回内存 seed，不在启动时主动覆盖库。损坏检测、两份私有备份与局部恢复边界详见[本轮说明](ANDROID-INPUT-REFINEMENT.md#后续发现原-origin-的-leveldb-损坏检测与重建)，恢复结果仍由总验收记录，不推定具体损坏成因。

可追溯报告在 `outputs/2026-10-17-android-frontend-v2/telegram/`：

- `build-manifest.json`：每项源/目标 SHA-256、转换文件、源发布清单 SHA、入口及唯一权威库声明；清单包含 GPL 与完整依赖许可文本。
- `browser-check.json`、`mobile-list.png`、`mobile-chat.png`：独立合成库、412×780 手机视口的真实交互结果。
- `corresponding-source/source-maps/`：冻结构建的 483 个 sourcemap，包含当时实际使用的 `sourcesContent`。
- `corresponding-source/android-adapter/`：本次适配脚本与资产副本；同目录保留上游声明和依赖清单。
- `dependency-license-manifest.json`：886 项依赖许可文件的包名、版本、路径和 SHA。

## 隔离、资源与许可

聊天唯一可编辑权威是 Web A 本地 IndexedDB，库名改为 `shiye-android-telegram-v2`。它与原 Android SQLite 消息样机、桌面 IndexedDB、F 盘正式日记互不同步。没有 Telegram 账号、Telegram API 凭据、云服务器或正式日记导入。原生旧聊天由宿主保留，不清库、不迁移、不将两边同时写同一正文。

页面与每个根 worker 使用相同的本地网络 guard；旧 `https://shiye-preview.local` 改为 Android 安全源。允许本机 `/telegram/` 资源及 `blob:`/`data:`，fetch/XHR/EventSource/beacon 的其他目标拒绝，WebSocket 拒绝。页面 CSP 限制 iframe 为 none，并限制远程脚本/图片/媒体/worker。原生无 INTERNET、URL 拦截与 ServiceWorkerClient 是独立的最终边界，不能由 JS guard 替代。

worker 文件仍在 `telegram/` 根，内部 `./assets/` 与 `../worker-*.js` 的相对图不改；无需根 `/assets` 路由。桌面用于缓存失效的绝对 importmap 已去除。Service Worker 位于 `/telegram/service.worker-*.js`，默认 scope 为 `/telegram/`；需原生在文档和 ServiceWorker 请求两端都映射相同本地 assets。图片上传沿原 Web A File→worker→IndexedDB 字节→blob URL 路径，不需远程媒体源。浏览器自动检查阻断了 SW，真实 Android SW/原生图库/图片发送属于主任务 AVD 验收边界。

Windows 窗口、IME、标题栏、输入包装与日记归篇桥脚本及其整套桌面 CSS 未加载。可用的本地 worker 命令仍保留。没有装载 `shiye-journal.js`，没有任何 18765/18766 请求桥。

APK assets 带完整 `Telegram-Web-A-LICENSE.txt`（GPLv3）与 `THIRD-PARTY-LICENSES.txt`（安装依赖图的完整许可文本，含字体/图标/emoji 等包的原有声明）。未把本项目自己的包装代码概括为第三方 MIT。上游原包仍为 `resources/vendor/telegram-sources/telegram-web-a-090e38f1.zip`，SHA-256 为 `f24c2b46ac8ba5e9366a11114d9d2e7108b4587e31599738f6f19574fa80c47c`。当前源码包 manifests 只用于依赖标识；不能以当前并行工作树冒充冻结 ui18 的对应源码。

## 手机适配与原生契约

默认进入会话列表；在本次页面生命周期中，用户真实点会话链接前，拒绝恢复末次自动打开的会话。列表原有设置图标仅用 CSS 显示为无边框更多按钮，不替换 Teact 管理的子节点。会话可新建、重命名、搜索、置顶/取消置顶、移到置顶首位。0.2.2 置顶权威是原生 meta `android-chat-ui-preferences-v1`；0.2.1 IDB `preview/android-ui-preferences-v1` 与更早 localStorage 仅作一次迁移来源，适配后续不再写旧 IDB key。localStorage `shiye-android-pins-v1` 与 `shiye-room-order-v1` 只作 native commit 确认后更新的排序缓存，继续使用 `shiye-room-order-changed` 接口。不是 Telegram RPC 置顶，也不改聊天正文；迁移、空数组和失败语义见[本轮说明](ANDROID-INPUT-REFINEMENT.md)。

冻结 MockedClient 模式移除了原始 MiddleHeader，因此补了独立于 Teact 子树的 56px 手机头（返回、标题、菜单），其他消息组件仍由 Web A 渲染。正文恢复已有 Markdown 的 normal/pre-wrap 边界与首末段 margin，单行气泡不再多出大块尾空白；不隐藏或截断真实段落。日期缺失的 Weekday.Short 文案通过展示层转换为中文周几，名称展示为随想。没有新增快捷键。无录音权限/实现的空输入语音状态按钮隐藏；实际发送状态按钮保留。

页面提供 `window.shiyeAndroidChat`：

| 接口                       | 约定                                                                                                                                                                                                                                                                                                                    |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ready`                    | 本地列表头已创建、只读 list 握手已获 worker 真回执且置顶偏好初始化完成；snapshot 同时提供 uiReady/transportReady/preferencesReady                                                                                                                                                                                       |
| `snapshot()`               | 版本、ready、roomId、inConversation、消息数量/输入区有无、offline、storage；不记录正文                                                                                                                                                                                                                                  |
| `back(): boolean`          | 依次关闭本地 dialog、真实媒体关闭按钮、已有菜单/Modal、回复/编辑取消、返回会话列表；列表返回 false，交原生转思绪                                                                                                                                                                                                        |
| `flush(): Promise`         | 等待偏好事务队列；以 Tiptap `getText({blockSeparator:'\n'})` 读取真实段落/hardBreak，触发既有草稿保存并与实际 IDB 草稿逐字符精确比较，等待待发送消息完成；再次等偏好队列并取得 worker `writeQueue` 的 `flushed` ACK。不使用临时 draft.isLocal 标记代替持久化确认，不 strip 空白。失败/超时 reject，原生不得假成功后切页 |
| `command(action, payload)` | 先等待只读 list 握手；仅首次只读握手可重发同 requestId，变更只发一次；requestId/超时/错误严格配对，数据事务成功后才返回                                                                                                                                                                                                 |

`CustomEvent('shiye-android-view-state', {detail:{inConversation:boolean}})` 通知原生显隐底栏；原生初连通道时可主动调用 `snapshot()`，不能依赖一定收到了早期事件。原生 `shiye-chat-native-port-v1` 的接收/ACK/超时与 WebView 生命周期由 `TelegramFrontend.java` 负责。

## 已验证与保留边界

2026-10-17 原生 QA 发现跨日记再回随想时，列表头已出现而 worker 的 BroadcastChannel 监听尚未就绪，首条 flush 会丢失并超时。适配层现先执行只读 `list` 握手；250ms 重发仅用于探测监听是否真实存在，取得回执才认为 transportReady，不以等待时间判断已保存。变更请求和 flush 不重发，避免重复创建/写入。握手总超时仍明确拒绝操作，后续调用可重试建立连接。headless 确定性丢弃前 5 次只读 list，实际观察 `uiReady=true, transportReady=false, ready=false`，此时立即请求 flush 可等待握手后成功；握手前变更 0 次、flush 恰好发送 1 次。随后以下发送/草稿/刷新流程仍零页面异常通过。真实 AVD 的跨页回到随想复验由主任务 QA 完成。

最终 headless Chrome 使用 Android UA、`navigator.platform=Linux armv8l`、触摸/手机视口和新隔离 profile：真实点击会话列表链接、真实输入并点击发送按钮成功；空输入 flush 成功；36 字未发送草稿 flush 后返回、刷新，仍默认会话列表，再真实点击同一会话恢复原草稿全文；置顶 ID 刷新保持。最终零页面异常。单行第一条气泡高度 53.39px、Markdown 内容 22.39px，标题栏 56px。loopback 18765、远程 HTTPS 与同源其他入口 fetch 均被拒绝，未调用真实 API。

加载时可见本地可选 `__invokeMiddlewares__/default` 404，它由原 MockClient 捕获并使用默认本地处理，不触发网络回退。最初尝试在 MiddleColumn 前插标题栏并替换齿轮子节点造成 Teact replaceChild 错误，已改为独立 body overlay、CSS 展示与原 fasterdom 调度，最终重测无此错误。维护时不得再次改写 Teact 管理的 DOM 子树。

本适配代理未操作 AVD/Windows GUI。主任务已回报初版实际 Android WebView 能离线启动；最终 APK 的键盘/中文 IME、系统返回、图库选择、图片发送、菜单编辑/撤回、长列表分页、选区、动画/长期性能仍以其 AVD 验收为准。当前自动回执不证明这些全部通过。

0.2.0 初次适配的历史待验点：①冻结 AttachMenu 默认先小菜单再图片/视频，接缝为原 `handleQuickSelect→openSystemFilesDialog→onFileSelect`，没有常驻 image input，后续原生一步图库以主任务验收为准。②旧 flush 仅验证单段，多段 DOM/存储换行表达的保护性超时已在 0.2.1 明确复现并修正为 Tiptap 语义与实际 IDB 逐字符比较，空行/双空格差异的失败回执也已验证；详见[本轮说明](ANDROID-INPUT-REFINEMENT.md)与[总验收](validation/2026-10-17-android-input-refinement.md)。不更改实际保存正文。

## 重建

工作目录固定 `D:/拾页`，Node 使用已配置的 Node24：先运行 `node android/telegram-adapter/build.mjs` 从固定 ui18 冻结目录生成；再运行 `node android/telegram-adapter/build.mjs --adapter-only` 同步适配资产、许可清单与对应适配源码；最后运行 `node android/telegram-adapter/verify.mjs`。第二步也适合只更新三项适配资产，不重新扫描复制 1 万余静态资源。不得将输出改到正式安装、盘根或共享 vendor/dist。

上述默认路径保留用于旧版复现；0.2.1 应显式使用新目标，避免覆盖旧证据：

```powershell
node android/telegram-adapter/build.mjs --work-dir tmp/android-input-refinement/telegram-build --output-dir outputs/2026-10-17-android-input-refinement/telegram
node android/telegram-adapter/build.mjs --adapter-only --work-dir tmp/android-input-refinement/telegram-build --output-dir outputs/2026-10-17-android-input-refinement/telegram
node android/telegram-adapter/verify-native-preferences.mjs
```

成品/回执在 `outputs/2026-10-17-android-frontend-v2/telegram`；打包中间 assets 在 `tmp/android-frontend-v2/telegram-build/assets/telegram`；可维护源文件在 `android/telegram-adapter`。
