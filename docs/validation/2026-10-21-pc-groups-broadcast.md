# 2026-10-21 PC分组、折叠与广播验收记录

状态：**用户明确暂停（2026-10-21）**。已停止本PC开发/新测试/构包/审核/维护执行/部署，仅必要自有私有资源清理及交接。正式仍UI57／4a97，本轮未新启用；[准确停止点](../../outputs/2026-10-21-pc-groups-broadcast/PAUSED.md)。最新backend第10仍HOLD、第11仅未冻facade清理且root问题未修/验；U59组件已独审未整包启用。下方各“实施中/待审”均为过程，原六冻及其overlay准入不代最新多作者/SourceRef/最终整包，不自动恢复其他owner。

本轮续增U59转发**会话头像**：实际Avatar已有稳定data-peer-id，原workspace图样式仅覆盖LeftColumn，medium作者私有扩展targetpicker/已选chip并复用原小图生命周期；前端wrapper另有visibleIDs导航hunk，必须窄合而非整文件覆盖。该组件已获同一非作者high准入：[独审报告](../../outputs/2026-10-21-pc-groups-broadcast/avatar/review/independent-review.json)SHA `82bb267af19ca884a0466f66b9467b19fd53414be96aebfeb50a999985e14b76`，准确before `51c1c02b…`→after `deaf30c9…`。独立实际非当前房目标/勾选chip、192px红蓝blob解码及像素、异步换图/撤图和旧URL退役、972/460目视/0错误通过；侧栏width0不当可见侧栏证据。仍待最终候选/包/维护审核与部署。群/分组成员四/九宫格头像先列原会话管理后续设计，未实施或代验。

最新人类补充要求self、机器人/程序/AI平等发言且接口一致，所有作者群消息均投递到全部接收成员会话，并区分真实actor与广播来源。已回[原会话管理](../CHAT-ROOM-MANAGEMENT-2026-10-17.md)及两端原需求/API；下方第六冻与5项Enter通过只覆盖此前本人场景，不覆盖多actor。前端已找到写死`out:true/fromId=1`及wrapper漏透传`row.actor`两处，后端统一登记actor/send/feed/控制及必要reader后继正在对齐，新准确候选须另审；暂停最终冻结/启用准入，原通过/失败证据保留。

现有revisit自动history输出绕普通send而只写实例deliveries，源会话以SourceRef展示，尚未广播。人类已答保留来源引用、原文隐藏或删除后不可读；backend获授必要新delivery同ledger/来源重验后继，保原history owner、不复制独立正文或回填旧历史，最终需实际provider输出实证。旧六冻本人/C#桥后继`http-ui-1792571924755.json`已8项通过（嵌套多对多、批量2目标、实际Enter、唯一root/每目标一delivery reservation、气泡回执刷新及无pageerror）。准确边界：该私有server未autoStart runner，两目标仍pending/attempts0、画面0/2，未验证真实目标feed显示/原件；此前口头“各收到一条”已纠正。真实drain及目标投影/原图SHA待同链后继验证；仅该旧scope有效，不代多actor/provider通过。

## 原需求与范围

沿[会话管理](../CHAT-ROOM-MANAGEMENT-2026-10-17.md)、[PC主需求](../CHAT-UI-OPTIMIZATION-2026-10-16.md)、[人工清单](../CHAT-MANUAL-CHECKLIST.md)和[既有本人编辑/恢复承诺](../CHAT-MESSAGE-REEDIT-2026-10-19.md)。共享字段维护在[目录契约](../SHARED-CONVERSATION-DIRECTORY-V1.md)及[消息API](../CONVERSATION-MESSAGING-BACKEND-API.md)，Android沿原F27执行单分记。

- 同一会话可属多组、组可嵌套；删除只解散本层并提升子组，不改消息/草稿/其他关系。空未首发会话按原canonical ID登记，不另造来源或切普通房owner。
- 退出重开记住本机展开/置顶保留；置顶栏按稳定ID计全部置顶，含仍显示部分。会话列表的三组alpha及折叠几何沿共同F27，日记渲染器不在本轮改动范围。
- 用户已明确广播按组批量加入当前会话，之后群独立增删成员；本机耐久接受时固定当时名单和可信成员代际，不动态订阅目录组、不补历史。
- 真实群composer，原条/原件/引用/outbox同shared事务ACK，TL仅可重建投影；单跳、稳定目标回执、幂等重试、明确部分失败。派生只读并可定位原条。
- 确认编辑才旧墓碑＋独立版本后继，原时原位；撤回精准脱敏历史，不清无关记录。恢复以本机副本显式新op/新root-unit，旧withdrawn实体永久墓碑，原名单/原时及前驱/CAS防叉不变。

