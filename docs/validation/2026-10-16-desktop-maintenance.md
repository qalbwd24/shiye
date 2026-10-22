# 桌面维护与交接验收 · 2026-10-16

应用 0.9.20，候选前端 20261016-ui4。用户要求命令行操作后台更换版本，并建立所有会话共同维护的开发说明。

## 实现及范围

入口 tools/desktop-control.mjs、.ps1；实现 tools/lib/desktop-maintenance.mjs、desktop-runtime.mjs。命令与恢复步骤见 [使用文档](../DESKTOP-MAINTENANCE.md)，当前进度见 [交接](../DEVELOPMENT-HANDOFF.md)。AGENTS.md、WORKSPACE.md 已加必读入口和其他会话积极维护开发文档的明确责任。

维护流程只触及固定聊天程序文件，封存与快照带 SHA-256。退出走原有保存协议，等待实际退出；不强杀，不重启日记 API，不回滚用户日记或偏好。候选校验通过不代表代码来源可信，仍需使用本项目构建的已审查候选。

## 实测证据

产物统一在 outputs/2026-10-16-桌面维护/：

- candidate/：新宿主及完整本地前端，原生与前端构建成功。
- native-ui-check-final.json：119 项聊天、9 项图片通过，errors／runtimeErrors 为空。maintenanceReceipt 报告测试 PID 63044、实际页面 20261016-ui4、正确宿主路径与 ready:true。验证使用 tmp/telegram-preview-20261015 隔离 profile，已正常关闭该验证进程。
- 六组字号／弹窗宽度回归继承 ui3：100%、152%、200% × 420px、320px；发送44px、取消64px、图标20px，说明文字不竖排。动画和 Esc 回归通过；更新间隔仍不能替代实际显示帧率。
- maintenance-tests.log：17 项通过；临时项目和模拟进程验证命令解析、只读预检、正常退出、超时保护、备份、安装、复制失败恢复、回滚数据保留、损坏哈希、并发锁、符号链接、死亡锁恢复、运行回执及畸形验收清单。
- status-readonly.json：普通聊天 PID30328、托盘 PID33292；API 0.9.20；安装旧元数据 legacy-unreported，运行修订未知；未发现其他根目录普通窗口或维护锁。
- delivery-manifest-ui4.json：候选及验收证据 SHA-256；upgrade-dry-run.json：真实目录只读预检，不关闭或覆盖普通窗口。
- project-check.log：本轮 npm run check 全部通过，文件检查、ESLint、格式与 334 项测试成功；若后续并行改动再次检查，另存结果并更新交接，不覆盖历史证据。

## 后续真实启用

用户随后明确要求直接切换，维护 CLI 正常保存退出、备份、安装和启动均成功；运行回执确认普通进程加载20261016-ui4。见 outputs/2026-10-16-ui4启用/status-after.json 与 [运行／分屏记录](2026-10-16-display-memory.md)。下文“仍为ui1”保留为最初验收时状态，不代表现在。

## 最初验收时的缺口与约束

普通聊天仍为 ui1；用户曾要求暂时保留窗口。此前正式进程操作被自动审批拒绝，仅返回 blocked by policy，本轮未用 CLI 重试受限动作。真实 stop/start、完整升级／回滚、快捷方式实际点击、物理鼠标与多屏／跨 DPI／显示器插拔尚未验收。

升级失败应先读维护操作记录，再决定程序恢复；不要用旧偏好快照覆盖用户新内容。所有后续会话必须同步需求、功能索引、使用说明、验证和实际运行状态，分别报告候选验证与普通运行结果。
