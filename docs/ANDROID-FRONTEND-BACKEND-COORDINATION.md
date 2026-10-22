# Android 前后端并行维护

## 原思绪日记入口接共享库：执行前清点（2026-10-19）

G9已结束后补运行[原Java查询参考](../outputs/2026-10-19-android-shared-import-ui/diary-adapter-audit/reference-fixtures/execution-notes.md)：31合成输入生成golden、12条关键断言通过，范围为逐字提取的list/search/calendar/dayKey/streak/neighbor/title算法；真实SQLite/Android/回收站UI未验。static-before-run状态与首次缺at编译失败保留，最终含原at共8范围hash。backend可用同inputs检新公共port兼容；本任务未改其三client/storage公共owner或生产文件。

供backend移植的旧算法原件已静态提取：[参考与JSON合同](../outputs/2026-10-19-android-shared-import-ui/diary-adapter-audit/reference-fixtures/README.md)，7个范围逐字文本/SHA和31合成输入。G9渲染窗口期间不启动编译/批量fixture，当前`not-executed`，golden待实际执行。排序/全文/日期时区/日历/全库连续天数/新稿上一篇/0起标题篇序均给确切源行；新header必须能表达pinned/createdAt/categoryId及旧preview/contentFormat适配，不凭新字段名改变语义。旧回收站查询未存在、空稿过滤跨层边界与DB stub未验均明确，不称新port已实现。

Sol只读清点完成，证据[调用链与最小adapter](../outputs/2026-10-19-android-shared-import-ui/diary-adapter-audit/call-chain-and-adapter.md)；原列表/编辑/媒体仍由Java legacy/Product库持有，不因candidate-v3.1已验shared IDB导入而自动贯通。执行方案已回写原[Android runtime契约](ANDROID-SHARED-RUNTIME-V1.md)，不另建权威。UI owner继续独占QA8 MainActivity/editor/host/stage/5554，本清点未改产品/构建/设备。

前端最小接线是原native列表与editor/截图UI的数据adapter；backend公共data补有界listPage/本机索引查询统计/按需read、完整Entry草稿、localAck/create-local依赖与原件持久sink。列表建议默认40/最大100/≤256KiB，单行不得含正文/history/full searchText，查询游标绑定index revision；这些为待双方定稿的port需求，不是现能力。禁止为native兼容复制shared Entry到Java Product双写，禁止全量正文list再slice。HTML/Markdown/canonical正文与独立附件的本机完整阅读/编辑能力、localRevision替换旧服务revision ACK，是必须补齐的真实门槛。由root统一向backend会话发问题，代理不自行抢公共文件或自造协议。新localAck源码在变，冻结data61边界仍仅已有项显式sync:false；新建/连改/晚ACK门槛待新freeze独审。

2026-10-19用户在「安卓后端」明确：另一个会话同时完善安卓前端，双方维护开发文档、互通接口与状态，可以合作并发。此授权覆盖此前不发跨会话消息的旧阶段限制。参与会话「安卓ui」与「安卓后端」均在D盘共享工作区；2026-10-19已向前端会话送达后端进度、文件边界、设备隔离及location兼容意见，回复与新增需求持续写`ACTIVE-SESSION-COORDINATION.md`。

## 文件与接口

2026-10-19最新用户要求优先：只思绪日记、随想会话、朝花夕拾和未来AI/机器人互通，电脑便签不要求；PC/Android同一server/同组业务数据/同等读写，仅出口不同。会话置顶/归档/手工排列三项已明确全部跨端共享。Android新建须与PC稳定会话身份/列表对应，资料与程序设置不得缺项；源码/离线可建房不等于共享会话已完成。先核查既有正式业务后端再补桥，不能要求前端切独立只读来源库充当正式服务器。当前UI022继续自身冻结基线，后端不改其页面/共享UI文件、不控5554、暂不安装手机；[接续范围](COMPUTER-COLLECTION-CONTINUOUS-SYNC-2026-10-19.md)记录持续更新。

