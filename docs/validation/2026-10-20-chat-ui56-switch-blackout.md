# UI56 切换会话短暂黑场修复

实际启用已获非作者收口：`outputs/2026-10-20-chat-switch-blackout/live-independent.json/md`，JSON SHA `7b1ac02c90c5784717623b59326101247f2011f36ef726c9a65072c5969387e7`。仅核本次既有真实安装/原生保存/偏好/API身份绑定，没有追加运行操作或测试。

用户恢复PC工作并反馈“现在切换会话会黑一会儿”。本轮沿原U52/切房契约处理，最终准确包已独审并标准升级启用UI56：operation/备份 `2026-10-20T11-06-29-105Z-6d62d24b`，实际native `2026-10-20T11:07:47.1332060Z` ready/LocalSaveAck，116%/两屏、输入聚焦，无保存挂起、恢复异常或维护锁；四份偏好SHA保持。后台仍4a97未重启。准确启用回执 `outputs/2026-10-20-chat-switch-blackout/ui56-final-enabled-receipt.json`，SHA `8f0579077df036cb77c8acaa0bf5125df637f75f7d3a09967fca9e2e71a3d30c`。

## 原因与改动

UI55的switch-start先清掉background-ready，pending样式同时去除背景并隐藏消息和输入；目标背景等后续MessageList prepare/rAF才接入，缓存命中仍可空一帧。真实隔离页面/worker/IDB实测能重现短黑场，没有将本机几十毫秒样本外推成用户现场的秒级原因。

候选提前准备目标房背景，复用目录已经解码的同asset位图生成保持比例的轻量预览，预览可先满足背景准备，原图随后提升清晰度。预览缓存最多四份、最长边256px，沿原asset/代际和有界释放；原图仍沿原解码缓存。清晰图补齐不重新挂载MessageList或已发送节点。所有编译页面/worker、cut、native和后台保持UI55原字节，只改两wrapper及必要入口/元数据；不引入数据格式或接口变更。

## 定向证据与身份

作者实际点击冷B/热A/热B及PNG像素分析：旧60采帧中5张黑场，新65采帧中0张，目标文字与背景未错配。受控挂起全图解码时，同图预览约88.6ms先显示目标背景/消息/输入；随后真实Enter发送，原图提升保持同消息DOM节点、同owner和底部可见；换asset、快返后的迟到原图不覆盖新房，pagehide回收已观察到的preview/full URL。作者五项直接接缝通过，原始失败/采样/PNG均保留。

第一候选ed9c经非作者独审暂HOLD：独立旧73帧6黑→新63帧0、五个直接接缝与准确成员/硬链均过，但额外直接反例发现pagehide后迟到的createImageBitmap仍可进入seed，重建一个未回收webp URL（postHideUnreleased=1）。原件在`independent-run/late-pagehide*.json/mjs`，独审`independent.json/md`保准确HOLD；作者仅补原imagesGeneration/有效生命周期守卫，另冻结后继，不覆盖旧树/旧失败，不重复主矩阵或据主收益提前安装。

证据目录 `outputs/2026-10-20-chat-switch-blackout`：`old-audit.json`、`paint-analysis.json/log`、`ui56-final-audit.json`、`ui56-final-controlled.json/log`。完整候选 `candidate-ui56` 共12534文件，仅workspace、preview、index、UPSTREAM四文件替换，12530保持原硬链身份；旧UI55冻结树未改。冻结manifest SHA `ed9c479a45552ab5b4594fee3872e35780f008865803537d52284a153fc65caf`，基UI55 manifest `17e9d7e9900bf9cfaaf2f7330f4a4e5df84ad272c9f64e322ffa5163da931cbf`。无Vite/native重编，复用已审cut/worker/native/backend证据。

最终冻结 `ui56-final-frozen-manifest.json` SHA `3481884e331efb2d6204044b8b19611d3af388b43e6ca59fadf81a619e80d042`：只在首候选上补原imagesGeneration入seed前守卫，原pagehide反例1→0。非作者最终报告 `final-independent.json/md`，JSON SHA `71853a63587cfbaf6d8e3d682efa827d8f999ca558eca414cce49276fcbbe186`；只复原取消反例及三个直接成功/输入/释放断言，主黑场/五接缝/旧UI55证据复用。标准源码CAS四目标、新ui56交付proof与实际四文件安装SHA均核准，旧ed9c HOLD及失败保留。

未发送正式测试消息、动设备或重启后台。隔离CDP采帧不代称所有物理WebView/DPI逐帧或长期性能验收，分组广播和其他既有待办不列本包完成。
