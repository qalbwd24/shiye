# 朝花夕拾统一前端适配候选

## 最新运行回执

2026-10-17 U54/ui21已标准保存、备份、升级启用（2026-10-17T22:56:10.636Z核验；PID39944仅快照，API0.9.24与package一致）。菜单/确认统一撤回，永久无正文提示及2分钟内存重新编辑，关闭聊天原位直接编辑，恢复不覆盖草稿；图片恢复原件到待发附件，贴纸作为附件。朝花夕拾前端固定评论对象、草稿/附件保护、来源锁定清理和错误重试完成；正式接口状态404，后端/运行器未随本UI包部署。修复发送后再输入迟到补滚及自动增高残留底距，常驻尺寸观察只响应真实布局变化。649＋10原生、35浏览器、670隔离项目测试通过，完整npm check受并行Android格式警告阻断如实保留；12218安装SHA-256匹配。108%/868×1649/2屏档案保持；正式日记hash保持。备份2026-10-17T22-54-57-255Z-6d0493fd。产物outputs/2026-10-17-revisit-ui-adaptation，临时tmp/revisit-ui-adaptation。物理120FPS、长期CPU/内存及表情包明显上移仍未结案；操作前重新status。

下方各阶段候选、失败和等待记录保留为过程证据，以此最终回执为当前状态。

本轮由主会话规划核心接口，执行会话维护随想共享前端。所有修改均为源码及独立无头测试候选，未覆盖日常ui20、未操作用户已打开的朝花夕拾测试窗口或其profile。正式API是否具有朝花夕拾服务以主会话实时核对为准，不能因聊天候选出现入口就称后台已部署。

## 实现范围

- `shiye-revisit.js/css`：评论目标条从body固定定位移入当前可见middle-column-footer，在Composer之前占正常布局行；既有footer ResizeObserver计算完整预留，不修改ui20文字字号、输入高度、切房规则或默认快捷键。hidden/title等重复DOM写入被收敛。
- 保留每轮从0重新验证来源及每页worker持久回执；仅将包装层无条件`shiye-refresh-rooms`改成首次/群名/发送者元数据变化后触发。相同feed不再重载全部会话，worker有变更仍走现有Update消息链。
- `MessageText.tsx`与`shiyeMarkdown.ts`：仅朝花夕拾列表摘要且启用Markdown时，复用气泡的安全Markdown解释，再提取纯文本和折叠空白。普通会话与自定义emoji维持既有显示链；持久正文不变。
- 自动跟随保护读取当前可见footer中的编辑元素、实际compositionstart/end及结束后120ms保护，并保护已打开的附件/图片说明弹窗；不拦截任何按键。接收客户端另由主会话补目标选择竞态与IDB草稿检查。
- 设置参数有独立滚动区；保存/关闭位于独立动作区，保存通过form关联触发现有校验和配置revision提交。
- 主会话补只读来源弹窗的锁定失效、异步媒体关闭回收与切换整篇回收；本会话接onState失效调用，并将3处目标切换仅在select返回true时关闭弹窗。
- 提供撤回恢复窄端口`readCommentTarget(messageId)`与`selectCommentTarget(target)`，前者只读固定目标元数据，后者先验证字段再调用现client.select；精确occurrenceId当前明确拒绝恢复，不能丢弃目标。
- 评论同步失败在输入区单独role=status显示短错误及重试按钮，只在朝花夕拾可见；点击复用sync单飞入口，无新增timer。成功清除提示，保留错误期间的待发评论。

## 独立构建及资产边界

源快照：`tmp/revisit-ui-adaptation/build-root`。从既有`tmp/revisit-ui-preview/build-root`物理复制依赖，再覆盖当前产品源码及public，不在共享vendor运行prepare脚本。差异清单在`outputs/2026-10-17-revisit-ui-adaptation/snapshot-changes.json`：初次共239项，其中11项旧快照已有文件内容变化、228项旧快照没有的文件；不能把239项都称为代码变更，也不能将全量候选直接当作冻结ui20的发布资产。

首次Node同步复制无错误文本退出，改用robocopy成功。初轮Vite构建未完成；重试时发现复制普通Archive属性的97.8MB `public/build-stats.json`返回UNKNOWN copyfile。磁盘空余充足、文件不是符号链接，未改系统信任配置或删除未知文件。最终隔离`build-isolated.mjs`关闭copyPublicDir，关闭minify/sourcemap、限制RAYON线程，再按清单物理复制运行public资产、排除上述构建诊断文件，构建成功。此设置用于隔离联调，不代表正式性能构建。

## 验收记录

