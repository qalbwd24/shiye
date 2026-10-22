# 随想发送后不可见：SF16 定向修复

本轮按用户最新要求独立定位、实现及自验；不再常规追问或转发调试状态，仅正式部署资源冲突时协调。需求继续沿 U02／原人工表／截图 SF16。ui50 精确候选已获 Sol 高独立审核通过、源码5目标窄回写，并已正常备份／标准升级／原生ready正式启用。

## 已确定的两处缺陷

1. 即时发送只用 `.Message.last-in-list` 查尾锚。实际撤回提示为 `.ActionMessage`，已有普通消息且撤回提示在末尾时，尾锚为空，追加事务持续返回；同时普通滚动写入仍被该事务屏蔽。
2. 本地确认前后，历史加载可能先推进最新消息身份。确认处理重新依赖“最新页”判断，随后删除临时 ID，却未把已显示临时消息的视口接到正式 ID。真实 IndexedDB 延迟 2.2 秒时，能看到乐观消息在确认后消失；全局 `byId/listedIds` 有正式 ID，`viewportIds` 没有。

修复允许实际 `.message-list-item.last-in-list` 成为即时尾锚，恢复锚也兼容提示节点；确认前按 tab/thread 记录确实包含 `localId` 的视口，原删除后把正式 ID 留在同一视口。不含原临时 ID 的旧阅读视口不强制加入。没有新增计时补滚、全局监听、数据字段、写入 owner、接口或端口；沿原消息身份处理。

## 证据与范围

产物：`outputs/2026-10-19-web-chat-improvement/`；脚本：`tmp/web-chat-improvement/sol-tests/ui49-private-two-room-send-probe.mjs`。

隔离加载旧私有日常 -20／测试 -102 的实际历史、日期及替代链，原件未读、媒体仅元数据、网络仅隔离资源。对日常最后一条实际消息作符合原格式的撤回尾条变体，经实际 ActionMessage 渲染。旧快照普通尾部本身正常，因此本轮是已确定的相邻反例，不能说完整复原了用户当前末条或证明全部房间场景已结案。正文不进报告、截图或外传；正式房没有测试写入。

| 报告（均在 `sol/`） | 观察 |
| --- | --- |
| `sf16-final-before.json` | 冻结 ui49，3.5 秒后不可见，gap143 CSS px；报告 passed 仅指采样完成，这是预期失败反例。 |
| `sf16-ack-viewport-trace.json` | 仅尾锚修补仍不足：写入延迟时临时 ID 在 viewport，确认后正式 ID 只进 listedIds，未进 viewport；失败保留。 |
| `sf16-final-held.json` | 最终同包、无诊断注入：实际 worker IDB 持有约2201ms，约38ms乐观首显，确认后同节点、末帧可见/gap0。 |
| `sf16-final-button.json` | 最终同包、无诊断注入：按钮约63ms首显，确认后同节点、gap0。 |
| `sf16-final-test-room.json` | 最终同包、无诊断注入：测试房 Enter 约37ms首显，确认后同节点、gap0。 |
| `sf16-final-user-scroll.json` | 最终同包加只读轨迹：延迟期间主动向上滚，确认后 gap256、跟随事务已取消，没有抢回底部。 |

这些时间是本次隔离正确性观察，不能承诺物理帧率或所有设备时延。原生激活、图片性能、原件、转发及其他未改功能复用旧范围，不重跑整套。

### 新鲜资料补证（实施方追加，同一冻结代码未改）

后台正常维护生成更新私有资料后，本会话自行只读复用，无再索取/新增正式采集。图谱 SHA `9e91f8040a04eb2068876a0909f5d2cbb2b1800124316cfd54435dbac2784848`，两房为日常331条、测试92条；本次**没有撤回尾条变体**，日常实际尾条584为普通 Message。仍不等于捕获用户当时的完整运行轨迹。

