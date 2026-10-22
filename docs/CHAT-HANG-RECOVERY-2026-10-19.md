# 随想卡死、无法关闭及自动收起

2026-10-19 随想ui35已正常保存/备份/标准升级启动（2026-10-19T06:30:52.4812540Z，PID45876仅快照）。已确认两次renderer OOM（0xe0000008）：申请77.18MiB，异常采样可提交额度68.72/16.84MiB，不能据此认定随想JS泄漏；首次故障已保全profile/dump后临时恢复旧ui34。修复完整保存期限（派发＋ACK共10秒）、迟到响应/导航代际、ProcessFailed撤ready及原生重试保存/重新加载/关闭入口；不自动丢稿或OOM重载风暴。自动收起实际通过正常离开路径、派发悬挂10秒后揭回/清双锁及不重复尝试，故障态不再弹旧ConfirmHide模态。最终10辅助＋15原生＋1微型原件看图定向通过，非全app/全库/媒体矩阵或物理120FPS验收。生产仅DesktopPreview.cs及修订/cache元信息，静态worker/bridge/API保持；11915安装SHA、972×1440/116%/2屏保持，API0.9.25未重启。备份2026-10-19T06-29-23-341Z-39568c22。产物outputs/2026-10-19-chat-hang-recovery，临时tmp/chat-hang-recovery；后续先status。 [验收](validation/2026-10-19-chat-hang-recovery.md)

用户再次反馈偶发卡死，当前窗口也无法关闭，随后明确自动折叠收起同样失效。本轮先保留实际故障现场，不把强制重启当作根因修复。产物为 `outputs/2026-10-19-chat-hang-recovery`，临时为 `tmp/chat-hang-recovery`。

已确认的代码缺陷：`PrepareToHide` 先无界等待 `ExecuteScriptAsync`，之后才开始10秒保存ACK超时。脚本调用本身不返回时，`hidePending` 不释放，关闭、托盘退出、自动收起都可持续受阻。自动收起还会保持 `dockPreparing` 等待同一任务。故障现场的ui34原生没有处理 `ProcessFailed`，旧ready回执无法反映renderer退出或失去响应。

故障发生时的实际现场：安装及进程为ui34/API0.9.25；页面灰色且内容disabled，外壳Responding=true。宿主81932及其浏览器72008树中有GPU/utility/crashpad，却没有renderer。后续找到两份Crashpad原始dump，时间为2026-10-18T09:09:50Z及10:41:14Z（前次和本次进程生命周期分别匹配），均`ptype=renderer`、`exception=0xe0000008`。失败申请`0x4d2e000`=77.18MiB；异常参数记录的可继续提交额度分别为68.72MiB及16.84MiB，低于请求，总提交限制约69.05GiB。Chromium官方[OOM实现](https://chromium.googlesource.com/chromiumos/platform/libchrome/+/6faee078a9bb96633353f5c7b00b35408c0ca4ee/base/allocator/partition_allocator/src/partition_alloc/oom.cc)定义了这三个参数；它们在OOM之后采集，不能当成失败前精确测量。本轮系统只读采样提交使用率约93%，物理可用约1GiB。

这两次页面退出的直接原因已确认是内存分配失败；仍不能归因于CSS、动画、JS泄漏或GPU驱动，也没有证据把全机内存压力都归给随想。崩溃原始文件仅保存在本机`crash-dumps-private`，只打印异常数值和允许的ptype字段，不上传或输出任意内存字符串。当前故障和10月18日恢复历史分开记录。

本次临时恢复：用户明确当前仍卡死后，先保存所选profile草稿存储和窗口配置，前后各56文件约90.3MB、无复制错误；核对路径/PID/创建时间后结束renderer已退出的外壳81932，托盘80260由标准CLI正常退出。随后标准start恢复ui34，06:12:29Z新ready回执（聊天7668/托盘83032仅快照）；API未重启，数据/profile未清理。临时恢复时修复候选尚未部署，不能把当时恢复写成漏洞已修复或未落盘输入已保存。顶部记录为随后ui35正式交付。

处理规划：由主代理确定完整保存期限、故障状态与恢复边界，6.1-sol medium执行。修复期限须覆盖脚本派发和ACK全程，退出锁必须释放；接入官方进程失败事件，故障时立即撤销ready，留不含正文的有限诊断。正常草稿保存仍须ACK，失败不能伪装成功或自动丢弃内存；提供明确恢复/关闭路径，保留原profile。恢复后检查真实页面、关闭/收起与快速重试，故障注入使用隔离数据/profile，不在真实消息上注入故障。

验证以正常保存、派发悬挂、ACK缺失、迟到ACK、renderer故障、故障后的重试/恢复和自动收起为核心，不重复全库、Android、图片矩阵。候选、安装、运行和故障根因须分别记录；仍需定位具体内存申请调用及随想占用贡献。

官方依据：[WebView2进程事件与恢复](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/process-related-events)。renderer退出应Reload或重建；无响应应通过ProcessFailed诊断，不能只看宿主进程存活。

后续低风险收紧：版本读取迟到成功时先赋字段再检代际，极端null可能造成随后状态回执假阴性；没有本次实际发生证据，不影响窗口内部ready/保存/折叠。后续原生维护按局部变量→代际/navId/非空检查→赋runtimeRevision处理，ui35封存包不改；详情见验收。
