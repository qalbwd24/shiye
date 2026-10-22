# 聊天逻辑快照编译候选

2026-10-19。`src/server/sync-product/chat-snapshot.mjs`提供纯函数`compileChatSnapshot(input)`，本轮只完成源码及合成验证；不读取真实WebView/IndexedDB、不切生产消息owner、不调用业务send、不恢复撤回正文、不部署后台或设备。统一注册/API与原件存在性由根会话集成。

## 显式来源契约

输入是调用方一致采集的逻辑快照：`{format:'shiye-chat-snapshot',version:1,sourceId:UUID,revision:正安全整数,rooms:[完整room],messages:[{roomId,id,state,data}],media?:[{assetId,sha256,size,mime,name}]}`。这是明确的后端编译输入，不能声称现有WebView已经提供该导出口或已完成完整电脑采集。

room.id必须为最多20位数字的字符串，可有负号；message.id为非空、最多20码元且无空白/控制字符的字符串，绝不转Number。消息的roomId必须存在；若room/data携带sourceId，必须与快照sourceId完全相同；若data携带roomId也必须一致。重复room、同房重复消息、悬空room、非正/不安全revision、任何JSON中的不安全整数都拒绝。

active data必须有相同字符串id及合法字符串sentAt，时间原样保留，绝不以采集时间代替；replyTo如存在也必须保持字符串身份。未知普通字段、原正文和Markdown标记原样保留，正文文本不做凭据字符串过滤。withdrawn允许不携data或携空对象，但任何非空data均整份拒绝；结果是`{entityType:'chatMessage',entityId,state:'withdrawn',data:{}}`，不把_product、旧正文或恢复缓存放回墓碑。

输入根只允许列出的7个字段，其他字段明确拒绝，不能静默忽略。withdrawalRecovery/rawProfile/auth/credentials/token等明确私有域不能作为快照根或消息未知嵌套字段绕过；不提供profile复制旁路。room仅对config/configuration执行独立配置过滤：portableConfiguration移除已知凭据/本机环境/归档字段，另外去除auth与本机恢复域；coverage.excluded只记路径/原因，不记值。其余room字段保留，嵌套私有域拒绝。

## 既有身份与原件声明

会话使用现有`productConversationId(sourceId,roomId)`，消息使用`productMessageId(sourceId,roomId,messageId)`，不另造消息owner或时间身份。active记录由现有productRecord创建，添加只读投影标识；消息refs包含origin、conversation及assets。

attachments如存在必须是安全assetId字符串数组；安全ID遵守现有media与Android原件runner的`[A-Za-z0-9][A-Za-z0-9_-]{0,127}`。room avatar/wallpaper和嵌套assetId/后缀AssetId同样纳入refs.assets。所有引用必须有media声明，声明校验实际协议字段、SHA256、正安全size（最多512MiB）、合法MIME（最多200字符）和名称，拒绝重复ID及额外路径字段。

此编译器只有声明，没有原件字节：`plan.assets=[]`，`requiredAssets`保存所有声明元信息；不生成额外media relation，原件沿现有upload接口上传。统一提交必须核对requiredAssets已在目标原件库且SHA/size/MIME一致，之后才允许登记。coverage.originalBytesVerified固定false，声明成功不代表原件已上传、可离线或完整同步。

## 结果与幂等

返回`{schema:1,sourceId,snapshotKind:'chat',snapshotRevision,sourceSha256,records,assets:[],requiredAssets,coverage,issues:[]}`。sourceSha256基于规范键排序JSON的sourceId/revision、按实体ID排序的records及按assetId排序的原件声明计算；输入对象字段顺序不改变逻辑hash。未知非机密业务字段参与hash，防止不同快照误判幂等。快照revision和目标同身份冲突由统一提交层处理；本函数不覆盖已有正式消息。

JSON输入上限16MiB、深度96、节点200000，room/message/media总数最多10000。对象输入只接受惰性普通JSON，不调用getter/toJSON，不执行用户函数；也接受有界JSON字符串或严格UTF-8 Buffer。失败整plan拒绝，无写入副作用。

coverage明确completeComputerExport=false、changesMessageOwner=false；不据合成测试宣称PC持续采集/生产owner已接。真正来源采集的一致时刻、引用目标是否已存在于更早历史、真实原件校验、正式同步运行仍由后续集成证明。

## 定向验证

`node --test tests/chat-snapshot.test.mjs` 10项合成测试通过：完整active字段/字符串ID/原时间、空墓碑与正文拒绝、未知根/私有域、配置过滤无值泄漏、声明原件与安全ID、media元信息、跨源/跨房/重复/悬空、规范hash、惰性JSON与安全整数、容量/深度/记录数量。未读真实库、未操作任何设备、未修改前端或现有共享模块。
