# 增量同步：前端接入契约与后端维护边界

Android开发请先读[Android标准数据与调用契约v1](ANDROID-PRODUCT-SYNC-CONTRACT.md)：按同一Entry/canonical/媒体/会话/分类信封与事务端口接线，完整wire与业务请求见其golden fixture。格式准备后可直接调用已实现产品API；实际Repository/队列接线和验证是启用条件，不以界面完成或连接成功代替。

2026-10-18最新接缝：新增**产品同步后端18789**，`var/product-sync-lab`仅合成库；在原Bearer/增量/原件通道上提供chat业务写口和朝花夕拾规则/收件/评论/来源。完整DTO与实际共用模块见[PRODUCT-SYNC-API](PRODUCT-SYNC-API.md)。用户明确本会话负责后端/数据适配，Android会话接界面/Repository；本轮未换APK或正式电脑数据源，未启用日常保存持续增量。下表18779仍是网络试验库，不能混用身份。新端口只在电脑loopback/自身100地址验过，手机正式包尚未接通此产品协议。

更新：2026-10-18。供电脑/Android前端会话读取。本文指HTTP API接入；不是硬件COM串口协议。

## 先确认接的是哪一个服务

| 服务               | 本轮地址 / 内容                                                                                 | 当前状态                                               |
| ------------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 日常拾页API        | 原有entries/chat-journal/revisit等业务口                                                        | 本轮未改监听、运行窗口或安装包                         |
| 通用同步联调服务   | `http://127.0.0.1:18769/`，独立`var/sync-lab`                                                   | 已运行，保留上一轮测试库                               |
| 本次手机通信测试库 | 电脑`http://127.0.0.1:18779/`；同网手机`http://10.196.131.17:18779/`，独立`var/sync-device-lab` | 真机应用层双向通信/一条增量已验；保留4条合成对象供查看 |

18779是新独立测试库，不能当作原有完整日记库。局域网IP可能变化，以系统地址及该目录runtime.json为准。18770已被另一个会话的loopback预览使用，不使用或停止它；本轮临时0.0.0.0:18770空同步实例已仅停止自身，改为18779。Windows的不同地址绑定可能重叠，启动前检查所有接口，而不是只看本服务PID。

当前API共同前缀为`api/sync/v1/`，协议版本1。服务根地址可含路径，例如`https://自己的服务器/shiye-sync/`；拼接时保留此前缀。**Android0.12的原生日常服务目录/朝花夕拾状态客户端尚未接这个同步协议，不能仅把它的旧API地址改为18779就视为完成。**

详细模块、端点及容量见[后端实现](SYNC-BACKEND-IMPLEMENTATION.md)，现场证据见[手机通信验收](validation/2026-10-18-sync-device-test.md)。

## 前端可传哪些参数

| 参数                          | 前端职责                                                         | 后端职责                                                           |
| ----------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------ |
| `baseUrl`                     | 连接设置；局域网/Tailscale/HTTPS服务器可切换                     | 端点行为一致；对Host、Origin、认证进行校验                         |
| `deviceName`、短时`code`      | 初次配对时提交；不混用日常API访问锁                              | 验证有效期/次数/限流，生成设备身份与令牌                           |
| `deviceId`、令牌              | 从配对返回保存；令牌置Authorization，不能放URL/日志/普通数据字段 | 只保存令牌哈希；识别/撤销设备；可选设备header必须匹配              |
| `entityType/entityId`         | 使用稳定业务身份及映射，不用各端临时气泡编号替代                 | 维护同一逻辑对象的当前版本、状态、变更和历史                       |
| `data` / `changes`            | 提交完整保真业务对象或真正更改的字段，保留未知字段               | 事务保存；根字段三方合并，正文/units/layout作为关联冲突域处理      |
| `operationId`                 | 同一次已发请求固定ID/载荷；发送失败重试不能换正文                | 幂等回执；同ID换载荷409；绝不重复创建同一操作                      |
| `baseRevision`                | 编辑的可信共同基线，不能用设备时间代替                           | 判断并发/合并；较晚服务器提交主版，旧版进入同实体冲突历史          |
| opaque `cursor`、`limit`      | 只保存原串；完成本地inbox事务后推进；limit1–200                  | 提供固定水位snapshot/pull与签名断点，校验库/epoch/模式             |
| `assetId/hash/size/mime/name` | 保持原件/出现身份，单独排媒体任务；不传绝对路径/Blob URL         | 原件分块、缺块续传、完整hash验证、去重发布、授权下载               |
| 朝花夕拾规则/绑定             | 后续通过业务服务配置口传参                                       | 服务器维护运行进度、投递回执、去重与评论关联；不是前端任意覆盖字段 |

