# 电脑随想 ui48 技术只读调查（2026-10-19）

范围：用户已确认主入口为电脑随想 ui48 内 WebView；优先图文重新编辑完整性和原图上传，其后切房性能/外观。逐字段全局继承由根会话维护需求。本调查未改产品、未启动或操作正式窗口/服务、未操作设备、未运行性能测试。下面“已定位”是源码证据，不等于已经复现用户截图。

## 基线辨认

前端回执 docs/validation/2026-10-19-chat-message-reedit.md 记录 ui48 已安装运行。实际冻结源码根 **tmp/diary-paragraph-messages/build-web/.ui48-message-reedit**，由 outputs/2026-10-19-chat-message-reedit/build-source-scope-ui48.json 明确，以下 src/ 路径均相对此根；**build-web/src 本身仍有旧两分钟恢复代码，不可用于判断 ui48**。冻结静态资产在 outputs/2026-10-19-chat-message-reedit/candidate-ui48/app。工作区 vendor 源仅可作为待编辑入口，实施前与冻结 SHA 比较。

config/backend-runtime.local.json 本轮只读回读仍选择 outputs/backend-runtimes/20261019-chat-reedit2/runtime-manifest.json。没有本轮实时 health/进程采样，运行态引用既有发布证据，不将工作区新增 shared-wallpaper/shared-directory 候选算作正式能力。

## 首要媒体问题：已定位的断链

1. src/util/shiyeWithdrawalUi.ts:164 restoreWithdrawal 读取持久恢复记录，175–183 下载原附件成 File；197–201 设置 editingDraft/editingId 后调用 openChatWithDraft({text:entry.text,files})，**没有 chatId**。
2. src/global/actions/ui/chats.ts:216 openChatWithDraft 将 chatId 原样写入 requestedDraft。src/global/selectors/chats.ts:222 selectRequestedDraftFiles 只在 requestedDraft.chatId===当前chatId 返回附件；未给 chatId 因而不会交给当前 Composer。src/components/main/DraftRecipientPicker.tsx:22 则把未指定 chatId 解释为选收件人。这是确定的源码契约不匹配，不是上传带宽问题。
3. src/components/common/Composer.tsx:1885 仅消费上述 requestedDraftFiles 并异步 handleFileSelect；立即 resetOpenChatWithDraft。即便补 chatId，还须验证异步构造附件失败、切房、取消、连续恢复，不应先清唯一恢复请求而让附件丢失。
4. src/global/actions/api/messages.ts:897 editMessage 仅把文本/richMessage 存入 pendingEdit，再传本次 attachments 给 sendMessage。src/lib/gramjs/client/shiyeLocal.ts:520–562 的替代事务使用 uploadedMedia || original?.media：直接编辑尚存原条能保留原附件；撤回后原条已成墓碑则 original 不存在，必须有恢复附件。故“直接编辑仍有图”和“撤回后恢复缺图”能同时出现。
5. prepareWithdrawalRecovery（shiyeWithdrawalUi.ts:68）当前仅保存单个 DownloadableMedia identity，白名单无字节/Blob/临时URL，这是正确的持久边界，但 pendingEdit 仅文本不能恢复用户新选附件。多图属于消息组/多条消息还是同条richMessage，必须按实际模型分别覆盖，不能只加一个 files 数组就宣称多图完整。

最小修复：恢复请求显式绑定 chatId/threadId/type/原messageId及代际，复用现有 recovery store、replacement 身份和本地事务；附件全部准备成功后一次提交编辑上下文，失败保留原记录和当前输入。保留旧原件引用，禁止把恢复附件重新按当前全局压缩偏好转码。原条取消编辑不撤回；确认仍复用单直接后继 CAS/orderRootId/replacementRootId，不能重写归篇算法。

风险：切房 A→B→A 只比较 chatId 不足，需代际；读取 await 后再次核对当前房/输入/编辑身份；旧恢复不得覆盖新稿。恢复条有后继时拒绝编辑旧版本的 worker CAS 必须保留，不能只依当前 viewport 检查。跨窗 competing edit/晚ACK/重启须保持同 operation/randomId 语义，不生成第二后继。

## 原图上传：现有正确机制与待补缺口

src/components/middle/composer/helpers/buildAttachment.ts:21–29 在入附件时按 shiye-image-quality 预处理，默认 original；收藏 File 标记 shiyeOriginalSticker 可强制原件。public/shiye-media-compression.js:219 原图直接 keep，动画和安全上限也保留原件。prepareAttachment:120–160 只生成40px预览，不写回原 Blob，compressedBlobUrl 清空；prepareAttachmentsToSend:163 可能改变以照片/文件展示的类别，不能把类别等同字节压缩。

worker shiyeLocal.ts:438 收分块，storeUpload:355–386 拼原字节入 documents，并解码尺寸。随后静态 shiye-journal.js:126–153 从 documents.bytes 每256KiB经 native upload-start/chunk/finish 上传，失败 cancel，确认后才放 mediaCache。这条路径没有凭源码证明整链“字节无损”，但没有必要重写上传协议。

明确风险：恢复创建普通 File，再走 buildAttachment 时会读取**现在**的 shiye-image-quality；用户已改均衡/清晰则可能把旧原图二次压缩。最小方案对“恢复现有原件”携明确来源/保留标志，和用户新选文件的当前压缩设置区分；不借用 sticker 标志伪装媒体种类。缓存 mediaCache 以本地document.id为键且仅内存，重启会重传；本轮不能冒称有持久上传job/断点续传。FILE_PARTS也是内存：关闭期间新附件恢复不完整的边界需要专门验收，不擅自并入Android持久job候选。

