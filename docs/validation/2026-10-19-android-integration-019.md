# Android 019：QQ 宽度、设置与日记产品存储整合

2026-10-19。需求来自 [逐项执行单](../ANDROID-019-USER-FEEDBACK.md)。本轮不修改桌面安装/正式日记，不将旧消息默认 source 切换成尚未完成保留迁移的新库。

## 实际故障和处理

- Magic7 正常 0.18/code20 只读回读：iframe/壳 320CSS px，隐式 grid 列却将 header/list/footer 撑成 454.97px，消息靠右后被裁。14条消息节点及 ready=true 不能证明正确渲染。019 明确单列 `minmax(0,1fr)` 和直属子项最小宽度，未在手机注入样式或改内容。
- Android WebView 合成长引用、长 URL、代码、宽表格、长附件名复现旧网格撑宽，在 320/360/428 宽度验证新布局不越屏。回执 `ui-feedback/019-chat-width-regression.json`。这证明布局修复，不等于已安装到手机验证。
- 发送按钮抢输入焦点：仅在输入区已聚焦时阻止按钮 pointerdown/mousedown 的默认焦点转移；不在异步 ACK 后强制 focus，以免用户收键盘后又被弹起。实际 QQ 模块触摸 Chromium 连续3次按钮、回车和迟到ACK共5项通过，系统输入法须在最终 Android 包另验。
- QQ 初始可见门禁与可选组件隔离，失败保留返回入口，不能退回旧 Tele 窗口；版本引导页只注销旧 `/telegram/` service worker，不清 IDB、媒体或正文。WebMessagePort 改为 commitVisible 早绑定并校验页面/代际，实际冷重载不再卡在偏好未就绪。

## 数据写入与接口边界

- 日记编辑器打包实际桌面 `prepareProductEntry`、richdoc/Tiptap/Markdown 与 canonical 模块，完整准备结果进入同一 `ProductRepository` 的受控入队端口；元数据修改保留旧正文/canonical/未知字段/contentEditedAt，不无故重拆旧篇。
- 原 `LocalStore` 行保留；单篇首次保存建立显式映射，旧写口遇产品篇拒绝双写。尚未配对的新增内容 localOnly，本机 ACK 与网络 ACK 分开。新空白草稿退出丢弃；旧篇清空不自动删除。
- 独立 Android SQLite 探针14项通过，包括离线保留、canonical/未知字段、元数据修订、HTML/非法写口拒绝、显式排队及旧篇单映射。`diary-adapter/android-sqlite-result.json`。
- 实际编辑 WebView 完成中文长文保存、仅标题保存、冻结头部/正文独立滚动、上一篇回到实际最近 ID；空白退出后从 QA SQLite 验证没有新增正文/产品记录，旧3篇仍在。均为自有 QA 合成内容。
- 新 `ProductChatStore/ProductUiBridge/ProductMediaBridge/product-source.js` 经过实际 WebMessagePort→后台线程→同 SQLite 的5项离线合成检查，20位ID/Markdown/本地ACK/撤回保持；默认 QQ 仍使用原 legacy owner。未完成默认 source 保留迁移、整库初始包入口、朝花夕拾来源/评论完整 UI，不能称为全数据已互通。
- 共享接口 fixture9条及旧默认聊天 source20项针对性回归通过。完整网络/服务端写入/真实资料导入未在此轮执行。

## UI 已测范围

- 019 首轮实际 Android：旧三房/新房统一 QQ、Markdown、本机ACK、无旧SW、设置头尾固定及真实返回层级12项；原生滑块纵滑不误改/横滑可调/固定按钮/取消返回4项。后续仅变化影响的路径再验，不无故重跑全库。
- 编辑冻结、上一篇、列表全宽、默认分类标记、删除多余管理入口及置顶组边界均分别记录真实几何；最终追加的标题/色调/紧凑工具栏/全宽线需按最新样式补验。
- Astra 的设置与编辑浏览器42项是候选设计验证，不能替代 Android/OEM 输入法或物理帧率结果。

## 模拟器恢复

Android Emulator 弹窗属于模拟器意外退出。日志中实际有 OpenGL 上下文被抢占与恢复失败；未证明是拾页 App 崩溃。没有 wipe、卸载或清除用户数据，也未发送崩溃报告。

原 Shiye_API_36 已在可见窗口以 `swangle`、禁用 Vulkan、临时60Hz恢复，分辨率1264×2800、逻辑density632/font_scale1.3保持。虚拟设备120Hz配置仍保留，当前兼容启动参数60Hz；不能据此承诺真机120FPS、系统IME或长期内存性能。

## 产物、安装与剩余验证