`tools/verify-revisit-ui.mjs`支持显式候选root、产物、临时目录；使用真实隔离日记后台及浏览器本地worker，不使用真实正文，不访问Telegram。测试库每次生成唯一UUID子目录，浏览器使用独立临时context。

第一轮18项通过：图文接收及原图解码、目标条正常布局、相同feed旧消息DOM身份保持、不全量刷新、纯文本摘要、评论整组写库而不生成日记、只读原文、媒体请求未完成时关闭不遗留URL、模拟401清理已开原文及URL、设置滚动与固定动作区、无前端异常、无外网请求。

后续增加360×800/64px及868×1649/240px手调高度重开回归。首轮这四项通过，但窗口变化后侧栏展开遮住只读链接，测试后续点击超时；已按产品既有侧栏事件收起后复跑，不改产品侧栏行为。再增409冲突时可见错误、未误记成功、按钮重试成功后清除提示三项；最终25项全部通过、Runtime异常0、外网请求0，见同目录`ui-validation.json`及`browser.log`。

根包装JS/tools专项lint、prettier检查通过。vendor两个显示文件专项lint零错误，有既有安全渲染dangerouslySetInnerHTML警告1条。完整项目check由主会话统筹，不将专项lint或构建成功等同全库通过。

真实物理中文IME、原生宿主、长时间推送、120Hz、正式升级及完整撤回恢复UI不在本会话的无头验收内。

产物：`outputs/2026-10-17-revisit-ui-adaptation`；临时快照、构建辅助脚本和合成数据：`tmp/revisit-ui-adaptation`。当前共享接收客户端/撤回组件可能继续由其他会话修改，最终构建与冻结发布需重新核对清单。

## 最终集成准备

最终压缩候选另输出`candidate-final/app`，构建日志、根资产盘点及程序hash清单放旁边`final-artifacts`，保留上述25项候选证据。共享UI版本标记已升`20261017-ui21`，仅源码/候选准备，不表示日常ui20已更新。

已核对安装ui20的UPSTREAM：`tmp/instant-message/window/release-v2-source`的7份wrapper C#及DesktopPaths匹配安装清单；SharedInputMode匹配前轮验收helper精确hash（安装清单未记录生成helper）。早期frozen-source的DesktopPreview/EdgeDock不匹配ui20，未选用。新原生来源放`tmp/revisit-ui-adaptation/native-final-source`，严格断言当前ChatJournalBridge相对已验桥仅9条固定revisit action case；其余宿主冻结，未混入共享目录正在修改的边框代码。来源回执`native-final-source-receipt.json`。

安装程序根无EXE.config及runtimes目录；最终脚本复制3个DLL及WebView2/Telegram许可证，若源后续存在config/runtimes则完整保留，诊断产物不混入程序hash。`prepare-final.mjs`严格核对chat-ui相对安装版仅增加reserveChanged条件，按明确清单同步本轮前端和并行撤回源；`build-final.ps1`使用RAYON=2、heap4096及Vite默认压缩，单独编译冻结宿主＋固定桥。`write-final-manifest.mjs`按真实来源生成ui21 UPSTREAM，避免标准脚本误取共享边框源码。

撤回会话最终12份vendor源冻结后已按白名单纳入，总计19份前端精确overlay。首轮压缩出现Rust内存分配失败，日志保留`final-artifacts/build-memory-first.log`；相同参数重试成功（默认压缩、sourcemap开启），未降低压缩/关闭诊断图，未停止他人进程或调整系统分页。首次manifest把旧UPSTREAM历史生成chunk误当源码，已限定真实快照源清单，程序文件另全量记录。最终程序12218文件，清单`final-artifacts/program-files.json`，EXE SHA256 `aa2d0496d237ba23301103b5c41d0b16b35d5733f12b8e3743064cafb7d95420`。尚未正式安装，原生隔离由指定会话后续验收。

## 最终压缩候选的浏览器回执

已纳入撤回SCSS排序版、恢复端模态子dialog保护及接收端相同保护，重新完成默认压缩构建和冻结宿主编译。最终程序清单SHA256 `491fcc26e9b6a139c1e75f4bafe01ad949da228e91d867369122391bd53a6207`，最终EXE SHA256 `a8c71245823801033980da3a5963866eee5821dfd496ca0b0b0e6f974bcf293b`（235008bytes），native-output及程序清单一致。前述AA2D是首次编译历史值，重编译后已变更；消息中曾误称hash不变，已实时纠正并通知原生验证方按最终清单核对。

