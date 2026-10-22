# ui37 再次卡住、Chrome错误与退出残留

用户反馈Chrome错误后随想窗口仍在、无法关闭或使用，记不清错误内容。本轮先保全现场，恢复正常使用，再按已证实边界实施最小修复。产物outputs/2026-10-19-chat-freeze-repeat，临时tmp/chat-freeze-repeat；root负责核心与恢复，astra中审计，6.1-sol中执行定向修复。

## 当前事实与恢复

故障宿主58012/创建07:23:50Z为已安装ui37。渲染57404仍存在，无新WebView Crashpad；初始ready回执陈旧且savePending=true，不能据此证明实时健康。系统Application Error于07:24:35Z记录的是独立Google Chrome chrome.exe（C:/Program Files/Google/Chrome/Application/chrome.exe），异常e0000008，不能说这是随想WebView崩溃。

57个所选草稿/配置约97.2MB无错保全后，正常维护stop未完成。随后可见随想窗口消失，ready=false/recoveryRequired=false/savePending=false及window.json均在07:29:15Z更新，但宿主仍活，正常退出未释放进程。39→38线程等待，2秒CPU无增长；WM_NULL有界探测两个窗口线程仍响应，不能归因忙循环或UI线程永久不泵消息，也不能据此证明页面正常。宿主751060字节MiniDumpNormal仅存private，不取renderer全堆/不上传/不打印任意字符串；无现成栈调试器，未得到可靠完整栈。具体等待点未定位。

再保全58个文件约98.4MB无错误，核对PID/路径/创建时间后结束残留宿主58012；托盘由标准维护stop正常退出，未直接写日记或清profile。标准start重开同ui37，聊天73672/托盘85004（仅快照），07:33:17Z ready/recovery=false/savePending=false。已实际点击贴边条展开并看到正文/输入框；API86988/0.9.26保持，没有重启。恢复不是根因修复，尚未落盘输入仍无法保证。

## 证实的验证缺口

旧NativeLifecycleSmoke自行反射构造窗口并using，绕过正式Main的mutex/events/poll。关闭断言为IsDisposed或不可见，不证明真实宿主PID退出。本次即暴露‘窗口已关闭但宿主仍存活’边界。完整10秒保存期限也不能在UI线程同步COM入口阻塞时单独救活同线程按钮，本次没有证明该阻塞实际发生。

## 本轮最小修复设计（候选，尚未安装）

只在收到本机保存ACK或用户明确接受未保存风险关闭、且FormClosed已发生时，为退出清理设置一次性5秒后台兜底。初始化从未就绪退出另列原因，不把exiting=true等同已保存；曾就绪后导航未就绪不得静默当保存成功。隐藏、无ACK保存失败、可见页面卡住均不得触发兜底；不自动杀未保存可见页，不自动循环重载。

先完成现有同步本地设置/状态写尝试，再在可能阻塞的Dispose前启动；后台只使用不可变快照，不调用控件/WebView。正常进程先结束则不触发；残留则限时记录shutdown-timeout/forced=true再尝试Environment.Exit。5秒为开始退出尝试，不承诺操作系统硬期限。日志不得无限等待阻止退出，正常与兜底须分别回执。本机hide-ready仅IDB flush，不等于后台HTTP归篇/上传全部完成。

记录保存起止、FormClosed与正式Main退出阶段，保持日志限额且不含正文。恢复文案不无条件归因内存；只有明确OOM原因才显示具体内存错误。

## 最小验收

独立fake-root/最小合成页/profile/隔离事件名，直接走普通Main的真实mutex/poll入口；外层观察原宿主PID WaitForExit/ExitCode。正常ACK须自然退出且无forced记录；无ACK至少完整10秒保存期限＋5秒不退出/不arm，并保留可恢复页；FormClosed后专属测试注入前台线程残留才应触发兜底。测试只做3个核心进程场景与必要相邻回归，不跑Vite/全聊天/全库/大媒体/OOM。不得与正式全局热键或事件名冲突。

新候选、验证、安装及实际运行分别写；正式仍ui37/API0.9.26，不能把设计写成已交付。

## 已交付

2026-10-19 ui38已正常保存/备份/标准升级启动（2026-10-19T07:52:33.7439447Z，聊天PID16628仅快照），API0.9.26未重启。本次ui37卡住已先保全57/58份草稿存储及751KB宿主转储后恢复；独立Chrome明确e0000008，随想renderer仍存/无新Crashpad，初始冻结原因未结案。修复已关闭窗口后的宿主残留：真实本地ACK/明确恢复关闭/严格空初始化许可分开，实际FormClosed后一次5秒后台退出尝试；可见未保存页/无ACK/隐藏不触发，不承诺服务端上传完成。保存阶段/退出许可日志有界，故障不被普通日志预算挤掉。提示文字左偏18px确认为新36紧凑档隐藏按钮仍留宽，CSS修后36/128两场景左右差均0。24真实普通Main断言＋新EXE1微型原件＋2输入对齐场景通过；11915安装SHA复用标准apply逐目标核验，根复核5变化/宿主/journal边界，不重复全套。772×1550/116%/2屏保持，原profile/正式数据位置保持。备份2026-10-19T07-51-04-526Z-80323fa3；产物outputs/2026-10-19-chat-freeze-repeat、临时tmp/chat-freeze-repeat。

顶部原‘候选尚未部署’按调查时间保留；此段为随后ui38正式运行。初始冻结未结案。

[验收与运行](validation/2026-10-19-chat-freeze-repeat.md)

## 实窗收尾与下一项核心优化

2026-10-19 ui38实窗与文档收尾已完成：实际看到展开、离开后贴边收起及激活再展开，空框提示左缘正常；主动关闭输入被用户活动保护阻止，未强行争用，正常/无ACK/关闭后残留仍按上一轮24真实Main断言复用。新增仅1个无WebView STA场景证实同步UI阻塞使保存期限/恢复提示延后（200ms期限，370ms仍Pending，823ms释放后TimedOut）；并非原始冻结现场COM栈。原API0.9.26/16628宿主未重启，未改产品代码。全机提交两次新按需采样97.11%/99.42%，后者余量约411MiB；私有提交不等于物理RAM，不把其他程序占用归给随想。已确认后台waiting tick仍整库clone/token/写盘，下一步优先队列内no-op preflight＋并发专项，尚未实施。按需capture脚本已实际试跑，不增加常驻监控；初始可见冻结根因仍未结案。

[实窗边界、单场景证据与下一步](validation/2026-10-19-chat-freeze-followup.md)。
