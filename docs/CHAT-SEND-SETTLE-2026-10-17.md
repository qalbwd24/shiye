# 随想发送后再次上移：诊断需求

最终状态：ui22已标准升级并启动，来源过渡与确认排序修复均通过核心场景验证。下文保留设计/诊断演进，最新运行与边界以[最终验收](validation/2026-10-17-send-settle.md)为准。用户最新要求按改动影响选测，不默认重复整套检查。

用户反馈已安装ui21“发出消息后还会再往上弹”。本轮先只诊断，主会话负责核心设计，执行会话使用实际安装ui21冻结资产及隔离合成库，不操作日常profile或真实消息。

复现矩阵覆盖普通会话满屏/未满屏、手动64px/自动高度、单行/多行/连续发送。逐帧从触发发送前采样，覆盖第一帧可见至发送后至少1000ms稳定，记录新气泡top/opacity、消息列表scrollTop/scrollHeight/clientHeight、content padding、footer/reserve，并记录ResizeObserver与scrollTo调用时序。重点检查高自动输入发送后的收缩，不能以发送后再次输入才发生的轨迹替代本次问题。

实时status开工为ui21/API0.9.24。产物`outputs/2026-10-17-send-settle`，临时`tmp/send-settle`。最小复现、原始轨迹和未复现边界随证据补充；未实施新修复、未部署。

用户追加要求：新消息弹出的起始位置应像从输入框发出，优化起点和过渡动画。先完整定位ui21二次上弹，再以最终稳定布局为基础，仅使用不扩大scrollHeight的视觉transform/opacity层过渡；不延后本地提交、不用等待隐藏布局问题，保留即时模式可选。诊断同时覆盖instant/smooth当前模式，先各跑满屏64px与auto多行最小场景。

