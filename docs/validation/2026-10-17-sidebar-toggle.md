# 随想Esc侧栏与折叠按钮黑边

2026-10-17 已正式启用随想20261017-ui10（PID16988）：按用户最新澄清，Esc默认展开/收起与透明按钮相同的实际会话侧栏，聚焦当前会话、方向键预选、Enter进入并折叠；原三种切换方式继续可选，旧模式元数据保留。修正按钮鼠标焦点默认环残留，键盘青色提示仍可见。393＋10项原生隔离、22侧栏DOM＋35焦点DOM、16按钮CSS场景及564项全库检查通过，12215安装文件SHA-256匹配。API0.9.24未重启，原数据/profile、108%字号和两屏档案保留，当前屏按用户确认保留1649px新高度。真实偶发GPU残影未单独硬件复现。见[本轮验收](../validation/2026-10-17-sidebar-toggle.md)。 本轮用户明确恢复保存退出后，已使用Computer Use唤回思绪、执行正常保存及关闭，再由标准stop确认后台退出；未强制结束进程。前轮保存受阻记录保留为历史。

用户澄清：Esc应控制与透明折叠按钮相同的实际会话侧栏，不是独立切换弹窗。黑边位置为折叠按钮周围。需求U41/U42记录在CHAT-UI-OPTIMIZATION-2026-10-16.md；此前ui9的manual弹窗按当时理解实现，保留可选，但不再代替新澄清。

本轮产物目录outputs/2026-10-17-会话侧栏与黑边，临时tmp/sidebar-toggle。基线为实际ui9，随想PID49160、思绪/托盘76152、API0.9.24；执行前须重新查询，不据源码改好宣称已经启用。正式数据/profile继续原位，测试显式隔离，不改用户会话名和快捷键绑定。

按用户授权由既有Sol高强度子代理并行处理Esc侧栏状态和按钮CSS，主会话统一原生回归、部署与交接。所有会话积极读写开发文档：先读最新交接/模块约定，过程中及时更新需求、实现、失败、验证及运行状态；共享文件重新读取后局部修改，保留并行变更。

## Esc侧栏实现与隔离行为

## 此前保存保护中止（本轮已解决）

最终393项聊天＋10项图片原生隔离全通过，errors/runtimeErrors为空；本轮564项全库检查无失败/跳过，22侧栏DOM＋35焦点DOM及16按钮CSS场景通过。交付清单delivery-manifest-ui10.json已封存候选源码/程序与验收哈希，只读upgrade预检通过。

正式upgrade在2026-10-17T10:47:57Z进入正常保存退出后保护中止：“保存退出未完成，取消维护；未替换程序文件。请保留窗口处理保存提示”。旧随想PID49160已经退出，思绪/托盘PID76152保留，稳定安装仍ui9；并未安装或宣称ui10已运行。已向用户请求处理思绪保存状态并正常退出托盘，等待回复；未强制关闭、未绕过保存保护。证据upgrade-error.json、status-after-blocked-upgrade.json和维护operation 2026-10-17T10-47-41-658Z-de025bae。收到用户已处理回复后重新查询进程，再走标准升级，不从失败中间阶段手工替换文件。

本轮更早Computer Use因无法可靠识别Edge主页URL而停止，之后没有继续该界面输入或换方式绕过；随后实体Esc再次停止了前轮界面操作。新一轮用户明确恢复后仅操作思绪原生窗口，正常保存/关闭及stop成功，原受阻状态已解决。保存保护本身不是日记损坏结论。

## 实现细节

新增sidebar模式，首次以shiye-room-switch-sidebar-v1保存previousMode/effectivePreviousMode并将本轮模式设sidebar，后续用户选择旧模式不再覆盖。四种可见名称区分会话侧栏、立即切换、弹窗预选、弹窗手选。wrapper的shiye-set-sidebar与shiye-sidebar-changed统一按钮／Esc／窄窗选行状态，aria-expanded与持久设置不再分别修改。

