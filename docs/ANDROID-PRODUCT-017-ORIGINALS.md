# Android 产品同步017：私有原件下载任务 helper

2026-10-18。独占新增 `android/app/src/main/java/dev/shiye/app/ProductOriginals.java`，未改其他业务源码、共享入口、服务、转发或设备。与传输代理确认已存在 `mediaAsset` / `mediaReadChunk` 的固定API后实现。本轮优先下载可靠性，未实现上传持久任务。

## 接口与职责

```java
ProductOriginals originals = new ProductOriginals(context, syncTransport);
ProductOriginals.Spec spec = new ProductOriginals.Spec(
    libraryId, epoch, assetId, expectedSize, expectedSha256, expectedMime);
ProductOriginals.Status result = originals.download(spec, cancellation, progress);
File ready = originals.readyFile(spec); // 未齐返回null；完整文件也重新校验SHA
```

- 全部磁盘/下载/hash方法要求后台线程，主线程调用报告MAIN_THREAD。download为阻塞后台任务，不自行创建调度器或无限重试循环。
- `Spec`不可变：固定libraryId/epoch/assetId及期望size/sha/mime；size 1..512MiB，SHA为小写64位hex，assetId仅固定安全字符，无路径/URL输入。
- `Status`只有taskId、已持久offset、size、ready和完整File；partial时file=null，不能以下载完最后一个块冒充原件ready。
- `inspect`/`readyFile`不联网，但会执行可信断点恢复、尾字节截断、完整文件核验及必要的ready元数据修复；不是纯只读文件查询。大文件hash需后台执行。
- `cancel()`以代际在chunk/hash边界中止，不取消共享transport上其他动作。单个网络块仍由transport的有限超时负责；Repository若拥有该传输生命周期，可同时调transport.cancel()尽快断开当前I/O。
- `restart(spec)`为SHA错误后的显式从0重取：先原子提交offset0，保留旧part，下一download截断到0后重传。损坏完整`.original`不会被自动覆盖/删除，readyFile会拒绝它；此类完整文件的隔离/清理需另行受控修复，不伪造ready。

生产构造路径为 `Context.getNoBackupFilesDir()/product-originals-v1`，存储不可用时失败，不回退相对目录、外部存储或下载目录。它独立于014收藏scope及mediaId映射；输入必须来自已验证产品库的asset元数据，不能把旧收藏裸ID当同一原件。Repository负责明确跨协议映射。

## 下载与恢复流程

1. 以`libraryId + epoch + assetId + size + sha + mime`固定串的SHA-256派生文件名，只使用`.lock/.task/.part/.original`固定后缀；canonical父目录再校验，拒绝指向目录外的路径。相同asset跨库/epoch/期望版本隔离。
2. 每任务使用OS FileLock，同一helper/另一helper/进程不可并行改同任务；冲突为TASK_BUSY，不忙等。
3. `.task`为小JSON（上限64KiB），含version、固定身份/期望值、offset/state，读后验证；重写沿用原JSONObject，保留未知任务字段。使用Android `AtomicFile`备份/原子写入API，每次task流也显式FD.sync。
4. 恢复以原子提交的offset为准：part大于offset时truncate并fsync，避免强杀写完块但未提交任务的尾字节被信任；part短于offset或缺失时报告CHECKPOINT_FILE_SHORT，不向前猜测。由调用者保留任务并决定显式restart。
5. 首次download核对transport私有状态的libraryId/epoch与非空root，再由固定mediaAsset核对asset/size/hash/mime与available。每块前后再核对同库/epoch/root，地址改变或身份不符不提交返回块。传输层每请求另做Bearer info、库身份/设备保护、严格Range；helper不取用/存储token。
6. 每块最多262144字节，通过`mediaReadChunk(assetId,offset,length,expectedSize)`获取。helper再次检查offset/total/长度及传输MIME（仅允许逻辑MIME本身或安全降级application/octet-stream；元数据逻辑MIME仍严格匹配）；无整件byte[]或Base64，没有512MiB进入WebMessage。写RandomAccessFile→FD.sync→AtomicFile保存新offset→progress，顺序固定。
7. 到期望长度后以256KiB缓冲流式SHA-256校验整件。错误保留part与offset、state=hash-mismatch，不产出ready；网络/取消同样保留已提交进度。最后用同目录`Files.move(...,ATOMIC_MOVE)`从part改名original，原子保存ready任务。若强杀发生在rename之后/ready提交之前，下次以完整文件size/hash恢复ready。
8. readyFile再次流式核验本机完整File，可离线使用，不要求向服务器联网。完整文件被改坏时明确ORIGINAL_HASH_MISMATCH。

