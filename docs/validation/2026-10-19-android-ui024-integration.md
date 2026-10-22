# Android UI024 首批同包整合与离线 QA 构建

三份 v2 候选均由非作者 Sol 高按精确冻结清单准入 **5554 隔离定向 QA**：日记 `8bc681ac…`、原生 `fbab8e94…`、聊天 Web `2b602a16…`；独审原文位于 `outputs/2026-10-19-android-ui024/independent-review/`。v1 两份失败报告和原 QA8/QA9 失败边界保留。准入是源码合包门槛，不是手机功能验收。

整合只取 `tmp/android-chat-ui023/stage-qa9` 的完整 11,825 文件（QA9 manifest SHA `a840b650…`），逐个 SHA 与文件集合验证后，覆入三份候选列出的 12 个替换目标及新增 `PickerAlbumState.java`。新 stage `tmp/android-ui024-build/stage` 共 11,826 文件，其中 native 文件 53→54、Java 35→36；其余 11,813 个 QA9 文件 SHA 不变，原休眠 data 两资产保持。完整路径、源映射、三份清单和独审 SHA、逐 stage SHA 在 `outputs/2026-10-19-android-ui024/stage-manifest.json`（SHA `75ddb05a986d25f8377d38032582aa62122a1b261102405da38b844cd8f078e7`）；总差分 `stage-qa9-to-ui024.patch`（SHA `8ce000ba3c7a3e45b436b5edc69f4cdc40379928ee9369878ec475e62242de20`）。原 native QA9/v1→v2 两层差分及反例在 `native-ui/v2/`。

先核 live 的 12 个既有源码仍是各自 QA9 source SHA、新类不存在，再逐文件备份到 `tmp/android-ui024-build/source-backup`，仅窄回写这 13 个目标；回写后的 SHA 和原备份均再核。`editor.html` 保持 canonical 源码无 stage 专用 `editor019.css` 链接：从候选 stage HTML 精确移除唯一注入片段得到源码 SHA `daeacb27…`，反向注入逐字节恢复候选 stage SHA `8e4b6fc9…`；未重复插入。详见 `source-backwrite.json` 和 `merge-verification.json`。QA9 stage 再次逐 SHA 复核未变，原普通 `f42a3215…` APK SHA 未变。

新建 `android/ui024-qa` 独立 Gradle 工程，固定 `dev.shiye.uiqa`、code 26、`0.24.0-ui-localqa`、min 26/target 35、SDK 36/JDK 17 和原 prototype debug 签名；`preBuild` 强制完整 stage 文件集合与 11,826 SHA 校验。`assembleDebug --offline` 成功，实际 Java 编译、资源与 DEX 打包见 `outputs/2026-10-19-android-ui024/build.log`。冻结 QA 包 `Shiye-UI024-localqa-pass1.apk`：SHA `856319e907d013e93ad3dfff962d86865fdd4e815c356f27be6d48ab03b7fb9c`，92,377,630 字节。aapt 实读包身份、SDK；apksigner 验签证书 SHA `75df9c8f…`。ZIP 内 11,772 个 assets 与新 stage 逐字节 SHA 一致，2 个 DEX 有记录并包含 `PickerAlbumState`，见 `apk-verification.json`。

**安装与实际启用：均未进行。** 本整合未连接/操作 5554、手机或正式服务，未导出普通手机包。root 获得新设备 lease 后才可安排同包定向实测：选图 A→B→C 失败/乱序、网格与分页、IME 开/关及主动收起、两列表状态栏与安全区、Q12 定位关闭时序、媒体迟 ACK 和新引用、G5/G9 邻近首显。MagicOS/百度 IME、真实 MediaStore/权限和整轮 F24/G9 均未由本次构建证明；篇内搜索等后批功能与新 backend 未混入。
