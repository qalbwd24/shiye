# 多来源资料后端接续

2026-10-19用户要求继续做好后端，不影响「安卓ui」。沿上一轮34源文件冻结候选继续开发；旧42 Node/20同步/47种子证据只覆盖旧候选，不冒充新源码已验证。

本轮补可执行的逻辑来源资料接收：独立偏好命名空间、便签现有exportDrafts正文/原件、聊天源的会话/消息快照。接口负责保真校验、稳定身份、原件与来源回执，不直接读取/修改正在运行的WebView profile；不需要前端会话改页面才能继续其UI工作。旧raw profile仍只作恢复归档，不能冒充完成跨端映射。

后端新plan统一形状：schema=1、sourceId、snapshotKind、snapshotRevision、records（既有product kind）、assets（明确hash/size/mime/字节）、coverage、issues。服务器生成实际信封revision，不信来源JSON的server revision或complete标记。相同来源/revision/hash重放幂等；同revision异内容拒绝，较旧快照拒绝；现有目标实体不同值不静默覆盖，资源与整个plan校验后才发布来源回执。

偏好快照仅生成readOnly profile，完整保留命名空间与未知普通键，已知凭据/设备私有排除，导入不自动应用壁纸/执行程序。便签沿既有试用快照保留，不擅自定义正式Note写权威或让其参加回看。聊天逻辑输入必须给稳定source/十进制字符串ID及明确墓碑，不导出本机withdrawal-recovery正文。

并行文件所有权：偏好/便签各自新module/test由Sol处理；根负责聊天plan、来源接收服务/定向HTTP集成、契约和收尾。另一Sol仅处理原生payload写口及其候选测试；共享MainActivity/LocalStore和全部页面仍由前端拥有。本轮不安装手机、不控制5554、不切正式chat-reedit2，不发布UI APK。资料完整标志在来源捕获/关联/原件逐项验收前保持false。

本轮已分阶段完成106项不同Node定向（33编译器、12来源HTTP、7大正文策略、30共享store/server、24既有product/seed）以及31实际Android断言（21本地＋10HTTP）。先104项全过，随后前端补充图片宽度数组namespace，新增2项并定向回归最后21项全过；相关未变源码结果复用。原生QA源码逐SHA冻结。真实第二op故障注入确认业务行/receipt/ledger整批回滚，来源大profile可packed→inline完整替换，种子包含设置/便签原件；实际Android验证上传/ACK重放/另库下载还原/真实CAS409阻塞且保留本机内容。未跑全库UI/真机上限或压力。

独立审查发现旧chat/room全会话重制会剥离来源只读标记，已限制当前房提交；保护区分sourceSnapshot与旧消息readOnlyProjection，原有业务撤回保持。早期相邻回归因此失败2项，修复后最终104全通过，不隐藏中间失败。QA首次HTTP fixture因缺blockId在APK构建前失败，修正仅合成fixture；两次不同QA探针各一次显式安装，没有自动重试或启动安装循环。

HTTP Android进程加载的service版本与最终service仅一处readonly→sourceSnapshot保护判定不同，完整旧SHA可精确重建核对；CAS/transport/storage/native源码未变，31项按相关范围复用，最终Node覆盖新guard和旧业务撤回。最终QA本机代码SHA全部一致，不能把这个范围复用说成手机或整包最终UI验收。

固定接口、限制与错误语义见[SOURCE-SNAPSHOT-INGESTION-V1](SOURCE-SNAPSHOT-INGESTION-V1.md)与[PRODUCT-PAYLOAD-WRITES-V1](PRODUCT-PAYLOAD-WRITES-V1.md)。产物`outputs/2026-10-19-backend-source-snapshots`，临时`tmp/backend-source-snapshots`。专属5580、19421合成服务及转发已正常清理；正式ui48/chat-reedit2指针保持，手机和前端5554未由本轮操作。实际WebView偏好捕获、正式电脑持续登记、前端新写口/冲突页接入与完整电脑覆盖未接，不冒称全部数据已可正式同步。
