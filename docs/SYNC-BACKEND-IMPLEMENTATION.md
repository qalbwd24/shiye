# 增量同步后台与客户端接缝

2026-10-18产品服务扩展已增加：`src/server/sync-product`、`public/shared/sync-product{,-client}.js`及`tools/product-sync-server.mjs`。隔离18789统一认证/增量与chat/revisit业务端口，保真信封、canonical长文、只读聊天投影、原件seed/续传和业务事务队列已具备。实际接口与未接入的电脑保存/Android Repository边界见[PRODUCT-SYNC-API](PRODUCT-SYNC-API.md)，验收见[本轮记录](validation/2026-10-18-product-sync.md)。不是把日常库切换到云同步。

2026-10-18补充：已完成真实手机在FlClash保持运行时的局域网双向消息与1条元数据增量验证。新手测库独立在var/sync-device-lab、端口18779，原18769测试库保留。前端参数、认证、游标、Repository接入与后端维护职责以[前端接入契约](SYNC-FRONTEND-CONTRACT.md)为准；[真机证据](validation/2026-10-18-sync-device-test.md)。正式客户端仍未接此同步服务。

2026-10-18。当前阶段：独立服务、共用同步客户端、媒体任务队列和中文联调页；验证结果见[本轮验收](validation/2026-10-18-sync-backend.md)。日常电脑程序、正式日记和手机安装版没有切换到此服务。算法来源与之前方案分别见[调研](SYNC-ALGORITHM-RESEARCH-2026-10-18.md)、[设计](SYNC-V2-DESIGN.md)，下文是本轮实际接口，不用草案推断现存 API。

## 用户确认与范围

- 先在本机建立后台，以后使用 Tailscale 地址或自己的服务器域名；客户端只有一个可配置服务根地址，允许反代前缀。
- 思绪、随想继续使用已有业务格式。同步外壳不重写正文、时间、分类、会话及媒体身份；业务 `data.revision` 与同步外壳 `revision` 独立。
- 同一字段的并发修改：**较晚的服务器提交为当前版本**。被替换版本保存在同一实体的冲突历史，不生成第二篇日记、第二条消息，也不参与朝花夕拾。不同字段三方合并。
- “较晚”不比较手机/电脑墙上时钟。离线旧稿晚提交会成为当前版本，被替换内容仍可找回。重试同一 operationId 不算新提交。
- 撤回墓碑优先，离线编辑不能复活消息。按已有规则，撤回后重发是新 ID、新消息时间。评论关联与回看运行状态不是普通正文覆盖项。
- 客户端先持久保存本地内容及 outbox，再异步传输。长文/消息、元数据、媒体原件都应有完整本地副本；界面写入不等待远端 ACK。

## 模块分工

| 文件                                   | 职责                                                                     |
| -------------------------------------- | ------------------------------------------------------------------------ |
| `src/server/sync-v2/store.mjs`         | SQLite 事务实体、版本、操作回执、变更序号、冲突旁支、签名分页游标        |
| `src/server/sync-v2/auth.mjs`          | 短时配对码、设备令牌哈希、撤销与配对限流                                 |
| `src/server/sync-v2/server.mjs`        | 独立 HTTP API、Host/Origin 校验、长轮询通知、媒体流和静态联调页          |
| `src/server/sync-v2/media.mjs`         | 原件 hash 去重、缺块上传、完成校验、发布恢复与下载范围                   |
| `public/shared/sync-v2-client.js`      | 持久事务 outbox/inbox、丢 ACK 重试、接收游标、合并本地待发编辑、认证暂停 |
| `public/shared/sync-v2-media.js`       | 原件分块传输、流式 SHA-256；局域网 HTTP 无 SubtleCrypto 仍可用           |
| `public/shared/sync-v2-media-cache.js` | 独立 IDB 原件及上传/下载任务，断网重开后续传，不保存设备凭证             |
| `tools/sync-server.mjs`                | 显式目录、端口、绑定地址与前缀，运行回执、排他锁、优雅关闭               |
| `public/sync-lab/`                     | 中文测试页，电脑/手机浏览器分别配对；纯合成内容联调，不接正式数据        |

没有复用或放开日常 localhost API 的访问保护。同步服务不挂载 `/api/entries` 等正式 API，也不会自行读取 `diary.json`；数据目录中存在 diary.json 会拒绝启动。

