# Android 会话服务原生传输接缝（0.12 候选）

2026-10-18：新增 `android/app/src/main/java/dev/shiye/app/BackendServices.java`。按实际 `src/server/http.mjs`、`routes/conversation-services.mjs` 和 [会话服务 API](CONVERSATION-SERVICES-API.md) 实现。本文只记录传输模块；设置页面、APK 构建、设备安装、真实运行由集成会话记录，不能把本模块编译通过写成已连通正式服务。

## 原生调用接口

| 方法                                                                             | 行为                                                                                                     |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `BackendServices(Context)`                                                       | 使用 applicationContext 的私有 `backend_services_v1` 偏好，与 LocalStore/原日记分开                      |
| `String getBaseUrl()`                                                            | 当前规范化地址，默认空字符串代表离线                                                                     |
| `static String normalizeBaseUrl(String)`                                         | 只做地址校验/规范化，不读写网络                                                                          |
| `String saveBaseUrl(String)`                                                     | 同步 `commit` 一次保存地址及配置代际；返回规范化地址，失败抛 STORAGE                                     |
| `JSONObject discover()`                                                          | 后台依次请求 health 和 catalog，完整返回 `{baseUrl,fetchedAt,health,catalog}`；`fetchedAt` 为 epoch 毫秒 |
| `JSONObject getCachedDiscovery()`                                                | 当前地址上次成功快照或 null；属于缓存，不能显示成实时连通；读盘及 JSON 解析也应放后台                    |
| `JSONObject instanceRequest(String instanceId,String action,JSONObject payload)` | 后台调用固定 POST request，payload 显式对象，返回原响应并验证 scope                                      |

所有网络入口强制拒绝 Android 主线程。调用方使用独立网络 executor，不占日记保存队列；页面销毁、地址修改、再次刷新时还需在 UI 层检查自身请求代际，避免后台任务完成后更新旧页面。`ServiceException.kind` 与 `httpStatus` 为稳定分类，`getMessage()` 是本地安全文案；不将后台响应正文、密钥或异常原文写到 UI/日志。

发现严格检查 `health.conversationServices.version` 为数字 1，不能从应用版本推断能力。随后检查 catalog.version 数字 1、revision 非负安全整数、providers/instances/bindings 为数组；未知字段全部保留。未通过时不覆盖上次成功快照。发现单响应和整个缓存快照均上限 2 MiB；实例响应上限 8 MiB，请求上限 4 MiB。缓存键为规范化 URL 的 SHA-256，不混用不同服务地址的数据。

## 地址、安全与竞态

允许 HTTPS；HTTP 仅允许 `localhost` 和 `127.0.0.1`。禁止 userinfo、query、fragment、非法端口和有歧义的路径分段/编码，支持 `/prefix`，请求固定追加 `/api/...`。不提供任意 URL 转发。空地址明确切离线，保留原本地业务数据及各地址既有发现快照。

平台 `HttpURLConnection` 使用默认 TLS 证书及主机名验证，没有 trust-all/hostname 绕过；禁止跟随所有 3xx，连接超时 8 秒、读超时 12 秒，响应流读取时也执行字节上限。401=LOCKED、409=CONFLICT、403=FORBIDDEN、404=NOT_FOUND，另分 REDIRECT/TIMEOUT/TLS/NETWORK/UNSUPPORTED/INVALID_RESPONSE/TOO_LARGE/CONFIG_CHANGED/STORAGE 等。

地址及持久代际共同快照；发请求前、收响应后、写缓存前重新核对。地址 A→B→A 的旧任务也会被拒绝，旧响应不会覆盖新配置的缓存。已经发到服务端的显式写动作无法借更换地址回滚，调用方不得以改地址代替撤回/幂等确认。

写请求带现有本机 `X-Diary-Client: desktop`，这是旧来源检查兼容头，**不是认证凭据**。本模块不保存密码、不实现解锁、不把 Cookie/口令写到地址或配置。当前电脑服务本身还有 localhost Host 来源限制；此客户端支持未来 HTTPS 地址，不代表现有服务已完成云端认证、外网部署或网络暴露。

## 固定实例动作及交付边界

白名单与后端一致：status、config、tick、feed、source、media、context、comment、withdraw、comments、runner-status、runner-start、runner-stop。instanceId 必须符合后端小写 UUID 格式；返回 scope.instanceId 必须与请求相同，其他 scope/未知字段保持。不会自动发现后创建实例、绑定会话、开启运行器或推进 tick。

本轮设置 UI 仅可读 status/runner-status；写动作是原生内部接缝，后续 UI 必须明确提交 expectedRevision/operationId 并冻结消息来源实例，不能根据切换后的当前绑定重定向旧草稿/评论。create/bind 尚未实现，避免自动创建或写正式库。未实现跨设备身份映射、完整本地 Repository/outbox、自动收件、云同步或认证协议。

## 已验证与未验证

Android SDK 36 `android.jar` 下 Java 8 源码目标编译通过（JBR 的 source/target 8 过时提示保留，不是编译失败）。实际 JBR JVM + `HttpServer` 在随机本机端口进行合成行为测试：99 断言通过，覆盖规范化/拒绝地址、路径前缀、health→catalog 能力及结构门槛、未知字段、缓存成功/失败/切地址隔离、A→B→A 竞态、固定 POST 与兼容头、非法动作/实例不发请求、scope 防串实例、401/409/403/404/500 安全文案、禁止重定向、HTML/坏 JSON、chunked 响应大小上限及主线程拒绝。

测试只替换 Android Context/SharedPreferences/Looper，以真实 JVM 网络/URI/JSON 执行生产 Java 源码；不把偏好 stub 当成 Android 实机落盘/生命周期验证。未访问真实服务或设备，未编辑正式日记/配置。TLS 证书链、Android 网络安全策略/权限、ADB reverse 与实际页面交互交集成阶段验证。未执行真实超时等待或请求写失败重试，未运行全项目无关测试。

产物：`outputs/2026-10-18-android-service-adaptation/transport-test-result.json`。测试源码、Android 薄 stub 与编译文件：`tmp/android-service-adaptation/`；测试所用既有 JSON JAR 位于 `tmp/android-diary-list-09/pin/json-20240303.jar`。正式源码仅新增 BackendServices，未改 MainActivity/AppSettings/Manifest/Gradle 或共享交接入口。
