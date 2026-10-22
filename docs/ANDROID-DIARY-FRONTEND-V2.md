# Android 思绪长日记前端第二版

2026-10-17：本页记录 `android/app/src/main/assets/editor.html`、`editor.css`、`editor.js` 的界面适配。当前已完成源码与独立浏览器验证；APK 构建、安装、模拟器运行回读由主会话统一执行，本页不将浏览器结果写成原生验收。

## 用户确认与入口边界

用户确认核心是一本日记安卓版的长日记编辑体验、Telegram 的随想会话和消息前端。以已实际观察的原版 **1.96.55** 为参考，见 [逐页观察](ANDROID-REFERENCE-REVIEW.md)。本次看过 `simple-editor-confirmed.png`、`editor-keyboard.png`、`reading.png`，没有复制其私有资源或反编译实现。

用户本轮最新补充：默认先打开会话列表；长日记要有专门的快捷写作入口，不能要求先经过阅读列表。原生主会话负责“随想 / 写日记（直接新建编辑） / 思绪（阅读列表）”及“打开即新建日记”启动选项。本页无 `read=1` 默认可写；已有篇从阅读列表传 `read=1` 进入阅读，右下角“继续编辑”切回同篇。空篇创建/未写返回沿用原生 store 语义，不自动删空篇。

## 已实现

- 正文优先的浅纸色整页：58px 顶栏、紧凑日期/星期、默认隐藏空标题。非空已有标题始终显示，不能通过外观开关隐藏；清空标题不会让正在输入的字段突然消失。
- 分类/标签默认折叠。日期旁概要保留已有分类和标签数，点击展开后沿用现有分类选择与标签去重/长度校验，阅读时也可展开查看。
- 工具栏保留真实共享编辑器命令；撤销/重做与编号列表改用明确 SVG 图标，缩进移至首屏前三项，图片按钮固定在右侧，其余格式可以横向滑动。格式按钮继续防止点击夺走正文选区，保留组词保护。
- 阅读收起格式栏、禁止改写正文，显示“继续编辑”浮钮。已有标题和连续段落保持，图片阅读仍走现有 native `viewImage` 契约。
- 更多面板包含标题、元数据折叠、17/19/21px 字号、衬线/系统字体、字数/图片数、手动保存。外观偏好仅写 WebView `localStorage` 的 `shiye.android.diary.presentation.v2`；不加入 `entry`、不改 `body`、不经 native `saveEntry` 保存。不可用时本次视图仍生效，并明确提示不能持久保留。
- 模式切换调用 `setEditable(..., false)`，避免把可编辑状态切换发成内容更新。权威正文仍只有原有 shared richdoc，未增加 HTML/纯文本双权威。
- 保留原有 400ms 自动保存、revision/ACK 队列、保存失败重试、返回前 flush、组合输入等待、图片资源/出现身份/插入时间与图注/排版编辑契约；原生 MessagePort 操作名未改。空图文提示不会盖在仅图片正文上。

## 独立验证

在 Headless Chrome、393×760 CSS px、真实共享 `rich-body-adapter` / Tiptap / richdoc 校验器、mock 原生 MessagePort 下，**31 项检查通过**。脚本 `tmp/android-frontend-v2/verify.mjs`；回执 `outputs/2026-10-17-android-frontend-v2/browser-verification.json`。

覆盖空标题/折叠与首屏正文位置、设置不脏化条目、中文两段、真实全角缩进与 Undo/Redo、保存 richdoc 与桥接快照相同、分类/标签去重、阅读/继续编辑/同篇重开、已有标题保护和偏好重开、保存失败不关闭/重试后 ACK 才关闭、万字正文、缩小 viewport 后工具栏不越界、图片图注/排版与三个身份字段保持、模拟 composition 期间暂停保存/结束后保存、浏览器无脚本错误。

`node --check`、该 JS 的 ESLint、三文件 Prettier 检查通过。全项目 `npm run check`、APK 打包和原生验收由主会话汇总，不在本页虚报。

截图为虚构内容：`blank-editor.png`、`chinese-editor.png`、`reading.png`、`resized-viewport.png`、`more-panel.png`，均在上述 outputs 目录。字号/字体截图可能是测试主动选择的 21px / 系统字体，并非默认 19px / 衬线设置。

## 主会话建议验收与未验边界

1. 从“写日记”及“打开即新建日记”直接进入可写新篇；空标题不占位，正文无需先切换模式。返回沿用 store 空篇语义。
2. Android 真实软键盘打开/收起，工具栏在键盘上方；缩进与格式按钮不丢选区。连续中文拼音组词、标题与正文之间切换、候选确认、系统 Back 收键盘后再保存返回。
3. 旧样机篇从思绪列表进入阅读，标题/分类/标签/正文图片保留；继续编辑后返回/重开，数据和图注不丢。
4. 更多面板触发键盘收起后的高度、字号/字体选项、本机 WebView 重启后的外观记忆、系统字体缩放与旋转检查。当前字体是系统可用字体栈，未捆绑中文字体，具体字形须看 AVD。
5. 真实图片选择取消/选取/预览、长文滚动与选择、应用切后台及系统返回保存。Headless viewport 缩小不等于真实 Android IME；合成 composition 事件不等于真实中文输入法验收。

本次没有操作模拟器/手机、正式日记库、桌面窗口或旧样机内容；未编辑 MainActivity / LocalStore / Gradle / 共享桌面核心。

产物：`outputs/2026-10-17-android-frontend-v2/`；临时脚本：`tmp/android-frontend-v2/`。
