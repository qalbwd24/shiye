# Android QQ018：电脑既有坑的定向 UX 回归矩阵

2026-10-18T10:04Z源码只读审计。用户要求模拟器多检查，参考电脑多轮优化避免重犯；本轮只新增本文，不修改产品、设备或共享入口。主会话负责AVD和最终正常/QA构建；手机与主AVD正常包在任务开始时仍016/code18，本轮未独立查询/改变前台或版本。正在构建的候选不能据源码检查写成已安装通过。

遵循[TESTING-POLICY](TESTING-POLICY.md)：先定位同类原因，仅测受影响路径与相邻模式。电脑U50–U55的数百项旧断言不跨平台搬成Android验收；Android已有同hash证据可复用，不重复全套。动画/滚动看实际画面与有时间戳的几何轨迹，不用rAF频率或DOM透明度代理声称物理120FPS。

## 审计基线与已有证据

已读[最新交接](DEVELOPMENT-HANDOFF.md)、[018确认范围](ANDROID-QQ-018-REBUILD.md)、电脑[U50动效](validation/2026-10-17-motion-refinement.md)、[U51即时/身份](validation/2026-10-17-instant-message.md)、[U52切房/输入](validation/2026-10-17-room-switch-fix.md)、[U53间距](validation/2026-10-17-composer-spacing.md)、[U54撤回/迟到补滚](validation/2026-10-17-withdrawal-ui.md)、[U55停稳](validation/2026-10-17-send-settle.md)，以及[侧栏/返回与焦点](validation/2026-10-17-sidebar-toggle.md)。对应文档早期失败不覆盖其顶部最终回执。

本轮018明确要求默认白色、淡蓝可选，隐藏头像/用户名与逐条时间戳；时间原值继续保存、必要时居中分组。因此不把“无逐条metadata”或“发送文本按钮而非原小飞机”错误列为回归。仍需保留字号/气泡/透明度等现有偏好及真实消息/草稿/原件。

读取到的现存证据（不是本审计新执行）：

- `outputs/2026-10-18-android-qq-018/renderer/receipt.json`：55项真实Chromium320×700、父根20.8px和敌意CSS/capture，synthetic source；view.js/css hash与下表匹配。不能替代Android IME/实际worker。
- `source/verification.json`：20项source mock，含真实持久草稿投影和240条分页合成资料，不能冒称真机全链。
- `android-matrix.json`：23条实际Android合成QA记录，含frame隔离/真实worker文字ACK、组合输入、草稿引用/快速切房、触摸滑动/长按/墓碑、图片GIF文件原件ACK与字节一致、表情直接发送。它没有覆盖下面所有连发/晚窗/换ID/阅读锚点场景；最终是否绑定最新候选由主会话核验。
- `panels/browser-report.json`旧20项、`panels/import-naming/browser-report.json`新增7项使用真实共享名称备注表单但Source/store替身；后一JS hash为下表。导入命名改动只补直接回归，不声称旧20整套在新hash上全部重跑。

| 源码 | 本次审计SHA-256 |
| --- | --- |
| android/qq-chat/view.js | ef8fe67d66759c06b6b0be8859874926018ed1a62d63ce857b15a23c33fa8946 |
| android/qq-chat/view.css | 6e7624894212697d718cd443c9f151445b5a6d6f474538e6bcad45e6aa108f51 |
| android/qq-chat/install.js | bd5c44a144e1593af45b4e2c9d1a6fadce38847cf67eee264dc4ef6dbca395b6 |
| android/qq-chat/legacy-source.js | 94a044128358e0b6fc9d7bed973a4d1c300fe08b905638300a9b7d62d60cba34 |
| android/qq-chat/panels.js | b34671d2f966fafaa8cf5dcb19aac4671a01545c3e1599e7fb6f934c65adc13a |

源码在主会话优化后变化时，本表是审计快照，需按实际改动重新判断风险，不把本文当后续新代码仍有同一故障的证明。以下行号仅便于定位，以函数名和hash为准。

## 回归矩阵

“已防”指有明确源码门禁；“风险”指存在同类路径但本轮未复现，不等于已确认故障；“待接”不能用合成外观冒充正式业务支持。

