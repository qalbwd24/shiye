# 统一消息主体：数据层实施与接入

2026-10-18 回看气泡残留缩进已仅在展示层修复：按diary顶层段落去Unicode段首空白，marks前处理，代码/嵌套结构/聊天及原body/ID/时间/评论保持。13定向＋12实际隔离前端及2共用fixture测试通过；API0.9.24 paragraphIndentation=1已重启，标准恢复ui28原生ready、116%/2屏。冷解析曾timeout后沿原游标自动重试成功；3014旧篇/源字段与11737安装hash保持。用户明确要求安卓复用电脑格式/算法，新增[实际内容契约](DESKTOP-ANDROID-CONTENT-CONTRACT.md)及合成fixture，写清canonical正式开关仍false、只读投影/现有聊天写口和Android差距，不冒称已全端统一。见[验收](validation/2026-10-18-revisit-indent-and-content-contract.md)，产物outputs/revisit-paragraph-indent，临时tmp/revisit-paragraph-indent。

2026-10-17 更新：上述第一轮12篇待复核已有独立第二轮review-20261017-b处理结果，原批次不改。7篇完成、3篇带编辑时间推定、2篇保留兼容伴随信息；未导入正式库。后续读取候选需要明确应用第二轮覆盖映射，不能直接修改第一轮包。见 [第二轮验收](validation/2026-10-17-message-unit-review.md)。

日期：2026-10-17。状态：隔离候选；本轮不操作桌面、不重启正式进程、不批量回写旧库。版本仍为0.9.24，不能仅据版本推断是否启用；查看 `/api/health` 的 `messageUnits.enabled`。用户确认的需求入口是 [统一内容单元](UNIFIED-CONTENT-ITEMS.md)，本文件说明实际代码。

## 保存与查看

启用后，新图文日记通过原有普通保存/快捷保存接口提交完整 `Entry.body`；后端在同一次串行 `mutate` 内生成 `messageStore.units` 与 `layouts`。每条unit正文是同一个 `shiye-richdoc` v1；layout仅保存原文结构和unit引用，不保存第二份文字。Entry.body及HTML为兼容投影，后续保存前必须与现有canonical重组一致，否则409并完整回滚。

长文入口仍整篇编辑、撤销、查看，不需要按消息逐段输入。完整手打时间戳切出文字单元，新图/视频按每次出现的 `insertedAt` 独立计时。原文位置由layout保留，时间排序仅是查询视图，不重排正文。普通编辑/追加时间段保留可匹配unit ID；真拆分/合并产生映射，退休ID保留无正文墓碑，旧评论不偷偷指向另一段。

聊天仍提交本地消息号、Markdown、sentAt、附件及replyTo；后端一次转换为共同richdoc，并生成全库ID `chat:sha256([sourceId, roomId, messageId])`。`chatJournal.messages`是原接口兼容缓存，HTML归篇是只读投影，生成前核对缓存hash。不允许PUT直接改原消息；需要撤回后用新号、重发时刻发送。现存未转换的聊天旧篇不因读取/重试自动迁移。

## 字段与身份

| 字段                | 含义与限制                                                                         |
| ------------------- | ---------------------------------------------------------------------------------- |
| `unit.id`           | 稳定全库编号，时间、标题和列表位置不参与长文身份                                   |
| `body`              | 活动内容的共同richdoc；撤回/退休墓碑为null                                         |
| `eventTime`         | `instant`、`timeZone`、`precision`、`source`、`sourceField`；无法确认时允许unknown |
| `origin`            | diary/chat/comment以及entryId；聊天另带sourceId/roomId/messageId                   |
| `replyTo`           | 指向稳定unit ID；原目标撤回后仍有墓碑                                              |
| `sourceSpans`       | 当前版本与原文块/范围/媒体出现的映射，不能作为永久评论ID                           |
| `revision/state`    | 乐观版本与active/deleted/withdrawn状态                                             |
| 媒体 `assetId`      | 原始资源编号，同文件可多次出现                                                     |
| 媒体 `occurrenceId` | 每次出现身份；插入时间和排版独立，替换/恢复保持身份                                |
| `attributes`        | 读取时从所属篇/会话实时展开标题、分类、标签与可见性，不复制一套可编辑名称          |

当前分类/标签仍兼容现有名称数组，改名事务同步Entry、room配置及合法投影hash。尚未强制迁成分类UUID，但读取不会依赖每条unit里过期的名称。

## 评论与撤回

原评论接口新增 `commentOn` 数组，支持 `{kind:'entry',entryId}`、`{kind:'message',entryId,unitId}`、`{kind:'media',entryId,unitId,occurrenceId}`。必须属于该篇且消息/媒体存在；缺省为篇评论。评论正文也保存为unit，kind=comment。评论图片自己的出现身份保存在comment.mediaOccurrences，软删/恢复及资源重映射保持不变。原评论控件仍兼容；选消息/选图片的前端控件及固定回看组尚未制作。

