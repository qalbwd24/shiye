# 表情包客户端接入

2026-10-18随想ui33已标准保存/快照/升级启用：/候选默认可见5行（设置1–5），所有匹配保留、方向键向下滚动；笑脸按钮移除，管理统一到设置→表情包，单列名称/缩略图与上移/下移/置顶/置底、名称排序/反转/常用排序。顺序是独立本机显示偏好、重开保留，不改消息或收藏身份，尚不跨端同步。39项候选＋39项安装资产UI、4项Node通过，11项原生看图复用字节未变ui31证据；11915安装hash/原生ready/API0.9.25核验，3014旧长文/295旧消息及媒体/原收藏/回看关联保留。Android按[需求与偏好格式](STICKER-SORT-FIVE.md)独立适配，未部署APK，也未混入并行共享收藏客户端候选。[验收](validation/2026-10-18-sticker-sort-five.md)。产物outputs/sticker-sort-five，临时tmp/sticker-sort-five。


2026-10-18随想ui32已标准保存/快照/升级启用：/后仅检索收藏名称与旧sticker别名，候选缩略预览、方向键选择、Enter直接发送；原图片/时间/搜索/表情/表情包命令移除，旧emoji映射只保留数据。21项候选及21项安装资产隔离UI、3项Node通过，原生看图复用字节未变ui31的11项证据；11915安装hash及原生ready/API0.9.25核对，3014旧长文/294旧消息/原收藏、分类与回看关联保留。Android命名检索按[使用/接入规则](STICKER-NAME-SEARCH.md)适配，未部署APK，不改其普通文字联想候选。QQ动图既有用户验收保持，微信直拖已按用户要求放弃。[验收](validation/2026-10-18-sticker-name-search.md)。产物outputs/sticker-name-search，临时tmp/sticker-name-search。


2026-10-18最新：**ui31/API0.9.25已正式运行**，空说明Enter、首次收藏本地成功/后台重试、尺寸与看图焦点已验。新增`shiye-sticker-layout.js`须显式装配；`pendingMetadata`仅为客户端待确认编辑，不改消息协议。用户实测QQ动图通过；微信聊天表情包直拖按用户要求停止适配。安卓遵循[跨端媒体契约](STICKER-IMAGE-CROSS-DEVICE.md)并独立验收，APK未随本轮更新。[ui31验收](validation/2026-10-18-chat-media-followup.md)。下方ui30/ui29为历史阶段。


2026-10-18 ui30与API0.9.25已配套正式运行，metadata=1、11872安装hash及30项安装资产隔离浏览器检查通过。此前审批阻塞经用户明确要求重试标准维护后已解除。ui31正在按实测追加空说明Enter、首次收藏重试、小表情和看图焦点；Android务必同时读[最新跨端媒体契约](STICKER-IMAGE-CROSS-DEVICE.md)，不可只复制一段面板源码。微信实际拖入仍待格式证据，未写成已解决。 [ui30验收](validation/2026-10-18-chat-external-media-drop.md)。

## ui30 接入增量（电脑已隔离验证，安卓按接口适配）

- `shiyeDroppedMedia.normalize(file)` 校正空/错 MIME，支持BMP转PNG；`capture(event)`应在drop回调中同步调用以取得外部原件。只交付链接/占位文件时明确报错，不自动下载外部URL。prepare-preview/manifest已加入`shiye-media-drop.js`，其他平台打包需显式装配后再验收。
- `saveMessage({roomId,messageId,name?,note?})`沿用原来源核验；`edit(asset,{name?,note?,...})`使用update；`promptEdit(asset)`提供收藏编辑对话框。备注只写收藏元数据；重复收藏不代替显式编辑。
- `preview(asset)`生成192px WebP首帧缩略图并以可选`previewBlob`缓存，返回用于面板展示的Blob；`materialize(asset)`仍返回原件用于发送。可见项按需生成，失败可重试；旧ID、Blob和`mapping:xxx.assetId`不变，缩略图不是新权威原件。
- 新版`useShiyeInput` hook增加`sendSticker(file):Promise<void>`，同一Composer发送管线发送空caption＋原附件，不打开图片确认页；保留输入草稿，发送目标变更时中止旧目标操作。普通图片文件入口保留既有预览行为。
- 表情按钮默认sticker页；方向键/Enter直接选择发送，`/表情`仍打开emoji页，`/xxx`表情包映射调用相同sendSticker。正在编辑收藏信息时，不让底层键盘监听抢走Esc或输入法事件。
- Android若仍使用旧冻结Composer，只具备files hook，会走兼容预览路径；不能仅复制shiye-input.js就声称已实现直接发送。安卓负责会话需补sendSticker、装配media-drop、使用同一原件/收藏API并测试图片/GIF、草稿及原生保存ACK；本轮未覆盖手机。
- 新收藏及单次表情发送最多64MiB，旧超限收藏保留。错误MIME旧消息只在阅读层兼容为图片，不修改历史存储；收藏该类原件时保留localSource，不伪造canonical来源。微信/QQ实体拖拽尚待实测。