2026-10-17T22:27:09Z，最终独立Hidden runner退出0，**33项全部通过，Runtime异常0、外部网络0**。`final-artifacts/browser-final/exit-status.json`、`ui-validation.json`及`stdout.log`保留完整终局，不能使用较早截止log代替。原有25项适配检查再次通过，新增实际消息菜单→撤回确认→墓碑/两分钟重新编辑、后台评论清空正文、恢复原固定目标草稿、新operation重发、重开墓碑且不持久化恢复正文、PNG发送/撤回后mediaLoader读取原件并恢复File到待发窗；另有新来信出现时图片待发窗及评论目标保持。

媒体分支曾有测试定位问题：旧seed10会话并非有效本地新会话，改为真实worker创建隔离session；外层`.shiye-attachment-modal`本身没有rect，子`.modal-dialog`实际可见，早期等待外层误报hidden。最小独立媒体测试用实际截图确认PNG及附件窗已成功打开，也发现接收端/恢复端原先按外层rect判断会漏保护。两处已兼容可见子dialog，主会话额外13项恢复保护定向测试通过，最终33项里实际推入第二组后台来信，确认附件窗未被抢目标/清空。

早期工具session曾无终局回执消失，未记成功；最后使用`run-final-browser.ps1`以Hidden Start-Process启动独立Node进程，完整写exitCode与日志。实际原生标准/手动验证已在成功后交指定会话执行，未在本会话操纵原生GUI或替换正式运行。

## 确认文案与原生尾部定位接续

主会话最终审阅补本地撤回确认文案：DeleteMessageModal的本地非调度/非反应分支标题和确认按钮均为“撤回消息”，说明为“正文将移除，并保留撤回提示；2分钟内可重新编辑。”；不改变真实Telegram等其他分支。按新增第13份vendor文件冻结后重建，总20份精确前端overlay；对应程序清单D326D0CC开头、EXE A2A2D2E5开头，前一轮491FCC/A8C证据已保存在pre-confirmation-copy。新浏览器严格文案检查初轮错误查不存在的.modal-title而失败，截图和innerText确认产品文案正确；测试已改精确heading及确认按钮，等待后续核心候选复跑，不将这一轮写成通过。

原生随后严格断言发现普通输入框自动增高时列表尾部gap8，由主会话修核心。本会话只读浏览器复现：1120×800新本地session、100行历史，Home/空/一行gap0且reserve/footer56；三行scrollTop1799、scrollHeight2607、clientHeight800、gap8，reserve157/footer156.7656；30/40行scrollTop1866、scrollHeight2674、gap8，reserve/footer224。含评论目标条的朝花夕拾同序列gap0，说明先前33项目标条场景未覆盖普通footer的这一严格边界。证据composer-trace-normal-precore.log及同名子目录JSON；D326候选来源另存pre-tail-geometry-copy。主会话正在处理预留测量/提交时序，未声称原生或最终上线已完成。

## 最终核心修复与35项验收

主会话尝试mutate后重测reserve、瞬时发送observer改border-box，本会话均仅通过route overlay验证、未修改候选；两者仍重现gap8，试验源及composer-trace-core-overlay/border-box系列日志保留。常驻共享sizeObserver观察messages-container border-box并仅在真实内容尺寸变化时标记contentChanged后，同序列gap0；原先普通输入仅footer reserve变更触发，遗漏上游padding随后多出的8px。最终core SHA256 `fbab06d0b2a7e2e5ccc08afa2e8fa1fcb65b8ec8ed0e6bbdd90f1829140d2053`。

最终prepare不再使用早期“一行reserveChanged”的断言；现在固定上述批准core hash，并由安装ui20源码8段唯一精确replace生成期望，再逆向逐段还原精确ui20双校验。仅新增messageContent/contentSizeChanged、共享ResizeObserver对内容border-box的绑定/标记、更新时捕获contentChanged、瞬发及pinned跟随依据实际reserve或content变化；无新rAF、无逐帧扫描或常驻timer。

2026-10-17T22:38:51Z，最终压缩候选**35项全部通过，Runtime0、外网0、runner退出0**，在原33项上严格验证文字/图片两次撤回确认精确heading、说明和按钮。回执位于`final-artifacts/browser-core-final`；旧33项与定位失败记录保留。包内（不使用route overlay）普通session的Home/空/一行/三行/30/40全gap0，短输入1秒jump0，记录`composer-trace-packaged-final.log`及同名子目录JSON。

最新候选仍`candidate-final`、程序12218文件，最终清单SHA256 `6210880784746357a2a547655571955359cd95965ac7e468b3aa4a3bb68a651b`，EXE SHA256 `8c205839670b6bf349b5ce04031ea85cfae4ded0b973241ee331c07d324b777c`。已通知原生会话按最新manifest重新核对/复制，继续标准原生及手动验证。旧A8C/A2A/D326等均为前轮证据，不能用于最终安装校验。本会话没有正式部署。
