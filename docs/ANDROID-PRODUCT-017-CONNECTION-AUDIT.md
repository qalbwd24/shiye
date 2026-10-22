# Android 产品后端 017：连接、身份与接入缺口审计

2026-10-18，只读现场快照。用户要求本机组网后继续完善安卓后端；本轮保持手机/主AVD的0.16 QQ皮肤(code18)供用户UI测试，后端功能仅隔离QA。版本由根代理本轮上下文提供，本审计没有启动/停止/替换应用或读取用户内容。

## 当前实际连接

| root /用途 | 本轮事实 | 能力与边界 |
| --- | --- | --- |
| `http://127.0.0.1:18789/`（电脑本机） | runtime及监听一致，PID8840、0.0.0.0:18789；Node product-sync-server，data-dir `var/product-sync-lab`，seed `var/product-sync-demo-source/diary.json` | GET sync health200：shiye-sync/protocol1/isolated=true；product.schema1/entities1/legacyImport1/payloadAssets=true/revisit1 |
| `http://100.77.215.104:18789/`（Tailnet产品入口） | 电脑自身访问health200，同上能力 | 仅证明电脑自身地址通达；未证明手机UID实际访问新18789成功 |
| `http://127.0.0.1:18779/` / `http://100.77.215.104:18779/` | 独立网络试验服务，PID3600、0.0.0.0:18779，data-dir `var/sync-device-lab`；本轮loopback health200，未声明product能力 | 运行手册中的旧真机双向通信证据属于18779；不能替代18789产品协议/资料库接入证据 |
| `http://127.0.0.1:18765/` | 日常server.mjs，PID47308，API health200/version0.9.25 | 原日常entries/chat-journal/收藏/多实例业务协议；不是sync根，也非隔离QA可写目标 |

进程可执行文件均当前Node24；PID只为快照，不作为后续操作依据。产品 runtime 还列出172.29.32.1和10.196.131.17，但本轮没有从其他设备验证这些接口，不推荐把虚拟网卡IP当手机入口。云服务未由本轮部署。

本轮无Bearer请求 `sync/info`、`product/catalog`均401 `DEVICE_UNAUTHORIZED`，符合鉴权顺序；401发生在产品路由前，因此不能单靠401证明某个受保护路由已存在，产品功能事实另以health和实际源码交叉核对。本轮不生成配对码、不新建设备、不取用既有令牌、不读取正文。

HTTP脱敏记录及UTC时间：`outputs/2026-10-18-android-product-017/audit/http-readonly.json`。

## 库身份：两端口不可互换

仅用SQLite `mode=ro`读取各库metadata的libraryId/epoch两个公开身份字段，未读取devices/auth/正文表。它们不属于凭据，但也不能充当认证。

| 库 | libraryId | epoch |
| --- | --- | --- |
| product-sync-lab /18789 | `cece0ce6-40e2-4b55-a515-594dec7891b9` | `5d48426a-dab0-4976-aedf-50b59237bdb2` |
| sync-device-lab /18779 | `971332d5-026d-4b0f-8d98-e3154e5800eb` | `d5afa800-1ccb-4a6a-baa8-653578251b66` |

身份来自只读存储元数据，不是本轮已认证Android info回执。客户端仍须以同一会话的Bearer info/catalog核对；不能用本文常量跳过验证，也不能拿18779令牌、snapshot checkpoint、pull cursor或媒体断点直接续18789。

## 当前组网和转发状态

- 电脑Tailscale CLI：BackendState=Running，SelfIPv4=100.77.215.104；已知`shiye-flclash-phone` IPv4=100.122.227.126，Online=true、Active=false。Online只证明节点状态，Active=false不证明目标应用失败或当前有流量。
- ADB两设备均device状态。`forward --list`只有手机19243和AVD52544的WebView DevTools localabstract通道；它们是调试转发，不是数据同步入口。
- 手机及AVD分别执行的`reverse --list`均空。本轮没有发现18789/18779数据reverse，未创建/删除任何forward/reverse。用户所述转发可能指FlClash/Tailscale组网或另一时刻的配置，应以实际应用UID请求验证，不能把DevTools连接冒充同步连通。
- 既有FlClash手册已记录Mihomo内嵌Tailscale、仅电脑/32目标规则与实际应用UID访问18779成功；本轮未读取/重载手机订阅、配置、VPN或MT，未验证其进程生命周期。手机独立Tailscale是否仍关闭不在本轮新增证据中。

## Android真实可达的验证路径

现存015 `AndroidSyncTransport.normalizeBaseUrl`只允许HTTPS任意合法host，或HTTP localhost/127.0.0.1；`backend_network_security.xml`也仅这两host明文例外。直接填 `http://100.77.215.104:18789/` 会先被客户端拒绝，不能用Tailscale在线绕过此限制。WebView网络guard亦不应为原生联网而全局放开。

两条隔离QA路径应分开验收：

1. **本地ADB传输QA**：由根代理显式为独立QA包/所选设备建立临时 `reverse tcp:18789 tcp:18789`，QA填写 `http://127.0.0.1:18789/`。验证health→用户显式提供新库配对码→pair→info/catalog同身份。此路径可以验证015/017协议与私有凭据，但绕过手机VPN/Tailnet，不能作为异地直连证据；只清理本任务自建reverse。
2. **真正手机Tailnet路径**：独立QA包对单一100.77.215.104设计最窄明文host例外（同时处理URL策略与NetworkSecurityConfig），或配置真实可信HTTPS入口。不得全局cleartext、关闭TLS校验或注入任意URL桥。让只有INTERNET权限的实际QA应用UID直接访问18789；不靠电脑HTTP、shell curl、DevTools代理或ADB reverse冒充应用网络。保留当前FlClash/VPN配置，确认目标请求经已有Tailnet路径。此项需要后续实现与根代理验证，本轮未改网络策略。

