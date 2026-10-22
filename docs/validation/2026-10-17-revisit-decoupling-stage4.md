# 朝花夕拾解耦阶段4验收

授权：拆出评论与上下文服务，引用回复单条，不引用评论选定组；关联不变、评论不参与回看。只做数据层/隔离测试，旧日记不动，正在运行的窗口不操作，更新开发文档。主体源码与针对性验证完成，未部署；没有调用正式API、桌面维护命令或访问正式diary.json。

## 源码和数据边界

src/server/domain/revisit/comments/分出context、content、persistence、query、service五模块；revisit.mjs仅保留兼容导出。原POST评论/撤回路由改调服务，source返回评论数组形状保持；新增只读context预览和按篇带目标注释的GET接口。详见[接口及职责](../revisit/04-comments.md)。

复用第三步存储端口与全库同一mutate队列。创建和撤回先在内存生成自有冻结计划，提交验证状态/来源令牌，只改db.revisit.comments；不改Entry、messageStore或media，不把共享组评论复制到每篇。旧评论数据没有扫描重写或迁移。

引用只保存该delivery.ref；未引用按提交的batchId固定targets，不查最新组。媒体使用occurrenceId。正文与text缓存、targets/replyTo/commentOn/origin归属一起校验；归档导入同样复用这些规则，防止恢复时改绑。撤回清除正文、保留关系，未知operationId的先撤回墓碑阻止迟到发送。

## 兼容对照

拆分前副本tmp/revisit-decoupling/stage4/revisit.before.mjs、route.before.mjs保留。compare.mjs按原目录解析旧import，使用完全虚构的旧HTML/Markdown、新richdoc/规范消息与图文来源；2变体×单条/组/媒体×4正文样式×2时间偏移×显式/默认发送时间，共96组。

仅将每次生成的随机评论ID按operationId归一，所有其他持久字段、正文、时间、回复/媒体关联、精确重试、改规则后按篇查询与最终db均deepEqual；源Entry/messageStore哈希保持。报告outputs/revisit-decoupling/stage4/compatibility.json。它是合成格式回归，不是本轮重新读取真实日记。

以下保护改进单独测试，不声称与旧错误行为相同：active操作ID携带不同正文/目标改为409；查询/写入结果不再暴露存储可变引用；隐藏/草稿/删除篇的直接评论查询返回空；归档校验正文缓存和更细的关联字段。

旧tests/revisit.test.mjs有一项曾故意换目标和正文重试并期待旧结果，按上述显式协议改为精确重试返回原ID、冲突重试409。初轮发现这一旧预期差异；新测试的缺省组夹具也已修正为明确不带选中组。两项不是通过忽略失败放行，最终都重跑。

## 针对性回归

tests/revisit-comments.test.mjs新增18项，加前三步42项共60项：

- 显式引用/整组选定、后续新推送/改规则不偷换草稿对象；客户端自带targets/replyTo/commentOn不覆盖后端选择。
- 未选组、跨组引用、未引用却指定媒体、隐藏/不可用成员拒绝且无半状态。
- 图片与视频出现编号保留；媒体后来缺失可available=false，原关联不替换。
- 跨篇组评论只存一次，各篇同一评论ID，统一消息读取只展开一次；源条目/媒体/规范消息不改。
- 中文/emoji/空格/空行/混合换行/Markdown字面值保持，text/body分歧拒绝。
- 相同操作重试不改ID/发送/接收时间；更换正文/组/单条/媒体/显式sentAt均409。
- 返回结果修改不污染存储；普通撤回不重复增版本，先撤回再迟到发送不恢复正文。
- 只读冻结计划与过期创建/撤回计划冲突；旧来源改变后保留关联、标不可用，分类标签改名不重绑。
- 手打时间的评论在重开、归档和下一年回看窗口内均不成为来源。
- 重算归档checksum后伪造text/replyTo/commentOn/origin仍拒绝，先撤回墓碑往返保留。
- 两个服务对象共享真实库，20路创建重试只有1条评论，撤回与10路晚到重试不复活，重开后仍1条。
- 隔离已核对的随机目录中创建空diary.json.tmp阻止真实写入；失败前后磁盘SHA和内存相同。只删除该已知空目录后重试只保存1条。
- 模块不依赖UI、路由、文件写入或调度器；隔离HTTP预览、创建、按篇读取、冲突、撤回及重启覆盖真实路由。

最终针对性回执focused-tests.log；兼容报告compatibility.json。后续补充的图片/视频、客户端关系忽略等断言也纳入完整测试。

## HTTP和源保护

tmp/revisit-decoupling/stage4/http随机合成库、临时回环端口，测试后关闭；POST context返回选定固定组，POST评论201、冲突409，GET按篇注出当前篇的消息目标，原source接口仍能取到同一评论。重启临时服务后精确重试保持ID，撤回后再重试仍withdrawn。

读取落盘结果确认源entries/messageStore/media组合SHA与初始相同，评论targets与选定组深度相同，撤回body=null。报告http-isolation.json。没有真实窗口、剪贴板、热键或IME操作。

## 全项目检查和未验范围

完整隔离测试636项中635通过、0失败、1原生桌面项显式跳过，日志all-tests.log；311模块引用检查和全库ESLint通过。npm run check在并行文档docs/CHAT-PERFORMANCE-HANDOFF.md、docs/UI-PREFERENCES.md的格式告警处停止，没有代改，也不声称全库check已通过，回执project-check.log。本轮修改文件的格式单独检查见changed-files-format.log。

所有测试设置SHIYE_TEST_NO_DESKTOP=1。没有构建/部署随想、重启正式后端或改变package版本；新接口只在隔离服务中验证，不表示运行进程已经启用。

文本输入API仍按旧协议产生字面段落richdoc，不在此步替换Markdown解析器。主页面评论面板、聊天输入框提示/切换、头像和媒体评论按钮尚待第五步UI接入；本次是后端准备，不称UI已经可用。普通Entry注释API不迁移，旧日记正文/评论不动。第三步同源状态恢复已覆盖评论，通用备份合并ID映射仍未接入。

单进程串行事务已验，未验证断电fsync、多进程共写、长期运行及真实全库规模性能。产物outputs/revisit-decoupling/stage4；临时旧代码/比较脚本/合成库tmp/revisit-decoupling/stage4；跨主题引用F:/agent规范/软件技术路径/日记与消息统一内容模型.md。
