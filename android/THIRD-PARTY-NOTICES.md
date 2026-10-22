# 来源与许可

本轮原生导航与阅读列表图标使用 Google Material Symbols Rounded，固定 commit `49d4db35df873165d6bd6ba09b063c7dafbac2f4`，Apache-2.0。原始 SVG 与完整许可在 `resources/vendor/material-symbols-20261017/`，转换后的 VectorDrawable 与 SHA-256/来源清单在 `vendor/material-symbols-20261017/`；APK 使用 `res/drawable/ms_*.xml`，只转换 viewBox 坐标和可着色路径，没有手绘近似替代。官方来源：[google/material-design-icons](https://github.com/google/material-design-icons/tree/49d4db35df873165d6bd6ba09b063c7dafbac2f4)。完整许可也随 APK 打包。

Android 原生外壳、SQLite 存储、媒体桥及附件面板为本项目代码。第一版原生聊天仍保留原记录入口；第二版真正复用 **Telegram Web A 12.0.46** 的本地化移动消息前端，遵循 GPL-3.0-or-later。它是 Web A 的 WebView 适配，不能称作 Telegram Android 原生 Java 控件的移植。

原上游为 Ajaxy/telegram-tt，固定 commit `090e38f1dffec3e0a9aefbec8159a9931fbeec8f`。本轮冻结来源为本项目 ui18 发布快照 `outputs/desktop-maintenance/releases/2026-10-17T18-38-43-932Z-3b4b2c77/app`，避免重新构建并行未验源码。变换及平台接缝在 `android/telegram-adapter/`；APK 内 `assets/telegram/Telegram-Web-A-LICENSE.txt` 与 `THIRD-PARTY-LICENSES.txt` 保留完整许可。构建清单、依赖许可与冻结对应源码映射在 `outputs/2026-10-17-android-frontend-v2/telegram/`。当前 worktree 不能冒充冻结快照的精确源码。

以下 Telegram Android 原生代码仅作为第一版设计/工程参考，未复制其 GPL Java 源码：

本次参考固定 commit `f32ffeec763f0bdbf4bec25b52d654f77bff733d`：

- [ChatAttachAlertPhotoLayout](https://github.com/DrKLO/Telegram/blob/f32ffeec763f0bdbf4bec25b52d654f77bff733d/TMessagesProj/src/main/java/org/telegram/ui/Components/ChatAttachAlertPhotoLayout.java)：附件照片网格、底部面板、授权和媒体选择边界。
- [Telegram LICENSE](https://github.com/DrKLO/Telegram/blob/f32ffeec763f0bdbf4bec25b52d654f77bff733d/LICENSE)：如后续取用功能代码，必须保留并遵循该代码具体许可，不能因为借鉴设计省略审查。

长文编辑复用本项目 public/editor、public/shared 与 public/core 的现有编辑器代码。第三方富文本打包文件 public/vendor/rich-editor.js 包括 Tiptap/ProseMirror 等依赖；完整逐包名称、版本与许可原文位于 public/vendor/RICH-EDITOR-LICENSES.txt，并随 APK assets 一起打包。Gradle sync 复制既有文件，不另改第三方源码。
