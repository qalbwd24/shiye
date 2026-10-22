# Android QQ018 视觉审阅

2026-10-18。本轮只改 `android/qq-chat/view.css` 与 `panels.css`，没有操作设备、Gradle、日常桌面、数据或消息 JS。

## 用户确认边界

QQ参考的是窗口、控件、配色与比例。**内容仍须保持电脑版可输入输出的 Markdown / 富文本能力**，包含段落、加粗、斜体、链接、代码、列表、引用及图片等；不可把 QQ 皮肤误解成纯文本产品，也不可压平段落或改变内容存储/语法。当前实绘中的 `**加粗**` 字面符号是主会话待补的渲染缺口，不是目标设计。本轮未修改 `.qq-text` 的内容布局，最终需在真实富文本接入后补看混排气泡。

默认白顶栏、浅灰白中区、QQ蓝白字气泡；淡蓝可选。无头像/用户名/在线状态，左会话名、右设置；隐藏逐条时间，保留小号分组时间。输入左图库/文件，右单一表情包与文字发送。

## 对照和决策

实际查看用户 QQ 参考 `D:/UserTemp-1001/codex-clipboard-28ddb541-0aff-40ce-9c1a-d43d66ec68f7.png` 与当前 `outputs/2026-10-18-android-qq-018/android-refined-webview.png`，不以旧 qa-current 画面评价本轮。

- 保留当前 44px 顶栏、13px默认消息、8/6px留白、8px圆角和3px消息间距。参考图有头像与较大系统比例；用户要求紧凑且无头像，不把空头像位置、在线副行和额外高度复制过来。
- 保留现有蓝气泡变量 64 153 239。它已经接近参考蓝，不追加渐变、描边、阴影或装饰。
- 分组时间与 placeholder 从蓝灰改为随主题混合的中性灰；降低辅助信息对蓝气泡的竞争。
- 底部分隔与长按菜单使用已有主题变量，修正深色亮线和固定白底菜单；按钮轻按使用中性透明底。
- 视频播放标记从百分比偏置改为几何居中，不改变媒体尺寸/原件。
- 面板白色默认保留，缩略背景与管理按钮改中性灰；通过父 `body[data-shiye-chat-theme='dark']` 接现有主题，在深色提供暗底亮字和可读操作色。不改面板开启/关闭动画。

## 验证与边界

专用 headless Chrome、320×700 CSS px、DPR2，以真实CSS配合合成DOM检查白/淡蓝/深色三主题：无横向溢出，菜单与主题底色一致且文字不同色，播放标记中心误差0，输入 `scrollbar-gutter: stable` 保持、底栏47px。另测父 body light/dark 切换的实际shadow面板，白底/暗底与文字正确。已查看深色合成截图；合成字符图标不代表产品SVG，媒体占位不代表实际原件。

定向 prettier 通过。本轮没有重新执行 Android/IME、ACK、媒体原件或性能测试，不能声称物理帧率或QQ完全复刻。最终 Android 实绘、富文本接入和系统/应用主题切换由主会话合并后验证。

产物：`outputs/2026-10-18-android-qq-018/aesthetics/`（5张合成截图和 `receipt.json`）。临时：`tmp/android-qq-018/aesthetics/verify.mjs`。自有 headless 浏览器已关闭。

本轮CSS SHA-256：

- view.css：`929527ec06a010cd4e8249fc0ec024f5abc6b2ca8d1d3fb4b2c84fe66fb747f2`
- panels.css：`5cfff308edc0ee57a63674b2127b786015fc3f34f4bcf1dd1b6f72b54fb78ef0`

## 富文本局部样式补充

主会话确认复用桌面实际渲染器后，新增 `.qq-text.qq-rich-body` 局部规则。容器 `white-space:normal`，不将HTML格式化空白展示出来；渲染器段落既有 `pre-wrap` 保持，代码块保留 `pre`。首尾块margin为0，多段仅0.45em间隔；列表缩进、引用侧线、内联代码、链接下划线与高亮各自保留。窄气泡内代码和宽表格局部横滚，不拉宽整个列表。图片/视频最多200×150px，figure比例/对齐和figcaption继续显示，不删元数据。

白/深色合成富文本检查通过：页面无横向溢出、首尾无额外margin、代码/表格独立滚动、段落/代码空白语义正确、媒体200px上限与说明保持。已查看白色截图。该检查仅真实CSS加合成安全HTML，不冒称桌面渲染器管线或Android完成；输入仍由主会话保留原始Markdown源码，长文Tiptap入口不由QQ输入框替代。

新增证据 `aesthetics/rich-receipt.json`、`rich-white-synthetic.png`、`rich-dark-synthetic.png`；临时脚本 `tmp/android-qq-018/aesthetics/rich.mjs`。本附录后最终 view.css SHA-256：`a2a2c30d722df271237a7682c79b6d9100cb18ade4b700dcc3bda8b7b1f4e908`，覆盖上方较早hash；panels.css未再改。
