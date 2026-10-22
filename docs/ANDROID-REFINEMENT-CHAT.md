# Android 0.5 随想适配交接

2026-10-18T00:47Z 首轮资产已冻结，可供主会话构建。源码/浏览器验证完成；本代理未使用 ADB、手机、桌面运行程序，Android 原生和 AVD 由主会话验证。不是正式手机启用声明。

## 实现与来源

- 真实复用冻结 ui18（outputs/desktop-maintenance/releases/2026-10-17T18-38-43-932Z-3b4b2c77/app），不重建共享 vendor、Java、editor 或桌面候选。
- 复用同包 shiye-local-assets.js 和 shiye-input.js，恢复笑脸的 shiye-open-symbols 监听、Unicode 插入、PNG/GIF 本地导入与别名映射；本轮浏览器实际测 PNG，GIF 动画持续播放未测。
- 输入/映射设置只在冻结 input SHA-256 af3ef1b2623790024f287217ce64ed8ca060d6aa5df5696f980151fb76d216e4 上做最小 settings facade 接缝。移除原先固定回桌面设置的按钮，保留真实父页与未提交页面状态；LF/CRLF 均匹配。保留页在关闭状态必须 display:none，避免基线通用 dialog 样式让父页仍显示。
- 消息字号与输入字号独立；固定 CSS px 气泡留白、独立圆角/间距；保存、取消和返回分开。appearance 和 pin 共用原生 load/commit 串行权威，保留未知字段。
- 置顶底色加深为 #c8e2f5；隐藏重复新建 FAB，标题栏新建仍可用；不适用网络/通话等入口收口。全局设置调用 shiyeAndroidSettings.open。
- 普通文件仍走原选择/预览/消息文档持久化。文件名点击直接向原 downloadMedia 请求下载，避免图标回调把正在自动预载的文件当取消操作；完成后原 blob 下载接入 shiyeAndroidFiles.export({blob,name,mimeType,action:'save'})。系统另存和取消最终由主会话验原生。
- MessageList 横向裁切根因：上游 Message/ActionMessage ::before 选择底色 inset-inline:-50vw，412px 宽下伪元素808px、scrollWidth610px；文件焦点后 scrollLeft198px 导致整列左裁。适配改为 -8px，覆盖列表8px留白至屏幕边缘，消除实际溢出来源；没有反复重置 scrollLeft 掩盖。仅去触屏 more 的非键盘焦点环。
- flush 在跨两帧等待前读取已验证 editor 的语义正文，避免发送重新挂载后使用已销毁 editor 引用；仍等待草稿 ACK 与 worker 写队列。

## 本轮验证

24 项真实 Chrome 移动触屏隔离测试通过，0 page/Teact errors。覆盖真实笑脸、保留草稿插 emoji、PNG 导入预览发送原字节、普通文件选择发送原字节和 native mock 另存桥、消息/输入独立字号、固定padding、真实父级及未提交设置恢复、原生权威未知字段/置顶串行保留、360/412 实绘无横向裁切、父页关闭隐藏、手动刷新不reload、新 WebView 恢复设置/文件/贴纸库。

360/412 的实际截图均已查看，文件图标/文字开头/时间完整。断言同时核对 scrollLeft=0、scrollWidth<=clientWidth+1、每个气泡在视口内。旧失败截图/报告保留；新图统一 -fixed 后缀。

局部 node --check 与 Prettier 检查通过。未重复无关全项目或所有旧浏览器矩阵。构建 manifest 全部文件逐项 SHA-256 另验，见 asset-integrity-fixed.json。

未验边界：本代理没有 Android 系统文件选择/另存与权限、实际输入法/键盘生命周期、AVD/手机、物理120Hz、长期CPU/内存证据。不能将 rAF 频率写成物理120FPS。撤回沿用冻结 worker 的 withdrawLocalMessages，不是直接删除；ui21 短期重新编辑接缝未集成验收，不宣称已达到最新桌面全部撤回行为。

## 产物与复现

- 可构建资产：tmp/android-refinement/telegram-build/assets/telegram
- 资产清单/来源及完整对应源：outputs/2026-10-17-android-refinement/telegram/build-manifest.json 与 corresponding-source/
- 完整性：outputs/2026-10-17-android-refinement/telegram/asset-integrity-fixed.json
- 最终浏览器报告：outputs/2026-10-17-android-refinement/chat/refinement-check-fixed.json
- 实绘：chat-display-360-fixed.png、chat-display-412-fixed.png、mapping-settings-fixed.png、input-settings-fixed.png、pinned-list-fixed.png、stickers-fixed.png（均在上述 chat 目录）
- 合成脚本/中间诊断：tmp/android-refinement/chat/；复现命令 node tmp/android-refinement/chat/verify-fixed.mjs（工作目录 D:\拾页）。
- 资产增量生成：node android/telegram-adapter/build.mjs --adapter-only --work-dir tmp/android-refinement/telegram-build --output-dir outputs/2026-10-17-android-refinement/telegram

