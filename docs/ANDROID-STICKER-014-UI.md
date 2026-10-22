# Android 0.14 图片与表情包 UI 接缝

2026-10-18。仅修改 android-chat.js/css，新增 android-stickers.js。基线为0.13已生成vendor资产，隔离浏览器路由覆盖本轮包装层和当前共享input/stickers/local-assets/media-drop；未构建APK、操作设备、读取真实库或更新电脑运行版。收藏传输由根独立实现，本文不代表云同步已启用。

## 行为

- 移除按GIF文件名或所有PNG照片统一128/176px的旧CSS；普通照片不再误缩。仅收藏contentHash、media关系或localSource明确指向的图片获得派生视图尺寸；未知字段、原件、ID、日期和旧alias不改。软移除收藏仍保留历史阅读尺寸。
- 尺寸与电脑shiye-sticker-layout相同：当前消息字号10汉字为基准，竖图限宽／横图限高，再按原图、消息区宽减56px、窗口高65%等比缩小。小原图不放大。仅可见媒体核对已存原件hash，缓存结果；不请求远端图片或遍历全部消息计算hash。
- 保留已有原件PNG/GIF直发空caption与本地ACK管线、文字草稿和已有引用处理。尺寸识别监听实际data-message-id换号、本地提交事件，修复极小GIF先加载后ACK未分类的竞态。worker/存储权威不变。
- 共享名称／备注表单复用，补Android紧凑布局。setLibraryReader先await真实flush，因此共享表单的词法saveMessage也等待写队列；不靠气泡可见冒充提交。公开saveMessage共用同reader，不重复包两次flush。失败仍由共享组件保留本机素材及pendingMetadata。
- 普通附件预览空说明Enter可以发送；Shift+Enter仍换行，组合输入、229及compositionend短窗口不发送。只监听真实composer/caption，不截获收藏metadata或推荐输入。
- 原生Web图片查看保焦点，返回先关当前菜单再关图片，关闭后恢复输入；GIF缺native图片元信息时从已存原GIF字节增加只读动画预览和本地dialog看图，关闭只影响顶层。顺带清理无房间GIF候选，避免重开时队列不停空转。

## 装配顺序

根build需将android-stickers.js加入打包／精确版本依赖；继续装配当前共享shiye-local-assets、shiye-stickers、shiye-input、shiye-media-drop及其原有schema客户端依赖。本轮不改build。

wrapper顺序：冻结附件hook → local-assets与写队列 → shared stickers → 注入先flush的libraryReader → installAndroidStickers({readLibrary,currentId}) → shared input → localInputReady。根的android-sticker-transport和推荐模块可在shared stickers已存在后挂setTransport／editor hook；不应新造网络口或把TL临时号当规范来源。推荐模块独立，不改本轮两个wrapper或布局模块。

## 验证

实际Chrome／Tiptap，320×780移动视口，合成IDB与原生偏好mock。核心21项通过，另增菜单打开／第一次返回只关菜单2项。覆盖13px横208×130、竖130×390、24×16不放大、字号16后高160、普通照片大于176、PNG/GIF原字节与空caption／草稿、共享备注及未知字段／alias、真实worker flush、空说明Enter／Shift／IME、软移除／重开GIF、两种看图焦点与返回。未把浏览器IME合成事件说成Android实体IME或原生收藏transport已验。ESLint与Prettier定向通过，未重复全库检查。

产物：outputs/2026-10-18-android-media-014/chat-ui/report.json、menu-report.json、source-manifest.json、favorite-landscape-320.png、ordinary-photo-320.png、gif-original-320.png。截图已实际查看。临时：tmp/android-media-014/chat-ui/，包含定向浏览器脚本与合成GIF诊断。早期失败报告被最终通过结果覆盖，诊断只含合成数据。

源码冻结：
- `android/telegram-adapter/android-chat.js`：`a1355b368b18870013053ed84df0a916ed02e184089fb109e500fbb074b8e2a3`
- `android/telegram-adapter/android-chat.css`：`1036e99bf19ea884f7308daed3a7821ddadd37280354e54d998a39b3732abddf`
- `android/telegram-adapter/android-stickers.js`：`d225b66eeea7f4871b7dc1d521f5b3d0a0d6b89e555f47613808968d7461e079`

## 共享客户端保真补丁

后续用户再次强调数据结构互通，本段仅改`previews/telegram-chat/shiye-stickers.js`，新增`tests/sticker-client-fidelity.test.mjs`；不改上述已冻结Android UI。收藏后端仍是权威，本地`serverStickerSnapshot`只是最后确认的完整JSON DTO缓存：保留schemaVersion、嵌套未知字段、group、createdAt、updatedAt、deleted及显式note空串，不把快照作为写请求。

collect／from-message／catalog／edit／remove统一在最新本地条目上合并回执，采用明确返回的标准化name/note/group等已知字段；本地ID、Blob、previewBlob、localSource、未知本地字段和mapping身份保持。collect请求增加已有接口允许的group，update只选name/note/group/deleted白名单，不上传快照或未知字段。catalog缺项只标removed，继续保存最后快照，不虚构后端deleted回执。

编辑先合并pendingMetadata再请求；失败保留新旧待重试字段，ACK仅清理实际确认且未被更新的字段。旧ACK不覆盖较新用户编辑、替换原件或预览；上传ACK和下载缓存也先检查当前原件。旧catalog以最后快照变化与回执时间共同防陈旧覆盖，即使两次更新恰好同毫秒也不能退回旧名称。以上是客户端保真保护，不是新Repository／全局跨设备冲突协议。

验证：新增真实Chrome IndexedDB与合成transport定向测试，12类独立行为断言（含多次写白名单检查共19条）；另复跑既有真实隔离HTTP后端的sticker-frontend测试，两文件共2个测试通过。覆盖未知DTO/组/完整时刻/删除/trim空备注、旧映射和原字节、失败重试、延迟ACK的新编辑／替换原件、同毫秒旧目录、from-message信封。ESLint及Prettier定向通过，未操作正式库／设备或部署桌面。

证据：`outputs/2026-10-18-android-media-014/chat-ui/client-fidelity.json`；旧前端测试沿用项目约定的`tmp/sticker-frontend/tests/`合成库，新浏览器测试不读取原库。

共享客户端冻结SHA-256：`2DDC6AAFAB28DEA1ED30B05E07412EA8F99DB9B2A4B8A90E7D40EF7007184CA1`；测试文件：`7403E3DB798D8BAE4FD6C1DFED0C356BC598E8FAC76A88BF3002534BBC3ECF3C`。根后续构建需刷新共享客户端资产，旧Android UI证据的原shared hash不自动代表这份增量已经部署。
