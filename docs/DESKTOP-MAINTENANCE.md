# 聊天与托盘的命令行维护

2026-10-21 U56～58已完成准确UI57独审及一次正常维护启用。标准upgrade --no-start operation/备份2026-10-21T05-37-39-383Z-20245b01后核全停，根broker独立备份及beforeSHA双核CAS为c162f5ae，再原start；05:38:41Z实际ready/LocalSaveAck/showInTaskbar=false，无挂起/恢复/锁。10源码及proof窄CAS留前件，自启动只当前安装专属HKCU值缺失→准确带引号broker --autostart，enable/status/原值均回读。API未重启，失败无重放；[验收](validation/2026-10-21-pc-resident-ui57.md)留准确manifest/plan/helper/审批/journal。原统一快捷键设置内可关闭自启动；未实际注销登录/重启Windows。

2026-10-21 PC用户恢复本轮U56/U57：新增并开启可逆的当前用户自启动选项，登录托盘待命、主动打开聊天不占任务栏，保统一托盘/热键/单实例/保存ACK与恢复；每次重启疑似保存提示须先定位。窗口工具保留，仅清无用消息菜单。当前私有源/候选准备，未部署或修改正式自启动设置；独立6.1-Sol高准入后沿原正常保存/备份/标准upgrade及运行回读，不重启数据API/动设备。需求与验收继续用原CHAT-UI-OPTIMIZATION的U56/U57及人工表，不将自启动能力与业务服务部署混为一体。

后续真实闭环：2026-10-18T00:04:48Z已由助手自动完成ui22预检、备份、标准升级、启动及12218安装hash/运行回读。聊天托盘此前已退出，saveDisposition=already-stopped；API0.9.24保持运行。原25项维护证据保留，不因本次文档补充重跑；旧“未部署”是诊断阶段边界，最新见[交付](validation/2026-10-17-send-settle.md)。

2026-10-17 第一阶段诊断已实现：`doctor` 只读返回保存是否需要、进程/锁/失败阻塞和结构化下一步；`status|doctor|help --human` 输出可读文本，默认 JSON 保持兼容。升级失败分别保留 `failedPhase`（失败动作）与 `lastSuccessfulPhase`（真正完成的阶段），附操作ID、备份和禁止盲目恢复的 `nextAction`。25项维护测试通过；仅真实只读回读，未执行构建、部署、API重启或原生启动。见[验收](validation/2026-10-17-maintenance-diagnostics.md)。

2026-10-17 新确认需求（实施中）：用户希望后台更新、启动及调试维护更便捷，减少构建/验收/升级分散命令，不只是静态页面预览。用户选择由助手自动完成，不要求新增菜单或自己操作脚本。优先补只读doctor、可读状态、失败动作与下一步诊断，方便自动判断；复用既有保存、候选验收、快照和SHA校验，不跳过失败步骤、不绕过工具审批。最新只读状态：聊天/托盘均已退出，安装ui21；日记API仍可达0.9.24，不能把退出聊天等同停止全部后台。具体运行状态每次重新查询。第一阶段不把旧restart.ps1直接终止API的流程接入自动维护，也不增加默认快捷键。

2026-10-17 已正式启用随想20261016-ui9（PID49160）及思绪/托盘PID76152，API仍0.9.24且未重启。385＋10项原生隔离、35项焦点DOM、549项项目覆盖（548无界面＋1串行桌面）、12215安装文件SHA-256全部通过。原F盘数据/profile、当前屏108%字号及两个显示屏档案保留。名称统一主页／思绪／随想／便签，随想标题栏思绪/便签入口复用已有工作区；未改用户会话名/快捷键绑定或启用统一消息主体候选。现有主页因Computer Use无法可靠识别URL而未刷新，需用户刷新后显示新标题；原生三窗口标题已核对。见[ui9验收](validation/2026-10-16-room-position-transition.md)和[产品命名](PRODUCT-NAMING.md)。

2026-10-16 本轮已使用既有stop/start正常保存退出并恢复聊天ui8；日记API单独核对D盘监听进程、保存稳定快照、重启及health版本。实际API0.9.23，CLI的installed.version仍是聊天ui8构建时appVersion，不等于API版本；不要只读它断言日记没有更新。没有新增免重载热更新或任意后台控制接口。见 validation/2026-10-16-rich-media-legacy-reading.md。

维护日期：2026-10-16。先读 [开发交接](DEVELOPMENT-HANDOFF.md)。所有会话都要及时维护需求、实现、验证和运行切换记录，不能仅在聊天里报告进度。

用户要求用命令行保存退出后台并更换聊天版本。工具只操作本项目聊天和托盘，不更换日记 API，不迁移日记或媒体，不提供远程控制或任意命令执行。

## 使用