| 所有者 | 范围 | 共同修改规则 |
| --- | --- | --- |
| 安卓ui | editor/QQ页面、样式、交互、媒体选择/显示、MainActivity与LocalStore的UI接缝 | 修改Java/UI接缝前列出字段/方法及冻结原生基线；不覆盖后端候选 |
| 安卓后端 | ProductSeedFile/SeedInstaller/PayloadReader/Repository/DiaryStore/Transport/DownloadQueue/UiBridge数据方法、src/server/sync-product、数据覆盖与种子/同步契约 | 不编辑UI页面或混发前端APK；接口变化先文档并告知前端 |
| 共同契约 | Entry字段/ID/时间/refs、location/place、媒体压缩原件身份、种子和写入owner | 请求/响应、持久归属、旧数据兼容、失败/重试与未验边界一致后各层实施 |

`ProductUiBridge`是固定数据控制器，不是UI页面所有权。`LocalStore`是共享生产数据库接缝，涉及投影/事务的修改由双方先核对，不能为显示便利另造同步数据库。消息仍legacy单写，禁止根据新后端候选存在而自动切生产owner。

电脑服务独立发布，手机前端依旧使用版本化v1协议和catalog能力协商；缺少新能力时保留已有本地使用和数据，不要求重装APK。手机本地文件/SQLite引擎编译进APK，首次集成新引擎须明确合并发布，不能冒称可远程热替换。程序/AI插件仅保存类型、参数与绑定，通过固定API调用；不把安装APK、下载执行Java/JS或自动清空状态作为服务升级手段。

地点当前事实：ProductDiaryStore.EDITABLE含location，LocalStore列表投影保留location/place；桌面domain.entries现行location是字符串（上限100）。前端可修编辑准备白名单的已知拒绝；手填名称、定位权限、坐标和地名不得混为一种字段。未来结构化place须独立兼容契约；地点修改不重置正文时钟/canonical身份。

2026-10-19前端已回执接受分工，022(code24)将以021 release APK 274478df及其native stage为基线，只叠显式UI白名单；当前尚未构建/安装。前端已将location加回编辑白名单，按现有字符串契约保存。其拟新增默认标题规则/可配置空白提示、全局/篇级40%图片宽度、工具栏顺序；后端确认可保留`shiye.android.diary.presentation.v2`整个命名空间及未知新增键，不按UI白名单重建。当前该值实际在WebView localStorage，尚未自动进入日记库或种子，需要后续显式逻辑快照收集；不能把“能够保留”当“已导出”。读取后再保存应merge未知键。篇级视图覆盖按稳定entryId，单图覆盖按occurrenceId/blockId；现有body.widthRatio与本机视图覆盖分开，若新增Entry字段先明确dirty/save/canonical语义再接后端。

## 设备和构建

前端独占Magic7适配模拟器`emulator-5554/Shiye_API_36`，本轮基准1264×2800/632dpi/font_scale1.3；后端不操作该AVD。后端独占`emulator-5580/Shiye_Emulator_Repair_QA`，480×800/160dpi/1536MiB，仅原生SQLite/HTTP/文件合成测试，不能当UI尺寸验收。

后端已停止/卸载真机自有`dev.shiye.syncqa021`、移除19421手机转发；QA脚本在任何ADB前拒绝真机并校验专属AVD名，同hash APK跳过安装，安装失败不自动重试。不得将APK安装、插件安装或更新加入应用启动/同步重试/恢复生命周期。手机正式包与用户数据由明确的最终部署任务处理，双方不并发安装。

前端冻结UI候选时使用已验021原生基线，再只叠加本会话明确原生改动；勿直接调用旧stage-sync021全量复制共享Java。021基线产物`outputs/2026-10-19-android-sync021/stage-manifest.json`及`tmp/android-sync021/stage/native`要核对hash，不能改旧目录后冒称基线不变。后端新增源码尚未进正式APK，最终合并需双方约定新候选、依赖清单及核心回归，不由某一层版本号推断已集成。

## 当前后端交接

