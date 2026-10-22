# Android 0.11 聊天气泡与引用样式

2026-10-18，本子任务仅改 `android/telegram-adapter/android-chat.css`，与 JS 偏好代理约定变量和主题状态，不修改 JS、Java、worker、原媒体、版本或任何设备。主会话负责集成与 AVD；手机 0.10 保持。

## 样式和偏好接缝

| 变量                           | 紧凑缺省 | 作用                                     |
| ------------------------------ | -------- | ---------------------------------------- |
| `--shiye-bubble-padding`       | 8px      | 文字/纯表情泡四边留白                    |
| `--shiye-bubble-width`         | 88%      | 泡最大宽度，短句按内容收缩               |
| `--shiye-message-gap`          | 4px      | 连续消息和组尾共用间距，JS 可调 2–20px   |
| `--shiye-message-time-size`    | 10px     | 文字/表情消息时间字号                    |
| `--shiye-message-time-opacity` | 0.62     | 时间/status 行淡化                       |
| `--shiye-bubble-opacity`       | 1        | 底色透明度，不降低正文或整条消息 opacity |

具体持久化、显式旧值保留、全局/逐会话覆盖由 JS 偏好代理处理；CSS 不写偏好。主题使用 `body[data-shiye-chat-theme='dark']`，JS 同步既有 Telegram theme；浅色维持天蓝与黑字，深色改冷蓝底、浅色正文与少量亮蓝强调，并补齐附件/表情按钮的深色前景对比。原生系统栏由主会话适配。

移除消息顶层头像与发送者标题，并取消 incoming 预留头像栏；引用预览内的目标上下文和点击关系仍由 TL 原组件负责。统一消息外间距覆盖 TL 原 last-in-group 差异，未修改消息排序、ID 或归档逻辑。

## 实际 DOM 修复

冻结 TL 的普通文字时间位于 `.text-content > .MessageMeta`，纯表情时间则是 `.message-content > .MessageMeta`。两者使用既有流内独立时间行，取消额外 float 和定位，采用相对 1.2 行高/上距 2px，status继承时间字号，时间行 auto 高度随真实 textZoom 增长；不重排照片/视频的原生浮层时间。

主会话指出初候选在 320px/1.3 下空发送按钮被挤到第二行，这项不能交付。实际原因是隐藏录音按钮仅 visibility:hidden 仍占槽位，再加 Android empty-send 后成为多余 flex 子项。最终仅对不用的 record 状态移除布局占位，附件、表情、真实发送和 empty-send 明确为44px触达；输入 min-width:0、wrapper按剩余行宽计算，保持引用全宽预览另占上行。最终空/一行Composer均52px高；三行编辑器92px高、整体100px，三个44px按钮始终同底边；引用预览位于输入/按钮行上方。未改附件选择弹窗的布局。

列表头隐藏“随想”及占位，设置/搜索/新增图标20px视觉/44px触达。独立列表壁纸使用 `--shiye-list-background` 和 `body[data-shiye-list-background='true']`，实际 `#LeftColumn-main` 清透明，列表行85%主题底、置顶行92%底保证可读；不复用或覆盖房间壁纸变量。来源为JS偏好回执，不由CSS读写库。

原一行 Markdown 引用＋回复出现约 214px 高泡，来自正文 p 的 1.5em 留白和 upstream blockquote 保留换行叠加。现引用容器 white-space 恢复 normal，真实段落继续 pre-wrap 保留 Tab/全角空格；正文段落 margin 0.45em，引用首末段清零。引用仅保留一条明确左边框，去掉会压住末字的装饰伪元素；不删正文字符或引用关系。

原生 custom-shape/no-text 贴纸显示框上限 144px/48vw，排除 round/video/media 类型；本地 GIF 预览上限 160px 并保留原 File 文档卡与另存入口。只限制视觉尺寸，普通照片/视频仍走原布局，原件与动画数据未改。

## 定向验收与边界

