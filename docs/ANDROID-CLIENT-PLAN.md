# 拾页 Android 客户端：需求与技术调研

2026-10-17 Android前端0.2.0已覆盖安装主AVD并实际验收：默认会话列表/置顶→消息与发送，底部“写日记”直接新建，“思绪”独立阅读/继续编辑；支持冷启动直接新建或继续上次页。底部位置是试用安排。长文按一本日记实际观察调整并复用richdoc，聊天真实复用冻结Telegram Web A移动前端；旧SQLite记录逐行hash保持，新聊天单独IDB，不自动同步或合并。最终worker就绪竞态已修，验收及未验边界见[第二版](ANDROID-FRONTEND-V2.md)、[验证](validation/2026-10-17-android-frontend-v2.md)。不占手机、不动桌面运行/正式日记。

2026-10-17 用户进一步收敛核心：**思绪实现一本日记安卓端的长日记编辑体验，随想实现 Telegram 的聊天页面与消息前端**；优先复用成熟实现，服务器/AI/回顾/便签暂缓。一本日记原版1.96.55已在独立断网API30参考AVD实际走过新建、标题、两段输入、缩进、返回保存、阅读/继续编辑与简洁模式；原版相册导入/Markdown等分支尚未验证完成。当前双入口样机已安装主AVD；原生手写聊天仍是验证层，正式组件待适配验收。见[参考与复用](ANDROID-REFERENCE-REVIEW.md)、[样机](ANDROID-PROTOTYPE.md)及[验收](validation/2026-10-17-android-dual-prototype.md)。

2026-10-17 用户已选自有安卓App路线并授权制作思绪/随想双入口样机，在AVD展示；要求主要功能向电脑端对齐、长日记按一本日记式整篇体验，新增尽量参考Telegram设计/功能代码，特别附件即开图片网格与动效。源码android/采用原生Java Views/SQLite＋共享richdoc局部WebView；首次构建安装已成功，交互/保存/图片面板正在验收。无INTERNET、虚构种子、独立dev.shiye.app，不占手机/不动桌面正式数据。见[样机需求与对齐清单](ANDROID-PROTOTYPE.md)。产物outputs/2026-10-17-android-dual-prototype，临时tmp/android-dual-prototype。

2026-10-17 Android Studio/SDK/独立AVD已配置并实际启动（API36、WHPX可用），开始菜单 Android 开发 有Studio与模拟器入口。真实richdoc隔离壳已Gradle构建，AVD本地图文、万字/撤销重做/ACK后杀进程重开保真通过；不代表中文IME/一本日记效果或完整双入口App已验。sol高并行报告确认Telegram有原生全屏RichEditor，但草稿/媒体/账号边界需本地化；自有外壳仍需成熟聊天实现。框架未定案，未动手机/正式日记/桌面运行版。见[环境与比较](ANDROID-DEVELOPMENT-ENVIRONMENT.md)、[验收](validation/2026-10-17-android-client-setup.md)。成品outputs/2026-10-17-android-client-setup，临时tmp/android-client-setup，工具/缓存D:/codex-tools对应目录。下方“未安装/未创建”为上轮快照。

更新：2026-10-17。状态：双入口可行性样机已实际运行，正式聊天组件与完整跨端兼容仍在选型/适配；不涉及桌面升级。下文早期工具与授权段落保留为历史，最新需求以上方用户确认为准。

## 用户已确认

- 目标手机为荣耀 Magic7。
- 安卓端希望结合一本日记的长文体验，以及 QQ／微信／Telegram 式聊天交互。
- 第一阶段必须同时支持 **思绪式长日记** 与 **随想式短消息**，两者都是刚需；不能只交付聊天演示或把长文延后。
- 用户进一步明确：长日记希望做到“一本日记安卓端那样的效果”。完整编辑与阅读体验为核心参考，不能把支持长文本或直接嵌入电脑网页等同于达到目标；图文排版、工具栏、键盘/选区等具体行为需对照参考界面逐项核实。
- 随想主要用于和自己对话记日记；AI 与往日回顾后续再加入。
- 便签后续再说。云服务器连接与后端方案后议。
- 已授权读取规范、调研开源路线、配置 Studio/AVD，随后选择自有安卓App并要求制作双入口样机；已实施可行性样机，正式聊天组件尚未定案。
- 日常测试以电脑上的 Android 模拟器为主，避免占用正在使用的手机；Magic7 仅后续必要时短时间抽验。用户已授权 GPT-6.1-sol 高推理子代理并行调研复核。

