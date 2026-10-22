# Android 电脑资料导入 UI 候选

## 最新窄数据增量：candidate-v3.2-final knownrefs（待闭包复审）

基已独审v3.1，产品数据源只叠加已审 `data-knownrefs-1792445885744/sources/public/shared/shared-seed.js`，SHA `539c7f090b74fb34a533a8131e996e79475a24109d730377afed6d21cbbe4d4d`；上游data manifest `a2e96f9ae2ce07d97b52adb903bc8fd31f84fdca36faa959953fbde1ec02c081`。比较61源确认相signed61唯一此文件变化，未读取或混入live localACK/query/clock。新文件未增加闭包外依赖，esbuild每个runtime输入均在knownrefs61清单内并逐SHA吻合。native/固定动作/票据/host/UI语义及字节保持v3.1，原证据同SHA复用。

独立从v3.1冻结sources叠一源重建Android bundle，SHA `0ff570755001127c31d43952f94500991820bb386a46f4fe0c978a156bf88f96`，与已审knownrefs artifact逐字节一致。最终本轮候选 `outputs/2026-10-19-android-shared-import-ui/candidate-v3.2-final`，134文件，manifest SHA `a93826ffd4d447efe7c068b2bcc81e0e8de49d96e72a43ae93591f949a98f942`；closure.json与dependency-evidence.json列v3.1→signed61→knownrefs来源/精确输入。早期同轮`candidate-v3.2`为来源标签整理前的未交审快照，本轮复审只认final SHA，旧快照保留不发布。

上游knownrefs已审的4个真实streamed prepare边界按完全相同shared-seed.js复用，含sticker.mediaId、旧desktop global wallpaperAssetId缺原件拒绝、未知偏好不猜asset，见[独立报告knownrefs段](2026-10-19-shared-business-independent-review.md)。本轮只新增1个实际相邻导入流程测试：真实合法Ed25519签名/成员SHA的贴纸包故意缺业务mediaId原件，inspect通过并显示verified，但用户确认后的真实prepare/importer/UI返回SHARED_SEED_MEDIA_REFERENCE_MISSING，官方trust显示initialized=false/pinned=false，未生成待发，原选择不变，网络0。日志 `v3.2-knownrefs-ui-test.log`，不重复完整13项UI/Java编译/设备矩阵。

此组合仍待Sol高窄数据closure复审，只作独立dataQA后续候选，当前shared adapter查询port尚待新freeze；原生日记仍legacy、全页面读写/默认保存/离线新建/冲突呈现/真包原件与设备仍未完成。未改工作区三host、stage、设备或服务，不能把v3.1安全通过或此原件引用证明写成最终整包完成。

## 最新窄修：candidate-v3.1 恢复文案与转交能力检查（待复审）

