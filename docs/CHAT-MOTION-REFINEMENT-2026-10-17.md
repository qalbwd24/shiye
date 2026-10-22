# 随想消息与窗口动效第二轮

2026-10-17。用户明确继续优化两套动画，消息优先：尽可能消除发送等待感，同时保留自然、流畅的过渡；重点实际验证窗口展开/收起、快速反向及120Hz表现。要求多参考成熟方案，验收后更新运行版并积极维护文档。主代理负责规划、核心难点与最终判断，GPT-6.1-sol中等推理负责测量、实现和回归。

最新结果：ui17已标准保存/备份/升级启动，505＋10原生、591根项目检查与12215安装hash通过；原数据hash、108%字号、868×1649及两屏记忆保持。消息组稳定身份和C过渡已上线；窗口EXE未改，实际120Hz开合/快速反向测量仍有长帧。详见[正式验收与未完成边界](validation/2026-10-17-motion-refinement.md)。下文基线、方案及准备过程保留历史时序，不代表当前仍待发布。

## 基线与产物

起点为已核验运行ui16/API0.9.24；PID68656/托盘29628仅开工快照。程序基线以ui16交付清单为准，不将共享源码中的归档/朝花夕拾/数据桥候选混入本轮。新产物 `outputs/2026-10-17-motion-refinement/`，临时 `tmp/motion-refinement/`；各子任务使用message/window子目录，保留前版快照及无效实验。正式数据/profile不迁移、不注入虚构消息。

## 体验与设计约束

- 普通短消息按下发送后尽快出现清晰反馈，动画用于连接输入与消息位置，不能先空等再播放。清晰反馈与持久化成功分别计时，不能提前伪造成功勾号。
- 保留自然运动，不用取消全部动画掩盖延迟。旧消息保持连续，不重引已经导致反向回弹的旧气泡FLIP补偿；连续发送、滚动/导航打断、减少动画和隐藏状态都须正确收尾。
- 大消息、引用、表情/贴纸、多行输入及媒体保留正文、原件、草稿、IME、保存失败重试和回执语义；不为提前绘制随意推迟快照捕获而改变写入顺序。
- 窗口中途反向应立即接受意图，轨迹和速度接续，避免端点跳动或多余补帧；按120Hz约8.33ms帧预算分析，但UI回调/rAF计数不是屏幕实际呈现率。

## 执行步骤和分工

1. 消息Sol先基于冻结ui16测输入→处理→worker乐观更新→DOM→首个清晰可见→90%可见，并记录主线程/worker编码、LongTask/LoAF、样式布局、滚动及实际compositor帧。先20/1000/10000条合成负载小样本定位，再扩展场景。
2. 主代理判断关键路径并设计可审阅改动。优先消除阻塞乐观显示的工作及重复调度，随后比较少量“先清晰显示、位置自然收敛”的动效方案；不把定时器缩短当作全部优化。
3. 窗口Sol先核对冻结宿主来源和可执行的实际绘制/快速反向验证方案。已知ChatJournalBridge源码hash与安装版不同，未经来源核验不得全量重编部署。窗口交互遵循computer-use技能，仅@oai/sky；合成测试与正式profile隔离。
4. 调研Sol使用Apple、Microsoft、Chrome和可核对的成熟聊天开源实现等一手资料，记录引用、适用范围与取舍，主代理选择最终方案。
5. 完成同环境前后对照、实际图像/轨迹检查及消息/持久化回归，串行执行原生与完整项目检查。正常保存、快照、标准upgrade后核对运行修订、安装hash、API版本与字号/多屏记忆。

## 验证口径

普通短消息首个清晰反馈争取在50ms内，这是本轮开发目标而非保证；报告中位/P95/最大值及样本数。分别报告DOM时刻、像素可见时刻、动画结束与保存回执，不把它们混为一个“发送耗时”。120Hz关注超过8.33/16.67/33.3ms的间隔和连续掉帧，LoAF的50ms阈值不足覆盖高刷掉帧，需结合trace及绘制序列。捕获本身的开销另列对照。

消息场景覆盖疏/密、短文/长文/多行、表情/贴纸/图片、快速连发、滚动打断、减少动画、隐藏/唤回和失败重试。窗口覆盖完整开合、早/中/末段反向、连续反向、不同窗口尺寸和正常后台负载；实际呈现工具若无法测到面板层，明确测量边界，不声称稳定物理120FPS。

