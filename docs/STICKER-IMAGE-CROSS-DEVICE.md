# 随想图片与表情包：电脑 / Android 适配说明

2026-10-18产品同步后端已增加可选`tags:string[]`校验，随同一sticker实体/name/note/group/mediaId进入种子包与增量；50个以内不重复非空标签、每个最多100字符，[]清空、缺省兼容。`catalog.seed.stickerTags=true`标明该新产品能力。旧日常接口/双端标签编辑器未随之切换，Android仍需按[初始包接入](PRODUCT-SEED-API.md)适配；不能另存本机标签后称已跨端一致。壁纸继续本机决定。

2026-10-18用户最新确认：表情包原件及名称/备注/分组/标签属于共同数据，双端须保持同一收藏身份与可变元数据；不能各端独立命名后声称同步。当前实际name/note/group沿用本文DTO，多标签字段仍待共用规范/实现。壁纸则独立于共同业务资料：电脑会话用图可当安卓头像，安卓聊天壁纸自行设置，导入包/增量不覆盖。具体边界和定向验收见[共享范围](SYNC-DATA-SCOPES.md)。此补充不是正式多端同步或多标签已部署的声明。

2026-10-18随想ui33已标准保存/快照/升级启用：/候选默认可见5行（设置1–5），所有匹配保留、方向键向下滚动；笑脸按钮移除，管理统一到设置→表情包，单列名称/缩略图与上移/下移/置顶/置底、名称排序/反转/常用排序。顺序是独立本机显示偏好、重开保留，不改消息或收藏身份，尚不跨端同步。39项候选＋39项安装资产UI、4项Node通过，11项原生看图复用字节未变ui31证据；11915安装hash/原生ready/API0.9.25核验，3014旧长文/295旧消息及媒体/原收藏/回看关联保留。Android按[需求与偏好格式](STICKER-SORT-FIVE.md)独立适配，未部署APK，也未混入并行共享收藏客户端候选。[验收](validation/2026-10-18-sticker-sort-five.md)。产物outputs/sticker-sort-five，临时tmp/sticker-sort-five。


2026-10-18随想ui32已标准保存/快照/升级启用：/后仅检索收藏名称与旧sticker别名，候选缩略预览、方向键选择、Enter直接发送；原图片/时间/搜索/表情/表情包命令移除，旧emoji映射只保留数据。21项候选及21项安装资产隔离UI、3项Node通过，原生看图复用字节未变ui31的11项证据；11915安装hash及原生ready/API0.9.25核对，3014旧长文/294旧消息/原收藏、分类与回看关联保留。Android命名检索按[使用/接入规则](STICKER-NAME-SEARCH.md)适配，未部署APK，不改其普通文字联想候选。QQ动图既有用户验收保持，微信直拖已按用户要求放弃。[验收](validation/2026-10-18-sticker-name-search.md)。产物outputs/sticker-name-search，临时tmp/sticker-name-search。


2026-10-18。API0.9.25与电脑ui31已配套正式运行，11915安装hash及40项安装资产隔离UI通过；用户实测QQ动图可用。本文供Android负责会话直接参考，不以文档代替APK实现或手机验收。

## 原件、收藏与消息

图片/GIF继续使用现有媒体资源及消息附件关联，不创建另一套表情包消息正文。资源ID和消息ID各自稳定；同一资源可以出现在多条消息中，收藏不改变原消息、引用、评论、sentAt或图片insertedAt。旧聊天的media.type=document不能仅凭这个字段判断它是普通文件，读取侧还需要检查MIME与原字节。

唯一后端收藏仍为db.stickers：

```json
{
  "id": "33333333-3333-4333-8333-333333333333",
  "mediaId": "registered-image-id",
  "name": "合成表情",
  "note": "仅供收藏管理的备注",
  "group": "默认",
  "createdAt": "2026-10-18T06:00:00.000Z",
  "updatedAt": "2026-10-18T06:00:00.000Z",
  "deleted": false
}
```

这是合成示例，不是正式用户资料。name最多250字符；note可选，最多2000个UTF-16码元，后端去首尾空白，空串清除。备注不进入消息caption，也不作为评论。时间沿用UTC ISO格式、显示按应用时区；收藏时间不覆盖内容时间。未知字段、软删除及原ID继续保留。

接口沿用[STICKER-BACKEND-API](STICKER-BACKEND-API.md)：catalog读取资源关系，from-message核验来源，collect导入本机原件，update改收藏元数据，受保护media口取原字节。catalog.limits给出maxBytes=67108864与noteCharacters=2000；health.stickerCollection.metadata=1表明备注增量已加载。不能把UI昵称或TL临时编号冒充后端媒体/规范消息ID。

## 原件和缩略图分开

