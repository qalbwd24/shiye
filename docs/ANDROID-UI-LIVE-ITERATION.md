# Android 实时预览与逐页样式迭代

2026-10-18 Android0.13/code15已保留数据覆盖运行主AVD（APKc52752b4…），手机仍0.11继续用户手测。统一全局浅/深前景与透明色调、分别管理思绪列表/写作/随想scope壁纸；按用户新纠正去掉思绪大圆角卡片，改连续摘要/小字/细分割线，置顶仅轻微平面色调。应用内字号解除系统重复放大与WebView8px夹限，实际13/8推荐和6/5下限、27.5px短气泡/44px输入/36px按钮、PNG/GIF直接本地ACK已验；写作去成功保存闪字、稳定字数/IME、分类单页拖动/默认/返回验收。修复覆盖升级的SW旧模块缓存，版本化精确导入且保留IDB。0.12服务接缝保留，新同步协议另按SYNC-FRONTEND-CONTRACT接Repository，未称云同步已完成。373模块/ESLint和38共享核通过，全库check停在共享/历史格式告警；不承诺120FPS或系统picker已重验。产物outputs/2026-10-18-android-compact-013，临时tmp/android-compact-013，备份var/android-backups。 [验收](validation/2026-10-18-android-compact-013.md)。

2026-10-18 Android0.11/code13已保留数据覆盖运行主AVD（APK1914ba64…）：紧凑可调气泡/小时间戳、全局与会话外观、独立列表壁纸、冷蓝深色/系统栏、回车发送/真实引用撤回、QQ式刷新反馈与失败后切思绪恢复、思绪Aa/分割线/小图、分类长按拖动与返回层级已落地。AVD按Magic7实测设1264×2800/632dpi/font1.3/320dp，虚拟120Hz不代表物理120FPS。真实聊天8/导航9/分类8/最终编辑8及软件键盘几何通过；主矩阵与最终包的未改JS/DEx字节复用边界见验收。手机仍0.10手测、本轮未覆盖；完整本地Repository/outbox/云同步未完成，手机完整本地存储为后续明确约束。 实际CSS预览继续在19384运行；旧0.5帧数据不是0.11复测，120Hz仅环境配置。[本轮验收](validation/2026-10-18-android-refinement-011.md)。


2026-10-17 用户授权：先建实时预览，再依次优化会话列表、随想聊天、思绪写作。子代理使用 GPT-6.1-sol 中等推理。旧日记的实际个人设置优先作为缺省习惯，不能把 APK 回退值冒充个人设置。保留现有数据、浅天蓝/黑字与三入口。

## 当前进度

- CSS 预览已在 `emulator-5554` 的实际调试 WebView 验证：临时改色、恢复均生效，页面 timeOrigin 不变，注入样式只有一份。未重载页面、未写业务数据。证据 `outputs/2026-10-17-android-ui-preview/live-preview-proof.json`。
- 控制台 `http://127.0.0.1:19384/`（本次运行端口）；启动和退出方式见 [ANDROID-LIVE-PREVIEW](ANDROID-LIVE-PREVIEW.md)。CSS 文件保存自动更新；临时参数不自动改源码。原生页面、HTML/JS与系统栏仍需相应构建，不称全部代码热更新。
- 工具启动模拟器 App 被自动审批以 `blocked by policy` 拒绝，该命令未执行。用户手动打开后连接成功，未换方式绕过启动拒绝。
- 0.6.0-ui-preview/code8 已保留数据覆盖安装并在主 AVD 实际运行；APK `Shiye-Android-0.6.0-82926231.apk`，SHA/备份见本轮 `release-receipt.json`。已回默认会话列表，最终 flush ACK，实时预览继续运行。用户后续授权手机体验，Magic7已0.5→0.6覆盖成功并核实版本，完整备份保留；未清数据/复制AVD内容/重复全库审计，见[手机安装](validation/2026-10-17-android-magic7-install.md)。
- 会话列表/聊天/思绪首轮均完成：固定72px虚拟行高、50px头像及独立菜单槽，置顶/选中/按下分开；输入行高与测量统一；思绪单层18px留白、日期分类同一行、空附件44px。原生系统栏在切房与回前台恢复，保持原转场，未声称性能问题已解决。
- AVD 已实际验证安装包自身样式（暂停 CSS 覆盖）、中文多行发送/本地确认/回列表、新建分类、时间戳/保存、读写切换、从原生列表重开同一篇。预览数字参数50→54→50、编辑字号临时26px→原偏好均不重载/不写偏好。详情见[集成验收](validation/2026-10-17-android-ui-preview.md)。
- 旧日记可见设置已汇总为 `old-diary-habit-profile.json`：行距选项1.5、退出保存/首行缩进开启、弹键盘关闭、新建分类开启、标题居中/编辑按钮居右。新建分类已按此作为可关闭默认，其他等价行为保持。字号/字体/颜色仍未知；SP/系统缩放/原生行距不直接当CSS数值，不覆盖新 App 明确偏好。