一手依据初步包括[Apple Fluid Interfaces](https://developer.apple.com/videos/play/wwdc2018/803/)、[Chrome LoAF](https://developer.chrome.com/docs/web-platform/long-animation-frames)、[web.dev交互延迟优化](https://web.dev/articles/optimize-inp)。后续调研及具体实现/结果追加到本轮产物与验收文档。

## 定位中的证据与设计判断

重诊断的20/1000/10000条合成库均确认：worker的乐观更新排队后，先同步编码保存快照，随后才实际post到主线程；编码约0.4/1.2/9.9ms。主线程收到更新到DOM出现更长，不能把全部等待归因于IndexedDB。带调用栈trace可能放大渲染成本，尚需无重trace对照，不将这些数字当作正式性能结论。

主代理已核对Teact/fasterdom：测量后的DOM修改在同一轮微任务中执行，并非固有的两帧等待。另发现MessageText每次渲染新建`dangerouslySetInnerHTML`对象，而Teact按对象身份决定重写HTML；即使Markdown字符串不变也可能重建子树。下一步计数旧消息是否实际命中，若成立优先稳定局部属性对象，不直接改全局渲染器或绕过净化。

窗口构建来源问题已解决：从当前桥源码仅剔除8行未部署的revisit分支，保留BOM/CRLF后，恢复出与已部署清单完全相同的6891字节及SHA-256；恢复只写本轮隔离目录，没有覆盖共享源码。已建立独立profile和合成背景，主屏只读确认120Hz；采集记录与回调日志分别报告。40ms停靠检查计时器在动画期间已有门控，不应误判为两套动画时钟争抢。

调研详见`outputs/2026-10-17-motion-refinement/research.md`。采用立即反馈、位置/速度连续和可打断原则；Telegram iOS的原生输入到气泡过渡只作为设计参考，不将其原生实现直接搬到WebView。

## 交付准备（以下为最终资源版本化前的过程记录）

主代理批准C后，执行代理已生成 `outputs/2026-10-17-motion-refinement/candidate`（ui17），尚未部署。冻结来源为ui16交付清单，逐文件复制前后SHA-256通过，最终递归计数恰12215程序文件。6项变化为C消息包装、冻结preview修订、index包装缓存hash、UPSTREAM，以及已审阅的 `assets/useConnectionStatus-Dy1kHT8L.js` 和匹配map；精确来源hash见 `message/stable-group-assets/patch-manifest.json`，完整proof为 `stage-proof-ui17.json`。不包含MessageText缓存、worker yield或共享数据/revisit候选；窗口宿主EXE保留ui16，仪表EXE不可发布。

只读核验脚本、本轮browser适配器、`collect-native.mjs` 与 `stage-ui17.mjs` 已做Node语法检查。stage实际使用stage-selection.approved.json；原pending选择保留false。永久 `verify-responsive.js` 已加入真实旧根/组对象在首次新DOM和收尾两个时点的身份断言、模型previousLocalId映射、明确viewport-prune与同组尾条class检查；原像素断言保留，尚待实际原生执行。验证附件在 `outputs/2026-10-17-motion-refinement/verification/verify-responsive.js`，位于candidate外，manifest verificationFiles独立计数；原生实际读取的共享脚本启动前必须同hash。跨时间、incoming头像、确认/删除first/编辑尾等主动夹具按latency专项证据核对，不能以映射支持或旧441项代替。复用此前已跑ui16的verification-profile、不清HTTP cache，以真实旧根身份实证同profile实际加载新chunk；没有实测前磁盘hash不足证明缓存更新。详见 `outputs/2026-10-17-motion-refinement/dom-identity-preparation.md` 与 `delivery-preparation.md`。产品修改/原生时段/完整check/标准升级由主代理统一调度。

### 已确认的主要发送开销

无调用栈trace的20条合成库对照已定位到更上层：`SenderGroupContainer`使用首条与末条消息ID共同组成key，每次追加都会换key，整组旧消息被卸载重建。每发送一次旧Message根替换20–24个、Markdown调用22–26次；它也适用于普通本地会话创建出的群组模型，不只是样本。此前怀疑的已挂接节点HTML重复重写计数为0，当前不实施Markdown缓存或HTML属性缓存。

主代理选择本地mock路径以首条原始ID保持组身份，保留外部上游路径、DOM id及末条样式的正常更新。测试路由5次对照：首DOM均值97.4→61.3ms、90%可见167.3→130.5ms，旧根替换降到0、Markdown调用降到2。以上仅小样本浏览器原型，尚非正式运行验收；已授权Sol准备精确源码/冻结chunk与source map补丁并扩大验证。

额外worker微任务yield在小库无明显收益，未采用。全高瞬时占位A/B会让旧消息直接跳位，未采用。最终动效C保持原连续高度让位，仅将稀疏300ms改为160ms前快后缓曲线，密集单层淡入改为80%→100%/80ms。

## 最终验收与后续重点

最终候选增加精确importmap资源版本及对应严格CSP hash。同一旧原生profile/cache无需清理，505＋10检查通过，7次发送的14阶段身份诊断全部保持旧根；前两次实际身份失败与调试端口启动被策略拒绝的历史均保留。最终proof为 `stage-proof-ui17-cache.json`，manifest为 `delivery-manifest-ui17.json`；早期proof/附件的pending属于生成时历史快照。验证脚本最终为增加失败诊断的 `verification/verify-responsive-diagnostic.js`，保持原断言。

根项目591项检查通过，组件单独lint通过；vendor全量TS因并行shiyeLocal/shiyeProgram的14条错误退出2，未修补或带入。最终浏览器版本query/served字节、同组根身份、多行、图片重开通过；既有mock编辑重开不保留、删除live不立即刷新在ui16也复现，单独留待修复。轻量对照实际为每组n=5，调研中的更大采样计划不是已完成事实。

原生无截图干扰的6组首DOM约30–47ms，90%opacity/几何代理约55–80ms，尚有最长约33ms帧间隔。120Hz主屏窗口完整与纯色对照、快速反向和868×1649补测已执行；大尺寸完整开合录制含65无效灰帧，已明确排除，有效反向测量仍暴露同步Location成本。本轮没有足够证据支持安全替换宿主窗口算法，因此EXE保持ui16；不得用回调频率或无效帧称物理120FPS通过。

后续继续查大尺寸窗口同步移动与实际呈现长帧、前台常驻CPU及长期内存。两项mock编辑/删除问题的只读定位入口见 `tmp/motion-refinement/docs-final-fragments.md`，尚未作为已证实根因或实现。正式升级事实和安装核验以[本轮验收](validation/2026-10-17-motion-refinement.md)及其安装回执为准。
