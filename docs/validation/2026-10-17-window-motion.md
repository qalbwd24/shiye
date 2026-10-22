# 随想窗口展开／收起动画：高刷请求节奏与反向轨迹

后续2026-10-17用户恢复窗口验收/更新授权后，主会话完成393＋10原生隔离和564完整项目检查，标准升级启用随想ui11 PID77712，12215安装文件哈希及两屏记忆核对通过。下文“未操作/未部署”描述本专项子代理阶段，最终运行以[主验收记录](2026-10-17-message-motion.md)为准；实际120Hz呈现仍待用户观感确认。

日期：2026-10-17。范围仅 `previews/telegram-chat/EdgeDock.cs`。本轮用户暂停正式界面操作；没有显示测试窗、抢焦点、调正式窗口或部署。便签UI6、QuickCapture、边框和消息发送动画由其他会话负责，本轮未修改。

## 定位与选择

原动画已有高精度等待计时器，但周期固定为8ms，即125次／秒，与120Hz屏幕的8.333ms周期不同；位置计算使用整数毫秒。原ease-out cubic在静止起步就有 `3 × 路程 / 240ms` 的初始速度；反向从当前位置重开另一段曲线，位置连续，速度不连续。原验收统计的是窗口位置更新间隔，不能据此断言实际呈现120帧。