## 传输与版本

根地址例：`http://电脑IP:18769/`、`http://TailscaleIP:18769/`、`https://自己的域名/shiye-sync/`。以下路径相对于根地址，不能丢掉反代前缀。

```json
{
  "operationId": "一次编辑的稳定随机ID",
  "entityType": "journalAggregate",
  "entityId": "保留业务稳定ID",
  "baseRevision": 3,
  "command": "updateFields",
  "changes": { "categoryId": "已有分类ID" }
}
```

外壳 `{entityType,entityId,revision,state,data,updatedAt,lastSeq}`；`data` 保存实际 Entry/规范消息或相应元数据，不把绝对文件路径、密码、令牌、服务器运行游标混入同步载荷。未知业务字段保留。长文正文相关字段视为一组冲突域，不能将正文 A 与另一个版本的 units/layout 任意拼接。

支持 create、updateFields、delete、withdraw、restore。asset 与服务运行输出由服务器拥有，不能经普通 push 伪造。当前通用存储还没有接入正式内容命令的语义校验/规范化，不能把它当作日常 Entry、规范消息的第二个可编辑权威源。

同一 SQLite 事务提交实体、旧版本、变更及操作回执。相同 operationId、相同载荷重放回同一结果；同 ID 改载荷返回409。事务失败全部回滚。客户端每实体只发送队头操作，已发请求冻结载荷，后续编辑排下一次；ACK 只移除本次操作，不清掉后来的草稿。

首次 snapshot 和之后 pull 均固定 watermark，分页期间的新写入在之后增量获得。签名游标绑定库身份、epoch、分页模式与水位；恢复其它库或 epoch 变化时客户端暂停，保留本地内容和待发队列，不清库重来。客户端只有在实体与游标同事务落盘后才前移游标，**push 返回的水位不能当作已经接收完的游标**。

在线使用25秒长轮询 watch；有变更立即返回，再按游标 pull。通知只负责唤醒，断开/丢通知靠持久游标补齐；客户端30秒轮询兜底。正常 pull 不扫描全文或所有媒体。首次快照、媒体首次完整下载和客户端本地列表是各自的完整枚举场景，不混称“全部都是增量”。

## 实际 API

| 方法与相对路径                                     | 用途                                                                                     |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| GET `api/sync/v1/health`                           | 无私密信息的存活检查                                                                     |
| POST `api/sync/v1/local-pairing`                   | 仅直接 loopback + `X-Sync-Client: local-admin`，10分钟/2次码；代理请求及公开来源模式禁止 |
| POST `api/sync/v1/pair`                            | `{code,deviceName}` 换设备 ID/令牌；令牌只在此返回，库内只留哈希                         |
| GET `api/sync/v1/info`                             | 协议1、库身份、epoch、水位与能力                                                         |
| POST `api/sync/v1/snapshot` / `pull`               | `{cursor,limit}`，分页数据及 checkpoint/hasMore                                          |
| POST `api/sync/v1/push`                            | `{operations:[...]}`，逐项回执                                                           |
| GET `api/sync/v1/watch?cursor=...&timeout=25000`   | 变更通知，不推进接收位置；最多64个待机请求                                               |
| GET `api/sync/v1/conflicts` / `conflicts/:id`      | 私有冲突历史；恢复是对当前实体提交新编辑                                                 |
| GET / DELETE `api/sync/v1/devices` / `devices/:id` | 已配对设备与撤销                                                                         |
| POST `api/sync/v1/media/uploads`                   | `{assetId,sha256,size,mime,name}`，返回缺块                                              |
| GET `.../media/uploads/:id`                        | 上传进度                                                                                 |
| PUT `.../media/uploads/:id/chunks/:index`          | 原字节分块，默认256KiB，支持可选块 hash                                                  |
| POST `.../media/uploads/:id/complete`              | 原件完整校验，再发布 asset 变更                                                          |
| GET `.../media/assets/:id` / `:id/content`         | 元数据/授权下载；content 支持单一 Range                                                  |

除 health、pair、本机配对和静态页外使用 `Authorization: Bearer ...`。如发送 `X-Sync-Device-Id`，必须与令牌身份一致。不把令牌放 URL。限定 Host/Origin，拒绝代理伪装本机管理员；任意域名需显式允许。HTML/SVG 等主动文档只能作为下载附件，返回 nosniff 与 sandbox，不能变成同源可执行网页。