根据[v3独审](../../outputs/2026-10-19-android-shared-import-ui/independent-review/candidate-v3-source-review.md)处理两项：恢复按钮统一为中性“检查上次导入状态”，不因import前已有marker就暗示导入成功；复用同库runtime前同时检查trust/status/importFile/**importNativeTicket**，缺native口在所有权转交前拒绝并由UI关闭票据。

import前marker继续保留，异常不能推断未提交并删除。v3.1在匹配同包恢复提示上尽力保存原失败机器码；重开先查官方seed.status，package-not-found/非imported明确显示尚未完成可用导入并保原选择/marker/原错，读取状态的其他失败则显示未查明，均不切库。真正imported的配置写失败仍走原status+trust核持久后只重试激活路径。此为UI恢复提示元数据，不改backend schema/协议。

冻结 `outputs/2026-10-19-android-shared-import-ui/candidate-v3.1`，manifest SHA `c7659fe31510baf4f1c583941030af5af8e9e29fe744288cb92b4175d06176f7`，129文件。v3原冻结/独审保持；与v3相比产品源仅shared-offline-import-ui.js和定向测试变化，另更新资产副本/依赖来源哈希及新测试证据。data61 manifest40493424…、bundle e97d4734…及所有native/host字节保持，不混后续data源码。

在复制v3冻结sources的独立v3.1-project上覆盖上述两件，13项source测试通过，含新增“真实成员校验预提交失败→重开中性按钮→官方status未导入＋原错保留”“same-current仅File口缺native口→转交前拒绝＋UI close一次”，原已导入配置失败恢复场景仍通过。日志 `v3.1-frozen61-ui-flow-test.log`；原4Java/API36证据按逐SHA未变复用，本轮未重跑nativecompile，未设备/宿主/stage变更。待Sol高复审，只可继续独立dataQA，完整页面与部署边界同v3。

## 最新状态：candidate-v3 签名离线入口隔离候选（待独审，未安装）

v3源候选已按实际signedoffline接口接入，v1/v2冻结及失败原样保留。冻结 `outputs/2026-10-19-android-shared-import-ui/candidate-v3`，127文件，manifest SHA256 `ef19b971da42fa4133d105fc9c03e2d3a4b281790d573d1be8078e4b2f997574`。尚未独立审批、合包、安装或操作设备/服务。下方“新协议未实施”是此前规划阶段；本节只更新已实现的隔离入口，不宣布完整首次导入或全部页面离线完成。

依赖严格取 `data-candidate-1792443858794` 的61源/22Java，data manifest SHA `4049342476d981ca083e624ef56bcfd4be57081dae22f1d4aa04d785436e639e`；在独立v3-project从冻结源重建Android bundle SHA `e97d47342f7a16dde0e5cb1b2968d621f11ee3380c3f5f40015681ccf5457a77`逐字节一致。没有纳入工作区后来localACK/create改动；数据61自身独审尚未最终准。candidate-v3/dependency-evidence.json保逐源来源/SHA，sources保66件（61冻结数据＋2自有UI＋测试＋测试签名器＋自有Picker）。native其余UI依赖沿已编译v2快照，22数据Java覆为61冻结原件，三个host只用owned副本，不批准夹带017等其他模块。

入口 `shared-import-ui.openSharedImport` 现在转 `shared-offline-import-ui.openOfflineSharedImport`；旧在线入口仅改名openLegacySharedImport供历史范围测试，不再由设置按钮调用。需在隔离assets/telegram/qq-chat同时复制两个UI文件和精确runtime bundle；工作树MainActivity/TelegramFrontend/AppSettings、UI023 stage、5554、手机未动。

选包→实际inspect逐成员SHA/验签→显示verified库ID/epoch/package/指纹→用户选择固定同identity选项并勾选信任→打开同identity临时runtime（兼容现有runtime复用）→offlineTrust导入器再次全验及事务pin/active。构造不start/sync/info、不先写enabled选择；用户可不配对、全离线。调用前先保存独立activation恢复提示；完整imported后以官方seed.status与seed.trust核真实package/lib/epoch/key/pinned/initialized，再写并回读activation，才允许切换共享renderer。配置失败保原选择；重开同identity后核持久状态，仅重试选择，不重新导入或删库。原子提交后离页不写新选择，保恢复入口。

native票据按新disposition处理：inspect成功retained仍UI持有；失败closed/unowned不再关；closeFailed/cleanupRequired保原验证错并提供显式清理重试，未清理成功不移除返回入口。未交importer时取消/构造库失败由UI关；调用importNativeTicket即交全部finally，v3没有v2盲outer重复close。native owner拦旧队列仍按v2；第11 file fixed action sharedSeedVerifyAttestation已由冻结SharedSeedImport/Bridge supports接入同owner通道。

冻结61实际测试：`v3-frozen61-ui-flow-test.log` 11项通过。用真实签名器/inspect/importer/runtime/client与fake IndexedDB，native文件仅块读取模拟；覆盖native/File首导三域真实本地读、显式信任前不建runtime/不改选择、已导入项sync:false编辑冷重开同op pending、同identity复用/同包重导保修改/outbox/draft、取消与损坏关闭一次、cleanup失败保原错、config失败重开只激活、离页晚提交不改选择、DOM明确选库/指纹、显式同步失败保本机修改/同op。网络计数在首导/本地读写为0，仅显式立即同步才尝试远端。

强制WebCrypto NotSupportedError时真实inspect发sharedSeedVerifyAttestation小context，测试shim用实际Node Ed25519验签；另外 `v3-attestation-host` 直接运行冻结SharedSeedBridge/SharedSeedFile的Java Signature验签，4项通过（固定口、真签名、改watermark拒绝、任意额外字段拒绝）。API36/JDK17全Java隔离快照编译通过 `v3-frozen61-native-compile.log`。这些是Node/fake IDB和Java host证据，**不是实际Android provider、WebView/OS生命周期、真整包或设备吞吐验收**。

读回界面只展示真实本机directory/diary/settings摘要与已有source snapshot；临时runtime未选房则如实显示未选房，不假造聊天内容。已导入项API显式sync:false本机保存已验，默认rawDiary仍awaitsync、离线create缺optimistic属于61既知缺口，不宣称新建/默认保存或原生日记主页已离线。原生主日记仍legacy LocalStore，完整日记/设置renderer及页面编辑入口待根另白名单接；普通消息editedAt/双版冲突UI展示、真实同水位已初始化撤回回归、实际全量媒体与冷重开也不能拿本入口测试代替。v3待独立Sol高复审，只能继续独立dataQA，不合023/不部署。

## v2历史状态：安全修复，首次离线需求当时未实现


v1独审指出坏ticket在runtime try前拒绝后两层均漏close、离页仅丢回执却仍执行旧队列写入。v1冻结与失败证据原样保留。v2仅修这两个安全边界，未合包/安装/设备执行，独立Sol高复审前不合包；仅可继续独立dataQA，不进入023 localQA。

用户经后端会话最新明确首次导入必须完全离线立即读写，PC/phone都是完整本地客户端，PC暂host。签名离线v2（Ed25519原owner签包、native真实verify摘要、显式信任并pin独立库、联网核库/epoch/key后先delta/redactions再幂等outbox）正由后端持有，**本安全candidate-v2未实现**。下文v1的先配对/在线resolve首次路线已被该新需求覆盖。普通消息真正editedAt合流、长文真并发双版、无editedAt历史不同内容双版冲突也由后端owned新规范处理；本UI未自造合并，亦未实现其新冲突展示。

v2责任规则：JS对领到token无条件finally请求close，不复制backend预检推断handoff。真实runtime也可finally请求，native owner注册表去重，实际container close一次。离页releaseOwner永久撤销旧port：未过worker准入点的所有shared固定动作拒绝、零执行；已准入原子操作可完成，其续步拒绝。release关闭已领container、abort未完成stage；完成原件保留给持久事务/隔离包/冷重开，未引用完成件可能成为orphan，未声称自动回收。`cancel`仅协作停止，界面明确已经提交的资料保留；不声称全回滚。宿主副本统一把全部shared动作送此owner队列，legacy Product路径保持。

11项Node通过，包含真实v1冻结bundle importer try前坏ticket泄漏复现、v2 outer finally修复、真实current importer identity/hash失败与成功/取消/离页晚提交；Java实际SharedImportPicker源码在平台/data替身host中9项逻辑通过，同探针v1有7项失败保留。该host不是真ContentResolver/Android设备，也不替代完整后端导入测试。API36全Java隔离快照编译成功。日志：`v2-ui-flow-test.log`、`v2-native-compile.log`、`v1-owner-host`、`v2-owner-host`、`v1-invalid-ticket-reproducer.json`，均在本轮outputs目录。

v2冻结 `outputs/2026-10-19-android-shared-import-ui/candidate-v2`，manifest SHA256 `1d701083a9757e30508785314540332507aad6ba4c7b2c8e9352ba8220e3012f`，89文件。native依赖沿v1编译快照，仅自有picker及宿主副本变化；不批准夹带的017或其他UI模块。runtime bundle输入源另逐项冻结。真实current importer `public/shared/shared-seed-import.js` SHA `3c68f134d59b12e336a9bd334fb4860aa7f0d3fc92c8a7221fb2cb89ae1a58cb`（backend guard manifest `662ad726f6df819d8d1ca09296ec05263fefceb063a9ced88d67768b17b3179f`，仅guard）；v1真实importer bundle SHA `1e62596124ef1e4b50fa981d7173ba95835450900b10c99420e34d46d8c9767d`。测试前后检查current SHA未漂移，见candidate-v2/dependency-evidence.json。

回读文案已改“本机共享投影”“共享设置本地投影”，其目录/日记/settings读来自本地client，不是新鲜服务端ACK，也不是原生思绪主页面。真实整包数据比对、追增量ACK、离线激活、原生日记渲染全部仍待根按新规范串行接线。

独立Sol高于2026-10-19复核candidate-v2：冻结清单89/89 SHA匹配，独立复跑11项Node全过，并对照实际`SharedImportPicker`的owner登记、重复close去重/跨owner拒绝、releaseOwner执行前拦旧队列及同owner stage清理；v2 Java替身host 9/9与v1失败对照可作为隔离逻辑证据。**只准继续独立dataQA串行接线和定向验证**，不把编译或替身host写成设备、真实ContentResolver、服务、完整三域回读或正式启用。首次签名信任后完全离线读写仍未实现，旧在线配对入口不符合最终需求。详细[独立报告](../../outputs/2026-10-19-android-shared-import-ui/independent-review/candidate-v2-source-review.md)。

## 新离线协议接线计划与未验门槛（未实施）

执行权威继续是[原主需求018](../ANDROID-UI-CONTINUATION-2026-10-19.md)及[跨端内容契约](../DESKTOP-ANDROID-CONTENT-CONTRACT.md)，本节记录接线/验证边界，不新增协议所有权。后端拟口 `inspectSharedSeedFile(file)` / `inspectSharedSeedNativeTicket(ticket,{nativeRequest})` 真正逐成员验签后返小summary `libraryId/epoch/packageId/keyFingerprintSha256/bytesVerified`；最终SHA、失败disposition和本地库选择口尚未冻结，本UI不猜实现。

计划顺序：未配对也可系统选包并后台inspect→展示真实verified库身份与指纹→选/建相同verified identity runtime→用户明确确认指纹→`runtime.seed.importFile/importNativeTicket(...,{offlineTrust:{explicit:true,keyFingerprintSha256}})`再次验全包并同事务pin/active→立即离线读写。旧手机测试资料保留原库；runtime身份只能沿后端库选择口建立，不自行造假身份或为过关切旧测试库。

inspectNative成功UI仍持票；inspect失败/取消由inspect关闭一次并给最终disposition。成功inspect后、尚未调用importer前的返回/拒绝信任/选库失败由UI关闭；调用importNativeTicket即全部finally转交importer。接新协议时移除安全v2盲outer重复close，保留native owner/代际拦截；不靠复制预检推断谁拥有token。disposition不明不能猜测再次关闭/重试。后端新API未冻结前，这只是待实现要求，安全v2现有关闭路径和哈希证据仍原样保留。

定向dataQA必须实际记录：无网未配对合法签包inspect/显式信任与首次active、断网编辑本机durable后退出/冷重开、签名/成员损坏及inspect取消、成功inspect后拒绝与importer交接后的失败关闭数、Activity/port变更、已initialized同库旧包/同水位重导、known撤回/inbox/outbox/draft逐ID保持、联网异库/异epoch/异key拒绝、先delta/redactions再幂等outbox。不能按feedRevision hash猜新旧，不能把一份包同水位直接覆盖已初始化库。

本地保存与remote同步分验：本机durable成功即允许返回/退出，remote pending单独显示；仅用户明确立即同步动作等待远端ACK。断网/超时保留同一operationId、草稿与待发记录，重开不重复建op。本机client投影回读仍不能替代新鲜服务ACK或实际日记/设置/会话主页面。普通消息editedAt较后、长文真并发双版、历史缺editedAt异文双版，按后端结果呈现并核原文，不由UI合并。

以上全部未实现/未设备验证；本轮只更新原文档，未改源码/候选manifest/宿主/stage，未占设备。candidate-v2独审是旧安全scope通过，不是新离线协议审批或023合包许可。

## v1历史交付（下列先配对路线不再满足最新首次离线要求）

2026-10-19，独立 Sol 执行。源码/隔离验证，不是 APK 安装、设备执行或正式资料导入。5554、5580、手机、QA5 stage、正式服务器均未操作。手机旧测试资料未分类、迁移、删除。沿既有 ANDROID-UI-CONTINUATION / ANDROID-SHARED-RUNTIME / SHARED-SEED 契约。

## 交付与接线

- 新增 `android/qq-chat/shared-import-ui.js`：可见配对→核身份→明确启用重开→选包→导入/隔离/重试；结果回读真实 runtime.directory/diary/preferences 客户端并显示标题与数量。标题使用 textContent，不执行包内容。
- 新增 `android/app/src/main/java/dev/shiye/app/SharedImportPicker.java`：ACTION_OPEN_DOCUMENT content URI、.syseed/.zip 后缀、后台流式 prepare、小 ticket、协作取消、任务所有权、迟到票据清理、固定 data 白名单。预计 SHA 可空；空串规范为 null。原件不整包 base64 入 WebView。
- `tmp/android-shared-import-ui/owned-host/{MainActivity,TelegramFrontend,AppSettings}.java` 是接线副本；`base-host` 是读取时原件，`prepare-host.mjs` 为精确锚点 patch 生成器。未覆盖三个宿主工作树，也未改 root 的冻结 QA5。
- 设置→数据与关于→导入电脑资料。编辑页仍要求先返回列表，避免绕过现有草稿保存流程。服务地址复用 BackendServicesPage。sharedPair 与 sharedInfo 为已有 shared 固定口；不复用旧独立 AndroidSyncTransport 的另一套配对。
- 首次配对凭据仅 native 保存；配对码提交后清空。只有读取/展示 libraryId、epoch 后用户点确认才写既有 runtime activation localStorage；确认前再读 info 防服务身份改变。文件不能 bind/替换身份。
- **票据实例要求**：prepare 与 sharedSeedManifestRead/ReadMember/Close/Original* 必须由同一个 SharedSeedImport 实例持有。宿主 JS 注入把 `action.startsWith('sharedSeed')` 转到 shared-import 通道，避免落入 ProductUiBridge 的另一 files 实例；resolve/register 也沿该固定通道。其他 Product 路由保留。
- Quarantined 的 packageId 按显式 libraryId/epoch 存为本机恢复提示；重开可调用既有 seed.resume，未核验前不报成功。仅 status=imported 可报成功；导入已提交但回读失败单列。取消到达原子提交之后仍显示已提交，不假称撤销。

## 验证

`node --test tests/android-shared-import-ui.test.mjs`：8 个隔离状态/DOM场景通过。覆盖未配置零picker调用；三客户端回读；隔离重开/恢复；并发与取消迟到ticket；错库/未知结果；提交成功回读失败；取消晚于提交/页面销毁；可见入口/标题转义；首次配对码清除/显式启用时身份变化拒绝。测试中的 runtime/data client 与 nativeRequest 是定向替身，不是实际 Android 或完整数据整包验收。

所有生产 Java 的独立快照（覆盖三宿主副本与 picker）已用 Android 36 API jar + 原 R.jar、JDK17 编译成功。不是 Gradle APK 构建，也不是 Java 在设备上执行。日志 `outputs/2026-10-19-android-shared-import-ui/{native-compile.log,ui-flow-test.log}`。ESM shared runtime 已在独立 `tmp/android-shared-import-ui/bundle-stage` bundle；shared-import-ui.js 与 bundled shared-runtime.js 同目录可直接 import，无 APK public 相对路径。

冻结审查候选 `outputs/2026-10-19-android-shared-import-ui/candidate-v1`，manifest SHA256 `714fedbe4d58e38a655f5a05665c446edfa44518fa7d4ce34ab9f076c393f0e0`。包含编译时完整 Java 源快照、原宿主、副本生成器、UI/测试/契约与已 bundle runtime。该 snapshot 用于复审及 diff，不是已批准的最终后端闭包；根须与后端最新冻结合并后重新编译。

## 仍待根串行接续

1. 独立 Sol 高复审本候选。基于最新 owned host 窄合并，不复制历史整文件覆盖他人改动。
2. 将 `shared-import-ui.js` 复制进 `<stage>/assets/telegram/qq-chat/`；当前 build-shared-runtime.mjs 尚未自动复制新 UI 文件，本任务未改它。
3. 冻结后端同库 native/data 依赖后，另建 data QA APK；不能套用 UI023/QA5 的视觉与触摸通过结论。
4. 真实 picker→后台 prepare→WebMessage 小 ticket→runtime.seed.importNativeTicket→隔离/错库/取消/同库增量/原件冷重开全链路仍未执行。须协调专用设备和服务所有权后操作；本任务未申请或占用任何设备。
5. 现有原生思绪主页仍读 LocalStore legacy，不能因本页通过 client 回读就说主日记已共享；shared diary 主渲染、资料设置完整页、旧手机测试数据并存可见性待 root 接线验收。shared source/目录订阅已刷新，但其实际 WebView 显示也须另验。
