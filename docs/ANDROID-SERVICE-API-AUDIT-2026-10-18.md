# Android 会话服务实际接口核查

2026-10-18。范围：只读核对本工作树的实际 Node 路由、访问保护和 Android 入口；未访问正式库、设备、运行接口，未重启桌面或手机。本文是适配依据，不是联网或同步已交付回执。共享工作树存在并行开发，实施前重新确认代码和 health 能力。

## 已有服务与接口

实际装配入口为 `src/server/app.mjs` → `routes/conversation-services.mjs`。现有 provider 仅 `revisit`（朝花夕拾），没有已实现的 AI provider。服务发现不是任意插件安装/远端 URL 注册。

| HTTP / 路径                                         | 请求                                              | 实际响应与约束                                                                                                                                                                                                                          |
| --------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET `/api/health`                                   | 无                                                | `conversationServices:{version:1,providers:['revisit'],isolatedInstances:true,autoStart}`；同时有 revisit 版本/段落/缩进/runner 能力。应用版本号不能代替能力发现。                                                                      |
| GET `/api/conversation-services`                    | 无                                                | `{version,revision,providers,instances,bindings,legacy}`。provider 有配置描述、实时分类、capabilities；实例只有 id/providerId/name/config，不暴露完整运行 state。读取空注册表不创建记录。legacy 指向原 `/api/revisit`，两者不自动合并。 |
| POST `/api/conversation-services/instances`         | `{id,providerId:'revisit',name,config:{...}}`     | 201 `{id,providerId,name,config}`。客户端生成并持久保留小写 UUID。相同 ID/相同创建参数可重试；不同参数 409。默认不启用，默认 daily-random/08:00/北京时间；实例最多128。                                                                 |
| PUT `/api/conversation-services/bindings`           | `{id,conversationId,instanceId,expectedRevision}` | 200 `{id,conversationId,instanceId,active,revision}`。新绑定版本0；会话和实例均只能有一个活动绑定。解除传 instanceId:null，保留历史归属；bindingId 不能改属另一会话，版本冲突409，最多512绑定。                                         |
| POST `/api/conversation-services/request`           | `{instanceId,action,payload:{}}`                  | 固定动作分派；无参也必须是对象。业务响应加 `scope:{instanceId,providerId,bindingId,bindingRevision}`；未知动作400，未知实例404，非法UUID400。                                                                                           |
| GET `/api/conversation-services/comments?entryId=…` | 旧篇稳定ID                                        | `{entryId,comments}`，聚合新实例与旧单例，附 instanceId/providerId，按评论时间排序。                                                                                                                                                    |

实例 config 可用字段：enabled、title、mode、dailyTime、sourceDateFrom/sourceDateTo、interval、timeZone、categories、sender。创建参数白名单拒绝未知配置键；后续 config 使用其自身 `expectedRevision`，不能用 registry/binding revision 代替。历史日期为空传 null；起止均包含，随机模式按来源消息在实例时区的日期筛选。

固定动作及其实际 REST 等价入口：`/api/conversation-services/instances/<uuid>/revisit` 为 status；后缀来自白名单，未开放 archive/restore、删除实例或任意转发。

| action        | payload                                                        | 响应/等价REST                                                                                |
| ------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| status        | `{}`                                                           | config/categories/cursor，随机模式另有 randomDay；GET实例根                                  |
| config        | `{expectedRevision,...实际修改字段}`                           | 新配置；PUT `/config`                                                                        |
| feed          | `{after:0,limit:50}`                                           | config/deliveries/batches/next/total；POST `/feed`，每实例独立sequence，next不是全库同步游标 |
| source        | `{deliveryId}`                                                 | 来源投影、timeZone、entryHtml、该实例按篇comments；POST `/source`。HTML仍须sanitize          |
| media         | `{deliveryId,assetId,offset:0}`                                | `{bytes:base64,offset,size,type,name,done}`，原字节分块，校验资源属于该来源；POST `/media`   |
| context       | `{batchId,deliveryId?,occurrenceId?}`                          | 验证固定评论对象；POST `/comments/context`                                                   |
| comment       | `{operationId,batchId,deliveryId?,occurrenceId?,text,sentAt?}` | 201，实例内幂等评论；POST `/comments`                                                        |
| withdraw      | `{operationId}`                                                | 撤回该实例评论，墓碑优先；POST `/comments/withdraw`                                          |
| comments      | `{entryId}`                                                    | 实例评论与定位；GET `/comments?entryId=…`                                                    |
| tick          | `{}` 或 `{manual:true,from,to}`                                | 服务端时钟投递结果；POST `/tick`。客户端不提交自造投递/随机结果                              |
| runner-status | `{}`                                                           | running/state/intervalMs/failure与下次尝试等状态；GET `/runner`                              |
| runner-start  | `{intervalSeconds:30}`                                         | POST `/runner/start`，仅5–3600整数，未绑定409                                                |
| runner-stop   | `{}`                                                           | POST `/runner/stop`，只暂停本次后台，不等于持久关闭enabled                                   |

未绑定实例自动tick返回 disabled且不推进；手动补看和旧历史/评论仍可访问。生产后台在活动绑定且enabled时自动续推；解绑收起运行器。多个实例的规则、日期、进度、投递、评论分离，经同一 mutate 队列落库。原单例与原固定房间必须继续保留。

## 当前手机不能直接填电脑IP联网