| 电脑已有坑/原因 | Android018受影响路径 | 当前已防住 / 具体仍缺 | 最小真测方法与判定 |
| --- | --- | --- | --- |
| U50/U51同组追加重挂、确认改ID使旧根换掉，后继尾消息未揭示 | source.normalize传previousLocalId；view.setSnapshot按String(m.id)维护rows/separators；source按date/ID排序 | **风险**：source保留previousLocalId且分页首锚支持别名，但renderer未见别名复用row。确认换ID会落入新建row/移除旧row，不具备电脑已验的稳定根桥 | 仅在隔离QA做1次同秒三连发，记录每条临时/最终ID、previousLocalId、DOM节点身份和最终顺序；在确认前后留实际帧。纯ACK替换不应被当作新增消息滚动。若当前实际owner不会走临时换ID，明确记录该前提，而不是制造已测假样本 |
| U55固定600ms收缩锁释放后约630ms迟到8px上弹 | view.sendText→refresh/restore，footer ResizeObserver，grow；独立frame无旧TL收缩锁 | **已防结构**：新列表不继承TL composer的600ms锁/100vh预留。**待测**：新grow/RO/键盘仍可产生其他迟到布局，不能由“无旧锁”推断晚窗0 | 满屏多行发送一次，最后操作+350ms到+2000ms观测新消息/上一条Y及footer顶；晚窗无无因二次上弹。截图需包含整个输入区，不只裁气泡 |
| U54发送后再输入触发迟到补滚，把阅读位置拉回末尾 | view.sendText成功await后约733行无条件following=true；afterExternalSend也设true | **风险**：本地ACK有延迟时，用户已上滑的following会被覆盖；读取来源更新前有remember/restore但不能挡住此处强制跟随 | 单次延迟ACK，在等ACK期间上滑到固定文本行并继续输入几个字；ACK后保持阅读锚点和新输入。另一次只在底部等ACK应正常贴底。测这两种，不扩全部动画模式 |
| U51确认后再发新消息尾被遮挡，旧尾标记仍被消费 | qq-shell grid末行auto、qq-list minmax，restore取scrollHeight | **已防结构**：footer与列表分属grid，不靠旧TL bottomReserve/末尾class桥。**待测**：真实IME/引用/异步图片解码后高度变化是否晚到 | 同一满屏房：带引用发一条多行，再接短条；在键盘开/关各看末条底部≤list底、末条至footer无重叠。没有必要搬电脑固定26px空白作为Android标准 |
| U52软折临界高度/宽度互相反馈，静置约0.45秒54次跳变 | grow每次height=auto→scrollHeight，max128；textarea overflow-y:auto；footer RO先restore后grow | **风险**：未见独立测量clone、滚动条gutter或滞回；独立textarea较简单，但仍有软折/滚动条宽度临界。不能沿用旧短文本通过消除风险 | 320dp、实际13与放大字号，70/80字符或真实能跨一行的临界串，插入/删除最后1字后静置1秒，记录input/footer高度和list锚点；稳定后无来回切换。仅测临界点，不扫全字体矩阵 |
| U51/U53 placeholder过渡重影、输入手调值被自动高区覆盖、选到隐藏旧footer | 新view iframe独立textarea原生placeholder；grow单一输入；install隐藏旧MiddleColumn并inert | **已防结构**：没有Tiptap双placeholder、旧footer querySelector或手调高区class。**边界**：新UI本身不提供旧桌面手动高度功能，不能称全部桌面功能移植 | 复用现有frame隔离证据；只在最终AVD看空→多行→发送后三阶段placeholder不重影、工具栏不遮文字，旧编辑器不可获焦。若用户要求手调高度，应另记需求，不临时套旧存储值 |
| U52/U54迟到草稿/确认覆盖新输入、旧房草稿写错房 | view draftRevision/roomGeneration、roomDrafts/context scope；source串行draftIntents/requireCurrent；ACK只清相同文本+revision | **已防**：输入期间保存、同房新revision保护、切房旧ACK门禁、附件发送恢复最新未发草稿。**待测**：Android IME composition与实际重开持久边界，source mock不能替代 | 在一次已有真实ACK场景追加“发送等待时继续输入新句”，确认新句不清；中文组词按Enter不发、compositionend不多发；返回/重新进入核文字+reply各归原房。现有组合/切房检查可按同hash复用，新增只测迟ACK组合 |
| 快速三连发同秒/跨秒乱序或误丢按键 | view sending禁重复、source单attempt/sendTask与committedLibrary+flush确认 | **已防**：不并行发重复事务、超时uncertain锁不盲重试。**体验边界**：ACK前再次点发送被禁用，不是可连续排队三条；新增输入会保留，但不能宣称三连发排队已实现 | 正常低延迟真实连续三条，含一次自动多行：最终恰好3条且顺序/正文一致；另只观察一次慢ACK下第二次点击不双发且文本仍在。不要用人为连续调用已禁用按钮包装成用户连发体验 |
| U52阅读锚点在改字号/间距/缩窗及A→B→A漂移上千像素 | remember记录首可见data-qq-key及offset；same-room restore，loadOlder前设following=false；切房清rows/bookmark并following=true | **已防**：同房刷新/扩展内容保留首可见锚，source分页anchor支持previousLocalId。**缺口**：renderer未见每房scroll bookmark缓存；A→B→A目前会回底，不应写每房阅读恢复已迁移 | A房中部定一行，改字号一次、加载更早一次，各核同一行相对list顶误差；再A→B→A明确记录是否回原阅读处。若产品明确要求回原处，这一条是待实现，不用放宽阈值掩盖 |
| U52切房旧节点未attach/等待旧动画完成导致白屏、延迟可见 | install独立同源iframe；view.ready+styleReady后显示，roomGeneration丢旧任务，切房清列表重建 | **已防结构**：无TL中栏transform/550ms旧complete等待；加载失败有返回提示。**待测**：首次frame/CSS异步初始化和快速ABA的实际首帧、旧房媒体晚返回 | 冷首次打开＋一次40ms快速A→B→A，拍真实画面/读取房名与消息ID，确认没有错房闪现或长空白；不把宽桌面Chromium时序替代320dp WebView。已有快速切房草稿证据只证明草稿，不证明绘制无白屏 |
| 侧栏/弹窗Esc与焦点争用，返回只应回当前层，设置失败不丢表单 | install.back先让父全局dialog处理，再panels.back/view.back；view菜单/引用/设置回调；panels自有external/manager/dialog层 | **已防**：文本点击无动作、媒体点击单独处理；panel back先共享命名再管理/图库；退出存草稿、切房关面板。**边界**：设置仍是既有父/native页，不是view自己拥有的form；按钮调saveDraftNow后未await设置导航，需实测存储生命周期 | 一条最短链：聊天草稿→会话设置子页改值但未保存→返回父页→返回聊天，核目标/输入/滚动与焦点；再单张导入命名取消返回图库。未改设置页证据可复用，但新frame跨上下文返回必须真测 |
| 范围条把纵向滚动当拖动，滑动一次悄改设置 | QQ独立frame无range；现有android-qq-gestures在父document且仅settings='.shiye-android-dialog[open]'、dataset皮肤qq时生效 | **已防局部**：旧Web设置range有方向锁/触摸取消守卫；独立frame不吞父设置事件。**不可泛化**：原生SeekBar与不在该selector的设置未被JS守卫覆盖 | 从018实际会话设置进入一个真滑条，垂直滑过控件前后值一致、横向明确拖动才改；取消/返回保留应有语义。分别标明native或Web，不把Web单例断言写成全体设置已防 |
| U54附件浮层外壳无矩形但子窗可见，导致恢复覆盖待发附件 | 新panels独立shadow dialog；files原生input同步click、选完grid；source.sendFiles空caption、reply快照 | **已防**：不靠旧TeleDOM外壳矩形，发送原件ACK后才onSent，关闭回收URL，迟到结果不操作新房。**待测**：真实AndroidPicker取消、选文件与旧待发/草稿交互 | 复用已有真实原件ACK/草稿字节证据；只补实际图库打开→取消→选1图→确认发送，核草稿仍在且不重复弹旧预览。不要重新把缩略图当原件发送 |
| 图片/GIF预览撑屏、确认时换缩略图丢原件/动图 | view媒体限制200×150与异步getMedia；panels.preview/materialize及原件File；原件export Blob | **已防**：视觉上限与原件管线分离、video不自动播；原件读取有room/signature/isConnected门禁。**边界**：新view未见按已知收藏hash区分“10字号表情”与普通图片的标记，不能只沿旧CSS宣称同规则已迁移 | 复用图片/GIF/文件字节一致证据；最终只看一个竖GIF表情+一个横普通图，确认比例、当前字号下上限和点开原件正确；若用户仍要求10字号，需明确新view实现/接缝，不能误缩所有普通图片 |
| U54撤回提示/原位置永久留，恢复不覆盖草稿；来源只读不可撤 | source墓碑覆盖stale bodies、view withdrawn无正文、菜单outgoing&&!readOnly&&!pending才撤回 | **已防**：真实墓碑和只读禁撤已有源码与QA。**待接/差异**：新QQ菜单未见电脑2分钟“重新编辑”恢复缓存，不得承诺已移植；引用到撤回对象只显示固定撤回提示 | 复用实际撤回持久记录；只查同一ID位置提示、引用预览不泄旧文、重开不复活。若要恢复重新编辑，另开明确需求/实现，不把普通输入回填当已提供 |
| 朝花夕拾来信、本人评论、系统日期提示、来源/引用被一概按普通聊天处理 | source仅kind text/image/video/file/withdrawn，readOnly由shiyeProgram/action；view只有outgoing两侧、分组时间与普通reply | **待接**：未见deliveryId/batchId/SourceRef/occurrence/服务流映射或完整系统action呈现；017后端候选也未切018生产权威。不能把示例“过去的我”或入向气泡称正式服务收件 | 现在只用3个合成显示样本区分本人/只读历史占位/系统提示，检查菜单无危险操作，并明确是占位验证；业务验收必须等真feed/来源/固定单条评论接线，再测新来信不改变已排队目标。不要把普通TL replyTo数值等同回看delivery身份 |

