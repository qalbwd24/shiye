# Android 0.5 思绪排版、分类与设置层级

2026-10-17。仅修改 `android/app/src/main/assets/editor.html`、`editor.css`、`editor.js`。当前完成源码和合成浏览器定向验证；APK/AVD 与原生分类管理由主会话汇总，不把本页写成手机验收。

## 先按已有需求取舍

本轮先读 QUICK-WORKSPACE-REQUIREMENTS、QUICK-REQUIREMENTS-AUDIT、UI-PREFERENCES、ANDROID-SKY-UI-REQUIREMENTS 与 ANDROID-REFINEMENT-REQUIREMENTS，并核对桌面 `public/features/quick-appearance.js` 的草稿、即时预览、保存和取消实现。0.4 的手机明确覆盖要求优先于旧电脑 Word 式图片展示描述。

| 取舍                     | 本轮处理                                                                                         | 需求依据                                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| 必须保留                 | 三入口、底栏仅时间戳、真实电脑 datetime、附件网格、canonical 身份与 UTC、背景独立                | QUICK-WORKSPACE-REQUIREMENTS 的“Android0.4”记录；ANDROID-SKY-UI-REQUIREMENTS 的“已确认需求/本轮实现安排”              |
| 必须保留                 | 自动保存、返回等 ACK、历史正文与格式不丢、分类与独立外观                                         | QUICK-REQUIREMENTS-AUDIT 的“基本输入与窗口”；QUICK-WORKSPACE-REQUIREMENTS 的“准备代码改进”                            |
| 手机调整                 | 可直达写作分类、字号/行高数值、轻透明正文框、设置实际父页返回、未提交草稿、固定保存/取消区       | ANDROID-REFINEMENT-REQUIREMENTS 的“思绪写作/设置”；UI-PREFERENCES 的“字号与留白分开、设置分层”                        |
| 暂缓                     | 不加入 AI、非线性分栏、插件、云同步、提醒、朝花夕拾或便签入口                                    | QUICK-WORKSPACE-REQUIREMENTS 的“暂缓：非线性补写与布局诉求”；ANDROID-REFINEMENT-REQUIREMENTS 的“电脑端规则与参考边界” |
| 不搬入手机               | Windows 托盘、全局 F 键、多开、多屏 DPI、Ctrl 滚轮等                                             | QUICK-REQUIREMENTS-AUDIT 的“基本输入与窗口”仅针对对应桌面宿主                                                         |
| 无手机明确编辑需求的入口 | 隐藏更多里的粗斜体/H2/列表等“正文格式”菜单；仍保留共享解析、已有格式显示和原正文，不删除历史标记 | 0.4“日记编辑区主要使用时间戳”的更新要求优先；不按常见富文本软件补全菜单                                               |

一本日记依据仍是 [原版实际观察](ANDROID-REFERENCE-REVIEW.md) 中的简洁整页写读、按需标题、分类、阅读/继续编辑；没有加入未实际验证的天气、位置、会员、地图或模板功能。

## 实施结果

正文采用轻透明纸面与细边界，正文两侧有独立内边距，原天空/自定义壁纸继续位于底层。编辑留出空白写作空间，阅读按真实内容高度展开，长文仍由原页面单一滚动区负责；纸面留白不写入正文空段。空态提示与实际正文起点对齐，跟随同一字号与行高。

写作页直接显示“分类：当前分类”按钮，打开已有分类选择，不必先去阅读列表或展开元数据。日期旁不再重复显示同一分类。更多也有“本篇分类”，从哪里进入就返回哪里；分类列表有独立滚动区和稳定管理入口。

更多改为“日记设置”父页；“正文排版”子页明确显示字号 px 和行高倍数。范围沿桌面独立外观：字号 12–32px、行高 1.2–2.5 倍；原 17/18/19/21px 与衬线偏好仍兼容，未保存行高的旧偏好按原 1.85 显示。新字段仅进入既有 WebView 外观 localStorage，不加入 entry/body。