Esc展开后定位#LeftColumn真实当前行，方向键按既有排列预选，Enter先flush草稿、切入再折叠返回输入；第二次Esc不提交预选。虚拟列表目标稍后挂载时有限重试，收起即取消。输入区、搜索、会话设置、IME及其他上层窗口保持自身语义，侧栏行聚焦时普通恢复事件不抢回编辑区，折叠后解除该保护。

22项实际wrapper/workspace DOM行为与35项既有焦点回归通过，细节见[侧栏键盘记录](2026-10-17-sidebar-keyboard.md)。本轮npm run check的文件依赖、ESLint、全项目格式及564项测试全通过、无跳过；含并行便签等新增模块，不把新增测试都归给聊天。vendor TS本轮未改，类型与目标lint参考上一ui9通过记录，候选manifest仍校验其源码哈希。原生整轮正在验证同一侧栏、Enter、Esc、持久化、旧模式与按钮焦点，不以DOM通过代替实际WebView结果。

### 按钮样式依据

上游styles/reboot.css为全部button:focus提供5px auto的浏览器焦点环；自有折叠按钮只定义focus-visible青色环，未清普通focus。鼠标点击后即使移出，按钮仍focused，便留下默认环，颜色随主题/平台可变。只给此按钮补appearance:none、outline:none及透明tap-highlight，后置focus-visible仍保留2px青色提示，未清除键盘可见性。

隔离Chromium载入候选真实基础CSS与wrapper CSS：修前8场景复现、修后16场景通过（深浅主题、360/1100宽、左右镜像、展开/折叠）；普通、悬停、按下、移出后焦点、键盘focus均核对，56×56点击区与26px图标保留，200%正文字号不放大图标。证据在本轮outputs；夹具tmp/sidebar-toggle/verify-toggle.mjs。没有操作正式WebView/GPU，不能把可复现CSS原因等同所有偶发图形残影都已人工复验。

## 最终验收与启用

正式窗口实测两次Esc：按钮名“折叠会话列表→展开会话列表→折叠会话列表”，确认操作的是原侧栏且恢复原状态；只记录可见控件标签，没有写消息。证据live-esc-verification.json。当前用户随后明确暂停界面操作，后续不再按键、调整尺寸或抢占另一会话全屏操作。

最初严格偏好比较发现高度1542→1649；用户明确确认刚手动拉高，已记录user-confirmed-size-adjustment.json，保留1649高度。另一屏尺寸、两屏字号及当前宽度均与升级前相同；display-preferences-after.json按确认的新高度通过，不把用户意图当回归错误或重写旧值。

正式主服务持续运行，diary-hash-comparison.json显示保存后基线与后续主库字节哈希不同，期间文件仍有写入时间变化；本轮不能宣称主库字节完全不变。维护命令只备份/安装程序及窗口偏好，没有直接改写diary.json，也未重启主API或迁移数据；正常页面保存/既有归篇与其他使用期间的写入未逐条归因，不能把哈希差异直接说成数据丢失。

393项聊天＋10项图片原生隔离全部通过，errors/runtimeErrors为空；包含实际侧栏当前焦点、方向键预选/停顿不进入、Esc取消、Enter切入并折叠/回输入、按钮同状态、鼠标默认环和四模式持久化。全库npm run check的564项无失败/跳过，22＋35项DOM与16按钮CSS场景通过。vendor本轮未改，TS/目标lint沿用ui9通过参考，源码hash仍匹配。

标准desktop-control upgrade完成正常保存退出、备份、安装和启动。实际PID16988、ready:true、20261017-ui10；API0.9.24与package一致且未重启。12215文件hash全部一致，108%字号和两屏档案保留；当前屏按用户确认保留1649px新高度，另一屏尺寸及两屏字号均与备份相同。进程、升级备份和偏好证据分别status-after.json、upgrade-result.json、installed-file-verification.json、display-preferences-after.json。前轮实体Esc停止的界面操作在用户新一轮明确恢复后才继续，本轮正常stop成功，未强制关闭或跳过保存。真实GPU偶发残影或硬件多屏/系统IME全部组合未完整实测。

成品与验收在outputs/2026-10-17-会话侧栏与黑边，临时tmp/sidebar-toggle；所有其他会话继续积极读写开发文档，开工先读最新交接、过程中同步需求与证据，保留其他会话变更。