以下架构、页面组织和验收步骤均为本轮建议，不代表用户已经确认全部细项。

## 已读规范与现有资产

项目入口为 WORKSPACE、DEVELOPMENT-HANDOFF、README、FEATURE-MAP、PRODUCT-NAMING、DATA-MODEL，以及统一数据契约、消息主体实施文档和快捷工作区需求。跨项目已读 F:/agent规范 的 AGENTS、README、catalog，以及聊天界面/业务数据分离、日记与消息统一内容模型、本机项目盘点等主题。

| 本机位置                                                   | 能复用的部分                                                  | 状态与限制                                                                         |
| ---------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `D:/拾页/public/editor/`、`public/shared/rich-document.js` | 结构化富文档、图文编辑、媒体出现身份、时间与阅读投影          | 已有电脑端能力；Android WebView 的软键盘、选区、图片桥接和进程恢复必须另验         |
| `D:/拾页/previews/telegram-chat/`                          | 随想交互、消息布局、主题、媒体和本地业务适配经验              | Telegram Web A 的修改版，不能把 Windows WebView2 宿主直接移到手机                  |
| `D:/拾页/docs/MESSAGE-UNITS-IMPLEMENTATION.md`             | 稳定消息身份、正文权威源、长文布局、回复/评论/撤回与媒体关系  | 统一消息层仍有隔离候选和未部署范围；不能仅凭桌面版本号认定正式启用                 |
| `D:/Termlens/android-probe`                                | Android 原生 Activity、选区处理、媒体与脚本构建、真机调试经验 | Java 项目，不是现成 Compose 工程；不把选词权限和后台机制直接加进日记 App           |
| `E:/个人兴趣研究/安卓Assert`                               | SQLite、事务、备份、进程生命周期与荣耀真机经验                | 同样是独立 Java 项目，业务与签名不混用                                             |
| `F:/<个人目录>/日记软件本地化/安卓私有版`                    | 历史兼容、导入/备份、原安卓界面行为的参考                     | README 为基于原 APK 的补丁工程，不是完整可维护的原生客户端源码；本轮不继续修改该包 |

旧私有版的服务器地址、账号、签名及配置不复制到新方案。正式日记与原件保持原位，不直接读写运行库来制作开发样本。

## 开源项目对比

核对方式：维护者仓库 README、许可证原文、GitHub API 默认分支最近提交。固定 commit、抓取时间和 SHA-256 保存在 `outputs/2026-10-17-android-client-research/repository-snapshot.json`。下列维护日期是核查时默认分支最近提交日期，不是最新发行版本或稳定性承诺。

