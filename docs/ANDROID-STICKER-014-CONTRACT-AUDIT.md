# Android 0.14 图片与表情包实际契约审计

2026-10-18。已只读重查AGENTS、WORKSPACE、DEVELOPMENT-HANDOFF、四份媒体契约及实际后端/桌面桥/共享客户端/Android接缝。本文和机器报告是本子任务仅有的新产物；没有修改源码、调用正式HTTP、读取真实日记库或操作设备。共享工作树存在并行014实施，以下“当前缺口”指核查时源码快照，最终实现和APK须另验。

## 优先结论

后端收藏与媒体接口已经实际实现；备注要求 `health.stickerCollection.metadata=1`，不能只检查version1或应用版本。Android应注入固定传输复用shared sticker adapter，保留手机本地原件、UUID、别名、未确认字段和真实保存ACK；无需伪造TL归档身份或创建第二种消息正文。

最新共同尺寸规则已经覆盖013固定单图176px：**只有曾收藏资源的mediaId/hash关系才使用约10个当前字号汉字的表情尺寸**；未收藏普通照片保持普通显示。不能按文件名、备注或照片类型猜它是表情包。跨端统一不等于手机已经连接电脑loopback接口，也不等于增量同步Repository已完成。

## 固定HTTP接口与上传

| HTTP / 路径 | 准确请求 | 返回与边界 |
| --- | --- | --- |
| GET `/api/health` | 无 | `stickerCollection:{version:1,metadata:1,catalog:true,fromMessage:true,sourceKinds:['chat','unit']}` |
| GET `/api/stickers/catalog` | 可选唯一 `includeDeleted=0/1`；未知/重复查询参数400 | `{version:1,limits:{maxBytes:67108864,noteCharacters:2000},items:[sticker+media]}`；缺省不含deleted |
| POST `/api/stickers/from-message` | `{version:1,source,mediaId?,occurrenceId?,name?,group?,note?}`，最多64KiB JSON | 创建201，复用/恢复200；`{version,status,sticker,source,media,occurrenceId?}`，status为created/existing/restored |
| GET `/api/stickers` | 无 | 旧原始数组，含软删除；不是版本化目录 |
| POST `/api/stickers` | `{mediaId,name?,group?,note?}` | 旧兼容201收藏对象；已注册媒体导入收藏，相同mediaId复用/恢复 |
| PUT `/api/stickers/:id` | name/group/deleted/note至少一项 | 200收藏对象；改元数据/软删除，不改媒体 |
| POST `/api/media` | **原始二进制body**、真实 `Content-Type`、百分号编码 `X-File-Name` | 201完整media DTO：id/name/type/size/sha256/importedAt等；接受PNG/JPEG/WebP/GIF/AVIF及既有音视频类型 |
| POST `/api/chat-journal/media` | 同样原始二进制；允许语法有效的generic MIME | 同样201媒体DTO；桌面桥使用此路径。不是multipart、JSON或整份base64上传 |
| GET `/media/:mediaId` | 可选 `Range: bytes=start-end` | 200/206原字节，Content-Type/Length、Accept-Ranges；206含Content-Range；无效范围416 |

上传可选元数据头还有 `X-File-Last-Modified`、`X-Original-Size`、`X-Source-Captured-At/Tag/Offset`、`X-Media-Compression`，均先decodeURIComponent并验证格式；表情原件不应虚构压缩信息。后端按sha256+size+MIME且无purpose媒体去重，响应复用真实mediaId。上传ACK须先持久到本地映射，后续collect失败重试不能丢掉这个ID。

通用媒体上传上限16GiB，**不是收藏/表情发送上限**；新收藏与单次表情发送须单独限制64MiB。已有超限收藏/文件保留，明确不能预览/发送，不自动删除。上传路由并不嗅探真实图片格式，收藏校验也依赖登记MIME；客户端需从字节识别PNG/APNG/JPEG/GIF/WebP/AVIF，BMP可转换为新PNG，不能仅信扩展名/Content-Type。原图/GIF保持原字节；转换BMP应明确产生新的PNG资源。