窗口位置、尺寸、DPI等设备偏好不要自动加入同步。标签、分类、会话壁纸/头像、资料、收藏和命令映射是可同步业务数据，但各端旧身份/存储接缝需要逐类适配；当前不是已自动收集这些散落数据。

## 初次连接顺序

1. GET `health`，确认`service=shiye-sync,protocol=1`；不能仅凭端口返回200就认为连接正确。
2. 在电脑直接loopback POST `local-pairing`，header`X-Sync-Client: local-admin`；码10分钟、2次有效。代理/远程不能调用这个管理入口。前端展示并允许记下码，另一个设备用它配对。
3. 每台设备POST `pair` `{code,deviceName}`，获取各自`{deviceId,token,deviceName}`。安装版优先用系统私有凭据存储；联调网页localStorage只是测试接缝。
4. 带`Authorization: Bearer ...` GET `info`，核对`libraryId/epoch/protocol/features`。已有本地库身份不同则暂停并保留数据/队列，不能清库或直接上传到错误服务。
5. 新设备分页POST `snapshot` `{cursor:null,limit:100}`；响应`entities,cursor,hasMore,watermark,checkpoint`。快照期间进度可持久化；最终checkpoint用于pull。
6. GET `watch?cursor=...&timeout=25000`维持在线通知，有变化再pull；30秒轮询兜底。watch不推进游标、不携带权威正文。

完整持久客户端已在`public/shared/sync-v2-client.js`提供`createSyncClient`、`createIndexedDbSyncStorage`，不要在UI里另写一个只依赖内存的简易同步循环。Android以自身SQLite/原件Repository适配storage port；测试页IDB不能冒充手机完整本地仓库。

## 写入与显示的分工

```text
前端编辑 → 本地事务(内容 + outbox) → 显示“本地已保存”
                              ↓ 异步
                        POST push → 服务端事务 / 回执
                              ↓
                      只确认本次operationId

watch通知 → POST pull → 本地事务(实体 + 接收游标) → UI局部更新
```

`createSyncClient.enqueue({entityType,entityId,command,data/changes})`在本地事务完成后返回。已经在发的操作保持不可变，随后编辑进入下一操作；旧ACK不能清后来的草稿。远端接收不重新进入outbox。常规同步不扫描整库文件。

业务体保持[实际内容契约](DESKTOP-ANDROID-CONTENT-CONTRACT.md)：长文完整Entry，随想规范消息，正文shiye-richdoc/旧HTML/Markdown、UTC事件时间、手打时间来源、媒体插入时间、occurrenceId、回复与评论引用、分类/标签等。外壳`revision`是同步版本，业务`data.revision`另行保留。消息的十进制长ID须保留字符串。

**内容规范化尚需业务适配器接入**：Entry与派生units/layout不能同时成为两个可编辑源。已有正式校验/切分/身份映射路径先保真往返，再将变更登记接入事务；通用同步存储当前不会替业务口完成全部语义校验。聊天归篇投影仍只读，不从长文端反向篡改原消息。

正在编辑的篇目要保存编辑开始时的基线和脏字段。远端新版本可更新列表/本地base，但不能覆盖输入框、光标、IME，或悄悄把旧草稿标成基于新版本编辑。此部分属于安装版Repository/编辑器接入待办，不是中文联调页替产品已验。

