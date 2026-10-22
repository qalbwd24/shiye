# Android 手机0.11部署与0.12服务候选验收

2026-10-18。用户明确先部署已验UI版本到手机手测，同时在电脑继续适配正在优化的后端。手机与AVD版本分开维护，不把本轮候选自动推到手机。

## 手机已部署

Magic7 `<测试手机序列号>` 从0.10/code12保留数据覆盖升级 **0.11.0-compact-ui/code13**。APK SHA-256 `1914ba64bc4a53d80f26ee275caf9118f6acbf7a9f71dba06275e63209259544`。

安装前App无进程，完整稳定私有备份保留；没有中断正在输入的页面、伪造flush、卸载、清数据或导入模拟器资料。第一次系统返回INSTALL_FAILED_ABORTED，用户回复“重试”后安装Success，版本回读一致、启动Status:ok，实际聊天页ready只读通过。旧检查脚本误附加service worker报window不存在，后续检查明确实际聊天页面ready；没有将此脚本错误混称为聊天页启动失败。

手机安装/备份回执：`outputs/2026-10-18-android-magic7-0110/`；临时`tmp/android-magic7-0110/`；备份实际路径/hash在install-receipt。手机交用户UI手测，部署后未再控制手机或试写个人内容。真机IME/120Hz/具体长文体验由用户测试，不扩大ready证据。

## 电脑与AVD候选

新增原生固定服务客户端及“服务连接”设置页，版本 **0.12.0-service-preview/code14**，仅AVD运行。最终APK `outputs/2026-10-18-android-service-adaptation/Shiye-Android-0.12.0-59cf45a5.apk`，91,675,069 bytes，SHA-256 `59cf45a52604e1e5f81b4064dbecc17a478fa34116e020548d449e7dda569104`。

支持地址本地保存/离线、严格health/catalog能力发现、地址隔离的成功目录快照、现有朝花夕拾实例status读取、明确返回和未保存地址提示。独立网络队列不占日记保存队列；清空地址不删内容或旧快照；失败不把目录清空。固定HTTP接缝保留scope和未知JSON字段，拒绝跨实例错配、重定向、不安全HTTP和无效结构。设置页没有自动上传/创建/绑定/改规则或推进tick。

Android新增INTERNET权限，网络安全配置仅放行loopback明文，其余必须HTTPS；现有WebView资产/导航/网络拦截保留，没有任意网页HTTP转发。当前电脑仍保留loopback/Host/Origin/访问锁；没有开放正式监听端口/防火墙，或改正式服务器配置。

安装AVD前取得真实聊天flush ACK、保留完整私有备份，install-r/启动正常，schema仍3。初候选448560dd已被最终59cf45a5替代；最终仅细化服务页文案、地址长度与快照提示，客户端源码hash保持。

## 验证

- Gradle最终构建成功；传输层SDK36 Java8编译通过。
- 原生生产Java源码在JVM真实随机端口HTTP上99项断言通过；仅Android偏好/Looper用薄stub。覆盖能力结构/未知字段、URL、POST白名单、scope、401/409等错误、大小限制、重定向、按地址缓存及A→B→A代际竞态。
- Node现有会话服务10项回归全部通过；独立ESLint通过。
- 最终AVD实际原生设置/HTTP九项通过：默认离线、空地址不连接、保存地址不连接、loopback网络策略实际生效、从真实服务发现朝花夕拾和合成实例、指定实例状态、真实父页返回、重开先显示已落盘快照、读取前后隔离后端diary.json字节hash不变。
- 追加实际AVD失败/返回四项：移除仅AVD测试转发模拟网络失败，目录保留；非loopback HTTP被拒绝；未保存地址继续调整；放弃后恢复已保存地址和快照。回执`avd-service-failure-verification.json`。
- 首次最终UI脚本附加了安装前旧CDP forward，重连后正常；之后一次误并行运行两个uiautomator检查导致dump进程137退出，已恢复到已知起点并严格顺序重跑，没有为测试失败清库/改产品保存逻辑。早期候选证据保留，不当作最终包唯一证据。
- `npm run check`在364模块文件检查停住：并行`public/sync-lab/app.js`引用的三个assets文件尚未生成（sync-v2-client、sync-v2-media-cache、rich-document）。未代改该会话资产或宣称完整check通过；本轮未重复跑全项目758项。日志`tmp/android-service-adaptation/project-check.log`。

AVD实际通过`adb reverse tcp:19891 tcp:19891`访问显式隔离数据目录、`revisitAutoStart:false`的真实Node服务。仅创建自己的合成实例用于fixture；UI只读status，后台库字节hash保持。正式电脑/手机库没有测试写入，测试端口没有转发到手机。截图已查看，字体/显示环境沿Magic7匹配的320dp/font1.3。

## 边界与下一步

最新内容契约/服务协议已核对；0.9.25工作树正在并行变化，版本号不作为能力开关。`sync-v2`候选内核/客户端与当前正式路由装配区分，不能据文件存在宣布云服务上线。

下一阶段按[服务器适配](../ANDROID-SERVER-CONNECTION-012.md)接规范会话身份、create/bind、持久inbox/outbox与自动收件渲染。原生固定实例动作接缝不等于这些业务链路已完成。完整本地资料存储/迁移、远端认证、TLS真实证书链、公网连接、朝花夕拾在手机的接收/评论/撤回与两端互通尚未验收；手机0.11没有本候选新网络能力。

产物`outputs/2026-10-18-android-service-adaptation/`，临时测试/合成后端`tmp/android-service-adaptation/`，私有备份`var/android-backups/`。最终状态与源hash由release-receipt记录；实时CSS预览仍为19384，原生/Java变更仍需构建。
