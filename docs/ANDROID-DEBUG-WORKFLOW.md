# Android 快速调试工作流建议

2026-10-17 最新：真实WebView CSS预览已实现并在AVD验证，控制台临时改色/数字参数及恢复不重载页面；逐页样式已形成0.6候选并安装AVD。启动、适用范围和退出恢复见[ANDROID-LIVE-PREVIEW](ANDROID-LIVE-PREVIEW.md)，实施/数据接口约束见[ANDROID-UI-LIVE-ITERATION](ANDROID-UI-LIVE-ITERATION.md)。不把CSS热更新扩大为Java/HTML/JS热更新；下方“尚未实施”只代表历史调研阶段。

## 2026-10-17 APK参考分析已完成首轮

2026-10-17 Android参考分工由用户明确：Telegram负责随想线性消息页UI，QQ负责会话列表/页面及状态栏管理，一本日记负责思绪写作与数据管理界面；具体功能/数据仍对齐电脑拾页，已有安卓明确选择保留。已通过MT定点分析私有一本日记0.1.2、新Telegram13.0.3和QQ9.3.70，旧Telegram12.10.0单列历史；个人日记偏好值未读，不冒称已继承。只读研究，无产品/数据/部署变更。见ANDROID-REFERENCE-REVIEW和ANDROID-DEBUG-WORKFLOW。产物outputs/2026-10-17-android-mt-{diary,telegram-13,qq}-reference，临时tmp/android-mt-mcp。

注意此为APK静态分析，不等于当前页面运行trace或当前用户设置值已取得。参考软件仅作UI来源；开发提速仍需把真实页面CSS预览/设计参数与正式打包分开。当前仅分析，没有新装任何辅助插件或改变手机应用。

## 2026-10-17 MT MCP实际连通

用户提供MT服务地址截图后，已从本机通过其中可达的局域网地址直接完成MCP initialize、tools/list和只读mt_apk_list_available_apks。实返MT APK MCP 0.1.0、协议2025-06-18、26工具（17只读、9编辑/构建），当前可用APK为0且没有当前选定APK。没有打开/修改/重打包任何APK、没有读取日记正文，也未写入Codex持久MCP配置；不是仅根据文档推测已连接。此服务实际为APK分析工具，不能据MT最新文件/ZIP文档假定该手机版本也暴露mt_file/mt_zip。

下一步可让用户在MT中选择“一本日记”的已安装应用或APK并停留信息框，再使用mt://current-apk读取布局/资源/逻辑。目标未指定前不随意遍历其他应用。主源码开发与热预览仍在D盘完成，MT负责参考APK分析。地址/工具清单见outputs/2026-10-17-android-mt-mcp，临时探测脚本tmp/android-mt-mcp/probe.py；后续地址或服务状态变化需重新确认。

## 2026-10-17 辅助AI安卓开发工具调研（未安装）

用户要求先联网调研，随后确认所指手机文件管理器为MT管理器。以下均据官方文档核对，未连接MT、安装工具或操作手机，未改变App源码。