原图验收应逐段取 SHA-256：选择文件→buildAttachment Blob→worker documents.bytes→隔离native接收原件→后端media原件。至少 JPEG含EXIF/PNG透明/WebP/GIF多帧/长图/大图；原图全部字节一致，缩略图可不同且不能回流原件。均衡/清晰只验新文件预期变化，旧图文字编辑/撤回恢复不变。失败/retry/restart 后 ID、时间、引用不变，无孤立“成功”状态。

## 首显、切房与节点复用

src/api/gramjs/methods/messages.ts:377 sendMessageLocal 先 buildLocalMessage 并 sendApiUpdate(newMessage)，707 sendMessage 先本地消息后发送；普通消息已具备不等服务端ACK的首显架构。ui44随机ID+chat去重及ui48替代字段须沿用，不再造第二套乐观消息。需量测的是选图解码/本地事务/渲染排队是否阻塞，而不是假定首显正在等网络。

src/components/middle/MessageListContent.tsx:549 已将本人无头像消息平铺在日期组，避免撤回拆sender组导致邻居重挂；原位编辑既有实际证据邻居同DOM、滚动0px。不能把该证据外推跨房DOM常驻，也不能为缓存所有房间留下无限DOM/解码图。视窗现有分页/整根组裁剪须保持，缓存键至少chatId/thread/type+消息revision/身份，不能只正文或数字ID。

冻结 app/shiye-room-workspace.js:331 loadImages 对全部房逐个读资产并生成头像，复用 assetId 相同项，有imagesGeneration取消；完整批次结束才更换images Map/调用updateActiveRoom。395 updateActiveRoom同步写CSS变量，但不等待新壁纸 decode。419 MutationObserver合并到rAF，并有hashchange/view-prepare多个触发入口。app/shiye-preview.css:235 #MiddleColumn 以同元素渐变+背景图 cover 居中；body范围CSS变量变化会触发样式重算。半幅/逐层显示的具体根因仍需关键帧，不能仅凭此认定GPU或壁纸尺寸错误。

最小性能候选：当前目标壁纸优先读/解码、头像后台有限并发；复用稳定背景容器与有界已解码缓存，用代际保证晚到A不覆盖B。新背景准备完再一次提交图+遮罩+位置，失败保留可用背景。缓存按assetId/修订/显示端，预算包括 width*height*4 的解码量，不能只Blob字节；退场取消与URL释放须等所有消费者退出。现有URL退休机制（275–303、pagehide）可复用，不以全房预解码换切换速度。

## 候选验收与基线（尚未执行）

在 ui48 冻结隔离宿主及同份合成数据取基线，保持同WebView/视口/缩放/壁纸/窗口状态，冷启动和热切换分开。至少小房/120+消息长房/混合多图、A-B快速往返、同壁纸/异壁纸、无图/损坏/大图、离底滚动位置。记录点击t0、房ID提交、首条本地气泡、完整视口消息、背景decode/commit、稳定几何；rAF逐帧截图/节点几何+PerformanceObserver longtask，独立记录native/worker/API耗时。没有实测基线前不承诺百分比或物理120FPS。

建议候选门槛（待根审核）：热切换首个正确视口P95≤100ms、冷≤250ms；单个可归因主线程task<50ms；背景无半幅/旧房消息混入、所有采样帧无错误归属；离底锚点≤1CSS px，未修改邻居同DOM；快速20次切房后URL/节点计数回到有界缓存范围。若设备/数据基线不满足，报告实际P50/P95/最大值和分段瓶颈再调整，不能删慢样本。

媒体首批功能门槛优先于性能：撤回恢复必须同时正文/附件/格式/引用齐全；用户已有输入不得覆盖；取消/切房/读失败不损失；重启恢复；新后继原时原位且旧墓碑无正文；同文双发不合并；网络断开/慢ACK本地首显可见，恢复后仅一条正式身份。只在隔离库发送验收消息。

本轮状态：源码调查完成；产品实施/隔离浏览器复现/基线采样/安装/实际启用均未执行。根会话可据以上源码证据组织首批最小修复及独立审核。

## 2026-10-19 后续实际单图场景复现

本轮主场景只针对**随想**，不是思绪日记富文本编辑器，不将内部多图group问题交给用户决定。真实ui48冻结app/worker、隔离Chrome与新IndexedDB、合成native bridge：发送一张合成PNG+说明→列表内直接编辑→取消→撤回→点击重新编辑。

实际结果：发送成功本地整数ID11，content.photo存在；直接编辑说明进入输入框，未打开附件确认界面；取消保持原条。撤回恢复后说明恢复到当前-10房，但requestedDraft含1个File且chatId缺失，实际弹出 **Share with** 收件人选择器，当前附件确认框没有收到图。关键帧已查看，和此前代码定位一致。此次测试脚本成功完成指复现成功，**不是产品功能通过**；无新补丁加载，无正式服务/数据操作。

证据：outputs/2026-10-19-web-chat-improvement/astra/single-image-ui48-baseline.json、single-image-preview.png、single-image-sent.png、single-image-direct-edit.png、single-image-withdraw-restore.png；脚本tmp/web-chat-improvement/astra-tests/single-image-ui48-baseline.mjs。纯函数候选6项只验证质量策略/三态和取消基础，不代表UI修复。

质量字段明确是 original / high / balanced（high为“清晰”），无clear字段。缺省balanced仅为本轮工程选择，现有显式original/high/balanced继续保留。

用户未要求新增替换附件在确认前冷重开保存，本轮暂停这类新持久schema；现有已撤回恢复仍按原持久identity能力覆盖。先修实际单图+说明流程，再依据实际随想操作扩展，不能把多图group当首批必要决策。
