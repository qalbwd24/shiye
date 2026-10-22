# 2026-10-19 shared seed 可调用导入数据接缝

本次为Sol执行的puredata候选，独立Sol高审批另记。未打开产品窗口、未操作手机/5554/5580、未安装APK、未重启或切换正式服务，也未将3.33GB真实资料放入fake-indexeddb。真实页面和原owner身份上线/整包结果不能从下列合成证据推断。

候选`outputs/2026-10-19-shared-business-integration/data-candidate-1792441652751`，59源/22Java，data-manifest SHA `6ae242a9b1888910d099600641cc82ab00da2d3aa38a7c0d7216af0bcc36472a`。旧56源候选原样保留。两bundle由冻结sources在独立absWorkingDir重建逐字节相同：Android `1e62596124ef1e4b50fa981d7173ba95835450900b10c99420e34d46d8c9767d`；PC `6b4cd24992a5dd171cd196da7a1b8b9cac2bd3e9c08b6c4ce73a3b22beffe456`。闭包自动含shared-seed-import/originals/wire/client及媒体sink。MainActivity/TelegramFrontend/DesktopPreview/023/PC renderer/i18n均不在发布白名单；prepare/write-manifest只记录构建参考SHA未复制。journal/C#仅固定shared data seam观察快照，不准据此整文件替换前端。

两前端最小接线：显式已验证的libraryId/epoch配置后使用既有runtime.seed。PC选择File后先`estimateFile(file)`，确认预算再`importFile(file,{resolve:true,signal,expectedSha256?})`；只支持raw.syseed，ZIP明确拒绝并要求native受限reader。Android资料页worker使用`new SharedSeedImport(context).prepare(InputStream,expectedSha256,cancellation,progress)`回小ticket，JS `runtime.seed.importNativeTicket(ticket,{resolve:true,signal})`；固定file10口在SHARED-SEED-NATIVE-V1，backend16沿原桥。不得从包静默bind异库，不清现测试资料/草稿/outbox。`imported`才可报成功，`quarantined`可`status(packageId)`/`resume(packageId)`联网可信增量后发布。取消在prepare/stream阶段受Signal控制；进入原client原子事务后以实际事务ACK为结果，不能声称撤销已成功提交业务。

媒体renderer须调用runtime.readMedia（source的readMedia回调已接），其先client.readSeedOriginal检查当前active媒体大小/SHA/revision，再分块本机读取+完整SHA，缺本机索引才固定网络download。64MiB以上显示需要前端提供持久streaming sink，本次不把大视频整体Blob化。`runtime.seed.openOriginal/readOriginal/copyOriginal`可供原件stream使用，每块128KiB。native完成句柄跨容器close/进程重开持久；IDB原件在同shared实体store按256KiB分块，不塞meta/JSONwire。

同package同manifest重导只consume新登记prepared；重复导入discard本轮全新ownedstage，旧已索引handle不变。当前native/IDB stage每轮新UUID、不按SHA返回旧activehandle，避免discard删除旧原件。异manifest同package拒绝。IDB缺deleteEntity端口，因此abort清空本轮chunk bytes并留aborted审计实体；不承诺浏览器物理文件立即收缩。失败事务不保留半批业务或游标。

最终分层证据：`outputs/2026-10-19-shared-business-integration/seed-import-final-e59d3c34-c272-46c9-a194-c1abae784a27`保存源快照/SHA/日志及frozen-rebuild.json。29项相关Node全部通过（原seed/ZIP、6新import、7Android runtime、PC目录）。新6项包含raw File→同IDB→原Entry写回旧API、离线隔离+真实HTTP trusted delta、错库/hash/cancel保护、同包重放、实际Java selected stream→小ticket/manifest/member/stage→JS同库发布→容器close和进程重开原件读取、两runtime断网本机原件回调/URL释放。后补actual-idb-abort-latest.log同6项通过：注入实际IDB事务在package/entity/meta写后、commitACK前throw，验证三者回滚、仅本轮media stage清空，旧草稿保留；该次只强化test，不改production SHA。最初runtime测试使用无效pollMs:0导致SHARED_INVALID_OPTIONS，改测试为契约允许30000后通过，无产品修复归因。

PC真实C#console/HTTP三个最终组：fixed31 `pc-native-1e01b413-305a-4680-80c4-64a68d5d0629`；容量/outer小消息29 `pc-capacity-b78a359e-b78f-4c02-8dd8-cf4e02e54615`；DPAPI/device auth19 `pc-auth-bf820da3-916c-4327-b3d2-93b8ddd30f1e`。其中>8MiB合成manifest每帧<256KiB真实过旧outer模拟封包，业务实际roster不匹配按409拒绝，不能记为真实全量注册成功。native25 `native-seed-603d7d9e-070e-4b74-9fd8-8d6ccf96074c`及Android harness仅编译 `native-shared-20261019T201119541Z`按对应未改源SHA复用，不是设备实跑。

复现：`node --test tests/shared-seed.test.mjs tests/shared-seed-zip.test.mjs tests/shared-seed-import.test.mjs tests/android-shared-runtime.test.mjs tests/desktop-shared-directory.test.mjs`；`node tools/verify-shared-pc-bridge.mjs`；`node tools/verify-shared-pc-capacity.mjs`；`node tools/verify-shared-pc-auth.mjs`；`node android/sync-tests/shared-seed-host.mjs`；`./android/sync-tests/verify-shared.ps1`仅构建不加Run；`node tools/freeze-shared-clients.mjs`每次新建candidate不会覆盖旧包。Java console fixture为SharedSeedPortProbe.java（source路径仅host参数选择，页面不能传path），C# fixture为tests/helpers/SharedPcBridgeProbe.cs（不构造Form/WebView）。完整源码白名单与逐源SHA在data-manifest.json。

真实资料门槛仍为原owner受控sharedSync:true/remote:false上线、原身份固定口登记导出、前端实际资料入口/renderer及设备磁盘预算验收。原件约3.33GB：native现约3×raw额外峰值+128MiB，8GB AVD不足；由root协调专用大磁盘/磁盘host，不用缩小合成包冒充全包。未来remote启用PC先正常pair，token只native DPAPI保存；不进包/页面，不放宽Host/LAN/防火墙。本轮不自动导入一本日记旧备份。

## 2026-10-19 ticket所有权P1窄修

前端独立发现旧importNativeTicket在try前拒manifestguard，UI已handOff时无人close。旧冻结实际Java重现manifest guard close=0失败；修为合法UUID token归属后即进try/finally，所有manifest/identity/cancel/parse guard及成功均尝试一次close；非法token不路由，不关闭其它任务。prepared.discard另嵌套finally，清stage失败仍close。shared-seed-import.js SHA3c68f134d59b12e336a9bd334fb4860aa7f0d3fc92c8a7221fb2cb89ae1a58cb。

新base候选data-candidate-baseguard-1792442617373，从旧冻结59源仅替该一文件、其余58逐SHA保持后独立重建两bundle；manifest SHA662ad726f6df819d8d1ca09296ec05263fefceb063a9ced88d67768b17b3179f。Android bundle b15e13fe3b0fba6863d2a6159e9245c3de5f3c455504c59757a7ef07d3bd4807，PC1c02a5acb896997217f5f9facb0f6aa445bd8eef6692a76b09ae802a19b16e34。证据ticket-guard-8fac061c-decb-4ee7-b937-db2b4f785d75保留旧失败、patched冻结JS6项真实HTTP/IDB/native通过及构建来源。该base不含live v2/TOFU未完能力，旧审批不可套用，已交独审及root同步前端。
