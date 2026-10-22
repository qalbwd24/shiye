# Android019 手机反馈：列表、设置与冻结编辑头

2026-10-19。依据 `ANDROID-019-USER-FEEDBACK.md`，本轮为候选源码交付，主会话尚需正常包/保留profile的Android验证。没有操作设备或构建，也没有编辑原生、editor.js、QQ内容源、正式资料。

## 逐条实施

| 反馈 | 本轮实现 | 验证/后续边界 |
| --- | --- | --- |
| S1 设置关闭/保存固定 | android-chat dialog拆成独立标题、滚动form、独立footer。submit按钮通过form属性关联原表单，错误留在固定底部；共享输入映射页也保留同一提交表单 | 长外观页滚底头/底坐标不变；保存与模拟失败、共享表单提交已测 |
| S2 真实父级返回 | 关闭、取消、系统cancel、背景关闭与保存统一使用实际__parent；应用设置入口不再删除现有随想dialog。已移除旧dialog的迟到close事件不再关闭新窗口 | 设置子页/共享页返回已测，原生应用设置由Sol核对WebView保留与返回 |
| S3 小设置居中 | dialog margin:auto、16px圆角；大设置中区独立滚动。editor overlay的sheet-dialog居中且不再从底部平移入场 | 小窗中心位于320×700视口中心；原生Dialog居中由Sol负责 |
| S4 统一/防误触 | 随想17px标题、13px正文、44px菜单行；轻量QQ手势安装不再依赖表情组件链。独立editor overlay使用相近居中/分隔样式 | Chromium实际CDP纵滑range值保持、横拖改变；Android与原生SeekBar仍需主会话核查 |
| L1 无功能右滑页 | 列表捕获层阻止触摸起点进入旧WebA横滑识别器，不preventDefault；原生纵向滚动和click保留，下拉刷新起点移到capture确保继续接收 | 上游body touchstart不再收到，实际tap仍触发；真机纵滚/下拉继续由根验 |
| L2 全宽对齐 | 列表/行外边距及圆角归零，行等宽；保留虚拟列表72px高度契约，避免错位 | 320 CSSpx宽，首两行x=0,width=320,height=72 |
| L3 透明度可调 | 默认普通行0%不透明度，依据当前DiaryListPage普通行本就透明；新原生UI偏好顶层listRowOpacity单独保存，缺省才用0，已保存值保留；设置入口“列表行透明度” | 37%提交及其他未知偏好字段保留已测；置顶单独58%浅蓝/暗蓝加左强调线 |
| D1/D2 思绪标题/置顶 | 原生由Sol实施，本轮提供全宽/行分隔/浅蓝色相建议 | 不冒称CSS能改原生ListView |
| E1 冻结信息与黑线 | 独立overlay配合Sol新entry-context-header结构，固定标题/日期星期时间地点字数分类/黑线，page-scroll只滚正文；320px下恢复weekday，地点截断并允许信息分行；上一篇44px触摸区、11px字避免挤压标题 | 使用真实更新后的editor.html/CSS与30段合成正文，滚动前后标题/信息/黑线/工具条坐标保持，无横溢出 |
| E2/E3 空篇/上一篇 | 功能由Sol负责，overlay只提供上一篇布局 | 不修改保存、ID或删除规则 |
| C1启动门禁补充 | QQ及轻量手势独立启动；可选sticker/input安装失败不再阻断QQ。15秒初始化超时、安全code；进入任意会话时无条件隐藏旧MiddleColumn与旧header，QQ未ready显示加载/失败及返回列表按钮，不退回Tele | 门禁/超时9项、模拟模块成功与失败6项；真实缓存/旧profile问题由root处理SW/版本入口，不声称手机根因已确认 |
| C2内容保真 | 未修改QQ renderer、Markdown/richdoc、正文权威或草稿格式 | 不把视觉候选等同内容/同步已完整验收 |

## 代码所有权及整合

- `android/telegram-adapter/android-chat.js`：设置结构、真实父层返回、列表手势与透明度、独立QQ初始化。
- `android/telegram-adapter/android-chat.css`：固定设置层次、居中、全宽行/置顶及QQ安全加载层。
- `android/ui-refinement-019/editor.css`：继续作为最终editor.css之后的覆盖；主会话须打入019包。未直接修改原assets/editor.css。

QQ准备状态以 `shiyeAndroidChat.snapshot().initialization` 检查：qqReady、qqFailure、localInputReady、optionalInputFailure。错误仅暴露固定code，不输出异常私有路径/正文。QQ迟到ready可安全恢复；可选模块不再影响QQ数据源flush。现有原生偏好和其他未知字段继续保留。

## 定向结果

