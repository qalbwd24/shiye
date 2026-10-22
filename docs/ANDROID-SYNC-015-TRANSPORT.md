# Android 015-A 独立同步连接传输

2026-10-18。实现文件为 `android/app/src/main/java/dev/shiye/app/AndroidSyncTransport.java` 与包内 `SyncCredentials.java`。本任务只新增上述源码、本文和隔离测试产物；未修改 MainActivity、现有业务服务客户端、Gradle、共享文档、本地资料、设备或已运行服务。设置页和候选 APK 由主会话集成，本文不声称手机已升级015。

## 接入方法

```java
AndroidSyncTransport sync = new AndroidSyncTransport(context);
sync.executor().execute(() -> {
    try {
        sync.saveBaseUrl("https://example.com/shiye-sync/");
        JSONObject health = sync.health();
        JSONObject info = sync.pair(explicitEightDigitCode, explicitDeviceName);
        JSONObject status = sync.getStatus();
        // 使用宿主的主线程派发更新设置页。
    } catch (AndroidSyncTransport.SyncException error) {
        // kind/httpStatus 与 getMessage() 均不包含远端正文、配对码或令牌。
    }
});
// 离开当前连接页：sync.cancel(); 最终释放宿主：sync.close();
```

| 公开方法 | 行为 |
| --- | --- |
| `AndroidSyncTransport(Context)` | 私有独立偏好存储；不联网、不自动连接 |
| `ExecutorService executor()` | 自有单线程 `shiye-sync-network`，不用 LocalStore 保存队列 |
| `String getBaseUrl()` | 当前独立同步地址；不读取/覆盖012、014业务地址 |
| `static String normalizeBaseUrl(String)` | 空值离线；HTTPS或明确 localhost/127.0.0.1 HTTP；规范化端口和结尾斜杠 |
| `String saveBaseUrl(String)` | 同步 commit 保存地址/代际，取消本实例旧请求；建议后台调用 |
| `JSONObject getStatus()` | 本地安全元数据；建议后台读取偏好 |
| `JSONObject health()` | 固定 GET `api/sync/v1/health`，服务必须 `shiye-sync`、protocol数字1 |
| `JSONObject pair(String code, String deviceName)` | 显式8位数字码、设备名原长度≤80且trim后非空；health→POST pair→带令牌GET info→身份守卫→加密持久提交 |
| `JSONObject connect()` / `readInfo()` | 显式重连；只使用当前地址已有加密凭据；health→认证info→身份守卫 |
| `void cancel()` / `disconnect()` | 取消当前代际、断开正在进行的HTTP，保留凭据与库身份；不请求服务器撤销 |
| `void close()` | 取消、停止独立executor，此对象不能复用 |

除构造、executor、getBaseUrl、cancel/disconnect/close外，上表方法均可能抛 `SyncException extends Exception`，其 `kind`、`httpStatus` 为公开只读字段。所有联网方法拒绝主线程执行。调用方应串行使用该executor，并将UI更新派回主线程。

`getStatus()` 返回 `baseUrl`、`connected`、`paired`、`hasCredentials`、`libraryId`、`epoch`、`deviceId`、`contentSyncEnabled:false`。`paired/hasCredentials` 表示当前地址存在加密凭据，不等于令牌尚未撤销；`connected` 仅表示本对象本代际成功验证身份，不承诺实时在线或内容已同步；新建对象始终 disconnected。deviceId是最近存储的公开设备身份，401后仍可用于显示历史身份，但paired变false。错误通过异常返回，不存放原始error对象。

pair/connect/readInfo 返回服务info对象（包括未知扩展字段），保留 protocol/libraryId/epoch/seq/cursor/deviceId/features/limits；不返回pair令牌或配对码。health/info若顶层携带 token/code/authorization 会拒绝。本轮没有任意URL、任意动作或内容请求接口，没有snapshot/push/pull/watch，也没有Repository/outbox/inbox，不能将连接成功显示为同步完成。

## 身份、凭据和地址保护