## 已准入的共享内核

**第十冻仍HOLD／终态内容未完整脱敏**：`c7da…`／`393c…`同171源、相九冻只facade，独立unknown-B状态复活反例已过；但新真实HTTP＋IDB反例发现gate仅清顶层正文，returned row.source.available=true及source.markdown仍含历史正文，rebuild会再持久该预览。原件`backend/review/tenth-publication-terminal-content.log`及`publication-terminal-content-1792575922430.test.mjs`已交作者继续唯一facade窄清，后继仅复内容清理/cold/旧source回执，不能仅state=withdrawn便准入。第九报告`ninth-adjacent-review.json`SHA `d9d7db99fa24b7ab8f3e380b5a167e66ae3fe6e73376189aae89713e85951bf0`记录前轮P1，原失败均保，未重5/8/9矩阵，正式未动。

**第九冻仍HOLD／新增P1**：准确`candidate-1792575445827`，main `8b86c01db08b604e43ca084703f38da5a382711bc4cbd6f936414c9c1808976c`／fallback `0161b8ec0d806b6cb6a682287947a096f69951b33b7b735fff9ed2f381781224`，根fullSHA匹配；同一高审核171及相八冻两源、publication/restore/cold实际测试通过，七冻原误伤合法同ref P2已关闭。新增独立actualHTTP＋新IDB反例：已知某publication withdrawn(seq28)后，读另一个同ref合法auto写available(seq28)，再读从未缓存B目标的旧feed(seq27)会把该terminal发布复活active。原件`backend/review/publication-terminal-adjacent.test.mjs`及`ninth-publication-terminal-unknown.log`已交作者。后继须独立永久publication tombstone优先于可逆source entry/reference水位，只复此反例/冷开/targets及最终identity，不重原5/8/entry矩阵；原失败不改。第九冻/overlay/前端/维护/部署均未新准。

**第七冻独审HOLD（新增真实反例）**：171身份/18delta及作者5项独立隔离重跑通过，仍不准入。`backend/review/seventh-withdraw-scope-valid-fixture.log`实际HTTP＋同IDB反例显示：撤回一条self SourceRef引用后，readSource错误地把该publication终态记为source-wide reference不可读，client.readFeed抹掉另一个仍合法的自动revisit原root预览，而server仍active。必须把publication终态与source entry/reference可见性水位分开；作者窄修后连目标program read SDK相邻另冻，同一高审只复此反例/直邻与最终identity。首dbName夹具失败单列保留，原五项不重无关矩阵，正式未动。

[中间独审报告](../../outputs/2026-10-21-pc-groups-broadcast/backend/review/authors-history-interim.json)SHA `fb26a6a3cf1e81b9d23e483bd19ab2fa5148ec9512fd4109d45ce7084f608063`已由根复核：状态HOLD/P2。后继第八冻`9bf8…`／`c508…`同171源、相第七冻仅5源；目标自身program真实凭据读全文/原图、foreign locator拒及隐藏后旧available回执防复活已独验通过。另独立实际HTTP＋新IDB验证未知旧文字/图片页→entry隐藏水位拒→冷开脱敏→新visible恢复（原seq24→27→30）。这关闭目标读取相邻，不关闭publication误伤问题；第九冻还须复其窄修及前端指出的restore本机临时元数据，未授新UI/overlay/部署。