UI022新增单图继承sidecar已定稿：`shiye.android.diary.image-width-modes.v1`为对象`{version:1,rows:[{entryId,occurrenceId,mode,baseline,explicit}],...未知顶层键}`，见[单图宽度契约](ANDROID-022-IMAGE-WIDTH-PRESENTATION.md)。后端未知namespace对象保真能力可承接，尚未实际收集/应用，不称跨端已生效。前端另提示候选payload wire仅_product，默认标题日期/分类篇序不能据未解引用信封推算；后续合并须提供绑定payload hash/revision的可信本机索引或有界验证读口，安全占位不能被改成错误计数。此为待接门槛，UI022仍冻结021、不包含新writer。

UI022最新回执补充：`shiye.android.diary.entry-image-width.v1`是最多100个{id,width}的数组，后端候选已支持namespace根数组并保持类型/顺序/未知键；全局`shiye.android.diary.presentation.v2`仍merge保留未知键。按entryId+occurrenceId的新增单图继承sidecar键尚待定稿，后端未知namespace保真可承接，未捕获前不称可迁移。location保持<=100字符字符串，临时坐标展示不变canonical；正式阅读图全宽与编辑查看器由前端负责，不改变后端媒体原件身份。

2026-10-19第二轮候选已接三类来源snapshot受控入口及原生大正文显式写口，契约见[SOURCE-SNAPSHOT-INGESTION-V1](SOURCE-SNAPSHOT-INGESTION-V1.md)与[PRODUCT-PAYLOAD-WRITES-V1](PRODUCT-PAYLOAD-WRITES-V1.md)。来源资料只读保真，现有chat业务口保护该owner，普通邻居房保存只提交自身；settings命名空间尚未由实际WebView自动收集，电脑完整覆盖仍false。大正文需catalog支持strict-base-revision与新固定桥显式接入，原页面/默认DiaryStore仍沿原路径；前端022继续冻结021原生，不能把候选能力当手机已启用。独立后端QA不会发布UI APK或改5554/手机。下段“大正文写口待接”为上一轮阶段，最终本轮验证与启用状态见[本轮记录](BACKEND-SOURCE-SNAPSHOTS-2026-10-19.md)。

固定v1协议兼容、.syseed/ZIP流式读取/校验、resolve证明、同库原子安装、outbox与业务命令保留、墓碑/通用原件、大正文只读解引用已候选验证。设置/模板/快捷键/程序参数及未知普通根字段以只读兼容profile保留，不自动执行/覆盖本机偏好。电脑完整来源和PC持续增量登记仍有缺口，coverage明确false，禁止UI显示“已全量同步”。大正文编辑重打包上传端口仍待接，读口`payloadReadOnly`/`readOnlyReason`不可忽略。

契约与证据入口：`BACKEND-DATA-COMPLETION-2026-10-19.md`、`PRODUCT-SEED-API.md`、`PRODUCT-SYNC-API.md`、`ANDROID-PRODUCT-SYNC-CONTRACT.md`。前端最新18项实测需求见`ANDROID-022-PHONE-DIARY-FEEDBACK.md`，不能用本轮后台测试替代其UI验收。源码、编译、独立测试、模拟器安装、手机部署、正式资料启用分别回执。

## 2026-10-19 同库主链第二阶段（进行中）

共享目录/日记/程序参数已由两个客户端贯通原HTTP，含未分类空房原ID、20位字符串、pin/archive/order、CAS与unknown clientMetadata。独立WebView偏好新增sharedClientPreferences同库key-patch/CAS实体（四固定scope），不是readonly来源快照。原件固定read/begin/chunk/complete已接native鉴权桥与JS流式校验，缺旧原件去重409保留新文件。snapshot/pull正在补字节上限/大实体分块，日记大正文改为离线Blob＋小ref命令后复用原Entry路由；未验证完成前不称可迁全部资料。

PC新增持续目录data port已7项实际worker/HTTP验证；安卓显式共享bootstrap/source/目录渲染已候选，默认legacy不变，UI022冻结资产不混入。13固定native口（新增entity/read）在集成，先前29真实Android及49host-Java证据仅按各自覆盖范围复用。正式指针/服务保持，无手机安装/5554操作。性能3150篇合成仍有保存增量成本，中位约190ms对比未启用约80ms；热pull与按会话ID索引避免全正文读取，不把此当真实长期性能结案。