- `sol/sf16-fresh-original-before.json`：ui49在冷回放快速确认时正常，不能说只要该房就必现。
- `sol/sf16-fresh-held-before.json`：同一新鲜原始数据、真实IDB持有约2202ms；乐观消息先显示，正式585确认后不在DOM/viewport，虽gap0但不可见。证明仅看滚动距离会漏验。
- `sol/sf16-fresh-manual-down-before.json`：上述旧版失败后真实点击向下箭头，正式消息重新可见，吻合用户“必须手动向下”的操作反馈。
- `sol/sf16-fresh-held-after.json`：精确同包ui50、无插桩，同一原始数据和约2200ms持有，约53ms乐观首显、正式确认后同节点/gap0/仍可见。以上为实施方追加证据，不冒称独立重新审核；候选/源码未变，无需重做已批准旧范围。

## 源码、候选与安装边界

仅 `shiye-chat-ui.js` 和 `src/global/actions/apiUpdaters/messages.ts` 两处业务增量；另有 ui50 版本与入口缓存标记。沿 ui49 已审冻结源隔离 Vite 重编，实际 map 的 sourcesContent 与新 updater 逐字相同。`sf16-source-hashes.json`、`sf16-package-diff.json` 及 `sf16-delivery-manifest.json` 记录源码/资产；候选 `candidate-ui50-sf16`，manifest SHA `ea4a6cb07376d573fc3fb4d4d0a62c02c87dad52364f221b9a5ae91edf5dc004`。EXE、桥、旧程序与数据后端未混入候选。

JS 语法检查通过。首次从根运行 ESLint 对私有 TS 未匹配配置，该警告保留且不计通过；随后用原 vendor 项目 ESLint 配置及实际源路径对候选文本 `lintText`，0错误/0警告，见 `sol/sf16-eslint-effective.json`。实际编译及定向行为检查如上，不宣称全库检查通过。

独立审核见 `outputs/2026-10-19-web-chat-improvement/review/sf16-independent.md` 与同名 JSON：独立无插桩复现旧版 gap143，并独立验最终同包 IDB 持有2200.8ms时37.7ms首显、确认同节点/gap0；上滚不抢回。按钮/测试房为复核实施方同包证据，不冒称独立重测。精确源码、编译 source manifest 单TS差异、实际107加载资产及 frozen manifest 对齐。29个机器断言不是29个场景。

源码写回 `sf16-writeback-apply.json` 5目标均完成，保原始 SHA／即时复核／备份／原子 rename。正式维护资源已应数据会话必要请求暂交其独占；待一次归还回执后重新 status，再按原正常保存 ACK／备份／upgrade 安装，保护失败则保留现场，不强关。若后台维护成功且UI仍退出，已请求直接交本会话安装ui50，避免先恢复旧版再停一次；失败时原恢复保护优先。侧栏红名、输入区修复等后续增量不混本候选。

后台维护已一次归还：正常保存退出后的窗口仍关闭，API同原资料新shared backend已启用，见私有`current-maintenance-locator.json`及`maintenance-final-receipt.json`。根重新status确认ui49已退出、无维护锁后开始标准upgrade。首次候选前置校验因缺惯用名`delivery-manifest-ui50.json`中止，尚未修改安装/取维护锁；doctor确认后补同一已审冻结文件的标准清单（`checks.image`明确精确未改viewer证据复用），候选字节未改，再继续原流程。失败保留`sf16-install-initial-failure.json`；本次非自动审批拒绝。

## 正式启用回执

- 标准操作与备份：`2026-10-19T22-55-08-928Z-f42eae68`，`sf16-install.json`为installed/restarted均true。
- `sf16-runtime-after.json`：安装与运行均`20261019-ui50`，原生ready `2026-10-19T22:56:58.5232731Z`；LocalSaveAck、116%缩放、两屏档案、输入焦点保留，maintenanceLock=null。
- API0.9.27/sharedBusiness=true保持数据会话已启用状态，本轮没有重启API或迁移数据。没有正式测试消息；原件／旧日记／手机均未操作。候选冻结清单未变，标准CLI按完整安装清单验证；没有额外重跑旧媒体矩阵。
- 用户随后要求多开Sol高加速现有问题，已并行拆成侧栏CSS、输入拖动/发送按钮、鼠标展开聚焦三项，分别私有候选/定向自验，根统一必要独审与部署。它们不在此次ui50安装范围；不得把本次SF16结案写成全部需求完成。
