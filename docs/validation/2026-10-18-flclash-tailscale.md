# FlClash 内嵌 Tailscale 真机通信验收

2026-10-18，北京时间约14:41–15:05。范围：实体 Magic7、FlClash 0.8.96、独立拾页同步测试后台 18779。正式日记、日常桌面窗口和正式手机 APK 均未操作；AVD 未操作。

## 结果

用户以 Google 账号完成官方授权。电脑查询 `shiye-flclash-phone` 在线、`100.122.227.126`；独立 Tailscale App 无进程，FlClash PID26399从开始到结束相同（仅本轮快照，后续重新查询）。电脑目标 `100.77.215.104:18779`，测试库 `var/sync-device-lab`。

1. 经手机代理端口访问目标 health：HTTP200、约0.214570秒，正文 `service=shiye-sync, protocol=1, isolated=true`。此项单独使用 ADB forward 连接手机代理入口，不作为 Android VPN 路径的唯一证据。
2. 随后撤掉本轮 ADB forward/reverse，再使用只有 INTERNET 权限的独立原生测试包、实际应用 UID 直接请求100地址。首次和恢复日志后的最终测试各6项通过：health/配对、下载电脑消息、上传手机消息、电脑读回唯一消息、只接收1条会话元数据增量、FlClash保持且独立Tailscale关闭。
3. 两次测试使用各自 UUID 命名空间，仅创建合成记录，不覆写已有测试记录，更没有接触正式日记。
4. 临时测试包已卸载 Success，并查询包路径为空。正式包未替换；其它会话 ADB forward 保留，本轮18780/18781转发均已撤掉，临时脚本导入HTTP服务已停止。
5. 备份对照全部通过：原3份 profiles 文件字节相同；订阅URL和selected_map相同；整个config.json相同（包含规则模式、VPN、error日志等级、关闭日志捕获）。数据库仅当前profile的overwrite_type和script_id变化，新建1份脚本且与应用模板字节一致。

## 配置与失败

最终脚本 `outputs/flclash-tailscale/override.js`：目标仅电脑/32；内嵌节点state-dir=tailscale-shiye、ephemeral=false、udp=true、dialer-proxy=DIRECT，无auth-key。只绑定当前活动配置，不自动改另外两份订阅。

早期error级别看不到登录提示；打开FlClash自己的日志后定位。代理组Final作为dialer-proxy触发UDP绑定错误，已撤回此候选；恢复DIRECT并重载后出现官方授权URL，用户授权成功。授权链接及订阅凭据未写入公开报告。

自动审批两次拒绝：第一次包含脚本选择、打开测试URL及系统logcat的组合命令；整条未执行，之后仅使用FlClash自身日志和其PID范围检查。第二次包含额外公网代理验证的组合命令，整条未执行、未绕过重试。两次仅返回blocked by policy，无详细原因。额外Google/Baidu检查不能写成成功或网络失败。

## 产物与验证

- `outputs/flclash-tailscale/native-first-report.json`：07:02:44Z首次6项。
- `outputs/flclash-tailscale/native-report.json`：07:05:08Z恢复error/关闭日志捕获后6项。
- `outputs/flclash-tailscale/config-comparison.json`：配置一致性及原profile SHA。
- `outputs/flclash-tailscale/health-via-phone-proxy.json`：代理入口health正文。
- `outputs/flclash-tailscale/sync-network-probe.apk`：本轮临时原生验收包，安装后已移除。
- 私有备份：`var/network-backups/flclash-before-shiye-20261018-1443.zip`（SHA256 `4c2c7f56874375b39307de8abac18f55e5e20c31bdd919e8c5df844afd8ba2b7`）与 `flclash-after-shiye-20261018-1505.zip`（SHA256 `f2926569fffd02932f03ed57c1b713d830002bab1ba06f2b119aae825c04185f`）。包含订阅信息，不进源码交付。
- 临时：`tmp/flclash-tailscale`，含私有诊断/编辑器快照、备份副本和测试签名材料，不进入源码包。
- 验收工具：`tools/test-sync-tailnet.mjs`；临时ProbeReceiver增加可选idPrefix/messageText兼容旧测试协议，build.ps1增加显式产物目录，避免覆盖之前LAN验收APK。Java编译、签名、真机运行已过。
- 收尾检查：新工具ESLint、Prettier及Node语法通过；F盘技术路径索引23主题errors=[]。最终只读回读内嵌节点仍在线、独立Tailscale无进程、FlClash仍为26399。

本轮只做网络配置和隔离验收，不升级正式应用、不跑全库/UI全矩阵。云服务器、移动网络切换、FlClash/手机重启、长期保活、正式客户端Repository适配尚未验；复刻步骤见 [运行手册](../FLCLASH-TAILSCALE-RUNBOOK.md)。
