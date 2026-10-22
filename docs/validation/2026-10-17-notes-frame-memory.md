# 便签 UI6：中文箭头、窗口记忆和灰色标题栏

后续状态：用户授权继续后，四边四角实拖、标题栏移动、原生按钮、正常关闭重开记忆已经实际通过，最终恢复测试前窗口配置。下文“鼠标未完整验收”为当时工具失败记录，当前以[原生鼠标补验](2026-10-17-notes-native-interaction.md)为准；真实硬件多屏/DPI边界保留。

日期：2026-10-17。用户要求中文折叠箭头靠近当前层文字；基本窗口行为与思绪一致，置顶移到边框、便签和思绪边框灰色；调研壁纸关联材质，并记录已认可的目录设计。

## 已实现

- 中文自然层级箭头按真实前缀字形测量，不再固定在段落最左侧。全角空格、半角/Tab混合缩进、字号和缩放变化后，都由rAF/ResizeObserver重新对齐；按钮右侧距离当前层文字6px，原空白与正文不变。
- 便签置顶迁到原生标题栏，与最小化、最大化/还原和正常保存关闭并列。正文网页只在旧宿主缺少nativeFrame能力时显示备用置顶按钮。标题栏和DWM外边线中性灰，与随想灰框配色对齐；深边#5d6266、深标题栏#292d30，浅边#b8bcc0、浅标题栏#f2f2f2。
- 用户反馈初次接入遮挡内容/不能可靠识别缩放/图标太小后，修正为完整宿主布局：frame和WebView均Dock=None，以ClientSize明确划分；40DIP标题栏、46DIP按钮、放大细线图标。WebView从标题栏底部开始，独立8DIP边环、四边四角共8个native grip位于WebView上方；18DIP角区使用L形region，避免盖住关闭按钮或正文。鼠标命中后交Win32原生缩放，保留THICKFRAME/系统最大化和关闭协议；最大化隐藏grips。Alt+Space和标题栏右键使用原生系统菜单，不新增便签组合快捷键。
- 原先只在关闭/置顶时记窗口几何，现移动/缩放后350ms原子保存；最小化时保留此前正常/最大化状态；显示屏变化时把正常窗口裁回可见工作区。窗口偏好错误可回传，正文成功保存不被偏好错误覆盖。
- 字号/正文缩放、主题、背景、目录模式/宽度/常驻、自然缩进/标签键偏好早已有独立IndexedDB恢复；每个标签各自保存光标和像素滚动位置。字号/缩放属于工作区，非每标签独立；尚无跨字号重排后的内容锚点补偿或每屏独立窗口配置。
- 用户明确喜爱“宽窗透明同背景、窄窗覆盖时毛玻璃目录”，已写 [UI-PREFERENCES.md](../UI-PREFERENCES.md)，标明待合并电脑端agent规范候选，不擅自扩大为全软件永久规则。
- 思绪标准系统边框设置相同灰色DWM属性，保持原窗口行为。见 [思绪灰边核查](2026-10-17-thoughts-gray-frame.md)。

## 回归原因与验收补强

初次原生栏候选只做了按钮控件离屏绘图和编译，没有覆盖整个NotesWindow的Dock/z-order。用户实际发现Fill先铺满client、Top栏随后覆盖，以及WebView子窗口吞掉边缘命中。这是本轮接入回归，不能用此前前端564项通过或单控件11项通过证明宿主布局正确。

修复后新增真正构造NotesWindow的离屏集成检查：27用例、2196断言，三种尺寸×96/144/192合成DPI×正常/最大化/还原，覆盖frame/web无重叠、8grip可见性/位置/z-order、L形角区不覆盖正文和关闭中心、40/46DIP大小。测试不Show、不创建HWND或WebView环境、不读取私人profile；合成DPI输入不等同硬件WM_DPICHANGED。证据 `ui6-native-integrated-layout.json`。

## 已验证范围

