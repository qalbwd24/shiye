# 表情收藏后端接口 v1：电脑与 Android 共用

2026-10-18增量：**0.9.25已配套升级正式运行**。可选收藏 `note`、catalog 的 `limits` 与 health 的 `stickerCollection.metadata:1`已只读回验生效；保留协议version=1。以实际health判断能力，不按package.json猜测上线。前端ui31追加的大小、输入/焦点规则及Android接入说明见[跨端媒体契约](STICKER-IMAGE-CROSS-DEVICE.md)。见[配套升级验收](validation/2026-10-18-chat-external-media-drop.md)。

### 0.9.25 元数据与容量增量

- POST `/api/stickers`、POST `/api/stickers/from-message` 均允许可选 `note`；PUT `/api/stickers/:id` 支持 `name/group/deleted/note` 至少一项。note 去首尾空白，最多2000个 UTF-16 码元，`note:""` 清空；原记录不强制补此字段。name 沿用250字符限制。
- 从消息收藏仍严格校验来源和原件归属，只增加 note 白名单。相同资源重复收藏不悄悄覆盖已有名称/备注；编辑请用 PUT。
- catalog 形状增加 `limits:{maxBytes:67108864,noteCharacters:2000}`；items 可含 note。新收藏上限64 MiB，旧超限收藏保留，目录不清空。媒体原件/Range接口不变，不转码 GIF。
- note 属于收藏，不是 chatJournal 消息 content/caption，也不是评论。电脑与安卓持久层保留未知字段，沿用原收藏ID及媒体ID；不另建 sticker 正文节点。
- 该增量已隔离验证并重启正式后台；旧0.9.24不接受from-message.note。当前正式0.9.25已具备该能力，连接其他实例仍须检查health。

2026-10-18更新：电脑端ui29已正式接通图片/GIF右键收藏与面板重发，保留旧本地UUID/Blob和斜杠映射，共用后端catalog/from-message/原收藏口。Android共用客户端/源接缝已准备，未部署APK或接云同步。当前接入状态见[客户端接口](STICKER-FRONTEND-INTEGRATION.md)与[运行验收](validation/2026-10-18-sticker-frontend.md)，下方待实施字样为此前阶段。


2026-10-18。后端衔接已实现并完成隔离测试；正式运行能力以`GET /api/health.stickerCollection`及本轮[验收回执](validation/2026-10-18-sticker-message-backend.md)为准。UI菜单、面板、缩略图生成与原生桥由前端按本文接入，不另建收藏协议。

2026-10-18T04:47:23Z已核对正式API0.9.24加载本能力，标准保存/快照/重启并恢复随想ui28及托盘，未向正式库新增测试收藏；后台可用不等于客户端按钮已接。该时刻正式目录为0项，不据此推断桌面预览IDB或手机没有原有本地收藏。

## 1. 能力与数据主体

```json
{"stickerCollection":{"version":1,"catalog":true,"fromMessage":true,"sourceKinds":["chat","unit"]}}
```

唯一收藏仍是`db.stickers`，记录形状不变：

```json
{"id":"33333333-3333-4333-8333-333333333333","name":"合成表情","group":"默认","mediaId":"registered-image-id","createdAt":"2026-10-18T05:00:00.000Z","updatedAt":"2026-10-18T05:00:00.000Z","deleted":false}
```

`mediaId`与richdoc的assetId指同一个媒体资源。旧记录、未知可选字段、原创建时间及现有备份映射继续保留；新接口不向消息正文加sticker节点、不保存第二份原图、不写收藏来源进原消息。它不是消息归档/上传接口，原消息须先有可解析的后端身份。

## 2. 路由总表

| 路由 | 请求/返回 |
| --- | --- |
| GET `/api/stickers/catalog` | 新的版本化目录`{version:1,items:[收藏字段＋media]}`，默认排除软删除 |
| GET `/api/stickers/catalog?includeDeleted=1` | 包含软删除；仅此查询参数，值0/1，未知或重复参数400 |
| POST `/api/stickers/from-message` | 新的来源核验收藏，见下文；创建201、复用/恢复200 |
| GET `/api/stickers` | 原接口保持：全部旧收藏原始数组（含软删除） |
| POST `/api/stickers` | `{mediaId,name?,group?,note?}`；note为0.9.25增量，返回原收藏对象，兼容旧201语义 |
| PUT `/api/stickers/:id` | name/group/deleted/note至少一个；note为0.9.25增量，返回收藏对象，不改媒体 |
| GET `/media/:mediaId` | 原受保护媒体读取，原字节/Range，不重新编码GIF |