`POST /api/chat-journal/withdraw` 接受sourceId/roomId/messageId、可选operationId、expectedRevision；尚未归档的消息另需sentAt。已撤回目标重试（包括旧revision）返回相同结果，不创建新正文。未上传原消息也可先登记仅身份/时间的 `chatJournal.withdrawals`，延迟上传被过滤，丢失回执不会复活原文。实际撤回清空缓存、附件关联、canonical body和嵌套日记历史；原文件资源是否另有其他用途由媒体管理决定，撤回不擅自删资源。

聊天本机新增durable body-free outbox/tombstone，worker同一IndexedDB事务保存；归档桥优先发送撤回，收到200后才持久确认，本机ID不会因撤回最大号而回退。已停止自动归篇的会话仍排空既有撤回。outbox不保存撤回原文；聊天撤回提示气泡及限时“重新编辑”前端尚未实现，后续只能短暂使用运行内存。本轮未构建或启用新版聊天宿主。

## 查询接口

- `GET /api/message-units`：仅列已持久unit，可按entryId/roomId/sourceId、from/to筛选，order=asc/desc，limit=1..1000、offset分页。
- 默认排除隐藏/草稿/删除/撤回及评论；按需使用includeHidden/includeDraft/includeDeleted/includeWithdrawn/includeComments=1。未知或重复参数拒400。
- `GET /api/message-units/:id`：按稳定编号读取，同样执行可见性过滤。
- 对尚未接入的旧篇，显式entryId查询可附加 `candidate`（readOnly=true），不写主库。候选正文/时间/映射与已持久units分开，不能当成迁移完成；全局查询尚不自动扫描全部旧篇。
- `POST /api/chat-journal/receipts`：ids批次查询返回id/entryId/unitId/revision/state；尚未归档的撤回目标entryId/unitId可为空。

本地访问锁、同源限制和写请求头仍沿用原接口，不增加外网服务。开发入口下次启动将显式启用；隔离程序可用 `createDiaryServer({dataDir:独立路径,seed:false,messageUnits:true})`。正式入口仅在 `SHIYE_MESSAGE_UNITS=1` 时对新内容开启；已有canonical不能借关闭开关降级覆盖。

## 旧日记及时间兼容

旧日记只读GET后在 `var/message-unit-candidates/<batch>/` 生成独立副本，冻结算法hash和源hash，不覆盖源库或之前批次。旧独立附件按原顺序前置；eventTime统一用原内容编辑时间并注明来源，真实insertedAt保持null，不用附近段落、导入时间、EXIF或文件修改时间替代。

最终批次full-20261017T051031共3021篇：7篇聊天原结构保留，3014篇长文产生7374个候选单元；3002篇正常、10篇时间复核、2篇兼容复核。3014篇的unit可渲染、文本/空白/样式、无损重组、重复编号、媒体顺序/时间及源hash检查通过，原段落结构3013/3014通过，其余保留兼容原文。十月专批63篇（7聊天保留、55正常、1时间顺序复核）。所有异常独立列出，不静默“修正”原文。

独立时间审计23321个原文span/时间段对照全部匹配，其中12253个完整手打时间对照；55个未知兜底仍保留未知。当前重点覆盖用户十月份完整时间戳写法；只有日期再邻行时间的组合锚点仍需后续专项适配，该批实际未出现。candidate媒体只引用原资源，不是可搬走的完整备份。

## 备份与事务边界

bundle及真实syvault2备份包含messageStore和withdrawals，恢复时映射Entry/资源归属但保留unit/block/occurrence ID及评论目标。同ID不同活动正文拒409并整体回滚；撤回墓碑优先于旧备份，空库仅撤回登记也能备份恢复。媒体冲突替换/undo会同步重建长文canonical/layout/HTML和评论资源；聊天归篇禁止从日记端替换原消息附件。

下一步是桌面空闲后启用候选并验收两个真实入口；旧批次复核和显式导入另行处理。朝花夕拾的筛选组、固定展示批次、评论对象切换与只读快捷打开仍未实现，本轮提供它们需要的数据基础。

验证入口：[本轮记录](validation/2026-10-17-message-unification.md)、[归档](validation/2026-10-17-message-unit-archives.md)、[媒体冲突](validation/2026-10-17-message-unit-conflicts.md)。无界面回归明确设置 `SHIYE_TEST_NO_DESKTOP=1`，534项中533通过、0失败、1项原生跳过；首次默认检查曾误触发原生测试且失败，完整记录保留，不冒充全通过。产物位于outputs/message-unification，临时数据位于tmp/message-unification。
