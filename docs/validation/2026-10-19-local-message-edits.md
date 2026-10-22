# 普通消息编辑原owner域候选（2026-10-19）

最新状态：下方旧401a域冻结已被独审发现历史ACK P1，不可接入；修复0230窄冻与后续actualservice 786a冻结分别待审，不能套用原16/38自测或其他已审包。原记录及失败证据保留。

Sol执行，待独立Sol高审核。本批仅新domain及测试，不修改service、business-client、diary/directory、Entry routes、worker/UI/MainActivity。旧signedoffline61、backend149和正式chat-reedit2不变，不套用其既有审批。

冻结目录：`outputs/2026-10-19-local-message-edits/candidate-1792445465815`。`manifest.json` SHA `401a95ed36011bdfb7ec36b4658a2be0c7247a2ab07b4912e70c6014a399f4fd`，70个源码/测试依赖及静态import边。只复制源码，无业务数据/凭据。冻结工具 `outputs/2026-10-19-local-message-edits/freeze.mjs`，复制前再次核原源未变化；不是后台可部署运行包。

| 文件 | SHA256 |
| --- | --- |
| src/server/domain/local-message-edits.mjs | 623a75b0653e03199c65936b3c3cd52715e9657ed1ddf9e515e0d83fd892ce0d |
| tests/local-message-edits.test.mjs | 8f3016b27fbe2ffa3be758376a686f5d71a077a618dfed2251ce20119fa56a28 |
| public/shared/shared-edit-clock.js（复用未改） | 686528491297be4fd58d0238961ea5e8f1ad061cd44a57d33906bfce47aa87e5 |

在冻结目录运行：

```powershell
node --test tests/local-message-edits.test.mjs tests/shared-edit-clock.test.mjs tests/chat-journal-replacement.test.mjs
```

38/38通过（16新域＋10原HLC＋12原replacement）。实际输出保存在冻结目录 `frozen-tests.log`。新增两源的ESLint及Prettier check通过。未运行无关全套。

新增反例覆盖：实际JSON owner COW提交/冷重开；原sentAt/位置/引用/邻居保持；两种到达顺序并发与同毫秒稳定tie；exact当前base时clock回退、设备wall回拨但HLC递增；未知base/伪造creator及revision/自报parent/同op异内容/跨root复用拒绝；可信外层op、device标签不提升self/owner/source权限；旧无stamp及既有legacy替代链仅exacthead初始化；Entry revision不当message base；程序作者和改引用拒绝；新root终态与迟到edit/重放；旧root撤回alias不误删新head；旧currenthead单撤回/显式reedit造成外部链未知，持久unknown-stale而不覆盖；独立人工投影变更保持；真正JSON.tmp写失败时消息/ledger/shared log与disk一起rollback后同op可重试；sourceConflicts与嵌套history撤回同commit清正文；超长/缺原件/未来时钟在撤回前拒绝；localhost真实HTTPfixture并发/ACK重放/重开及碰撞409。

HTTPfixture仅 `tests/local-message-edits.test.mjs` 内临时server，调用实际createLibraryStore/commit domain，固定授权scope由测试拥有，wire op从独立header传入；不模拟产品已有鉴权通过，也不宣称产品fixed route已接。实际service还需原鉴权给可信context、commit后映射unknown-stale的409、注册能力与describe/head投影；客户端还需clock/outbox/私有恢复history同IDB事务、同步撤回顺序与页面读写验证。受控legacy显式重新编辑ledger reset/head识别尚未接。本批没有部署/安装/正式读写或设备操作。

## 历史ACK P1窄修

独立原例 `tmp/shared-business-independent-review/independent-message-edits.mjs` 第1项，实际失败日志 `outputs/2026-10-19-shared-business-independent-review/independent-message-edits-first.log`：A提交→B提交→重放A，顶层operationId为A但head/version/base却是B。修后每op存固定committed映射，currentHead另列当前权威；terminal:true优先返回withdrawn/base:null，历史操作仍不复活正文。新增定向测试覆盖applied和superseded晚ACK、冷重开、后续rootterminal。

正确窄冻 `outputs/2026-10-19-local-message-edits/receipt-fix-1792446892416`，manifest SHA `0230e7a05a10e738a484ea39ada98323850889fe91c4fe107ea1318639b3fd5d`。只以旧70冻结为基，覆domain/test两源，其余68原SHA；工具 `freeze-receipt-fix.mjs` 不读live。冻树39/39见其 `frozen-tests.log`。先前f3c冻结 `candidate-1792446459246` 误抓live localfirst directory第三依赖，已承认冻结工具范围错误并撤回窄审资格，保留漂移证据，不冒称原相邻全同SHA。P1窄冻不包含下面新协议/actualservice能力。

## actualservice与metadata升级独立候选