写请求经现有访问锁/本机来源保护、`X-Diary-Client: desktop`与JSON内容头。新消息收藏body最多64KiB，参数严格校验，失败不提交部分收藏或修改来源。401需既有解锁；403来源限制；不取消Host/Origin检查供手机直连。

## 3. 从普通聊天图片／GIF收藏

```json
{
  "version": 1,
  "source": {
    "kind": "chat",
    "sourceId": "22222222-2222-4222-8222-222222222222",
    "roomId": "-20",
    "messageId": "9007199254740993"
  },
  "mediaId": "registered-image-id",
  "name": "合成表情",
  "group": "开心"
}
```

- sourceId是原来源UUID，roomId为有符号十进制字符串、messageId为十进制数字串（最多20位）；保持字符串，不经Number/Double。它们不是会话标题或设备临时路径。
- 后端从`Entry.chatJournal.messages`定位消息，并检查撤回墓碑及可见状态；有canonical unit时优先其媒体关系，并校验兼容缓存未分叉。收藏不会触发旧消息迁移或修复。
- 只有一种可收藏图片资源时可以省mediaId；含多种图片/GIF必须指定，不能默认收藏第一张。视频/普通文件不作为表情包（400）。
- `mediaId`必须属于这条消息；不能拿另一条消息/全库任意图片替代。GIF和静态图走同一路由。
- 一张图在同消息中重复出现仍只有一个资源收藏；若要核验具体出现，可以传occurrenceId，但原旧attachments没有出现身份时不要自造该字段。

## 4. 从已持久化规范消息收藏

```json
{
  "version": 1,
  "source": {"kind":"unit","unitId":"canonical-unit-id","revision":1},
  "occurrenceId": "appearance-1"
}
```

unitId来自实际持久messageStore，revision使用最新GET回执。适用diary/chat活动单元；候选candidate、回看段落ID、本机TL/SQLite编号不可当canonical unitId。版本变动409；无规范单元404；已撤回/删除/所属篇隐藏或草稿409。

可传mediaId或occurrenceId；两者同时存在必须指同一媒体出现。收藏仍只引用资源，不修改blockId、occurrenceId、insertedAt、单元revision或sourceSpans。评论单元不属于本次来源类型。回看deliveryId/SourceRef并非这两类source，不能直接塞入；若前端已有可用的受保护资源，可沿原mediaId收藏接口处理，但不能据此伪称完成了消息来源核验。

## 5. 成功回执及重试

```json
{
  "version": 1,
  "status": "created",
  "sticker": {"id":"33333333-3333-4333-8333-333333333333","name":"合成表情","group":"开心","mediaId":"registered-image-id","createdAt":"2026-10-18T05:00:00.000Z","updatedAt":"2026-10-18T05:00:00.000Z","deleted":false},
  "source": {"kind":"chat","sourceId":"22222222-2222-4222-8222-222222222222","roomId":"-20","messageId":"9007199254740993"},
  "media": {"id":"registered-image-id","name":"合成动画.gif","type":"image/gif","size":1234,"sha256":null,"url":"/media/registered-image-id","thumbnailUrl":null}
}
```

status仅created/existing/restored。若按occurrenceId选择，回执还回传该字段。两端重试同一消息/资源均复用现有sticker.id；同资源从别的消息收藏也复用，不新增第二份。已有名称/分组不被重试请求覆盖；软删除项恢复为原收藏、保留名称/分组/创建时间。明确改名/分组走PUT。

幂等键是实际mediaId，不新增operationId表。每次请求仍按当前来源校验；消息被撤回后新收藏请求409，即使该资源已收藏。已有收藏不会随撤回删除。与原POST一致，显式再次收藏会恢复已删除项；跨端删除与迟到请求的全局操作顺序不属于当前接口保证，未来同步协议须增加对应冲突策略，不能把资源去重误称跨设备全局事件同步。

成功回执到达后更新/合并收藏目录；不要通过重发原消息来重试收藏。失败保留消息和当前输入，不用UI显示“收藏成功”掩盖后端400/409/500。

## 6. 表情面板与媒体

目录item是原收藏标准字段＋media描述；不返回日记正文、EXIF、磁盘路径或原消息内容。media仅含id/name/type/size/sha256/url/thumbnailUrl；元数据不存在时media=null，保留收藏项供前端显示缺失，不自动删除。该描述不担保文件当前可读，原GET媒体错误需正常处理。

