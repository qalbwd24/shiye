# 朝花夕拾解耦阶段2验收

范围：用户要求继续抽离数据来源适配，旧日记不动，新旧格式正常读取，仅隔离测试，不操作正在运行的窗口。源码与针对性隔离验证已完成；未部署。此任务没有访问正式diary.json、调用正式API或执行桌面维护命令，也未重建全部历史候选。

## 实际变更

- src/server/domain/revisit/sources/新增library-port、diary-adapter、chat-adapter、catalog、presentation、identity六模块。存储读取、旧格式候选转换、来源筛选/引用索引、展示投影分别维护，端口无写入方法。
- 原revisit-sources.mjs保留全部旧导出。新openRevisitSources提供一次操作的只读会话；feed/评论复用原catalog参数与索引，source/media路由共用同次快照，不重新解析另一份实时对象。
- 原SourceRef、稳定规范unitId、候选内容指纹、UTC时间、媒体assetId/occurrenceId、replyTo及HTTP路径保持。分类/标签/标题不进入旧内容指纹，每个新操作读取实时属性。
- 旧长文候选转换不改原content/body/未知字段；旧附件在开头、insertedAt=null、事件时间使用原内容编辑时间且标记edit-fallback。新图片/视频用真实插入时间。评论不作为回看来源。
- 候选缓存存独立冻结副本、返回可独立修改的候选。键包含完整条目和媒体指纹，覆盖非附件区内嵌媒体、旧格式标记和布局版本。读取结果冻结，不能借返回值污染后续读取。

## 正常路径兼容证据

拆分前保存了本地来源/路由源码副本。tmp/revisit-decoupling/stage2/compare.mjs将拆分前来源代码的相对import映射回原项目位置，与当前实现逐项deepEqual，不依赖已运行产品。

合成夹具包含旧HTML/Markdown、手打时间与换行、旧独立附件、richdoc候选、新规范消息、图片/视频插入时间、部分规范聊天/回复、撤回投影、隐藏/删除/草稿及未知旧字段；共32个文字变体、416条来源。完整catalog、每条展示和各非聊天条目的只读候选均与原实现相同，源db对象读取前后哈希相同。它是同一组格式夹具的32个变体，不表示覆盖了32种独立格式或重新抽查了真实日记。

报告outputs/revisit-decoupling/stage2/compatibility.json。拆分前源码保留在tmp/revisit-decoupling/stage2/revisit-sources.before.mjs与revisit-route.before.mjs。

## 单独验证的保护改进

以下异常路径不声称与原漏洞行为一致：

1. 规范消息仍是active但撤回登记或聊天投影已撤回：新读取排除，不通过旧规范正文复活。
2. 非规范UTC事件时间：列source-time-unavailable并排除单元，防止带偏移/无时区文本进入严格引擎契约导致整批异常。
3. 条目标明规范存储但缺全部/部分消息ID：列source-canonical-units-missing，不降级重新生成另一套ID。
4. 调用方修改候选、资源元数据改变、相同ID的另一库、布局版本变化：缓存不被污染、不跨库串内容。

tests/revisit-sources.test.mjs覆盖一次读取端口、冻结原件、快照一致性/新分类标签、旧引用失效、缓存/驱逐、媒体时间/链接、部分聊天/回复、隐藏删除草稿/撤回、复核异常、评论排除、依赖边界和隔离HTTP。历史格式本身未扩展，不支持的音频等继续列复核并保留原文件与属性。

## 隔离后端与文件保护

在tmp/revisit-decoupling/stage2/http下生成随机独立合成库、媒体字节及预生成回看投递，开启随机回环端口。只请求feed/source/media并测试越界媒体拒绝；逐条读回旧文、新消息、图片/视频的字节。启动前和读取后diary.json及全部媒体SHA-256完全一致，原entries深度相同。独立后端随后关闭，无产品窗口参与。

报告outputs/revisit-decoupling/stage2/http-readonly.json。这里证明合成隔离库读取无改写，不声称正式数据已迁移或已做全量重算。

## 检查结果与界限

针对性共27项通过（新增来源12项、引擎6项、原后端9项），日志focused-tests.log；完整隔离测试603项中602通过、0失败、1桌面测试显式跳过，日志all-tests.log。项目检查显式设置SHIYE_TEST_NO_DESKTOP=1，禁止原生桌面测试干扰用户窗口。

首轮npm run check在本轮需求文档末尾空行格式处停止，已修复；后续检查的295模块引用和ESLint均通过，完整check停在格式检查，未声称整体通过。检查中并行新增CHAT-PERFORMANCE-HANDOFF、CHAT-ROOM-SWITCH及共享交接文档出现告警；共享交接仅归一LF换行且保留全部并行内容后，本轮所有修改文件的格式检查通过，另两份文档仍告警，未代改。已单独完成上述602项测试。

证据：project-check.log（全库check格式未过）、project-check-initial.log（首次末尾空行）、project-check-parallel-docs.log（并行文档告警）、changed-files-format.log（本轮文件全部通过）、all-tests.log（602通过/1跳过）、focused-tests.log（27通过）。这些日志均在outputs/revisit-decoupling/stage2，不把仅语法/合成检查当作正式运行验收。

不改package版本0.9.24，不启停正式服务，不操作桌面、不编译/启用随想候选。没有实测桌面/手机呈现、中文IME或全库规模的CPU/内存；快照和候选缓存仍有内存成本，96 MiB只是缓存序列化估算预算，不是进程内存保证。旧快照不可跨请求当成长期访问授权，后续操作必须重新capture。

下一步是推送/状态服务解耦，尚未实施；评论、随想接入、运行器仍沿用现有实现。产物outputs/revisit-decoupling/stage2，临时tmp/revisit-decoupling/stage2，接口说明docs/revisit/02-sources.md；主题引用同步F:/agent规范/软件技术路径/日记与消息统一内容模型.md。
