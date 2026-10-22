# 消息连续运动：Apple调研与ui12

最新已正常保存/快照/标准升级启用ui12（PID70796/托盘29324仅本次快照），12215安装SHA-256、108%字号/868×1649和两屏宽高/字号记忆核对通过，API0.9.24未重启。用户观感仍待试用；并行数据候选未带入。

用户实际试用ui11后选择“移动生硬、不连贯”，随后要求学习Apple等优秀过渡。U46优先于此前UI验收通过的主观推断，体验项仍留给用户。

## 参考与取舍

阅读[Apple WWDC23 Animate with springs](https://developer.apple.com/videos/play/wwdc2023/10158/)：位置连续只是条件之一，改变目标时还应保留速度；弹簧可采用无回弹形式，移动和透明度不必强行同时结束。本文采用这些原理，不声称使用SwiftUI或精确复制Apple私有参数。

阅读[WWDC18 Designing Fluid Interfaces](https://developer.apple.com/videos/play/wwdc2018/803/)：界面应随时响应打断与重定向、保持空间关系；先用无明显回弹的运动，再根据语境增加弹性。本软件高频发送不增加上下弹跳、甩动或等待动画完成的锁定。

[Apple HIG Motion](https://developer.apple.com/design/human-interface-guidelines/motion)强调动效应支持任务、简短可取消，并考虑减少动画。保留现有滚轮/触摸/导航/隐藏/减少动画即时取消能力；没有改快捷键或加入额外确认。

## 定位与实现

ui11在每次页脚/消息几何变化时取消旧WAAPI，按剩余时长重新播放同一Bezier曲线。它能补偿位置，但新曲线起始速度不能匹配上一段；不同气泡又有180/200ms两套节奏。此外，以DOM内容节点保存轨迹在同消息编号节点重建时不能接续。

ui12的shiye-chat-ui.js采用临界阻尼解析运动，频率参数26/s；每次新目标读取当前动画时间，求当前位置和速度，再从该状态趋近新目标。新旧气泡使用同一物理响应，不固定每次都从静止起步；透明度独立完成。按稳定消息编号保存运行状态，同编号的内容节点重建后继承轨迹/淡入进度，不再变回不透明再重播。只在尚不可见的最初24ms视觉交接内允许对齐发送后最终布局，交互与数据发送不等待；可见后不重置速度。

解析轨迹一次生成约240Hz采样的WAAPI位移/透明度关键帧，由浏览器按实际显示节奏插值；这不是承诺呈现240帧。没有逐帧修改布局或持续轮询历史，终点误差低于0.03px且速度低于1px/s才收敛到精确零值。输入框仍保留原有自动高度/可拖动逻辑，不通过缩放输入文字/图标制造假变形。

## 并行工作隔离

本轮发现另一会话正在修改ChatJournalBridge、MockClient、shiyeLocal、归档及朝花夕拾入口/资源，尚在开发。保留共享源码，不暂时回滚、不运行会带入这些修改的完整构建。ui12以ui11的12215文件交付清单为已校验基线，只补丁shiye-chat-ui.js与前端修订标识/内容哈希查询，复用ui11宿主/编译资源。shiye-preview.js使用基线生成的版本标识补丁，不把新增朝花夕拾入口孤立带入；完整来源见patch-provenance.json及UPSTREAM的baseline/animationPatches。根源码中的并行功能继续保留，候选不等于当前整个共享目录的全量发布。

## 检查与状态

直接执行实际解析函数的4095项位置/速度接续、有限关键帧及终点检查通过。真实隔离浏览器的短文/表情/长文/多行、连续四条、PNG/MP4确认发送、滚动/导航打断及中途减少动画通过；未向正式会话发送样例。初步比较长文可见阶段单帧变化约8px降至约2px，p95采样仍约8.5ms，改善的是轨迹衔接，不由此推断实机帧率提高。

实际候选、360px/200%字号、减少动画三组共12类发送通过，稳定400ms后位置变化为0；393项聊天/10项图片原生隔离无脚本异常，4095项轨迹检查通过。另跑完整项目测试573项全部通过、无失败或跳过。

完整npm run check的模块与ESLint通过，但停在并行开发的三个格式告警：previews/telegram-chat/shiye-revisit.js、src/server/domain/revisit.mjs、tests/revisit.test.mjs。这些源码未进入本次已校验ui11基线加动效补丁，未替另一会话批量格式化；交付清单明确rootCheck:false及原因，不把573项测试通过说成完整check通过。此前ui11基线的完整检查记录继续保留。

ui11与ui12在可见阶段的新气泡单帧变化：长消息约8px降至约2px，短文/表情仍为小幅移动；旧消息实测峰值速度也有降低（约2112/2470/4301/3610 px/s→1142/1323/2498/2077 px/s，对应短文/表情/长文/多行）。这些是一次隔离测量，布局/负载不同会改变数值，不是Apple官方参数或实机帧率承诺，完整轨迹保留在before/built-final/comparison.json。

原生验收后按既有授权进行正常保存/标准快照升级；最终运行与每屏偏好以installed-verification.json为准。用户真实体验项仍留空，不能因再次原生检查通过而关闭“生硬、不连贯”的反馈。产物outputs/2026-10-17-message-continuity，临时tmp/message-continuity；真实120Hz观感待新版试用。

## 正式启用回读

2026-10-17标准维护操作2026-10-17T11-36-17-333Z-22876748完成保存退出、备份、安装、启动，未强杀或绕过保存保护；备份在outputs/desktop-maintenance/backups/同操作号。运行回执确认ui12/ready，逐个12215程序文件哈希全部匹配；与本次升级快照比较两屏WidthDip/HeightDip/TextScale一致，当前字号1.08、868×1649保持。Computer Use只读回看新“拾页 · 随想”窗口正常，未向正式会话发送样例，API未重启。细节见upgrade-result/status-after-upgrade/installed-verification.json。

UPSTREAM的deploymentMode/baseline/animationPatches和patch-provenance记录基线及两份动效资源来源，delivery-manifest-ui12如实标明rootCheck:false及并行格式告警；不复用旧报告冒充ui12原生验收。后续全量发布须由负责会话验证正在改的归档/朝花夕拾源码，不能由ui12名字推断这些功能已部署。
