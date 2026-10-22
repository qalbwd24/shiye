# 会话阅读位置、过渡与设置操作 ui9

需求为U32–U40：会话阅读位置／过渡、会话列表透明按钮、固定保存栏、Esc手动列表、Win+V说明框、0ms收起等待、打开自然聚焦、可选悬停激活，以及常驻聊天唤起思绪／便签、主页／思绪／随想／便签命名。用户明确“两个”指两个问题，不是合并按钮；会话列表折叠与整窗吸附收起分开。除新确认的延迟范围与悬停激活选项外保留贴边策略，快捷键能力和现有绑定均未移除。

## 实现

本机会话离开前同步捕获消息ID锚点、相对视口顶部偏移、距底部偏移与底部状态，按会话／线程／列表类型保留最多96项本机偏好。切回按锚点恢复，避免仅用整段滚动高度；首次没有记录的本机会话显示最新。加载历史围绕保存锚点，显式搜索／引用目标优先。先完成定位，再用160ms透明度＋4px进入过渡，快速切换取消上一动画，系统减少动画时不播放。旧视图卸载不覆盖离开前的快照。

定位问题涉及旧滚动保存防抖、本地来信仍采用上游首条未读定位，以及侧栏切换没有取消旧发送跟随。三条路径均处理；本机ReadHistory适配器原只确认请求，不能据此认为本地未读位置可靠。此处调整本机视图定位，不更改真实消息正文或日记归档数据。

现有会话列表浮动控件为56×56 CSS像素透明点击区，图标26px，保留左右镜像、焦点与展开状态。会话设置头部与底部操作栏固定，中间参数独立滚动；保存／取消与错误／未保存提示留在外栏。没有改为自动保存。

设置→会话切换与排列保留默认direct（立即切换）、list（停顿预选），新增manual（Esc列表、↑／↓选择、Enter进入、不倒计时；再次Esc取消）。手动列表唤起焦点在当前会话，三种方式共用排列。

Win+V图片确认的初始／回激活焦点改为说明框，已有文字首次定位末尾，用户已经操作、选择按钮、移动光标或处于IME组词时不抢焦点。说明框与发送／取消后的主输入框分别验证，详见[焦点记录](2026-10-16-clipboard-chat-focus.md)。

冷启动只有末条占位但保存锚点尚未进入DOM时，先围绕锚点请求历史，实际列表就绪后才消费恢复记录；删除锚点、加载异常有有限等待兜底。显式引用／跳转和“到底部”动作取消旧发送跟随，避免跟随反向拉回目标。侧栏展开时顶部操作为56px透明入口留空间，保留原来的左右镜像位置。

补充底部路径：保存为底部但缓存还是历史中段时，先强制加载最新片段；底部恢复在应用留白后使用浏览器按真实几何夹到底部。单改首次恢复仍会在后续reflow回退16px，因此所有本机reflow的reserveDelta都改用与CSS一致的max(上游留白,自有footer留白)，普通非本机上游逻辑保留。该问题在原生隔离回归中暴露，失败快照保留native-ui-check-bottom-before.json、bottom-geometry.json与bottom-reflow.json，不把失败轮次算通过。

2026-10-17继续追踪：修改reserveDelta后仍有16px，因此没有把前述推断当最终结论。记录Element.scrollTop写入栈后确认offsetHeight=clientHeight=693，sentinel写入时实际padding=90px、scrollHeight=7250；之后footer留白变106px、scrollHeight=7266，但没有新的scrollTop写入。根因是切换期间暂停跟随，已应用的留白变更到显示完成时不再被识别为reserveChanged。已在room-view-ready对仍距底<48px的当前列表补一次布局后跟随，用户滚轮、触摸、显式导航会取消；中段不执行该校正。完整失败栈保留native-ui-check-bottom-writers.json。另保留一次显示屏夹具超时native-ui-check-display-timeout.json；正常退出重开后该检查继续通过，未绕过它。

该修订原生检查继续通过底部／显式跳转／过渡，但在最后的离开期间同时改24px字号及360DIP窄宽时仍偏移538px（native-ui-check-font-reflow.json）。因此继续修正首次恢复到显示之间的重排时序，而非扩大误差容忍值。该失败轮次不算完整通过。

