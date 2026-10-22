# PC 逻辑来源隔离采集宿主候选

2026-10-19，Sol 中。宿主源码 `tmp/pc-logic-capture-host/CaptureHost.cs`，构建脚本 `tmp/pc-logic-capture-host/build.ps1`，合成初始化 `FixtureInit.cs`。前端数据模块由独立负责人维护在 `previews/telegram-chat/shiye-desktop-source-capture.js`。本轮未操作正式随想、正式 WebView profile、后台、手机或 5554；未形成真实导入包。

固定调用：`CaptureHost.exe --private-root <本轮绝对私有根> --work-profile <本轮根内的工作副本> --output <本轮根内未存在目标> --module D:\拾页\previews\telegram-chat\shiye-desktop-source-capture.js`。调用前由维护流程完成正式页面保存 ACK、正常停止、稳定私有备份，再从原备份复制工作 profile；宿主要求工作副本根目录有 `.capture-work-profile` 标记、`EBWebView/Default/IndexedDB` 已存在，拒绝输出嵌套到 profile、已有输出、任意模块路径、路径祖先与工作 profile 内任一 reparse 文件/目录。工作 profile 从根起用不跟随 junction 的逐层遍历校验，随后才统计 IDB 尺寸并打开 WebView。宿主只打开工作副本，原备份保持只读。实际用户 profile 执行须等统一协调和独立审查。

宿主使用 `https://shiye-preview.local/index.html` 的独立空白页面，映射本次暂存目录内固定 `index.html`、`runner.js` 和数据模块 `capture.js`；网络资源白名单只允许这三个 URL，拒绝窗口跳转与新窗口，CDP 绕过旧 ServiceWorker。没有产品 app、worker、journal 初始化。WebMessage 有逐条 ACK 背压，分块解码上限 256 KiB、固定成员路径、成员顺序/大小/SHA-256 和原件路径哈希校验；异常或超时清理未完成目录，成功后目标目录原子发布且不覆盖。`capture-manifest.json` 记录私有成员的路径、大小、SHA 和有界 coverage summary；公开回执只写计数/hash，不放正文或原件。

WebView 的旧库可能由单个大 IDB record 组成，第一次 `readonly.get` 仍会完整克隆对象。宿主预检工作副本 IndexedDB 文件总大小及系统可用提交额度，要求至少 `max(1 GiB, 4 × IDB 文件字节 + 512 MiB)`；这是保守启动门槛，不是内存峰值证明。采集模块再按成员输出；未将约 3.3 GB 后端日记媒体误当本机 worker documents。真实本机库大小仍待私有预检。

合成 profile 用实际 WebView2 在同 origin 创建已有 `shiye-journal-link-v1/settings/link` 与 `shiye-telegram-preview-v1/preview/library`，仅包含一条合成消息、一份 3 字节 Uint8Array 原件、BigInt 3、20 位 ID 字符串和已知/未知偏好。可选库缺席场景实际输出 4 成员、1239 字节；summary 的 `assetsDatabasePresent`、`withdrawalRecoveryDatabasePresent` 均为 false，明确不称这两库已经采集。

第二个合成 profile 另有 `shiye-preview-assets-v1/assets` 一条原件 Blob/预览 Blob 和 `shiye-withdrawal-recovery-v2/recoveries` 一条私有撤回恢复记录；宿主输出 8 成员、2393 字节，其中三个 media 分别是 3/3/2 字节，两个可选 typed graph member 具备。summary 两个数据库存在标志和对应计数均为 true。逐成员哈希验证通过，typed graph 保留 BigInt、ID 字符串及媒体字节，未知 localStorage 仅有键名、无值。宿主重复目标、目标在 profile 内、任意模块路径三个反例均拒绝。合成 profile 与输出仅在 `tmp/pc-logic-capture-host/qa-private`；可选库场景 manifest SHA-256 为 `b0a08925c12c4e07dfd899d3ab8c3856511f83829456e1a98cf2a75d0ca56455`。此为小合成 WebView/宿主联测，不代表真实旧 profile、完整页面、共享业务投影、正式启用或 Android 导入已验。

独审 P1 反例推动补 profile 内 junction guard：在合成工作副本新增指向另一合成 profile 的 junction，宿主在任何 WebView 打开前拒绝 `work profile reparse entry rejected`，目标目录不存在；无 junction 合成 profile 复跑 4 成员/1239 字节通过。原失败边界保留在协作审查记录，不能将首版视为已通过。

源码 SHA-256：宿主 `7d41538e451d65bd736c0fff52d0bbe96592260a66e32bee87dba476e05612cd`，构建脚本 `08c0511b83d0991d92848ec1261d1a246605e0ceca3d1c000b102adfff3436ee`，合成初始化 `306e9c427de0bc3689c99a4c059e57fae3d592d12aa30557124f47e865e22d69`，采集数据模块 `9098a502b2e0d79b70aebd8cd9f461d380619e39bd752e7b57ea4d39365245e9`。