微软[动画时间与缓动建议](https://learn.microsoft.com/en-us/windows/apps/design/motion/timing-and-easing)说明了进场快后慢、退场慢后快以及167／250ms等时间。对于本项目可中途反转的整窗贴边位移，直接照用极端曲线会加剧大路程起步或反向的速度突变。本轮保持完整位移240ms，使用三次Hermite插值：静止时等价于 `3t²−2t³`，起止速度均为0；反向时从实际当前位置携带当时曲线速度，按剩余距离将时长限制在70–240ms。位置始终约束在展开端点与原6 DIP露边端点之间，避免继续滑出该轨迹范围；边界夹紧时速度归零。

保留速度意味着反向初段可以短暂沿原方向减速，之后再返回。这与立刻反转速度的旧行为不同；本轮只通过数学范围与端点验证，不将它描述为已经通过用户观感验收。

## 调度实现

- 每次新动画从所在显示器读取当前 `dmDisplayFrequency`；120Hz对应8.333ms请求、144Hz对应6.944ms。读取仅发生在启动时，逐帧不增加屏幕查询。低于30Hz／无效值按120Hz回退，高于240Hz限制请求至240Hz；普通等待检测仍40ms。
- `SetWaitableTimer` 的周期参数只能表达整数毫秒，而相对到期时间以100ns计。改为一次性等待，由Stopwatch原点计算下一未来deadline，逾期帧直接跳过，避免补播旧位置及逐次累积时间漂移。位置也改用Stopwatch的浮点毫秒。
- 每次运行保留独立的一个待处理UI任务门禁；旧运行的回调不能清除新运行门禁。结束仍停止线程、释放计时器；不支持高精度标志时保留原兼容计时与成对分辨率请求。若重新设定计时器失败，使用可取消等待保持动画能够继续结束。
- 未在UI线程加入 `DwmFlush`。它会阻塞调用方等待该应用待呈现的DirectX更新，不能直接当作所有显示器的通用刷新回调。

依据：[CreateWaitableTimerExW](https://learn.microsoft.com/en-us/windows/win32/api/synchapi/nf-synchapi-createwaitabletimerexw)、[SetWaitableTimer](https://learn.microsoft.com/en-us/windows/win32/api/synchapi/nf-synchapi-setwaitabletimer)、[EnumDisplaySettingsW](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-enumdisplaysettingsw)、[DEVMODEW](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/ns-wingdi-devmodew)、[DwmFlush](https://learn.microsoft.com/en-us/windows/win32/api/dwmapi/nf-dwmapi-dwmflush)。

## 无显示界面的验证

实际编译项目宿主到独立候选；另从前后源码提取真实计时器实现，创建 `Visible=false` 的Control和消息循环，测量UI回调调度。没有调用Show、激活或移动正式窗口，没有读取真实profile／草稿。

合计41051个采样断言通过，覆盖360／840／1649／4096px正反方向、整段单调与精确端点、多时点反向的位置／速度连续、轨迹范围、旧deadline跳过，以及停止后的无回调。DEVMODEW结构实际大小220字节、刷新率字段偏移184字节通过核对；本机只读主屏配置为120Hz。

在1649px整段位移的首个8.333ms，原曲线理论位移165.88px，新曲线5.83px。该数字是同一数学时间点的位移比较，不是屏幕逐帧捕获。

本次隐藏消息循环每组采集36次回调，结果如下，单位ms：

| 调度                     | 请求间隔 | UI回调中位数 |   P95 | 最大值 |
| ------------------------ | -------: | -----------: | ----: | -----: |
| 原固定8ms                |    8.000 |         8.15 | 11.10 |  19.09 |
| 新60Hz deadline          |   16.667 |        16.74 | 20.22 |  21.47 |
| 新120Hz deadline         |    8.333 |         8.30 | 10.36 |  24.73 |
| 新144Hz deadline         |    6.944 |         7.07 | 12.03 |  14.43 |
| 新120Hz、注入50ms UI阻塞 |    8.333 |         8.38 | 12.52 |  58.00 |

各组结束后等待60ms，均未再收到回调，泵状态停止。注入阻塞后按当前时间取新位置，未积压一串旧位置。样本仍有迟到，不能用中位数掩盖24.73ms最大间隔，更不能把这些UI回调间隔当作DWM／WebView2实际呈现帧率。

0–3000ms收起等待、保存并行与失败返回、忙碌保护、悬停激活选项、横向优先、四边几何和6 DIP露边代码保持原规则；本轮未运行会显示窗口的完整原生验收。

## 产物与剩余边界

- 候选：`outputs/2026-10-17-message-motion/native-motion/candidate/拾页对话预览.exe`，SHA-256 `2E09727F3C21361DD1995E378BA8E394614A13E03BB13C6EFBA27C275426346B`。
- 隐藏计时／曲线证据：同目录上层 `checks.json`；构建与输入哈希见 `manifest.json`。
- 临时文件：`tmp/message-motion/native-motion/`，含原EdgeDock源码快照、提取的前后实现与测量器。构建脚本还按既有约定更新 `tmp/telegram-preview-20261015/SharedInputMode.cs`。

显示模式刷新率读取为整数且不等同于VRR实时扫描周期。deadline只是请求唤醒节奏，未与DWM相位锁定。真实120Hz屏幕观感、WebView2／DWM呈现、物理鼠标反向、多屏不同刷新率和后台负载仍需用户允许界面操作后验收；当前正式运行未由本轮替换。

## 2026-10-17 后续实机隔离测量

用户后续授权的ui16基线测量已完成主屏左边缘full／solid短组及16／40／80／120／180ms内部反向、sky实际移出／点击露边收起展开。8个原生源文件与安装UPSTREAM逐项hash匹配；并行桥仅在tmp恢复精确冻结字节，未回写共享源。独立profile／API关闭／合成背景覆盖后，仅录制884×96物理像素ROI。有效full 367帧、solid 347帧均逐帧校验和匹配；各有1个q收尾showinfo尾帧未输出，已排除。先停录再正常关闭自建窗口，15:56:54Z释放全部诊断窗口／浏览器负载。

主屏实际读取120Hz，捕获边缘变化并非稳定120FPS。Location setter同步耗时full中位3.738／P95 9.494／最大17.522ms，solid 3.357／9.212／16.147ms；对应高精度等待唤醒迟到P95仅0.797／1.776ms。动画期间40ms检测更新为0，两组Tick内GC为0。无浏览器solid仍有同步移动成本，尚无证据将其归因于WebView或安全调整曲线；本轮未改产品动画。实际Bounds与数学predicted位置差异不直接当作跳帧或改起点依据。

公共QPC与精确边缘对应的callback→像素交付上界full中位25.590／P95 43.208ms、solid28.187／58.890ms，包含捕获／下载／管道／读取，不能解释为纯DWM呈现或面板扫描时间。早期截断／无公共时钟探索明确不进入此统计。完整来源、失败边界、实际反向时刻和合成ROI contact sheet见 [窗口测量结果](../../outputs/2026-10-17-motion-refinement/window/findings.md)；构建／隐私方案见 [测量方案](../../outputs/2026-10-17-motion-refinement/window/plan.md)。物理按键、纯无点击hover、四边／多屏、长期后台和光学120Hz验收仍未覆盖。

随后常用尺寸X0/Y116、868×1649／108%独立补验完成四例源码自测并正常收尾，但**正常开合像素验收无效**：138帧中65帧ROI为均匀RGB(32,32,32)，原因未定，明确排除；后续反向段有效边缘和源码setter耗时保留。setter中位4.077／P95 16.024／最大18.880ms，不能将大尺寸短例与原组混算或宣称120FPS。16:14:10.8520180Z全部自建窗口正常Close并释放槽，未启动ui17标准native。见 [常用尺寸补验与灰段边界](../../outputs/2026-10-17-motion-refinement/window/tall1649-findings.md)及其中实际ROI关键帧。
