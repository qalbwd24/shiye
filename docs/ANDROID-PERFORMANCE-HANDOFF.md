# Android 性能优化交接

2026-10-19 Android019已依用户要求保留数据覆盖安装并ADB启动Magic7（0.19.0-ui-product/code21，d9a256d0…）。安装前现有QQ草稿flush成功、完整私有备份64,824,832 bytes；首次启动前30持久文件SHA逐个保持。手机实际QQ/偏好/019资产ready、首房6节点无错，header/list/footer均320px、气泡不越屏且旧Tele窗口隐藏，未发送测试消息或启用完整同步。模拟器及手机现均019，下方“手机仍018”为此前阶段。用户已说明实时预览为开发控制面板，效果看App，网页仅手动截图，尚无实时投屏。 [安装/证据](validation/2026-10-19-android-magic7-019-install.md)；产物outputs/2026-10-19-android-integration-019/phone-install，临时tmp/android-integration-019/phone-*，私有备份var/android-backups。


2026-10-19 Android019最终正常包已保留数据覆盖运行主AVD（0.19.0-ui-product/code21，APK d9a256d0…）；手机只读回读仍0.18/code20。修复真实Magic7聊天grid 320→455撑宽、发送夺焦点、旧SW/QQ启动门禁与native早绑定；列表全宽/设置固定真实父级、18px加粗标题/32px工具栏/全宽冻结线/上一篇/空篇丢弃已整合。按最新反馈取消逐条置顶加深，模拟器四主页面复用手机写作页原壁纸，原图不打入APK，保留原偏好备份。长文实际桌面prepare/canonical与同SQLite产品保存、原生消息源接缝已验；默认聊天仍legacy owner，完整保留迁移/seed/持续同步/朝花夕拾真实收件仍待接，不能称全端已互通。最终正常旧三房与列表几何、实际编辑比例/IME连发、14 SQLite/5native消息/19调度等定向按路径验收或复用；QA与正常11,768 assets/DEX一致，不跑无关全量。AVD软件兼容swangle临时60Hz，不承诺真机120FPS。产物outputs/2026-10-19-android-integration-019，临时tmp/android-integration-019，私有备份var/android-backups。 [最新验收](validation/2026-10-19-android-integration-019.md)。后续先核对包hash/实际可见WebView，记录本地提交→布局→绘制与IME变化；本轮遇系统提交压力导致JVM原生malloc失败，不能归因为App泄漏或把重启后下降当优化收益。下方0.5/0.11长帧数据不是019的新结果。


2026-10-18 Android0.13/code15已保留数据覆盖运行主AVD（APKc52752b4…），手机仍0.11继续用户手测。统一全局浅/深前景与透明色调、分别管理思绪列表/写作/随想scope壁纸；按用户新纠正去掉思绪大圆角卡片，改连续摘要/小字/细分割线，置顶仅轻微平面色调。应用内字号解除系统重复放大与WebView8px夹限，实际13/8推荐和6/5下限、27.5px短气泡/44px输入/36px按钮、PNG/GIF直接本地ACK已验；写作去成功保存闪字、稳定字数/IME、分类单页拖动/默认/返回验收。修复覆盖升级的SW旧模块缓存，版本化精确导入且保留IDB。0.12服务接缝保留，新同步协议另按SYNC-FRONTEND-CONTRACT接Repository，未称云同步已完成。373模块/ESLint和38共享核通过，全库check停在共享/历史格式告警；不承诺120FPS或系统picker已重验。产物outputs/2026-10-18-android-compact-013，临时tmp/android-compact-013，备份var/android-backups。 [验收](validation/2026-10-18-android-compact-013.md)。

2026-10-18 Android0.11/code13已保留数据覆盖运行主AVD（APK1914ba64…）：紧凑可调气泡/小时间戳、全局与会话外观、独立列表壁纸、冷蓝深色/系统栏、回车发送/真实引用撤回、QQ式刷新反馈与失败后切思绪恢复、思绪Aa/分割线/小图、分类长按拖动与返回层级已落地。AVD按Magic7实测设1264×2800/632dpi/font1.3/320dp，虚拟120Hz不代表物理120FPS。真实聊天8/导航9/分类8/最终编辑8及软件键盘几何通过；主矩阵与最终包的未改JS/DEx字节复用边界见验收。手机仍0.10手测、本轮未覆盖；完整本地Repository/outbox/云同步未完成，手机完整本地存储为后续明确约束。 实际CSS预览继续在19384运行；旧0.5帧数据不是0.11复测，120Hz仅环境配置。[本轮验收](validation/2026-10-18-android-refinement-011.md)。


