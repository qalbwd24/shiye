# 2026-10-17 Android 客户端前端第二版验收

用户授权开发并在模拟器展示，随后明确默认会话列表（含置顶）→消息列表/发送；长日记另有直接写与阅读入口，支持启动即新建。底部随想/写日记/思绪是本轮试用安排，永久位置未定。需求见 [第二版](../ANDROID-FRONTEND-V2.md)。

## 构建与来源

原包 `dev.shiye.app` 已覆盖更新到 `0.2.0-frontend` / code2 并冷启动成功，没有卸载或清空数据。升级前已确认旧版停在首页，停止应用后备份完整私有目录到项目 `var/android-backups/2026-10-17T19-48-15Z-before-frontend-v2/`；回执 [pre-upgrade-backup.json](../../outputs/2026-10-17-android-frontend-v2/pre-upgrade-backup.json)。

Android 宿主保留无 INTERNET。日记复用现有编辑核心，随想真正复用冻结 ui18 Telegram Web A 移动消息前端；不是 Telegram Android 原生控件移植。移除 Windows 包装，保留本地 worker/IndexedDB、消息/输入/媒体/动画，平台接缝见 [Telegram 实施说明](../ANDROID-TELEGRAM-FRONTEND-V2.md)。许可证全文、对应源码映射和依赖清单已归档。

APK 的11711项 Telegram 资源与冻结构建清单逐项 SHA-256 一致；9项原有编辑核心/许可及3项编辑页面与源码相符，debug签名验证通过。APK 版本、大小和最终SHA见 [apk-artifact.json](../../outputs/2026-10-17-android-frontend-v2/apk-artifact.json)。

## 验证结果

- 日记：真实共享编辑器 + mock 原生桥的31项手机尺寸浏览器检查通过，覆盖正文优先/标题保护、阅读继续、实际缩进/撤销、图片身份、composition保护、保存失败不返回及ACK后关闭；不等于原生中文输入法实测。[日记说明](../ANDROID-DIARY-FRONTEND-V2.md)。
- Telegram：真实手机浏览器点击会话→输入/点击发送→草稿ACK→返回/重开→置顶保持，以及本地资源/请求隔离通过。首轮发现对 Teact 管理节点 prepend/replaceChild 破坏被修正为 body 独立适配头；纯文本气泡过大留白已修，不隐藏初次失败。回执位于 `outputs/2026-10-17-android-frontend-v2/telegram/browser-check.json`。
- Android：真实发送与消息恰好一次、置顶/首行、拒绝保存ACK不切页、快捷新建、阅读/同ID继续/正文hash重开、3种启动选项、物理tap附件一步照片网格及旧SQLite逐行hash保持已验证。旧记录检查时entries3→6只新增QA3篇，旧rooms5/messages15/assets2/categories3/meta1原数量与逐行hash保持。最终就绪修复的冷启/跨页回执见[实际QA记录](2026-10-17-android-frontend-v2-qa.md)。
- 项目：最终完整 `npm run check` 的315模块和ESLint通过，格式阶段仅被 `docs/CHAT-PERFORMANCE-HANDOFF.md` 与 `docs/UI-PREFERENCES.md` 两个并行文档告警停止，未代改，因此不宣称全check通过。本轮编辑/适配源和自有文档独立格式/JS检查通过。单独 `npm test` 共643项，642通过、0失败、1原生桌面按环境变量跳过，未操作桌面窗口。

首次跨页QA发现Header已出现而worker监听尚未注册，首个BroadcastChannel只读命令会丢失。已改为可靠只读list握手重试到真实回执，ready同时要求UI与transport，变更/flush仍只发送一次；headless丢弃前5次握手的故障注入通过。初次QA另有BigInt CDP序列化和菜单渲染等待误判，已修测试并保留失败/诊断回执，没有改App掩盖问题。

## 数据与边界

思绪仍为第一版 SQLite；新随想只有独立 `shiye-android-telegram-v2` IndexedDB 一个消息权威，不与 SQLite 双写。旧随想入口保留，旧格式ZIP导出不包含新随想，此限制已在界面/README说明。没有真实旧库导入、跨端同步、服务器、AI、便签或回顾接入。

原生照片桥使用 Web A 原有媒体菜单回调接系统文件选择，再由现有媒体预览/保存链处理；宿主将附件点击接到照片网格，物理tap附件按钮→原生照片网格已实际截图确认；原版图库与新版聊天图片全链路是不同验收对象，不据网格出现声称全部媒体格式通过。多段草稿/中文IME/复杂选区、旋转、大字体、全部媒体格式、MagicOS和长期性能不由浏览器检查推断通过。

置顶标记等界面偏好目前使用 localStorage，刚改完就立即强杀存在异步落盘边界；正常等待后的冷启和跨页已验证保持，不能由此宣称偏好立即强杀也可靠。消息正文的 IndexedDB 事务 ACK 与这一偏好边界分开。最后模拟器已通过 Computer Use 实际显示供用户操作，检测到用户开始体验后保留其当前页面，未为截图切走或修改新录入内容。

产物与临时文件：`outputs/2026-10-17-android-frontend-v2/`、`tmp/android-frontend-v2/`；Gradle沿用已有 `tmp/android-dual-prototype/` 构建目录；私有备份在 `var/android-backups/`。