2026-10-18电脑菜单→收藏→表情面板→重发已通过隔离验收并标准升级启用ui29；原生ready、11798安装hash、116%/2屏及3014旧篇保持。实际运行结果见[验收记录](validation/2026-10-18-sticker-frontend.md)。

## 共用协议与本地收藏

收藏权威仍是后端`db.stickers`，实际HTTP接口见[后端API](STICKER-BACKEND-API.md)。图片/GIF继续是普通媒体附件，不修改原消息、原时间或引用，不新增sticker富文本节点。

`previews/telegram-chat/shiye-stickers.js`提供两端可复用的客户端：`saveMessage({roomId,messageId})`、`sync()`、`materialize(asset)`、`remove(asset)`。`setTransport(adapter)`注入平台传输，接口如下：

```ts
interface StickerTransport {
  // action: catalog / collect / from-message / update / media
  stickers(action: string, payload?: object): Promise<unknown>;
  // 复用上传口，返回正式mediaId
  uploadSticker(asset: { id: string; name: string; blob: Blob }): Promise<string>;
  // 可选；返回已确认的chat/unit来源，未归篇返回undefined
  stickerSource?(roomId: string, messageId: string): Promise<object | undefined>;
}
```

`catalog`对应GET `/api/stickers/catalog`；`collect`对应POST `/api/stickers`；`from-message`对应POST `/api/stickers/from-message`；`update`对应PUT `/api/stickers/:id`（id从payload提取）；`media`是平台受保护的固定原件分块读取，不是新增业务HTTP路由，payload为`{mediaId,offset}`，回`{offset,mime,bytes:base64}`，每块最多256KiB。客户端按catalog的size读取、核对MIME和SHA-256，当前单件下载缓存上限64MiB，超限显示错误并保留目录。原件URL必须相对服务地址解析，不相对预览/Android资产域名解析。

同一收藏的上传/移除按本地ID串行；目录回读若遇到本地ACK/移除状态已变化则跳过陈旧结果。`serverUpdatedAt`保存后端回执时间，远端恢复需比本地移除回执更新。缓存原图时合并最新本地状态，不能把刚移除的条目重新显示。

保留IndexedDB原`sticker:<UUID>`编号、Blob和未知字段；增加`serverStickerId/serverMediaId`映射、`contentHash`及可选`localSource/source`。原来的`mapping:xxx.assetId`不改。远端收藏首次读取用`sticker:server:<id>`占位，按可见范围取原件，缩略图只用浏览器显示尺寸缩小。移除标记`removed:true`，不删除原Blob；远端空目录或失败不会清空旧本地收藏。成功读到目录后，旧本地未映射收藏通过原上传口+collect补映射；失败留待下次面板重试。

对已启用归篇的会话，先等待归篇并读receipts，使用from-message核验来源。未启用归篇的本地消息不擅自开启归篇，以本地原图导入收藏；保留localSource供追踪，它不是伪造的canonical消息ID。朝花夕拾投影图片也允许作为本地原图收藏，当前不把投影TL编号冒充unitId。

## 平台边界

电脑通过`ChatJournalBridge.cs`固定动作转到本机API和受保护`/media/:id`，共用解锁Cookie；不放开Telegram worker网络，不支持任意URL代理。

Android当前安装版与并行0.11候选仍是隔离本地聊天IDB，没有电脑服务/云端认证连接。本轮`android/telegram-adapter/build.mjs`改为复用当前`shiye-input.js/shiye-stickers.js`，保留原Android设置页接缝；`android-chat.js`通过`setLibraryReader`提供`shiye-android-telegram-v2`读取，冻结旧菜单增加本地图片/GIF收藏入口。**这些是源码接缝，尚未在本轮构建APK/AVD或覆盖手机验证**，不把它们写成已启用的跨端收藏。Android负责会话需重新生成适配资产并验收菜单长按/发送/原生保存ACK。

共用客户端没有传输时只保留本地收藏，不反复提示后台未连接；将来宿主通过`setTransport`注入同协议服务。不会通过开放电脑loopback策略伪造手机互通。云服务地址、认证和同步交付仍是独立工作。用户在本会话补充的下拉刷新/切页阻塞/富文本参照思绪均属Android，见[单独反馈](ANDROID-REFRESH-NAVIGATION-FEEDBACK.md)，由Android会话处理。
