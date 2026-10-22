# 手机与电脑内容算法统一的后续接入

2026-10-18用户明确：安卓手机长期完整保存本地数据/文件，云端只负责与电脑同步；离线可写改读，本地保存ACK与同步状态分开。本地事务＋outbox、完整Entry/消息/原件/未知字段保留为后续框架约束，当前SQLite/私有媒体/TL IDB继续保留，不以未来缓存定位删除旧库。完整新Repository/可靠同步尚未实现。见[本地优先存储](ANDROID-LOCAL-FIRST-STORAGE.md)。本次为需求/架构记录，不改设备数据。

2026-10-18表情包后端衔接已部署：新增catalog与from-message，chat/unit来源核验后复用db.stickers，原消息/GIF/时钟/引用保持，多图明确选择、同资源去重/恢复。11收藏与15相邻回归、12条实际来源副本预检通过；正式API0.9.24 health.stickerCollection.version=1可用，ui28原生已标准恢复；3014旧篇/源字段/旧收藏保持。桌面桥与Android菜单面板仍未接，旧本地素材须保留式映射。两端按[实际接口](STICKER-BACKEND-API.md)接入，运行回读见[验收](validation/2026-10-18-sticker-message-backend.md)。产物outputs/sticker-message-backend，临时tmp/sticker-message-backend。

2026-10-18 回看气泡残留缩进已仅在展示层修复：按diary顶层段落去Unicode段首空白，marks前处理，代码/嵌套结构/聊天及原body/ID/时间/评论保持。13定向＋12实际隔离前端及2共用fixture测试通过；API0.9.24 paragraphIndentation=1已重启，标准恢复ui28原生ready、116%/2屏。冷解析曾timeout后沿原游标自动重试成功；3014旧篇/源字段与11737安装hash保持。用户明确要求安卓复用电脑格式/算法，新增[实际内容契约](DESKTOP-ANDROID-CONTENT-CONTRACT.md)及合成fixture，写清canonical正式开关仍false、只读投影/现有聊天写口和Android差距，不冒称已全端统一。见[验收](validation/2026-10-18-revisit-indent-and-content-contract.md)，产物outputs/revisit-paragraph-indent，临时tmp/revisit-paragraph-indent。

2026-10-17 用户明确：渲染可有平台差异，写入业务格式/长文处理算法必须一致，最好连渲染核也共用，为后续自有云互通服务做准备。本文件是接入顺序和完成标准，**不是已经完成统一或授权迁移手机数据的回执**。

同日后续澄清：当前先做 UI，电脑端算法仍在优化；安卓不再单独扩展长文切分、归篇或服务绑定算法。后续从电脑公共模块与能力接口直接接入，按相同输入/上下文验证，再做保留式适配。0.8 会话背景/头像、字号/气泡、附件选择均为外观和交互层变化，不将本机外观引用称为已跨设备同步；归档缺失详见 [冻结 worker 审计](ANDROID-ARCHIVE-SEAM-08.md)。

## 当前真实边界

2026-10-17后续用户澄清：业务计算最终放客户端还是云服务器尚未决定。当前确定的是两端共享数据契约、算法入口和结果语义；同步草案中的服务器校验/同步职责不等于把所有业务算法部署在服务器。算法实现先保持可复用，部署位置待用户后续决定。本轮继续UI优化，不擅自把计算移至任一端。

已共用`rich-document.js`、Tiptap/rich-body-adapter、date-time-edit/rich-date-time/time-zone等；0.7增加Android软键盘接缝，但分段/时间戳继续调用共享命令。新空白篇的判定在Android当前可表达的标题/richdoc范围，与实际电脑`hasQuickContent`用21组相同fixtures对照；独立attachments及完整旧Entry尚未接入，不称所有格式已覆盖。

