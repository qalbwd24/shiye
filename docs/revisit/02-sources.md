# 子项目2：数据来源适配

2026-10-17 用户授权第二步已完成源码拆分和针对性隔离验证，全项目检查结果见[验收](../validation/2026-10-17-revisit-decoupling-stage2.md)。未部署，不操作正式日记或运行窗口。

现有入口src/server/domain/revisit-sources.mjs保留兼容；新目录revisit/sources/按存储读取端口、日记适配、聊天适配、目录/引用索引与展示投影拆开。每次读取捕获一份独立只读快照，快照只供当前读取使用；新的读取重新捕获分类、标签及可见性。候选缓存不得让外部修改影响后续结果，媒体元数据变化应失效。

负责把真实存储转换为SourceCatalog：稳定SourceRef、原事件时间、分类/标签/标题等实时属性、只读内容解析接口及复核问题。长文手打时间和媒体插入时间分开；旧独立附件使用原日记编辑时间并保留推定来源。旧日记不写回、不导入未确认的转换候选。

向引擎只给ref/eventTime/category；向阅读接口按ref解析原文与媒体。HTML/Markdown气泡预览是展示适配，不应成为回看规则或权威正文。

## 模块与端口

目录为src/server/domain/revisit/sources/：

| 文件              | 职责                                                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| library-port.mjs  | createLibrarySourcePort(readLibrary)，每次capture只调用一次读取函数，复制并冻结条目/媒体/规范消息，建立条目与媒体索引，封装撤回判定；没有写库接口 |
| diary-adapter.mjs | createDiarySourceAdapter，复用readDiaryCandidate及旧格式转换器，只在内存生成旧长文/richdoc候选，不导入、不生成第二份权威正文                      |
| chat-adapter.mjs  | 保留规范聊天消息，按稳定来源/会话/消息编号补齐尚未采用规范格式的旧消息；转换使用独立空内存库，绝不调用正式存储mutate                              |
| catalog.mjs       | createSourceReader(port).capture()，形成只读SourceCatalog、来源引用索引和本次读取会话                                                             |
| presentation.mjs  | presentRevisitSource、readSourceEntryHtml、sourceMediaIds；统一来源气泡、整篇只读HTML、媒体白名单，渲染不再写在来源枚举或HTTP路由中               |
| identity.mjs      | 原摘要和旧内容指纹算法、深冻结及聊天坐标键；不改变既有SourceRef                                                                                   |

读取会话返回version=1、catalog={sources,issues}、resolve(ref)、readDiary(entryId)、asset(assetId)。每个source仍为{ref,unit,entry}，unit是已有MessageUnit/richdoc，entry携带本次读取时的分类/标签/标题。引擎仍只接收ref/eventTime/category。

现有revisit-sources.mjs变为兼容层，原digest/readRevisitDiary/revisitSources/resolveRevisitSource/presentRevisitSource导出保持。新增openRevisitSources供路由在同一请求内解析来源、整篇和媒体。feed仍用原目录参数，通过WeakMap复用目录索引；不持久缓存整个来源目录，不要求UI修改接口。

## 生命周期与保护

- 一次capture是某一时刻的自有只读快照，不是长期授权。分类、标签、隐藏/草稿/删除、撤回改变后，下一次操作必须重新capture；禁止把旧会话跨请求长期保存。旧catalog参数表示明确使用该次快照，和无参数的新读取区分。
- 候选缓存最多约96 MiB序列化字符估算量，非进程内存上限；缓存私有冻结副本，对外返回独立候选。缓存键含完整条目及媒体元数据指纹，覆盖旧格式标记、布局版本和非附件区的内嵌资源。标题/分类等修改不会改变SourceRef，但会使转换缓存失效。
- 旧长文候选引用沿用内容指纹；正文变更后旧引用不可用，分类/标签/标题变化仍指向同一内容。已采用规范格式的消息保持原unitId，不重新编号。
- 老独立附件仍置于开头，真实insertedAt=null，eventTime按原内容编辑时间兜底并注明推定；新图片/视频继续使用真实插入时间，不借文字标记覆盖媒体时间。回复及媒体assetId/occurrenceId保持。
- 撤回登记和聊天投影里的撤回标记现在也检查已有规范消息，避免状态尚未同步时从旧规范正文读回。隐藏/删除/草稿在建目录时排除，评论永不进入来源。
- 无可用UTC事件时间产生source-time-unavailable并排除该单元；不让非规范日期破坏整次引擎调用。已标记规范存储但缺全部或部分ID产生source-canonical-units-missing，不降级重建另一套编号。转换异常为source-adaptation-failed，旧转换器的逐项复核码继续保留。
- 不支持的历史附件/排版继续报告复核且保留原件，未在此步扩展编辑器格式。HTML须由前端sanitize，来源适配不是安全HTML白名单。

路由继续负责媒体文件路径、分块读取和本地请求校验；来源层仅返回媒体身份和元数据。本轮不改变API路径、数据库字段、事务提交或定时推送方式。

完成标准：新旧来源给出一致的规范引用；只读前后源对象一致；源正文变更不会让旧位置编号误指其他内容；隐藏或撤回内容不会从旧展示缓存中读出。此阶段不涉及桌面或正式数据迁移。

证据目录outputs/revisit-decoupling/stage2；临时旧代码基线、合成库和比较脚本在tmp/revisit-decoupling/stage2。32组/416来源的正常路径输出与拆分前逐项一致；撤回补查、严格UTC及缺失规范记录诊断是另行测试的保护改进，不把这些异常路径声称为旧行为完全相同。真实全库规模性能和桌面/手机UI不在本轮验收范围。后续推送状态的实际进度见[子项目3](03-delivery.md)。
