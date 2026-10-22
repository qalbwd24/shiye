# ui38 实窗收尾与卡死核心排查

后续2026-10-19：本文提出的队列内no-op已在后端源码候选实现，另修复旧HTML逐篇Window分配；11新增＋93相邻隔离通过，正式API/窗口未动。详见[后续算法核验](2026-10-19-revisit-algorithm-review.md)。以下“尚未实施”为本文当时状态，原始冻结结案边界仍保持。

2026-10-19 ui38实窗与文档收尾已完成：实际看到展开、离开后贴边收起及激活再展开，空框提示左缘正常；主动关闭输入被用户活动保护阻止，未强行争用，正常/无ACK/关闭后残留仍按上一轮24真实Main断言复用。新增仅1个无WebView STA场景证实同步UI阻塞使保存期限/恢复提示延后（200ms期限，370ms仍Pending，823ms释放后TimedOut）；并非原始冻结现场COM栈。原API0.9.26/16628宿主未重启，未改产品代码。全机提交两次新按需采样97.11%/99.42%，后者余量约411MiB；私有提交不等于物理RAM，不把其他程序占用归给随想。已确认后台waiting tick仍整库clone/token/写盘，下一步优先队列内no-op preflight＋并发专项，尚未实施。按需capture脚本已实际试跑，不增加常驻监控；初始可见冻结根因仍未结案。

## 实际检查与保留边界

- 安装/运行回读仍20261019-ui38，API0.9.26；宿主16628/API86988为本轮快照，后续仍须重新status。升级、备份、安装hash与24项普通Main/1原件/2对齐场景见[ui38验收](2026-10-19-chat-freeze-repeat.md)，本轮不重跑。
- computer-use实际捕获贴边6px条→展开正文与输入区→再次6px条→激活再展开；最终空框提示可见且左起点正常。没有清空、替换或发送正式草稿，精确空框/实输delta=0继续引用隔离36/128两场景。
- 标题关闭动作被“user input was detected”保护阻止，未强行操作或将其写成实测关闭通过；正常完整PID退出/无ACK保留/关闭后残留兜底沿用上一轮真实Main定向证据。本轮实窗快照只证明该时刻可显示/恢复，不保证长期不卡。
- 源码CSS/JS与public镜像SHA相同；生产DesktopPreview.cs SHA仍8b90821d305ac553d3273257c94e1eb2184d1d995df8f27040d5c8445e8b6c4a。本轮仅文档与诊断脚本，产品不需重复升级/API重启。

## 这次新增的核心证据

原样提取HostSaveLifecycle，独立STA WinForms消息循环，不加载WebView/浏览器、不接正式API/profile。只在注入dispatch中有限等待约800ms，设置200ms期限；独立线程池定时器进展正常，370.85ms采样仍Pending且UI continuation未运行；823.53ms释放后才TimedOut/清Pending，原测试PID退出0。只证明保护边界，不模拟真正COM，也没有直接读取私有deadline Task。见synchronous-dispatch-validation.json与freeze-blocking-audit.md。

源审计：SaveAsync同步dispatch、ExecuteAsync先execute才设timer，保存前后同步状态/日志/设置及PostWebMessage均可能让UI期限续体迟到；150ms命令poll也依赖同一消息循环。未发现常规路径Wait/Result/Monitor锁。异常模态对话框和事件中同步写盘是候选风险，但相应异常/ScriptDialog日志未找到，不能定为本次触发。

官方[WebView2线程模型](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/threading-model)要求STA消息泵并说明阻塞/同步重入风险；[进程事件说明](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/process-related-events)区分renderer无响应与退出。这些规则支持审计方向，不能替代本次现场栈。不要简单Task.Run搬COM到后台线程。

## 内存与后端缩峰方向

旧WebView两次OOM、本次独立chrome.exe e0000008、已关窗宿主残留分别记录；751KB宿主dump只含关闭后38线程结构/RIP，无异常流/可靠符号栈，不能反推最初冻结。详情freeze-evidence-followup.md。

07:58Z单点chat树私有提交约1227MiB（renderer656/GPU418），API约2307MiB；这是私有提交，不是独占RAM。两次按需capture全机提交97.11%及99.42%；后者73,707,761,664/74,139,066,368字节、余量431,304,704字节约411MiB。系统总量并非随想总量；按进程名聚合含其他项目实例，不能把全部node/WebView归给拾页。未关闭其他应用、做压力试验或抓renderer全堆。

api-residency-followup.md确认空feed lazy修复仍在；未发现正常空闲默认永久保留数份全库/全部媒体原件。明确峰值是后台tick经mutate clone全库→两次deliveryToken序列化/hash→可能的来源快照→整库JSON写盘；waitingForMinute/Clock也先付此成本。它是需优化的分配路径，但没有同刻分配栈，不能说已解释本次初始卡死或API全部占用。

下一项实施顺序：先内部有界无正文heapUsed/heapTotal/external/arrayBuffers与tick时序；再在原共享写入队列内、基于最新状态和同一个now纯判断确为waiting且无初始化/升级的no-op，跳过clone/token/write。created=0不等于无状态改变。只针对configure并发、手动补看、多实例、初始化、时钟回退、失败原子性做专项；不改规则/游标语义，不在队列外判定后无条件返回。当前仅设计，未修改或部署该优化。

## 按需现场采集

项目根运行 `node tmp/chat-freeze-repeat/capture-freeze.mjs`，产物自动带UTC时间写入本轮outputs；只执行一次status、进程树/角色与全机内存、最多32条原生日志白名单字段、旧Crashpad文件元数据。两次实际运行通过，第二次增加进程名内存聚合以区分全机归属。没有持续timer、页面脚本、正文/命令行输出、profile复制、dump、重载、停止或改库。20秒子进程期限不代表能解除产品UI阻塞。

下一次仍可见且不可操作时，先运行该命令保全同刻身份/提交/阶段；必要时再做有界窗口线程响应和小宿主dump。现有小dump没有最初renderer同刻栈，不能借此宣称根因已闭环。

产物：D:/拾页/outputs/2026-10-19-chat-freeze-repeat；临时/采集入口：D:/拾页/tmp/chat-freeze-repeat。