## 冲突、撤回和媒体

- 同根字段并发：较晚服务器提交为主；另一版为同实体私有冲突历史，不产生第二条普通记录、不进朝花夕拾。不同根字段安全合并；复杂嵌套对象需拆明确字段/命令，不能假设自动逐字合并。
- 冲突历史通过GET `conflicts` / `conflicts/:id`读取。恢复是一次新的有基线编辑，不复用旧operationId。当前历史不自动过期。
- 撤回通过`withdraw`，墓碑阻止离线旧副本复活。重新编辑重发使用新ID、新消息时间。评论关联保持原对象，评论不作为回看来源。
- 原件队列使用`sync-v2-media-cache.js`或原生私有文件/任务库：本地原件先保存，文字不等待大文件；收到asset可用变更后下载并验hash，再以本地路径/URL渲染。上传中、待下载、失败需与正文同步状态分开显示。
- 不将同步回执水位当作“已经收完其它设备变化”的游标；只能以落盘的snapshot/pull响应推进。

## 错误与连接变化

401暂停并提示重新认证，保留本地待发操作；409操作ID复用/身份冲突不能盲目换ID重发；413容量不足/空媒体拒绝要显示原因，不能生成假成功图片。网络失败退避重试，用户仍可本地写。错误包为`{error:{code}}`，不要向用户显示令牌、正文或SQL细节。

更换服务地址前结束旧通知/传输，验证新地址库身份一致，再恢复主队列及媒体任务。迁移到服务器除了换baseUrl，还必须一致迁移库身份、签名密钥、设备认证、变更/回执及媒体；不能把新空库当作旧库。公开服务须HTTPS与独立管理配对通道；本轮没有公网发布。

## Android单VPN与网络路线

2026-10-18最新真机结果：用户已授权将脚本应用到当前活动FlClash配置，并用同一Google账号完成内嵌节点授权。`shiye-flclash-phone`在线；独立Tailscale不运行、FlClash进程保持，真实Android应用UID直接访问`http://100.77.215.104:18779/`完成双向合成消息与单条增量，首次/恢复日志后各6项通过。原3份订阅字节、订阅URL/节点选择和config.json全部保持，仅当前profile增加脚本绑定。其它配置切换后需显式选择同一脚本。正式客户端Repository仍未接入；不能把网络连通当作产品同步完成。模板outputs/flclash-tailscale/override.js，操作/云服务器复刻见[运行手册](FLCLASH-TAILSCALE-RUNBOOK.md)，[验收](validation/2026-10-18-flclash-tailscale.md)。下方“候选/未应用/仅局域网”是本轮开始前的历史状态。

本轮手机FlClash0.8.96保持同一进程运行时，原生临时测试包通过局域网完成下载/上传/单条增量，未启用手机Tailscale。无需先改变现有代理配置。

`DIRECT`只决定走直连，不能凭空建立Tailscale隧道。Tailscale地址段是`100.64.0.0/10`，并不是所有100开头IP。要在异地保留FlClash，需要让其内部Mihomo的`type: tailscale`节点实际登录并组网，再把该范围交给该节点。只是独立Tailscale App不运行，Tailscale协议/连接仍在FlClash内部运行；不能照抄普通DIRECT放行。

2026-10-18追加只读核对：手机FlClash0.8.96安装包`lib/arm64-v8a/libclash.so`包含tailscale.com、`outbound.NewTailscale`及`*outbound.Tailscale`，build tags为with_gvisor；证据outputs/sync-device-test/flclash-core-audit.json。可据此准备配置，但二进制存在不等于FlClash生成配置/网络回调和登录链路已经成功，未更改当前订阅/代理或完成100地址验收。

操作顺序：在已有配置的覆写中追加Tailscale节点及优先规则，切规则模式；先访问100目标触发懒加载，在日志查找首次交互登录URL，用电脑所属Tailnet账户完成授权，再重试100.77.215.104:18779。省略auth-key时官方实现会输出交互登录URL；不把登录链接、密钥或会话状态提交到项目。首次请求可能超时，节点不会仅因Mihomo启动就立刻初始化。不要配置exit-node来代替访问本机，也不要让100目标被更前面的私网DIRECT规则/TUN排除抢走。