- `npm run check`完整通过：564项测试、0失败/跳过，文件/ESLint/全库Prettier通过；日志 `project-check-ui6-final.log`。最终native C#修改另经同.NET编译及上述宿主集成检查，不把npm检查当作原生鼠标验收。
- 便签前端59组Chrome隔离通过：原43组、窗口/字体记忆5、桥兼容3、中文箭头专项8；原UI5证据未覆盖，正文和媒体精确比较保持。字体21/24px、108%/140%缩放、400px窄窗、混合前缀、列表/checkbox均测；桥验证新宿主隐藏网页pin、旧宿主保留fallback、主题同步、IME/保存失败留窗。
- 修复版正常保存关闭、profile+app快照后安装，六个文件SHA校验一致；当前PID82808/静态79828为此时快照。真实回读：40px标题栏，captionBottom=48、webTop=48，无重叠；正常态8grip可见，置顶恢复，窗口偏好无错误、正文已保存。
- 使用标准Win+Up/Win+Down验证实际最大化和还原：最大化grips=0、还原grips=8，两个状态webTop>=captionBottom。还原外尺寸1422×1191与升级前最新用户配置一致。首次UI6之后用户又调整位置/尺寸，修复快照保存的是用户最新值，不回写较早测试位置。
- Windows控制工具的原生点击返回 `coordinate input geometry is unavailable`，另有最小化后 `user input was detected`，已如实记录；用户恢复窗口后才继续正常退出升级。未绕过工具改用外部SendMessage/UIAutomation驱动。实际逐方向鼠标拖拽和真实硬件多屏/DPI仍未完整自动验收，离屏grip布局通过不等于这些实际交互全部通过。没有截取或输出用户便签正文。

## 壁纸过渡调研结论

[微软Mica](https://learn.microsoft.com/en-us/windows/apps/design/style/mica)融合主题与桌面壁纸色调，适合长期窗口，失活/省电/关闭系统透明效果时有中性回退；它与透视背后应用的实时模糊不同。[Acrylic](https://learn.microsoft.com/en-us/windows/apps/design/style/acrylic)更接近背景模糊，适合短暂或覆盖层。用户喜欢的窄目录目前是窗口内部CSS backdrop-filter，不能据此宣称整扇原生窗口已透桌面。

[DWM系统材质](https://learn.microsoft.com/en-us/windows/win32/api/dwmapi/ne-dwmapi-dwm_systembackdrop_type)在Win11 22621起支持系统backdrop类型；当前机为Win11 26200，版本具备条件。但[Win32/WebView2的Mica说明](https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/ui/apply-mica-win32)要求正确的合成目标和透明层：目前WinForms自绘灰栏、WebView及页面均有不透明填充，单设DWM属性不能证明真实材料可见。建议后续以Mica/中性灰回退做标题栏过渡，正文保持可读，不对1px边线单独套实时毛玻璃。本轮先落地灰边和基础窗口修复，未默认启用系统Mica/Acrylic或引入大型SDK。

## 产物与临时文件

成品/公开验收：`D:\拾页\outputs\notes-ui`。临时脚本和隔离harness：`D:\拾页\tmp\notes-ui`。私人profile：`var/notes-ui-preview`；正常关闭后的快照：`var/notes-ui-upgrades/ui6-profile-20261017T105819Z` 与修复后的 `ui6-frame-fix-20261017T110527Z`。原生回执与哈希最终见 `runtime-ui6.json`，所有PID下次必须重查。

已同步F盘agent规范中的拾页快捷窗口专题，仅作项目引用与偏好候选。目录检查回执 `topic-validation-ui6.json`：20个主题，本轮修改的快捷窗口专题没有断链；全目录仍被另一聊天专题中3条相对项目链接阻断（room-position-transition、PRODUCT-NAMING、sidebar-toggle）。保留该并行专题原文，未借本轮改写；不能宣称全目录验证通过。
