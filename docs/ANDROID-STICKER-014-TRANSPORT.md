# Android 0.14 收藏与原件固定传输

2026-10-18。新增 `AndroidStickerServices.java`，复用0.12的 `BackendServices` 地址规范、配置代际与安全错误类型。仅将后者的 Snapshot/snapshot/ensureCurrent/error/httpError 改为包内可见，未改0.12发现/实例请求逻辑。MainActivity、TelegramFrontend、LocalStore、Gradle与设备安装由根集成；本子任务不访问正式服务或设备。

实际协议以 [跨端媒体](STICKER-IMAGE-CROSS-DEVICE.md)、[收藏后端](STICKER-BACKEND-API.md) 和 [客户端接入](STICKER-FRONTEND-INTEGRATION.md) 为准。原件上传实际是 `POST /api/chat-journal/media` 原始二进制；原件读取为受保护的 `GET /media/:id` + Range，不能把 catalog.url 当任意代理地址。

## 宿主接缝

构造 `new AndroidStickerServices(context, backendServices)` 不联网。使用 `executor()` 返回的独立 `shiye-sticker-network` 单线程队列调用以下同步方法，结果由宿主切回主线程并重新确认原 WebMessagePort 所有权；不占日记保存队列。`connect`/`request`/上传均拒绝主线程。`disconnect` 可立即使代际失效并断开在途连接，随后在本队列清理本对象登记的暂存文件；`close` 还关闭队列。

| 方法                       | 行为                                                                                                                                                                  |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `connect()`                | 必须由明确连接动作调用；GET health，严格检查 stickerCollection.version=1、metadata=1、catalog/fromMessage=true；成功才固定scope并返回 `{baseUrl,scopeBaseUrl,health}` |
| `disconnect()` / `close()` | 禁止后续网络、失效旧响应；不清原本地收藏/映射/scope                                                                                                                   |
| `isConnected()`            | UI提示用当前会话状态；实际请求还检查完整配置代际                                                                                                                      |
| `getPinnedBaseUrl()`       | 本地私有偏好中首次成功连接的收藏作用域                                                                                                                                |
| `request(action,payload)`  | 仅 catalog、collect、from-message、update、media；不接收任意URL/HTTP方法                                                                                              |

connect 不自动读取/上传已有收藏、不运行全库同步。启动时是否恢复用户明确启用的连接，由宿主管理；shared `sync()` 自身会遍历旧本地收藏，不能仅因用户保存了其他业务的服务地址就无提示注入transport并调用全库sync。

scope 固定在独立私有偏好 `sticker_service_scope_v1.baseUrl`，只在能力校验成功后同步commit；失败不钉死地址。后续不同规范化baseURL的connect/request在联网前拒绝，并明确说明映射属于另一地址，保留原素材与映射。没有自动解除/重绑定scope的方法。其他业务仍可修改0.12地址；回到原地址后需明确重连。当前后端没有可靠libraryId，**相同URL后来更换数据库不能由本接缝识别**；改域名/迁云需后续明确的映射迁移协议。

## JSON 固定动作

- catalog：payload `{includeDeleted?:boolean}`，GET `/api/stickers/catalog` 或唯一固定 `?includeDeleted=1`。校验version与items数组，保留完整JSON/未知字段/旧超限项；不将空目录转换成清理本地收藏的指令。
- collect：`{mediaId,name?,group?,note?}` → POST `/api/stickers`。同资源重试保留后端原ID/既有元数据，改名/清备注另走update。
- from-message：`{version:1,source,mediaId?,occurrenceId?,name?,group?,note?}` → POST固定来源口。source仅允许真实已确认的chat来源（sourceId UUID、roomId/messageId为十进制字符串）或unitId+正安全整数revision，不用TL裸数值猜来源。服务端仍是来源归属的最终验证者；返回source与资源关系也须相符。
- update：`{id,name?,group?,deleted?,note?}` → PUT `/api/stickers/:id`，id不作为正文修改字段；note空串清除。未知请求字段/非布尔删除值拒绝，完整后端回执保持。
- media：`{mediaId,offset}`，每块最多131072原字节，回 `{offset,mime,bytes:base64}`，末块另附计算出的sha256。mediaId须先来自本连接的catalog/from-message/upload回执，目录url完全不用于请求构造。因此远端预览前应先完成一次catalog读取。