后续源码保留初始快照和restoring至65ms静默后的最终measure→mutate，在显示前重算锚点，回写实际滚动偏移并清理旧内部锚点；中段用浮点位置，避免175%DPI下每次ceil累积偏移。显式导航作废保存位置恢复，最终执行前仍检查当前聚焦状态。首次启动没有切换时为0ms完成、不播放进入动画，原有有限等待兜底保留。

## 验证记录与边界

2026-10-17 U37–U39：首开ready派发shiye-startup-focus，普通激活回退当前输入并有限重试；主动选区、按钮、菜单、IME优先。普通原生回归首开未点输入就可Input.insertText追加既有草稿。DOM焦点27项通过，旧12项媒体焦点包含在内。悬停激活是默认关闭的DockActivateOnHover，鼠标经过只展开；开启才请求激活，收起动画中途反向同样遵守此选项。

标题栏左侧“拾页｜快捷写作 便签”，窄于440DIP时换固定14DIP图标和提示；右侧四个窗口操作不移动。WorkspaceLaunchers.cs只允许quick／notes，quick正式无参唤回既有状态，notes复用start-notes-preview.ps1与18770／mutex。启动期间禁用对应按钮，异步脚本失败／20秒超时给普通状态提示，未处理异常不弹窗；验收模式仅回报计划不启动真实程序。独立编译及12＋4项入口检查在outputs/2026-10-17-聊天工作区入口；超时／非0保护属于代码审查，未启动故障脚本演练。

新一轮原生385项＋10项图片检查通过（native-ui-check-before-launch-async.json），首开追加、悬停开关、0ms、标题栏入口和360DIP布局均覆盖。随后仅补异步启动处理及不含正文的焦点运行回执，最后候选再测；不能提前把该385项当成最终运行回执。header截图为workspace-header-wide.png／compact.png，已视觉检查。

2026-10-17 U36追加：收起延迟最小值由100ms降为0ms，最大3000、默认350不变，步进10。前端区分空字符串与数字0，原生接收／重启读取均允许0；不延长或跳过动画，不改变输入／菜单／看图暂停。新增50／20／0保存、0值重开、负／空／超限输入及首次离开检测立即开始的原生夹具。最终通过前仅为候选。

U36首轮已通过短延迟UI及0ms即时触发，但夹具自己改0后仍沿用旧350文件断言，保留native-ui-check-zero-delay-fixture.json；改为分别回读进入夹具前350和实际0收起后的磁盘0，最后恢复合成profile的350，不掩盖实际保存值。全库随后一次检查停在并行数据层两个review脚本未格式化（project-check-concurrent-format.log），没有格式化或覆盖对方文件；待稳定重试，不能将该次说成测试通过。

候选修订20261016-ui9，正式基线仍ui8；本轮隔离原生检查进行中，最终通过数与运行回执待补。原生测试只使用tmp中的合成profile，不修改真实草稿。

全库首轮npm run check为482项通过，包含其他会话0.9.24的改动，不把482都归为聊天新增。后续自有文件改动需继续通过语法／格式／lint。

2026-10-17最终代码轮npm run check为534项全部通过，包含并行会话新增模块，不能把新增52项归为聊天功能。前端目标ESLint、完整TypeScript及自有适配／原生夹具语法格式检查通过；日志分别为project-check-final.log、vendor-lint-final.log、vendor-types-final.log、final-source-check.log。

首轮停在窄窗取消图片后300ms的草稿断言，后续截图文字已恢复，保留native-ui-check-draft-timing.json并改为等待实际恢复结果，仍会对丢失超时报错。第二轮吸附夹具在模拟指针时仍读取真实鼠标按键，保存并行断言受同时操作干扰；仅隔离验证绕过物理按键门禁，正式策略保留，失败保留native-ui-check-mouse-fixture.json。一次候选误在measure阶段调用forceMeasure，被框架拦截；已按当前布局阶段读取，失败console保留runtime-console-phase-fixture.json，不算通过。

真实“朝花夕拾”会话不做修改性测试，使用含历史来信的同类合成会话及长消息列表验证；真实双屏仍待用户试用，不把合成往返等同硬件验收。

