# Android 0.8 聊天 UI 定向验收

2026-10-17。依据用户截图与随后“先做 UI，今后直接复用电脑算法”澄清，保持三入口与思绪0.7成果，重点修改聊天外观和附件选择。不修改正文/长文拆分/归篇/同步算法，不重启电脑版，不操作手机。

## 当前交付与运行边界

APK `Shiye-Android-0.8.0-fc377e63.apk`，91,466,971字节，SHA-256 `fc377e63a693461908bb1650972b924254f2d6f37a4560ccd87413c59545286c`。包名 `dev.shiye.app`，版本 `0.8.0-chat-ui`、code10；Gradle BUILD SUCCESSFUL，51秒。aapt确认包版本/图片视频权限，无INTERNET权限。6个受影响及相邻编辑资产与源码逐字节相同。

主AVD已 `install -r` 成功并回读code10。安装前编辑flush确认，完整私有备份 `var/android-backups/2026-10-18T03-49-37-443Z-avd-before-080/app-private.tar`。不清库、不导入电脑数据、不重复全库审核。用户手动打开后，4项实际安装包检查通过：空发送禁用可见、非模态表情面板与输入栏相接、真实发送后表情时间戳可见且分行、统一圆角留白；只使用新建合成会话-109，发送flush确认。见 `avd-chat-verification.json`、`avd-emoji-{panel,sent}.png`。**原生背景/图库尚未验证完成**：进入系统文件选择器后AVD通信两次停滞，未选入任何图片，没有把浏览器合成桥当原生通过。手机保持0.6供用户测试。

## 已通过

- 17项隔离浏览器定向：常驻空发送、非模态底部表情面板/插入/真实发送、表情时间戳分行且实际可见、统一矩形圆角/留白、最大宽度native ACK/未知字段保留、归档禁用、会话背景引用保存/清除、返回/切房/键盘式视口变化清理、延迟选图关窗后不写配置、面板打开后末条消息在输入栏上方、无pageerror。详见 `chat/chat-check.json`；这是浏览器合成桥验证，不能冒充原生设备或IME测试。
- 根代理实看最终 `emoji-sent.png`、`emoji-keyboard.png`：修掉首图中表情时间戳白字和面板上缘漏出旧时间戳的问题。最终图均为本轮已修CSS，不使用首阶段失败图作验收。
- 两个adapter的定向ESLint/Prettier/语法通过；全部Java对Android36编译通过。只读交叉review发现并修复背景/文件请求码冲突（现206/205分别路由）、WebView销毁的背景pending owner及晚到导入清理。未以编译代替文件提供者实际测试。
- LocalStore、editor.html/js/css、共享rich-body-adapter/quick-capture/rich-document与0.7回执hash相同；0.7空白草稿/思绪编辑证据仅在这些未改路径复用，不声称本轮整套重测。

## 实现与明确缺口

背景桥保存原图并生成电脑同192px中心cover/WebP85头像，偏好只存同源资源引用；取消不改原配置，恢复默认不清理旧资源。图像解码平台不同，不声称WebP字节相同，也不称已跨端同步。照片/视频网格采用同一既有文件通道，思绪插图仍只接受图片；真正视频选择到预览/发送链需设备验证。文档见 [背景资源](../ANDROID-CHAT-BACKGROUNDS-08.md)、[附件面板](../ANDROID-MEDIA-PANEL-08.md)、[随想适配](../ANDROID-CHAT-08.md)。

随想设置与应用设置区分，刷新已有入口增加加载/完成/失败反馈并合并重复请求，本轮未新增下拉手势。会话类型只展示已有ApiChat.type，没有添加另一个个人/群业务模型。冻结ui18 worker不支持归档set-state，入口明确禁用，后续须接电脑共同事务与发送/草稿保护，见 [审计](../ANDROID-ARCHIVE-SEAM-08.md)。完整Entry/MessageUnit/云同步仍未完成，见 [统一计划](../ANDROID-DATA-UNIFICATION-PLAN.md)。

不把外观改善写成120Hz或旧长帧解决。性能另有 [交接](../ANDROID-PERFORMANCE-HANDOFF.md)；本轮不重复旧矩阵或全库数据审核。

产物 `outputs/2026-10-17-android-chat-ui-08/`，临时 `tmp/android-chat-ui-08/`，备份见上方。`release-receipt.json`分别记录已安装、实际运行验证及手机是否更新，后续手动打开后的实际证据另补，不提前标记成功。

## 后续0.9增量

用户继续追加思绪列表、IME底栏过渡与本地优先页面复用，形成0.9/code11。聊天`resume()`新增9项浏览器验证，保留既有room/editor/draft/行DOM、合并重复返回刷新、后台元信息变更确实更新且无loading遮罩。发现并修复旧显式刷新Promise链多余调用，不将0.8的非刷新17项扩大为刷新路径已通过；报告 `chat/resume-check.json`。

0.9使用独立 `tmp/android-diary-list-09/telegram-build` 与对应outputs/telegram，不覆盖0.8冻结包。阶段中曾短暂复用0.8生成目录，随后将0.8适配JS和对应源码从已发布APK逐字节恢复（SHA `4fe05ff9…d6ecc04`），build-manifest附恢复说明；0.9源码与资产另行冻结。不得把0.8回执的原生运行套给0.9。
