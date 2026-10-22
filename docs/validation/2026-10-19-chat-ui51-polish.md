# 随想 ui51 定向修复与交付

当前阶段：精确候选独审通过、源码8目标窄回写，并已正常保存/备份/标准upgrade安装启动。operation/backup `2026-10-19T23-27-19-082Z-37867c67`，实际native ready `2026-10-19T23:28:41.5026940Z`，安装/运行ui51、116%/2屏、真实前台editor聚焦、无锁。沿原需求/人工验收流程维护，不另立产品规范。

## 需求、实现及证据

- 会话列表：实际方向键预选深底保持，名称改醒目红色、字号16→18，保普通/置顶/预选三态、截断与设置图标。`sidebar-high/sidebar-ui.json`17定向，独立`sidebar-high/independent.json`通过。
- U07/U23/U25：拖动输入上缘时同步保持底部或原中段，不用释放后强移尾掩盖held裁切；反向选区保留。原全局appearance增加可选`showSendButton`，默认true、显式false保留，实际设置可隐藏普通发送按钮并释放占位；Enter/ShiftEnter及IME门槛保持，编辑/附件/转发确认保留。`composer-high/composer-targeted.json`19定向与独立9项通过；schedule仅CSS状态，不称完整定时流程已验。
- 集成发现双editor反例：旧禁用同ID在前时原新增查询取错owner，held尾字裁31.09px并丢反向选区。owner-v2仅3hunk改为实际resizer所属footer，保同editor/room身份；新6项与原反例4项有界验证，不重19项。见`composer-high/owner-v2/receipt.md`。
- U37/U38/D1：悬停展开按现有原生选项激活宿主并恢复当前输入caret/选区，设置/看图/IME/用户主动操作优先；固定hover事件区别普通快捷键移尾。原生本机`DockHoverInputRevision=1`一次迁移旧默认false为开启，此后用户显式关闭保留。无新跨端wire/端口。`hover-high/frozen-native-v3`为唯一可交付原生闭包。

## 原生来源与范围

旧UPSTREAM原生来源元信息过时，不能按其27e源码重建并丢保存/故障保护。实际ui50 EXE与重构原基线1519个归一IL/字段成员完全一致（0差异），正确DesktopPreview基线8b908。v3仅改DesktopPreview/EdgeDock两源，其他7源与WebView DLL精确保持；未混入共享目录并行bridge/input候选。首闭包及v2已撤销，不可安装。证据`hover-high/actual-native-il-comparison.json`、`frozen-native-v3/manifest.json`。

## 合并包

`candidate-ui51-polish`以ui50不变资产复用，所有覆盖采用新临时文件原子rename，未改硬链接基线。CSS三方合并sidebar/composer，previewJS三方合并composer/hover；chatUI用owner-v2。原生EXE SHA `9707833b129f0347c1b6e435a0cabb31643403783f8a26b80e00ca6e4cd6439f`。

根同包检查`sol/ui51-owner-v2-merged-sanity.json`：实际私有两房资料、441px，隐藏按钮/拖高held尾行、Esc方向红名18px、真实IDB慢写入约2.2秒下Enter首显与ACK同节点可见。无正式测试发送、无私有正文截图导出。组件和根检查有交叠，不相加包装成全矩阵。

源窄回写8目标通过，备份及CAS见`ui51-writeback-apply.json`，未覆盖并行bridge/input。标准stop见`ui51-normal-stop.json`，复核聊天/托盘均退出且无锁。正式升级与数据维护共用一次停止窗口；不强杀、不绕过保存保护。

## 最终独立审核

`review/hover-independent.md/json`批准精确v3闭包及最终合包接缝。真实可见隔离WebView/Win32链通过：从另一合成进程移入露出条，宿主展开获前台，实际键入X进入保留中段caret，未触发旧focus-end且激活只一次。20断言属于一条定向链，不按20独立场景计。专属profile与禁用业务桥保持，鼠标/原前台恢复，测试进程退出；失败测具与修正均保留，不修改产品迎合测试。

审核核对最终109个实载资产与候选manifest、复核组件原报告和owner-v2及根合包原始样本；没有重跑整矩阵。最终冻结manifest SHA `854517df80a77bea716519e619216eeabfc965c2d0982c77cf99a30781fe35b3`，标准交付证明`delivery-manifest-ui51.json`覆盖12297文件。image范围只复用原viewer源码/IL/资产及新宿主OwnedForms相邻保护，绝非same-EXE复用或新物理看图全链。

## 正式交付回读

标准stop `ui51-normal-stop.json` 后将一次desktop/API短窗口明确交数据owner，仅启用已审87cf MIME补丁；数据回执`outputs/2026-10-19-computer-collection/mime-maintenance-summary.json`确认原library/epoch/业务保持、FIFO closed0及5根4088文件pre/post稳定备份、聊天托盘仍停止后归还。根重新status确认资源后才执行标准upgrade；根未重启API。

`ui51-install.json` installed/restarted=true；`ui51-after-status.json`实际native就绪、保存无pending/recovery、窗口聚焦和2屏/1.16保持，API shared:true。标准交付证明覆盖12297文件，由原CLI校验安装；备份在`outputs/desktop-maintenance/backups/2026-10-19T23-27-19-082Z-37867c67`。未发正式测试消息、未改正式原文、未操作手机/设备。

悬停偏好在RestoreSettings中一次迁移为true，最初ready时旧window.json尚未SaveSettings仍显示旧false/无revision，不等于当前内存关闭；本轮未强改配置。后继ui53标准升级正常保存ui51时已只读确认磁盘`DockActivateOnHover=true / DockHoverInputRevision=1`，772×1550/1.16/两屏保持，证据`ui53-native-preference-save.json`；之后显式关闭沿revision保留。功能隔离前台链、正式ready及实际保存分别记录，不把正式启动当物理hover全链重验。

## 未验及后续

物理键鼠/真实IME、完整schedule、长期性能及用户全部现场未以本轮局部测试结案。手动截断归篇、各房阅读/草稿/缓存记忆及窗口resize内容锚点、壁纸/切房性能后续仍待实现或专项优化，不能称本轮全部需求完成。
