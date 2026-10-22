# 子项目6：独立运行器

2026-10-17最新替代规则：用户要求已启用服务随拾页后台自动恢复，退托盘继续、重启保留进度；已正式启用ui24与后台并通过25项定向及实际重启，见[AUTO-START](AUTO-START.md)、[回执](../validation/2026-10-17-revisit-autostart.md)。新增多会话各自规则与通用程序/AI接入规范另见[接入设计](../CONVERSATION-BACKEND-CONTRACT.md)，尚未实现多实例；下方第六步初版状态属于历史。

2026-10-17 第六步源码和隔离测试完成，正式后端、日常窗口及既有独立UI联调窗口未更新。UI会话继续前端，本模块只提供运行、认证、控制和状态；实际接入入口见[前后端契约](FRONTEND-BACKEND-CONTRACT.md)，验收见[阶段6](../validation/2026-10-17-revisit-decoupling-stage6.md)。

## 职责与目录

- `src/server/revisit-runner/client.mjs`：固定本机HTTP客户端、会话和响应检查。
- `src/server/revisit-runner/runtime.mjs`：独立可停止状态机、单飞调用、重试和追赶；可由不同宿主复用。
- `src/server/routes/revisit-runner.mjs`：HTTP宿主；正式服务已启用规则随后台自动启动，保留显式启动/本次暂停。当前仍为单例，多会话实例化另行适配。
- `tools/revisit/options.mjs`与`cli.mjs`：独立进程参数、stdin认证、JSON行宿主控制。旧`tools/revisit-push.mjs`保留兼容入口。

运行器不读写diary.json，不解析长文，不拥有游标/投递/评论。进度仍由推送服务通过原存储mutate提交。关闭UI不会清除服务端进度；服务端是否继续工作取决于已显式启动的宿主，不预选开机启动或窗口随启，也不实施云端同步。

独立CLI与API受管实例是两种可选宿主，UI不应同时启动两套定时器。即使误开多个运行器，后端串行事务和投递身份仍负责去重；本轮不提供跨进程单实例锁或系统服务管理。

## UI控制端口

| HTTP                             | 输入                    | 返回/约束                                             |
| -------------------------------- | ----------------------- | ----------------------------------------------------- |
| `GET /api/revisit/runner`        | 无                      | 运行状态；正式后台随已启用规则自动恢复                |
| `POST /api/revisit/runner/start` | `{intervalSeconds?:30}` | 5–3600秒整数；重复启动不创建第二个循环                |
| `POST /api/revisit/runner/stop`  | `{}`                    | 取消请求/等待/认证，等待终止后返回stopped；可重复调用 |

沿用现有本地来源检查和访问锁，锁定时返回401。启动不接收密码、令牌、任意URL或数据路径。UI先用既有解锁流程，再将当前会话交由后端私有内存使用；后端从请求socket确定自己的回环端口。状态不会包含密码、Cookie、源正文或媒体。修改轮询间隔须先停止，否则409；推送规则是否启用与运行器是否启动是两个独立状态。`/api/health.revisit.runnerControl===1`声明这些端口存在，版本号0.9.24本身不能证明正在运行的API已支持。

启动中的停止立即生效，不排队等待认证完成；并发启动共用同一任务，停止后旧认证回复不会再次启动。停止清除运行器内存会话，不调用`/api/lock`，因此不会把用户当前窗口锁掉。服务端关闭时停止其受管实例；正式后台重启自动恢复已启用规则，若有访问锁则等待正常解锁后自动继续。

状态字段：`protocol:1`、`running`、`state`、`intervalMs`、`consecutiveFailures`、`nextAttemptAt`、`lastAttemptAt`、`lastSuccessAt`、`lastError`、`lastResult`。时间为UTC ISO，UI按用户时区显示。`lastError`仅code及可选HTTP status；`lastResult`仅created/initialized/disabled/remaining/reviewCount/cursor。`running`表示希望持续运行，认证失效后可为true且state=locked，但没有任何重试循环；UI以state显示“等待解锁”，不能只用running显示正常运行。