排版草稿即时预览，子页返回保留未提交设置；回到编辑再开设置也保留同一草稿。父页底部“保存设置”明确持久化，“取消修改”恢复原偏好；设置滚动区与固定操作区分开。“立即保存日记”仍只操作原正文保存链，不冒充保存外观。非法数值留在当前输入页提示修正，不静默改回旧值。

原生返回先退当前子页到真实父页。父页关闭保留草稿，并在更多图标标记未保存状态；此时退出日记会回到设置提示用户保存或取消，避免导航静默丢弃表单。显式保存/取消后才正常退出。保存设置不增加内容 dirty/revision，也不重建编辑器。

“思绪外观”与“应用设置”通过原生桥打开时，Web 设置父页保留在背后；原生关闭后自然回同页，未提交排版不丢。正文格式菜单本轮隐藏，未删其底层读取、解析和原格式数据。

## 分类桥与版本对齐

使用主会话提供的 `showCategories`、`showAppSettings`，不改 Java 或公共编辑核。分类管理流程为：先 flush 当前输入并拿到 ACK，再打开 native 管理；管理关闭返回 bootstrap 分类列表，然后 `getEntry` 回读当前篇。主会话确认删除分类只解除关联并推进 revision、正文不变，因此本页只对齐 categoryId/revision/updatedAt，保留已挂载正文和选区，避免下一次保存拿旧 baseRevision 冲突。

当前篇分类被删除后显示“未分类”，原正文/媒体不改；下次选择新分类使用新 revision 提交。分类新增、改名、删除、默认新篇分类的实际 SQLite 行为与数据保护由原生代理负责，本页 mock 验证不能替代它的回读验收。

## 定向验证

按 [TESTING-POLICY](TESTING-POLICY.md) 只检查本轮变化，Headless Chrome、真实共享 richdoc/Tiptap、mock 原生桥、全部合成日记，最终 **24 项检查通过**：

- 写作分类直接可达与保存；管理删除后更新列表、类别与 revision，下一次保存使用正确 baseRevision，正文不变。
- 数字字号/行高即时作用于真实正文，但保存前不进入 localStorage；父页摘要显示精确数值，保存后重开有效；取消恢复已提交值。
- 子页与原生返回回到真实父页；native 外观/应用设置不清草稿；待保存设置阻止静默退出；非法输入保留可修改。
- 排版设置不改 canonical body、不增加内容 revision/保存次数；隐藏手机格式菜单后，旧 bold 标记仍正常显示并原样保留。
- 320px 宽、420px 高设置不横向溢出，固定保存按钮保持在可视区，滚动区独立。

`node --check`、单文件 ESLint、三前端文件 Prettier 通过。0.4 的时间戳/附件 UTC/背景实现未改，历史 33 项天空定向结果仅作为明确基线，本轮未重复宣称全量重验；详见 [0.4日记记录](ANDROID-SKY-DIARY.md)。

已实际查看合成截图：`writing-layout.png`、`typography-settings.png`、`settings-parent.png`、`reading-layout.png`、`narrow-settings.png`。未操作 ADB、手机、模拟器或桌面运行程序。实际中文数字键盘、系统 Back/IME、native 分类页返回与长期后台恢复仍交集成验收。

产物：`outputs/2026-10-17-android-refinement/diary/`。临时脚本：`tmp/android-refinement/diary/`。没有覆盖旧验收目录、移动正式数据或更新原生版本。

集成复核补正：全局应用设置也可能调整当前分类，因此入口现同样先flush，等原生设置最外层关闭后返回bootstrap，再getEntry对齐分类/revision，避免走全局设置后下次保存冲突。24项定向检查已在此修正后重新通过；原生实际流程另验。未提交排版仍保留。


2026-10-17本轮收束：0.5.0/code7 APKc60bac46已在AVD运行，核心功能实际验收及原数据保护通过；性能采样明确未达标，未宣称120FPS，手机保持0.4。最终状态与后续问题以[集成验收](validation/2026-10-17-android-refinement.md)和[QA原始边界](validation/2026-10-17-android-refinement-qa.md)为准，上文准备时“待验”保留为历史。