2026-10-17 用户要求将底层性能优化交给后续会话；当前会话先改善 UI。先读 WORKSPACE、DEVELOPMENT-HANDOFF、ANDROID-CHAT-08-REQUIREMENTS 和 TESTING-POLICY，操作前重新核实安装包与运行进程。手机由用户继续手测，不因本交接自动控制或覆盖手机。

## 已知证据

0.5 最终候选 c60bac46 在主 AVD 的实际显示周期为 16,666,666ns，60Hz，GLES 为 Android Emulator OpenGL ES Translator / Intel Arc B370。发送＋IME 的官方 jank 44/58（75.86%），切房 40/62（64.52%）；完成延迟 p95 135.36/133.79ms。系统 Settings 同环境 1/121（0.83%），故不能一概归咎模拟器。上述小样本不是 0.8 的新测结果，也不是手机 120Hz 帧率。

历史采样阶段显示 SyncQueued→SyncStart p50 约25.47ms、IssueDrawCommandsStart→SwapBuffers 约29.06ms，layout约0.04ms、draw约0.30ms。只能提示渲染队列／绘制方向，未定位根因。去背景滤镜没有改善，已还原。原始报告在 outputs/2026-10-17-android-refinement，说明在 validation/2026-10-17-android-refinement-qa.md。

0.6 引入实时 CSS 预览；0.7 修改思绪而非聊天渲染管线；0.8 是本轮聊天 UI 候选。不得把样式改善写成旧长帧已经解决。

## 下一次最小诊断

1. 核实 APK SHA、versionName/code、Android/WebView/GLES/显示刷新率和当前页面；先保存并等待 flush ACK。只在 AVD 或专用合成 profile 复现，不用真实日记生成测试样本。
2. 暂停实时预览注入与控制台截图轮询，保持样式为 APK 自身版本；采样期间不并行跑浏览器矩阵、构建或截图。预览进程和业务进程的开销分别看。
3. 只复现四个用户可见场景：空闲会话列表→开房；软键盘输入后连续发送；纯表情→时间戳排布；键盘↔底部表情面板切换。固定同样的合成消息规模、图片和操作间隔。
4. 使用 `adb -s emulator-5554 shell dumpsys gfxinfo dev.shiye.app framestats` 与 Android System Trace/Perfetto，关联 App 主线程、WebView renderer、RenderThread、GPU queue；保留原始记录。对比系统应用只作环境参照。
5. 若定位到 DOM/JS，再定向检查 MutationObserver 调度、rAF 读写混杂、虚拟列表测量和消息确认替换节点。若定位到合成／GPU，再做单变量临时样式对照；不要一次删掉背景、动画、圆角等用户需求。

## 不可回归的行为

- 发送后旧消息不反向移动；Emoji、时间戳不相互覆盖，末条消息不被输入区挡住。
- 输入法候选、光标、引用和待发附件保持；切房不串草稿、不重复保存；异步确认以原权威事务 ACK 为准。
- 字号／留白改变后的虚拟行与滚动锚点正确；表情面板收起不遗留空白高度。
- 保留原壁纸与显式偏好，不通过清库、删媒体或重建真实 profile 规避问题。
- UI 参数可以针对手机适配；消息拆分、归篇、事件时间及格式转换跟随电脑公共模块，别为了性能另写一套业务算法。

验收写实际 jank、有效样本数、呈现时序和已知限制；rAF 8.3ms 不等于物理120FPS。Magic7 120Hz、长时间内存与功耗须在用户授权后的真机阶段另验。

新性能产物应放 outputs/<本轮日期>-android-performance，临时放对应 tmp，备份放 var/android-backups。现有 UI 0.8 产物位于 outputs/2026-10-17-android-chat-ui-08，临时 tmp/android-chat-ui-08；不要混入性能通过结论。


## 2026-10-18 后续运行状态

0.9已完成真实AVD15项思绪/IME/缓存检查；0.10已ADB启动成功，真实WebView算法与桌面同fixture逐对象相等、原生保存/DBv3回读通过。用户本次明确要求以后可用ADB打开，因此常规安装后可直接尝试标准am start；若新工具审核再次拒绝，停止并报告，不绕过。实时预览forward清理已仅处理本工具仍持有的精确serial/port/socket匹配，8项工具测试通过，防止过期listener中断重连。19384为本次地址，后续重新查询。系统文件选择器曾导致AVD shell卡住/离线，保留数据重启恢复，未定位根因；原件导入/视频链路与物理120Hz仍未验。