媒体须非空，默认上限512MiB，操作1MiB、批次4MiB。这是本轮明确容量，超大视频、超长正文需后续扩展流式策略，不能静默截断。媒体原件不因同步重复压缩；GIF 保留动画字节。媒体完成、主变更发布、markPublished 之间崩溃，重开会按索引恢复发布，同一 asset 不重复创建变更。

## 本机启动与联调

在 `D:\拾页` 使用 Node24：

```powershell
node tools/sync-server.mjs --host 0.0.0.0 --port 18769 --data-dir var/sync-lab
```

1. 电脑打开 `http://127.0.0.1:18769/`，生成配对码，给电脑设备名称并配对。
2. 手机与电脑处于可互通网络，打开同端口的电脑局域网/Tailscale地址，填自己的设备名与同一码配对。不使用手机的127.0.0.1。
3. 两端分别新建消息/长文/会话或分类，测试自动出现、同一条编辑、暂停同步后的本地保存、恢复后续传、原件下载。
4. 浏览器只是独立联调入口，未提供离线静态壳；页面已打开时可离线写，完全断网后首次打开网页不属于已实现能力。安装版将由自己的本地页面及 Repository 实现离线冷启动。

默认 CLI 只绑定127.0.0.1；上面的显式0.0.0.0参数才开放局域网。绑定成功不等于手机路径/防火墙已通，本轮不修改系统防火墙、不安装 Tailscale、不配置路由端口。runtime.json 不含配对码或令牌。前台运行 Ctrl+C 会优雅停服；异常终止留下的锁不擅自接管，先核对 PID/服务归属。

## 迁移服务器与后续客户端接入

服务代码不依赖 Windows UI；Node24+SQLite 与原件目录可部署服务器。Tailscale 内使用受控网络地址，公开访问由 HTTPS 反向代理转发，配置 `--public-origin https://域名 --allowed-host 域名`。公开模式关闭 HTTP 本机配对入口；还需独立管理通道完成发码/设备管理，不直接把内网联调服务裸露到公网。

客户端地址可以单项切换，但迁移服务器**还要一致备份/迁入该库、身份/签名密钥、设备认证及媒体**；仅新建空服务器然后改地址不是迁移。须先停写/在线一致备份，再校验内容与身份。当前没有自动云部署、证书、云备份、日志裁剪或多账户隔离。

下一步按前后端分离推进：

1. **业务适配器**：从现有主库/API/Android LocalStore 生成稳定外壳，保留未知字段和分类名↔ID、TL room/message↔规范 ID 映射。Entry 与派生 units/layout 经同一规范化命令提交；不双写两套可编辑正文。只做副本往返后再讨论正式启用。
2. **客户端 Repository**：Android 使用其 SQLite/私有原件；Windows 桥接现有本地库。内容+outbox 同一事务；远端 inbox 原子应用；正在编辑内容的基线/脏字段必须保留，不能收到远端更新就覆盖光标或用新基线冒充用户基于该版本编辑。当前浏览器客户端为独立 IDB 接缝，尚未替换手机/日常随想存储。
3. **素材及零散元数据**：分类/标签/会话/头像/壁纸/收藏/命令映射逐类适配；窗口位置/设备尺寸留本设备。保留现有素材库，不重压缩或删除旧资源。
4. **正式导入与切换**：只读预检→隔离副本→双端实际往返→一致备份→受控启用；旧日记不覆写。
5. **服务器朝花夕拾**：复用已有来源/投递/状态/评论模块，在服务器执行；客户端只同步配置/绑定/评论。运行游标、租约、去重回执由服务端拥有。本轮没有把旧运行器迁入这个新后台。

## 验证入口

`tests/sync-v2-*.test.mjs` 覆盖存储并发/回滚、双端 IDB、真实 HTTP、认证/通知、媒体恢复。`tools/verify-sync-lab.mjs` 在两个独立浏览器 context 中操作中文页面，不触碰日常窗口；证据写 outputs/sync-backend，合成库及中间文件写 tmp/sync-backend。每次按实际报告记录，不把 Node/fake-IDB 通过当作手机物理网络或已安装客户端通过。
