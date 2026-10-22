# 2026-10-19 紧凑输入、竖直发送与内存验收

2026-10-19 随想ui36/API0.9.26已正常保存、备份、安装及启动（2026-10-19T06:59:56.7289594Z，聊天PID67772/API86988仅快照）。手调输入下限64→48CSS px，大字号按行高＋12保底并保留原偏好；平滑发送只沿Y向上，三次实绘X范围均0。journal空闲20秒不再整媒体库复制，保存/强制flush/失败重试及5分钟保底保持；API空feed/全替代页延迟建来源目录。同包17UI＋7journal、8撤回语义与1镜像分阶段、8lazy feed＋4来源/段落定向通过；15原生＋1图片按未改ui35 EXE/资产复用，不跑全套。11915安装SHA和772×1550/116%/2屏偏好保持；3150篇/3127媒体及收藏/规则/评论hash保持，自动续推正常。实际内存仍有冷解析与周期波动，不把重启降幅当优化收益，物理120FPS/长期泄漏未验。备份2026-10-19T06-57-33-828Z-fc8e34fa，产物outputs/2026-10-19-chat-compact-memory、临时tmp/chat-compact-memory；后续先status。

## 本轮实现

输入栏四处手调下限统一48CSS px；实际最小值max(48, ceil(输入行高+12))。外壳可到56CSS px；旧64及更高偏好不会被改写。32px字号自然需要65px，改回16px可回48px。字号降低时原有ResizeObserver也观察editor，修复高字号撑开后高度不回落；不添加轮询。placeholder继续跟随独立输入字号，消息字号不变。

平滑fromInput保留输入文字区Y起点，删除dx及横向插值，按abs(dy)确定时间，transform仅translate(0,dy)→0，不缩放。默认即时、原平滑选项及消息确认连续时钟保持。单发与快速两连发实绘X范围0，Y路程71.796875/128.515625/71.796875CSS px；帧图motion-paint-1/2/3.jpg及compact-editor-final.png已查看。不是物理120Hz呈现或IME专项验收。

journal以dirtyRevision/scannedRevision和独立lastScanAt门控后台20秒调度；首次、保存广播、失败、主动flush、启用归篇、收藏来源定位继续扫描，5分钟保底防广播遗漏。成功只确认开始时revision，执行中广播与强制请求分别保留rerun/rerunForce，撤回ACK闭环保持；先status再整库读取，避免后端超时期间持有全媒体副本。干净周期也跳过自动status探测，UI主动status仍实时；无库/跳过周期不伪造lastSuccess。存储schema、worker、媒体身份、写入与保存ACK不变。

API仅query.mjs新增lazy catalog：先分页，首次普通delivery才建目录，同页复用；空页、追平、全superseded页零目录构建。config/next/total/batches与缺源、隐藏、删除、旧snapshot校验保持，未改运行器规则或自动补发。不能把此修复写成全部API内存已降低。

## 验证与真实失败

17项实际隔离浏览器检查覆盖新下限、旧偏好、字号变大/降低、窄窗、placeholder、发送/切房/重开和单发/连发轨迹。首次真实失败是降字号高度未释放，已修复观察对象；第二次测试把identity matrix误当非零变换，修正测试断言后最终17项重验通过，旧attempt均保留。

7项journal合成VM/时钟测试：首次1次读，随后14次20秒空闲0新增读，第15次5分钟保底1次；执行中保存与强制请求、读前/读后失败重试、撤回ACK、配置及收藏强制、无库lastSuccess。32字节合成媒体用于计数，不能当真实内存节省量。既有chat-withdrawal-local先8语义过/1镜像失败，同步public镜像后只重验该1项通过，不重复8项。wrapper语法/局部格式及journal局部lint通过。

8项lazy feed新测试及4项既有来源/段落回归通过；两文件lint/format通过。getter证明空页不capture与普通页一次，非只比DTO。未跑全库、Android或媒体大矩阵。ui35原生15＋图片1只按EXE SHA4a3dcd2e83f675d4474586bd693ce606b8e126e6acdad2339a38f045fcea69ac及未变viewer/worker复用，不冒称本轮原生完整集成重测。