## 收藏schema、来源和幂等

收藏仍为 `{id,mediaId,name,group,createdAt,updatedAt,deleted,note?}`，可选未知持久字段保留。name去首尾空白后1–250个JS字符串长度，group1–80；note先检查输入UTF-16 length≤2000，再trim，空串清除，非字符串400。note只属于收藏管理，不进入caption、评论或历史消息。

media描述为 `{id,name,type,size,sha256,url,thumbnailUrl}`，sha256允许null，thumbnailUrl当前恒null，缺失登记时media=null且收藏保留。URL相对后端服务地址，不能相对Android appassets解析。目录描述也不担保文件仍存在；文件404/读失败须正常处理。

- chat来源：`{kind:'chat',sourceId,roomId,messageId}`。sourceId为实际归档来源的36位hex/hyphen字符串；roomId为带可选负号的1–20位十进制字符串，messageId为1–20位数字串。保持字符串，不能经过Number/Double损失精度。必须有实际Entry.chatJournal.messages与归档回执，后端检查撤回/隐藏/删除/草稿和canonical分叉。
- unit来源：`{kind:'unit',unitId,revision}`。unitId来自已持久messageStore，revision为最新正整数；仅活动diary/chat单元。候选ID、TL整数、SQLite行号、回看delivery/batch/SourceRef不能代替；版本变动409，缺失404。
- 多图必须显式选择mediaId或真实occurrenceId；同时提供时须指同一出现。不得默认第一张，不自造旧attachments没有的occurrenceId。
- 幂等以实际mediaId去重，没有新的operationId业务表。同图不同消息可复用同收藏；重复收藏不覆盖原name/group/note，编辑用PUT。已软删除项显式再次收藏恢复原ID/创建时间。新收藏请求每次仍重新核验来源，撤回来源即使已收藏也409；已有收藏不随来源撤回被删。
- 400/404/409/500错误仍是 `{error:中文说明}`，没有稳定error.code。401访问锁、403来源保护沿用，失败不写部分来源/收藏。

## 桌面固定桥与可复用客户端

实际 `previews/telegram-chat/ChatJournalBridge.cs` 已有 `sticker-catalog/collect/from-message/update/media`，不是早期文档中“桥未实现”的状态。`shiye-journal.js` 把公开 `stickers(action,payload)` 限定为catalog/collect/from-message/update/media；原生再映射固定HTTP，不开放任意URL代理。

`media`是平台RPC而非额外HTTP业务端点：入 `{mediaId,offset}`，每块最多262144字节，出 `{offset,mime,bytes:base64}`。桌面使用Range请求；offset>0要求206，并拒绝过大/非图片块。shared materialize校验offset、非空/最大块、总长、MIME；catalog有sha256时校验完整原件。Android应保持同字段名mime，而非type。

桌面上传RPC为upload-start→upload-chunk（token/offset/base64）→upload-finish（token/name/mime）→返回media，再由uploadSticker返回mediaId字符串；这是桌面私有暂存协议，不能当成后端已有这些HTTP路由。原生Android可使用固定受控二进制上传实现相同public uploadSticker合同，网络写完并解析ACK才返回。

共享 `shiye-stickers.js` 提供sync、saveMessage、materialize、preview、edit/remove、setTransport/setLibraryReader。transport需 `stickers(...)`、`uploadSticker(asset)`，可选已核实的stickerSource。192px最长边/0.75 WebP首帧为可重建previewBlob缓存，不是发送原件或消息显示尺寸。保留旧sticker:UUID、Blob、mapping:xxx.assetId；远端首次目录使用sticker:server:ID占位，按可见项取原件。pendingMetadata保留待确认name/note，远端回读不能覆盖未确认编辑。

