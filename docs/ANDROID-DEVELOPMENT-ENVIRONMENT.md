# Android 开发环境与双入口方案比较

2026-10-17 后续状态：用户已选自有App并完成[思绪/随想可行性样机](ANDROID-PROTOTYPE.md)，开始菜单另有“拾页 Android 样机”。一本日记原版已在独立断网API30参考AVD运行，[逐页观察](ANDROID-REFERENCE-REVIEW.md)已回填。正式聊天组件仍需适配定案；下方“尚无双入口”属于早期配置快照。

2026-10-17：Android Studio、SDK、硬件加速模拟器已配置并实际运行；隔离编辑器 APK 已通过 Gradle 构建与 AVD 保存/重开验证。用户授权的 GPT-6.1-sol 高推理并行比较已完成。客户端框架尚未定案，没有交付完整的思绪/随想产品，也未占用 Magic7。

## 日常启动

开始菜单 **Android 开发** 文件夹有两个入口：**Android Studio (D盘)**、**拾页 Android 模拟器**。模拟器独立运行 Android，无需连接手机。Studio 欢迎页 More Actions → Virtual Device Manager 已实际显示正在运行的 Shiye API 36。

```powershell
& 'D:/codex-tools/android-state/Start-AndroidStudio.ps1'
& 'D:/codex-tools/android-state/Start-ShiyeEmulator.ps1'
```

开发命令先加载进程配置；只对当前 PowerShell 及子进程生效，不改系统 PATH/JAVA_HOME：

```powershell
. 'D:/codex-tools/android-state/activate.ps1'
adb -s emulator-5554 shell getprop sys.boot_completed
```

模拟器启动脚本检查同一 serial，包括启动中的 offline 状态，避免重复启动。后续同时开其他 AVD 需另选端口；本轮未验证快照热启动或多 AVD。

## 已安装与实际证据

| 项目           | 当前配置与验证                                                                                                              |
| -------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Android Studio | Rabbit 1 / 2026.2.1，官方 ZIP SHA-256 匹配、EXE Google LLC 签名有效；首次向导完成，欢迎页与 Device Manager 已查看           |
| SDK            | D:/codex-tools/android-sdk；API 36 r2、Build Tools 36.0.0、Platform Tools 37.0.1                                            |
| Emulator/AVD   | Emulator 37.2.12.0；Shiye_API_36，Android 16/API 36 AOSP x86_64，pixel_7 配置，1080×2400/420dpi，4 核/3GiB 内存             |
| 硬件加速       | emulator -accel-check 返回 0，WHPX installed and usable；AVD 实际冷启动 sys.boot_completed=1                                |
| 构建           | 隔离 Java/WebView 工程使用 AGP 8.13.2、Gradle Wrapper 8.13、现有 JDK 17，33 tasks、BUILD SUCCESSFUL；Studio 使用随附 JBR 25 |
| WebView        | AVD 实际为 com.android.webview 133.0.6943.137，这是镜像读数，不是手机读数                                                   |
| 管理器         | latest 23 和经典 19 并列；23 sdkmanager 新 bootstrap 未完成，不计为可用；19 完成许可证处理，23 avdmanager 成功创建/列举 AVD |

Studio/SDK 位于 D:/codex-tools；AVD、Studio 设置/缓存、Gradle 缓存、临时目录在 D:/codex-tools/android-state。旧 android-build 及其他项目签名保持原位。

首次 “Unable to access Android SDK add-on list” 已解决：Studio Java 网络没有沿用现有代理。已为 Studio/本轮 Gradle 配置本机 127.0.0.1:7897，未改系统代理。后续下载需现有代理运行；离线编辑不需要它。使用统计选择由用户本人完成。

官方包和安装清单见 [installed-packages.json](../outputs/2026-10-17-android-client-setup/installed-packages.json)。SDK 仓库给出的包校验主要为 SHA-1，Studio 为 SHA-256，不混称全部 SHA-256。

## 长文可行性实测

只含虚构文档的 dev.shiye.probe 验证壳承载当前拾页真实 richdoc 编辑核心，使用本地受控 HTTPS 拦截、WebMessagePort 保存桥、单 IO 队列和 AtomicFile。最终清单无 INTERNET 权限；不连电脑日记服务、不含聊天页。证明编辑核心可独立运行，不代表直接嵌入电脑页面即达到手机产品效果。

