# 2026-10-19 再次卡住：恢复、退出残留与提示文字

2026-10-19 ui38已正常保存/备份/标准升级启动（2026-10-19T07:52:33.7439447Z，聊天PID16628仅快照），API0.9.26未重启。本次ui37卡住已先保全57/58份草稿存储及751KB宿主转储后恢复；独立Chrome明确e0000008，随想renderer仍存/无新Crashpad，初始冻结原因未结案。修复已关闭窗口后的宿主残留：真实本地ACK/明确恢复关闭/严格空初始化许可分开，实际FormClosed后一次5秒后台退出尝试；可见未保存页/无ACK/隐藏不触发，不承诺服务端上传完成。保存阶段/退出许可日志有界，故障不被普通日志预算挤掉。提示文字左偏18px确认为新36紧凑档隐藏按钮仍留宽，CSS修后36/128两场景左右差均0。24真实普通Main断言＋新EXE1微型原件＋2输入对齐场景通过；11915安装SHA复用标准apply逐目标核验，根复核5变化/宿主/journal边界，不重复全套。772×1550/116%/2屏保持，原profile/正式数据位置保持。备份2026-10-19T07-51-04-526Z-80323fa3；产物outputs/2026-10-19-chat-freeze-repeat、临时tmp/chat-freeze-repeat。

## 故障现场与恢复

用户在独立Chrome报错后反馈随想不可操作、关不掉。原host58012创建07:23:50Z为ui37；renderer57404仍在，没有新的WebView Crashpad。Windows Application Error07:24:35Z明确AppName=chrome.exe、AppPath=C:/Program Files/Google/Chrome/Application/chrome.exe、ExceptionCode=e0000008，不能据此说随想本次也因OOM退出。初始runtime回执旧ready/savePending不是实时健康证据。

先保全所选57文件97228801字节无错。正常stop未完成，随后可见窗消失，07:29:15Z ready=false/form窗口设置已更新但宿主仍活；线程短采样无CPU增长，WM_NULL两个窗口线程仍可响应，不能证明具体栈/页面正常或永久UI死锁。751060字节host MiniDumpNormal保全在host-dumps-private（SHAa9769051b0f559101e595ba653657c29401a55d9d9dc9ee12843d733ce6d3551），没有抓renderer全heap/输出正文/上传；无现成可靠栈展开工具，未下载/提权。

再保全58文件98380050字节无错，核PID/路径/创建时间后结束残留host58012。托盘36252由标准stop退出，标准start恢复旧ui37新chat73672；实际点击贴边条后正文与输入框正常显示，API86988/0.9.26保持。没有直接改正式diary.json、清profile或声称未落盘输入全部恢复。此次临时恢复和后续ui38安装是分开的回执。

## 原生最小修复

明确HostExitDisposition：LocalSaveAck仅真实本机保存ACK且代际未变；ExplicitRecoveryClose来自用户明确选择关闭；NeverReadyInitialClose仅从未ready、初始化中且从未开始任何页面导航（Navigate前和NavigationStarting永久锁存），不把有可编辑文档但版本握手未完当空壳。单纯exiting=true不是ACK；曾ready后未就绪保持恢复区，不能静默保存成功。

仅exiting且许可非None、真实FormClosed后一次Interlocked arm。顺序为设置/状态写尝试→arm→原有Dispose；后台只捕获日志path、pid、许可、修订，不访问Form/WebView或Join。5秒后若进程仍活，独立日志最多等150ms后尝试Environment.Exit(0)，stage=shutdown-timeout/forced=true。正常自然退出不产生timeout记录；这不是5秒OS硬保证，也不是对可见卡住页自动强杀/无限重载。hide-ready只保证本机IDB flush，不保证journal HTTP/上传均结束。

保存开始日志在任何可能同步阻塞的COM派发之前，saveRequested与实际savePending分开，保存完成先核代际。新增lifecyclePhase/exitDisposition/everReady/navigationStarted/formClosed等无正文状态；普通成功日志单独8次，关键故障32次及form-closed例外，整体仍256KiB。没有持续高频心跳。恢复文案不无条件归因内存，明确OOM仍由具体description说明。