真实 Chrome/Playwright 加载冻结 Telegram 全页面和真实本地 worker，隔离 context、仅合成消息，路由替换本轮 CSS。320px 视口以 20.8px 正文及 root 字号模拟用户 1.3 字号边界，再覆盖 28px 正文/70% 泡宽/45% 底色。21 核心断言通过：长无断词句、引用、emoji、时间行边界/字号、原生 reply preview、组尾统一间距、incoming 头像/用户名/空栏探针、深色正文和输入按钮对比、透明底色不影响正文、窄宽大字无横溢及无页面异常；追加空/一行/三行/引用Composer控件底边与44px触达、正文向上增高、列表头无标题且按钮同排、列表壁纸独立。引用及 native reply 各走真实消息组件，incoming 空栏单项为 DOM 克隆 CSS 探针，不冒称后台创建了 incoming 消息。

截图已查看浅色/深色 320px；定向脚本还记录大字号深色图和实际几何。主测 20.8px 下短句高约 61px、双 emoji 约 84px、一行引用＋回复约 124px；不是与最初 16px/12px padding 的 214px 直接同条件性能比较。时间小但仍单独占行，避免短句尾部被时间覆盖。

本测试不是 Android WebView 的实际 setTextZoom 或系统缩放，不能代替主会话 AVD/font_scale1.3/系统栏验证。原生贴纸/动画缩小未在本轮浏览器发送真实媒体重测；图片/视频下载、长按撤回/编辑及原件恢复复用未改代码证据，不称本轮重验。未测物理 120Hz、手机帧率或长时运行。

产物：`outputs/2026-10-18-android-refinement-011/chat-style/report.json`，截图 `light-320.png`、`dark-320.png`、`dark-large-320.png`、`composer-multiline-320.png`、`composer-reply-320.png`、`list-wallpaper-dark-320.png`；早期 `initial.png` 和 failure 文件是中间候选/失败图，不作最终验收。临时脚本：`tmp/android-refinement-011/chat-style/verify-style.mjs`。后续追加刷新与默认深色壁纸后的最终 CSS SHA-256：`5719b74c4bf7d205d81c539692dd426576b65aedb354cc8414aed079084fe115`；专属格式检查已通过。

## 追加 QQ 式刷新小浮层

依据 `ANDROID-REFRESH-NAVIGATION-FEEDBACK.md`，`.shiye-refresh-status[data-state='loading']::before` 显示13px旋转环，800ms线性循环；status固定小pill且pointer-events:none，不拦截底部导航、不加入列表行布局，不做整页蒙层。`prefers-reduced-motion` 静止；JS改success/error后不保留旋转环。实际开始/完成时机、成功收起、错误弹窗及重试由JS/原生代理处理，本CSS不假报保存或刷新完成。

只补3项真实浏览器样式检查，未重跑21项：合成loading状态在真实TL列表上为113×35.5px的小浮层，转圈且不拦pointer；reduced-motion静止；success无loading环。截图已查看 `refresh-loading-320.png`，回执 `refresh-style-report.json`；脚本 `tmp/android-refinement-011/chat-style/verify-refresh-style.mjs`。该检查是可控状态的视觉探针，不等同真实flush/错误恢复状态机已验。

## 追加冻结默认深色壁纸的实际主题适配

主会话AVD实测默认深色不是浅色的 `#bdcd8c`，而是Main同时出现 `#000000` 背景和 `#27308a66` 图案的 masked pattern。仅在这两个精确标记同时存在、无 `--custom-pattern`/`--custom-background`、子层为customBgColor/withMaskedPattern且不是customBgImage时，底色使用 `--shiye-chat-background`，canvas 灰阶/0.12强度/screen混合成为低强度灰蓝纹样。其他用户自选颜色、图片与自选图案不匹配该规则。

仅补1条组合定向DOM/CSS断言与1张截图，没有重跑21项。真实TL `setSharedSettingOption({theme:'dark'})` 生成了AVD同一组inline变量，背景实取rgb(12,24,37)、canvas grayscale(1)/opacity0.12；随后在隔离DOM探针中设置custom-pattern/另一用户底色，规则失配并分别恢复黑色/指定rgb(17,34,51)。测试关闭该层过渡后读取排除状态，避免把300ms背景过渡中的中间颜色误报为规则覆盖；未改产品过渡设置。截图已查看 `dark-default-coldblue-320.png`，回执 `dark-default-style-report.json`，脚本 `tmp/android-refinement-011/chat-style/verify-dark-default.mjs`。本子任务不操作AVD，实际端侧由主会话接续。