## 参考与功能边界

Telegram 13.0.3 负责消息页面交互与附件/输入结构，QQ 9.3.70 负责会话列表和系统栏状态管理，一本日记私有版负责整篇长文体验。APK 研究的证据与局限在 [ANDROID-REFERENCE-REVIEW](ANDROID-REFERENCE-REVIEW.md)。引用样式不增加社交/语音/机器人功能，不改变正文协议。

## 手机电脑互通（用户再次确认）

功能与数据适配必须跟随电脑项目最新文档和实际实现；每阶段开工、接接口和交付前重新核对，不能固定在某次旧摘要。当前依据：

- [SYNC-V2-DESIGN](SYNC-V2-DESIGN.md)：本地读写、异步持久队列、服务器同步与存储；队列/云端仍属下一阶段，不将本轮 CSS 预览写成同步交付。
- [ANDROID-FRONTEND-DATA-ALIGNMENT](ANDROID-FRONTEND-DATA-ALIGNMENT.md)、[MESSAGE-UNITS-IMPLEMENTATION](MESSAGE-UNITS-IMPLEMENTATION.md)、[DATA-MODEL](DATA-MODEL.md)：Entry 整篇 richdoc、规范消息身份、媒体每次出现及插入时间、版本冲突、未知能力只读保护。
- [CONVERSATION-BACKEND-CONTRACT](CONVERSATION-BACKEND-CONTRACT.md)、[CONVERSATION-SERVICES-API](CONVERSATION-SERVICES-API.md)：本轮期间电脑多实例后端及历史起止范围已部署，以能力响应判断；桌面选择UI/worker/桥和安卓仍待接入，不能将本机已部署后端当成跨设备同步完成。电脑会话管理已到ui26，安卓尚未移植归档/多后端选择，不在本轮暗加不完整功能。
- [ANDROID-CROSS-DEVICE-ADAPTATION](ANDROID-CROSS-DEVICE-ADAPTATION.md)：本轮核对的真实差距及后续接入清单。

不得将 Telegram TL/整数 ID 当正式跨端正文，不将本地 categoryId 直接发给名称分类接口，不截断完整日期或用 updatedAt 代替事件时间/同步游标。UI 外观和窗口状态与正文分开；同步状态将来必须区分本地落盘和服务器确认。云认证/联网、持久 outbox 和本地旧数据迁移不在本轮实施。

## 验证和维护

按 [TESTING-POLICY](TESTING-POLICY.md) 只验受影响页面、窄宽/字号、菜单/切房与编辑保留，不重复全库数据审核。CSS 样式通过不代表 AVD 性能或手机 120Hz 已达标。性能采样要暂停预览轮询，区分帧间隔与渲染管线延迟。

列表/聊天实现与证据见 [ANDROID-UI-PREVIEW-CHAT](ANDROID-UI-PREVIEW-CHAT.md)，思绪见 [ANDROID-UI-PREVIEW-DIARY](ANDROID-UI-PREVIEW-DIARY.md)。本轮样式产物 `outputs/2026-10-17-android-ui-preview/`，临时 `tmp/android-ui-preview/`；用户后续授权的手机安装回执/临时分别为 `outputs/2026-10-17-android-magic7-060/`、`tmp/android-magic7-060/`。手机0.6交用户手测；电脑运行版未由 Android 样式或安装任务重启。


## 2026-10-18 后续运行状态

0.9已完成真实AVD15项思绪/IME/缓存检查；0.10已ADB启动成功，真实WebView算法与桌面同fixture逐对象相等、原生保存/DBv3回读通过。用户本次明确要求以后可用ADB打开，因此常规安装后可直接尝试标准am start；若新工具审核再次拒绝，停止并报告，不绕过。实时预览forward清理已仅处理本工具仍持有的精确serial/port/socket匹配，8项工具测试通过，防止过期listener中断重连。19384为本次地址，后续重新查询。系统文件选择器曾导致AVD shell卡住/离线，保留数据重启恢复，未定位根因；原件导入/视频链路与物理120Hz仍未验。