1. `config/app.json` 和 `runtimeConfig` 将服务监听固定为127.0.0.1，没有 DIARY_HOST 远程覆盖入口。
2. `guardRequest` 仅接受 `Host:127.0.0.1:<port>` 或 `localhost:<port>`。局域网IP/域名Host直接403；仅改监听地址不能完成远程接入。
3. 写口及其他非GET/HEAD请求强制 `X-Diary-Client:desktop`；如带Origin，必须为当前 `http://<Host>`。Android WebView来源 `https://appassets.androidplatform.net` 不匹配。
4. 本机服务不返回跨域允许头，也没有专门OPTIONS/CORS通道。原生HTTP不受浏览器CORS约束，但仍须经过Host、身份和业务校验。当前写口中的desktop字段是本机来源约束，不能当远端用户认证。
5. 本地访问锁以 `diary_session` Cookie 鉴权；HttpOnly/SameSite=Strict，内存30分钟滑动有效，进程重启后失效。GET `/api/access`查 enabled/unlocked，POST `/api/unlock`以密码解锁；连续5次失败阻断5分钟。没有远端账户、设备配对、Bearer入口或持久设备授权。未启用访问锁也不表示可公网开放。
6. Android manifest当前没有 INTERNET，且 usesCleartextTraffic=false；思绪页CSP为 connect-src 'self'。`MainActivity` 与 `TelegramFrontend` 的资源拦截只服务 appassets 本地GET资源，非远端URL返回missing。当前固定桥也没有服务网络 transport。

结论：新增一个IP表单、把localhost换成电脑IP或放宽既有Host/Origin都不足以完成接入。应保留本机防护，在独立远端边界提供认证授权与transport；本地/云端切换通过端点配置及相同业务适配器完成，不让UI持有任意转发能力。

## 本轮可落地的适配接缝

- 服务目录/设置状态与网络transport分离。UI可复用实际 provider/config/binding 合同，先做能力门槛、表单、版本冲突与错误反馈，只有真实回执后显示接入成功。离线显示本地模式或明确未连接，不能假成功。
- 使用固定 native RPC：catalog、create、bind、request（action白名单），远端地址/认证交由受信原生transport维护。不能暴露网页传任意URL/任意HTTP头的代理。
- 本地持久化 service instance/binding及配置待发操作；与本地修改/outbox同事务才ACK本地保存。远端ACK单独确认。创建重试保留同UUID/原参数，创建成功而绑定失败不重新建实例。
- 建立稳定 conversationId 与旧 sourceId/roomId 的保留式映射；不能用标题或裸TL数字作为跨端身份。实际后端不检查会话在TL是否存在，调用方必须维护映射与归属，不将后端成功误当跨端身份已统一。
- 本轮连接页可开放发现目录、查看已有实例及其状态；绑定/切换会话服务须等待规范conversation身份映射完成。界面应明确该门槛，不能临时拼TL数字/标题并自动绑定。请求先核对版本化health/服务目录能力，未声明的provider/action不展示为可用。
- 接收以 instanceId 独立分页，消息保留 instanceId+deliveryId/batchId/occurrenceId；评论/撤回在排队时冻结来源作用域。切绑定、新来信或设置切换不能改写已发/待发评论目标。
- `previews/telegram-chat/shiye-revisit-client.js` 当前硬编码 `REVISIT_ROOM=-900000001`，并从0重读feed重验来源；属于旧单例receiver，不可原封复制成多实例或增量同步实现。需要注入会话/实例上下文，并与旧单例分别处理。
- 手机保有完整业务数据和原件；不要把远端feed当唯一长期资料。现LocalStore/私有media/TL IDB保留。完整信封/未知字段/身份/媒体/outbox/inbox迁移门槛仍遵从 ANDROID-LOCAL-FIRST-STORAGE 与实际内容契约。

## 同步与迁云边界

当前装配的 `/api/sync`、`/api/sync/status` 是电脑代访问旧WebDAV/一本日记整文件兼容协议，不是本项目Android的通用增量服务，也不包含多服务配置/绑定/外观/消息的完整变化流。

核查时工作树存在并行候选 `src/server/sync-v2/store.mjs`、`src/server/sync-v2/media.mjs` 与 `public/shared/sync-v2-client.js`；客户端调用 `api/sync/v1/*` 并使用Bearer，但当前 `app.mjs` 未装配该路由，不能据此写成正式API已经存在。SYNC-PROTOCOL-DRAFT本身也标明草案，需以后端正式契约和运行health为准。

未来服务器执行朝花夕拾可复用现有纯业务模块与实例身份。当前runner客户端URL只允许loopback、用本机Cookie，hosts为进程内Map；这些不是云端多副本租约/fencing或无人值守身份。迁云还须持久任务所有权、幂等提交/变更登记、独立认证、媒体授权及本地/云切换边界；不能把现有运行游标从手机上传覆盖云端。

## 定向验证建议与本次证据

本次仅纯内存执行 guardRequest/registry 断言，已通过：本机Host接受、局域网Host拒绝、android写头拒绝、appassets Origin拒绝、本机原生无Origin+desktop写头接受；目录读取不初始化、revisit创建默认禁用、绑定版本及过期冲突。无HTTP请求、无正式数据读写、无设备/部署行为；未跑全库或既有多实例完整测试。

后续实施优先用合成隔离服务：两个会话独立实例发现/创建/绑定/规则/重开/收件；创建或绑定ACK丢失重试；409重新读且保留表单；未绑定禁自动；断网本地读写与重开outbox恢复；切绑定不改评论对象；同来源不同投递身份；撤回/引用/媒体原字节；旧单例与新实例共存；访问锁/错误凭据与凭据不入日志。另验实际Android原生联网链路与清晰错误状态，不能以浏览器mock替代。

本报告位于 `docs/ANDROID-SERVICE-API-AUDIT-2026-10-18.md`。本次无额外文件产物；后续产物约定 `outputs/2026-10-18-android-service-adaptation/`，临时 `tmp/android-service-adaptation/`。未创建或清理这两个目录。