| state                    | UI建议文案/行为                                      |
| ------------------------ | ---------------------------------------------------- |
| stopped / stopping       | 已停止 / 正在停止                                    |
| authenticating / running | 正在授权 / 正在检查推送                              |
| waiting / catching_up    | 等待下一轮 / 正在补齐未处理时段                      |
| disabled                 | 推送规则未启用；保持轻量轮询，启用规则后继续         |
| retrying                 | 连接中断或暂时故障，按nextAttemptAt重试              |
| locked                   | 等待正常解锁后自动续推；不保存密码自动登录           |
| unsupported / failed     | 接口不支持 / 已暂停；显示固定错误码，修复后显式start |

第六步初版未修改原生桥；后续ui21联调阶段已补齐`runner-status`、`runner-start`、`runner-stop`三个固定映射及既有设置按钮，仍仅独立候选，见[联调验收](../validation/2026-10-17-revisit-end-to-end-ui21.md)。禁止开放任意URL转发。收件轮询仍只负责feed，不自动调用tick或启动运行器。

## 认证与错误恢复

仅接受显式HTTP回环地址127.0.0.1/localhost加端口，禁止带账号、路径、查询参数、重定向或远程地址。每次请求默认15秒超时，响应最大1MiB，字段类型异常暂停而非当作成功；不把服务端错误正文写入输出。

独立进程可通过stdin一次提交密码；Cookie只保存在进程内存，停止清除，未写配置、日志或命令行。密码错误只提交一次，不自动重试；401清会话等待重新授权，403和不支持接口等错误暂停。后端重启会使旧会话失效，用户重新解锁后继续服务端原游标。现有访问锁是全库会话权限，不是新增“只准推送”的细粒度令牌；本轮不更换原认证体系。

网络中断、超时、429和5xx使用1秒起、通常最多60秒的指数退避和20%抖动；Retry-After可延长等待，最多24小时，防止计时器溢出。成功后重置失败次数；remaining=true表示积压未处理完，250ms后继续，不等常规轮询周期。调用在途时不再并行发下一轮。

不在本地提前推进游标。服务器已提交但响应丢失时，下一轮按同一服务器进度/投递身份去重；断线不重置初始时间，进程重启不重新按“今天已过去时段”初始化。首次没有游标仍遵循从启动时刻开始，过去时段手动补看。停止能取消长退避和请求；已提交的服务器事务不会被停止回滚，稍后通过状态/收件核对。

## 独立CLI

以下必须针对用户自行创建的隔离服务端口，不能照搬成当前日常服务地址：

```powershell
node tools/revisit-push.mjs --url http://127.0.0.1:18767
node tools/revisit-push.mjs --url http://127.0.0.1:18767 --once
node tools/revisit-push.mjs --url http://127.0.0.1:18767 --control
```

`--interval 30`设轮询秒数，`--from ISO --to ISO --once`手动补看，旧参数保持。`--once`仅输出一个兼容JSON汇总；失败只输出固定错误码并退出1。`--password-stdin`从stdin读取一行UTF-8密码直到EOF，再认证；可搭配once或普通运行，禁止写明文密码到命令参数/示例/项目文件。

`--control`初始停止；stdin每行一个JSON，响应带原id和ok/status，另有kind=status事件。支持以下动作，password仅通过私有管道传递：

```json
{"id":"a","action":"status"}
{"id":"b","action":"start"}
{"id":"c","action":"stop"}
{"id":"d","action":"exit"}
```

`unlock`动作另带password字段；成功后只有原来已start才自动续跑，停止后的unlock不偷偷启动。命令可并发，stop不被慢unlock阻塞；每行最多4096字符。stdin关闭或exit停止并退出，不遗留轮询进程。SIGINT/SIGTERM也取消工作；Windows强制终止不保证执行清理，但服务端已保存进度不依赖进程清理。

## 验收边界

本轮合成库覆盖真实HTTP认证、并发控制、停止/授权竞态、断线恢复、丢回执去重、超时、CLI认证与控制，源Entry/media/messageStore保持。未访问私人日记，未重启正式API、日常窗口或原UI试验服务。尚未验证长时间驻留、操作系统休眠唤醒、断电fsync、真实多端网络、系统通知；不能把后台通过写成UI按钮已经接好或部署完成。