新冻结 `outputs/backend-runtimes/20261019-message-edits-1792447465520`，153生产源/424相对依赖边，manifest SHA `786abbd316a79058b1c4334da7bde60c772579cf197ab72c8c7c4b6eeed5c84d`。组合固定approved149（633399b…）＋localfirst第三冻（c25201b…）的service/directory/entries三overlay，再覆本scope service/replication，并新增domain/protocol/projection/已审同SHA clock四模块；没有抓data152或query/client中间源。`freeze-service.mjs` 对approved源逐SHA、owned复制前后防竞态，未把live其他文件补进闭包。

| 新批source | SHA256 |
| --- | --- |
| domain/local-message-edits.mjs | 9b29abf8780e741c22dfe3f51556c411c82f920b3464a1951c493bd1aed42c3a |
| shared-message-edit-protocol.js | 34a0a11196eb82ec66dbc78908aa272ea7bb0b3192cc7efc1d28a14f688ec2c2 |
| shared-sync/message-edit-projection.mjs | 36fb1e9d3814e83b7b895b6ce06497b7f342353c19de4beab0ea0f6c91489169 |
| shared-sync/service.mjs | 12128a753fc875002eac9a8177de2ec6d03c980676c8209653dc15e92b296cc2 |
| shared-sync/replication.mjs | d0030cb1ebfdf56738037bc0a41a380b9600dcb5b9476bfa7a702c4bd1868e35 |

冻树运行以下53基础＋5升级/回退直接场景共58/58，日志 `frozen-tests.log`；ESLint/Prettier对应七源通过。旧原例失败、修复与必要相邻分批保留，无设备/全库压力回归。

```powershell
node --test tests/local-message-edits.test.mjs tests/shared-message-edits-http.test.mjs tests/shared-business-http.test.mjs tests/chat-journal-replacement.test.mjs tests/shared-edit-clock.test.mjs
```

新12项实际HTTP/投影场景包括：产品createDiaryServer固定command路由（不再仅fixture）；全局回执重放仍区分历史提交与currentHead；真实Bearer缺失401/撤销401、重新配对及新port保持writerUUID/旧wire；旧alias不误撤新head、新rootterminal遮蔽旧ACK；外部单撤回409前诊断持久且不添成功回执；hidden/deleted/draft父篇只给空head墓碑；程序不可self编辑、伪base不落盘；signed full读包/真实验签→断服务→本机IDB写入/关闭重开→公共builder算实际revision base→原服务真实edit通过；投影不改原db、50 roots仅一次entries遍历。

最初153冻结 `20261019-message-edits-1792447108357` / 6d29…遗漏旧index升级。自查真实approved149旧index→新source初次snapshot实际409 `SHARED_INDEX_OUT_OF_DATE`，失败保留 `outputs/2026-10-19-local-message-edits/upgrade-before.log`；该初冻明确弃，不可发布。

最终marker迁移：flatten仅 `_messageEditProjectionVersion===1` 才附clone editBase/readonly heads；undefined/0仍legacy。原owner同一COW事务把next切1、首次禁旧fingerprint快复用，previous保持旧投影。全部shared info/read/command/seed先await单次migration gate；写失败marker/index/body全回滚。未启shared不造身份。新增5场景实际从精确approved149 frozen模块建立原index/真实注册signedseed，验证原library/epoch与entries逐字段保持、首批并发info/snapshot/preferences写/export后seq只加一次annotation与一次pref、旧注册包resolve与旧水位delta仍同身份、真实JSON.tmp写失败后原bytes不变且可重试、legacy-only请求404不生成index/marker。历史夹具依赖exact approved149 artifact，`test-manifest.json` 明记fixture manifest SHA；测试只访问该冻结源码，不访问live替代。

回退约束：marker1派生index以后，旧无projection的149包不再是same-schema安全回退。新source支持可信启动配置 `SHIYE_MESSAGE_EDIT_WRITES=0`，info.messageEdits.writeEnabled=false；新edit/withdraw返回503 SHARED_MESSAGE_EDITS_READ_ONLY，describe/snapshot/head/base保持，原alias不改。已在marker1+已有edit ledger的实际服务冷重开验证，禁止新写时原JSON不变。此同schema fallback仍须随本候选独审后才能用于维护；没有宣称旧149可直接回切。

当前已完成源码/真实隔离HTTP/合成signedseed及小IDB边界，**仍待独审**。客户端writerUUID/HLC/op/outbox/history同IDB事务、双runtime/native action白名单与实际页面尚未接，也未真实资料整包/手机/5554/正式部署。所有后续合包另冻，不以此source切片作完整业务结项。

## 客户端同IDB原子实现候选（2026-10-19，未部署）

上段服务786a已独立通过；本次不改服务源。最终客户端为 `outputs/2026-10-19-local-message-edits/client-1792450149596`，manifest SHA `ddc740abf119fcd747c2e7c5e45cb82c1f115c22be87a9efc1d491483a05743e`，66源/22Java。基线是已审query63 `diary-query-final-client-1792449420689` / a360f6…，明确覆已审knownrefs `data-knownrefs-1792445885744` / a2e96f… 的shared-seed.js；其余九源仅HLC、inbox/seed终态清理、Android directory ACK及固定command白名单。`tools/freeze-message-edit-client.mjs`逐SHA读这些冻结依赖，未读并行diary-index/live prefs或服务新scope。旧64/66中间冻只作过程/失败证据，不能代最终候选。