Progress在调用下载的后台线程执行；接UI须自行post到主线程。回调只能把已提交offset或已验证ready投影给界面，不能将普通partial回调变成“原件可用”。helper没有通过WebView暴露文件路径或任意网络能力。

## Repository边界

这里提供下载文件和独立持久任务，**没有统一正文/消息/媒体元数据/outbox事务**。调用者必须在自身权威Repository事务中保存asset引用、taskId与任务意图，再由唯一生命周期调度器执行，最后在本地事务登记ready引用；不能仅凭helper完成就标整篇/整库同步成功。文件ready与正文接收cursor、业务media元数据、asset实体回执、服务器ACK分别处理。

下载完成不会修改TL IDB、LocalStore、014收藏Blob或旧媒体。未知业务信封、聊天/朝花夕拾来源与canonical仍归各自Repository/投影；本helper不解析正文，也不将原件当新的业务消息。

## 验证与边界

- `ProductOriginals.java`与当前实际`AndroidSyncTransport.java`、`SyncCredentials.java`一起用Android36 SDK成功javac编译。仅有JDK关于source/target8的工具警告，无Java编译错误。
- JVM原生文件runner使用实际File/RandomAccessFile/FileLock/FD.sync，合成600KiB+19字节原件，74断言通过。覆盖：3块有界传输/每次持久progress、未完成无File、全件SHA；取消后重开续传；强杀窗口模拟尾字节truncate；错误offset/total/length不推进；hash错保留part与显式restart恢复；不同库/epoch隔离、地址切换后迟到块丢弃；短文件/缺原件；读取期间取消；跨helper写锁；rename先于ready任务的恢复；AtomicFile备份恢复；路径越界/512MiB超限/主线程拒绝；未知任务字段保留；已完成文件腐坏检测；application/json逻辑元数据配合octet-stream Range安全降级完整回组并核SHA、其他响应MIME不匹配拒绝且不推进offset、逻辑元数据MIME改变拒绝。
- runner使用package-private Source接缝和最小Android Context/Looper/AtomicFile替身。生产始终调用Android AtomicFile及真实transport；本轮没有通过这套runner验证真实HTTP、TLS、AndroidKeyStore或Android平台AtomicFile实现。它不是Android设备强杀/断电实测，不能据此宣称电源掉电一致性或整件512MiB性能已验。
- 实际HTTP Range/鉴权/越界验证归传输代理的独立网络QA；集成后仍应在隔离QA包补实际原件下载/进程终止恢复及私有目录检查。未安装主手机、不触其UI/用户内容，没有全项目check或整包设备验收声明。

产物：`outputs/2026-10-18-android-product-017/originals/report.json`、`native-runner.log`、`sdk-compile.log`。临时runner、替身及合成私有文件：`tmp/android-product-017/originals/`，不进入源码产品。

冻结源码SHA-256：`ca72f086c4048ad1f14891faa3b5c1b9c9b0425662e06c7cacb0a869bc2db934`。

P1增量修复：后端对非安全内联MIME以application/octet-stream下载是既有安全策略；本helper按上述受限降级兼容大Entry JSON payload，未放宽元数据、Range、size或SHA校验。源码注释增量不影响运行逻辑；SDK再次编译通过。