正常部署到云时保留可选root路径前缀，使用HTTPS/受控管理配对；若迁同一资料库，必须一致保留libraryId/epoch、签名密钥、设备认证、变更与回执、原件。新空库应显示不同库并暂停，绝不清本地/重写游标。

## 015现状与新标准的实际差距

| 范围 | 当前015源码/历史QA | 017按最新标准需补 |
| --- | --- | --- |
| UI及认证 | 服务连接→设备同步与配对；固定health/pair/info，Keystore AES-GCM私有凭据、地址代际取消、library/epoch守卫；contentSyncEnabled=false。015候选独立QA证据不代表016主包已携带 | 合并时保留016触控/QQ皮肤，按实际APK资产验证；扩展产品能力/catalog识别与可见状态。配对成功只写“连接身份已核实” |
| 传输 | 仅sync/v1三个固定端点；POST body≤2048字节、响应≤256KiB、readTimeout12秒；只适于小认证结果 | 固定snapshot/pull/push/watch/conflicts/media及product端点；watch覆盖25秒并取消、单生命周期调度、不同端点容量预算/流式原件，不把256KiB认证上限硬套大页或媒体 |
| Repository | LocalStore旧schema3/TL IDB生产权威未改；Entry准备模块canCommit=false | 唯一权威完整信封、未知字段、base与localRevision、同事务outbox/inbox/cursor/conflict、迁移/旧reader恢复；先写TL后异步复制另一库不是原子 |
| 内容与身份 | 共用长文准备/fixture有隔离一致证据 | 真正prepareProductEntry/payload/hydrate生产保存；完整canonical/独立附件/时钟保留。room/message/reply是可能超过long的十进制字符串，sourceId UUID与复合身份持久映射，不能使用标题或TL裸数字代替 |
| 业务调用 | 旧BackendServices为日常服务/实例查询；新product客户端模块存在但未接Android生产 | 共用createProductServiceClient固定chat/room/send/withdraw、revisit规则/收件/来源/评论；同Bearer/库身份。旧`/api/stickers`与product sticker实体scope显式映射，不能仅换URL |
| 原件 | 014收藏64MiB与128KiB桥块是另一条业务管线 | sync媒体512MiB/默认256KiB块，hash/断点/私有任务；业务media元数据与asset原件回执分开；大Entry正文payload另管理。不得用缩略图替代原件 |
| 朝花夕拾 | 日常多实例目录与状态查询仍有旧接缝 | 18789当前只声明一个库级流。config expectedRevision、feed.after/next独立、source只读；评论冻结batch/delivery/occurrence目标。catalog无多实例则不能显示已创建/绑定多个服务；不能push binding实体就宣称运行器存在 |
| 完成状态 | health/配对/本地flush ACK均不等于内容同步 | 显示本地已保存、待同步、服务器确认、原件待下载、冲突/认证暂停；未知实体保真接收，不过滤后推进cursor，空远端不清旧资料 |

源码重点：`AndroidSyncTransport.java`、`SyncConnectionPage.java`、`backend_network_security.xml`、`public/shared/sync-product-client.js`、`src/server/sync-v2/server.mjs`、`src/server/sync-product/service.mjs`。旧015文档中“尚未同服挂载业务”属于历史状态，当前18789已提供product能力；反过来也不能把后端已提供写成Android已接好。

## 可安全先接的界面与隔离QA

先沿“设置→服务连接→设备同步与配对”补展示，不另设主导航：保留日常业务/收藏地址，独立同步root、库身份、协议/product能力、连接/未认证/不同库/取消；catalog只显示能力和单库回看入口，尚无Repository时不要有会造成真实全量上传的自动同步开关。前台返回取消网络，晚回包不覆盖新页/地址。

隔离合成QA先覆盖：路径前缀、health与受保护catalog、错误/过期认证、不同library/epoch暂停、401保留资料、旧请求取消；完整标准golden逐对象往返（超long ID/未知字段/null/时区）；整页事务失败/强杀回滚、空服务器与快照中断不清旧资料；本地保存与命令同时提交、丢ACK幂等且迟到ACK不清新草稿；依赖先于chat/send、原件断点/hash、withdrawn data={}；固定回看单条/组/媒体目标，新来信不改重试目标。纯只读连接页可以先完成，但发送/收件/编辑开关需对应持久门槛后启用。

当前日常电脑保存尚未持续登记产品增量，18789仍只有合成资料；即使独立QA上下行通过，也不能写成手机与日常电脑完整数据已互通。正式手机继续供用户测试UI，本轮不安装QA、不产生测试评论或修改现有内容。

## 权限与原生联网边界

sync服务实际guard校验已知Host；存在Origin才校验同源/允许来源，原生HttpURLConnection默认不发Origin。若从appassets WebView直接fetch，Origin会不匹配且遇本地guard，不能通过随意增加CORS星号解决；固定原生transport符合当前分层。所有product口走同一Bearer认证，远程客户端不能调用loopback local-pairing管理员口。旧X-Diary-Client头不是sync认证。报告没有token、配对码、正文或原件。

正式依据：[Android标准契约](ANDROID-PRODUCT-SYNC-CONTRACT.md)、[产品API](PRODUCT-SYNC-API.md)、[015交接](ANDROID-BACKEND-015-HANDOFF.md)、[组网手册](FLCLASH-TAILSCALE-RUNBOOK.md)。这些文档中的端口/PID均需后续重新查询。本轮仅新增本文与脱敏HTTP审计产物，不改共享入口、服务配置、转发或设备用户内容。