- 新收藏及发送表情包原件上限64 MiB；已有超限收藏保留目录、身份和文件，明确提示暂不能下载/预览/发送，不自动删除。独立看图器原有128 MiB上限是另一条读取路径，不能把它当成表情包收藏上限。
- 原图和GIF动画保留原字节；列表按需生成192px最长边、质量0.75的WebP首帧缩略图。192px是缓存分辨率，**不是消息气泡的显示大小**。
- 电脑缓存仍在既有IndexedDB资产库：id为sticker:UUID，blob是原件，previewBlob是派生小图，contentHash为原件SHA-256；serverStickerId/serverMediaId/serverUpdatedAt为后端映射，原mapping:xxx.assetId不变。Blob不能直接按JSON上传；安卓用自己的本地文件/SQLite表达相同原件关系，接口及hash一致。
- pendingMetadata是客户端尚待服务器确认的名称/备注，不是新业务消息字段。失败时保留本地素材和待同步字段，下一次同步继续提交；成功后清除，不用旧catalog覆盖未确认编辑。
- Android可以自行用原生图片库生成等价缩略图，无须与电脑缩略图字节相同；原件SHA-256、媒体ID、消息关联必须相同。缩略图缓存失败可以重建，不反向覆盖原件。

## 用户最新尺寸要求

表情包以**当前消息正文字号的约10个汉字**为基准：竖图限制宽度，横图限制高度，正方形按同一基准；始终等比，不裁切、不拉伸，不主动把小原图放大。用em等价计算，不能把固定192px缓存尺寸当成用户字号。

设字号为f、原宽高w/h：竖图目标宽10f、高10f×h/w；横图目标高10f、宽10f×w/h。再等比缩小到原图尺寸与窗口可用空间。电脑当前额外边界为聊天区宽减56CSS px、窗口高65%，防止极端长图撑出窗口；Android应按自身可用消息区保留等价边界，不照搬电脑屏幕像素。

电脑ui31在读取层按曾收藏原件hash识别表情图，给可见气泡设置派生尺寸；同一已收藏资源的历史气泡也可使用此视图样式，移除收藏不改它们的阅读样式（本机保留软删除素材；跨端可结合`GET /api/stickers/catalog?includeDeleted=1`保留历史资源关系），**不改历史记录**。未收藏普通照片不因这条规则变小，Unicode纯emoji仍走原有独立规则。Android已有mediaId/hash关系时直接用关系判定，避免重复下载原图或扫描全库；后续若支持单条消息指定展示用途，须另增明确契约，不能用文件名或备注猜测。

## 输入、收藏与焦点

- ui33移除输入区笑脸按钮，管理入口统一到设置→表情包；平时用`/名称`候选（默认5行）及方向键选择，Enter立即以空caption发送原件；保留文字草稿，沿用引用属性。普通照片仍有预览，但说明可以为空，预览中按Enter发送；Shift+Enter换行，输入法组词回车不发送。
- 刚发出的消息可能还在写本地库，收藏前等待本机写队列提交。素材先持久到本机，后台暂未归篇/离线时明确显示“已收藏到本机；后台同步将自动重试”，不要求第二次点击。当前自动重试限3次（1/3/8秒），重开面板还可继续同步；没有服务器ACK时不能显示成云端已保存。
- 打开图片后激活独立看图窗口，并聚焦看图区域；Esc先关闭图片菜单，再关闭图片窗口，关闭后恢复聊天输入。图片缩放按键和滚轮只控制图片。Android对应为看图页面/对话框获得焦点，返回键先处理最上层，不把事件漏给背后的会话切换。

## 拖入与GIF显示

按原字节检测PNG/APNG、JPEG、GIF、WebP、AVIF，BMP可无损转换为PNG。空MIME、octet-stream、GIF错标JPG需归一化。GIF在聊天里应以可播放图片显示，不只显示gif/jpg文件图标；旧文件式记录只做读取兼容，不批量重写原消息。

Web可尝试同步获取DataTransfer文件或文件句柄，再异步读字节；可读的内嵌图片/Qt图片字节也可识别。私人虚拟格式、仅链接或未交付原件不能伪造为有效图片，不能擅自扫描微信目录或绕过权限。参考[文件句柄时序](https://developer.mozilla.org/en-US/docs/Web/API/DataTransferItem/getAsFileSystemHandle)和[WebView2外部拖入](https://learn.microsoft.com/en-us/dotnet/api/microsoft.web.webview2.winforms.webview2.allowexternaldrop)。这些API路径存在不代表微信实体拖拽已经验收。

电脑新增本机media-drop-status.json诊断仅保存最后一次事件阶段、格式名、文件/项目数量、是否落在聊天区，不记录图片字节、HTML、路径或聊天内容；供判断微信是否交付了可读数据。Android通过系统ContentResolver/URI读取用户选择的原件，保留平台差异，不照搬Windows拖入桥。本轮微信聊天表情包直拖仍失败；用户随后明确放弃此路径、只要求QQ可用，不继续开发微信专用诊断或适配。QQ动图由用户实测通过；这不意味着任意微信/QQ私有虚拟格式都能读取。

验证与部署：[ui30配套升级](validation/2026-10-18-chat-external-media-drop.md)；[ui31运行验收](validation/2026-10-18-chat-media-followup.md)。产物outputs/chat-media-followup，临时tmp/chat-media-followup；Android源码/手机APK不随本轮电脑升级自动更新。
