# 维护诊断便利性第一阶段验收

后续真实闭环：2026-10-18T00:04:48Z已由助手自动完成ui22预检、备份、标准升级、启动及12218安装hash/运行回读。聊天托盘此前已退出，saveDisposition=already-stopped；API0.9.24保持运行。原25项维护证据保留，不因本次文档补充重跑；旧“未部署”是诊断阶段边界，最新见[交付](2026-10-17-send-settle.md)。

2026-10-17。用户希望后台更新等维护由助手自动完成，而非依赖用户反复手跑零散命令。本阶段增加可靠的只读判断和失败回执，构建/验收编排由主会话处理，不是第二套安装器。

## 实现

- `tools/desktop-control.mjs`：doctor；仅status/doctor/help可用--human；默认JSON原字段保持。错误JSON保留ok/error并附诊断字段。
- `tools/lib/desktop-maintenance.mjs`：doctor只读查询原status，区分窗口退出与API可达；有效死锁仅给归档建议，不执行。未知/损坏/归属冲突/失败记录禁止自动恢复或安装。
- 原安装引擎增加source、saveDisposition、failedPhase、lastSuccessfulPhase、nextAction；真正动作完成才推进成功阶段，apply开始不算安装成功。原保存、独占锁、快照、SHA验证及恢复路径保持。

## 验证

原17项维护测试及新增8项共25项通过。覆盖默认JSON兼容、human限制、已退出不请求保存、API单列、doctor不写维护文件/不调stop/start、其他根归属/缺broker、活/死/损坏锁、备份失败动作、复制失败成功阶段、启动失败、未知旧失败及rollback失败不建议自动安装。目标源码ESLint、Prettier通过。

真实验证只调用status、doctor及human展示，不执行维护动作。回执与日志在`outputs/2026-10-17-send-settle/maintenance-diagnostics`；临时合成维护测试目录为`tmp/desktop-maintenance-*`，由测试核对项目内路径后自动清理。所有原生候选/profile及本轮动画失败证据保持。

本阶段不改API控制、旧restart/upgrade脚本、默认快捷键或托盘；不自动执行nextAction，不绕过构建或进程启动的工具策略。完整项目检查由主会话统一记录，不把25项定向通过冒充全项目通过。