Android目前仍是SQLite思绪＋独立TL IndexedDB随想。未接入规范MessageUnit切分/重组、完整Entry信封、来源映射、远端版本、媒体下载状态、持久同步队列及云服务。SQLite与桌面存储文件不同本身不是问题；不能让物理表/TL变成另一种公开正文协议。

## 接入顺序

1. **冻结合成契约及唯一算法入口。** 对照当前电脑实际`public/shared/message-units.js`的`prepareDiaryUnits/reassembleDiaryUnits`及`legacy-time-segments.js`，使用相同模块而非另写近似Java切分。输入仍是整篇`Entry.body`及完整来源/版本/时区上下文；处理产物不得与原文各自可编辑。规范ID沿现有唯一写口生成并保留映射，另一端收到同一Entry不能再次随机分配ID；合成对照固定ID工厂及上下文，既有ID保持。没有事件时间的来源保持unknown，图片每次出现保留occurrenceId/insertedAt，未知字段不裁剪。
2. **完整信封与保留式本地适配。** 先在独立合成库接Entry原信封和规范unit/layout结果；平台本地数据库仅作持久化实现。保留日期完整时刻、内容时钟/属性时钟、分类映射、独立附件、未知字段和原版本。只读旧篇投影不能回存为新正文。当前`draftOnly`只是本机编辑信封状态，不成为跨端正式Entry或正文节点字段。
3. **随想转为同一业务接口。** TL保留为显示模型，来源复合身份与canonical ID映射另存。客户端调用同一语义的消息创建/确认/引用/撤回，不直接上传TL或两套SQLite/IDB快照，不以裸房间号做跨设备身份。
4. **同一输入的两端往返验证。** 以代码实际能力覆盖整篇→units/layout→原篇；时间戳同段/跨段、空段/缩进、引用/列表/代码、同图多次出现、附件、unknown时间、评论目标、同秒消息、撤回墓碑与冲突都比对语义与身份。相同输入和上下文必须相同输出；序列化键序不应伪造内容差异。
5. **接本地异步队列再接云。** 本地落盘/待同步队列同事务，operationId与基准版本独立，服务确认后推进游标；当前编辑收到远端变更不能覆盖光标/IME或未提交输入。服务器按已有规范校验、同步与存储，职责见[SYNC-V2-DESIGN](SYNC-V2-DESIGN.md)。

实施第2/3步前先给出旧库适配/迁移的可审查样例和回退方案；不能以本轮UI授权直接转换正式日记、删旧IDB或导入手机。现有两套本地内容、备份和未知字段保留，迁移只在独立副本验证。

## 开发文档维护

每次接入都重新读取电脑[数据模型](DATA-MODEL.md)、[消息主体实现](MESSAGE-UNITS-IMPLEMENTATION.md)、[会话实际接口](CONVERSATION-SERVICES-API.md)，并核对源码/能力，回写[Android字段映射](ANDROID-FRONTEND-DATA-ALIGNMENT.md)、[跨端差距](ANDROID-CROSS-DEVICE-ADAPTATION.md)和DEVELOPMENT-HANDOFF。源码候选、两端隔离实跑、手机安装和云同步分别记状态，不以某版版本号或UI截图推断算法已统一。


## 2026-10-18 0.10实际接入进展

已将桌面纯JS分段/时间算法及richdoc/Tiptap原样打包；真实WebView整份合成fixture与桌面逐对象一致，Tiptap整篇往返保持。SQLite schema3补contentEditedAt与明确已核实的限额/引用DTO；未知或本地不能完整保存的完整信封只读阻写。详见[0.10验收](validation/2026-10-18-android-content-contract-010.md)。这不是完整互通：完整Entry持久化/分类名映射、canonical units/layout与消息复合身份、chat-journal写口、资源ID/上传回执、可靠outbox和冲突协调仍未实现。旧HTML/Markdown需原只读转换服务；算法部署在客户端还是云仍未定。正式图片/GIF收藏按[共同契约](STICKER-MEDIA-CONTRACT.md)，未新造独立收藏协议。手机0.6保持。