| 工具 | 可解决的问题 | 对当前拾页的判断 |
| --- | --- | --- |
| [Android skills](https://developer.android.com/tools/agents/android-skills) / [官方仓库](https://github.com/android/skills) | 给AI提供Android专门流程与最新指导 | 建议按需求选技能，不因有迁移技能就迁移项目 |
| [Android CLI](https://developer.android.com/tools/agents/android-cli) | 官方设备/层级/Studio语义分析/Compose预览统一入口 | 文档当前明确Windows emulator子命令禁用、PowerShell下载不支持；不能承诺替换本机全部工具 |
| [Mobile MCP](https://github.com/mobile-next/mobile-mcp) | AI读无障碍树、截图、点击滑动、设备操作 | 适合统一原生页面操作；WebView内部细节仍配CDP；不直接改善渲染性能或提供源码热更新 |
| [WebView DevTools](https://developer.chrome.com/docs/devtools/remote-debugging/webviews) / [Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp) | DOM/CSS检查与即时样式修改，AI浏览器诊断 | 当前App已有WebView调试；官方MCP对本App WebView连接兼容仍待验证，不能当已连通；优先复用现有CDP |
| [Android Studio AI](https://developer.android.com/studio/gemini/agent-mode) / [截图生成匹配](https://developer.android.com/studio/gemini/generate-ui-with-images) | 原生UI生成、设备部署观察、按目标图调整Compose | 图片匹配主要面向Compose，当前Java View+WebView不能直接全套应用 |
| [Compose Preview/Live Edit](https://developer.android.com/develop/ui/compose/tooling/iterative-development) | 原生Compose组件预览、函数体UI变动实时呈现 | 后续新原生页面可评估，当前不是Compose；有签名/结构变化等限制，不以热更新承诺完全免构建 |
| [Figma MCP](https://help.figma.com/hc/en-us/articles/39216419318551-Get-started-with-the-Figma-MCP-server) | 传递设计组件、变量、布局，减少AI凭截图猜参数 | 当有认可的设计稿时有价值；不是仅安装即可理解用户审美 |
| [Maestro MCP](https://docs.maestro.dev/get-started/maestro-mcp) | 固定移动操作流程复用 | 放到操作稳定后，不能替代视觉认可或帧率证据 |
| [MT MCP](https://mt.cc/guide/ai/mcp.html) / [APK MCP](https://mt.cc/guide/reverse/apk-mcp.html) | 手机文件/ZIP、APK资源/布局/字符串、Smali/so静态分析及受支持修改打包 | 可辅助研究一本日记等参考APK的可读资源与逻辑。不是屏幕操作/实时CSS预览工具，不能保证还原Java/Kotlin原源码或运行时动画。拾页已有源码，主修改保留源码构建，避免仅改APK与源码脱节。 |

建议组合：现有WebView/CDP即时样式预览优先，Mobile MCP作为设备操作统一入口备选，Android skills补Android知识；MT作参考APK分析助手。MT服务是Streamable HTTP，从手机MT侧栏工具的MCP服务启动后复制真实地址；连接参数/工具/权限以实际暴露为准。当前只调研，未擅自添加MCP、升级IDE或购买服务。Android Studio外部Agent集成目前官方说明处于Rabbit 2 Canary预览，不把它当本机稳定版已具备。

工具只能缩短观察/修改/验证循环；本轮长帧瓶颈仍待定位。下一步应以明确参考页和用户逐页视觉确认提高方向一致性，不能再以功能测试通过代替样式认可。

## 2026-10-17 手机0.5反馈：先降低视觉调整成本

用户已实际测试0.5，明确整体效果仍不满意、很多细节不合意，当前主要障碍是调整成本太高；要求停止继续数据审核。停止该项核查，不再追加审计或基于功能检查推断视觉被接受。0.5安装成功/页面ready，不能视为设计验收通过。

优先建议：保留已确认三入口，先集中一个聊天页面，以用户指定参考的具体间距/气泡/输入框/菜单行为逐项对照；建立真实WebView的CSS原位预览，调色、字号、圆角、留白无需每次打包，确认一组再回写/发布。先做小型样式工具，不建设庞大调试平台；原生页面改动仍需要构建，不能承诺全App热更新。动画性能与静态样式分别验，功能通过与用户视觉认可分别记录。此为建议，自动watch/开发包尚未实现，不能当本轮已交付。

2026-10-17。用户提出开发调试成本高，询问能否更快捷 debug。本页记录源码核对和建议，未获实施指令的工具项保持建议状态；本次未安装、连接或操作手机/模拟器，未修改App源码或运行版。

## 最新澄清：优先样式设计与视觉迭代

用户明确“主要是要修UI，不是报错，是样式设计”。此前日志/异常诊断建议降为辅助，不作为本轮优先建设目标。确认需求是更快观察和调整字体、留白、颜色、气泡、工具栏/面板及动画。

建议首先建立真实页面样式工作台：一侧参考截图，一侧同尺寸的实际App页面，使用固定合成内容覆盖长短消息、长标题、图文、空态、键盘展开等状态。先集中统一字体/字号/行高/间距/圆角/颜色等设计参数，再逐页打磨；三入口结构继续保持。

聊天与日记WebView可通过Chrome DevTools直接选中元素、改CSS并立即看效果，确认后回写源码；建议再做CSS文件监听/原位注入，降低每次手调的重复成本。该自动工作台尚未实现。原生导航和日记列表用Layout Inspector辅助量尺寸，仍需原生构建/运行验证，不能承诺全App均像CSS一样即时更新。纯静态设计稿可用于方向比较，字体渲染、键盘与手势/动画最终仍看实际App。

视觉验收使用同内容/同尺寸的前后并排或叠图，加短录屏观察动画；不用“截图差异小”代替用户判断设计是否好看。每轮先交可操作预览供用户评样式，确认后再打APK推手机。工具路线为建议，尚未开始实现。

## 当前已经具备

- Android Studio、SDK36、JDK17、Gradle8.13/AGP8.13.2和主AVD已配置。
- `TelegramFrontend.java` 与 `MainActivity.openEditor` 已根据 FLAG_DEBUGGABLE 启用 WebView 调试。运行聊天/日记页后，可在电脑Chrome打开 `chrome://inspect/#devices`，找到 `dev.shiye.app` 并 Inspect；可检查DOM/CSS、JS断点和性能。不是只能看原生截图猜测。
- Telegram冻结资源与适配器分开；`build.mjs --adapter-only` 已能仅更新三个适配文件，之后仍需Gradle更新APK才能持久改变手机内打包资源。
- 已有headless日记/聊天回归、AVD实际流程脚本和flush ACK/数据hash保护，见 `outputs/2026-10-17-android-frontend-polish/`。目前部分工具在tmp且绑定固定设备/版本，不能直接当成可靠的通用工具发布。
- 当前日记与聊天 `onConsoleMessage` 都直接返回true，未转发JS日志到Logcat；因此单看Logcat不足以定位所有前端错误。Chrome Console仍是前端调试入口。

## 推荐实施顺序（建议，尚未实现）

1. **独立开发包和统一命令。** 增设开发variant，例如包名 `dev.shiye.app.dev`、名称“拾页·开发”，与用户体验包并存，数据天然隔离。日常使用合成测试库；不自动迁移手机现有记录。为源码映射、固定origin/桥、包名白名单和自动化脚本统一参数化，避免新增包名后仍连接旧包。整理开发运行、inspect、日志、定向检查、备份/安装等入口，明确目标设备，不以第一个ADB设备为默认。此前tmp脚本审计后再升为android/tools正式工具。
2. **样式即时预览。** 第一阶段用CDP/DevTools在真实WebView中临时改CSS，确认后写回源码；临时页面修改不会随APK保存，不能当已交付。第二阶段再加debug-only静态资源覆盖与watch，限定日记适配页和聊天适配CSS/JS，不重建冻结Web A主体。保持原 `https://appassets.androidplatform.net` origin及原消息桥，明确资源版本和Service Worker缓存策略；切换到HTTP开发地址会改变IDB/同源与桥环境，不能直接冒充相同数据链。重载之前等待flush ACK，失败保留编辑页，不自动杀进程。样式尽量原位更新，JS根据依赖重载，不承诺任意模块无状态热替换。
3. **一键诊断和最小复现。** 在开发版记录构建/资产版本、Android/WebView版本、页面类型、桥ready、dirty/saving、ACK阶段/耗时、错误码和调用栈；按需采集对应包Logcat与WebView异常。正文、草稿原文、照片、密码和令牌默认不入日志。重现截图默认使用合成页面；用户页面截图须明确范围。用同一操作ID关联点击→前端→桥→SQLite/IDB提交→ACK，区分渲染问题、保存未完成和实际落库失败。
4. **把验收分层固定。** 普通字体/间距/菜单先跑浏览器合成页面与目标组件检查；改桥/保存/生命周期才跑对应AVD链路；阶段完成再做完整项目检查和交付包。中文输入法、MagicOS键盘/权限/照片和后台仍留真机核验。避免每改几像素都完整打包/强杀/安装/跑全套；也不以浏览器通过代替Android验收。

## 调试工具分工

| 问题                            | 首选工具                                      | 限制                                                                     |
| ------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------ |
| 聊天气泡、长文内容、CSS、JS报错 | Chrome DevTools连接App WebView                | 当前即可使用；临时改样式须回写源文件                                     |
| 原生底栏、阅读列表、触控区域    | Android Studio Layout Inspector               | 检查原生View，不能代替WebView内部DOM工具                                 |
| Java业务/桥/SQLite异常          | Android Studio断点与Logcat                    | JS错误目前不自动转Logcat，需同时看Chrome Console                         |
| 部分原生代码/资源迭代           | Android Studio Apply Changes                  | 有适用范围；manifest、结构等变化可能需要重新Run，不能当Web资源通用热更新 |
| 动画/卡顿                       | DevTools性能录制及Android系统跟踪，按问题选用 | 调试工具自身可能影响性能，最终观感另在正常运行验证                       |

优先投入前三项后，再按实测耗时决定是否进一步改构建缓存/增量资源；当前不为追求热更新重写Compose或另换客户端框架。现有原生壳＋WebView分别用对应工具即可逐步降低调试成本。

## 官方依据

- [Android WebView连接Chrome DevTools](https://developer.android.com/develop/ui/views/layout/webapps/debug-chrome-devtools)
- [Android Studio构建运行与Apply Changes](https://developer.android.com/studio/run#apply-changes)
- [Layout Inspector](https://developer.android.com/studio/debug/layout-inspector)
- [Logcat](https://developer.android.com/studio/debug/logcat)
- [Build variants与独立applicationId](https://developer.android.com/build/build-variants)

本页为项目内调研/建议产物；本轮无额外临时文件或APK。后续实施必须另记实际功能、验收和运行切换，不能将此计划标为已配置。