产物：outputs/2026-10-16-会话位置与过渡。候选在candidate，临时profile及媒体样本在tmp/telegram-preview-20261015，交付／校验脚本放tmp。其他会话继续维护需求、实现、验收与运行交接。

2026-10-17命名终验有一轮停在媒体取消按钮焦点（native-ui-check-other-window-activation.json，260项后失败）。同一时间维护动作激活了便签，可能干扰焦点；不将该轮算通过，已正常退出并在不操作其他窗口的条件下重跑。全库最新无界面流程549项中548通过／1桌面项跳过，桌面项另行串行1项通过，合计549覆盖；原先并行桌面焦点冲突日志保留project-check-native-focus-contention.log。U40使标题栏入口最终显示“思绪／便签”，原“快捷写作”文案属于命名前快照。

无其他窗口操作的重跑仍在同一取消按钮焦点处失败（native-ui-check-cancel-focus-repeated.json），因此排除“仅外部激活干扰”解释，交焦点子任务继续修正明确用户意图保护，不放宽断言。另由候选sourcemap定位mutation阶段读取scrollHeight到useShiyeInput.ts的focusEnd，非MessageList finalizer；stricterdom只记console.error、未抛异常，但引入多余layout。已换现有SCROLL_BOTTOM_SENTINEL，TypeScript／定向ESLint通过，需最终重建回归。

取消焦点的真实原因是WeakSet仅记录“交互过”，恢复时仍相信Teact迟到自动聚焦后的activeElement。已补同弹窗明确用户目标/有效选区WeakMap，持续接收新的指针/按键目标，Tab按实际落点、左右按实际目的按钮；组合输入和菜单仍优先，不靠定时器持续抢焦点。新增稳定旧码失败复现后35项DOM通过，最终原生回归进行中。候选开发模式console保留stricterdom对style/title等自有包装层直接DOM改动的阶段诊断；errors/runtimeErrors为空不等于全部console诊断为零，未关闭或过滤诊断来制造通过。

焦点修复后原生回归382＋10通过，最后字号/窄窗锚点偏移20.7142868px（native-ui-check-font-reflow-after-focus-fix.json），前三次位置恢复均0。记录显示保存的是上条538仅露1–4px的残片，而可读锚点为539/top11.2321；字号变更使前条高度变化后带偏正文。实现将顶部残片排除边界统一为4px，仅修正捕获哪条消息，不放宽原生误差断言；需候选重建复验。

## 最终隔离与正式运行回执（2026-10-17）

用户再次追问U34：已在实际ui9中提供手动列表，设置路径为“会话切换与排列→Esc切换方式→手动列表，方向键选择、Enter进入”。385项结果明确覆盖初始焦点当前会话、停顿不自动进入、方向键焦点移动、Enter进入、Esc取消保留原会话及模式持久化。保留用户此前确认的direct默认，不未经要求替用户修改当前偏好。

最终构建在修正媒体明确用户焦点意图及focusEnd阶段测量后，385项聊天＋10项独立看图全部通过，errors/runtimeErrors为空；35项DOM、入口12＋4项、完整TypeScript／定向ESLint／格式通过。全库npm run check（SHIYE_TEST_NO_DESKTOP=1）549项中548通过、桌面1项跳过；随后独立串行桌面1项通过，不把跳过当通过。原生正式OS剪贴板／Win+V／物理IME／真实多屏未完整人工验证。

标准desktop-control upgrade --no-start完成保存退出、程序与偏好备份、校验安装；思绪另保存原EXE/config快照后安装改名候选，再以标准start重开。实际随想PID49160、托盘PID76152、ready:true、ui9；API版本0.9.24与package.json一致且未重启。12215安装文件哈希匹配，108%字号与两屏档案保留。各程序标题见命名runtime-after.json，便签当前PID23268。程序、profile及正式日记保持原位。升级细节在upgrade-result.json、status-after.json、installed-file-verification.json，思绪程序快照在命名quick-installed.json。

用户体验仍需试用，尤其真实屏幕切换、Win+V面板和悬停激活；0ms代表不额外等待，受原生约40ms轮询与动画耗时影响，不承诺物理零延迟。现有主页未自动刷新：界面控制因不能可靠确认浏览器URL而停止，没有换工具绕过。