新增多作者/SourceRef第七冻目前**待独审／SDK微后继**：`candidate-1792574765950`，main `4dd14ae0877f6b665e552b86df67dfed586ee8b500a0fd68353c7e9d1199747d`、fallback `fcaf146b90b2e00b9320552b606b49dde81b0847d495e27f7a5c9109de5c4fba`，根已复核两fullSHA，171源/相六冻18delta。准确[WIRE](../../outputs/2026-10-21-pc-groups-broadcast/backend/candidate-1792574765950/WIRE.md)、delta及frozen-incremental-tests.log绑定作者5项测试，不冒充非作者通过。新actor及history-ref分别新feature/marker，真实凭据同send/控制ledger、公共SourceRef引用与新provider同事务、源/目标/媒体读取、隐藏/复显/删除/同篇多段缓存与seed门槛均在本次范围；同一高审已接。目标自身program的定位read SDK尚补唯一相邻另冻，新activation overlay也须另审。下方六冻及其overlay的原准入只为已过旧scope，不准第七冻或最终启用。

准确候选：`outputs/2026-10-21-pc-groups-broadcast/backend/candidate-1792567636819`，从正式4a97闭包派生，只接明确的shared storage/media依赖及本轮必要schema seam；未混入暂停数据QA/持续ingest/外观设置业务。

| 身份 | SHA256 |
| --- | --- |
| main manifest | `8de0c240c13eeb8e2da9c64020b6784a2cc385b72e3999d4e71f91eb3cda111a` |
| 同schema fallback manifest | `648be0c15d6ce65ef5f74d127ea65f7a0aa9dee60b03b2377e8c2862710db70c` |
| 非作者内核报告 | `ebd43d4fb0f59c040d60762182a479b6c415ca2648edc6b135eda9516759dd51` |

[冻结入口](../../outputs/2026-10-21-pc-groups-broadcast/backend/current-review-locator.json)、[第六冻WIRE](../../outputs/2026-10-21-pc-groups-broadcast/backend/candidate-1792567636819/WIRE.md)、[独审报告](../../outputs/2026-10-21-pc-groups-broadcast/backend/review/kernel-independent.json)。168源中相对第四冻6变、162复用；fallback成员同SHA，仅manifest禁组织新写。新restore另有`conversation-broadcast-restore-v1`／`_conversationBroadcastRestoreVersion:1`，必须连同原groups/null-entry/manual-cut能力和稳定loader一起核。

定向独立实证包括组防环/提升、同ID空房登记与依赖、真实HTTP＋shared IDB事务/原件及冷开丢ACK、媒体失败时无依赖文字先发、原条/派生独立后继与迟到终态、原名单/原时及恢复防叉/停用拒、CAS显式review/discard与旧UUID守卫、旧reader实际拒、exact selected fallback读200/新写503且库字节不变。另实测manualCut后的闭合篇原位恢复及第二恢复链。原通过证据按未变边界复用，未重无关整矩阵。

首轮同unit覆盖编辑、legacy撤回绕路、恢复历史正文泄漏/误删无关history、跨action幂等、迟到feed复活、CAS409后永久依赖blocked父操作等原失败保留在`backend/review`，后继准确反例已关闭；首测具IDB命名、漏配sendOperationId等失败单列，不伪称产品首次全过。

## 前端当前证据与待验

UI57准确overlay私有接续。已完成feature缺失夹具的真实页面早验：新列表渲染、普通Enter发送、旧后台不支持时提示、本机外观保存/取消及无pageerror；报告[smoke-feature-guard.json](../../outputs/2026-10-21-pc-groups-broadcast/frontend/smoke-feature-guard.json)。四个新增helper/component的定向语义及新增SCSS检查通过，非完整上游check:ts；最初Lang生成/必填props/Windows-import测具失败保留。

这轮早验没有实际分组/广播后台能力，不能代真实功能验收。后续必须对最终同源资产核：同房多入口/唯一草稿、折叠实际高度/锚点与重开、真实创建群/成员/Enter/图文到目标原件、完整string身份可逆投影、原条来源跳回、编辑/撤回/本机恢复取消与原时定位、慢本机ACK时关闭/保存保护、可见冲突复核路径及正常时不常驻恢复按钮。

私有准确第六冻HTTP＋真实compiled frontend/worker/IDB联调已推进到实际创建并打开广播群：`http-ui-1792570442088.json`的create/open及独立成员快照检查通过，`broadcast-create`和原composer Enter的`broadcast-send`均返回200，但输入框清空等待超时，仍属未通过的前端收尾场景；不得据200声称完整发送/目标原件验收通过。先前设置早于目录安装、按钮未随ready更新及测具异步ready断言问题分开保留，原早期日志不足以证明目录读取循环。电脑模式原MiddleHeader不渲染，成员入口接实际Composer动作栏，切房复用原refresh/loadAllChats路径；后继须复验同一Enter的唯一root/目标及ACK后恢复不重复发送。