当前shared sync会在catalog成功后上传全部未映射且未移除的本地收藏，再collect；启用transport前必须处理已有收藏与服务归属。catalog失败不清本地；但已映射项在本次catalog缺席会标removed。因此“空目录不清旧收藏”仅对未映射旧原件成立，不能据此推断跨服务切换安全。

## Android实际缺口与014接入策略

1. 核查时android-chat已用shared素材/收藏客户端和setLibraryReader，但没有setTransport；BackendServices只有服务目录/固定实例动作，缺贴纸catalog/collect/from-message/update/media、原件上传和本地锁Cookie流程。当前013直接sendSticker/原件ACK已是已有本地功能，014应保留其草稿/引用、切目标保护。
2. 当前后端仍只监听loopback，Host仅localhost/127.0.0.1带端口，非GET/HEAD强制X-Diary-Client:desktop，有Origin须同源；本地访问锁采用diary_session Cookie。它不是独立sync服务的Bearer协议。Android HTTPS配置不证明此本机API支持远端账户；须通过既有授权通道/受保护适配入口，不能为接入去掉现有保护。
3. **未归档Android TL来源不得伪造。** 可先等待真实本地保存ACK，把原件持久成本机收藏并保留localSource；联网时upload原件→取得mediaId→collect完成资源导入收藏。该路径不声称from-message核验。将来规范Repository/归档完成再启用真实source映射；不自动开启用户未启用的归篇。
4. shared saveMessage只可选等待 `window.shiyeRoomUi.command('flush')`，而Android已有保存入口为 `shiyeAndroidChat.flush`。Android需明确接上实际flush ACK，不能以气泡已显示或metadata刷新完成替代，否则首次收藏仍可能找不到IDB原件。
5. **映射必须带服务归属。** shared现有serverStickerId/serverMediaId未按backend/library分域。若用户从A切到B，B空catalog会把A映射项隐藏，且旧serverMediaId可能错投B。014应按规范服务地址/已确认库身份保留独立映射，或在归属不匹配时停止自动sync并保留原件/待同步状态，不能把改URL当同一库。
6. 固定原生RPC应限定贴纸动作、上传令牌/块/总量、媒体ID及offset；网络放独立队列，转向禁用，服务配置切换使在途结果失效，密码/Cookie不进入JS素材对象、日志或同步JSON。受保护原件用固定media读取，不开放任意URL下载。
7. 收藏成功文案区分本地ACK与服务器ACK。离线/暂未归档时本机成功，自动重试1/3/8秒最多3次，重开面板可续；不能要求再点一次收藏，也不能假报云端保存。移除收藏不删原件/原消息；pending修改和历史映射都保留。
8. 收到/本地曾收藏的mediaId或原件hash建立可持久关系，按该关系识别表情显示；移除收藏不回写旧消息，也可保留已识别历史阅读样式。竖图限宽10f、横图限高10f、正方同基准，等比受原尺寸/窗口可用范围约束，不主动放大小原图；普通照片与纯emoji各沿原规则。

## 定向验收建议与本次边界

后续隔离合成库验证PNG和多帧GIF上传/去重/catalog/分块/hash/名称备注/删除恢复；MIME空错和坏图、超64MiB旧项保留；首发尚未落库立即收藏、ACK丢失/重试、并发移除与catalog迟到；跨地址映射不串；离线原件/草稿与重开；两端同资源不重复收藏、撤回来源拒绝；真实TL本地导入不伪造归档；曾收藏竖/横/小图尺寸与普通未收藏照片保持；空说明Enter/ShiftEnter/IME、直接表情发送保留引用与草稿、看图焦点/返回顺序。

本次没有运行这些业务/设备测试，只核对实际代码和文档。机器可读端点/能力/限制/风险与源码SHA快照：`outputs/2026-10-18-android-media-014/contract-audit.json`；本文：`docs/ANDROID-STICKER-014-CONTRACT-AUDIT.md`。预留临时目录 `tmp/android-media-014/contract-audit/` 本次未创建，未额外产出脚本或清理任何文件。