候选覆写脚本已存outputs/sync-device-test/flclash-tailscale-override.js，默认仅将本机100.77.215.104/32送入“拾页组网”，保留其它代理/规则且重复应用不累加。它尚未应用到用户配置；如果要整个Tailnet，再改为100.64.0.0/10。若日志无登录URL或提示不支持，应核对FlClash打包/覆写/运行兼容性，不能声称仅凭装包静态检查已经可用。

候选结构（非可直接导入的完整配置）：

```yaml
proxies:
  - name: 拾页组网
    type: tailscale
    hostname: shiye-phone
    # 按所用核心支持方式交互认证；不把真实auth-key写进项目/日志。
rules:
  - IP-CIDR,100.64.0.0/10,拾页组网,no-resolve
  # 其余代理规则继续保留。
```

另一条后续路线是服务器HTTPS地址，手机不占用第二个VPN槽位。当前同网先用18779验证产品同步；不为了测试自动改订阅、VPN、系统防火墙或开机启动。

来源（2026-10-18核对）：[Tailscale与其它VPN](https://tailscale.com/docs/reference/faq/other-vpns)、[Mihomo内置Tailscale节点](https://wiki.metacubex.one/en/config/proxies/tailscale/)、[Mihomo路由规则](https://wiki.metacubex.one/config/rules/)。官方核心能力不等于任意版本FlClash打包均可用。

## 前端接入待办

### 2026-10-18补充调研：Orca云端AI与组网的边界

用户提供[原帖](https://x.com/app_sail/status/2108523630900748335)，已通过[保存副本](https://xput.app/UFENpR)的Open on X链接核对同一状态ID；X原站本轮403。文章是Grok Bot云机器运行Claude Code、Orca，再由电脑/手机经Tailscale连接的方案，本轮仅评估，未授权安装或采用此架构。

- [Orca官方](https://github.com/stablyai/orca)提供Windows/Linux/macOS与Android/iOS客户端；[远程服务](https://www.onorca.dev/docs/remote-servers)保存远程项目、终端与Agent会话，客户端断开时远程任务可继续。它是AI开发会话接入，不代替拾页实体/媒体的增量同步协议。
- 文章的直连路线仍要求手机有Tailnet路径，不能解决FlClash占用Android VPN槽位这一事实；拾页仍保留内部Mihomo Tailscale候选或独立HTTPS服务两条路径。未新增100地址连通证据。
- [Orca移动文档](https://www.onorca.dev/docs/mobile)另有Relay配对路线，需要登录且依赖相应中继；它可以为Orca会话提供另一条连接路径，不是让拾页任意100地址自动可达。移动/远程功能官方均标Beta。
- 若后续使用云端AI，建议独立自有VPS运行Orca/Agent；拾页同步服务、原件与备份单独维护。文章关于Grok云环境更新/持久性的经验不是正式存储可靠性保证，不据此迁移日记。
- 官方当前支持Linux/macOS的serve服务安装，Windows尚无该服务安装命令；文章旧命令/脚本须按实际版本重新核对。未安装Orca/Claude/Grok、未改VPN/代理/正式运行窗口，无新增测试或临时产物。

1. 连接页与协议能力识别、配对/凭据私有保存、地址切换及库身份保护。
2. 本地Repository事务port、所有写口/收件/队列及媒体原件任务，保存状态分层。
3. Entry/规范消息/分类/会话/头像壁纸/收藏等保留式业务适配；当前运行器状态只从服务读取。
4. 本机合成→双端真实副本→断网/杀进程恢复→一致备份→受控正式启用；全程旧日记不覆写。

前端UI会话维护交互和本地显示，本后端会话维护协议、存储、版本/回执、媒体与服务状态。修改参数/接口/语义时双方更新本文与DEVELOPMENT-HANDOFF，不用聊天摘要替代契约。