## 本轮优先给主会话的三个代码风险

1. `view.sendText`/`afterExternalSend` ACK后无条件`following=true`：先测慢ACK期间用户上滑，避免U54同类迟到补滚。
2. `view.setSnapshot`只按最终ID重建，未使用source已有`previousLocalId`：确认换ID三连发可能重挂/换序，先看实际owner是否触发此形态。
3. `grow`无独立宽度测量/滞回且与footer RO耦合：先测软折临界静置轨迹；这是风险，不是本轮已复现抖动。

已在只读核查阶段把这三项发给主会话。根会话若随后修复，须按新hash补对应最小定向复验，不能继续引用旧风险为现存故障。

## 建议最小本轮真测次序

先核前台到底是独立QA018还是正常016，记录包名/版本/加载模块hash，避免在016上测018。保留手机给用户，本轮优先专属QA/AVD与合成房。

1. 一个满屏房，自动多行三连发；采最后操作+350..2000ms晚窗的前一条/新三条Y与末尾可见性，同时观察ID确认过程。
2. 一次慢ACK：等候中上滑阅读并输入新句，ACK后锚点/草稿不被抢；回底部再发一次确认正常跟随。
3. 一个临界软折串增删1字，键盘开着静置1秒；接快速A→B→A，复用既有IME保护只补焦点/画面与阅读位置。
4. 一个实际设置滑条纵滚/横拖及子页返回；一个真实图库取消/单图发送。名称备注取消/保存已有7项同hash浏览器证据，除跨frame返回被改动外不重复全部。

每发现失败，先保存真实屏幕与几何/身份记录，再缩小因果复验；不自动扩大到所有字体/浏览器/原生数百断言。测试结束关闭自有浏览器/服务/QA，不杀用户或其他会话进程。源码审计、mock通过、实际Android行为、安装/用户体验四种状态分别记录。

## 根会话后续处理（保留上方审计基线）

本次审计指出的前三项已在候选修复：ACK后不强制following；previousLocalId复用row和分组时间节点并迁移阅读锚点；textarea按文本/宽度/字号/行高缓存测量、包含边框、先测高再恢复滚动。增加每会话当前投影内阅读锚点缓存（内存最多50房）；超出分页范围安全回到底部，未实现远端历史定位。源码hash以后续最终stage/验收为准，上表是修复前审计快照。

定向结果：Chrome UX16项通过，Android实际三连发350–1750ms无回弹及冷启/原件等9项通过；详见018验收及outputs目录。收藏分类/撤回重新编辑/朝花完整绑定及产品权威迁移仍未在018实现，不能因换皮宣称齐全。物理120Hz与长期负载仍保留未验证边界。
