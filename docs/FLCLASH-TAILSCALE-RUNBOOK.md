# FlClash 内嵌 Tailscale 与云服务器复刻

2026-10-18。用户授权配置手机 FlClash，并要求日后复刻到实际云服务器。当前已完成本机独立测试后台的真机链路；云端尚未部署。验收见 [记录](validation/2026-10-18-flclash-tailscale.md)。

## 实际可用的配置

- 手机 FlClash 0.8.96 的 Mihomo 内嵌真实 Tailscale 客户端，不是模拟启动状态。Android VPN 仍仅由 FlClash 接管，独立 Tailscale App 不启动。
- 手机节点 `shiye-flclash-phone` 已由用户以电脑同一个 Google/Tailscale 账号授权，当前地址 `100.122.227.126`，地址以后应重新查询。
- 电脑节点地址 `100.77.215.104`；测试后台 `http://100.77.215.104:18779/`，库 `D:/拾页/var/sync-device-lab`。这不是日常桌面 API，也不是已接入正式手机 Repository 的产品同步。
- 已应用 [覆写脚本](../outputs/flclash-tailscale/override.js)，仅绑定当前使用的配置。脚本新增“拾页组网”节点与目标电脑 `/32` 优先规则，不把全部网络改成 Tailnet。切到其它订阅配置时，应在该配置上显式选择同一脚本；不要以为脚本列表中存在就代表每份配置均已启用。
- 当前节点参数：`hostname=shiye-flclash-phone`、`state-dir=tailscale-shiye`、`ephemeral=false`、`udp=true`、`dialer-proxy=DIRECT`。DIRECT 在此只描述 Tailscale 自身的底层连接；目标 100 地址仍经“拾页组网”加密传输，不能把目标规则改成 DIRECT。
- 日志等级已恢复原来的 error，日志捕获恢复关闭。原三份订阅字节、订阅链接、节点选择和整个 config.json 均对照保持；只有当前 profile 的 `overwrite_type`、`script_id` 增加脚本绑定。

## 首次配置的复刻顺序

1. 在目标 FlClash 导出本地备份并校验 SHA-256。备份含订阅凭据，只放私有目录，不进源码包或公开日志。
2. 导入脚本，修改 `targetIPs` 为受信服务节点的 Tailscale IPv4。若需要同时连接电脑与云端，可保留两项。不要先开放整个 100/8；Tailscale IPv4 为 100.64.0.0/10，本次使用最窄 `/32`。
3. 为选定配置启用“脚本”模式，并明确选中该脚本。原有额外规则/其它覆写须先合并；本机原规则数据库为 0 项，因而此次切换没有丢失标准模式附加规则。
4. 首次暂开日志捕获并设 info（排错时 debug），访问一个目标 100 地址触发懒初始化。Mihomo 的节点不随 App 启动立即完成登录，首个请求超时不代表永久失败。
5. 读取 FlClash 自身日志里的 `https://login.tailscale.com/a/...`，在官方页面选择 Google，并使用服务端所属 Tailnet 的账号授权。不要提交登录链接/密钥。模板不含 auth-key。
6. 确认手机内嵌节点在线，再用真实 Android 应用 UID 测试 health、配对、上下行消息、单条增量。最后恢复日志设置，重新测试；本轮两次各 6 项通过。

App 内的 `state-dir` 保存节点身份，保持它稳定可避免每次重新授权。FlClash 普通导出备份是否包含该私有状态未验；不要依靠导出 ZIP 迁移 Tailscale 身份。清数据/重装后可能需要重新授权。

## 本次失败经验

曾把 `dialer-proxy` 改成原代理组 Final，实际触发 `SystemPacketListener ... can't resolve ip: couldn't find ip`、UDP 无法绑定，未得到可用认证。这不等同所有代理协议都不支持，但不能将该配置作为已验路线。改回 DIRECT 并重新加载配置后取得官方授权链接，用户授权后 100 地址成功。不要为了绕过这一错误开启独立 Tailscale，抢掉 FlClash 的 VPN。

修改已绑定脚本后须确认配置实际重载；本轮通过标准→脚本切换刷新并验收，不能仅以编辑器保存成功认定核心已应用。保留失败经验，不把早期静态二进制检查当作登录成功。

## 云服务器复刻

这里是待实施步骤，不代表云端已经可用。

1. 在自己的服务器安装并授权 Tailscale，查询服务器 Tailnet IPv4。不要直接复制电脑或手机的 Tailscale 状态/节点私钥。
2. 部署独立同步后台和 Node 24 运行时，使用独立的持久目录与受管服务。示意命令需替换绝对路径：

   ```sh
   TS_IPV4="$(tailscale ip -4)"
   node /opt/shiye/tools/sync-server.mjs --host "$TS_IPV4" --port 18779 --data-dir /srv/shiye-sync-test
   ```

   先用新测试库做链路验收；监听指定 Tailnet 地址，并在 Tailnet 授权及主机防火墙允许手机访问相应端口。不将端口直接暴露公网，也不为联通而关闭访问校验。systemd 的用户、目录权限、Tailscale 就绪与失败重试需要服务器实施时验证。
3. 手机 `targetIPs` 加入服务器地址，导入/重载同一脚本；客户端 `baseUrl` 改成 `http://<server-tailnet-ip>:18779/`。同一已登录手机节点可以访问同一 Tailnet 中的新服务，无需换账号或开第二个 VPN。
4. 若另提供公网域名，使用 HTTPS、认证与反代，保留 Tailnet 地址作为另一条入口；它不要求手机开第二个 VPN。不要仅将 HTTP 100 地址替换成无保护公网 IP。
5. 正式库迁移另行执行一致备份/恢复：SQLite、媒体原件、库身份/epoch、签名密钥、设备认证、版本/变更/操作回执一并迁移；客户端核对相同库身份再续用游标。只换地址并新建空库会破坏同步关系。
6. 重复真机收发、离线队列、断线恢复与原件校验，再适配正式电脑/Android Repository。当前完整产品接入仍按 [前端契约](SYNC-FRONTEND-CONTRACT.md)推进。

## 回退及验收边界

临时停用组网可把当前配置恢复为原“标准”模式，原订阅不需要替换；完整前后备份见 `D:/拾页/var/network-backups`。若需撤销网络身份，在 Tailscale 管理页仅撤销 `shiye-flclash-phone`，不删除电脑或独立 Tailscale 的其它节点。

本轮没有切换手机 Wi-Fi/移动网络、重启 FlClash/手机或部署云主机，不能据此声称跨运营商/重启后全生命周期均已验。100 地址真实应用通信已验，额外公网代理检查被工具自动审批拒绝、未执行；原代理保留以备份一致性和已有 FlClash 运行日志为证，不宣称额外公网请求检查通过。

官方依据：[Mihomo Tailscale](https://wiki.metacubex.one/config/proxies/tailscale/)、[FlClash v0.8.96 覆写实现](https://github.com/chen08209/FlClash/blob/v0.8.96/lib/providers/actions/setup.dart)。当前可用性以本轮设备证据为准。
