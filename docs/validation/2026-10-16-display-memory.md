# ui4 启用与显示屏独立记忆 · 2026-10-16

用户本轮明确要求直接切换并核对新版，随后补充窗口、文字尺寸按显示屏记忆，同一屏幕再次使用恢复上次设置。

## ui4 已实际启用

通过 tools/desktop-control.mjs upgrade 正常保存退出旧聊天和托盘、封存候选、备份、复制和启动，操作 2026-10-16T14-19-10-830Z-8f0f0e53 完成。普通聊天 PID67632，托盘 PID45412；运行回执 ready:true、uiRevision:20261016-ui4，API 保持 0.9.20。证据 outputs/2026-10-16-ui4启用/status-after.json、upgrade-result.json。

新宿主与前端继承 ui2 高精度动画、离开默认350ms／可调100–3000ms、Esc 默认1200ms／可调400–5000ms，以及 ui3 附件按钮／图标尺寸。实际偏好回读确认收起350ms、文字比例1.24、窗口700×1098。旧全局文字比例保留。原日记、媒体、聊天 profile 继续使用原 F 盘目录。

此前 blocked by policy 记录保留为历史。本轮用户明确要求执行，标准维护调用成功，没有改用强杀、任意命令接口或替代路径。

## 新增分屏记忆修订 ui5

ui4 原实现只有一份全局窗口设置，不能满足新增要求。后续修订 20261016-ui5 独立构建，保留 ui4 已验证产物。

- DisplayMemory.cs 用显示器设备接口身份分开保存；身份不包含分辨率、DPI 或桌面原点。接口不可读取时退回 Windows 设备名；更换物理接口导致系统身份改变时可能按新连接建立记忆，保留旧记录。
- PreviewWindowSettings 增加可选 LastDisplayId、Displays 字典。每屏存相对工作区的 DIP 位置／尺寸、TextScale、Maximized；旧顶层字段保留，旧全局设置只迁入首次当前屏。
- 首次到新屏继承当前字号；已有屏恢复自己的窗口与字号。保存来自上次稳定窗口的快照，避免跨屏后误把新屏坐标覆盖旧屏。
- 原生拖动／缩放中暂缓切换，结束后恢复目标屏；同 DPI 的跨屏也会处理。吸附隐藏保存展开矩形，显示器断开保留其字典项，在可用屏安全显示。
- 分辨率、任务栏工作区和 DPI 改变后限制在当前工作区；UI 图标继续固定合理尺寸，文字独立缩放。

## 验证

outputs/2026-10-16-分屏记忆/ 保存构建与证据；测试仅使用 tmp/telegram-preview-20261015 的合成 profile。

- 原生与前端构建成功。self-test 20 组分辨率／DPI 几何通过，显示屏记忆序列化／原点改变／断开保留检查通过。
- native-ui-check-final.json：125 项聊天、9 项图片通过，无脚本异常；新增6项调用实际原生切换方法，以两个合成工作区分别设置1.2／1.8字号及不同尺寸，验证首次继承、A/B往返、序列化重开、断开保留和几何适配。
- 已查看200%文字／320px图片弹窗的实际截图，图标及发送／取消尺寸克制，说明仍可编辑。
- 运行回执增加 displayMemoryVersion、当前屏身份、字号及记录数，供切换后只读核对。

全库 npm run check 通过，348项测试成功。当前系统只报告一块2560×1440、96DPI活动屏；真实双屏跨DPI拖动、不同物理接口重插和硬件热插拔尚未实测，不能把合成双屏回归说成硬件验收。

## 最终实际启用及重启核对

标准 upgrade 成功，操作2026-10-16T14-29-30-745Z-36b4332a，备份在 outputs/desktop-maintenance/backups/ 同名目录。随后正常 restart，当前聊天PID56144、托盘PID69996。status-after-restart.json 确认原生运行回执 ready:true、uiRevision:20261016-ui5、displayMemoryVersion:1，实际前端和宿主均启用新修订。

- installed-file-verification.json：12215个安装文件 SHA-256 与已验收候选一致，差异0。
- restart-verification.json：重启前后位置(0,184)、尺寸700×1098、文字比例1.24均一致；同一显示屏、1个分屏记录、profileValuesPreserved:true，收起350ms，API0.9.20。
- 实际普通窗口已用 computer-use 查看：历史仍可见、消息及输入图标尺寸正常、文字独立放大；没有发送测试消息或改动正文。该观察不替代全部场景验收。
- 前端保留原聊天profile，正常保存退出再启动，日记API未重启。当前可直接使用，无需用户手动切换；另一屏首次设置后返回应恢复，其真实硬件过程仍待试用。

delivery-manifest-ui5.json 的 installed:false 是创建候选时快照；后续正式启用以 upgrade-result、status-after-restart 和本段为准，不改写原交付证据。
