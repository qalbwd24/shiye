# 随想侧栏三态

2026-10-19当前ui51已独审并标准安装启用：14行侧栏名称增量与composer/hover无冲突，真实预选红名18px、深浅主题/长名几何保持。operation2026-10-19T23-27-19-082Z-37867c67，实际native ready23:28:41.5026940Z；见[本轮验收](validation/2026-10-19-chat-ui51-polish.md)。以下私有ui50/待审待安装段落为历史过程，不覆盖当前。

2026-10-19用户新反馈覆盖下方ui34“焦点白字”：预选/选择时除深底，**会话名称须醒目红色**，全列表名称字号适当增大。保普通透明、置顶浅底、真实键盘目标深底且优先三态，不让旧`.selected`已打开行冒充预选；只名称变红，未读/图标不一并染色，长名称仍单行省略、不挤控件。沿现字号/主题适配，在现名称基础上小幅增大，不改变消息正文或输入字号；源码/定向状态见下段。仅定向验深浅主题实际Esc/方向选择、名称可读及长名几何，不重全套侧栏/程序/后端检查。

私有ui50名称小增量已实现并自验，尚未独审/安装：仅CSS局部名称token，名称在原值上+2 CSS px，真实`.ListItem-button:focus-visible`目标`.fullName`红色；深浅主题实际Esc/方向选择、合法长名ellipsis/设置图标位置、旧opened不染红与三态保持共8项定向。证据`outputs/2026-10-19-web-chat-improvement/sol/ui50-sidebar-ui.json`。输入区小修随后同包，不为此运行Vite或扩大后端矩阵；正式仍ui49。

2026-10-19 Sol高侧栏分项已在**已审SF16 ui50基线**上独立隔离验证通过：候选为`outputs/2026-10-19-web-chat-improvement/sidebar-high/candidate/app/shiye-preview.css`单文件覆盖，14行CSS与先前私有名称增量完全同SHA；不含输入区改动，不替换任何SF16脚本。972/441 CSS px、深浅主题实际Esc→方向下预选共16项行为/几何断言及1项加载资产SHA门槛通过，旧opened/普通名称不误红，所有名称18/原16px，长名省略仍在设置图标左边，三态保持；PNG已目视。精确diff/前后SHA、实载资产及边界见`outputs/2026-10-19-web-chat-improvement/sidebar-high/`。此为侧栏独立分项通过，整体合包/最终审核/源码回写/安装由主会话接续，未操作正式desktop/API/设备。

用户要求：Esc展开真实会话侧栏后，普通会话近透明、置顶会话浅底、键盘当前预选会话深底；预选优先于置顶。原来pin动态规则使用高优先级背景，遮盖方向键焦点，而 `.selected` 表示已经打开的会话，不能代替键盘目标。

本轮以ui33／API0.9.25为基线，仅修改 `shiye-room-workspace.js` 的 `paintRoomState` 与 `shiye-preview.css`。置顶动态规则只设置行背景及hover变量；统一CSS由真实 `.ListItem-button:focus-visible` 显示深底白字。已经打开但未聚焦的 `.selected` 按普通／置顶底色和主题文字显示，避免两个深色项。没有新增键盘marker、快捷键或事件行为，不改TS、worker、API、原生宿主。

ui34已完成11项实际浏览器检查并标准安装启动，深浅主题三色及Esc／方向键／Enter保持，主会话已复核截图。深色pin明确比focus浅，hover沿用各自基础底色，不产生第四色；wrapper语法及两文件格式检查通过。11915文件静态包复用ui33原生／vendor／worker，未运行Vite或全套。

首次标准upgrade因保存退出未完成取消，operation `2026-10-18T09-47-10-318Z-75683a34` 的failedPhase=stopping、lastSuccessful=prepared、backup=null，未替换文件，并非审批拒绝。后用户反馈卡死、正常Alt＋F4无效并授权处理；先保留profile／配置前后快照，再核对进程强制结束卡死聊天，托盘通过CLI正常停止，API未动。不能把这次恢复称标准保存退出成功，也不保证未落盘草稿。

随后标准upgrade以 `saveDisposition=already-stopped` 完成，备份 `2026-10-18T09-55-46-932Z-bc709da8`。原生ready/ui34回执 `2026-10-18T09:57:01.3565497Z`，11915安装文件SHA一致，972×1824／116%／2屏偏好保持，API仍0.9.25。主会话实际截图确认新窗口消息／输入区正常渲染，无灰屏；卡死根因尚未定位，不宣称已修根因或保证未落盘草稿。完整失败／恢复记录见验收。

产物 `outputs/2026-10-18-sidebar-three-states`，临时 `tmp/sidebar-three-states`。候选与正式状态见[本轮验收](validation/2026-10-18-sidebar-three-states.md)。