`shared-message-edit-client.js`把安装writerUUID、HLC snapshot、immutable outbox wire、原时原root后继、私有history、原media refs放在原storage的一次IDB写事务；无HTTP describe先决。`source.edit`/`withdrawRoot`同源供两端，旧单消息withdraw保持。新增附件明确阻塞并保草稿；能力缺失可显式retry-unchanged原op，禁legacy fallback。终态主动删除旧待发wire并保存SHA/body-free terminal receipt，不改wire再发；readOperation明确status:terminal，区分本机意图与远端证明。旧墓碑剔replacement边的合法接收仍按唯一active self的明确root及editBase认当前头，未知外部链保持冲突。

真实Chrome发现seed激活后仍保留staging原正文，故本次必要增加shared-seed-client窄依赖：终态和旧包新stage同tx清匹配原副本，包只记私有localBodiesRedacted；resolve继续原签名/identity证明但强制权威snapshot+delta，绝不将删正文的hash行冒作完整baseline。相同message跨两个包按package分组脱敏；seed最终inbox apply复用terminal fence，原件handle不删除。manifest/签名/native接口不变。普通乐观文本只重建当前active journal的search/preview，与已审query派生索引同tx；其既有有界投影超限仍原子报错，不伪全文成功。

最终证据：

- `frozen-tests.log`：51/51（15个新真实approved owner HTTP＋fake-indexeddb端口事务场景，36个普通enqueue/source/inbox/HLC直接相邻）。含签名首导离线、双controller原子钟/回拨、整tx abort、既有media保留/新media阻塞、相同wire重开/迁URL重配对、历史ACK/currentHead分明、root终态/首个空墓碑、CAS、canonical slot、runtime两次离线create/重开同ID不重复、query派生及两个旧包staging清理后snapshot。fake-indexeddb没有冒充真实浏览器磁盘。
- `seed-adjacent.log`：6/6，只选本次改变的seed importer直接邻近：签名首导、pin/baseline事务abort、offline quarantine、同包原件handle重导、旧同水位评论撤回、generation fence。不重复crypto/native ticket全矩阵。
- `browser-probe.json` / `.mjs`：6个真实Chrome持久profile/真实IndexedDB边界：无服务首导完整签名包；真实事务abort；两页同库writer/HLC；关闭整个Chrome进程后断网重开正文/wire/writer/独立draft；同wire接实际786a服务；root终态清含seed staging的全部匹配私有正文。最终script额外明确读取冷开本机正文，仅为补齐此必要断言重跑约4秒；最终报告位于本候选，`verify-freeze.json` 同时核66源及双bundle。非真实WebView页面/设备。
- `java-build.log` / `java-probe.log`：真实javac/java编译运行固定transport，9个已审local-first/message动作逐wire深比较且Exchange计数9；3个未知含错别名均在Exchange前拒绝。JNI/手机/UI未运行。固定method仍16，不拿9动作当新增9native口。C#无action名单、本次字节保持。
- `verify-freeze.mjs` / `.json`：66源、15夹具、双bundle闭包与逐字节重建。Android bundle `095e3d978782557b34f66319947a900a370c5f7c59dce53d3575ccfa33c7e181`，PC bundle `206d5a23575369fe95140a73e017c4fbfdf2a040f594e19e17f1475634425255`；ESLint/Prettier对应九源与新test/tool通过。

失败保留：`runtime-inbox-before.log` 为仅退旧runtime handler与移除后继terminal fence的隔离变体，复现SHARED_CREATE_PENDING和旧inbox正文；`chain-seed-before.log` 把精确旧728e…候选三个模块覆到最终fixture，复现后继被误认新root及seed staging撤回正文仍存。对应冻结源码和脚本均保留，不改独立审原证据。初次Chrome测具把失败的异步info尝试也计作“完全无网络调用”，已改为只对首导作该断言；离线编辑允许本机ACK后的同步尝试，不等待或回滚本机成功。

复现：在候选 `qa` 执行 `node --test tests/shared-message-edit-client.test.mjs tests/shared-business-client.test.mjs tests/shared-chat-source.test.mjs tests/shared-inbox.test.mjs tests/shared-edit-clock.test.mjs`；候选根运行 `node verify-freeze.mjs`、`node browser-probe.mjs` 可独立复现（后者仅新合成profile/临时server，约5秒）。Java编译参数和源均在handoff，SHA见data-manifest。**施工方候选待独立审**；源码锁释放。未接真实PC/Android页面编辑入口、未验3.33GB/设备、未部署/重启正式服务；旧兼容未启shared继续旧路径，新stage媒体编辑仍明确阻塞。本轮不扩大已审message server marker1 scope。
