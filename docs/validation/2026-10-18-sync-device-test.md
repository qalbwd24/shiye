# 2026-10-18 手机实际网络与独立同步库验收

用户授权手机已连ADB可调试，并要求记录后端、前端参数接入与维护边界。产物`outputs/sync-device-test`，临时`tmp/sync-device-test`，新独立数据库`var/sync-device-lab`。原18769测试库保留，日常API/窗口、手机正式拾页包及日记未由本会话修改。

## 最终结果

`outputs/sync-device-test/physical-phone-report.json`：passed=true，5项通过。

1. 真实手机应用UID通过局域网GET health、配对、下载电脑合成消息。
2. 手机应用上传一条中文shiye-richdoc消息，后台accepted。
3. 电脑读回同一消息，正文相同、revision=1、同ID只有一个对象。
4. 电脑修改一处会话分类字段，手机按游标仅收到1条增量，字段匹配。
5. FlClash在测试前后为同一PID26399（仅本轮快照），VPN服务保持运行；没有启动手机Tailscale、改代理订阅/规则或系统VPN设置。

手机FlClash已安装版本0.8.96。手机Wi-Fi为10.196.141.139/16，电脑10.196.131.17/16。本轮手机到电脑局域网health真实200；手机shell到100.77.215.104无响应，但没有将shell失败当成所有应用/所有Tailscale方案都不可能。

## 独立服务与手测入口

最终新实例2026-10-18T06:19Z左右启用，PID3600仅快照，绑定0.0.0.0:18779；以`var/sync-device-lab/runtime.json`和实时health为准。

- 电脑管理/配对页：[http://127.0.0.1:18779/](http://127.0.0.1:18779/)。
- 同局域网手机：[http://10.196.131.17:18779/](http://10.196.131.17:18779/)，手机无需Tailscale，可继续运行FlClash。
- 其它已组网设备可尝试100.77.215.104:18779；本轮没验证手机异地Tailscale/公网。

保留4个合成对象：电脑消息、手机消息、测试会话、测试分类。手动浏览器仍需各自配对：在电脑生成并记下配对码，再两端各配对；已有自动化测试设备不共享凭据。无真实日记导入或覆盖。IP随网络变化，不是固定公网地址。

## 测试方法及问题处理

ADB明确选择实体手机，另一个emulator-5554未操作。为避免把shell网络当作普通应用网络，构建独立`dev.shiye.syncprobe.p20261018`临时小包：只有INTERNET、无日记权限/资源、不访问正式包数据；自带无显示Activity和固定测试Receiver，通过HttpURLConnection在真实应用UID发请求。配对码经stdin写入其私有配置，令牌仅保存在其私有目录/内存；报告不含令牌、码或真实正文。

- 首次安装被手机系统以`INSTALL_FAILED_ABORTED: User rejected permissions`拒绝。用户“重新尝试”后标准安装Success，没有绕过权限确认。
- 新安装包stopped状态导致最初后台广播没运行；标准NoDisplay启动清除停止态后，使用明确action及`--receiver-foreground`广播完成。该标志是广播调度优先级，不是后台常驻服务或更改系统限制。
- 首阶段在手动诊断广播后已经成功；最终脚本`recoveredInitialProbe=true`保留其真实原始报告，读取服务器唯一手机对象，再补后续1条增量。没有为了“完整一次跑过”删除数据库重造证据。
- 最初18770同时存在另一个会话的127.0.0.1监听与本轮0.0.0.0监听，PC loopback命中了其它服务404。核对PID及命令行后仅停止本轮PID80612空实例，清理自身锁，改用已检查空闲的18779；未停止另一会话PID79828或日常API。没有把这次错误写成同步算法失败。
- shell netcat的初次HTTP400来自命令/终端换行转换；改由远端printf构造CRLF取得200。run-as直接运行系统nc被SELinux拒绝，也未冒称应用网络失败；最终用真正应用进程验收。

测试后`adb uninstall dev.shiye.syncprobe.p20261018`返回Success，核对包列表已无该临时包。临时私有凭据随包清除，APK与构建来源仍保留在输出/工具目录。手机正式拾页安装包没有被替换；没有操作其编辑界面、日志正文或现有数据库。

## 代码与相邻检查

- `tools/sync-device-probe/{ProbeReceiver.java,ProbeActivity.java,AndroidManifest.xml,build.ps1}`：独立测试构建，SDK36/本机JDK；生成APK在outputs，签名测试密钥仅在tmp。
- `tools/test-sync-device.mjs`：明确ADB设备和专用测试库，HTTP/原生桥双向合成验证，私密配置经stdin，不放命令行/日志。
- `public/sync-lab/assets/`补3个源码重导出入口，与既有HTTP别名一致，修复本会话测试页导致的项目模块检查缺失；无代码复制、无新构建依赖、不改变服务端路由。
- 最终`tools/check-files.mjs`为373模块、errors=[]；新增JS/入口定向ESLint/Prettier通过。没有重跑无关项目/桌面/Android完整矩阵。

## 网络方案与限制

DIRECT只是选择直连，不建立Tailscale隧道。真正地址段100.64.0.0/10，不应把整个100/8当作私网放行。Android两个独立VpnService不能同时活动；可选择局域网直接同步、以后HTTPS服务器，或核对代理内核能否内置Tailscale节点。

已核对Mihomo官方新文档有`type: tailscale`代理，可把100.64/10路由给该节点，在同一VPN核心内组网；它需要支持的核心、状态/登录与正确规则，不是DIRECT例外。用户手机0.8.96包所带核心/前端配置保留情况尚未验，本轮没有据此更新FlClash或要求auth-key。前端契约保存候选配置与来源，不冒称已配置成功。

来源：[Tailscale与其它VPN](https://tailscale.com/docs/reference/faq/other-vpns)、[Mihomo Tailscale节点](https://wiki.metacubex.one/en/config/proxies/tailscale/)、[路由规则](https://wiki.metacubex.one/config/rules/)。

后端接入规范见[SYNC-FRONTEND-CONTRACT](../SYNC-FRONTEND-CONTRACT.md)。实际产品的Repository/outbox/inbox、原件/分类/身份映射和编辑中基线保护仍需前端适配；这个临时包证明应用层通信，不等于正式Android客户端已同步全部数据。
