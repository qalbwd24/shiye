# Android 原生导航与思绪列表细化

2026-10-17。用户确认三入口结构保留，分别优化会话/消息、日记写作和日记阅读。此页记录主代理拥有的原生部分；长文 WebView 与 Telegram 页由对应专题记录。

## 实现

- `DiaryListPage.java` 只读取既有 `bootstrap.entries/categories` 元数据，按真实日期分月展示，日期无法解析时标明未定，不补造当前时间。原 `id/title/date/categoryId/category/tags/preview/searchText/wordCount` 沿用，不修改正文或新增持久 schema。
- 日记列表改为暖白连续篇目、日期侧栏、清晰标题/两行摘要/分类标签与字数，统一搜索框和分类筛选。空列表与筛选无结果分别提示，阅读/继续编辑/带确认软删除均保留。
- 从篇目返回时按原 entryId 和相对偏移恢复列表位置；这是会话内阅读位置，不写进内容模型。正常点击直接阅读，快捷写仍走底部独立新建，不要求通过阅读列表。
- 底部导航保持随想/写日记/思绪，白色低分隔、统一24dp图标/轻选中态和足够触控范围。当前页重复点击收起键盘且不重建页面；快速写保留原防重复创建与返回目标。
- 日记页和聊天页系统栏背景随页面衔接；底部切页仅短淡入，日记进入保留轻位移，消息动画继续使用 Web A 的实现。未改变输入法/窗口 inset、存储回执、照片选择或后端接口。

## 成熟素材复用

原生图标使用 [Google Material Symbols Rounded](https://github.com/google/material-design-icons/tree/49d4db35df873165d6bd6ba09b063c7dafbac2f4)，固定 commit `49d4db35df873165d6bd6ba09b063c7dafbac2f4`，Apache-2.0。十个原始 SVG/许可在 `resources/vendor/material-symbols-20261017/`；VectorDrawable/来源哈希在 `vendor/material-symbols-20261017/`。`res/drawable/ms_*.xml` 由原路径与 viewBox 转换，完整许可进入 APK `assets/licenses/Material-Symbols-LICENSE.txt`。没有手绘近似图标或为图标加入庞大 UI 依赖。

## 当前验收边界

全部原生 Java 与统一 Gradle 构建通过，0.3.0已在主AVD运行。真实日记流程16项及字号/面板4项通过，含三入口、月份/搜索/分类/空结果、返回筛选、同ID继续原文和21px重开保持；原行/媒体保持。完整系统字体缩放矩阵尚未验，见[实际QA](validation/2026-10-17-android-frontend-polish-qa.md)与[最终包](validation/2026-10-17-android-frontend-polish.md)。没有修改手机或桌面正式数据。

主入口 [ANDROID-FRONTEND-POLISH](ANDROID-FRONTEND-POLISH.md)，数据映射 [ANDROID-FRONTEND-DATA-ALIGNMENT](ANDROID-FRONTEND-DATA-ALIGNMENT.md)。产物 `outputs/2026-10-17-android-frontend-polish/`，临时脚本 `tmp/android-frontend-polish/`。
