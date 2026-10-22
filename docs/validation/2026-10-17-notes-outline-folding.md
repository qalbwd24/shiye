# 拾页便签 UI4：目录、折叠与兼容修正

日期：2026-10-17。保持独立前端试用范围，不决定正式便签格式，不修改其他会话的聊天/后端实现或正式日记数据。

## 本轮修正

- 源码 `---` / `***` / `___` 离开文字块后以细横线显示，返回可编辑；原生富文本 horizontalRule 保持原节点。共享快捷窗使用的 richdoc/编辑器继续复用，图片/媒体不做整篇 Markdown 往返。硬换行里的 `前文\n---` 不误变 Setext 标题。
- 占位文字此前依赖 TipTap isEmpty，它会把空列表判空。改为仅在文档恰有一个空普通段落时显示；首个 `1. ` 空编号项、任务和媒体都不显示灰色提示。
- 设置页头关闭按钮和页脚“关闭 / 保存设置”固定在独立滚动内容之外。保持即时预览/自动保存，两种关闭和保存都会等待 flush；图片处理中或存储错误留在对话框并显示失败提示。
- 文件名标题是独立输入框，常规26px、窄窗24px，没有H级别。正文 H1～H6 源码和原生富标题统一呈现；五级标题可做小任务，六级可做其子分区。
- 目录默认按正文标题显示；可选“标题与缩进”增加真实列表/任务父子级与连续手动缩进段落。半角、全角空格及 Tab 按相对宽度派生关系，不替换原空格；没有缩进关系的普通散文不进入缩进目录。
- 标题范围、子任务/列表、缩进父项可通过小箭头折叠。仅PM decorations隐藏节点，foldedIds放独立试用工作台快照，正文、图片字段和撤销历史保持。目录跳转或光标进入隐藏内容会展开祖先；正常richdoc使用稳定blockId，缺id的旧节点只能临时位置回退。
- 修正新增折叠控件文字混入DOM源码读数的问题：箭头由CSS伪元素呈现，按钮aria-label单独说明，不写入正文文本。
- 用户要求不得擅自绑定快捷键，已写 AGENTS.md 与 DEVELOPMENT.md。既有便签标签键默认关闭、由设置启用，目录/折叠不设新键、不注册全局热键。原有保存、缩放及基础编辑/缩进仍保留各自作用域，带Alt等修饰的导航不被误抢占。

## 隔离验证

- `tests/notes-markdown-preview.test.mjs` 4组：源分割线/原生节点、六级标题、转义/代码/硬换行保护、块身份与媒体字段保留。
- `tests/notes-structure.test.mjs` 3组：H5/H6关系、半角/全角/Tab缩进层级、嵌套任务/标题折叠及光标展开，精确比较body与8项图片属性不变。
- `tmp/notes-ui/structure-settings.mjs` 9组：真实逐键输入1.、三种源横线+原生hr、H5/H6目录与独立文件名、折叠保存重开/目录展开、任务折叠、缩进模式、400×420固定设置页头页脚、默认不拦CtrlT/F2且主动启用后生效、无JS异常或正式API写入。
- 原 `live-markdown.mjs` 9组保持精确文本断言通过；`outline-background.mjs` 9组及 `edge-cases.mjs` 3组通过，合计30组Chrome隔离界面回归。后者先明确启用标签键，再测已启用行为。真实编辑器/快照及图片保留断言未被控件过滤或弱化。
- `npm run check` 完整通过：文件依赖检查、ESLint、全项目Prettier及549项测试均通过，0失败/跳过，日志 `outputs/notes-ui/project-check-ui4-final.log`。先前UI3其他会话格式告警是历史状态，本轮未替其格式化或覆盖。
- 已查看 `outline-h5-h6.png` 与 `settings-fixed-footer-400.png`，均为虚构样本。专项结果 `structure-settings.json`；旧脚本初轮PM view取法错误的失败截图保留作为调试记录，最终passed:true回执为准。

## 运行切换与边界

完整检查通过后，按正常保存关闭、独立profile快照、标准入口重开流程切换。实际PID、保存状态及源码哈希以 `outputs/notes-ui/runtime-ui4.json` 为准；本文件不把浏览器测试等同原生物理输入法、多屏或长期运行验收。

实际回执：最终profile快照 `var/notes-ui-upgrades/ui4-profile-20261017T101817Z`；标准入口重开PID23268，原生回读有目录按钮/正文编辑器/已保存且无保存错误，静态服务PID79828复用。首次关闭工具返回“foreground window did not report a process id”，随后另一个标准入口进程已唤起；复制保护检测到仍运行而中止，未复制使用中的profile。重新定位实际窗口正常关闭成功、确认EXE进程全部退出后才完成上述快照/重开。未强制结束进程。主API只读health版本与package均0.9.24，没有为便签重启主API/聊天/托盘。F盘规范主题引用已同步，目录校验20主题通过。

目录是读取标题/缩进的视图，不新增文件导入、整篇Markdown源码模式或正式后端字段。参考：[Obsidian目录](https://obsidian.md/help/plugins/outline)、[折叠](https://obsidian.md/help/folding)。本轮不为折叠套用文档里的快捷键。

成品 `D:\拾页\outputs\notes-ui`；临时脚本/虚构数据 `D:\拾页\tmp\notes-ui`；私有profile与升级快照分别在 `var/notes-ui-preview` 和 `var/notes-ui-upgrades`。