- 19项设置/列表检查：执行实际提取的adapter函数，原生偏好用替身；CDP触摸使用真实Chromium事件。
- 8项编辑页冻结几何：真实HTML及最终CSS，正文合成，未执行editor.js/Tiptap输入/IME/保存。
- 9项加载门禁：真实gate/deadline函数，超时测试加速；未实际模拟WebView模块加载。
- 6项初始化依赖隔离：真实安装函数，替换module imports注入成功/失败。
- 三个改动文件定向Prettier及android-chat.js ESLint通过。查看了设置滚底和冻结编辑头截图。

边界：没有Android设备/物理输入法/长期性能测试，没有全库检查；正常包保留profile的旧新首房、真实应用设置返回、列表纵滚/下拉和运行版本需要root验收。测试截图中的设置图标为合成简图，不冒称完整产品实绘。

产物 `outputs/2026-10-19-android-integration-019/ui-feedback/`（四份回执与截图）；临时 `tmp/android-integration-019/ui-feedback/`。自有headless浏览器均已关闭。

交付SHA-256：

- android-chat.js：`63c59022d29fac8b2d93ca574e537388909e6bc1d340261e6b263f0f9bc958e5`
- android-chat.css：`c8f7a0a926f9ae36a999f4cf90884818fe6532c213426f1f2bca5d53c7573464`
- editor覆盖：`5906d118b509395e29a130020916c7bf1d3a2024ddf939b46889e4d76ff473b4`

## 追加反馈：列表右侧空白与编辑页比例（2026-10-19）

本轮仅改 adapter CSS 与 editor 覆盖，不改 JS/72px 虚拟行/业务。真实 QA AVD 的 WebA 列表外层为320px，但常驻6px custom scrollbar使 clientWidth=314、各虚拟行314.177px。隐藏此列表滚动条占位后，实际5行及按钮均铺满 x=0/right=320；按钮高71.998px（72px物理像素取整），每行y、总高度、scrollTop、会话和弹窗状态均未变。末行自身额外尾部高度也原样保留。无需改虚拟器。定向临时CSS注入后已撤回；没有导航、安装或操作手机。证据 list-width-receipt.json；这是真实WebView布局测量，截图接口超时，未冒称已取得设备前后实绘图。最终APK仍由root构建/验收。

编辑页以当前019实际HTML为基线（相比018，元信息已移到正文滚动区外的 entry-context-header）。原标题15px/500与44px工具栏现在改为18px/700、32px工具栏保留20px图标。顶部40px、按钮36px，元信息控件28px；统一头部和工具栏surface、文字ink。冻结头部去掉重复边线；context不再受720px上限或正文gutter缩进，1px分割线从左至右铺满；只有元信息/正文继续使用用户gutter。没有修改正文用户字号/行距/段距参数。浅色深色均沿现有主题变量；不擅自覆盖用户正文背景。

当前实际HTML+CSS合成正文在320px浏览器通过13项定向检查：头部/元信息/黑线/toolbar滚动时位置保持、正文可滚动、无横向溢出、分割线x=0宽320、toolbar高32、标题18px/700。已产出并查看 editor-frozen-light/dark.png；未执行原生IME/保存，因此仍需root最终包实绘。格式检查两个CSS通过。测试临时文件仍位于 tmp/android-integration-019/ui-feedback，产物仍位于 outputs/2026-10-19-android-integration-019/ui-feedback。

最新SHA-256：adapter CSS `09465abc3c80e84adba3497aa1aacbba7d2b8b401bbec7ed7a806c7aa99654d8`；editor覆盖 `79c79a2f9e2ea79add4df24aeae7cb48ca6fba55f334216de675beba8f154e1b`。JS本轮未改。

### 置顶底色追加确认

用户选择默认不加深逐条置顶，避免深浅交错。本轮 adapter CSS 普通/置顶共用同一行透明度，移除旧壁纸专用置顶92%底色覆盖；保留置顶顺序、已有分界/小提示及侧边细标识，没有新增设置。浅/深色×壁纸开关×0/40%用户透明度共8个合成DOM实际CSS背景等色场景通过，格式检查通过；没有设备导航/构建。列表宽度/内边距等待主会话新DOM数据，此次不变。证据 pinned-uniform-receipt.json。adapter CSS最新SHA `555cb6f069d8b8186201ac427b876b3592f5180245db180aff15efe241b3aa81`。

主会话最终整合补充：原生DiaryListPage取消行与置顶边界底色，未选分类chip透明；顶部并无整块额外遮罩，不能把测试壁纸本身的分块误判成布局背景。用户后来授权复用手机写作页原图，模拟器四个主页面已换成同一原件，仅外观偏好变更。最终正常包实际5行x0/320px、18px/700标题、32px工具栏及全宽黑线通过，另修QQ grid 320→455撑宽、发送触摸夺焦点和iframe壁纸传递。完整包/真实证据及保留边界以 [最终验收](validation/2026-10-19-android-integration-019.md) 为准；上文各子任务hash为对应阶段，不是最终运行版本声明。
