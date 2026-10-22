# Android 产品与增量服务固定传输接口

2026-10-18。用户要求继续完善App后端接口；本任务独占扩展 `AndroidSyncTransport.java`，复用015的独立地址、AndroidKeyStore凭据、libraryId/epoch守卫和取消代际。未修改MainActivity、LocalStore、设置页、Gradle、QQ皮肤或共享契约，未操作手机、AVD、18789运行配置或正式资料；安装与产品集成由主会话负责。

依据最新 [Android标准契约](ANDROID-PRODUCT-SYNC-CONTRACT.md)、[产品API](PRODUCT-SYNC-API.md)、实际 `sync-v2/server.mjs`、`sync-product/service.mjs` 和媒体store实现，补齐product全部14个端点、sync分页/推送/通知/冲突及原件分块。这里只提供传输，不代替完整Repository、真正事务outbox/inbox、文件任务或生命周期调度器；`getStatus().contentSyncEnabled` 仍为false，表示本层没有启动内容调度。

## 固定公开接口

所有方法抛既有 `AndroidSyncTransport.SyncException`，网络方法禁止主线程；构造、旧方法签名、独立executor、cancel/disconnect/close保持兼容。调用方仍需先显式配对，不接受令牌参数或任意URL。

| 方法 | 固定HTTP端点 |
| --- | --- |
| `JSONObject catalog()` | GET product/v1/catalog，校验schema1、库身份及types/readOnlyKinds数组 |
| `JSONObject library()` | GET product/v1/library，仅兼容完整阅读检查；日常接收用分页 |
| `JSONObject saveRoom(JSONObject)` | POST product/v1/chat/room |
| `JSONObject sendMessages(JSONObject)` | POST product/v1/chat/send |
| `JSONObject withdrawMessage(JSONObject)` | POST product/v1/chat/withdraw |
| `JSONObject revisitStatus()` | GET product/v1/revisit |
| `JSONObject configureRevisit(JSONObject)` | PUT product/v1/revisit/config，必须显式expectedRevision |
| `JSONObject tickRevisit(JSONObject)` | POST product/v1/revisit/tick，不自动补看 |
| `JSONObject revisitFeed(JSONObject)` | POST product/v1/revisit/feed |
| `JSONObject commentContext(JSONObject)` | POST product/v1/revisit/comments/context |
| `JSONObject addComment(JSONObject)` | POST product/v1/revisit/comments，必须显式operationId |
| `JSONObject withdrawComment(JSONObject)` | POST product/v1/revisit/comments/withdraw，显式原operationId |
| `JSONObject commentsForEntry(String entryId)` | GET product/v1/revisit/comments，entryId作为编码query值 |
| `JSONObject revisitSource(JSONObject)` | POST product/v1/revisit/source |
| `JSONObject snapshot(String cursor,int limit)` | POST sync/v1/snapshot，初页cursor可null，limit1–200 |
| `JSONObject pull(String cursor,int limit)` | POST sync/v1/pull，不解析opaque cursor |
| `JSONObject push(JSONArray operations)` | POST sync/v1/push，保持调用方已持久化的operationId/内容/基线 |
| `JSONObject watch(String cursor,int timeoutMs)` | GET sync/v1/watch，单次100–30000ms通知，不循环、不自动pull |
| `JSONObject listConflicts(String entityType,String entityId)` | GET sync/v1/conflicts，两个过滤值可null |
| `JSONObject getConflict(String conflictId)` | GET sync/v1/conflicts/{固定安全ID} |

上表HTTP路径均自动加 `api/` 和已保存的路径前缀。JSONObject输入先复制，保留未知字段；返回保留完整JSON，不从UI DTO重建信封。sourceId必须UUID；roomId、消息id/replyTo必须字符串，可保留超过long范围的20位十进制；不经过double/long转换。服务端仍负责完整业务参数校验、源/引用/规则/权威限制。

`configureRevisit.expectedRevision` 来自status.config.revision，不是ruleRevision；其成功回执是配置对象本身。feed.after/next是业务投递序号，与sync cursor分开。评论必须由Repository首次排队时捕获并持久batchId/deliveryId/occurrenceId，transport不猜当前目标、生成operationId或补参数。

## 原件接口

| 方法 | 用途 |
| --- | --- |
| `JSONObject mediaBegin(JSONObject input)` | 固定POST media/uploads；input为assetId/sha256/size/mime/name，可恢复同ID任务；验证回执assetId/hash/size一致 |
| `JSONObject mediaUploadStatus(String uploadId)` | 固定GET上传状态，返回receivedChunks/missingChunks/服务chunkSize |
| `JSONObject mediaPutChunk(String uploadId,int index,byte[] bytes)` | 固定PUT上传分块，复制bytes并自动计算X-Chunk-Sha256；每块≤262144原字节 |
| `JSONObject mediaComplete(String uploadId,String assetId,long size,String sha256)` | 固定POST完成；校验最终available=true和完整assetId/hash/size回执 |
| `JSONObject mediaAsset(String assetId)` | 固定GET授权原件元数据 |
| `MediaChunk mediaReadChunk(String assetId,long offset,int length,long expectedSize)` | 固定GET原件content Range；length≤262144，校验206、精确Content-Range和字节数 |
| `static String sha256(byte[] bytes)` | 原字节SHA-256；不是图像重编码 |

`MediaChunk` 公开只读字段 `byte[] bytes`、`long offset,total`、`String mime`。最大总原件512MiB，与014收藏64MiB/131072桥块分别处理。上传默认服务块262144；桥接若有350000字符消息限制，应将本地入站桥块与服务器上传块分别聚合，不能把半块直接提交服务器index。下载调用方可用131072读取。