正式构建、数据保护回读和 AVD 回执由主会话同步到本轮 validation/总交接，本文件只记录聊天适配层证据。

## AVD 首包真实失败与二次修复（00:52Z）

主会话首包安装后，QA 在 AVD 通过系统 DocumentsUI 精确选择 QA PNG，收藏出现，但物理点发送未出现预览，页面报 Shoot! Something went wrong [object Event] undefined。首包安装不代表聊天验收通过。QA 未清库，失败回执 outputs/2026-10-17-android-refinement/qa/sticker-readonly-1792284666282.json。

只读实证：收藏 File.size=0、type=image/png，实际 arrayBuffer=5812 字节且 PNG 前8字节正确，createObjectURL 能 decode 480×320；原始合成文件 SHA-256 为 81da2228c58702846c04289d8fed2e5e32724ffe97090a2b27a5cf306ada3f3b。冻结发送的 new File([asset.blob]) 遇此元数据异常会丢失有效内容，桌面普通 File 不能复现这项平台故障。

二次修复仅在 Android 适配层：

- file input change 捕获仅规范 size=0 的异常项：读取 arrayBuffer，若真实有字节以这些字节生成自有 File，完整保留 name/type/lastModified；合法空文件保持原样。离线创建的 file input 在 click 时临时入 DOM，以保证同一捕获链；change/cancel 后移除。
- 新收藏写入前将真实字节实体化为 Blob；已有收藏 get/list 发现 size=0 时只在返回值中用真实字节重建 Blob，保留原记录、ID/name、未知字段和原文件，不批量迁移/改写历史。
- 保留原附件预览与发送接口，不修改共享 editor/vendor/worker/Java，不清库。

最新构建 manifest atUtc=2026-10-18T00:52:14.046Z；同一 telegram-build 目录供主会话重建。27 项浏览器定向通过、0 page/Teact errors，覆盖上述24项并额外模拟 QA PNG 与普通文件的 size=0、旧收藏读回异常及 Blob→File 重建字节保真、合法空文件元数据保持。报告 chat/zero-size-file-regression.json；脚本 tmp/android-refinement/chat/verify-zero-size.mjs。该模拟验证适配分支，不冒称 Android 平台已复验通过；AVD 系统导入、旧收藏再次发送与普通文件由主会话/QA 继续核验。

## 输入胶囊表面修复（00:58Z，候选3）

QA 首包 sticker-png-sent.png 显示输入区白色直角块与外部浅蓝胶囊割裂。来源是适配层单独把 composer-wrapper/input-scroller 涂白，而冻结胶囊本体仍用 --color-background；编辑核 form-control 已透明，不需再覆其背景。

本次仅追加 CSS：#MiddleColumn .Composer.is-chat-composer 使用现有 --shiye-input-surface，内部 .composer-wrapper 与 .input-scroller 透明。加 #MiddleColumn 以避免冻结懒加载 CSS 的同级选择器后到覆盖。未改布局、圆角、编辑核、字号或 ComposerEmbeddedMessage 引用块原背景。

只运行这处360/412移动实绘核查：两宽均统一白色胶囊、多行正文可编辑且内层透明，3断言通过/0错误，两张实际截图已查看。未重跑27项，前述未影响JS证据复用。报告 chat/composer-surface-check.json；截图 composer-surface-360-fixed.png 与 composer-surface-412-fixed.png；临时脚本 tmp/android-refinement/chat/verify-composer-surface.mjs。

最新冻资产 manifest atUtc=2026-10-18T00:58:51.287Z，CSS与manifest SHA一致（telegram/composer-surface-integrity.json）；主会话候选3重建后仅需补受影响输入区原生截图，不把浏览器实绘视作AVD已通过。

## GIF 持久化重开显示与 PNG 延迟澄清（01:05Z）

QA 最终候选3在首次800ms截图里 PNG 为空白大占位、GIF 为普通文件卡。随后只读等待、未点图/未重发，PNG 自行出现 full-media IMG 且480×320正确，属于已有加载延迟，未改PNG元数据或成熟渲染；不能把最早截图判作持久化丢失。GIF persisted document103 为 image/gif、1471原字节正确、只有 filename 属性；成熟动画路径依赖服务器转换的视频语义，原始本地GIF重开缺少该语义，不能仅增加Animated字段冒充视频。