该输入清空反例后继已定向通过：[http-ui-1792571068232.json](../../outputs/2026-10-21-pc-groups-broadcast/frontend/http-ui-1792571068232.json)，5项通过、errors为空，绑定报告内真实资产SHA。修复恢复原发送调度，Composer单独观察同batch每条真实shared本机ACK，而不把原action/API dispatch Promise当耐久回执；失败保稿并有界等待，另补投影期间ACK的dirty重读。准确报告核创建/open/独立成员快照、Enter本机接受及HTTP成功、广播不走普通legacy消息writer；服务完成后的可见计数、唯一root/target、真实C#桥、图文与恢复仍待后继准确验收，本次不外推最终UI或关闭保护通过。原超时报告和截图保留。

后继实际图文/慢ACK链[http-ui-1792574362983.json](../../outputs/2026-10-21-pc-groups-broadcast/frontend/http-ui-1792574362983.json)取得14个直接断言通过，但顶层仍为false：原PC拖入→原图→Enter，shared IDB事务锁在途850ms保说明并不回hide-ready，释放后才ACK/清输入/正常hide；图离线上传不挡后来文字，冷开同库Blob与真实HTTP服务器原件SHA均`4b43de22…`/15358B；两目标实际HTTP feed已有只读derived及同asset，补上早前仅reservation的边界。末项目标TL显示仍失败：所用旧六冻feed的伪`controlled-broadcast` actor被新增严格actor校验拒绝，不能为使测具通过而放宽身份。待真实actor新后继仅重受影响目标UI/来源链及必要相邻，旧报告/失败不改成整体通过。早期隐藏上游AttachMenu、英文菜单定位和误用.AttachmentModal而非真实.shiye-attachment-modal均保留为入口夹具失败，未产品forceclick或另加图片入口。

## 维护与正式启用

当前无正式源码CAS、运行指针/服务/库/key修改或安装/设备动作。必要后端启用片段见[BACKEND-ACTIVATION-FRAGMENT.md](../../outputs/2026-10-21-pc-groups-broadcast/backend/candidate-1792567636819/BACKEND-ACTIVATION-FRAGMENT.md)，只作准备材料，不含执行许可。

外层rollout旧marker1六源硬pin的适配组件已独审准入：`backend/activation-overlay/1792568445687`，manifest `99668a6329ddb8e142dd0212448937715c9823d3c1dd30eaa8fa21e4f5adcf29`；executor原字节`2d093216…`、guard`ac311f57…`、profile`18059a5b…`。[准确入口](../../outputs/2026-10-21-pc-groups-broadcast/backend/current-activation-overlay.json)，[独审报告](../../outputs/2026-10-21-pc-groups-broadcast/backend/review/activation-overlay-independent.json)SHA `2afc457ed2a07d4906d3c4916b34de1962994443b80434f4dfbb122b5322fb37`。

组件独验原拒→精确168×2受理、旧真实profile保持，以及错hash/路径/成员或重算manifest仍拒；外层只读import链已跑，未调用实际rollout。还原四个适配hunk后逐字节等于当前canonical guard `8c1994e5…`，保LocalSaveAck/closed0 FIFO接受分支及其余guard，不改六冻runtime/伪旧hash。两stable未装时完整plan仍在进程/连接探针前拒`GROUPS_STABLE_LOADER_REQUIRED`，这是预期保护，不是完整plan已通过。

最终维护作者仍须按准确组合plan复用原UI57正常保存/备份/runner停写排空/新loader先于新写/只读身份核验/后备份/恢复顺序；新marker后仅同schema fallback，不退4a97。组件准入不授停服/备份执行/切换许可。

最终UI、组合manifest、外层guard/执行器/维护plan及真实回执将在准确冻结和同一非作者high通过后追加。真实Windows登录、全DPI/物理逐帧、长期性能、Android实现/设备/跨端联测及暂停数据QA不由本轮内核准入代过。
