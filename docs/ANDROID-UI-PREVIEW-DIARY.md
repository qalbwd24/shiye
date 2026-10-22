# Android 思绪即时预览与整页写读候选

2026-10-17。列表/消息首轮后，主会话已明确放行本阶段；现完成思绪 HTML/CSS/JS 外壳改动与合成浏览器定向验证。没有构建 APK、操作 ADB/手机或读取个人日记；真实页面即时预览与集成由主会话统一进行。

## 已确认范围

参考一本日记的整页写作/阅读与分类管理体验；功能、正文与数据契约继续按拾页。三入口、浅蓝黑字、已认可壁纸、底部唯一时间戳、图片附件与独立插入 UTC 保留。不会因参考应用存在入口而加入天气、位置、会员或另一套存储。

手机电脑后续互通要求以 [跨设备适配](ANDROID-CROSS-DEVICE-ADAPTATION.md)、[前端数据对齐](ANDROID-FRONTEND-DATA-ALIGNMENT.md) 和 [DATA-MODEL](DATA-MODEL.md) 为准。布局/外观只改变投影，不重写正文、块 ID、媒体 assetId/occurrenceId/insertedAt、原时间或未知字段，不自行切分 MessageUnit；公共 richdoc/Tiptap 核心不属于本轮修改范围。

当前拾页默认 18px/1.85 是现有实现，不等于用户旧日记偏好。主会话已经实际看到旧日记行距 1.5 被选中、手机 font_scale=1.3 与 density override632；字号、字体、颜色仍待读取。原生行距/字号与 CSS 需要按同文度量校准，不能把 APK 14SP 缺省或个人 1.5 直接写成新的 WebView 默认值。已有拾页已存外观优先读取，不能重置。

## 已实施的局部外壳

1. 去掉正文圆角卡片、细边框和重复内衬，只保留整页单层左右留白；18px 为可预览候选，用 `--diary-page-gutter` 承载，最终由真实页面确认。正文上方间距由 `--diary-body-top` 承载；大屏仍42px，未重置用户字号/行高。
2. 日期、星期与直接分类入口收拢为44px同一行；保留原分类绑定、44px 可触达区域和按需标签，长分类省略并保留完整可访问标签。窄于360px时隐藏星期/日期图标，保留日期、分类和标签操作。
3. 空标题仍按需显示，已有标题保持；正文起点与空提示使用实际布局共同定位。
4. 空附件压成简洁添加入口，隐藏大段空态文案/多余间距；有附件仍使用原网格/说明/时间，canonical 节点及正文占位身份保持。
5. 保留当前时间戳、viewport/IME 联动、设置真实父子页、即时草稿、保存/取消及分类 revision 回读。实际键盘定位交主会话手机集成确认。

## 合成基线与定向验证

现有 HTML/CSS/JS、真实公共 Tiptap 和 mock MessagePort；全部虚构日记，无真实库。393×760 CSS 视口中正文内容 x=42、y=204、宽309，外层24px与内层17px加1px边框形成双重留白；空附件区约95px。已查看写作截图。基线4项通过：正常可编辑打开、写读正文结构相同、该样例切换不发保存、无页面脚本错误。

基线还发现原有比较边界：传入 text 节点的 JSON key 顺序与 Tiptap 输出不同，切阅读时 flush 可能发一次语义相同的保存。具体入口为 `editor.js` 的 `save()` 调用 `adapter.commit({markDirty:false})`；公共 `rich-body-adapter.js` 的 `sameBody` 使用 JSON 字符串比较。本轮没有修改该核心路径；基线使用与实际序列化一致的合成对象，按结构比较正文，不能把 key 顺序差异误报为内容改变，也不能据此宣称所有输入都没有版本推进。已报告主会话单独判断。

最终22项（含5次启动断言）通过：普通/空篇写读、320×420长分类与24px大字号、空提示对齐、44px空附件、底部唯一时间戳、标题按需、分类保存原契约、设置父子/显式保存/取消/重开、同原件两次媒体出现与原UTC/null时间、窄设置固定保存区、无页面脚本错误。393×760候选正文 x=18、y=121、宽357；空附件由约95px减到44px。分类变化只改变原categoryId，正文内容保持。

已实际查看最终 `writing-layout.png`、`reading-layout.png`、`empty-writing.png`、`narrow-writing.png`、`existing-media.png`、`narrow-settings.png`。JS语法、单文件ESLint和三产品文件/本专属文档Prettier通过。共享存储与编辑核未改路径复用0.5已有证据，不扩大无关矩阵；没有宣称未知字段/旧格式/真实跨端往返本轮已测。

产物：`outputs/2026-10-17-android-ui-preview/diary/`（最终截图与`verification.json`；`first-candidate-*`是首次候选记录，原始基线尺寸保留在上文）；临时脚本：`tmp/android-ui-preview/diary/baseline.mjs`、`verify.mjs`。浏览器合成结果不等于 Android 中文 IME、真实键盘、手机排版、性能或 APK 安装验收。

## 真实旧偏好后续：新建先选分类

主会话从旧日记可见 `RecordSettingActivity` 真实读到“进入编辑页弹出分类选择”为开启、“弹出键盘”为关闭。证据为 `outputs/2026-10-17-android-ui-preview/old-diary-editing-settings.json`，不是APK缺省推断。退出保存/首行缩进与当前ACK保存及`autoIndentParagraph:true`保持一致；天气/位置不因旧设置为开启而加入本轮需求。

按主会话明确授权增加本机外观偏好 `chooseCategoryOnCreate`，默认true，已有显式false优先读取。日记设置新增“新建时选择分类”开关，沿同一草稿/保存/取消路径，不进入Entry/body。原生仅新建跳转带`new=1`；Web页在boot完成后只对该标记、非阅读、未受保护且偏好开启的情况打开已有分类选择。取消/返回直接继续正文，不强改分类、不自动聚焦键盘；现存篇和阅读均不自动弹。原生标记接线由主会话负责。

仅追加3组合成定向验证并通过：新建默认弹出且返回不退出/不保存/不改分类/不聚焦正文；现存与阅读不弹；开关显式保存false后重开新建仍不弹。JS语法、单文件ESLint与变更HTML/JS的Prettier通过。此前22项布局证据按未受影响路径复用，没有重跑或冒称全套新包验收。新增回执`diary/new-category-verification.json`，临时脚本`tmp/android-ui-preview/diary/new-category.mjs`；未构建APK或操作手机。
