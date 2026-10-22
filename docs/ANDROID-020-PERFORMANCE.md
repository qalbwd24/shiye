# Android 020 性能专项

2026-10-19。按用户新指令，Astra仅负责性能；本阶段停止UI设计/新功能。仅产品改动 `android/qq-chat/legacy-source.js`，不触及桌面公共模块、后端、编辑器或存储格式。未控制设备、构建或安装。

## 定位

- `getSnapshot()`每次扫描当前房global消息并排序，再投影当前历史窗口（初始80条）。原先每条normalize均调用mediaInfo，即使文字也先在整房持久消息数组find，再在全部documents中find。5000房间消息/3000媒体下，80条窗口重复线性查找构成主要可隔离CPU开销。
- `poll()`250ms轮询比较房间、context、branch引用、外观和dirtyStamp；干净状态不重复readLibrary。真实commit事件及保存确认仍可能读取整库，不能称空闲每250ms复制媒体库。
- `android/telegram-adapter/android-chat.js:1812`的readLibrary实际从IDB preview/library整对象读取，因此真实强制读取仍包含媒体字节结构化克隆。waitCommitted每100ms核验、发送前基线和commit失效读取未改，避免削弱本地持久ACK。此成本仍在。
- 编辑器已有dirty早退、空changes不提交，metadata-only保存绕过prepareProductEntry。updateStats仍取全文/字数和DOM图数，并调用paintAttachments遍历文档；卡片复用已有实现。这里只读定位，未改编辑器，未声称消除其输入开销。

## 修改

仅把单次snapshot内的持久消息/媒体查找改为懒Map索引。索引在该次投影内创建并释放，无跨snapshot缓存、无全房累计缓存，下一次读取可见新的owner对象。保留Array.find的重复ID首项语义；不克隆媒体字节。排序、窗口锚点、canonical、拆段、时钟、草稿、保存/撤回确认完全沿用。

## 证据

合成Node同机顺序对照，8次预热后40次getSnapshot均值：

| 房消息/媒体目录 | 旧均值 | 新均值 |
|---|---:|---:|
|500 / 300|0.736 ms|0.077 ms|
|5000 / 3000|7.896 ms|1.180 ms|

双方均仅1次readLibrary。逐对象相等检查涵盖初始投影、owner原地编辑、commit刷新媒体元信息、重复ID首匹配、持久撤回覆盖旧global、80条分页。现有 `legacy-source.test.mjs` 20项全过，包括真实action参数、草稿串房保护、文件字节、迟到ACK、不确定重试、idle不整库读；ESLint与Prettier通过。

以上仅合成CPU投影对照，不是手机端到端延迟、IDB读取耗时、常驻内存或物理120FPS证据。每次snapshot仍有全房扫描/排序，实际大库ACK仍可读取整库；本轮未贸然以引用缓存假设可变对象永不变化。

产物：`outputs/2026-10-19-android-performance/legacy-projection.json`、`legacy-tests.txt`。临时：`tmp/android-performance020/bench.mjs`、旧实现对照 `legacy-before.mjs` 和编辑脚本。
