# PC共享固定原生桥隔离验证 V1

2026-10-19源码候选；PC runtime由根维护在previews/telegram-chat/shiye-shared-runtime.js。当前rendererAttached:false，候选未接日常TL renderer，不向TL IndexedDB写入共享业务，也未运行产品UI/EXE入口。

ChatJournalBridge.cs新增12个shared固定method/path：info/snapshot/pull/command/entity-read/feed-item-read/media-read/media-begin/media-chunk/media-complete/seed-resolve/seed-register。URL来自宿主native固定loopback及本机config/app.json端口，WebView不能传任意URL/path，shared动作不会触发旧status的产品启动路径。现有本机服务cookie/JSON返回语义保持。

`node tools/verify-shared-pc-bridge.mjs`将当前ChatJournalBridge.cs与tests/helpers/SharedPcBridgeProbe.cs直接C#编译为独立console harness，以临时config/app.json指向本脚本新建的ephemeral合成HTTP服务，不打开正常产品窗口。当前31断言通过：12方法实际固定路径/HTTP成功、sameBusinessStore、真实seed register/resolve、entity及feed-item分块SHA、原件begin/chunk/complete/read roundtrip，以及unknown动作被拒且零HTTP。源SHA/consoleEXE SHA/cleanup回执见outputs/2026-10-19-shared-business-integration/pc-native-871f2803-750f-4517-a2bd-b85d1dfec0c2。

这是实际C# bridge+真实合成业务HTTP，不代表WebView消息分发、PC renderer挂接或正式服务启用。前序通用JavaScriptSerializer 8MiB字符对PC大seed manifest的限制已由下方独立固定口补丁解决；通用serializer、DesktopPreview及renderer 8MiB保持原值，不能把新的native data-port容量当作renderer已可传32MiB。

## 两个固定seed口容量补丁（源码候选，独立审查待复审）

仅`shared-seed-resolve`与`shared-seed-register`选择新的独立JavaScriptSerializer（MaxJsonLength34MiB），payload序列化后另核对UTF8字节≤34MiB；响应按Content-Length及分块读取累计双重核对≤34MiB后才反序列化。不把原件放入JSON。其它shared固定口继续用原8MiB serializer，并限制UTF8请求/响应≤8MiB；旧legacy方法的通用serializer/读取语义、DesktopPreview、renderer上限均未调整。两个seed口不能通过调用方URL/path/额外参数放宽其它口。

`node tools/verify-shared-pc-capacity.mjs`真实C#console编译＋HTTP容量22项通过，证据`outputs/2026-10-19-shared-business-integration/pc-capacity-d4486c62-9fe3-4ebe-922e-c8c37c0c2096`。9526553字节（约9.1MiB）的22000项合成roster经两固定seed口实际到达共同owner，最终因不等于该合成库真实完整roster而明确409 `SHARED_SEED_ROSTER_MISMATCH`；这是容量/业务拒绝证据，不能称虚构roster成功登记。真实当前小roster两口成功另有检查。

大响应使用明确标注的独立HTTP transport fixture：两个seed口9MiB请求＋9MiB响应成功；35MiB ASCII请求、36MiB UTF8/仅12Mi字符请求在发网络前拒绝；35MiB chunked响应和超界声明Content-Length拒绝；shared-command 9MiB请求及shared-command/info 9MiB响应仍被原8MiB限拒绝。fixture不冒充服务器seed业务会返回大证明。Console helper上限36MiB只用于测试native边界，不是生产renderer改动。

补丁后的原12fixed真实业务方法31项回归通过，证据pc-native-0504acaf-222d-48a3-8fa9-a6f06ed17259。生产ChatJournalBridge.cs SHA256为0292628ce236861d6f640da25b0e27cdde5e8a35696f089ff099b70bcdb33ffb。容量脚本/源码记录见[本轮验收](validation/2026-10-19-shared-pc-seed-capacity.md)。源码/隔离通过，独立审批和PC renderer/UI接线仍分别记录，无产品窗口/设备/正式服务操作。

## 2026-10-19 小消息seed与原生device凭据接缝（源码候选）

`journal.shared`增加`seed-wire-begin/chunk/finish/cancel`，runtime的语义`seed-register/seed-resolve`自动用public/shared/shared-seed-wire.js：128KiB原始块，每个完整请求/响应JSON<256KiB，跨原DesktopPreview 8MiB outer而不改全局cap。begin只接受{method:seed-register|seed-resolve,byteLength<=34MiB,sha256}；chunk只接受{token,offset,bytesBase64,chunkSha256}；finish/cancel只token。私有临时文件max2票据、10分钟绝对过期、SHA/游标/完整长度、固定HTTP路径、Dispose/取消清本bridge文件。真实C#console/HTTP29项通过，pc-capacity-fc8feff7-aee5-4732-af59-b605d771f2c7；大于8MiB的合成完整格式roster真正小帧过outer，到业务后按其不匹配事实409，不能记为真实全量登记成功。另小合法seed成功及9MiB HTTP响应/34MiB边界见原脚本分层检查。实际WebView/UI入口仍待前端证据。

PC现在与Android对等四个固定auth动作（`journal.shared`和createDesktopSharedRequest均可调用）：`pair({code:8位数字,deviceName:1..80字符})`、`unlock({password:<=200字符})`、`auth-status({})`、`forget-device({})`。pair只POST固定/api/shared/v1/auth/pair，成功token在native拦截，不返回页面；状态仅{paired,deviceId?,deviceName?}。unlock只原/api/unlock、不缓存密码。forget只本机忘记，不等于服务器撤销。固定shared/v1业务含seed-wire finish均由native加Bearer/X-Sync-Device-Id，不以cookie代替device授权。

凭据按规范化项目绝对root+固定loopback地址SHA域保存于本用户LocalApplicationData/Shiye/shared-native-auth，DPAPI CurrentUser+scope entropy通过P/Invoke，不增加System.Security.dll引用、不改前端构建脚本。每域named Mutex串行多进程读写，私有随机tmp写入flush+原子replace。pair捕获generation，忘记/重新pair使迟到pair不能复活旧凭据；401仅DEVICE_UNAUTHORIZED且sent generation仍当前才清理，迟到旧401不删除新pair。损坏密文fail closed，可显式forget恢复，不回退明文。

19项真实C#console+实际sharedRemote鉴权HTTP通过：无凭据loopback401、pair脱敏、DPAPI非明文、进程冷重开、root/address隔离、固定unlock、revoked清理、跨进程新pair后旧401迟到仍保留、forget非server revoke。证据pc-auth-c24f5b65-6b9f-4a0b-8a2e-52119f267a20；仅合成隔离，rendererAttached:false，无正式token/remote配置/LAN/防火墙/产品UI操作。正式先sharedSync:true/remote:false由root受控推进，不能把本段视作已连正式。
