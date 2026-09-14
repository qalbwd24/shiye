# 0.7 工作区界面与交互依据

2026-09-14。此次以现有原生 JavaScript、CSS 变量与 dialog 为基础重组页面；没有引入 React 或新的组件库依赖。调研用于理解交互原则，没有复制第三方实现代码。

## 一手设计参考

- [Radix Dialog 官方说明](https://www.radix-ui.com/primitives/docs/components/dialog)：关注模态状态、标题语义、焦点留在弹窗内和 Escape 关闭。拾页沿用原生 dialog/showModal，补齐 aria-labelledby；设置的正文单独滚动，标题和关闭按钮保持可见。外观预览仍按 close/modalreplace 清理，未保存的预览不会污染库设置。
- [react-resizable-panels 作者仓库](https://github.com/bvaughn/react-resizable-panels)：参考面板与分隔条的职责划分。本项目原生实现媒体分隔线，支持 Pointer Events、左右箭头、Home/End 和尺寸边界；只在拖动结束持久化宽度，面板显隐互相独立。
- [Joplin 官方布局介绍](https://joplinapp.org/news/20201212-172039/)：它允许重新安排侧栏、列表和编辑区。本次将导航、列表、正文、媒体明确分区，媒体可选正文左侧、右侧或下方。窄窗口自动纵向排列，避免挤压正文。Codex、Obsidian 是用户提出的布局参照，本文不将它们表述为开源项目。

## 已落地的结构

- 左侧保留日记视图、分类和标签；往日此时、地点、草稿和隐藏日记放在「更多视图」中。底部只呈现统一「设置」入口。旧帮助、快捷键、原件导入和本地库按钮保持原 DOM 与处理函数，通过设置页面调用。
- 顶部三个可见控件独立控制导航、日记列表和媒体。分类/标签另有二级折叠；正文/标题获得焦点时进入专业写作，编辑栏提供明确的「进入写作／返回阅读」按钮；专业模式临时收起导航和列表、扩宽正文，图片改为缩略视图。顶部导航或列表按钮可恢复阅读布局，原快捷键兼容保留。
- 设置在视口居中，左侧分区为常规、编辑与记录、工作区布局、外观与背景、分类与标签、数据与备份、隐私与锁定、快捷键、帮助与关于。页面重用原有字段节点与事件，避免复制字段或破坏保存路径。
- 正文位于 .entry-writing；#entryMediaPane 将图片与其下方评论放在同一区域，保留 #attachments、#dropZone、#chooseMedia。媒体卡片和上传由 gallery/media-import 模块负责。

## 存储与集成边界

preferences.layout 兼容旧 categories/tags/list 布尔项，增加可选 sidebar、media、mediaPosition（left/right/bottom）、mediaWidth（240–680）、listWidth（220–440）。布尔值仍以 true 表示折叠。旧布局输入的规范化输出保持原有三字段默认值；新增默认值在界面读取时提供，不修改日记正文或媒体关系。布局写入排队执行，失败恢复已保存状态并提示。

features/index.js 显式装配 workbench、gallery、comments。workbench 负责布局与设置壳；gallery/comments 由主渲染流程调用。所有新样式继续由 style.css 集中加载。

## 验证边界

新增 workbench-layout.test.mjs 覆盖旧折叠兼容、边界校验、保存与其他偏好共存、无效请求不发生部分写入。整体界面与真实开发库验收由主任务统一执行；本文不将静态检查表述为已完成浏览器验收。

## 第二轮布局调整与验收记录

评论宿主已移到图片展示区下方，与图片共用侧栏；顶部「图片与评论」同时控制这一整个区域。正文或标题获得焦点进入专业写作，保留显式「返回阅读」按钮；写作布局临时收起导航和列表、侧栏宽 300px。图片缩略样式由 gallery.css 控制。main.js 通过 offline.toggleWriting 接入旧快捷键，通过 offline.readingMode 在切换日记时恢复阅读；不会在每次正文重渲染时重置模式。

本轮修改已通过 ESLint 和针对修改文件的 Prettier。实际浏览器验收尝试访问隔离服务 http://127.0.0.1:18767，Computer Use 报告 `Browser is not available: iab`，随后可用浏览器选择返回 `No browser is available`。因此没有生成伪造的验收截图，也没有将桌面、窄屏或模式切换标成已完成真实浏览器验证。后续主任务已恢复浏览器连接并开展实际验收，重点包括专业模式/阅读恢复、图片下方评论、设置分区保存与模态关闭，以及窄窗口中的布局；最终结果以主任务统一 validation 记录为准。

## 个人资料与动态头像

左上角由可导航首页链接改为「个人资料」按钮，直接显示头像、用户名和座右铭，不会重新载入页面或丢掉编辑草稿。默认显示「我」和「把日子，收藏起来」。设置新增个人资料与表情包分区。

头像支持 GIF：上传复用已有压缩器的动图原件保留路径。圆形预览使用原生 img，拖动调整位置，范围滑块提供键盘调整，缩放为 1–3 倍；保存的是 `preferences.profile.authorAvatarCrop={x,y,zoom}`，不是重新编码的裁剪图片。共享 `public/shared/profile.js` 输出有限数值 CSS，使侧栏与评论头像显示一致。评论创建时保留作者与裁剪范围快照；之后改资料不重写旧评论。

交互参考 [Radix Avatar 官方说明](https://www.radix-ui.com/primitives/docs/components/avatar) 的图像／缺失回退，以及 [react-easy-crop 作者仓库](https://github.com/ValentinH/react-easy-crop) 的拖动定位与缩放操作；没有引入 React、第三方裁剪库或以 canvas 把 GIF 导出为静态图。

`tests/profile.test.mjs` 四项通过：裁剪值与 CSS 校验；资料与其他偏好共存、GIF 原字节不变、旧评论快照不变；无效资料原子拒绝；默认加密备份恢复保留目标库个人资料。初次浏览器验证曾因连接不可用而受阻；后续主任务已恢复浏览器连接并开展实际验收。动态播放／拖动的最终结论以主任务统一 validation 记录为准。