产物 `outputs/2026-10-19-android-integration-019/`；临时 `tmp/android-integration-019/`；完整安装前备份 `var/android-backups/`；手机只读诊断的几何回执在产物目录，私有诊断不打包正文。019 专属 QA 包 `dev.shiye.integrationqa`，正常包 `dev.shiye.app`，二者不互导测试内容。

### 最终正常包与模拟器

最终 APK：`outputs/2026-10-19-android-integration-019/Shiye-Android-0.19.0-d9a256d0.apk`，92,212,188 bytes，SHA-256 `d9a256d01080f6ae6b788895ba0e6d0f97c50258948fc6da14358fbb270a3104`。正常包与最终 QA 的11,768个assets/DEX逐项同字节；manifest/applicationId单独区分。正常包 install-r Success、ADB启动Status ok、实际回读0.19.0-ui-product/code21，见 `release.json`、`normal-install.json`。

保留主AVD原profile覆盖安装；最终安装前完整私有备份 `var/android-backups/2026-10-19-avd-before-019-092914/private.tar`，46,179,328 bytes，SHA `07139d8fb869fcd2d50362d66c86b2dd8ab98a30639684991d5b137763533221`。中间cd12c4c4包为追加置顶/壁纸反馈前阶段，不是最终下载入口；各次备份仍保留。

最终正常包实际旧房-10/-20/-30均为单一QQ renderer，header/list/footer均320px；会话列表5行均x0/width320/high72，无预览CSS注入。返回检查等待本地草稿flush完成，不把关闭动画中x=-320的旧帧当最终布局。最终编辑页实际18px/700标题、32px工具栏、x0宽320分割线及冻结坐标通过。真实软件IME连续3次发送保持键盘/焦点；后续只改壁纸/置顶底色，按未改发送路径复用。触摸Chromium另验回车及迟到ACK不夺焦点。

按用户最新反馈取消思绪/随想逐条置顶加深，保留顺序、分隔和提示。原生置顶边界底色与未选分类chip底色透明，避免割裂壁纸；搜索小控件与选中分类仍保持可辨。用户已有会话行80%不透明度保留，并未重置为默认0。

### 手机壁纸与实时预览

用户进一步授权读取手机当前App壁纸，已只读复制写作页天空/白线/小猫原JPEG，525,795 bytes，SHA `92a3e1cb920591739503ecb6957abef625592adf78ed2dde58552bd2e78b13eb`。原图在私有 `var/android-diagnostics/2026-10-19/wallpaper-source/`，不进入源码或APK。手机列表另有不同壁纸，未修改其选择。

该原图完整字节分别放入模拟器写作/阅读、思绪列表与聊天外观目录；仅更新外观偏好，原偏好备份保留。会话列表/默认聊天及已有单房背景通过现有native preferences事务提交；QQ renderer新增读取已保存的本机背景，不再因iframe隔离丢失壁纸。只接受同源固定local-background原件路径，不把壁纸写入日记/消息/媒体业务表。实际app-assets HTTP原件SHA一致，聊天背景已加载且宽320，见 `wallpaper-transfer.json`、`ui-feedback/019-wallpaper-runtime.json`。最终已查看真实编辑页/思绪列表/QQ聊天的屏幕图；私有资料图保留在var诊断目录。

实时预览现在合并editor基础CSS＋019 overlay，并独立覆盖QQ同源iframe shadow CSS；仍有owner隔离、开关/停止清理，参数保存只写基础CSS。10项定向通过，控制页仍使用127.0.0.1:19384。

模拟器交付阶段手机只读回读为0.18.0-qq-rebuild/code20，当时新增壁纸授权仅用于读取原件。随后用户另行要求部署手机，已完成019覆盖安装和320px布局实际检查；最新手机运行状态以 [安装回执](2026-10-19-android-magic7-019-install.md)为准。

### 构建与性能实际限制

一次正常包Gradle JVM原生分配65,552 bytes失败，日志确认系统可提交内存压力，保留 `tmp/android-integration-019/hs_err_pid33260.log`；未清理/关闭用户程序。降低单worker堆上限至512MiB后最终QA/正常构建成功。首次恢复的模拟器之后又关闭/调试离线，沿原AVD磁盘可见重开并冷启动97秒，未wipe。未将构建成功或恢复后的静态截图写成120FPS、长期内存或所有OEM动效已验。

后端RunGate忙时丢唤醒已补成功后合并重跑，失败停止；19项真实生产调度门的JVM并发断言通过，整包编译成功。产品同步页最终状态刷新、默认聊天源保留迁移、初始包/完整持续同步与朝花夕拾真实收件/来源/评论页面仍按 `ANDROID-019-PRODUCT-CHAT.md`继续，不能称全部已互通。