该补丁解决已证实的‘窗口已关而进程残留’边界，并改善诊断；没有复现或定位本次最初页面冻结的全部原因，不能宣称卡死根因已根治。同步COM/页面无响应及全机commit95%仍是后续分段定位范围。

## 新验证与旧证据边界

旧NativeLifecycleSmoke反射构造窗口并using，绕过正式Main，关闭仅断言Disposed/不可见；因此旧结果不能证明真实宿主PID退出。本轮普通Main小合成页直接启动原始Main mutex/events/poll/Application.Run，再同独立根--exit，外层对原host PID WaitForExit及ExitCode。

24断言四组：ui37 baseline563ms自然退出；候选691ms自然退出，两者无timeout；无ACK完整15534ms仍活、recoveryRequired=true/savePending=false/disposition=None/formClosed=false且重复Exit不绕过；只在测试副本FormClosed后注入前台线程残留，候选5449ms原host整体Exit0且唯一forced=true/LocalSaveAck记录。第一次fixture缺config/app.json失败已保留normal-main-attempt1.json，补fake config端口9、页面无HTTP请求，不接正式API；非产品失败。

normal-main-source-binding.json逐份还原核对：baseline/candidate/noack仅测试Development=false、唯一EventName前缀和合成标题；residual另仅前台线程注入，Main未绕过。其余C#冻结来源相同，不注册默认/全局热键。生产source SHA8b90821d305ac553d3273257c94e1eb2184d1d995df8f27040d5c8445e8b6c4a，EXE SHA862364e8dc9d42e0fdafcfb90772a9037ad843819d19ff2aeab40d808f91a8f1；Astra只读最终审查无新安全阻断，见native-recovery-audit.md。

新EXE另1项实际16×16原件打开/原始尺寸/关闭烟测通过，native-image-validation.json绑定同EXE，不按旧EXE冒称复用。没有重跑旧15原生、全聊天、全库、Android、大媒体或OOM矩阵。

## 提示文字回归

用户确认左边多一截缩进。narrow440隔离实际ui37：36紧凑档空editor/placeholder左48，开始输入后左30，差18px；128高框原本差0。不是字号或文字内容问题：新紧凑档36px按钮宽覆盖了旧的hidden-record宽0，空按钮隐藏但容器仍预留36px并居中，使整个输入起点偏18。

仅对tight compact且record按钮隐藏的同高特异性规则将main-button宽/gap恢复0，保留36高度/按钮及旧48+。候选36和128空框提示/真实输入左均30、差0，placeholder-candidate.json及截图placeholder-aligned.png；语法外只CSS局部Prettier检查通过。未把普通即时亮度闪感写成已根治，此轮未重复ui37十四项动效矩阵。

## 部署与保留

从ui37冻结包仅5路径变化：EXE、shiye-preview.css、preview修订、index cache、UPSTREAM。journal、worker、其余UI/媒体和API不变。候选11915项manifest继承未改冻结资产，变化路径重新SHA；标准CLI实际逐个验证候选/所有目标，复制后复核目标，再complete。根比较全部密封manifest并只额外读变化路径/宿主/journal边界，避免重复整包读取；installed-verification.json绑定installer和release manifest SHA。候选proof部署前deployed:false不代表最终未装。

常规升级再次正常保存退出/备份并启动ui38；备份D:\拾页\outputs\desktop-maintenance\backups\2026-10-19T07-51-04-526Z-80323fa3。运行ready=true/recoveryRequired=false/savePending=false，health0.9.26；API86988及原创建时间保持，未重启API。窗口全字段等于最新正常保存退出快照，772×1550/116%/2屏保持。原数据/profile位置保持可正常写入，没有此轮整库不变的hash承诺（用户保存与自动游标可变化）。

产物D:/拾页/outputs/2026-10-19-chat-freeze-repeat，临时D:/拾页/tmp/chat-freeze-repeat。主机dump/profile恢复副本只在本机私有目录，不上传；未以临时恢复、Exit兜底或重启内存回落宣称初始卡顿/长期内存已解决。