- 新偏好文件 `sync_connection_v1` 与业务服务配置完全独立。token仅存AndroidKeyStore AES-GCM密文；不提供明文回退、凭据导出或日志。当前Manifest `allowBackup=false`，后续若改变备份策略必须排除此偏好文件，不能把设备密钥当可迁移凭据。
- AndroidKeyStore AES别名 `shiye.sync.credentials.v1`；平台随机12字节IV，128位GCM tag；规范化baseURL作为AAD，记录键用baseURL的SHA-256。加密记录仅包含deviceId/token/deviceName。换地址不会把旧Bearer发送给新主机，即使它宣称同一libraryId。新地址需显式配对，原地址凭据保留。
- 首次完整health/pair/info验证成功并本地commit成功后，才将libraryId和epoch固定到私有配置。二者按实际后端UUID格式验证；info还验证protocol、当前deviceId、非负安全整数seq与字符串cursor。不同libraryId或epoch均拒绝，不提供静默解除、改绑或清空本地资料接口。同库跨地址配对可通过，同库epoch改变须下一阶段恢复方案处理。
- 配对错误不会抹掉已有凭据；认证info返回401时清空当前URL的凭据值并关闭连接状态，保留库守卫与历史公开deviceId。错误统一安全本地文案，不透传服务器正文；403/409/redirect/TLS/timeout/network/超限分别分类。配对POST已到服务器但随后网络/身份/本地存储失败时，服务端可能已创建一个未被本机保存的设备；本轮不自动撤销或重试配对，用户可在服务端设备管理查看。
- 地址只接受简单路径前缀（与现后端prefix语法一致），拒绝userinfo/query/fragment、点段、编码分隔符、重复斜杠。系统TLS/主机名验证保持默认，禁止重定向，不扩大Android明文网络白名单。局域网/Tailscale HTTP地址本轮仍被拒绝，后续需明确网络策略设计，不能沿用旧临时联调包的放行。
- 配置持久代际+对象取消代际防止迟到响应覆盖新配置/凭据。commit失败报告STORAGE，不报告配对成功；Android磁盘故障后的真实偏好持久状态仍需系统恢复核验。密钥丢失/密文篡改报告STORAGE，保留数据和库守卫，不自动生成替代明文凭据。

固定请求仅GET health、POST pair、GET info；连接8秒、读取12秒、每响应256KiB，pair请求≤2048字节。无媒体/长轮询，本轮容量不作为后续snapshot/原件/watch限额。

## 验证与边界

测试入口 `tmp/android-backend-015/transport/run.mjs` 启动两个实际 `createSyncServer`，各使用新临时SQLite库、随机127.0.0.1端口和 `/qa/sync/` 前缀；测试结束关闭自身实例，不操作18769/18779或正式服务。JVM执行生产Java网络/加密代码，Context/SharedPreferences/Looper为薄替身；AES-GCM使用包内注入JCE密钥。AndroidKeyStore生产路径另用实际Android36 SDK、Java8目标编译，但真实AndroidKeyStore生命周期、应用重开/系统备份恢复仍由主会话在独立QA环境验证。

已通过97项断言：真实health/配对/info、无自动连接、密文重开显式重连、地址隔离、另库拒绝、epoch守卫、设备撤销401、配对失败保留凭据、加密提交失败、密文篡改/错误密钥、GCM AAD/随机IV、地址前缀及不安全地址拒绝、主线程拒绝、响应限额、HTTP分类/重定向、在途改地址取消、其他对象配置代际失效、断开保留配对。未做正文/媒体写入，也未把JVM替身测试称为真机密钥验收。最终精确源码hash和输出见同目录验收JSON。

成品：`outputs/2026-10-18-android-backend-015/transport/http-report.json`、`receipt.json`；临时脚本、编译class和隔离SQLite：`tmp/android-backend-015/transport/`。未跑全库check：本轮仅新增独立Java连接层，采用真实协议定向测试与SDK编译；现有012/014源码未改，原证据保持。

后续先按 [015交接](ANDROID-BACKEND-015-HANDOFF.md)实现保留式Repository、完整实体信封、事务outbox/inbox与身份映射，再讨论连接页内容开关。业务朝花夕拾配置/收件仍走独立业务API，不借sync/v1覆盖运行游标或投递回执。