当前thumbnailUrl固定null，**没有假缩略图服务**。前端可以根据原资源在本机生成尺寸合适的预览缓存；不能把原图url说成服务器已生成低清缩略图。原GIF字节保留、动画播放与面板策略由前端处理；再次发送使用原媒体，而不是缓存缩略图。

`url`相对后端API，不是相对`shiye-preview.local`或Android assets目录。桌面原生桥需显式转发固定的收藏目录/从消息收藏/改收藏及受保护二进制读取；当前安装C# ChatJournalBridge尚无这些新action，**本轮不改/重编译桥或UI**。前端不得开放任意URL代理或移除已有网络保护来访问该路径。Android Repository同样映射到此契约，不上传整份TL/SQLite内容。

本次不新增发送stickerId的消息写口。再次发送继续走原图片/GIF附件流程，`attachments`引用mediaId，生成新消息号与实际发送时间；需要独立气泡样式时另有明确呈现元数据，不伪造richdoc节点。

## 7. 前端接入顺序

1. 查询health能力；选消息中的具体图片。桌面以归档sourceId/roomId/messageId定位，必要时先查chat-journal receipts；规范来源使用unitId/revision。
2. 未归档本机消息：先完成现有媒体上传与消息归档、取得回执，再调用from-message。尚未接后端的Android TL消息不能用裸TL整数/本地UUID猜来源；保留待收藏动作，待Repository映射完成后提交。纯本地导入仍可用原上传＋mediaId收藏流程。
3. 接收成功回执，按sticker.id或mediaId合并面板。目录用catalog读，不读取整库私人正文。默认不显示deleted，管理页显式includeDeleted=1。
4. 取消收藏调用PUT deleted=true，UI移除当前收藏展示，原消息及媒体照常可读。
5. 原生UI、菜单、快捷命令别名、缩略图缓存与后端收藏分别维护。别名目前仍是各前端本机配置，本轮不新增跨端别名协议。

**旧本地素材必须保留式映射：**预览版IDB/手机中已存在的收藏不能被一次空catalog覆盖或删除。前端先保留原记录/Blob，在明确接入流程中上传或匹配原件、取得真实mediaId，再复用旧POST收藏登记，回执后建立旧本地ID↔sticker.id/mediaId映射并合并展示。失败留在待同步状态，不丢本地原件；不能拿本机sticker:UUID或Blob键直接冒充后台资源ID。本轮不自动迁移或扫描这些私有库。

电脑和Android共用的是本数据协议与业务服务，不表示Android已连接电脑本机API。127.0.0.1只代表运行端本机；未来自有服务器使用受保护入口复用同一业务接口，当前不额外开放网络、关闭锁或部署云同步。

## 8. 错误与兼容

| HTTP | 情况 |
| --- | --- |
| 400 | version非1/未知字段/ID类型不对、无图片/多图未选择、选了其他消息资源、occurrence冲突、非允许图片类型、空名称/分组 |
| 404 | 原消息尚未归档/不存在、规范unitId不存在 |
| 409 | 撤回/删除/隐藏/草稿来源、规范版本变动、canonical与兼容缓存分叉 |
| 500 | 本地提交失败；原来源与收藏均回滚，可核对目录后重试 |

错误沿用`{error:中文说明}`，不自行依赖未提供的error.code。名称上限250、分组80个JS字符串长度，规范版本正整数；路由限制及具体标识格式以代码为准。新源请求只支持明确列出的字段，旧原始收藏接口的输入/返回兼容保留。

## 9. 代码、证据与维护

- `src/server/domain/sticker-collection.mjs`：复用收藏、软删除恢复、目录DTO，不直接写文件。
- `src/server/domain/sticker-message-source.mjs`：只读核验消息归属/媒体/可见性/版本，不转换旧文。
- `src/server/routes/stickers.mjs`：新旧路由共用同一收藏函数、统一串行mutate。
- 原`domain/stickers.mjs`：允许类型、备份/恢复和媒体映射继续复用。
- `tests/sticker-message-backend.test.mjs`：真实HTTP隔离图库/两客户端等价重试/PNG及双帧GIF/重开/跨消息选择拒绝/撤回/冲突/写盘失败回滚。

前端新增接入后要补菜单/面板与实际双端往返验收，再更新本文和交接；不能把后端测试通过写成电脑/Android界面已经启用。正文/身份通则见[跨端内容契约](DESKTOP-ANDROID-CONTENT-CONTRACT.md)，用户交互确认见[共同需求](STICKER-MEDIA-CONTRACT.md)。
