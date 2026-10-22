# 2026-10-19 随想卡死与收起恢复验收

2026-10-19 随想ui35已正常保存/备份/标准升级启动（2026-10-19T06:30:52.4812540Z，PID45876仅快照）。已确认两次renderer OOM（0xe0000008）：申请77.18MiB，异常采样可提交额度68.72/16.84MiB，不能据此认定随想JS泄漏；首次故障已保全profile/dump后临时恢复旧ui34。修复完整保存期限（派发＋ACK共10秒）、迟到响应/导航代际、ProcessFailed撤ready及原生重试保存/重新加载/关闭入口；不自动丢稿或OOM重载风暴。自动收起实际通过正常离开路径、派发悬挂10秒后揭回/清双锁及不重复尝试，故障态不再弹旧ConfirmHide模态。最终10辅助＋15原生＋1微型原件看图定向通过，非全app/全库/媒体矩阵或物理120FPS验收。生产仅DesktopPreview.cs及修订/cache元信息，静态worker/bridge/API保持；11915安装SHA、972×1440/116%/2屏保持，API0.9.25未重启。备份2026-10-19T06-29-23-341Z-39568c22。产物outputs/2026-10-19-chat-hang-recovery，临时tmp/chat-hang-recovery；后续先status。

## 原因与恢复边界

两份实际Crashpad副本的时间为2026-10-18T09:09:50Z、10:41:14Z，均ptype=renderer、exception=0xe0000008，分配请求80928768字节。异常参数采样的剩余可提交额度分别72056832、17653760字节，均低于请求；采样发生在OOM之后，不能当作失败前精确值。现场无renderer但外壳仍Responding；旧ready文件仍显示成功，旧PrepareToHide又在脚本派发完成之后才开始超时，导致关闭/退出/自动收起都可被同一保存锁阻塞。数值解释依据[Chromium OOM实现](https://chromium.googlesource.com/chromiumos/platform/libchrome/+/6faee078a9bb96633353f5c7b00b35408c0ca4ee/base/allocator/partition_allocator/src/partition_alloc/oom.cc)，进程恢复依据[WebView2官方文档](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/process-related-events)。

初次临时恢复仅结束经路径/PID/创建时间核对且renderer已退出的外壳81932，托盘80260由CLI正常退出；前后各56个所选草稿存储/配置文件约90.3MB、无复制错误，未清空profile或写正式diary.json，不能保证已崩溃进程中未落盘输入恢复。原始dump仅保存在本机crash-dumps-private；不输出任意内存字符串，不上传。

具体内存分配调用、随想自身的占用贡献及长期泄漏仍未确认，全机提交压力不由此补丁消除。浏览器主进程已经退出时Reload未必可恢复，原生提示可关闭后重开；活renderer保存暂时失败可不重载地重试并保住输入。仅用户主动点击重新加载或关闭才走可能丢失未保存输入的动作。

## 本轮定向检查

最终helper-validation.json共10项：派发悬挂/ACK缺失共用完整期限、迟到ACK不完成新请求、重试、并发门控、故障中断、异常释放以及有界恢复脚本。

native-lifecycle-validation.json对最终host本身反射运行，hostExeSha256=4a3dcd2e83f675d4474586bd693ce606b8e126e6acdad2339a38f045fcea69ac。15项涵盖正常ACK/隐藏恢复、保存失败非模态提示和不重载保留原稿重试、导航中断/旧导航迟到失败、真实Page.crash后撤ready/重载/关闭、最小窗关闭按钮边界、故障ConfirmHide前置保护，以及自动收起的正常与派发悬挂10秒路径。TickDockCore(true,outsidePoint)走与实际离开检测相同分支，未移动物理鼠标，不计为物理120FPS/多屏运动验收。另1项实际16×16原件打开/关闭保持图片相邻路径；没有跑大图/全媒体或全库矩阵。独立合成页面/profile未连接正式API，不注入OOM或无限循环。

首次native-attempt1.json因测试capture监听未压住旧ACK，导致保存先成功；保留此失败，改隔离delegate只抑制该次派发后验证真实导航，不为该测试修改产品。attempt-before-dock保存了新增自动收起检查之前的已过候选；最终15＋1是重新编译后的实际检查，不冒用旧EXE结果。

## 发布回读

后续低风险收紧：NavigationCompleted读版本的迟到成功结果仍先赋runtimeRevision，再检查代际；同冻结ui35通常同值，暂无本次实际跨导航成功/null证据。极端迟到null可能使随后status假阴性，不影响内部ready、保存或自动折叠，也不会让旧回调写当次ready。后续host维护将结果先放局部变量、代际/navId及非空校验后再赋字段，补一条迟到成功/null定向；本轮封存包不改，不将该边界写成已覆盖。

候选只相对ui34改变4个程序路径：宿主EXE、UPSTREAM.json、app/index.html、app/shiye-preview.js（修订/cache）。最终程序manifest f0cb21a1589447784106250b4043cb612e173e52909bb384357d452f18d3bef4，11915安装文件SHA全部一致。正常保存退出由标准维护执行；运行回执2026-10-19T06:30:52.4812540Z，revision 20261019-ui35；备份D:\拾页\outputs\desktop-maintenance\backups\2026-10-19T06-29-23-341Z-39568c22。API0.9.25健康及既有后台能力保持，本轮未重启API或扫描/迁移正式内容。偏好972×1440、116%、两个显示档案保留。

偏好核验曾首先按06:24的早期快照断言1824高而失败；只读核对发现标准保存退出后、替换程序之前的维护备份已为1440高且TopMost=false，正式升级后整个window.json与这份最新退出备份逐字段一致，备份SHA亦与preferences-manifest一致。因此保留972×1440最新值，不回写1824旧高度；这一变化发生于替换前，未另行归因于用户操作。原始runtime-before及runtime-after.preferenceBaseline均保留，不将早期断言写成通过。

产物D:/拾页/outputs/2026-10-19-chat-hang-recovery；临时D:/拾页/tmp/chat-hang-recovery。
