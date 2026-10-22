# Android 产品同步接口017实施

2026-10-18 Android0.17.0-product-preview/code19后端候选已验、未部署：固定product/sync/原件接口、同SQLite完整信封/事务队列与私有原件下载已完成隔离QA；正常候选APK bd1e6a86…，QA/normal DEX与assets一致，016原11749个assets保持，仅新增共享内容模块。44原生HTTP、59实际SQLite、74原件runner、11生命周期/迁移、9实际WebView对象及36共享回归通过；全库check停56格式告警。旧TL/长文生产写口与权威、完整同步和朝花夕拾完整UI仍未切换，手机/主AVD保持016/code18；017四图UI需求尚未实施。自有QA包/服务/转发已清理，主AVD恢复016。验收见[017候选验收](validation/2026-10-18-android-product-017.md)和outputs中的release-manifest/cleanup；源码白名单ZIP与source-hash-manifest由本轮收尾附加到release manifest。

2026-10-18，用户确认当前使用文档的电脑服务器 `http://100.77.215.104:18789/`，服务稳定后再迁移。与18779网络试验库分开，不能共用token/库身份/cursor。手机/主AVD已交付0.16/code18做聊天UI测试；本轮后端仅隔离QA，候选code19以上。

## 原确认范围（已按下列候选证据实现接缝）

- 按ANDROID-PRODUCT-SYNC-CONTRACT/PRODUCT-SYNC-API补全固定sync/product/原件端点，保留前缀、密封凭据和libraryId/epoch保护；一个root可同时提供增量与业务API，不放任意URL桥。
- 网络策略只额外允许当前确切Tailnet主机100.77.215.104的HTTP，与loopback/HTTPS兼容，不开放整个私网/100段。云迁移使用HTTPS及相同协议，地址改变先校验同库。
- 同一LocalStore SQLite实例内新增完整信封/remote base/intent与固定业务命令队列、原子整页接收/cursor、身份映射；不丢unknown/canonical/大整数字符串，不异步抄TL冒充单事务。
- 产品连接页先接实际能力、持久收件/错误和朝花夕拾固定入口；媒体原件与业务media元数据分别处理，单原件发布不等于业务引用完成。

当前完整长文/TL权威切换仍是明确门槛：本轮不得自动把现旧资料伪造远端base、全库上传或清空，不能将HTTP200或端口可达显示成全部内容已同步。现UI/算法/媒体原件继续保留，单源接入需要同事务和真实恢复验证。

## 验证与产物

实际Android专属QA测试服务配对→info/catalog→snapshot/pull/push/watch、原件续传及固定业务接口；用golden合成fixture校验20位消息ID/未知字段/时钟/canonical、整页回滚与cursor、迟到ACK和新编辑、空远端/local-only、墓碑不复活、wrong库/epoch/401/409/413/422/429/5xx和取消。

产物 `outputs/2026-10-18-android-product-017`，临时 `tmp/android-product-017`；各测试使用独立库/端口/QA包，不修改正在运行18789规则或正式日记，不打断手机0.16手测。连接只读审计见ANDROID-PRODUCT-017-CONNECTION-AUDIT。


## 候选已验与后续接线

已完成固定product14入口、增量/冲突/原件、LocalStore schema3→4增表迁移、同SQLite Repository完整信封/队列/整页cursor及显式Coordinator；原件分块fsync/断点/完整SHA及JSON安全下载通过实际Android链路。共享内容模块冻结12实际源码，实际WebView9对象与电脑逐对象一致；016原UI全部11749资产保持，QA/normal DEX/assets相同。

旧TL/长文编辑器仍走原生产保存权威，尚未把共享prepare和Repository单事务切进真实写口；本轮未自动上传旧资料或创建正式绑定。继续实现前先核对APK/源码hash，保留旧库/草稿/原件和身份映射，逐业务通过离线/强杀/迟到ACK门槛再开放同步。原件上传持久任务与调度、朝花夕拾绑定/气泡/固定单条评论、双端离线冲突和真实手机18789产品通信仍待完成。用户现已转向另行重构QQ聊天UI，不能把本接口候选冒称新UI已交付。
