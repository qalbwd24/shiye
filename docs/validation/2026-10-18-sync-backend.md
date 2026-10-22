# 2026-10-18 独立增量同步后台验收

本轮按用户授权在本机建立独立后台，预留 Tailscale/服务器地址；三个 gpt-6.1-sol high 子代理分别完成存储、客户端、媒体及相应隔离测试。根会话完成 HTTP/认证、中文联调页、测量、独立启动与文档。所有样本合成，未读取真实日记作为测试正文，未控制日常桌面窗口、重启正式 API 或覆盖手机安装版。

## 实际交付

- `src/server/sync-v2/` 四模块；共用 `public/shared/sync-v2-{client,media,media-cache}.js`。
- `tools/sync-server.mjs`、`tools/verify-sync-lab.mjs`、`tools/measure-sync-backend.mjs`。
- `public/sync-lab/` 中文配对、消息/长文/会话/分类及媒体联调页。
- [实现、API与后续适配](../SYNC-BACKEND-IMPLEMENTATION.md)。正常 sync 不逐一比较所有日记文件。

冲突已按最新用户选择处理：同字段较晚服务器提交作主版本，被替换版本只在该实体冲突历史，不另增日记/消息，不进入朝花夕拾。不同字段三方合并，撤回墓碑优先。设备编辑时间仍保留，但不用于设备间定胜负。

## 验证结果

| 范围                         | 实际证据与结论                                                                                                                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 存储/队列/HTTP/认证/CLI/媒体 | 79项同步定向＋2项已有跨端内容契约，共81/81；`tmp/sync-backend/focused-tests.log`                                                                                                                  |
| 并发与恢复                   | 两个独立SQLite连接/worker提交24次，顺序不漏；事务故障回滚；丢ACK不可变请求重试；断线/重开持久队列；资产发布两种崩溃窗口恢复                                                                       |
| 内容保真                     | 完整合成Entry、业务revision、未知字段、richdoc、手打时间、媒体出现ID/插入时钟、Tab/换行、派生units/layout及超Number精度消息ID均保留；旧HTML/Markdown/附件字符串透明往返                           |
| 实际页面7项                  | 两个独立headless Edge context，UI配对、中文长文/消息自动到达、断网本地保存后关页/恢复联网重开、原PNG/GIF/VP8 WebM两端hash一致且图片/视频解码、分类和会话设置、主版本＋冲突历史、截图；pageerror=0 |
| 实际非安全HTTP补验2项        | 手机尺寸context导航本机Tailscale IP，实测isSecureContext/subtle/randomUUID均false，仍能中文richdoc、原图hash与预览、双向watch；pageerror=0                                                        |
| 定向静态检查                 | 本轮JS/MJS、测试、CLI和验证脚本ESLint与Prettier检查通过；没有批量格式化共享目录或运行不相关的全库/原生矩阵                                                                                        |

浏览器报告：`outputs/sync-backend/browser-report.json`（7项）及`browser-lan-report.json`（2项），截图`desktop.png`、`phone.png`、`phone-lan.png`。截图后仅补“online/none”中文标签与链接颜色，不影响传输路径，按定向静态检查复用7＋2项功能证据，不冒称矩阵重测。

测试中最初的MediaRecorder样片仅110字节、无视频帧，视频解码等待失败；确认原件hash传输无误后，使用本机FFmpeg生成32×32/1秒合成VP8 WebM，最终图片与视频真实解码通过。另补空文件测试，服务在上传阶段明确413拒绝，不生成损坏的0字节媒体占位。未以“hash一致”代替解码验收。

## 增量测量

报告`outputs/sync-backend/incremental-measurement.json`：1000条合成记录（每条约2KiB），首次分页快照2,175,586字节；无变化pull311字节。20次改一条记录，均仅返回1条变更，平均534字节；提交＋watch唤醒＋pull平均27.98ms、P95 31.94ms。

这是本机127.0.0.1 HTTP测量。浏览器验收服务已关闭后单独执行，本轮服务闲置，但没有证明整台电脑其它进程绝对空载；不代表手机无线、Tailscale远端、WAN延迟、UI输入响应或大视频吞吐指标。

## 独立运行回执

2026-10-18T05:56:25.177Z启动 `D:\拾页\tools\sync-server.mjs --host 0.0.0.0 --port 18769 --data-dir D:\拾页\var\sync-lab`。PID192仅本轮快照，Node24路径与命令行已回读；不复用日常API端口。runtime在`var/sync-lab/runtime.json`，stdout/stderr在`outputs/sync-backend/server.*.log`，均无配对码/令牌/正文。

- 本机：[http://127.0.0.1:18769/](http://127.0.0.1:18769/)。
- 本轮Tailscale地址：[http://100.77.215.104:18769/](http://100.77.215.104:18769/)。已读到本机Tailscale Running/Online，未安装/重配。
- 本轮局域网地址：[http://10.196.131.17:18769/](http://10.196.131.17:18769/)，可能随网络变化。

这三个地址均已从本机读到`service=shiye-sync,protocol=1,isolated=true`。这不等于用户手机物理网络/防火墙已验；最终仍需用户手机连接实际测试。未新增防火墙规则、开机启动、路由映射或云端服务。没有读取/复述私有Tailscale peer列表。

页面在电脑127地址生成10分钟/2次配对码，电脑和手机各配对一次。数据在独立 `var/sync-lab`，不是当前正式日记；不要把此测试当作原生客户端已接入。以后每次操作先重新核对runtime、PID归属和health。

## 保留边界与后续工作

1. 电脑日常Entry/TL IDB和Android SQLite/私有媒体尚未桥接新outbox/inbox；未导入、迁移或覆盖旧日记。真实内容的规范化、分类身份映射与单一写口需按实现文档下一步适配。
2. 网页已打开时支持离线保存；未实现网页静态壳，完全离线首次打开浏览器页面不支持。安装版后续使用自身本地页面/Repository，不依赖网络加载UI。
3. 当前是单人库服务。未实现云部署、公开管理配对通道、TLS终止、云备份、日志裁剪、群组多账户或服务器朝花夕拾运行器迁移。不要直接把联调服务作为公网成品发布。
4. 单操作1MiB、批次4MiB、非空媒体最多512MiB；大体积正文/视频后续扩容，不静默截断。冲突历史当前不自动过期，撤回原文按墓碑清理规则处理。
5. 正式客户端渲染、光标/IME、滚动、耗电、长期同步量、手机杀进程恢复与物理网络还需各自接入后验证。Node/fake-IDB和headless尺寸模拟不替代真机。

产物集中`outputs/sync-backend`；测试库、浏览器临时profile及日志在`tmp/sync-backend`（另客户端单元测试用`tmp/sync-v2-client`）；常驻测试库在`var/sync-lab`。源码hash见`outputs/sync-backend/source-manifest.json`。