| 候选与来源                                                                  | 类型、栈与维护快照                                                                   | 二次开发判断                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Telegram Android](https://github.com/DrKLO/Telegram)                       | 完整客户端；Java 与原生模块；GPL-2.0；最近提交 2026-10-13                            | 确有官方完整客户端源码，可以 Fork 二次开发，应保留为主候选之一。消息、媒体和成熟交互可复用；改为本地随记要替换数据/账号/网络边界，并接通完整长文入口。其上游已含原生全屏 RichEditor，但草稿/图片上传及正文映射仍需本地化。README 的原版正常构建面向 Telegram 服务，要求 API 配置、SDK 36 与 NDK 等；不能把原版账号要求误写成改造后拾页必须使用 Telegram 账号 |
| [Element X Android](https://github.com/element-hq/element-x-android)        | Matrix 完整客户端；Kotlin/Compose + Matrix Rust SDK/FFI；AGPL 或商业许可；2026-10-16 | 可参考现代安卓消息界面与模块划分。完整采用会带入 Matrix、Rust SDK 与相应业务边界；目前自聊日记不需要这套通讯基础设施                                                                                                                                                                                                                                         |
| [Tinode / Tindroid](https://github.com/tinode/tindroid)                     | 完整 Android 客户端；Java；Apache-2.0；2026-09-26                                    | README 明确需要 Tinode 后端，也包含离线能力。适合未来真人 IM 的候选；已有离线缓存不等于能开箱作为无需账号/服务器的日记库                                                                                                                                                                                                                                     |
| [Stfalcon ChatKit](https://github.com/stfalcon-studio/ChatKit)              | 原生 Views 聊天 UI 组件；Apache-2.0；2021-03-29                                      | 支持自有消息模型、列表和输入框，后端耦合较少。但默认分支长期无新提交，README 仍有旧 AndroidX 迁移说明；只作控件参考，现代 SDK/大字体/输入法需自行维护                                                                                                                                                                                                        |
| [Flyer Chat / flutter_chat_ui](https://github.com/flyerhq/flutter_chat_ui)  | Flutter 聊天组件；Apache-2.0；2026-09-26                                             | README 明确 backend-agnostic，可自定义消息组件，并有文本/图片/文件/流式消息模块。是本轮最值得验证的现成聊天组件路线；它不替代数据库、长文编辑和拾页的数据契约                                                                                                                                                                                                |
| [Stream Chat Android](https://github.com/GetStream/stream-chat-android)     | Kotlin/Compose 聊天 SDK；2026-10-16；当前为专有 Stream License                       | 不能依据“仓库公开”当作通用宽松开源库。当前 LICENSE 将授权与 Stream 客户及其 API 结合，不列为本地日记/未来自建后端的直接复用底座                                                                                                                                                                                                                              |
| [OpenIM Android Demo](https://github.com/openimsdk/open-im-android-demo)    | IM SDK 示例客户端；2025-10-27                                                        | README 要求 OpenIM Server，并声明 AGPL-3.0 加附加条款、不允许商业使用；LICENSE 为 AGPL 文本。须保留这项声明差异，不能简写成任意可复用的纯 AGPL 项目。当前用途以自聊为主，暂缓                                                                                                                                                                                |
| [腾讯云 TUIKit Android](https://github.com/TencentCloud/chat-uikit-android) | 聊天 UI 组件与示例；仓库 Apache-2.0；2026-06-15                                      | 官方提供会话/聊天/搜索等 UI，正常示例基于腾讯云 Chat SDK 和 SDKAppID/UserSig。不是 QQ／微信完整客户端；本地使用需评估数据提供者替换，不能从 UI 仓库许可推断底层 SDK/表情资源同样授权                                                                                                                                                                         |

上述“耦合成本”“是否适合”是依据项目公开定位与本任务需求作出的工程判断。本轮没有完整编译这些客户端、审计全部网络路径，或证明其在 Magic7 上的性能。GPL/AGPL 项目若实际取用代码，需按最终选定版本完整核对许可证及发布方式；本表只记录来源文本。

### QQ／微信／Telegram 的区别与 Telegram 改造边界

Telegram [官方应用入口](https://telegram.org/apps) 列出客户端源码，Android 可直接取用上表仓库。QQ、微信本轮未找到官方公开的完整 Android 客户端源码；公开的 [WeDemo](https://github.com/Tencent/WeDemo) 是登录/分享接入示例，[MMKV](https://github.com/Tencent/MMKV) 是存储组件，均不是整套客户端。第三方仿微信 UI 或腾讯云 TUIKit 也不能当作微信本体源码。

本轮补读固定 commit 的 ChatMessageCell、ChatActivity、MessageObject 三个文件，保存到 tmp，SHA 与符号线索见 `outputs/2026-10-17-android-client-research/telegram-code-clues.json`。UI 文件直接出现 TLRPC、MessageObject、MessagesController、ConnectionsManager 等类型/入口，说明直接抽取聊天显示并非拷贝一个独立控件即可。这仅是源码依赖线索，不能由符号次数推导精确工期或判定改造不可行。

后续固定源码已补读原生全屏 `org.telegram.ui.iv.RichEditor`：它不是长聊天气泡，也不是 WebView，已有图文和撤销基础；草稿经过 MediaDataController，插图立即进入 RichMediaUploader/FileLoader 上传链。完整来源与本地化接缝见[Telegram并行报告](../outputs/2026-10-17-android-client-setup/telegram-comparison.md)。

若选整客户端路线，验证顺序应是：本地启动身份/跳过服务登录 → 隔离本地会话与消息事务 → 图片等本地媒体 → 网络调用清单与限制 → 加入思绪完整长文 → 映射拾页共同格式与备份。不能只隐藏登录/联系人菜单就声称已完成离线化。是否保留上游消息模型作纯 UI 适配层、是否复用其 SQLite 存储，要由小样验证决定；它们不能成为与拾页正文竞争的第二权威源。

## 长文编辑器必须单独比较

| 路线与来源                                                                 | 可以借鉴什么                                                                        | 拾页需要额外解决什么                                                                                                        |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 现有拾页富文档编辑器，Android 本地 WebView 承载                            | 复用已有结构化正文、段落、图文和原有渲染规则                                        | 抽出独立编辑器接口；本地媒体 URL/原生选择器/保存桥接、组合输入、返回、进程恢复和长文性能。手机不依赖电脑 Node 服务常驻      |
| [Compose Rich Editor](https://github.com/MohamedRejeb/compose-rich-editor) | Apache-2.0；原生 Compose 富文本；README 说明支持 HTML/Markdown；最近提交 2026-10-08 | 不代表能无损往返拾页 richdoc 的 blockId、occurrenceId、时间和未知节点。要验证结构化适配及图片编辑，不能仅转 HTML 后认定兼容 |
| [Flutter Quill](https://github.com/singerdmx/flutter-quill)                | MIT；Flutter 富文本与嵌入块；2026-09-16                                             | 底层 Delta 文档与拾页 richdoc 不同。若搭配 Flyer，需要可验证的双向转换或保留权威原结构；不能靠有损 HTML 中转同步正文        |

“两个输入框都能打字”不是双入口完成。长日记必须保持整篇连续编辑/阅读；随想必须保持消息列表与发送体验。未来需要统一查询时，依据同一份权威内容生成视图，避免两份可以独立改写的正文相互覆盖。

## 建议的优先路线

**先公平比较两条原生主候选：Telegram Android 改造，以及 Kotlin + Jetpack Compose 自有外壳。** 前者重在保留成熟聊天 UI，后者重在让两个写作入口和拾页数据从一开始清晰组织。没有实测前不把“自己写肯定更简单”或“开源整包肯定更省事”当结论。

从数据与双入口的组织看，本轮暂倾向 Kotlin + Jetpack Compose 做安卓外壳、导航、随想消息列表与系统接入，本地 Room/SQLite 和私有媒体目录保存；思绪优先做现有富文档编辑器的 Android WebView 可行性验证。其理由是长日记和短消息同时必需，现有正文格式与媒体规则的保真价值高。最终仍需与 Telegram 本地化样机的交互复用收益比较。

这不是说现有网页已经可直接打包发布：需要专门抽离、适配和真机验证。若软键盘/选区/长文体验不通过，再比较原生 Compose 编辑器；不能为了维持技术选择降低长文要求。随想列表中的稳定 key、分页、图片异步解码、阅读锚点和 IME 处理也要实现，并非 Compose 自动提供成品聊天体验。

**备选：Flutter + Flyer Chat + 长文编辑器。** 若更希望直接复用成套聊天 UI、未来也有 iOS 计划，这条路线值得先做同等双入口样机。优点是聊天组件现成；代价是增加 Flutter/Dart 工具链，长文格式仍需桥接或转换。本机现有电脑前端也不能直接作为 Flutter Widget 使用。

**补充候选：全本地 WebView 复用电脑网页。** UI 复用更多，但电脑的 Node 接口、路径和 IndexedDB 归档桥不能原样照搬。需提供手机本地存储与受控资源访问，并真机验证双入口；不把它预设为正式方案。

Telegram 保持主候选，先核验本地化接缝；Element/Tinode 等则在后续目标转向真人多用户通讯时优先重评。上述均不是已定的框架选择。

## 数据与界面建议

- 第一版可把“思绪”“随想”设为两个明确入口，共用日记列表/分类/媒体服务。导航形式和默认首页待界面构思决定，不能把两个入口合并成同一聊天输入框。
- 本地成功保存即成为已保存内容；未来网络不可用不能影响写作。保存状态必须来自事务结果，不用动画代表保存成功。[Android 离线优先架构](https://developer.android.com/topic/architecture/data-layer/offline-first) 可作实现参考。
- 区分篇 ID、会话 ID、消息 ID、资源 assetId 与出现 occurrenceId；时间保持 UTC 及明确来源。缺失历史插入时间保持未知，不用导入/文件时间补造。
- 桌面现有 richdoc 与统一消息协议作为兼容目标，但在实际跨端导入导出验证前，不冻结成已验证的手机协议。共享契约测试可先用虚构样本；不直接挂载正式 diary.json，不导入全部私人日记做演示。
- 先有本地事务、草稿、媒体固化和导出/恢复。为未来同步留稳定 ID、revision、删除墓碑等接口边界；本轮不决定云厂商、同步协议、推送或加密方案。
- 长文解析/聊天归篇是视图与领域规则，不让 UI 库模型成为另一套权威数据；长文入口仍整篇编辑，聊天原消息的编辑/撤回语义沿项目规则单独处理。

## 本机工具与手机显示（上轮只读快照）

2026-10-17 后续已安装Studio/SDK/API36 AVD，WHPX与真实编辑壳运行通过；当前配置与限制以[环境文档](ANDROID-DEVELOPMENT-ENVIRONMENT.md)为准。以下仅保留安装前盘点。

本轮实际运行 `adb devices -l`，列表为空；未读取手机内容，当前不能复核 MagicOS/Android 版本和显示设置。

| 工具                                                 | 本次核验                                                                                                       | 后续用途                                                                                   |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| JDK                                                  | `D:/codex-tools/android-build/jdk/jdk-17.0.20.1+1`，java -version 成功                                         | 已有 Java 工具链；新工程按 AGP/Gradle 版本匹配 JDK，保留原项目环境                         |
| Android 平台/构建工具                                | `D:/codex-tools/android-build/platform/android-35`、`build-tools/android-15`，实际 API 35 / Build Tools 35.0.0 | 足够服务现有 Java 脚本工程；不等于已具备 Kotlin/Compose/Gradle 完整环境                    |
| ADB                                                  | `D:/codex-tools/android-adb-20261003/platform-tools/adb.exe`，Platform Tools 37.0.1                            | 查设备、安装测试 APK、日志与截图                                                           |
| Android Studio、Gradle、SDK Manager、Flutter、scrcpy | PATH、常见目录/登记项及既有工具目录中未发现；不是全盘不存在的证明                                              | 新 Compose 工程建议配置 Android Studio 及项目 Gradle Wrapper；Flutter 路线另需 Flutter SDK |

**按用户最新要求，建议的日常组合是 Android Studio + 项目所需 SDK/Gradle + Android Emulator/AVD + ADB。** [Android Emulator](https://developer.android.com/studio/run/emulator) 在电脑上独立运行 Android，拥有独立存储，可安装 APK、操作页面、编辑保存、选图、切后台、模拟旋转/断网，并测试不同 API/屏幕/字号，不连接也不占用 Magic7。通过 [Device Manager 创建 AVD](https://developer.android.com/studio/run/managing-avds)。

| 环境                                                                                 | 可以做什么                                                                                       | 与手机的关系                                               |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| [Compose Preview](https://developer.android.com/develop/ui/compose/tooling/previews) | 快速看组件排版、主题、尺寸/字号；仅适用采用 Compose 的部分                                       | 不连接手机；不能代替整 App、SQLite、WebView 与生命周期测试 |
| Android Emulator / AVD                                                               | 在电脑完整运行开发 APK，是日常功能测试主环境；Telegram/Flutter/原生都可以部署 Android APK 到 AVD | 不占用用户手机；不是运行荣耀 MagicOS 的精确复刻            |
| Magic7 真机                                                                          | 阶段性抽验荣耀系统差异、用户实际输入法、相机/媒体与设备性能                                      | 仅确有需要时安排短时验收                                   |
| Android Studio Device Mirroring / scrcpy                                             | 把真实手机显示到电脑并远程操作                                                                   | 仍会占用手机界面，不能满足“手机照常用”的主要诉求           |

Android Studio 并非命令行构建的硬性前提，但适合依赖管理、模拟器、预览、调试和性能分析。scrcpy 是可选投屏工具，不是模拟器也不提供编译环境，本阶段不必为了日常测试先装它。真机投屏可参考 [Studio 官方说明](https://developer.android.com/studio/run/device) 与 [scrcpy 官方仓库](https://github.com/Genymobile/scrcpy)。

本机只读硬件检查为约 31.5 GiB RAM、HypervisorPresent=true，具备继续评估模拟器的条件；这不证明 Windows Hypervisor Platform/AVD 硬件加速已经可用。安装后应按 [官方硬件加速说明](https://developer.android.com/studio/run/emulator-acceleration) 检查并实际启动一个 AVD，再判断性能。当前尚未创建或启动模拟器。

已有手机项目记录过 Android 16/API 36 和较大字体，这是历史设备快照，不是本轮读数。实施前重新查询系统/API、WebView 版本、字体和显示缩放，再选 compile/target SDK 并验证兼容。不因手机 API 36 就把现有 SDK 35判定为完全不能安装 APK。

工具证据：`outputs/2026-10-17-android-client-research/environment-snapshot.json`。本轮没有安装工具、修改全局 PATH、替换签名、配置模拟器或安装任何 APK。

## 实施前的最小验证建议

框架最终确认前做一个同时含思绪、随想的隔离样机，不先制作只有聊天的演示。

1. 思绪：以一本日记安卓端的长文编辑/阅读体验为基准，对照中文长文、段落、图文排版、工具栏、编辑保存、返回重开、软键盘组词与选区；再验证拾页格式往返不丢正文及身份字段。具体对照版本/页面尚未采集，不能宣称已还原。
2. 随想：命名会话、自聊发送、图片消息、历史分页、回到底部/保留阅读位置、逐会话草稿；确认本地事务保存后再显示“已保存”。
3. 两入口：相同媒体资源可达，日期/分类与内容模型一致；从长文视图与消息视图查阅时不产生双权威副本。
4. 生命周期：切后台、旋转/重建、系统杀进程后恢复已确认保存内容和草稿；存储失败明确提示。
5. 先在 AVD 验证大字体、显示缩放、返回手势、选图后恢复、长列表和无服务器时双入口；阶段完成后再在 Magic7 短时抽验荣耀特性、用户输入法、相机和设备性能，不长期占用手机。
6. 备份：虚构库导出、空库恢复，校验正文结构、ID、媒体哈希与引用；完成后再讨论旧日记导入。

性能预算、长文规模、音视频/Markdown 等首版细项仍需在构思中明确。以上尚未执行，不承诺已适配荣耀后台/IME、数据往返或长期性能。

## 本轮产物与后续入口

- 本文：项目需求、选型与工具结论。
- 证据：`D:/拾页/outputs/2026-10-17-android-client-research/`。
- 抓取/盘点脚本及公开资料缓存：`D:/拾页/tmp/android-client-research/`。
- 跨项目参考：`F:/agent规范/软件技术路径/Android双入口日记客户端与调试工具.md`。
- 本轮状态与检查见 [调研记录](validation/2026-10-17-android-client-research.md)。
