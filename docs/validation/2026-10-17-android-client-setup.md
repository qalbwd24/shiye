# 2026-10-17 Android Studio、AVD 与双入口验证

结果：Studio/SDK/AVD 已运行，真实本地 richdoc 验证壳构建、图文保存和万字恢复通过。完整客户端未实施，框架未定案。用户授权 GPT-6.1-sol 高推理并行复核 Telegram、原生外壳/编辑器和参考验收矩阵。完整环境、启动办法和建议见 [环境与比较](../ANDROID-DEVELOPMENT-ENVIRONMENT.md)。

## 可复核回执

- 官方 ZIP 和安装：outputs/2026-10-17-android-client-setup/download-manifest.json、installed-packages.json、legacy-cli.json。SDK 主要按官方 SHA-1 校验；Studio ZIP SHA-256 为 6e83e7ce3e0a76c4e8e78d98eb5ef538cbc9fb386c745bda425fc0bacb9de6d4。Studio EXE Authenticode 有效，Google LLC。
- WHPX 加速检查返回 0，实际 AVD 冷启动并最后回读 sys.boot_completed=1；Studio Device Manager 已查看 Shiye API 36 绿色运行状态。GUI 通过 Computer Use 操作；使用统计由用户亲自选择。
- AVD API36/AOSP x86_64、pixel_7、1080×2400/420dpi、4 核/3072MiB；不是 MagicOS。配置 avd-config.json、avd-list-verified.log。WebView 133.0.6943.137。
- launch-shortcuts.json 记录实际创建/回读的开始菜单入口，启动脚本副本保留 outputs。重复启动检查通过；没有快照热启动或多 AVD 验收。
- Gradle 8.13 官方 Wrapper/校验、AGP 8.13.2、已有 JDK17，33 tasks 构建成功；gradle-bootstrap.json、gradle-build-verified.log。验证工程为纯 Java/WebView，不能写为 Compose 已编译。

## 失败、修复、遗留

1. latest23 sdkmanager 新 bootstrap 尝试下载用户 .android/bin/android-cli.part，停止仅本轮 bootstrap。新增 partial 经 SHA-256 核对后保留至本项目 tmp，清单 bootstrap-partial-migration.json；既有 adbkey 未移动。并列经典19完成许可处理，23 avdmanager 可用；23 sdkmanager bootstrap 仍未完成。
2. ZIP 手工解包后补仓库 package.xml，初次 generic/01 被拒；纠正 generic/02 后创建成功，register_sdk.py 已同步，保留失败日志。
3. Studio 首次无法读取 SDK add-on list，Java 未沿用现有代理；配置本机127.0.0.1:7897 后完成向导并登记 SDK，系统代理未改。Gradle 下载使用同一现有代理，后续下载需代理运行。
4. Gradle 首次直连超时，配置代理后恢复；随后因中文项目路径触发 AGP guard，仅本轮无 NDK 纯 Java 壳增加 android.overridePathCheck=true 并实际构建通过。未来 Telegram/NDK 工程不能套用，应另安排 ASCII 路径。
5. Gradle 有弃用告警，未擅自升级 Gradle9；经典管理器对新 SDK XML 有兼容告警，不等于构建失败。

## 真实编辑器与保存

源码 tmp/android-client-setup/native/webview-probe，包名 dev.shiye.probe。最终清单无 INTERNET 权限，只含虚构文档/程序生成色块，无服务器/真实日记/聊天页。当前真实编辑核心隔离副本，本地 HTTPS 受控资源拦截和 WebMessagePort 保存桥，单 IO 队列/AtomicFile。Native 仅验证 envelope，不是最终完整正文验证器。

手工构建成品 outputs/2026-10-17-android-client-setup/ShiyeEditorProbe-debug.apk：189623 bytes，SHA-256 64663588a3058af21e446245080268db43943be1057b752ed01dc15fd6e64136，签名/权限回执 probe-artifact.json。安装及运行显式指定 emulator-5554，没有操作手机。Gradle 的另一构建产物在 tmp/android-client-setup/native/webview-probe/build/outputs/apk/debug，没有混为同一字节。

editor-runtime-check.json：真实模块启动、图像解码/媒体 hash、保存读取精确一致、独立图片出现身份、CDP 中文插入及 ACK 后 force-stop/reopen 均通过。

long-document-runtime.json：新增10000汉字/100段后，最终10090汉字、107块、两图片、43229 bytes 正文；旧图片身份/时间保持，Undo 精确回到基线，Redo 恢复正文与块 ID，页面重载/进程重开后 hash 一致。最终 SHA-256 b47df81cef7934637567cdae0289379079f95afba2f489377bfa801407c89445。临时 CDP 端口转发已撤销。

CDP 插入不是中文输入法组词。单次模拟器耗时不能推导 Magic7 性能。未验旋转、系统选图、移动工具栏/跨段选区、用户输入法、备份导入和全部生命周期；未达到一本日记效果验收，未交付双入口 App。自动保存为500ms防抖、组合输入中跳过提交；没有承诺未 ACK 输入强停不丢，也不恢复撤销栈。

## 比较与项目检查

Telegram 当前有原生全屏 RichEditor，草稿/插图仍连账号控制器和上传链；自有外壳可复用 richdoc，聊天成熟度需要实现。没有完整构建 Telegram，也没有 Compose 聊天运行对照，不能按一方实测宣布总体胜者。一本日记只抽查旧版资源，未运行或复制素材。

项目 `npm run check` 最终退出 0：287 模块文件检查、ESLint、Prettier 通过；591 测试中 590 通过、0 失败、1 原生桌面测试按 SHIYE_TEST_NO_DESKTOP 跳过。日志 outputs/2026-10-17-android-client-setup/project-check-final.log。首次检查仅因本轮文档换行/表格格式失败，局部修正后完整重跑通过；未批量改动其他会话内容。

F:/agent规范 目录校验通过：21 主题、errors=[]，回执 F:/agent规范/outputs/android-client-setup-catalog-2026-10-17.json。最终环境回读 final-environment-verification.json 记录 boot=1/API36、Studio有效签名、两份APK分别的hash及是否已运行。未变更桌面源码/版本，不触发桌面升级，保留其他会话并行工作。

## 文件位置

- 成品/报告/日志：D:/拾页/outputs/2026-10-17-android-client-setup。
- 脚本/下载/源码缓存/隔离工程：D:/拾页/tmp/android-client-setup。
- 工具：D:/codex-tools/android-studio、android-sdk；状态/缓存/启动器：D:/codex-tools/android-state。
- 开始菜单：C:/Users/<用户名>/AppData/Roaming/Microsoft/Windows/Start Menu/Programs/Android 开发。未在桌面/Downloads 放产物，未清理历史资料。
