# ui22候选发送停稳浏览器验证

最终排序候选浏览器通过，原生与常规升级由主会话继续执行。当前候选为`candidate-ui22-ordering`，12218文件；program manifest `769a168f1e36d95ef3bad95b39be3dff71964fb8ac2bb7904f6e9cc77ec9d970`，core `fc8470bdf7ef1f4675ff7d501575dc3439c84aec6bd19c4968bf960b217d0fd7`，EXE仍为下述已验ui21字节。完整回执为`outputs/2026-10-17-send-settle/ordering-artifacts/browser-aggregate.json`，绑定实际程序文件SHA。

最终35核心、5取消/减少动画边界、7排序定向测试通过。24矩阵在用户要求简化后续测验时已经实际完成并有退出回执，均无400ms后气泡根位置跳动；未补新矩阵或全vendor tsc。该阶段与其他浏览器/项目check并发，仅作为正确性证据。check退出后串行film及smooth/instant快速三连发3例通过：A14、B15、C本地14.000004确认16后，top639.84375/742/821.4375均不变，450ms后无跳。`browser-ordering-film-serial/filmstrip.png`已检查真实中间帧，来源清楚、无父fade、50ms内容替换继承动画时钟，结束后动画和clip清理；不声称物理120Hz或空载性能。

排序修复采用仅mock内存的previousLocalDate与previousLocalId元组，渲染前按发送日期作只读投影，保持日期分组及排序，全局确认date不变。真实updater、缓存清理、分组跨秒/午夜、两种ACK顺序、第三条接续、传递性及worker并发重开均有定向验证。冻结来源为`tmp/send-settle/build-root-ordering-physical`，84旧基线+13明确覆盖位置核验通过；8个宿主源和1个desktop源亦与manifest匹配，物理复制依赖，无系统信任修改。先前Junction移除被审批拒绝未执行，原联接保留，安全替代经主会话批准。

项目全check结构/lint/format通过，697项696通过1失败（revisit-client lab255），只复查该单例仍失败。主会话只读确认共享shiye-revisit-client.js SHA1f46d118…与冻结候选a81d50dc…不同，worker shiyeLocal均86d859f…相同；这是可核验的共享源/冻结候选边界，不能据此确定失败根因，未代改并行client。不能称全项目全绿。快速reload/create既有竞争仍独立保留未修；浏览器aggregate明确排除。以下为旧e4候选及fc847临时overlay的失败诊断，不代表最终排序候选仍失败。

当前正式运行仍为ui21。本轮使用手动构建的ui22真实app和独立合成库；无日常profile、真实消息、部署操作。产物`outputs/2026-10-17-send-settle`，临时`tmp/send-settle`。

候选初构建后静态修正mutate guard，最终当前程序清单SHA为`7b09441f6ac33b91d96c621cb26b9951e1d43eb82f044733460061a0474cba97`，核心为`e4c6667f0b94dbbdd8f2c27ead5a0ef813126346ba0b518ac1c12bcff09d471f`，EXE保留已验ui21字节`8c205839670b6bf349b5ce04031ea85cfae4ded0b973241ee331c07d324b777c`。12218文件SHA预检通过。静态修正仅core、index缓存引用和UPSTREAM变化，未重Vite。

35项旧浏览器核心回归在`browser-final-core`完整退出0，涵盖朝花夕拾固定目标、来源媒体/锁定、草稿/附件保护、错误重试、撤回确认与媒体恢复。首次旧轮确认弹窗即时count读取过早，已补heading真实可见等待，严格标题/正文/按钮断言保留；失败证据在`browser-core-ui22`，不覆盖。

`browser-final-film/filmstrip.png`为真实包、无overlay的实际绘制帧。空会话新消息已无父层整体压暗，内容从输入文字区域向终点移动；50ms content clone后时钟接续，根位置不动。`browser-final-boundary`的减少动画、滚轮、模式切换、动画中减少动画、切房5个独立fresh场景完整退出0，最终运行动画0、clip0。物理120Hz和真实IME不由无头证据证明。

`browser-final-isolated`的24场矩阵均有完整退出回执，覆盖smooth/instant/legacy、满屏/稀疏、auto/64/240px、单行/多行/快速连续发送。该矩阵不判整体通过：smooth及instant满屏auto快速连发在约591–600ms仍出现83.44px上移，瞬发稀疏64连续发送也分两次让位。原始JSON和ResizeObserver/scroll调用时序均保留。

主会话fc847临时核心仅overlay最小两例，证据在`trial-fc847-smooth`及`trial-fc847-instant`，候选包未变。其instant提前使用实测reserve已使padding约150–172ms恢复64且不再迟变；第二条首次出现立即有来源动画。但是第二条本地ID13.000003排在第一条确认ID14之前，约585–606ms确认成15后又排到其后，导致第一条top776.28125→696.84375，上移79.4375；此时scrollTop2703、padding64均不变。剩余问题是确认排序，不可记为动画/留白已全部修复。

快速reload/create控制在`startup-room-race-control.json`明确失败且ui21已有：期望room -900000003，实际被旧选择恢复到-900000002；唯一active列表为旧房，非双active。该既有竞争未修，不计为普通发送通过。逐帧同时直接证实force-messages-scroll祖先使marginTop为942px，移除后为0；这是上游100vh临时安全滚动阶段，不能认定WAAPI扩张scrollHeight。

上述旧包当时未生成通过总回执；确认排序现已按本页开头的新冻结候选修复并复验，旧失败证据保持原样。用户已授权常规升级，实际安装状态以主会话的标准维护回执为准。
