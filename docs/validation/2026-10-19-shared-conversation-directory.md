# 共享会话目录后端候选验收

2026-10-19，用户明确双端同服同组数据同等读写，只同步思绪日记/随想/朝花及未来AI机器人，不要求电脑便签；置顶/归档/手工排列三项全部共享。先完成[既有后端核查](../COMPUTER-BACKEND-COMPATIBILITY-AUDIT-2026-10-19.md)，再补本轮共同缺口，没有重写已有业务域。

新增`conversation-services/directory.mjs`；现有app/route/catalog接固定目录与共享状态口，describe/saveConversation补description/idleHours读写与未知字段保留。所有业务行、目录namespace、状态、顺序及创建回执沿同一JSON mutate提交；新房默认legacy，不迁旧owner。程序设置/规则/原时原位编辑继续复用原领域实现。完整接口见[目录契约](../SHARED-CONVERSATION-DIRECTORY-V1.md)。

| 验证             | 结果                                                                                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 新目录纯业务     | 8/8；纯读不分配namespace、新建永久回执/重放/异文409、负字符串ID避碰、每房CAS、归档/恢复、全order CAS、固定旧朝花保护、未知字段                                                 |
| 既有邻近业务     | 30/30；会话消息/多slot设置、多实例规则与进度、原位重新编辑/撤回等；连同新8项见domain-tests.log，总38                                                                           |
| 隔离HTTP双调用端 | 8/8，http-test-final.log；同ID新建重试/重启、资料与程序绑定不碰列表版本、新房旧写口/回执、pin/archive/order CAS、真实消息/上传原件/AI登记参数归档后保持、锁/来源认证拒绝零写入 |
| 独立审查         | 另一Sol只读检查模块及8单测，未发现本轮可复现身份覆盖/数据丢失/事务漏洞；不拿重复运行凑新场景数                                                                                 |
| 静态检查         | 定向ESLint、Prettier通过；lint.log/format.log                                                                                                                                  |

46个不同Node场景分两组通过，全部隔离合成JSON/端口0；不是手机、WebView、正式双产品端或远程网络验收。HTTP helper已关闭自有服务，不启动或停止正式18765/前端预览/模拟器，不安装手机。正式backend-runtime指针继续chat-reedit2，冻结包未改；真实运行health没有新sharedDirectory能力。

产物`outputs/2026-10-19-shared-conversation-directory`含日志、后端补丁源快照/SHA和边界回执；它不是完整可部署运行包。原始核查证据在`outputs/2026-10-19-computer-backend-compatibility-audit`，与候选分开。

剩余硬门槛：桌面本机空房/列表状态的保留式注册、Android当前LegacySource与新版共享目录的稳定映射及固定桥/设置UI、同一业务提交到增量复制的耐久登记、长ID/原时原位替代链、日记分类/恢复/历史/评论、大正文payloadReadOnly及可信篇序索引、完整多实例客户端接线与未来AI执行器。双方均已收到逐项矩阵，当前源码和候选检查不能称两端已功能一致或已持续同步。
