# 2026-10-18 侧栏三态验收

ui34已标准安装并启动，11项实际浏览器检查通过。首次保存退出失败及卡死恢复过程保留如下，不能记为标准保存退出成功。仅修改两个wrapper：`shiye-room-workspace.js`、`shiye-preview.css`；不改TS、worker、API、原生，不运行Vite或全套检查。

已完成 `node --check shiye-room-workspace.js` 和两文件Prettier check。原pin动态规则的高优先级背景及 `.selected` 深色逻辑已移除；普通行透明、pin行通过变量浅底，唯真实 `.ListItem-button:focus-visible` 深底白字。未聚焦的已打开会话不再冒充键盘目标，深浅主题分别恢复正常文字色。

实际证据 `browser-validation.json` 绑定program manifest `a513ad7bf7f511ddca48dadc862bd918902dd4209e31244cd5a4805a418204fc`，11项：dark／light各5项检查真实Esc焦点、普通透明／pin浅底／focus深底、焦点深于pin且标题可读、方向键pin→pin／普通时优先高亮并清除旧opened项深色、Enter进入目标并收起；另1项无页面运行错误。dark焦点白字对比12.53、light为7.00，主会话已复核两张截图。只跑这11项，未全套复测；旧11项图片查看器证据按同EXE／资产复用，不计为本轮重跑。

静态候选 `candidate-ui34` 共11915文件，`program-files.json`／`source-scope`／`delivery-manifest-ui34` 记录清单。包delta只有两个显示源码、preview修订及index／metadata共5路径；native／vendor／worker与ui33精确相同。

首次升级真实阻塞：operation `2026-10-18T09-47-10-318Z-75683a34` failedPhase=stopping、lastSuccessful=prepared，错误为“保存退出未完成，取消维护；未替换程序文件。请保留窗口处理保存提示”，backup=null。doctor／status确认仍为同一ui33进程，未替换安装文件。只读查看曾恢复最小化窗口，但界面统一灰色／内容disabled，正常保存UIA按钮操作坐标超窗失败；该阶段未强杀或重载。这不是policy rejection。

卡死恢复：用户反馈退不出并授权帮忙，正常Alt＋F4无效。主会话先将原profile的IndexedDB、Local Storage、Session Storage、Sessions、File System、WebStorage、blob_storage及window／image／runtime配置保留到 `recovery-preservation/before-stop`、`after-stop`，每份58文件约92.45MB，无复制错误；这不是未落盘草稿保真的证明。核对PID33920的EXE及创建时间后，按用户授权强制结束卡死聊天，统一CLI stop正常停止托盘58636，API不动。恢复快照、终止进程依据均保留，未把强制退出写成正常保存成功。

恢复后标准upgrade成功：`upgrade.json` installed/restarted均true，operation及备份 `2026-10-18T09-55-46-932Z-bc709da8`，`saveDisposition=already-stopped`。`status.json` 安装／运行均 `20261018-ui34`，原生ready回执 `2026-10-18T09:57:01.3565497Z`，聊天PID81932／托盘80260仅当时快照。`installed-verification.json` 于 `09:57:11.814Z` 确认11915文件SHA一致；`runtime-after.json` 偏好保持972×1824／116%／2屏，API仍0.9.25，revisit／conversationServices／stickerCollection能力保留，本轮未重启API或审核正式库。

主会话安装后实际截图确认消息／输入区正常渲染、无灰屏。卡死根因未定位，本轮修复的是侧栏三态样式，不宣称根因修复、长期不再卡死或未落盘草稿保证。后续维护前重新status，不沿用历史PID。

恢复后原生窗口另做4步smoke，见 `recovery-preservation/window-smoke.json`：消息／输入非灰屏、Esc展开、Down从置顶项移到朝花夕拾（原项恢复浅底、目标深底、其他透明）、再次Esc收起；未切房、发送或改草稿。这是恢复定向检查，不是全套原生重测。当前部署状态以 `deployment-complete.json` 的deployed=true及status／upgrade为准，已替代 `deployment-blocked.json`；候选delivery-manifest中preinstall deployed=false保留为不可变阶段记录，不据此否定实际已安装。

产物 `outputs/2026-10-18-sidebar-three-states`，临时 `tmp/sidebar-three-states`。