主会话确认的方案方向：发送前记录输入文字区域/输入框锚点，消息最终布局先确定，再做约180ms短促视觉过渡。参考[Apple Motion](https://developer.apple.com/design/human-interface-guidelines/motion)的简短精确动效原则及[web.dev动画性能指南](https://web.dev/articles/animations-guide)对transform/opacity和实际layout/paint检查的建议。该时长和方案为设计方向，尚未实现或验收；最终以真实首次可见至稳定轨迹为依据。

## 隔离诊断与候选进展

2026-10-17本轮原始合成库轨迹确认：496×942 CSS px、DPR1.75，ui21满屏64px手调单行不论instant或smooth均会在约630ms二次上移8px。smooth先约156ms停稳，再由上游600ms收缩锁释放将padding80改88；footer和包装reserve均为80。instant同样先落804.84，再移至796.84。仅临时统一reserve+8的A/B中，padding从首次可见已为88，后续没有二次位移；instant自动多行对照未退化。原始证据分别在`baseline-instant-manual64`、`ab-A-smooth-manual64`、`ab-B-smooth-manual64`、`ab-B-instant-auto-multi`。

候选三值设置已实现于包装CSS/JS并同步public镜像：即时显示／从输入框发出／原平滑过渡。managed留白为实际footer向上取整再加8px，未managed继续使用原fallback。核心和上游reserve helper分别由主会话及输入验证会话负责；候选尚未安装。

最新bb19621核心隔离overlay的稀疏自动多行（尚未重打包helper）在`overlay-sparse-smooth-film-bb19`完整退出。首次可见34.3ms至1637ms的根top775.84375、scrollTop0、padding64均相同；实际内容从translate(-255.95,19.81)按190.8ms动画归位。发送后61.8ms故障注入clone替换content，动画时钟由24.98ms接续32.2ms，没有从零重播；最终transform/动画清理、overflow恢复。该例marginTop0且无force-messages-scroll祖先。`filmstrip.png`保存中间实际绘制帧，发现空列表进入消息列表的上游Transition仍将早期整体压暗；主会话正做最小第五文件修复，尚不将该视觉效果记为验收通过。

冻结构建基线已核对安装ui21的84项源码SHA全部一致，复制在`tmp/send-settle/build-root`。候选仅纳入三包装、reserve helper及明确缓存引用；第五文件会以精确补丁加入，不覆盖当前共享MessageList整文件。`candidate-artifacts/source-scope.json`保留基线与覆盖来源。构建启动命令被自动审批以blocked by policy拒绝，未执行、未绕过；后续构建状态以完整退出回执为准。

## ui22冻结准备状态

bb19621核心、三值设置、managed reserve helper及NoMessages首次列表跳过父层fade的精确第五文件补丁已冻结。source-scope共9个位置（含三包装的双镜像与index缓存引用），84项已安装ui21基线重新审计通过。源码位于`tmp/send-settle/build-root`，未混入当前共享源码的其他开发分支。

因构建启动审批拒绝，本轮尚无ui22构建或完整新包浏览器验收；仍运行已安装ui21。仅准备手动一条命令`& 'D:\拾页\tmp\send-settle\run-build-ui22.ps1'`，见产物目录`manual-build.md`；该脚本无部署/关窗/重启，正式数据和profile未操作。第五文件后的实际首帧仍待新包证明。942px范围的源码与现有轨迹分析见`force-scroll-analysis.md`，旧满屏轨迹缺类名和computed margin直接采样，不能将推断记成已证实。

## 手动构建后真实包验证进展

后续新增排序修复已于23:42:58 UTC通过标准脚本自动构建：`candidate-ui22-ordering`，12218文件，清单SHA `769a168f1e36d95ef3bad95b39be3dff71964fb8ac2bb7904f6e9cc77ec9d970`，EXE未改。7项排序定向通过，跨秒/午夜维持视图分组与次序，global真实确认时间保留。新包正在复验，尚未部署。旧候选e4的连续发送失败证据保留，不挪作新包验收。

自动构建最初因依赖junction不可遍历失败；包含删除链接的修复命令被审批以`blocked by policy`拒绝、未执行。采用不删除方案，保留该链接及原目录，另建`tmp/send-settle/build-root-ordering-physical`实体源码与依赖，重新审计84基线＋13覆盖位置后标准构建成功。未改系统信任、未清理旧目录。详情见`ordering-artifacts/dependency-repair-rejection.md`和`build-attempt-1`。

用户手动构建成功：ui22候选12218文件，初始manifest246532b0…，EXE仍8c205839…。实际app无overlay首帧证明第五文件去父fade有效。原生检查随后发现bindManagedFooter新增getClientRects在mutate内触发调度器错误；主会话将两行guard改为已测reserve正数校验。已严格静态同步e4c6667f…核心，未重新Vite，程序清单仅core/index缓存引用/UPSTREAM三份变动，新manifest7b09441f…。旧清单/来源保存在candidate-artifacts/pre-mutate-guard-fix。缺失SharedInputMode冻结源码已按e194…补齐，wrapper来源由7/8到8/8，desktop来源也匹配，候选程序字节未因此改变。

新core的35项browser-core已退出0；确认弹窗测试仅补标题可见等待，保留标题/正文/按钮严格断言，旧即时count失败证据仍在。真实app新film保存在browser-final-film，无overlay，气泡从输入文字起点到终点，50ms clone后时钟继承，父层不再压暗。5个独立边界（减少动画、滚轮、切模式、动画中启用减少动画、切房）均退出0，最终动画0、clip0。

24场独立fresh矩阵仍在进行，发现快速100ms连续发送的实际阻断：smooth及instant的满屏auto多行，第二次发送后footer约139ms已缩到56，但pending hold仍保留reserve131/padding139，直到约591–600ms确认后缩至56/64，旧气泡上移83.44px。原始browser-final-isolated各full-auto-continuous轨迹已交主会话；不能将本轮记为全通过或部署。

快速reload/create另发现既有启动竞争：期望新room -900000003，但发送时恢复成旧room -900000002。冻结ui21同fixture也直接复现；两个版本最终都只有旧房active，非双active。startup-room-race-control.json明确passed=false、existingInUi21=true、未修，排除于停稳通过矩阵。该直接轨迹同时确认force-messages-scroll阶段computed marginTop942px，结束为0，解释临时100vh滚动范围；不能归因WAAPI扩大scrollHeight。

## 排序修复与新冻结候选

确认乱序根因已补最小五源：ApiMessage临时previousLocalDate、mock确认updater捕获原发送日期、cache显式清除、纯排序/视图工具、MessageList仅本机分支使用稳定日期/本地ID元组，并在分组前作只读日期投影。普通消息保持对象引用，全局真实确认date不变，非mock仍使用原比较器。实际groupMessages跨秒/午夜key保持、原对象date保持、两种ACK顺序、C在A确认后接续、三元传递性、缓存清理和真实worker并发重开共7项定向测试通过；五源ESLint通过。字段边界同步DATA-MODEL。

新冻结源码为`tmp/send-settle/build-root-ordering-physical`，以已审核ui21冻结源精确补丁生成，84旧基线和13覆盖位置SHA预检通过。依赖Junction遭Windows不受信任装入点限制；移除链接的命令被审批拒绝且未执行。主会话批准保留链接不动，另建physical源码和依赖纯复制成功，未改系统信任/权限，详见ordering-artifacts/dependency-repair-rejection.md。首次ERR_MODULE_NOT_FOUND失败在build-attempt-1保留。

标准压缩脚本随后完整退出0，新`candidate-ui22-ordering`为12218文件，program manifest769a168f1e36d95ef3bad95b39be3dff71964fb8ac2bb7904f6e9cc77ec9d970，核心fc8470bd…，EXE仍8c205839…；全文件SHA预检无差。真实app无overlay最小smooth/instant full-auto连续均无350ms后跳动：A确认14和B本地13.000003始终按发送顺序，B确认15后两条top均不变。35项browser core与5个fresh取消/减少动画边界已通过，完整24矩阵仍在进行；暂不写总通过或已安装。

该轮多browser同时运行，随后主会话也运行check；仅作为几何/行为correctness，不作为空载延迟或长帧性能结论。完整矩阵后等待check退出，再串行film与快速三连发复查；物理120Hz仍以原生/实际窗口单独证据为界。用户已退出聊天/托盘，主会话只读确认API0.9.24仍可达，不能记为全后台已停。

## 最终浏览器回执

`ordering-artifacts/browser-aggregate.json`已生成passed:true并绑定769a168f…程序清单、fc8470bd…核心。35核心、5取消/减少动画边界、7排序定向测试通过；24矩阵实际在收到简化指令前已全部调度并自然完成，均无400ms后位置跳动，收到指令后未新补矩阵或全vendor tsc。主会话check退出后，串行film和两模式快速三连发3例完整退出0；第三条本地14.000004确认16后，A/B/C顺序及各自top保持，450ms后无跳。中间帧已查看，输入来源清楚、无父fade、50ms clone继承时钟、结束清理clip。浏览器进程已全部退出，已通知主会话和原生验收会话接续，当前文档不宣称升级已完成。

项目check697项696通过1失败，revisit-client lab255单例复查仍失败；共享client1f46d118…与冻结a81d50dc…不同，worker shiyeLocal两者均86d859f…，此差异是可验证边界，不能据此确定失败根因，未代改并行实现。整体项目不记全绿。安装/原生结果以主会话最终标准维护回执为准。
