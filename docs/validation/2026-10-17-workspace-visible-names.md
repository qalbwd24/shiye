# 工作区可见名称

2026-10-17 运行更新进行中：便签已确认“已保存”后正常Alt+F4退出原PID37072，关闭profile完整快照及原EXE/config保存在var/upgrades/visible-names-notes-2026-10-17T10-17-31-711Z；只安装新标题宿主两文件，SHA与候选一致，复用18770静态服务PID79828重新打开PID79800，原生标题“拾页 · 便签”、页面已保存状态均已回读。便签UI4并行网页改动保留，不改其数据接入方案。证据outputs/2026-10-17-工作区命名/notes-installed.json。

后续便签UI4会话按其正常流程再保存重开，当前只读进程回读PID23268、标题仍为“拾页 · 便签”；此为并行会话的更新，不将先前PID79800记作永久运行值。

主页源码title已更名；对现有Edge主页窗口进行保存状态回读时，Computer Use因无法可靠判定当前浏览器URL而停止。本会话停止该界面自动化，不用其他方式绕过或强制刷新，现有主页保留，用户刷新后才能看到新标题。此项不记作正式浏览器回读已通过。

2026-10-17 用户确认二级产品名称：**主页**对应主界面，**思绪**对应现快捷写作窗口，**随想**对应聊天窗口，**便签**保持便签。此为可见界面命名，不改变用户自己的会话名称、篇目标题或正文。

## 本子任务已实现

| 文件                                       | 可见变化                                                                      |
| ------------------------------------------ | ----------------------------------------------------------------------------- |
| `public/index.html`                        | 浏览器／Edge App 页标题为“拾页 · 主页”                                        |
| `public/features/quick-capture-window.js`  | 网页标题“拾页 · 思绪”，导航无障碍名“思绪”，回主界面按钮“主页打开”及空内容提示 |
| `public/features/quick-window-settings.js` | “思绪设置”“思绪外观与字体”                                                    |
| `public/features/quick-appearance.js`      | “思绪外观”、思绪窗口说明与壁纸提示，“跟随主页”相关文字                        |
| `public/features/preferences.js`           | “思绪进入编辑时”                                                              |
| `public/features/workbench.js`             | 对应设置入口“思绪外观”                                                        |
| `public/features/organization.js`          | 默认分类说明使用“主页与思绪”                                                  |

只修改上述可见文字；选择器、元素ID、函数、文件名、localStorage／数据库字段、热键以及内容存储没有变化。未批量替换功能描述中的“快捷”。聊天／原生入口和便签由主会话及相应负责人同步。

## 标题来源与原生切换

主页由 `desktop/Launcher.cs` 启动 Edge `--app`，页面 `<title>` 可直接决定其网页标题。思绪网页的 `document.title` 在 `quick-capture-window.js` 设置；WinForms 外层标题在 `desktop/QuickCapture.cs` 构造器独立硬编码。当前宿主没有订阅 WebView2 `DocumentTitleChanged`，也没有前端可调用的改标题消息，因此仅改前端不能更新已编译的 WinForms 外层标题。

本轮最小原生方案是将 `QuickCapture.cs` 中构造器的“拾页 · 快捷记录”改成“拾页 · 思绪”，并同步错误提示框标题。前端阶段没有修改原生共享文件；后续按主会话明确授权完成这两处固定文字及独立候选构建，详见下节。需要主会话核对草稿保存状态后按现有安全流程退出／重开；无需为名称增加通用消息协议。旧可执行文件名保留。

## 检查与验收边界

7 个修改文件的单文件 ESLint／Prettier 检查通过（HTML只参加Prettier）。此项是可逆文案变化，没有新增镜像字符串断言测试。实际新窗口的原生标题、网页标题、设置入口及跨窗口打开需要由主会话统一候选／运行验收记录，不能将本静态结果视为已切换正式运行。

前端阶段没有额外生成截图或测试脚本；后续独立候选的构建脚本和中间源码在 `tmp/clipboard-focus/`，详见下节。

## 思绪原生独立候选

按主会话后续授权，`desktop/QuickCapture.cs` 只修改两处固定文字：错误提示框标题和 `QuickCaptureWindow` 构造器的标题，均为“拾页 · 思绪”。没有新增协议或修改其他 C# 行为。

- 候选：`outputs/2026-10-17-工作区命名/quick-candidate/拾页快捷记录.exe`。
- 候选 SHA-256：`F2983C809AE32DEBA4A16A663D801C0F67E368299914F65B276705E013005ECE`。
- 构建脚本：`tmp/clipboard-focus/build-quick-names.ps1`；生成源码：`tmp/clipboard-focus/quick-names-build/QuickCapture.generated.cs`。
- 构建参数与 `tools/build-quick-launcher.ps1` 一致：Framework64 csc、winexe/x64、原图标及相同三个 C# 输入；只将输出位置改到独立候选，SDK也在候选内解压，未调用会覆盖运行EXE的标准构建脚本。
- 附带 `.exe.config`、`config/app.json`、图标、WebView2 1.0.4191.47 的 Core/WinForms DLL、许可证/溯源及完整 loader 布局。SDK 原包 SHA-256 与标准脚本要求一致；没有复制 `deployment.local.json`、正式 profile 或数据。
- `compile.log`、`build-manifest.json`（源码/依赖/候选哈希）及 `validation.json` 在候选目录。编译退出0、无诊断；现有 `--self-test` 与 `--check` 均退出0，仅验证纯生命周期规则及 CLR/WebView2 可用性，没有打开编辑器或托盘窗口。

构建前后根目录现有 QuickEXE SHA-256 均为 `976226D4042B9D82EDEE1F75ABABEC9F29ACD90D5AC56E49473B3ACE9C6FE8D1`，未被覆盖。没有停止／重启当前Quick或托盘，没有部署；实际原生标题和完整运行验收由主会话统一完成。若要运行候选做交互验收，须同时指定独立 `--url` 和 `--state-dir`，继续使用生成的测试资料。

## 统一启用回执

思绪已正常保存退出、原程序/config快照后安装新候选，运行PID76152，标题“拾页 · 思绪”；随想PID49160显示“拾页 · 随想”，便签PID23268显示“拾页 · 便签”。入口按钮、托盘菜单、设置文案及QuickHost查找窗口的chatTitle均同步，原有EXE路径/配置/热键与数据保持原样。运行哈希与元数据：outputs/2026-10-17-工作区命名/runtime-after.json、quick-installed.json。主页源title为“拾页 · 主页”，现有页面未刷新，仍待用户刷新后回读，不宣称浏览器实际标题已通过。
