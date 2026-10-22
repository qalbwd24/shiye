# Android 思绪编辑与阅读细节优化

2026-10-17。本轮只改 `android/app/src/main/assets/editor.html`、`editor.css` 和 `editor.js` 中的展示逻辑。当前为源码与独立浏览器验证结果，APK 和原生整合状态由主会话记录；没有操作手机、模拟器或桌面窗口。

## 本轮用户要求

用户认可的是“会话列表 → 消息、独立快捷写日记、底部进入日记查看”三入口，不代表认可旧页面内部全部排版。内部样式与细节须继续按成熟日记软件打磨。本轮保留入口与富文本核心，把纸面、字体、标题、日期、按钮、工具栏、更多面板和短屏空间统一整理。

参考实际看过的原版一本日记 1.96.55 截图：`outputs/2026-10-17-android-dual-prototype/reference/simple-editor-confirmed.png`、`editor-keyboard.png`、`reading.png`，并与 0.2.0 的实际浏览器截图比较。使用的是已经观察到的纸面编辑、简洁横向工具栏、阅读日期和继续编辑模式，没有拷贝原版资源或重新实现富文本编辑器。

## 完成的外观变化

- 纸面统一 `#FAF9F6`，正文 `#343338`，强调色 `#756383`。顶栏压至 56px，以小字号标题、细状态点和弱化的保存文字提供状态；阅读入口改为安静的文字按钮。
- 新外观默认系统中文字体、18px、1.85 行高、不额外拉开字距，手机正文两侧各 24px。继续保留衬线选项；明确保存过的 17/19/21px 和字体偏好原样读取。新增 18px 按钮，沿用原外观存储键，不向条目或正文写入外观字段。
- 编辑日期维持紧凑单行，分类与标签默认折叠；阅读日期使用大日数、月/星期、年份的分层组合。日期下细分隔线，标题与正文之间统一留白。
- 阅读标题使用仅由原 `title` 字符串填充的 `h1`，长标题完整折行。编辑继续沿用原单行输入框，避免因外观调整把 Enter 变成标题换行。非空已有标题始终显示。
- 格式栏的粗体、斜体、下划线、标题、普通段落全部换成同套 24 坐标 SVG，统一线宽和图形尺寸；撤销/重做、缩进、列表和图片沿用原命令。44px 触控高度、选中态、按下态与键盘焦点提示保持一致。
- 更多面板改为贴底整宽 sheet：小拉手、统一关闭 SVG、分隔行、轻量开关、字号分段按钮和手动保存。使用低阴影、短过渡，并尊重减少动态效果设置。分类、标签和图片信息面板共用相同纸面和控件规范。
- 空篇提示与正文起点对齐；保存状态继续准确区分未保存、保存中、已确认和失败重试。340px 高度下顶栏收至 48px，工具栏固定在当前可视内容区下方，正文单独滚动。

## 复用与数据边界

直接复用既有 `rich-body-adapter`、Tiptap、richdoc 校验与正文样式；正文、撤销/重做、真实全角缩进、选区、图注和图片排版仍由原适配器负责。没有增加 HTML/纯文本权威副本。

桥操作名、`body`、`assetId`、`occurrenceId`、`insertedAt`、revision/ACK 队列、400ms 自动保存、失败重试、返回前 flush 和组合输入保护未改。阅读标题 `h1` 是纯展示镜像，不参加保存；页面模式和日期辅助文本也不写正文。未编辑 MainActivity、LocalStore、Gradle 或共享桌面编辑核心。

## 验证与截图

真实共享编辑核心、mock 原生 MessagePort、Headless Chrome。优化前后各运行原有 **31 项**日记回归，均通过；新版阅读标题断言改为检查 `#readingTitle`，对应原有“阅读重开后已有标题显示”的语义。

31 项覆盖中文段落、真实两格缩进/Undo/Redo、精确 richdoc 保存、分类/标签去重、阅读/继续编辑/重开、外观不脏化正文、保存失败不退出、重试 ACK 后退出、万字正文、图片图注/对齐/三个身份字段保持、合成 composition 暂停保存及浏览器脚本错误。

另有 **23 项**本轮检查（包含各场景打开）：默认系统字体与 18px/1.85、空态定位、SVG 一致性、44px 高度、更多面板边界、模式切换不写正文、不增加 revision、长标题完整折行、320px 宽无横向溢出、340px 高可继续输入/保存，以及旧 19px/衬线偏好保持。`node --check`、单文件 ESLint 和三文件 Prettier 通过。

新版稳定帧截图已逐张查看：

| 场景           | 截图                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------- |
| 默认空篇       | `outputs/2026-10-17-android-frontend-polish/diary/after/default-blank.png`                        |
| 默认编辑       | `outputs/2026-10-17-android-frontend-polish/diary/after/default-editor.png`                       |
| 默认阅读       | `outputs/2026-10-17-android-frontend-polish/diary/after/default-reading.png`                      |
| 长标题阅读     | `outputs/2026-10-17-android-frontend-polish/diary/after/long-title-reading.png`                   |
| 更多面板       | `outputs/2026-10-17-android-frontend-polish/diary/after/default-more-panel.png`                   |
| 320px 小屏     | `outputs/2026-10-17-android-frontend-polish/diary/after/small-editor.png`、`small-more-panel.png` |
| 340px 内容高度 | `outputs/2026-10-17-android-frontend-polish/diary/after/short-viewport-editor.png`                |

原回归脚本会主动选择 21px 字号，`chinese-editor.png` 等继承此测试选择；默认视觉以 `default-*` 为准。原回归里的 `more-panel.png` 恰好捕获 sheet 动画中间帧，不用于最终观感；新增 `default-more-panel.png` 已等动画稳定。

全部内容虚构。优化前证据在同一目录的 `before/`；新版回执为 `after/browser-verification.json` 与 `after/polish-verification.json`。临时脚本在 `tmp/android-frontend-polish/diary/`，未覆盖旧验收。

本轮没有全库检查或 APK/原生运行回读，由主会话统一进行。浏览器缩小视口只证明布局边界，合成 composition 只证明既有保存门控；真实 Android 中文输入法、软键盘、字体回退、系统字号、物理触控、相册与长期切后台保存仍须单独验收。用户保留手机自行测试，不能把本轮截图写成真机结案。
