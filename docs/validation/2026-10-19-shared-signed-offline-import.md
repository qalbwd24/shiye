# 2026-10-19 signed full 首次离线导入数据候选

本批Sol执行，独立审批由Sol高另记。真实页面、3.33GB整包、设备、原owner正式启用均未验；默认Diary保存等待sync/localcreate缺口已交root下一scope，不用本批自验充全部页面本机ACK。

纯data候选`outputs/2026-10-19-shared-business-integration/data-candidate-1792443858794`：61源/22Java，manifest SHA`4049342476d981ca083e624ef56bcfd4be57081dae22f1d4aa04d785436e639e`。从冻结sources重建两bundle字节一致，61源逐SHA复核：Android bundle `e97d47342f7a16dde0e5cb1b2968d621f11ee3380c3f5f40015681ccf5457a77`，PC `5ba7399a46e36867e15a501d3d23d74d00da19c15e576a3a598d0e35548bcea3`；均实际导入检查静态inspect两个export存在。proof/frozen-rebuild.json保留复核。旧base59及ticketguard单文件59批保留，不套新61能力或审批。

最终接口和ownership见SHARED-SEED-NATIVE-V1的“signed full 首次离线导入API”节。新增shared-seed-trust.js私有验签品牌，WebCrypto Ed25519使用真实global平台，调用方自选crypto/true不能伪造；native仅真实平台不支持时小context Signature验证。static inspect完整流式成员SHA/签名后小summary，无runtime/实体写入；native成功retained仍UI owner，失败/cancel close一次后error.closed，非法UUID unowned不路由，close失败保原验证错并closeFailed/cleanupRequired、不伪closed。import接手后再全验/所有finally close。

v2 full两个requiredfeatures强制识别。显式TOFU指纹+完整prepare/真验签后，同tx pin+首次active baseline+feed inbox+原件索引+cursor；保草稿/outbox并按原pending规则rebuild。已initialized离线重导绝不覆盖原权威inbox，不比较feedRevision哈希大小，不用相同shared watermark复活knownwithdrawn。联网先同lib/epoch/key验证、权威delta和全部当前feed/redactions提交，再发送outbox。服务地址不进入库身份，换地址只换原生配对域，key不同只阻网络，不重置本库。constructor/status/本机读写可断网，无在线info依赖。默认rawDiary awaitsync尚未改，离线写证据显式sync:false。

证据`outputs/2026-10-19-shared-business-integration/signed-offline-af64f96d-a418-4918-8b80-e54fb9ed30ee`含逐源快照、SHA、client-regression.log/native-host.log/lint.log及结果。81相关Node全部通过，包含新20（runtime嵌套2项）：首次完全离线active、原件/稿/编辑outbox冷重开、两runtime构造0network+断网start/重建、同原Entry API续写；旧signed包与本机withdrawn同seq但不同feedRevision不复活；初次离线feed即读、联机先legacy撤回inbox commit再发offline entry-save；旧workergeneration不能覆盖新inbox；fetch期间legacy-only变化末次head拦截；同lib新key合法自签也拒pin替换、假WeakMap品牌拒；pin/base/cursor实际IDB txabort；同owner临时URL迁移保库/key/稿/游标。

host Java原生reader30项通过，目录`native-seed-e1b02077-2399-44f4-9a68-42c8f9db6be9`；新v2 parts/unknownfeature/downgrade/count/hash反例齐。真实Java console inspect→JS→IDB及原件close/reopen、Ed25519正反签名在import测试里；不是实际Android provider验证。Android36隔离harness仅源码编译通过`native-shared-20261019T205825586Z`；前一次JSONObject.keySet不在Android API导致compile失败，已改keys iterator，旧失败日志保留，不把host org.json通过冒充Android编译通过。无设备/安装动作。

构建/复现：`node tools/freeze-shared-clients.mjs`自动带新JS闭包/22native，不复制前端owned MainActivity/TelegramFrontend/DesktopPreview/023/PC renderer/i18n。journal/C#只有data seam观察快照；prepare/write-manifest只hash引用未复制。静态inspect/constructor/status不需要serverURL；Android file11固定口含sharedSeedVerifyAttestation，backend16不变；PC business12+auth4+seedwire4沿前批。C#未在本61批改动，其31/29/19证据按对应未改源码复用，不能称产品WebView或成品完整启用。

本代理已向root释放shared-business-client/shared-seed-client及runtime数据源码，后续localACK/编辑clock独立scope不要混入61冻包。独审发现问题须与新owner协调后窄修/另冻。原owner受控上线、真实全包磁盘预算/实际IDB、前端选库/信任/激活失败恢复/实际renderer/native provider由root和两前端接续。
