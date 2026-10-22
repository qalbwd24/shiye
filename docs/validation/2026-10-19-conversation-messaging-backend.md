# 会话参与者与消息后端验收

2026-10-19。本轮按用户中途收口只做后端和交接文档，**没有改UI，没有更新或重启正在运行的API/窗口，没有写正式库**。先前开始的ChatJournalBridge.cs/shiye-journal.js改动已逐项撤回并核对原ui42 SHA；未接入客户端草稿已移到tmp，不进入产品或发布包。

收尾再次核对时，共享目录中的ChatJournalBridge.cs已出现service-catalog/create/bind/request映射，shiye-journal.js也在接services模块，SHA已与ui42不同。这是撤回后出现的并行改动，本轮保留，不再覆盖或纳入后端验收。它们目前的四个低层动作仍缺本原子settings与conversations固定动作，接入方按新API继续；本轮不声称这些共享前端源码当前仍等同ui42。

## 后端源码交付

- 原子设置/read/save：一次事务创建实例、绑定并保存参数；同槽位同身份、双窗口CAS、幂等重试、无部分提交。纯开关保留checkpoint，规则变化仍按既有语义开启新规则窗口，历史不删。
- 会话状态和actor：个人记录/群聊资料、本人和多个程序参与者；同一会话可同时接入多个朝花夕拾及外部程序/AI。实例永久归属原会话，解绑/换绑不丢旧来源。
- 统一收发：本人/程序/AI同一种普通消息口，复用chatJournal和canonical richdoc unit；支持Markdown、媒体引用、普通回复、重试、撤回。AI仅作为外部参与者角色和消息通道，不包含模型调用。
- 只读历史投射与固定评论：引用单条/媒体或输入框选定组，冻结SourceRef；跨实例/跨房间目标拒绝。来源显示与媒体仍经既有校验端点，评论不参与回看。
- 按lane增量收件：会话绑定游标、跨实例/房间防串、稳定消息ID与同时间序号、撤回/隐藏redactions。页内排序不冒充全会话时间分页；旧正文真实修改的全部重验需新一轮读取或来源访问，未替代多端同步协议。
- 旧固定朝花夕拾使用`legacy-revisit`别名直接读取原db.revisit，既不搬迁也不新建实例/重发；旧来源、评论及游标保留。

新后端入口为[CONVERSATION-MESSAGING-BACKEND-API](../CONVERSATION-MESSAGING-BACKEND-API.md)，明确列出原生/worker/UI接入要求、数据所有权切换、权限边界与未实现事项。新的会话消息口只有在显式切换messageOwner后启用；旧journal写口被拒绝，防止双源写入。**本轮没有执行正式切换**。

## 实际验证

新`tests/conversation-messaging.test.mjs`含8个HTTP/真实存储集成场景：

1. 读取不写库；并发重复接入只建一个实例；窗口过期保存409；坏配置失败原子回滚，原旧日记/媒体/单例保持。
2. 同一群聊两个实例、另一群聊独立；暂停/解绑/重接/服务器重开保持配置、原实例ID、游标和原投递。
3. 本人与程序同格式canonical图文与回复；同一时间按序号排列；发送重试不重建，变内容409；跨房/跨actor拒绝；撤回只留墓碑，旧append/withdraw写口不能绕过。
4. 单条/组评论与程序署名，脱离当前绑定后原目标不改；多lane小页去重并读完；评论不进回看，程序署名评论仍通过既有状态归档校验。
5. 外部程序/AI只保存参数和使用消息口，不启动朝花夕拾scheduler或模型；开关停用新增，已成功请求仍幂等，重开参数/角色保留。
6. 精确图片occurrence评论、换绑后回复旧实例、原实例拒绝搬到另一会话；隐藏的普通消息清正文并给增量redaction。
7. 旧固定房纯读取零落盘，legacy虚拟身份不建新实例；旧来源、正文和checkpoint保留。
8. 接入使个人记录变group并增加资料revision；真实文件替换失败不产生半个实例或绑定，重试与重开恢复正常。

相邻验证选择会话服务、chatJournal、canonical消息/归档、评论、ui40待发ID优化及waiting preflight。最后共68个不同场景通过：首轮67/68，一项旧评论并发存储测试遇Windows `EPERM rename diary.json.tmp`，单文件18项重试全部通过；保留首轮失败日志，未因此修改底层文件替换实现，不宣称根因已查明。源码定向ESLint通过，格式检查另见产物记录。不是全项目或前端/原生窗口验收。

随后为程序署名评论补充归档校验，暴露旧validator只接受单例ID hash、不含实例前缀；按现有规划器的instanceId前缀补齐delivery/batch两处校验，错误实例作用域明确拒绝，旧单例空前缀保持原hash。影响到的8新集成＋18评论＋2归档共28项重新通过；其余40项沿未受该补丁影响的路径复用。源码原型中一次括号语法和旧provider单值断言已在正式交付前修正；新目录为两个实际provider，未把旧测试期望当产品限制。

## 运行与未验边界

本轮仅使用tmp下显式隔离dataDir和随机loopback端口，测试服务器结束时关闭。正式状态只读记录在`runtime-observation.json`：收尾为ui43/API0.9.27，客户端由并行工作升级，本后端新增能力开关仍缺少。本轮没有执行upgrade/start/restart或真实规则/消息写入。源package版本没有伪装成已部署新版本，客户端需按新health能力探测并等待后续部署。

尚未实现：原生桥/worker/客户端接线与端到端收件；真正AI执行器；外部机器人独立token/细粒度权限；WebSocket/系统通知；把本轮字段映射进独立同步产品库/安卓与云服务。现有库级认证不等于机器人隔离沙箱。通用备份合并带conversationServices仍保持原422保护，不能宣称多设备服务进度已迁移；完整原库快照与原位重启路径保留。

## 文件与产物

核心新模块：`src/server/conversation-services/settings.mjs`、`conversations.mjs`、`external-program.mjs`；原registry/host/固定路由和chatJournal/messageStore/评论持久层作必要兼容扩展。前端和原生源未交付改动。

产物`outputs/2026-10-19-conversation-native`：后端manifest、纯合成接口样例、运行只读观察和最终验证摘要。临时`tmp/conversation-native`：隔离库、测试日志和未接入客户端草稿。没有真实正文、凭据或正式数据副本进入公开测试样本。
