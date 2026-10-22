# 子项目4：评论与上下文

2026-10-17 用户授权第四步，主体源码已拆出并完成针对性隔离验证，未部署。目标解析、正文、事务/撤回与按篇查询服务放入revisit/comments/，保留revisit.mjs兼容入口及旧API。只做数据层和隔离测试，旧日记不动，不操作现有窗口。最终检查见[阶段4验收](../validation/2026-10-17-revisit-decoupling-stage4.md)。

新增要求沿用：显式引用回复单条，不引用评论输入时选定的一组，不随后来推送或规则变化重新绑定；评论不进入回看。冲突operationId重试将明确409拒绝，撤回标记优先于迟到发送；查询返回独立副本，防止调用方污染原关联。

负责固定评论对象、MessageUnit/richdoc保存、实际发送与接收时间、重试幂等、撤回标记和按篇聚合。显式引用对应一条；无引用对应输入时选定的一组；媒体位置用occurrenceId补充。评论不进入未来回看。

## 模块和端口

| 模块            | 职责                                                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| context.mjs     | resolveCommentContext解析显式选定组/单条/媒体位置并冻结副本；assertStoredCommentContext校验既有记录，不按当前新组重算           |
| content.mjs     | 旧text API转共同richdoc；校验text兼容缓存与body完全一致，保留中文、空格、表情及空行                                             |
| persistence.mjs | planRevisitComment/planRevisitWithdrawal只读生成命令；commitCommentPlan核对状态/来源令牌，在同一mutate内仅改db.revisit.comments |
| query.mjs       | commentsForEntry返回按篇的独立副本；describeCommentsForEntry标注本篇具体消息/媒体出现及当前可用性                               |
| service.mjs     | createRevisitCommentService(port,{clock})，context/add/withdraw/forEntry/describeForEntry，复用第三步同一存储端口与全库串行队列 |

旧revisit.mjs仍导出addRevisitComment/commentsForEntry，新增withdrawRevisitComment供内部调用。评论不写入Entry.comments，也不复制进messageStore；统一消息读取器从db.revisit.comments只展开一个权威评论。多篇共用同一条评论，只按targets投射读取。

## 已确认的上下文规则

- 输入必须带用户选定的batchId；未引用时使用该固定组全部targets，不按发送时刻的最新组猜测，也不因后来推送抢走草稿目标。
- 显式deliveryId须属于选定组，targets/replyTo/commentOn由后端从该投递生成，引用只回复这一条；客户端自带的关系数组不覆盖后端结果。
- 图片/视频须在上述引用上指定occurrenceId，必须是该消息中的实际出现。相同文件的另一次出现仍是另一位置；不以assetId或显示索引替代。
- 选定来源不可见、被撤回或旧正文快照改变时，新评论409拒绝，不偷偷删去失效目标后保存缩小的一组。已有评论的targets/replyTo/commentOn保持，按篇查询可标available=false，不自动重绑另一段。
- 改间隔、分类、标题、标签、发送者或增加新推送，不改写旧评论关联。分类/标题显示从当前来源解析；持久引用使用原稳定SourceRef。

## API和展示准备

- 原POST /api/revisit/comments接收operationId/batchId/text，可选deliveryId/occurrenceId/sentAt；201响应形状保持。
- 原POST /api/revisit/comments/withdraw仍按operationId撤回，200响应保持。
- 新POST /api/revisit/comments/context：传同一选择，返回version=1、scope=group/message/media、固定targets/replyTo/commentOn及当前条目标题/分类/标签，供后续输入框目标提示/切换使用；只读，不保存草稿或目标配置。
- 新GET /api/revisit/comments?entryId=...：按篇返回comments，每条额外context仅注出当前篇的目标及available；共享组评论ID在各篇相同。隐藏/草稿/删除或不存在的篇返回空列表。
- 既有POST /api/revisit/source的comments字段继续原数组形状，内部改调评论服务。没有创建新页面或改动桌面界面；主页面板、媒体评论按钮、头像编辑、输入框切换交互及原生只读思绪仍待第五步分项接入。

## 幂等、撤回、正文和时间

完全相同operationId与正文/组/引用/媒体位置重试返回原ID与时间；若明确sentAt则同一时刻才算相同请求。active评论同operationId更换正文或目标现在409拒绝，不再像旧代码那样静默回旧结果。重新编辑须撤回后用新operationId重发，不新增评论编辑API。

撤回把text清空、body置null、revision只增加一次，保留身份和固定关系。先撤回后发送会留下与旧API相同的无正文墓碑，迟到发送只返回withdrawn，不写回原文；同源状态归档保留墓碑。写入失败全部回滚，过期计划409；服务和推送共用同一个mutate队列，不在单独队列中竞争同一JSON。

原text字段输入生成唯一richdoc正文；CRLF/CR按段落归一而text缓存保留原输入。Markdown符号仍按旧API保留字面值，不在此步骤更换解析器或开放任意富文本写入。assertCommentContent同时检查统一消息、可渲染正文和缓存一致性。createdAt/eventTime是实际发送时刻，receivedAt是本次服务接收时刻；手打正文时间不改变这些字段。

评论origin.kind=comment，来源目录及回看引擎输入不包含它；长文时间解析也不读取评论。带手打日期的评论以及归档重开后仍不参与回看。

## 同源归档和证据

第三步状态归档已复用本模块内容/关联校验：不仅检查targets，还核对replyTo/commentOn/origin归属及text/body一致性，重算checksum也不能把关联改成无关消息。已有有效评论/撤回墓碑保留；只支持精确同源状态包，通用备份合并的来源ID重映射仍未接入，不能声称全库任意合并恢复已实现。

96组合成旧实现对照，按operationId归一随机评论ID，其余正文/关联/时间/重试/按篇查询/最终状态逐项相同。新增18项及原42项合计60项针对性回归通过；冲突重试、查询防污染及隐藏篇过滤属于另行测试的保护改进。产物outputs/revisit-decoupling/stage4；临时旧源码、比较脚本和隔离库tmp/revisit-decoupling/stage4。下一步为随想接入，当前未部署本轮任何窗口。

完成标准：改间隔/分组后旧评论关联不变；多篇共享组评论只保存一个权威主体；按任一来源篇能读到该评论并标出对应消息/图片；先撤回后晚到重试不恢复原文。头像、媒体评论按钮与主页面板当前仍未完成。