运行后3次正式只读空feed(after=MAX_SAFE_INTEGER,limit=1)为20.4/61.8/2268.5ms，78条既有投递保持，游标为请求值；第三次约2.27秒，仍有长等待，不能宣称后端实时性已结案。未发送正式测试消息或评论。初次健康读取因冷解析15秒timeout，随后版本/runner正常；不是据超时判定服务死亡。

## 内存实测及遗留

更新前聊天树私有提交1438MiB，renderer863、GPU427、native62、browser55MiB；无干预renderer后来638MiB，说明波动。API私有约3.3–3.5GiB，正式JSON约21.8MB，单凭这两项不能归因泄漏。全机提交曾97%，一次rg分配4.7MiB也失败，因此不做大库/大图/OOM压力。

更新后API冷阶段观测3765137408字节，随后595230720，再2060439552，呈明显波动；冷启动/GC/缓存状态不同，禁止将前后差直接归因本轮。后续采样process-memory-after.json另记录当前角色。已证明减少的工作是空闲媒体库读取次数和空feed全目录构建次数，未证明长期稳定内存上限。仍有每分钟source catalog/旧HTML JSDOM转换及96MiB估算缓存失效、30秒无变化tick全库clone/write、worker全库编码/IDB复制、壁纸原图解码峰值。后续优先测heapUsed/heapTotal/external并定位峰值；队列内no-op预检须覆盖并发规则/游标，不能队列外偷读跳写；媒体元数据与字节拆分须独立兼容验证，不本轮贸然迁移。

### 更新后短采样补充

07:05:00→07:05:43Z完整三点私有提交：随想树917/1210/1269MiB，renderer372/671/728MiB，GPU407/402/402MiB；API1962/1934/1836MiB。全机commit94–95%，三根路径/创建时间一致，具体逐角色/工作集/CPU见process-memory-after.json。随想后两段机器归一CPU8.23%/3.97%，不是已控制用户活动的空载测试，CPU问题仍未结案。窗口尺寸、冷暖状态、缓存/GC均与前样本不完全相同，不以该范围计算补丁收益；GPU稳定约400MiB仍是明显常驻贡献。

首次三点落JSON因整数Map键序列化失败，保留原三点汇总，修正字符串键后已有完整三点，未为报告继续扩展采样。不收heap dump或真实正文，不清工作集，不关用户其他应用制造降幅。

## 发布范围与保存

ui35冻结包只改5路径：两wrapper、preview修订、index精确cachehash、UPSTREAM；其余11910文件及新故障恢复EXE保持。候选proof部署前deployed:false为不可变验收，不代表最终未安装；本轮deployment-complete.json是正式回执。11915安装SHA一致，窗口全字段等于正常保存退出备份（当前772×1550/116%/2屏），未恢复历史1440/1824尺寸。

API静态相对导入101模块图已核：仅5项晚于旧API启动，除query外4项精确匹配product-sync及product-seed已验SHA，具体行为/兼容边界在api-memory-audit.md。不是整root任意并行代码已全验，也没有启动18789种子服务或canonical开关。package/package-lock版本0.9.26，health一致；messageUnits.enabled仍false。

桌面标准upgrade --no-start先正常保存退出及备份；API兼容运行器已stop等待in-flight，独立实例0；稳定JSON双hash后复制所有JSON到F:\<正式目录>\var\upgrades\compact-memory-2026-10-19T06-59-28-265Z。Windows核对旧PID47308/路径/创建时间后Stop-Process，并非graceful SIGTERM。首次Windows PowerShell5.1不支持Start-Process -Environment，启动参数失败，已在同次维护用进程局部env修正并隐藏启动API86988，无需数据恢复；没有把启动失败写成成功。随后标准start启动ui36，ready=true/recoveryRequired=false/savePending=false。

主库整文件hash可因后台游标正常变化而不同；3150篇entries、3127媒体、settings/stickers/conversationServices、revisit config/deliveries/batches/comments分别hash一致。只读核对，不直接编辑正式diary.json；后台继续原daily-random/08:00规则和原游标，无重放。API健康/自动续推已回读。桌面备份D:\拾页\outputs\desktop-maintenance\backups\2026-10-19T06-57-33-828Z-fc8e34fa。

产物D:/拾页/outputs/2026-10-19-chat-compact-memory；临时D:/拾页/tmp/chat-compact-memory。详情ui-validation.json、memory-audit.md、api-memory-audit.md、api-import-graph.json、installed-verification.json。
