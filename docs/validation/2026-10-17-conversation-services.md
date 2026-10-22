# 会话后端选择与多实例隔离验收

2026-10-17用户授权先做好后端接口，前端按文档接入，各会话规则、进度和评论独立；保留旧日记和已有记录。本轮只改后端/共享容量定义和测试，没有编译或替换前端UI、worker、原生桥。实际接口见[会话后端接口v1](../CONVERSATION-SERVICES-API.md)。

## 已实现

- 服务发现、实例创建、版本校验会话绑定/切换/解除、固定动作请求与REST；目前只有实际实现的revisit。
- 独立config/cursor/randomDays/deliveries/batches/comments与运行器；同源内容投递ID含实例范围，来源/媒体/评论不能跨实例误用。旧单例ID与路由算法保持兼容。
- 多实例共用原存储mutate队列；实例创建/绑定幂等，冲突409；未知数据版本409保留；没有删除旧实例接口。
- 活动且启用的实例随后台/正常解锁恢复；停A不影响B，解除绑定停止该运行器并保留进度。分类改名更新实例筛选和config revision，不重置历史关联。
- 按篇聚合各实例及旧单例评论的只读接口。原始日记/消息/媒体保持单份来源，评论不进入回看。
- 完整快照包含实例状态；带conversationServices的通用合并恢复暂时422明确拒绝，避免未实现ID映射导致丢失。实例不开放旧单例archive导入。

## 隔离证据

所有场景使用合成临时库，不以真实正文生成测试提交。

| 结果               | 证据及边界                                                                                                                                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 新增9场景通过      | `outputs/conversation-services/tests-final.log`：幂等/版本冲突/读不写、同源双实例身份、评论引用撤回/媒体越界、不同换日时间、解除重绑重开、独立运行器暂停/重启、认证/解锁恢复、并发事务、未知schema保护、分类改名；部分场景含多组断言 |
| 投递回归15场景通过 | `tests-final-affected.log`的既有revisit-delivery测试；当时新增7项亦通过，后来两项补测见最终9项                                                                                                                                       |
| 兼容28场景通过     | `compatibility.log`：default-category、richdoc-server、appearance，包括原备份/恢复与媒体路径                                                                                                                                         |
| 首轮广义回归74/75  | `tests.log`：仅既有24并发落盘测试遇Windows EPERM rename；原测试单独重跑通过`recheck-storage.log`，随后15项投递回归全部通过。未用重试改代码掩盖；不能写成首轮75全过                                                                   |
| 首次新增测试4/5    | `tests-first.log`保留：同秒来源的实例ID使排序不同，测试错误比较首条；改按同SourceRef匹配后通过，并验证对应来源的ID确实分离                                                                                                           |

相关代码定向ESLint/Prettier通过，结果见`lint.log`、`format.log`。按TESTING-POLICY未重复全项目UI/原生矩阵。

## 正式后台回读

正常保存/停止窗口后暂停旧运行器，建立私有全库快照并验证SHA-256，再核对监听进程/路径后重启D盘API。其他会话更新的ui25在过程中自行恢复；本轮start/status确认它仍ready，没有部署旧UI覆盖它。快照后至数据核验期间源数据保持一致。

- 2026-10-18T02:47:36Z重启D盘`server.mjs`；API0.9.24与package一致，`health.conversationServices={version:1,providers:[revisit],isolatedInstances:true,autoStart:true}`。
- 原朝花夕拾未调用start即自动恢复，runner waiting、lastSuccessAt有值且lastError=null；保留08:00/北京时间规则、2025-07-20历史日及原游标，游标单调前进。
- 3024 entries及media/messageStore/chatJournal/categories前后深比较与指纹相同。旧实例配置和每个既有日期/投递/组/评论原样保留；可选conversationServices仍未初始化。正式库没有创建测试实例、绑定或合成来信。
- ui25原生回执ready，116%字号、2屏档案保留；本轮只读确认/恢复，没有重新验收UI行为或安装哈希。ui25安装SHA证据属于另一会话的[会话管理验收](2026-10-17-room-management.md)。

回执：`outputs/conversation-services/receipt.json`、`before.json`、`after.json`、`api-after.json`、`api-restart.json`、`desktop-start.json`、`desktop-final.json`。PID均为当时快照，后续先重新status。

私有备份：`F:/<正式目录>/var/upgrades/conversation-services-2026-10-18T02-47-10-681Z`，真实正文留在私有原位置，不纳入源码包。普通产物`D:/拾页/outputs/conversation-services`，临时脚本/合成库`D:/拾页/tmp/conversation-services`。

## 前端仍需完成

前端按API增加固定服务桥和会话设置，worker按instanceId路由到稳定会话，不复用固定系统房。保留每条消息/草稿/outbox原实例身份；解绑/切换后仍按原身份回复，不能把旧评论重定向。两会话不同分类/换日时刻的真实收发、重开、引用/撤回及后台重启联调由前端接入后验收。本轮后端通过不代表该UI已安装；没有自动迁移旧单例。