传输层不接收文件路径或任意media URL。Repo/专属私有文件helper负责落盘、fsync、断点持久化、完整SHA校验、rename和网络任务状态；缩略图不能替代原件。每块下载使用调用方已保存的expectedSize，最后完整文件必须对照mediaAsset.sha256验证，单个Range成功不代表原件完成。本轮无一条WebMessage承载512MiB的做法。

## 安全、容量与恢复边界

- 每次产品/内容/原件调用，先使用当前URL的加密凭据GET sync/info，校验protocol/deviceId和已持久化libraryId/epoch，再发固定业务请求；缺失持久库身份会拒绝内容调用。产品口另外要求info.features.product.schema=1。不把换地址视作同库、不把旧Bearer发送给新地址。
- HTTP仅localhost、127.0.0.1，以及用户此次明确授权的当前电脑精确地址 **100.77.215.104**。它是本轮本机测试服务例外，不放开100/8或其他私网；HTTPS仍使用系统TLS与主机名校验。根会话同步维护XML精确域白名单；以后HTTPS root可保留前缀直接切换，不能因此自动迁移旧凭据或库身份。
- 连接8秒；普通产品/内容读取30秒；watch读取为请求timeout+10秒，覆盖后端最长30秒。所有请求禁止重定向。cancel/改URL/close使注册中的所有HTTP连接断开，旧响应不得确认新配置；不只取消最后一条连接。
- 401清空当前失效token对应的加密值，保留库守卫和全部本地内容/任务；迟到旧token的401会先比较当前加密记录，不能抹掉已成功重配的新token。其他对象已清空凭据时，本对象status也不会继续connected。
- push≤100操作，单操作≤1MiB，整批≤4MiB，UTF-8字节计数；消息/新增评论请求≤950000字节。pair≤2048字节，分页请求≤16384字节，媒体元数据≤4096字节。超限明确失败，不截断或改operationId。
- 普通JSON响应上限32MiB，health/info/watch/媒体状态256KiB；原件每次Range≤256KiB。200条页不保证低于32MiB：超限必须保留原cursor并减小limit重试（可用1条）；完整library超限改用snapshot，不递增游标。上层不能把大页直接塞单条WebMessage。
- `SyncException.kind` 新增NOT_FOUND、INVALID_MEDIA、RATE_LIMITED；403/409/413/422/429分别分类。可选 `remoteCode` 只保留受限机器码或已知媒体错误码，`getMessage()`仍是安全本地文案；不透传远端正文、配对码、token或cause。不得日志payload/响应原文。
- transport只发一次明确请求，没有自动retry、清队列或生成新身份。网络/429/5xx退避、丢ACK重试、并发新编辑、墓碑清理、cursor事务提交都由Repository控制；服务器业务403不能改普通entityType绕过。

## 定向验证

`tmp/android-product-017/transport/run.mjs` 启动两个实际 `createSyncServer + productSyncExtension`，新隔离SQLite、随机loopback端口、`/qa/product/`前缀，关闭autoTick。一个使用正式golden合成fixture完成增量/聊天，另一个只导入既有合成历史评论fixture。未访问18789、真机或正式日记。

通过90项产品断言：全部14产品入口真实调用；fixture完整data/canonical/未知字段往返；分页snapshot/pull、幂等push、真实并发冲突与详情；只读消息业务权威403及安全机器码；20位消息ID/引用与撤回投影；固定单条评论context/source/按篇查看/幂等/撤回；配置expectedRevision冲突；watch超时及取消；600001字节原件乱序分块/缺块恢复/完整回执、Range重组及SHA一致、错误hash422；精确Tailnet HTTP允许与其他私网拒绝；迟到旧401与新配对竞态保护。另将原015配对/加密/身份/取消测试用新源码重编译回归97项，原目录证据未覆盖。

Android36 SDK、Java8目标编译通过。JVM只替代Context/SharedPreferences/Looper及密钥提供者，网络/JSON/AES-GCM执行生产代码；未声称真实AndroidKeyStore、Android网络安全XML、断电事务、WebMessage尺寸或完整App双端同步已验。本任务无部署。输出 `outputs/2026-10-18-android-product-017/transport/`；临时脚本/class/隔离库 `tmp/android-product-017/transport/`。

### 后续真实Android集成补验

同日按主会话追加任务，在自有无Activity instrumentation包 `dev.shiye.transportqa017`、仅emulator-5554完成44项实际Android测试（35初始进程+9新的Android进程，断言PID不同）。真实编译/运行LocalStore、Repository、Coordinator、Transport、Originals、SyncCredentials，使用实际SQLite、AndroidKeyStore和Android网络安全XML，未用这些组件的替身。

涵盖配对/密钥及SQLite重开、snapshot多页→checkpoint→pull游标持久、profile localCommit+immutable wire→实际push→ACK pending空、负房号/20位消息/引用与撤回、revisitFeed(null)成功、600001字节JSON原件上传及octet-stream安全下载/完整SHA、新进程恢复。专属合成产品服务随机端口/前缀和35分类，不访问手机、主包或18789。自有包、reverse和配对输入文件均已清，HTTP服务已关闭。

完整回执与复现说明：`outputs/2026-10-18-android-product-017/integration/receipt.json`、`README.md`；独立工程/runner/build：`tmp/android-product-017/integration/`。这次补验缩小了上述密钥/原生存储未验边界，但仍不代表产品页面生命周期、断电事务、完整权威迁移或双端离线同步全部完成。产品UI测试继续由主会话负责。