仅在安卓适配层加严格只读 GIF 预览：global document mime=image/gif、持久化document mime一致且字节签名为GIF87a/GIF89a才处理，保留原 File 文件名/下载/菜单与历史消息ID、时钟和全部原字节，不写旧消息/库。直接从持久化 bytes 生成 owned Blob URL；原生新发送若已有 media-inner，保留原渲染且不重复加图。DOM选择器为 .Message .shiye-local-gif（旧/重开fallback），新发送原生可能仍为 .Message .full-media。

只在新加入的DOM子树增量收集File，按当前room:message ID缓存URL，不做每帧/每次Mutation全库扫描。换房/pagehide回收URL并删除自加img/class；房间generation保护迟到读回。持久化document/bytes暂缺时按100/300/700ms最多重试3次，不缓存为永久失败；确有记录且mime/签名错误才缓存跳过。

本次11项定向浏览器通过、0页面错误：QA GIF原字节保真；ImageDecoder确认2帧各350ms且像素hash不同；新发送实际图片区域多次实绘hash不同并且只有1张图；重开从持久化恢复后仍多帧；保留文件卡；模拟首读document缺失后有限重试成功；离房URL撤销且自加DOM清理；返回同房重建新URL。两张最终发送/重开图已实际查看。未重跑27项，不改共享worker/vendor/editor/Java、不ADB。实际AVD GIF多帧及重开由主会话/QA接续。

资产已冻结 manifest atUtc=2026-10-18T01:05:42.706Z。报告 chat/gif-persistence-check.json，截图 gif-animation-sent-fixed.png / gif-animation-reopened-fixed.png，临时脚本 tmp/android-refinement/chat/verify-gif-persistence.mjs；JS/CSS与manifest hash核对见 telegram/gif-render-integrity.json。

## 最终性能只读诊断（01:08Z后，功能版交付边界）

最终0.5是可试用功能版，性能不达标单列；不宣称全部优化完成。APK保持主会话最终 c60bac46…，本段仅追加文档，未改源码/冻资产、未操作ADB。

- 60Hz AVD发送+IME：官方jank44/58，FrameCompleted-IntendedVsync p50/p95/max=84.73/135.36/151.41ms，SurfaceFlinger present间隔p50约32.42ms；切房jank40/62、完成延迟p50约83.81ms。统计范围见 qa/performance-summary-1792285733935.json 及 send-and-ime/conversation-switch-framestats.txt；present包含空闲间隔，不能一律当掉帧计数。
- 读取原始framestats分段：发送p50 Vsync延迟16.67ms；HandleInputStart→SyncQueued约1.61ms（p95约7.48ms）；SyncQueued→SyncStart约25.47ms（p95约42.11ms）；IssueDrawCommandsStart→SwapBuffers约29.06ms（p95约52.30ms）；SwapBuffers→FrameCompleted约8.06ms。切房对应UI阶段约1.96ms、Sync等待22.94ms、绘制命令→Swap约25.44ms。慢段集中于渲染线程等待/绘制提交；这些分段证据不能直接归因为JS，也不能证明只因模拟器。
- 测试脚本静态核查：performance.mjs 的稳定截图在 send-and-ime endFrames 完成之后，采样中没有截图或uiautomator dump。采样中有CDP取目标getBoundingClientRect、触屏事件/文本注入与少量DOM查询，send-and-ime另含一次ADB返回键；因此不是纯手动输入无干扰测量，但没有截图同步抓帧造成全部慢帧的证据。帧原始报告在动作结束后读取，未在每帧轮询dumpsys。
- 适配层静态核查：主MutationObserver覆盖body子节点和class变化，合并后syncShell会查询列表行与日期节点，存在随DOM更新执行的扫描成本；但syncShell内没有getBoundingClientRect/offset/clientWidth强制布局读，布局读取visible仅在clickFirst动作辅助中。样式/标题大多比对后写入，GIF observer只看新增子树，不监听class，有限重试非永久轮询。仅凭源码不能确证持续observer自循环或该扫描就是当前RenderThread瓶颈，不把可能性写作已定位原因。
- 同AVD系统Settings滚动基线：jank1/121=0.83%，present p50/p95=16.57/18.79ms，平台可以达到明显更好结果，因此不能将本App慢帧简单推给AVD。QA单次纯文字发送+IME临时禁用内建背景canvas filter/blend后jank47/53=88.68%，未改善；不支持该滤镜是已定位瓶颈，不改用户认可背景。

当前结论：本App渲染长帧确实存在，原因仍未定位；保留上述短样本、系统基线和无改善A/B，按用户精简策略停止扩测，不将浏览器通过或功能交付冒称性能达标，更不能外推Magic7物理120Hz。后续性能任务应独立基于同平台同操作的渲染线程/合成轨迹定位，不重复无关功能矩阵。
