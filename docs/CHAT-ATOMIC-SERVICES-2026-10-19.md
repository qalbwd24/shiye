# 原子程序设置与消息切换适配

2026-10-19。本轮由主会话规划与审核，GPT-6.1-sol中实施，Astra中复核核心契约。参考 `E:/deepseek harness/outputs/2026-10-19/shiye-perf/开发建议-聊天消息与页面切换.md` 已通读；其中性能数字、技术路线不作为本项目当前实测或迁移指令。

## 当前交付阶段

最终已合并原位编辑为ui48并标准安装启用，native ready `2026-10-19T12:20:45.1301665Z`，116%/两屏保持；指定后端会话已先独立发布chat-reedit2，来源缓存与两个新能力均1。普通房仍legacy单写，AI仅登记，统一owner/执行器未启用。最终[验收和运行边界](validation/2026-10-19-chat-message-reedit.md)覆盖本页候选阶段，以下ui44/ui45文字保留调查顺序，不代表当前运行版。

ui44已运行，修复即时发送1→2→1。ui45候选完成原子settings、多个slot/参与者、external-program登记、sourceId原子初始化和切房重复预取收敛。候选17真实C#固定桥、11实际隔离浏览器服务场景、5实际即时发送场景通过；18端口/UI、9journal/身份、7统一接缝及8后台HTTP场景定向通过。切房另8项及真实wheel锚点通过。未执行全套。

ui45尚未安装：用户随后追加撤回/编辑需求，合并到下一候选一起发布，避免重复重启。运行版本仍须重新status核对。

同时发现共享后端正在出现额外并行改动（来源session-cache与runtime-release选择器），已经中止原定的后台重启准备，尚未停止旧API。重启前须核验完整测试来源，不能把其他会话未完成源码一起加载。此前106模块/11变化都匹配后端交付；复查为108模块/15变化，其中5路径尚不在该交付清单，证据 `outputs/2026-10-19-chat-atomic-services/api-source-graph.json`。

## 已实现内容和约束

- 普通房实际health同时具备atomicConversationSettings与conversationMessaging才允许保存；单次settings/save原子提交，不再create/bind/config分步保存。旧固定房兼容桥保留，旧进度不迁。
- 同房多程序按显式slot/binding管理。旧ui44无目标调用复用唯一旧随机binding；多个binding要求明确选择。外部程序/AI只登记角色与公开参数，不代表执行器已接入。
- 409、慢读取遇新输入均保留草稿。隐藏模式字段不参加浏览器验证，保存结束后仍保持正确disabled状态。
- sourceId在同一IndexedDB readwrite事务get-or-create，事务提交后才暴露，避免首次双窗产生不同会话身份。
- 统一消息模块只交付固定接口、原子store契约、幂等outbox、墓碑和作用域保护；尚未接实际worker所有权交接，普通房仍旧journal单写，不自动切messageOwner。

## 参考建议采用情况

已有本地乐观渲染、Teact keyed diff、消息slice与视口缓存，未重建虚拟列表或照抄Android整段渲染分析。稳定请求身份去重沿用ui44；不以正文/名字去重，不在409后改ID或时间重发。

切房在真实局部worker读到短方向页后停止紧接的budget预取，保留Around刷新。七次热切查询21→14，实际wheel离底450px再切回，锚点top差0px。ui45小样本首绘31.6–77.6ms，较ui44这次样本更慢，不能把减少查询写成已证明首绘提速；不能承诺物理120FPS。

产物 `outputs/2026-10-19-chat-atomic-services`，临时 `tmp/chat-atomic-services`；冻结构建 `tmp/diary-paragraph-messages/build-web/.ui45-atomic-services`。未将参考文档的173ms当当前实测，未改为SQLite/追加日志。