在 D:\拾页 中执行，需要 Node 22.13 或以上版本：

```powershell
node tools/desktop-control.mjs status
node tools/desktop-control.mjs status --human
node tools/desktop-control.mjs doctor
node tools/desktop-control.mjs doctor --human
node tools/desktop-control.mjs help
# 只读预检
node tools/desktop-control.mjs upgrade --from "outputs/2026-10-16-缩略图与窄窗口/candidate" --dry-run
# 正常保存退出、备份、安装和启动
node tools/desktop-control.mjs upgrade --from "outputs/2026-10-16-缩略图与窄窗口/candidate"
```

也可用 `npm run desktop:control -- status`，或 `powershell -NoProfile -ExecutionPolicy Bypass -File tools/desktop-control.ps1 status`。包装器只转交固定 CLI 参数。

| 命令                       | 行为                                                                      |
| -------------------------- | ------------------------------------------------------------------------- |
| status                     | 查询程序路径、PID、安装修订、运行回执、API 健康、维护锁与最后操作         |
| doctor                     | 只读检查退出/保存条件、进程归属、锁和失败记录，返回下一步建议，不执行建议 |
| stop                       | 使用已有 --exit-host 保存退出协议并等待退出，超时失败，不强杀             |
| start                      | 启动稳定入口的聊天与托盘并等待就绪；旧宿主仅能检查进程                    |
| restart                    | 正常退出后启动                                                            |
| upgrade --from 候选目录    | 校验、封存、保存退出、备份、安装并启动                                    |
| rollback --backup 备份目录 | 恢复程序；不覆盖后来产生的数据和偏好                                      |
| recover-lock               | 仅在锁持有 PID 已死亡时归档锁，不自动继续安装                             |

升级和回滚支持 `--dry-run`；`--no-start` 表示安装后暂不启动。成功输出 JSON，失败向 stderr 输出 JSON 并以退出码 1 结束。回滚目录使用升级结果中的 backup 值，不要猜测或编辑快照。

`--human` 仅用于 status、doctor、help。doctor 的 `readOnly:true` 不等于全部服务就绪，应检查 `ok`、`issues` 和 `saveDisposition`。聊天/托盘均已退出时返回 `already-stopped`，不再请求保存；API是否运行单独报告。`nextAction` 的 `command/args/reason/automaticAllowed` 是后续判断依据，不是自动执行或授权替代：只有已确认死亡的有效本项目锁才会建议 recover-lock；损坏记录、未知旧失败、归属冲突和恢复失败均不建议自动安装。维护中仍走原有锁、候选校验和保存协议。

## 范围与恢复

- 稳定安装目录为 outputs/2026-10-15-Telegram聊天预览。候选必须在本项目 outputs 内，包含 UPSTREAM.json 修订号及对应 delivery-manifest-uiN.json 的程序哈希和聊天／图片验收计数。
- 只安装宿主、WebView2 支持文件、许可证、UPSTREAM.json 和 app/。拒绝越界路径、目录联接和符号链接；封存后重新核验 SHA-256 再替换。
- outputs/desktop-maintenance 中保存 releases/、backups/、operations/、active-operation.json 和 maintenance.lock。偏好快照仅供核对，回滚不覆盖偏好。保留记录，不自动清理。
- 发现其他目录的普通聊天／托盘会中止，避免旧全局退出协议影响别的工作区。只有聊天而无托盘时不强关编辑窗口。
- 复制失败且没有程序占用时尝试恢复旧程序。启动失败保留错误和备份；先读 status 及操作记录再决定恢复。
- ui4 宿主在当前 profile 的 telegram-chat-preview/runtime-status.json 报告实际页面修订；CLI 核对 PID、路径、时间和修订。旧版报告 legacy-unreported，不能据此声称新版就绪。

本工具不能绕过用户保存决定或工具审批。此前正式进程切换曾被自动审批拒绝；后来用户明确要求直接切换，本轮标准 upgrade 已成功。普通窗口先确认ui4，随后启用含分屏记忆的ui5并正常重启验证，最终状态见 [运行记录](validation/2026-10-16-display-memory.md)。模拟流程测试和真实升级分别保留证据，真实回滚仍未执行。

后续最新ui7已实际启用，继承输入／看图修复，增加自动输入高度及移除左侧三个工具；以上命令示例已更新到ui7候选。实际PID、12215文件核对、217＋10项交互范围见 [ui7记录](validation/2026-10-16-composer-auto.md)。本轮首次备份时资源管理器重新启动后台，工具主动中止替换，重试成功；升级期间不要重复点击启动器，不跳过并发启动保护。维护偏好快照包含image-window.json，回滚仍只恢复程序。

实际验证及缺口见 [维护验收](validation/2026-10-16-desktop-maintenance.md)，运行版本以交接文档的最新回读为准。
