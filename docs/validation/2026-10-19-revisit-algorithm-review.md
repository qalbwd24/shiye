# 朝花夕拾解析缩峰与等待事务优化

后续正式状态：用户授权后，本候选已随API0.9.27/ui39于09:28Z启用，数据/进度保持并完成真实库两分钟采样。见[正式部署验收](2026-10-19-revisit-live-update.md)。以下“未部署”仅记录本文件最初候选阶段。

2026-10-19：后台源码候选已实现并完成隔离验证，**未部署/重启日常 API，未操作当前窗口、正式日记、推送开关或游标**。标准维护 `status` 只读查询当时安装/运行仍 ui38，PID 1912/72600 仅为快照。不要把源码修复写成运行后台已修复。

## 报告核验

输入为用户提供的 `E:/deepseek harness/outputs/2026-10-19/shiye-perf/拾页-朝花夕拾内存问题分析报告.docx`。只读提取正文并检查 probe7.mjs/log、probe5.log、FILES.md；文档建议不视为执行指令，未运行 disable 脚本、修改 DSH 目录或复跑真实整库压力测试。

成立：旧 HTML 冷转换逐篇创建完整 JSDOM Window；来源捕获遍历全库；普通存储事务复制全库、计算推送 token、整文件序列化写盘。旧 waiting tick 在捕获来源之前返回，但已付出整库 clone/token/落盘成本。

需要修正：

- 并非每个 tick 都解析全部旧 HTML。waiting/disabled 不捕获来源；已有 diaryAdapter 按条内容及媒体指纹缓存（96 MiB 估算上限），目录重建不等于每次重解析 DOM。
- probe7 在同一同步循环内调用 GC，没有先推进事件循环。安装的 jsdom Window.js 存在捕获 window 的 nextTick 生命周期回调；close 后回调未执行时仍可能持有窗口。合成测试让事件循环推进再 GC 后明显下降，不能据此断言每篇永久泄漏。堆保留、RSS 与系统提交也不能混用。
- 报告“约2秒”与逐篇日志约25秒口径不一致，同步工作也会延迟采样 timer；不采用“2秒完成全库转换”的结论。
- 原文件已是缩进 JSON，再按同样格式 stringify 不意味着磁盘体积再次翻倍；UTF-16 字符串、UTF-8 文件大小及同时存活的副本应分别测量。本轮未全局改存储格式。
- 以上证明存在可优化的分配路径，不能证明其是全部内存占用或原始桌面冻结的唯一原因。