- 本地图像解码、字节哈希、媒体大小、结构合法、保存/读取精确一致通过。
- 两次插入相同素材得到独立 occurrenceId；原图片身份/插入时间保持。
- CDP 插入 1 万汉字、100 段后最终 107 块、两图片；撤销恢复原正文，重做恢复完整正文及块身份。
- 页面重载及保存 ACK 后 force-stop/relaunch，正文 SHA-256 一致，未通过清除数据实现恢复。
- 手工 Java 工具链与 Gradle 均构建成功；实际安装测试的是手工 APK，Gradle 产物单独保留，没有混记为同一字节。

证据：[基础回执](../outputs/2026-10-17-android-client-setup/editor-runtime-check.json)、[万字/撤销/恢复回执](../outputs/2026-10-17-android-client-setup/long-document-runtime.json)、[Gradle 日志](../outputs/2026-10-17-android-client-setup/gradle-build-verified.log)。

边界：CDP 输入不证明中文输入法组词；未验手机软键盘、跨段选区、移动工具栏、系统选图、阅读手感、旋转及全部生命周期。未达到一本日记效果验收，也不是完整 Compose 产品。此 AVD 不运行 MagicOS。

## 两条主路线的比较

| 路线                                           | 已有收益                                                      | 必须解决                                                            | 当前证据                                              |
| ---------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------- |
| Telegram Android 改造                          | 成熟聊天/媒体/选区/回复/滚动；当前上游已有原生全屏 RichEditor | 启动/账号/网络与本地事务边界；草稿/插图上传；richdoc 及媒体身份映射 | 固定 commit 源码抽查，未完整构建或离线运行            |
| 自有 Kotlin/Compose 外壳＋本地 richdoc WebView | 掌握领域/保存边界；复用拾页正文结构                           | 手机长文交互；聊天分页、草稿、回复、媒体/键盘协同等成熟度           | 真实编辑核心已在 AVD 验证，没有 Compose 外壳/聊天产品 |
| 自有外壳＋纯 Compose 富文本                    | 原生库已有图文、撤销与实验 JSON 文档能力                      | 稳定块/出现身份、时间、未知节点、完整 richdoc 可逆映射              | 源码评估，没有同等级往返运行回执                      |

工程建议：优先以**自有外壳＋现有 richdoc 核心**制作下一阶段双入口样机，因为已有格式基础与实际离线回执；这是建议，不是用户已定案。Telegram 仍为主候选，成熟聊天的收益需要认真比较。若 WebView 中文组词/选区/工具栏不能过关，应重新比较原生编辑器，不能用格式复用压过写作体验。

公平比较时 Telegram 也可承载同一 richdoc 核心，不能把新做长文的成本只算给一方。下一阶段样机必须同时有整篇思绪和随想自聊，使用同一内容契约/虚构库，并通过相同的事务保存、媒体、重开与备份恢复关卡；不能以单气泡演示或单长文探针宣布路线胜出。

## 报告与位置

- [Telegram 比较](../outputs/2026-10-17-android-client-setup/telegram-comparison.md)：固定官方 commit f32ffeec763f0bdbf4bec25b52d654f77bff733d，原生 RichEditor 与聊天服务接缝。
- [原生外壳比较](../outputs/2026-10-17-android-client-setup/native-comparison.md)：编辑器依赖、正文映射与聊天成本，静态分析和后续实测分开。
- [一本日记参考/共同验收矩阵](../outputs/2026-10-17-android-client-setup/diary-reference.md)：仅旧 1.96.55 资源静态证据，未运行或复制原应用素材，不能推断当前版本效果已复刻。
- [验收与失败修复](validation/2026-10-17-android-client-setup.md)。

成品/回执：D:/拾页/outputs/2026-10-17-android-client-setup。下载、源码缓存、脚本和隔离工程：D:/拾页/tmp/android-client-setup。已安装工具/状态：D:/codex-tools 对应目录。未更改正式日记、桌面源码/运行版或手机。