Range验证206的精确起止与总长；只有首块且完整文件不超过一块时允许200。校验目录大小、Content-Length、实际块长、MIME与首块实际签名；读取全件时核对SHA-256（目录无hash时返回本地计算值）。按offset从0顺序读取，同一末块重试可重用已验证结果。最多保留8件原件的读取状态，只淘汰已完成状态，避免打断别的在读原件。旧超过64MiB项目保留目录但明确拒绝下载。

## 大原件分块上传

`owner` 必须是宿主持有的原生port/session对象引用，不能由Web传入字符串替代。宿主的固定桥可映射upload-begin/append/finish/cancel；本类不直接开放WebMessagePort或任意文件路径。

| 方法                                               | 输入与回执                                                                                                                               |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `uploadBegin(owner, metadata)`                     | metadata `{name,mime?,size,sha256,lastModified?}`；size为1–67108864、sha256为原件小写64位hash。回 `{token,chunkBytes:131072,received:0}` |
| `uploadAppend(owner,token,offset,base64)`          | offset须等于已确认received，解码最多131072字节、完整总长不得溢出；回 `{token,received}`                                                  |
| `uploadFinish(owner,token)`                        | 校验总长与本地文件SHA后按原字节上传，回完整正式媒体对象 `{id,type,size,sha256,...}`，严格核对size/hash/实际MIME                          |
| `uploadCancel(owner,token)` / `cancelOwner(owner)` | 只处理该原生owner的已登记暂存文件，不清收藏与消息                                                                                        |

Base64单块上限174764字符，低于350000字符的WebMessage边界；禁止把64MiB Blob塞一条消息。最多同时暂存2件，文件只在应用私有cache的 `sticker-original-staging/`，路径与token均由原生生成。成功/取消尝试删除该暂存文件；finish失败保留暂存原件供当前连接显式重试，断连/owner退出清理。应用崩溃遗留cache不在启动时全盘扫描删除，原权威Blob/文件由现有本地库保留。

mime输入仅为提示：finish从PNG/JPEG/GIF/WebP/AVIF签名判定实际格式，空/错误MIME可归一，扩展名不能伪造图片。BMP须由共用normalize先转换PNG，本类不转码。此签名检查不替代UI真实解码/尺寸检查；原图与GIF不压缩、不换字节。Unicode名字percent编码进X-File-Name，lastModified可选转发；后端按hash/type/size去重，首次媒体元数据仍以后端回执为准。

## 状态与验证边界

所有请求使用默认TLS/主机名验证，禁止跳转；地址仍只允许HTTPS或本机HTTP并支持prefix。8秒连接/12秒读取超时、JSON响应2MiB、收藏写体64KiB、原件64MiB；Accept-Encoding为identity以保护Range与原件。兼容头X-Diary-Client:desktop只为旧来源检查，**不是认证**。401使收藏会话失效，重新明确连接；409、TLS、网络、范围、MIME/hash等失败使用本地安全文案，不把响应正文/异常原文/密钥写UI或日志。未实现新认证/解锁、云部署或任意库来源查询。

每次网络前后、缓存元数据和返回前检查0.12地址代际及本连接代际，断开或A→B→A后旧响应不更新当前媒体状态。已发到服务器的上传/收藏不能通过断开回滚，网络失败后应按原件hash和回执明确重试；本类不自动重发写请求。

当前136条实际行为断言通过：JVM使用生产Java源码连接实际 `createDiaryServer(seed:false)` 随机本机端口，验证PNG多块/GIF原件上传、Range读回、名称/文件时间、备注清除、重复收藏、真实chat来源大数字字符串、软删目录/恢复；另用真实JVM HttpServer覆盖scope失败/变更/ABA、401/409/禁跳转、任意动作/URL拒绝、owner隔离、错原件hash/ACK hash/Range/MIME/大小/签名、旧成功上传回执不能污染重连会话和独立executor。原0.12的99项HTTP行为回归另通过。AndroidSDK36 Java8目标编译通过。

测试只替换Android Context/SharedPreferences/Looper，不以stub证明Android实机commit/生命周期、原生桥350000实际分片、TLS证书链或长时超时。未访问设备或正式服务，未修改MainActivity/TelegramFrontend/LocalStore/Gradle，未安装APK。构建/AVD/实际面板与原件桥由根会话验收。

证据 `outputs/2026-10-18-android-media-014/native-transport/http-report.json` 及回归/编译回执；测试与隔离后端库、原生cache stand-in在 `tmp/android-media-014/native-transport/`。不覆盖012旧证据或013正式构建目录。