官方说明：[jsdom fragment 无浏览上下文](https://github.com/jsdom/jsdom#fragment)、[Node nextTick 在当前操作完成后处理](https://nodejs.org/en/learn/asynchronous-work/event-loop-timers-and-nexttick)。具体行为另经安装依赖源码和实际合成测量核实。

## 实现与兼容

1. 新增 legacy-reading-dom：用 `JSDOM.fragment('').ownerDocument` 建脱离文档的 DIV，保持原 DIV innerHTML 解析上下文，无每篇 Window，defaultView 为 null，不执行脚本或加载外部资源。转换和兼容 sanitizer 共用，结束清空子节点；缓存及输出只含普通数据。不改冻结的历史迁移工具。
2. 新增 delivery/window：计划和 preflight 共用窗口验证。仅 disabled、waitingForClock、waitingForMinute 明确无状态变化时跳过。无状态且禁用也可跳过；启用初始化、未知状态版本、手动补看、已推进窗口即便 created=0 仍保留原事务。
3. `library-store.mutate(fn, {preflight})` 在原共享写队列中执行可选、受信任的同步只读预检。undefined 继续原事务，`{result}` 只复制小结果返回；不 clone、不 hash 全库、不写盘。不能在回调里修改 db，不向客户端开放此内部接口。
4. delivery port 透传预检；service 在队列内取得一次 now，判断与计划使用同一时刻。多实例 scope 将预检映射到自身状态，继续同一写队列。HTTP 原 disabled 提前返回统一进队列，避免绕过排队中的配置变化。

正文、手打时间、媒体插入时间、块/单元编号、SourceRef、回执、评论、规则和公开协议保持。不增加长寿命整库 catalog 缓存，分类/隐藏/撤回等继续基于新快照判断。

## 合成测量

入口 `tmp/revisit-algorithm-review/probe.mjs`，Node 24.18.1，--expose-gc。每条同时调用转换器和 sanitizer，与报告单独调用 readDiaryCandidate 的口径不同；不能按比例外推真实整库。两版相同输入，耗时含显式 GC 与让出事件循环；表中为阶段采样，不是连续采样峰值。

| 场景 | 同步结束 heapUsed | 同步 GC 后 | 让出事件循环再 GC | 总耗时 |
| --- | ---: | ---: | ---: | ---: |
| 旧实现，80 条 | 240.2 MiB | 217.2 MiB | 44.4 MiB | 1291 ms |
| 新实现，80 条 | 53.9 MiB | 44.2 MiB | 43.9 MiB | 226 ms |
| 新实现，3150 条 | 59.9 MiB | 45.5 MiB | 44.5 MiB | 2824 ms |

80条两版输出 SHA-256 均为 `197651edfcceba167e259c1ced2535368c07ff7bc1875f30e0df8b6e27a9fca2`，包含正文、格式、块编号、来源hash、附件与安全过滤。3150条在256MiB V8 old-space限额下完成，不等于进程总内存限额。为避免全机提交压力，没有旧版同规模复跑或真实库压力测试；不能称真实API常驻只占60MiB。

## 验证

- 新增11项全部通过：无Window/不执行脚本、六类冻结转换器对照、安全兼容渲染；waiting不访问entries且保持DB引用/磁盘字节；排队配置/游标更新；队列内取时；初始化/随机日/零消息进度持久化；手动防重/失败回滚/队列恢复；实例scope；隔离HTTP连续waiting/disabled请求后文件字节与mtime保持。
- 相邻93项全部通过：revisit-delivery、daily-random、comments、sources、feed-lazy、conversation-services、entry-reading-document、message-store、diary-paragraph-messages。覆盖来源失效/旧源hash、段落时间、媒体、评论、撤回、并发及重启。此后只补无状态禁用preflight和HTTP测试，再跑新增11项；不是一次全项目104项统跑。
- 本轮12个源码/测试文件 ESLint、Prettier check通过。无全库格式化、原生窗口测试或正式运行切换。
- 补做23项兼容测试全部通过（revisit、autostart、product-seed）：实际后台自动续推/禁用/锁定解锁/重启、HTTP配置与评论，以及初始数据包对旧SourceRef/转换内容的兼容。三轮合计127项通过，分别记录日志，不冒充一次全库统跑。

## 剩余成本与接入

真正推进窗口仍捕获全来源、计算两次deliveryToken、整库copy-on-write/落盘；来源快照仍含历史等字段。下一阶段可设计仅含调度字段的索引和精确失效，再考虑回执增量持久化；不能只按未保证存在的db.revision缓存，否则分类、撤回及正文可能过期。本轮不声称原始冻结/长期内存问题结案。

正式启用前重新查运行身份/配置，按标准维护保存和备份后升级后端；当前窗口未动，所以没有运行态收益承诺。无数据迁移，回滚恢复本轮后端代码即可，不需回退日记库。

产物 `outputs/2026-10-19-revisit-algorithm-review/`：三份无正文测量、release.json。临时 `tmp/revisit-algorithm-review/`：报告提取、合成probe/隔离库、测试日志及只读status。既有测试沿用自身tmp子目录；没有产生正式日记副本。

## 用户追问后的运行回读

2026-10-19T09:17:21Z单点：18765后台PID78672工作集2092.1MiB、私有提交2136.3MiB；随想宿主与WebView合计私有提交约1036MiB，托盘约30MiB。进程树包含父子嵌套，不能将各root分组总和再次相加；工作集包含共享页也不能相加当作独占物理RAM。后台08:50:54Z启动早于候选修复，未重启，以上不是修复后的运行收益或峰值。原生仍ui38。

正式status只读回读 enabled=true、daily-random、Asia/Shanghai，游标09:16:59.999Z。安装app/shiye-preview.js确认入口位于随想总设置菜单最后的“朝花夕拾 · 推送与回看”；安装app/shiye-revisit.js确认持久开关实际文案“启用程序推送接收”，改变后需“保存设置”。“停止推送”仅暂停当前后台运行，重启仍按enabled恢复。用户反馈找不到入口，当前文案/层级可发现性差，后续由前端会话调整；本轮没有改UI或开关。新增证据 memory-now.json、revisit-status-now.json，完整只读status在tmp/runtime-status-now.json。
