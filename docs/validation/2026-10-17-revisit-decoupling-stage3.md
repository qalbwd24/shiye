# 朝花夕拾解耦阶段3验收

用户授权：拆出推送与状态服务，保证不漏发、不重复；旧日记不动，仅隔离测试，不操作正在运行的窗口，并维护开发文档。主体源码和针对性隔离验证已完成，未部署。未调用正式API或桌面维护命令，未访问或改写正式diary.json。

## 拆分与数据保护

新增src/server/domain/revisit/delivery的state、configuration、planning、query、storage-port、service、archive七模块。旧revisit.mjs保留全部原导出，评论仍留待第四步；原路由转交服务。复用同一库的getDb/mutate；没有新增独立写队列、数据库、后台常驻或UI。源码和端口详情见[子项目3](../revisit/03-delivery.md)。

计划只读取输入库，生成自有冻结的nextState/result；提交先核对状态/来源版本令牌，再只替换db.revisit。正常服务在同一同步mutate回调内计划并提交。读分页返回深拷贝，调用者不能改写内存中的投递、发送者和固定组。原entries、messageStore及媒体均不被这些操作修改。

## 修复的边界

- 自动停机续推不再错误套用31天手动跨度上限，按最多一天推进至完整分钟末；31天限制仍用于手动补看。
- 一天的分段不切开分钟，防止同一分钟前后秒被自动投递成两个组。
- 系统时钟倒退到游标以前时等待追上，不退回游标或重复投递。
- 过期计划拒绝，源解析/引擎失败不产生部分状态，真实写入失败不提交投递/分组/游标，回执丢失后的重复命令安全去重。

首次起点、手动补看不推进自动游标、稳定ID算法和规则版本语义保持。改发送者不改变投递身份；规则/开关调整沿用新起点，旧组及评论目标固定。新导入/后来修复的历史来源需手动补看；无时间或不可见来源不是本轮自动投递范围。

## 兼容与针对性测试

拆分前源码保留tmp/revisit-decoupling/stage3/revisit.before.mjs、route.before.mjs。compare.mjs以原文件位置映射旧import，比较年/月/日×1/2倍、两种文本变体、自动/手动、整分/分中起点与1分钟/1小时/12小时窗口，共144组。完整db、首轮/重试结果及feed逐项deepEqual，原entries哈希保持。正常路径完全一致；长停机、每日边界、时钟倒退属于另测的修复路径，不宣称与原错误行为相同。报告compatibility.json。

tests/revisit-delivery.test.mjs新增15项：

1. 冻结输入、只读计划和提交只改revisit。
2. 源/引擎故障及非法窗口不创建半状态。
3. 来源正文版本/隐藏/分类、配置、评论或游标改变使旧计划409拒绝。
4. 75天来源、150条消息逐日续推，不受31天限制；150个唯一投递、75个完整组、序号连续。
5. 分中启动时只跳过启动前记录，次日日上限不拆开两条同分钟消息。
6. 开放分钟等待与系统时钟倒退保护。
7. 手动重叠/重试不移自动游标，31天上限继续有效。
8. 两个服务对象共用一个真实库，24路自动/手动并发只创建一次；分页、重开一致，读结果不可污染库。
9. 在已核对的随机隔离目录中创建空diary.json.tmp目录，触发真实writeFile失败；内存及原文件SHA保持。移除该已知空目录后重试一次成功，其后不重复。
10. 独立Node子进程提交后直接exit(23)，不返回成功回执；父进程重新打开库重试created=0。未创建任何GUI。
11. 发送者改变不重发；规则变动不重绑固定组与评论。
12. 状态包恢复原游标/ID/评论及先撤回墓碑，恢复后续推不重复。
13. 坏序号/组目标/ID/时间、坏来源/令牌及旧进度覆盖均拒绝。
14. 模块不直接依赖文件写入、HTTP路由、桌面或随想UI。
15. 隔离HTTP并发、状态GET/PUT导出与另一隔离库真实恢复、服务重启，原日记深度相同。

新15项及原引擎/来源/后端27项合计42项通过，日志focused-tests.log。最初新增15项单跑也通过，早期日志delivery-tests.log；最终结果以focused-tests.log为准。

## HTTP与状态归档界限

在tmp/revisit-decoupling/stage3/http及http-restore随机子目录启动临时回环服务；16路请求只投递13条预期消息。状态归档带有效评论及先撤回墓碑，导出后以目标新令牌恢复另一份相同来源库；保存state逐字段相同，源entries哈希一致。重启原临时服务后相同补看请求created=0、feed一致。报告http-isolation.json。

GET/PUT /api/revisit/archive走现有本地访问控制和串行事务；格式shiye-revisit-state v1只承载推送状态/引用及评论。checksum、来源精确指纹、序号/投递/组/评论关联均校验；不允许覆盖已有不同进度或评论。包中的targetToken仅供读取方获知该库当前状态，恢复时必须使用目标库新读取的expectedToken。

这验证的是同源快照状态恢复，不是通用备份合并。原通用恢复会改日记/媒体ID，其revisit映射尚未接入；普通open-data仍只输出日记，不附带状态包。缺少完整源库、已有新写入或ID重映射后的库会安全拒绝，不能据此宣称任意归档都能无损合并。

## 项目检查与未验范围

完整隔离测试618项中617通过、0失败、1桌面项显式跳过，日志all-tests.log。304模块引用检查和全库ESLint通过；本轮改动文件的格式单独检查，回执changed-files-format.log。所有测试显式设置SHIYE_TEST_NO_DESKTOP=1，禁止原生桌面测试。

npm run check首轮发现本轮新增测试的一个未使用import，已修正；最终check通过文件引用/ESLint，在并行文档docs/ANDROID-PROTOTYPE.md、docs/CHAT-PERFORMANCE-HANDOFF.md、docs/UI-PREFERENCES.md的格式告警处停止，未代改这些内容，也不声称全库check已通过。日志project-check-initial.log、project-check.log保留。没有部署/重启正式服务，不改变package版本，不使用产品窗口。

采用现有单进程串行copy-on-write和临时文件rename，未做多进程同时写同一文件、断电fsync、长期运行/大库性能或真实随想群聊UI验收。不把有限合成测试承诺为任何来源缺失/损坏/排除情况下的绝对投递保证。下一步评论服务尚未迁移。

产物outputs/revisit-decoupling/stage3；旧代码基线、比较脚本、随机合成库与临时Node进程验证在tmp/revisit-decoupling/stage3。开发接口/状态入口docs/revisit/03-delivery.md，跨主题引用同步F:/agent规范/软件技术路径/日记与消息统一内容模型.md。
