# 电脑随想聊天改进：独立规划初审

2026-10-19。角色：独立审核代理 Sol 高。结论仅为**规划初审，待需求草案复审**；未批准产品源码、构建、安装或部署。只读产品代码，不替实现者修复。此报告及 `outputs/2026-10-19-web-chat-improvement/review/` 为本代理唯一写入范围。

## 原始诉求与已确认范围

根会话转交的用户截图反馈：会话外观应在全局基础逐项微调；从会话列表进入设置，返回应回列表；切房卡顿、壁纸半截绘制；消息本地即时显示与远端同步解耦；图文消息撤回后重新编辑只回文字而缺图片；多选转发仍有 Telegram 的英文 comment/choose 等界面；原图上传疑似缺失。嵌套截图中的 share 弹窗残留须核实，不能将截图内所有叙述自动升级为独立已复现缺陷。

根会话随后转交用户确认：主入口为电脑随想 ui48 内的聊天 WebView；外观采用逐字段全局继承，支持单项覆盖、单项恢复及全部恢复；首批优先图文重新编辑与原图上传，再处理切换性能与外观。独立浏览器仅可作隔离辅助证据，不能代替主入口验收。

**后续用户明确纠正（现行）：截图及嵌套截图中的真实测试文字与直接提示词同等重要，必须全部登记和独立审批。此前“嵌套截图须核实、不自动升级”仅是旧阶段措辞，不得据此降级、跳过或以历史验收替代其中需求。需求事实登记与具体代码根因/修复验证仍分别记录。**

## 现有证据与证据上限

已读项目维护约定、工作区/交接/持续协调入口、测试策略，以及消息重编、会话切换、即时显示、会话管理、统一消息与共享壁纸相关契约。历史 ui48/chat-reedit2 已发布是文档记录，本轮未控正式窗口/服务，未独立复查运行态。

| 项目 | 现有依据 | 本轮不可据此推定 |
| --- | --- | --- |
| 重编身份与位置 | ui48 记录覆盖取消不撤回、新身份/原时原位、邻居 DOM 与长房分页 | 文字/身份样本不能证明图文附件已经端到端恢复 |
| 恢复原附件 | `shiyeWithdrawalUi.ts` 持久媒体 identity；恢复时读取 Blob，构造 File 并调用 `openChatWithDraft` | 有代码不等于附件模态、编辑状态、replacement 提交和持久重开共同正确；本轮尚未实际复现 |
| 原图 | `shiye-preview.js` 已有原图/清晰/均衡，默认 original；`buildAttachment.ts` 读取该项后调用共用压缩 helper | 不能将“缺少可见入口”与“实际上传被压缩”混作同一事实，也不能只补文案就称原件链已通过 |
| 切房 | ui19 有过冷门禁/目标版本/外观后锚点修复；旧报告有实际绘制与 DOM 时间的明确区分 | 旧基线不能排除 ui48 再次退化，DOM ready 不等于完整壁纸及可读消息已绘制 |
| 返回入口 | ui26 缓存表单记录真实父路由，旧验收称保留未保存字段 | 不能据旧设置内部返回样本，排除“从列表进入→返回”的当前缺陷 |
| 跨端壁纸 | 新共享图片/端独立图片/CAS/ACK 为候选契约，显示参数仍各端本机 | 不能在桌面外观修复中混入未获批准的 shared owner、壁纸绑定或手机 UI |

源码观察均为共享工作区当时读取值，只用于定位入口；候选实施前须以 ui48 冻结资产及逐文件 hash 确认实际基线。本轮未对这些路径下根因结论。

## 首批必须可验证的反例

| 编号 | 最小场景与通过条件 |
| --- | --- |
| R1 图文恢复 | 单图＋说明文字撤回后立即重新编辑；原文字、附件预览、原附件身份/顺序均可核对。确认后显示原墓碑＋原时原位新身份；原条后台不复活正文；邻居不重挂、不滚底。 |
| R2 持久恢复 | 完成撤回及本机恢复记录 ACK 后冷重开，再重新编辑并发送；原件字节或稳定资源可读取。缺原件明确失败并保留文字/恢复记录，绝不静默作为纯文字发送。 |
| R3 取消/并发 | 已有正文、附件、引用或编辑草稿时不覆盖；恢复途中切房、取消、第二窗撤回/编辑、发送失败/迟到 ACK 均不串房、不重复发、不提前丢原恢复材料。 |
| R4 相邻媒体边界 | 首批只在单图＋说明修复确实影响其它媒体路径时追加相邻样本。多图内部组模型由实现者调查，不是用户必须决策的前置条件，不以整组重写扩大此次问题。 |
| O1 原图可发现 | 选图/粘贴/拖入实际可用的入口中，用户能确认本次使用原图还是压缩；先明确全局质量与本次选择的优先级，不额外发明第二套处理规则。 |
| O2 字节原件 | 选含 EXIF 的 JPEG 与透明 PNG，原图模式在本地待发、持久恢复、上传后读取均与输入 SHA-256/长度一致；图片宽高相同不足以证明原图。显示缩略图可以另生成，不得替换原件。 |
| O3 压缩与失败 | 明确选压缩时符合既有档位，返回原图后新文件不再沿用压缩缓存；不支持格式/超限/损坏/上传失败给出可恢复状态，不伪报成功。只测此次实际受影响入口。 |

纯图片、图文、撤回后恢复、列表内直接编辑应分别记录是否支持与是否通过。若图文恢复需要改变媒体所有权、删除/保留规则或 journal 请求字段，应先同步对应契约并由后端独立验收；不得暗改 replacement 身份、时间或普通房单写归属。

## 后续 UI 与性能验收草案

外观最小真值表：全局字段 G1/G2；会话 A 只覆盖 G1，B 全继承。改全局后 A 的 G2 和 B 两项变化，A 的 G1 不变；A 单项恢复后继续跟随后续全局修改；全部恢复清空覆盖语义。显式 false、0、空值及“无背景”不得被 truthy fallback 当作未设置。旧整包会话外观不得自动变成新覆盖全部字段，迁移规则需写明。同步壁纸业务独立遵守其契约，不把显示恢复顺手解释为清除服务器图片。

导航最小路径：列表→会话设置→外观子页→返回，逐层回到原入口，恢复列表展开/滚动/焦点及未提交字段；当前会话齿轮进入则返回原聊天上下文。Esc、完成、返回、关闭分别验证，列表外部点击收起规则不得吞掉设置操作。

转发应验证文字、单图、图文的多选目标、附言、取消、重新打开与错误反馈；可见标题/按钮/占位/空态/通知完整中文，目标只列当前业务允许的会话。一次确认后按稳定操作身份发送，失败重试不重复，原消息及引用归属不改写。share 残留先记录进入动作、离开动作、是否仍拦截点击/焦点；未复现须标记未复现，不虚构修复。

性能建议先固定同机、同包、视口/DPR/116%字号、数据、壁纸像素、冷/热缓存和后台负载，再做 ui48/候选同条件对照。使用合成短房、长房与大壁纸，实际主入口补关键流程，不扫描私人正文。至少保留点击、目标 DOM、首个完整可读绘制、壁纸完整绘制、远端 ACK 五个独立时点；录像采样空隙须体现在误差范围。

建议可商定的首轮门槛（提议，非用户已承诺指标）：热切房每方向至少 10 次，点击到目标可读绘制 p95 ≤200ms；冷打开单列报告，目标 ≤500ms，超限先给路径分段而不靠缩短超时伪过。保留旧完整视图或稳定占位，不能出现目标壁纸半截作为稳定状态、旧房消息/草稿串入或永久 pending。快速 A→B→A 仅最终意图生效，所有过期解码/测量/请求不得回写。该预算若环境下基线不适用，应先说明并由根收口，不能事后改指标宣布通过。

本地发送在人工延迟 ACK 3 秒及失败/离线条件下仍应立即进入本机待发状态；建议本地首个完整可读绘制 p95 ≤100ms，主线程繁忙单列，不把持久 ACK 或远端 ACK 混为首显。并行大媒体上传时后续文字仍可本地显示，失败状态与保存状态清楚。实际保证持久化到哪一步须单独记录，不能为追求首帧取消保存保护。

关键帧需配主线程 trace：记录 >50ms long task 数量/最长值、解码/布局/绘制阶段及未改消息节点是否复用。采样不与其他测试并发；rAF 频率不证明物理 120FPS。缓存应有容量/字节边界、切房/换图失效和 object URL 回收规则；重复 20 次往返后观察已停稳内存及节点，不凭一次重启降幅或短测宣称长期泄漏解决。

## 审批门槛与剩余未定项

规划草案须明确：随想直接编辑与撤回恢复两入口；原图的本次选择/全局优先级及旧缓存处理；外观逐字段清单/旧偏好迁移；share 是否真实复现；性能预算及实际主入口证据方法。内部组模型由实现者核对，不要求用户先作模型选择。截图原文/图片仅保留私有诊断，公开产物只写合成数据与统计。

本轮不要求无关全库/全媒体/手机矩阵；复用证据必须给相同源码或资产 hash 与明确覆盖范围。交付分别写源码、隔离验证、主入口验证、构建、安装、实际启用状态。需求草案复审通过仅允许进入其明确范围的实施，不能据本报告执行正式升级。

## 主需求草案独立复审（第二轮）

复审对象为 `docs/WEB-CHAT-IMPROVEMENT-2026-10-19.md`、Astra 只读调查与 Sol UI 清点。根转交新增用户确认：图文可删换且确认时才撤回；新选图默认压缩，可手选原图；首版转发逐条保序；允许与相关安卓/数据会话消息协调；鼠标移入贴边窗口展开后激活并聚焦，直接输入。本文前段“原图缺省未定”等历史提议按此更新。

**规划复审结论：原始诉求及新增项已逐项登记，可按 A→B→C 加 D1 的分批范围推进，不必再等待一次用户总批准。A1/A2 可进入局部接缝实施及定向反例验证；当前仍不是源码或功能通过。** 根草案已覆盖直接编辑/撤回恢复两入口、可取消和已有草稿保护、原时原位新身份、真实原件字节、离线 ACK、设置返回、逐字段继承、顺序转发、share 核实、原生聚焦、冻结来源和跨端边界。协调消息已有用户授权，不需要本审核另设批准流程。

### A1 实施前必须补齐的内部语义

1. **附件意图必须可区分“保留／明确删除／替换”。** ui48 冻结 `src/lib/gramjs/client/shiyeLocal.ts:561` 使用 `uploadedMedia || original?.media`；无新上传就保留原图。若只清附件数组，用户明确删除的图会再次出现。这是本轮新删图需求的确定接缝缺口。应在现有本地编辑/replacement 上增加最小内部判别并纳入幂等指纹与本地事务，不要求为此新建后端协议；确认前不得撤回，取消保持原条。普通无附件重编、明确删图、换图必须分别验收。仅补 `chatId` 不能覆盖删图承诺。
2. **恢复请求有目标且异步结果有代际。** Astra 指出的 `restoreWithdrawal` 调 `openChatWithDraft({text,files})` 未给 chatId，与 `selectRequestedDraftFiles` 的房间匹配条件不合。补齐显式当前 chat/thread/type/原消息身份后，仍需处理 A→B→A、附件构造失败、用户先输入/取消、窗口另一编辑抢先完成。所有附件准备成功且当前意图仍有效后再提交编辑上下文；失败不消费唯一恢复材料，不能出现只恢复文字却允许当成功图文提交。不得为局部修复放松 worker 单后继校验。
3. **恢复既有原件与新选文件分流。** 下载回来的原附件是既有持久资源；当前全局质量可能已经改成均衡。恢复必须明确表示保留现有字节，不能让普通 `buildAttachment` 按当前设置再次转码，不能借 `shiyeOriginalSticker` 伪装媒体类型。用户主动替换的新图才使用这次选择的质量。原资源保留策略不得因删/换图删除其他条目仍引用的资源。
4. **首批以随想单图＋说明的真实问题为准。** 多图模型如被接缝实际影响，由实现者调查记录；不要求用户选择内部 group 模型，不把多图整组重写作为首批前置条件，也不外推所有媒体已通过。

以上是实施所需的确定语义，不是要求新增用户确认。Astra 方案遵守现有恢复 store、replacement 链、时间、worker CAS 和后端 owner 时可继续；如发现必须改 wire/owner，再按已授权协调流程先对齐相关契约。

### A2 最小实施与反例门槛

草案已确认默认压缩并保留旧显式偏好，具体缺省采用既有 balanced 或 high 可由根按现成档位技术收口、落入文档，无需再问用户。调查中称 clear 的名称应核对现代码 `high`，避免把文案写成不存在的存储值。区分缺省与旧显式 original；不因此次默认调整批量重写用户已保存偏好。

手动原图选择必须发生在不可逆压缩之前，或仍保留选入源 Blob 供重新选择；如果先按默认压缩再仅切 `shouldSendAsFile`，无法恢复源字节。至少验证“默认压缩添加→本次改原图”和“原图添加→改压缩→改回原图”，以及已有原件重编时改全局压缩不改变字节。保持一次明确质量决策，不新造第二套压缩算法。O2 的 JPEG/PNG 完整链为核心，其它格式仅按此次实际触及路径追加，原生/后端原件回读使用隔离库。

首批不扩展“未确认的新替换附件跨冷重开持久恢复”，不为此新增端内 schema 或接 Android 持久 job；该能力不是本次图文缺图修复的批准门槛。这里的冷重开反例仅指既有原消息/已撤回原附件及成功存下的原恢复记录仍完整。未提交替换稿的实际保留范围如实说明，不能以新稿丢失改变或破坏原条/原恢复材料；失败不得静默以纯文字代替原图文成功提交。

### B/C/D1 的剩余收口不阻塞 A

外观草案 C1 仍需在 C 批实施前列出确切字段。用户最新明确至少包括消息字号、输入字号、发送动效，不能只交付现有5项并称全部完成。壁纸图片身份与端内显示继续遵循既有独立契约。旧完整对象按显式覆盖保留，不能按与全局值相同猜继承。C1 清单不阻塞首批 A。

转发“逐条保序”应指同次所选源消息的既有展示顺序；每目标房各自保序且生成新身份。附言在多目标减为单目标时的潜在丢失是调查事实，需实际复现并列定向验证，中文翻译通过不等于转发功能通过。share 未复现可如实保留未复现结论，无须为满足列表虚构改动。

D1 已明确允许鼠标展开激活宿主，不应额外要求用户单击。实际鼠标移入贴边触发展开→一次激活→输入框焦点→直接键入为主入口证明；已有草稿/光标保持，设置/图片查看器/IME和非聊天窗口不能被重复焦点循环打断。DOM focus 或模拟器结果不能替代 Windows 原生激活证据。

性能统一以根草案热200ms/冷500ms/发送100ms为拟议工程目标；Astra调查更紧的100/250ms不是第二套审批条件。正式基线后再收口数值与样本量，无须为A批媒体功能先跑完整性能矩阵。

### 本轮复审状态

规划范围：通过，可继续局部实施。A1 内部附件意图/代际/原件保留三项须伴实现落文档并有反例，不得只补chatId后交付全部图文。A2需明确缺省档位和本次原图优先级，按上述源字节切换验证。当前产品源码、隔离界面、原生主入口、安装和启用均未获本代理新验收。下一步只审核 A1/A2 的明确候选差异与 SHA，不扩大无关检查。

## 场景纠正与首批收口（第三轮）

用户纠正此前内部组图问法：一直讨论的是**随想聊天页面**，思绪窗口似无此问题。独立审核接受纠正，撤销任何把“整组/单张”作为待用户决策或首批阻塞的表述；不涉及思绪编辑器改造。

首个实际 UI 对照必须是同一随想 ui48 夹具：单图＋说明发送后，路径一“撤回→重新编辑”观察缺图，路径二“列表内尚存消息直接编辑”观察原图是否保留；两条入口使用相同原件并记录附件预览、实际内容及恢复状态。先看该失败证据，再按最小路径修 A1。源码缺 chatId、二次压缩和删图 fallback 是已定位的接缝风险，但不能代替此处真实问题复现，也不要求在复现之前扩大持久层。

未确认的新选/替换媒体冷重开持久不属本轮已确认需求，暂停该扩展是正确收口；不会因此拒绝最小 A1。保留原消息、已存原恢复记录、原件引用及失败时不静默纯文字仍为硬门槛。后续评审优先真实 UI 证据和最小候选差异；本次范围纠正不改变“规划可推进、产品候选尚未独立验收”的状态。

## 随想单图真实 UI 基线：独立只读核证

依据 Astra 实际隔离运行生成的三张截图、`single-image-ui48-baseline.json`、同名测试脚本及冻结源，独立审核已确认本轮用户描述的**随想单图＋说明→撤回→重新编辑缺图**可复现。此处是审核既有运行证据，没有改产品、重复控制正式窗口、运行正式 API 或发真实消息。新失败证据索引为 `outputs/2026-10-19-web-chat-improvement/review/single-image-baseline-independent.json`。

### 实际加载来源

脚本 route 根为 `outputs/2026-10-19-chat-message-reedit/candidate-ui48/app`，外部 origin 拒绝，service worker 禁用，`overlay=false` 未被切换；浏览器为独立无正式 profile 的 headless Chrome，桥为合成回执。独立重新计算实际加载的122个文件 SHA，逐项同时与测试报告记录、`delivery-manifest-ui48.json` 比较，122/122一致。

实际加载的关键主包为 `assets/main-DOknOte4.js`（SHA `33ddb0a1afeb01ca00afa955f52f70d0193c0ea0e12b7c8a2c97c4ec33778e5b`）；实际 worker 包含 `index.worker-ReBrGYUg.js`（`ff28a3bbcb43f35d32c0db2ced6856580d3ca26c5f50601ba9ebba3b2556ce9c`）及 `worker-Dx232D9t.js`（`974fca56e519f2c0f3c733f8dc39e2270589c229d76c326f77b5bcc66548c51e`）。脚本初始遗留 ui47 字样只是元信息错误，不是实际 route；报告已改为 ui48 并以 `functionalPassed:false / reproductionCompleted:true` 区分失败复现与功能通过。空 `checks` 未作为通过证据；本代理独立四项观察核对另行保存在上述索引。

### 单条图文与两入口对照

1. `single-image-sent.png` 实际显示一条图片气泡及说明。消息状态为同一条 `id:11/chatId:-10`，同时含 `photo.id:101` 与 `SYNTHETIC_CAPTION`，无需假设多消息 group。
2. `single-image-direct-edit.png` 中原图片仍留在消息气泡，编辑摘要有缩略图，输入区有说明；报告 `directEdit.messageMedia` 仍同时含 photo101 和 text。**这仅证明直接编辑打开时图片仍在，尚未提交，不宣称直接编辑提交链已经通过。**
3. 撤回后实际 IDB 只读查询 `shiye-withdrawal-recovery-v2/recoveries` 的 `-10:11`，仍有 `chatId:-10/messageId:11/media:{mediaType:'photo',id:'101'}`。因此本例并非恢复记录没有媒体 identity。
4. 点击撤回提示的“重新编辑”后，`single-image-withdraw-restore.png` 出现英文 **Share with** 收件人选择弹窗，底部只进入说明文字；当前房仍为 `-10`，`requestedDraft` 含1个 File却没有 chatId。worker事件中恢复时请求 `downloadMedia(photo101)`，与源码下载后创建 File、遗漏目标房的路径一致。
5. 关闭错误收件人弹窗后直接发送，worker `sendMessage` 有 replacement11/root11但没有 attachment；报告及 `single-image-restore-submit.png` 中新条12替代11、保留原时间/根位置，而 `content` 只有 text，无photo。该本地提交结果是实际缺图延续，不只是预览隐藏。

源码因果交叉核对：`restoreWithdrawal` 下载成功后 `openChatWithDraft({text,files})` 未绑定 chatId；`selectRequestedDraftFiles` 仅消费目标chat相同的文件；`DraftRecipientPicker` 遇到 requestedDraft 无chatId时打开标题为 ShareWith 的选择器。本例“恢复文件已读到，但被交给选收件人的通道”同时解释了错误弹窗与编辑器没有收到附件。不能将其解释为思绪窗口问题、必须改内部group，或原图上传已证实失败。

本轮核证只批准“失败已复现”的事实。尚未批准补丁、A1修复、A2原图链、直接编辑发送、真实 WebView 生命周期、后端归篇/原件上传或性能。可据此进入先前限定的最小 A1 接缝修复，再以相同单图对照及必要反例独立复验。

## C3 新增：收件人及多选复用入口的整体适配

用户明确追加：“选择收件人在别的地方比如多选也会出现类似情况，这些地方都重新做好UI适配。”这扩展了 C3 的可达 UI 范围，不能将其简化成修复恢复时误开弹窗，或只翻译4个键。仍不阻塞首批 A1 单图最小修复，不把尚未证实可达的 Telegram 分支强行新实现。

独立验收先以 Sol 调用图和实际入口清点为基准，逐项标记“当前产品可达／代码存在但未证实可达／本产品明确不适用”。范围至少覆盖消息多选、转发的目标会话选择、附件发送/草稿恢复的收件人分支，以及清点中确认实际可达的其它 picker。同一复用组件可以共用适配与证据，但调用者传入语义和返回状态须按实际入口检查；不能因为组件同名就将所有入口一起标通过。

| 验收维度 | 必须观察的行为 |
| --- | --- |
| 选择对象清楚 | “选择消息”与“选择目标会话”标题、说明、已选计数及确认动作可辨；单/多条和单/多目标计数准确，不以英文 Share/Choose/Comment 混淆流程。 |
| 中文完整 | 标题、按钮、附言占位、目标项、搜索/无结果/无可用目标、错误与完成反馈按实际可达路径适配，数量变化和已有选项不漏译；不靠通配替换运行时 DOM 文本。 |
| 返回与取消 | 返回回到真实上层选择/消息上下文，取消不发送；再次打开不复用上次错误目标/附言；多目标减为单目标后已有附言处理明确，不静默丢失。 |
| 焦点与状态 | 鼠标/键盘操作与 Esc 关闭后恢复入口焦点；保留原消息选择、当前草稿、附件及编辑身份，不错误切房，不因 picker 关闭触发普通发送或覆盖输入。 |
| 弹窗归属 | 只有业务需要选择目标时才打开；已知房间的附件恢复不再次问收件人；一次操作只出现一个应有 picker，不同时残留旧遮罩/第二弹窗/不可见焦点陷阱。 |
| 发送结果 | 逐条转发保原展示顺序并生成目标新身份；重复确认/迟到响应/失败重试不重复，不改原消息；附言和图文在已确认范围内完整保留。 |

测试按有差异的调用语义选最少代表路径，而非所有组件机械全矩阵：普通文字两条多选→转发目标选择；图文选择→目标选择；取消后重开；搜索无结果/无可用目标；实际失败反馈；A1已知房间恢复应完全不打开收件人。若某入口与已有样本完全共用且调用字段同SHA，可明确复用；新出现状态或入口另补最小对照。

当前4键文案候选仅可标“局部本地化候选”，不能标“C3全入口已完成”。后续提交应附入口清单/实际截图/同包SHA、每个可达入口的覆盖或复用依据及仍未验项；不要求为不可达分支新建功能、不以此扩大正式服务/手机操作权限。

## B0 新增：窗口与各会话上下文记忆

根转交用户确认：两类记忆均需要。其一为窗口位置/尺寸及上次会话；其二为每房阅读位置、草稿、已加载内容。该项与壁纸、消息渲染和切换的实际流畅度共同验收，不因内存中曾有DOM或一次重开选中同房就算全部完成。

| 条目 | 代表场景与验收依据 |
| --- | --- |
| 窗口几何/目标 | 正常收起唤回、关闭重开后，位置/尺寸和上次会话符合现有两屏/DPI规则；不把屏幕断开后的安全钳制判为记忆丢失，也不让窗口恢复到屏外。只读回读存储值与真实窗口几何分别记录。 |
| 每房阅读锚点 | A在历史中段、B在末尾，往返/重开分别恢复自身锚点。比较稳定消息ID及视口内偏移；新来信、历史分页、字体或图片尺寸变化后不恢复到错误条，不将A偏移套到B。处于末尾时遵守既有跟随语义，中段不强滚底。 |
| 每房文字草稿 | A/B各有独立文字及引用上下文，切换、收起/唤回、正常关闭重开后不串房不丢；恢复不覆盖更晚已输入内容。需要保存ACK的阶段分别列明，不能把内存可见当持久完成。输入法未提交态、选区/光标按现有可保证边界如实记录。 |
| 已加载内容复用 | A加载过的一段历史再次返回时尽量复用，不反复先清空再拉全房；记录命中内容范围、节点复用/重建与可读绘制时点。缓存过期或被逐出时正确重读并恢复锚点，不能用永久保留全房DOM和解码图换取热切成绩。 |
| 新旧数据失效 | 编辑/撤回/删除、乱序ACK、历史同步、房间归档及新消息后，缓存以会话/线程/类型和身份/修订失效或合并；旧请求、旧壁纸解码、迟到恢复结果均不能覆盖当前目标。 |
| 容量与释放 | 给出房间/消息节点及解码字节预算，覆盖页数上限和LRU/逐出规则。20次有代表性的切房后停稳，节点/URL/缓存应回到设计边界；object URL释放不早于最后消费者。报告实际计数和长任务，不以短测宣称长期泄漏根治。 |

该需求不要求“全部已加载历史永久持久为DOM”，实现者应区分持久消息数据、阅读锚点/草稿和有界渲染缓存；用户关心再次使用时上下文和流畅度。离线重开时缓存范围、缺页或媒体暂不可读须清楚，不伪造已经同步完整。

B0为后批独立验收，不扩大当前A1到“未确认新替换附件跨冷重开持久”的新schema。A1仍先完成已确证单图恢复及确认事务保护；B0接线若涉及共同偏好namespace、同步owner或数据字段，继续按既有跨端协调边界处理。当前仅准备审核条目，无新增B0源码或功能通过结论。

## A1 候选收件状态

根转交Astra自验：`compiled-a1c`已在同一实际UI路径恢复图＋说明、无错误Share with；确认后新身份替代原条并保date/root。首候选`resetComposer`异步读取媒体意图的竞态已留失败证据。以上仅是实现者报告，独立尚未审核精确manifest、差异、SHA和取消/删图/失败/原件字节证据，不能写A1已通过。收到明确冻结候选后切换为A1独立源码及隔离复审。

## 截图逐句覆盖的严格复审（先于A1源码审批）

独立直接查看两张原图：`D:/UserTemp-1001/codex-clipboard-6dad90ed-f6ea-42ec-820f-e64c952edf9c.png` 与 `D:/UserTemp-1001/codex-clipboard-a79ec5fd-8f62-47d0-afb7-12d3a1ce7b3f.png`，逐句对照 `docs/WEB-CHAT-SCREENSHOT-FEEDBACK-2026-10-19.md`。**SF01–SF15覆盖所有可可靠读取的用户反馈文字，需求登记完整性通过；该通过不等于任何功能通过或整轮验收。** 两图的大背景文字/界面元素不代替用户消息，嵌套最小截图细字目前确实不可逐字可靠读取；获得可读证据后应追加，不能因此忽略其外层或其他已可读嵌套意见。

已独立逐项确认：SF01/02全局基础微调与参数难理解；SF03设置返回列表；SF04/05/06卡顿、半幅壁纸和连续过渡/性能；SF07/08预同步与手刷动效；SF09发送本地首显；SF10/11撤回图文与share；SF12本人撤回两分钟；SF13转发框架与多选；SF14原图；SF15数月44万多字符与日记60多万字背景。原话转录可按中文标点整理，不得改变“平均超过100字符”等原话含义，统计仅作为负载背景，不当真实库清点结果。

**SF12为独立硬项。** 原图说的是“撤回依旧限制两分钟”，必须分别验证本人消息撤回、尚存条直接编辑、墓碑重新编辑三个动作。实际菜单可见性/入口可用与执行结果均需超过120秒及冷重开样本；禁止用ui48不限时编辑的既有证据把本人撤回直接标完成。若实际三动作均不限时而用户曾看见限制，仍须记录当前同包入口与证据，不以否认旧反馈结案。

SF03完整链为“列表展开/位置/预选→房设置→外观或程序子页→房设置→原列表”，同时覆盖保存/取消/Esc/返回与脏表单规则；不是只检验返回任意设置父页。SF08必须真实具有预同步/手动刷新及进度/失败/重试动效，不能只证明首显不等ACK。SF15要求代表性的长期累计文本负载与有界DOM/缓存，不能只跑数条短消息。以上均为后续分批待验，A1局部结果不得替代SF01–SF15总体验收。

## 原权威入口复核

独立已只读核对 `CHAT-UI-OPTIMIZATION-2026-10-16.md` 顶部本轮完整操作/需求表、`CHAT-UI-REQUIREMENTS-AUDIT.md` 与 `CHAT-MANUAL-CHECKLIST.md` 接续条目（含M03图片质量、N01三动作及两分钟旧描述纠正）。**需求已回到原权威入口，沿既有开发/审核/发布流程；WEB文档仅作为本轮执行和证据补充，不是平行需求体系。** 需求登记完整性结论继续成立，SF01–SF15尚未整体功能通过。旧版历史文本如与顶部现行约定冲突，仅保留历史，不代替本轮操作和实际结果。

## A1d 独立源码与实际反例复审：不放行

候选来源为 `tmp/web-chat-improvement/astra-candidate` 与 `compiled-a1d`。独立逐项重算15个增量源SHA、既有源基线SHA，并读取对应source-map全文：14个TS/TSX全文SHA与候选一致，均有编译映射；第15个`app/shiye-preview.js`是A2缺省文案候选，未进入A1实际路由，不能算A2通过。证据 `review/a1d-independent-manifest-proof.json`。源码仍沿legacy owner/replacement链，无新HTTP字段或新归篇算法。

实际功能反例在本代理专属隔离Chrome/真实ui48底座＋a1d编译覆盖/真实worker/IndexedDB/合成桥中执行；脚本及截图仅写 `review/`。这些是功能反例，不作性能采样，也没有正式窗口、服务或设备操作。

| 反例 | 独立结果 |
| --- | --- |
| 真实Blob读取延迟，用户在当前输入框先输入新稿 | 通过：`NEW_TYPED_DRAFT`保持，无编辑ID/附件半提交；旧准备结果被拒绝。 |
| 真实Blob读取延迟，使用既有Esc direct模式键盘离开A再返回A | **失败**：实际房序`[-30,-20,-10]`后释放原Blob读取，旧恢复仍触发prepared event并弹入图文编辑，editingId11。应拒绝的过期准备被重新接受。 |
| 失败后再次新鲜恢复 | 通过：能重新进入图片＋说明编辑，未开收件人；不是把修复变成永久不可恢复。 |
| 单次点击附件框取消 | 通过：编辑ID及附件框均退出。原消息/恢复材料的完整性仍结合实现者同包正常样本和本地记录核对，不泛化所有媒体类型。 |
| 真缺原件冷重开→媒体下载失败终态 | 通过：单独冷缺件夹具实际6次downloadMedia后显示“原附件暂不可读取”，输入空、无编辑ID/附件框、IDB恢复记录仍在。证据`a1d-independent-missing-terminal.json/png`，不是只等2.5秒未提交。 |

键盘失败源码原因：`shiyeWithdrawalUi.ts`的epoch目前只监听hashchange/input/compositionstart/pointerdown；实际产品切房生命周期并不保证产生hashchange，键盘切房没有pointerdown。仅比较最终chat/thread/type无法识别A离开后返回。必须接既有同步切房意图/生命周期使每次离开递增代际，并保留输入/取消保护；不通过取消读取、改延时或宽松最终房ID比较绕过。已有 `shiye-room-switch-start` 可由实现者核对复用，不需要另造切房流程。

首轮完整反例脚本在真缺件步骤20秒等待超时已保留：该轮此前反复成功读取photo101，媒体缓存仍留有效原件，单删documents不足构成真缺件，因此此超时只算夹具前提不成立，不列产品缺陷。独立另起冷夹具后已观察到终态并通过。脚本、初次失败、键盘记录与后续独立缺件证据全部保留，不宣称首次全过。

当前结论：**A1d不放行，退回修复真实键盘A→离开→A代际缺口后复审。** 已通过输入/取消/真缺件终态不能覆盖该失败；A1e需精确源及编译SHA，并复跑这一失败与必要相邻场景。媒体重试意图、SF12三动作/残留文案、A2原图全链及SF总表仍各自待验；实现者正常整数后继/原件SHA/删图自验不自动替代独立总通过。

## A1e 对既有失败与核心正常路径的独立复验

实施者保留d，另冻结 `astra-candidate-e/compiled-a1e`；相对d只为恢复epoch接入既有同步 `shiye-room-switch-start` 并补说明。独立再次校验15个增量源、基线SHA及14个TS/TSX全部编译source-map全文一致（`a1e-independent-manifest-proof.json`），未将新增静态A2缺省文件当A1实际资产。

`a1e-independent-counterexamples.json` 实际复跑原失败：恢复Blob读取暂停→真实Esc direct按键依次到`-30/-20/-10`→放行读取，preparedCount保持0、无编辑ID/附件弹窗。**原A1d代际缺口已独立复验修复。** 晚输入保持新稿、随后fresh恢复可用、一次取消退出三项也通过，不是只跑纯函数。

`a1e-independent-submit-ui48-baseline.json` 独立从同包创建图文、直接编辑取消、撤回恢复、修改说明，再用真实鼠标对保存按钮30ms双击：仅一条整数12替代11，图文齐全、date/root不变、无错误收件人弹窗；真实IDB原件101及恢复102均PNG2666字节，SHA一致。再次直接编辑新条、明确删图并确认，整数13替代12只有文字，旧图没有复活。已实际查看提交/删图关键截图。

最初试用`HTMLElement.click()`未触发桌面Button的fast mousedown处理，导致等待超时；这是本代理测试事件模型不完整，保留于`a1e-script-click-missing-mousedown-harness.json`，随后改用真实鼠标dblclick完成上述验证，不列产品缺陷。原d真缺件终态证据可按下载器/原件读取逻辑未变的精确范围复用；e仍增加同步切房失效保护。

当前仅确认这些明确A1源码/隔离场景通过，**不等于A1所有反例、SF12、A2、整轮UI或正式运行放行**。失败媒体重试的意图一致性、SF12原消息年龄与撤回后经过时间分开、最终同包提示文案、原生主入口均继续单列。无安装/部署操作。

### 旧图文与撤回后实等122秒的证据复核

接续时不重复已完成的实等。独立读取 `astra/candidate-e-old-media-ui48-baseline.json`、测试脚本和恢复/提交图片，重算其全部实际加载资产SHA（含e编译包），记录 `review/a1e-oldmedia-independent-evidence.json`。原消息在专属合成IDB中设为45小时前后reload，实际年龄162001秒；撤回后记录起点`1792438666031`，以4段30.5秒等待，真实累计122045ms，再reload并恢复。不是以原消息年龄替代撤回后经过时间，也没有假时钟加速。

同一e包的直接编辑可打开原图＋说明、取消不撤原条；撤回超过122秒后reload，恢复附件框可用，无Share误开，提交整数12替代11，date=`1792276663`/root11保持，修改说明＋photo102齐全；101/102均2666字节且SHA一致。随后明确删图也没有复活。上述源/运行元信息、字节与图像证据一致，**SF12相关的旧图文年龄与撤回后>2分钟本机恢复/本地提交场景可据此通过**。

边界仍是隔离Chrome模块冷重开，不是原生宿主完全关闭/手机/真实服务器归篇。当前e尚未包含Sol那一处错误“两分钟内”提示文案候选，文案源码局部正确不等于最终同包显示已经改正；SF12整体须待其同包确认，不提前全部勾选。

### 失败媒体重试接缝与新增换图取消反例

独立实际worker测试`review/a1e-media-retry-independent.json`通过：在真实发送边界仅一次注入损坏Blob，得到显式failed的本地11.000002及`replacementMediaIntent:'replace'`；用原附件＋真实失败localMessage重试实际worker时，刻意不传params.replacement，仍从localMessage恢复replace意图，生成唯一整数12/photo102＋修改说明，date/root11保持，失败本地身份被映射消除，无纯文字降级。已查看失败红标与成功帧。边界是测试协议触发worker重试，不能代替用户可见重试入口或真实服务器上传验收。

**新增A1e失败，整体继续不放行：更换附件准备中取消，晚结果重新打开普通发送框。** 独立实际路径为原图文11→直接编辑附件modal→drop新PNG（1872741B）→测试只暂停该File的arrayBuffer（`compressUpload`等待，`buildAttachment`尚未完成）→真实点击取消。取消后modal关闭、editingId空；放行File读取后1.8秒，再次出现“发送1张图片”的新发modal，已脱离原编辑。原条photo101虽未丢失，取消状态却被晚任务反转。errors为空，三项观察中“晚结果不再打开取消UI”为false，证据`a1e-replacement-cancel-independent.json/png`及同名脚本。

源码接缝为既有`useAttachmentModal.handleAppendFiles/handleFileSelect`在await buildAttachment后调用最新handleSetAttachments，缺少cancel/原编辑身份/chat准备代际守卫；恢复epoch仅保护开始恢复原件，不覆盖用户进一步选择替换新图。最小修复须在现有附件准备路径确认请求仍属当前上下文，取消/切房/输入或附件上下文改变后丢弃并释放晚结果，不能通过关闭新弹窗掩盖。此项是用户已确认“可以删换附件、取消不动原条”的必要反例，不扩展新附件冷重开schema。已向实现者交精确入口和等待边界，e保留冻结，待f独立复验。

## C2/C3/SF12 冻结局部候选独立复审

对`sol/frozen-c2c3`及`compiled-c2c3-final`独立查看完整差异，重算9个源文件SHA与6个source-map映射；fallback.strings的raw模块解码后逐字等于冻结原文。实际独立加载122资产SHA全部匹配记录，证明没有拿可变sol-candidate后续C1改动代替冻结。证据`review/c2c3-independent-source-proof.json`。

本代理从冻结源重新运行真实UI，`review/c2c3-independent-ui.json`的23项定向断言通过（这只是本轮独立断言数，不与实现者分阶段30项相加）包括：

- 真实侧栏非零scrollTop120，进入根设置/房设置/程序子页保持展开；dirty字段在子页Esc/回房/回根/重开缓存保持；dirty关闭选择继续保稿，取消与根Esc回原侧栏及120px位置。
- 管理列表房设置取消/Esc/保存返回真实父页，保存标题及时反映；侧栏当前房真实右键进入设置再取消回列表，焦点离开已销毁设置页面。
- 真实右键多选，消息计数“2条消息”；选择两目标为“已选2个会话”，中文无结果可见；取消目标保留消息选择，取消多选清选择并保原两消息。已查看目标计数/空态截图。
- 同一编译包本人撤回确认显示“成功保存在本机且仍可读取…不限时重新编辑”，没有旧“2分钟内”，取消后原条非墓碑。已查看`sf12-independent-confirmation.png`。

源码遵循原settingsParent/session，侧栏上下文仅在同一当前房恢复；没有第二套路由或数据owner。翻译生成器只改受控声明/必需缺失键，保留现有其他生成流程。局部文案/SF12及上述C2路径可进入后续合包验证。

**C3整体仍未通过。** 当前仅批准上述选择/计数/取消/空态与中文路径，不能外推全部可达picker、合法图文转发/逐条顺序、附言从两目标减一目标的保持、已有草稿附件、错误/重试/重复确认。共享`ShareWith`统一成“转发到”对真正转发适用，其它实际发送草稿收件人入口仍应按业务角色验收，不能以全局翻译代替角色适配。原始passed:false和selector等待失败保留，不将后段补验抹成完整同包矩阵全跑。

## B3 算法机制独立预审（候选前）

已读Astra`resize/algorithm-audit.md`及其正确中段基线：同一字符过程偏移526.53px，但28节点未重挂、worker0、longtask0；因此当前可确定的该夹具缺口是内容位置保持，不能把它表述为重建整房/同步瓶颈或正式实窗全部卡顿根因。

三文件拟落点（useContainerHeight宽度signal、MessageList现有newScrollTop决策、shiyeRoomViewport临时内容Range/媒体锚）沿已有capture/attach/revision，可准备独立源码候选。**只有MessageList既有滚动owner最终写入scrollTop；viewport工具只提供有效锚/候选top，不自建每帧补偿写入者。** 宽度signal触发现有布局effect；补偿消费按container+revision，resize引起的scroll不能先覆盖旧字符锚，须和真实wheel/键盘滚动意图区分。底部/发送/分页沿既有路径，不把字符补偿再次叠到旧补底结果。

Range节点断开、正文revision/后继或目标改变时释放并回既有消息锚；媒体按identity/图内比例另作明确回退，不把旧Range投到新文本。一个容器只留有界临时锚，cleanup/switch失效；持久schema和消息算法不改。该结论仅是可进入局部源码候选的机制预审，尚未批准算法、收益数值或关键帧；与A1f隔离，不能以B3候选替代未完成B0/壁纸/原生resize验收。

## A1f 复审与新的准备中提交缺口

f保留e，新增既有`useAttachmentModal`的局部准备代际，沿原ordered batch和URL释放规则。16源/15TS/TSX映射全文SHA独立匹配，记录`a1f-independent-manifest-proof.json`。

原e的真实换图取消失败在f中独立转过：File读取暂停→取消→释放，不再弹普通发送框，原图保持。新File准备后切到B，晚结果也没有进入B。有效新文件替换以实际预览natural尺寸777×333就绪为条件后确认，整数12含新图＋修改说明、原date/root保持（`a1f-normal-new-image.json`），不是靠固定时长猜完成。

保留并纠正两类本代理probe问题：Modal外壳是relative零高、内容层fixed，直接等待外壳可见会误判；截图已证其实际可见，应等caption子节点。切回A后原编辑身份按已有逻辑仍在，启动另一次直接编辑前须先真实取消现有编辑，否则拒绝是保护而非故障。连续上下文夹具中固定等1.3秒后旧图未被替换、caption未更新的结果未定位前不列产品缺陷；实际有效新图以自然尺寸条件另验已过。

**f仍不放行A1整体，准备中确认会提交旧图已独立实证。** 专属夹具在direct edit旧图11中drop新PNG1872741B，仅暂停该File.arrayBuffer；此时保存按钮`disabled:false`。真实点击保存，在新File仍`held:1`时，原条11已成墓碑，整数12实际提交的仍是旧240×160图。`review/a1f-submit-during-prepare.json/png` errors为空、核心断言false，不能以“用户点了确认”把未完成换图意图悄悄当旧图成功。

原因与最小门槛：新文件尚在await buildAttachment/compressUpload时未进入attachments，现有`attachments.isPreparing`不足以表示source准备中。新g需复用既有附件状态/提交路径，把该忙碌阶段同时接入保存按钮与实际提交guard（键盘同约束）；取消仍可用，切房/失效旧准备不得把新房锁住，旧稿/原件不丢。不得只禁用外观、设置固定等待、或扩大新附件冷重开schema。f冻结等待Sol修复后只复跑这一失败与必要相邻。

最新用户角色调整已遵循：Astra只负责规划，Sol负责代码/构建/UI及性能执行，Sol高保持独审。之后实现缺陷只交根与sol_execution，不再要求Astra继续实现；既有已过e、真缺件终态和122秒记录精确复用，不因角色切换重测整套。

## C1/C2b 冻结局部候选独立复审

基于`sol/c1-c2b-manifest.json`核对`frozen-c1/frozen-c2b`及各自前驱SHA均一致；独立实际浏览器只路由对应冻结wrapper＋既有frozen-c2c3 workspace/compiled-final，未读可变sol-candidate。源和加载资产复核为`review/c1c2b-independent-source-proof.json`。

C2b独立4项通过：直接以房设置为session根的dirty表单，Esc后提示所在dialog确实open；继续保持稿和open状态；明确取消后销毁；重开不复活取消稿。它修复的是先前未被C2“全局根→房子页”路径覆盖的直接房根分支，不拿先前23项代替。仍沿settingsParent/requestSettingsClose，没有第二导航状态机。

C1独立23项通过（`c1-independent-ui.json`）：十项显示字段（旧五项＋字体、消息字号、输入字号、消息位置、发送动效）逐项继承；旧完整五字段保持显式覆盖；同值覆盖不被猜成继承；保存前不持久；116%模拟native缩放只施于消息，输入字号独立；其它房跟全局；真实同context另页storage事件更新继承项、未覆盖项；恢复单项/全部的保存与取消；持久写失败保留原存储/有效值与dirty表单；未知JSON中的false/0保留；reload及小数字号精度保持。另单独核对有效房动效instant覆盖、全局legacy时，全局编辑控件仍显示legacy，未见作用域混淆（`c1-global-mode-control.json`）。

此处“十项”范围已包含用户追加字号/动效；壁纸业务绑定与端内显示仍按原契约，不借全部恢复删除服务器图片。C1/C2b源码与上述隔离功能可进入后续合包验收；不表示真实多屏/原生宿主、后端偏好同步、全部设置路径或C3整体完成。独立23/4项不与实现者同内容断言相加；原用户体验框保持未代勾。

## A1g 准备门禁独立复验及说明输入相邻失败

精确候选为`tmp/web-chat-improvement/sol-a1g`、`sol/compiled-a1g`、`sol/candidate-g-source-manifest.json`。本代理重新计算17源（16 TS/TSX）和全部source-map全文SHA；相对f仅Composer、AttachmentModal、useAttachmentModal三源改变。17比f多1是清单新增已有AttachmentModal条目，并非新增业务owner。记录`review/a1g-independent-manifest-proof.json`及`a1g-independent-runtime-proof.json`；实际运行路由保持ui48冻结wrapper＋g编译，未将候选静态A2文件加载为已验功能。

**可接受的局部源码范围：** 同步source准备ref与渲染busy、Composer实际发送guard、附件modal禁用状态，以及取消/切房清busy和有代际的旧任务收尾。独立三段真实UI共有5/6/4项通过，分列而不与实现者自验相加：

- `a1g-independent-submit.json`：原图编辑中hold新1000×600 File读取，按钮disabled；实际Enter及桌面mousedown入口均不撤旧条、不造后继；放行后等新预览自然尺寸就绪，真实保存整数12包含新图＋修改说明。
- `a1g-independent-cancel.json`：源仍held时单次取消清编辑；重新编辑并hold另一新源，先放行上一轮取消任务，新的busy仍保持，Enter不提交；第二次取消/放行没有晚弹窗，原图/原ID完整。
- `a1g-independent-room.json`：A源held时打开B，键盘文字立即得到唯一整数身份，未被旧busy锁住；放行A旧源不在B弹附件、不提交A替代，原条保持。

本代理首轮取消夹具未等关闭动画收尾即重新编辑而超时，记录保留`a1g-independent-cancel-first-harness-timeout.json/mjs`；另一次小纯色图没有进入要暂停的压缩读取路径。最终明确等待原取消收尾，第二张仍用确实进入File读取的随机像素源。上述夹具失败不列产品缺陷，也没有将无检查的脚本退出码当通过。

**A1图文删换整体仍不通过：同一编辑框在新图准备中修改说明，会静默丢弃新选择，恢复可提交后实际发送旧图。** 真实隔离路径为原11/photo101（240×160）→直接编辑→drop新PNG1000×600、暂停其File.arrayBuffer→同一附件框输入`G_CAPTION_TYPED_DURING_SOURCE_PREPARATION`→放行读取。busy解除后保存可用，实际预览仍240×160、没有失败提示；真实保存得到整数12/photo102，新说明正确，图片尺寸仍240×160。errors为空，两个断言一败一过；`review/a1g-independent-caption-during-prepare.json`和`a1g-independent-caption-source-{ready,submit}.png`均已独立查看，不是固定等待猜测或没有触发保存的纯状态检查。

原因是f已有的全局`input/compositionstart`失效逻辑同样作用于`handleBuildFiles`的附件准备epoch。说明内容变化并未改变同房/同编辑消息/用户选择的新源，当前却丢弃整个新附件；g的finally解除busy后，旧附件重新可提交。最小下一候选应区分同一编辑的说明更新与取消/切房/新附件身份失效，保留最新说明和已选新图，或在真正准备失败时显式阻止静默旧图成功。恢复原件入口的晚输入保护仍须保持，不能全局取消保护；不增加新附件冷重开schema。

已向根及Sol执行交精确脚本和等待边界，g保持冻结。门禁局部允许纳入后续候选，不能据此批准A1整体、C3、A2原图、原生宿主/服务器/部署。既有e正常恢复/SHA/删图、真缺件终态、122秒证据按未改下载器/worker边界复用，不重跑全套。浏览器已关闭释放，尚无正式动作。

## A1h 精确失败收口与允许合入边界

候选`tmp/web-chat-improvement/sol-a1h`及`sol/compiled-a1h`冻结后独立复核：17源/16 TS/TSX的manifest、基线及编译map全文SHA均匹配；相对g实际仅`useAttachmentModal.ts`一源变化，hook SHA=`63eb20975ca12f2de2cd0b32805d245998da9af33dc0d5792f7a0fa0f29f10fd`。h在同一附件说明contenteditable内豁免input/compositionstart的源准备失效，其余输入仍调用原invalidate；cancel/switch/新准备/附件与编辑上下文保护保持。恢复原件的`shiyeWithdrawalUi`晚输入守卫未改，不以豁免说明编辑取消它。

本代理定向重放g的精确失败，`review/a1h-independent-caption-during-prepare.json`4项通过：新源hold期间实际改说明仍busy，真实Enter＋桌面mousedown不提交旧图；放行后真实预览1000×600，确认所得整数12包含新图＋最新说明。g曾提交旧240×160图的反例已转过，已查看新预览与提交关键帧。

必要相邻仅加同框caption与组合输入边界，不重跑e/122秒：`a1h-independent-cancel.json`6项通过（源held改说明后取消、下一轮准备、旧轮完成不能解除新busy、键盘保持拦截、两次取消不晚弹窗且保原条）；`a1h-independent-room.json`4项通过（源held改说明后切B，B键盘即时得到唯一整数，旧A结果不串房/不替代原条）。组合输入部分使用成对compositionstart/end测试事件，属于事件边界验证，不能称真实系统中文IME验收。首轮夹具只发compositionstart未收尾导致重新编辑等待失败，保留`a1h-independent-cancel-incomplete-ime-harness.json/mjs`，补齐结束事件后通过；该夹具错误不列产品问题。

三段实际每段121个加载资产SHA重新匹配，并逐段确认承载新hook的`useConnectionStatus-XC6eW3DS.js`确实加载，详见`a1h-independent-runtime-proof.json`。h编译目录残留未引用chunk/map不算运行证据，不用“目录中存在正确map”替代真实入口加载链。

**审批：允许h的A1恢复/图文删换与源准备守卫源码候选进入后续集成；本轮已复现的d/e/f/g阻断反例在对应修复与必要相邻范围内均已收口。** 已接受的e恢复原件/同字节SHA/原时原位后继/明确删图、真缺原件终态、媒体重试协议、旧图文与撤回后真实122秒，按下载器/worker等同SHA范围继续复用，未进行全套重跑。C1/C2b先前局部审批不变。

此处不批准整轮发布或A1正式主入口体验：用户可见失败重试按钮/真实服务器原件上传、原生宿主全冷启动、与SF12新文案/C1/C2b/C3的最终同包集成仍须在各自冻结范围验收。C3合法转发、A2每次原图选择、B布局/壁纸/记忆、D1原生聚焦也未由h代勾。没有新需求或批准流程，未操作正式服务/窗口；独立浏览器已关闭释放。

## C3 业务冻结独审：正常链通过，三个明确阻断未收口

冻结为`tmp/web-chat-improvement/sol-c3`、`sol/compiled-c3-business`。独立计算manifest SHA=`df89685d5a229c6210aaeedb4d03bfb329852870f8af91b4e6c359aca68d357f`、diff SHA=`b31126c4d2ccf3e7f33f487e1b15a57d70ae2c1c8557ddd72bd34342cd3fb344`，30源/26源map全文（raw文案模块解码后比较）均匹配，h已有源的SHA保持。辅助生成器两文件以既有`previews/telegram-chat`原文件补核h基线，未将增量目录缺少未改文件误判为候选不一致。记录`c3-independent-manifest-proof.json`。

实际独立路由只取ui48冻结app、frozen-c2c3的wrapper/workspace和C3编译包，不取可变工作wrapper。六段每段120或122个实际加载资产SHA匹配，且每段实际加载`worker-DhPgV6zA.js`，详`c3-independent-runtime-proof.json`。C1/C2b最终wrapper合并另验；目录内未引用旧chunk不算运行证明。

按原`CHAT-JOURNAL-REQUIREMENTS.md`逐条转发/幂等/端内回执契约，独立通过以下范围，不与Sol断言数相加：

- `c3-independent-base.json`11项：真实UI多选文字＋单图说明→普通目标会话，得到保序整数13/14，原两条完整JSON保持；真实IDB两条回执；同worker相同请求及reload后新worker重放不重复；目标撤回后重放不复活；归档目标显式失败、整批无新增；真实右键“重试转发”仍沿原requestId得到唯一整数。目标墓碑实际保留最小localForward，而对应withdrawalOutbox剥离它，符合已对齐端内边界。
- `c3-independent-ackloss.json`5项含种子：实际worker已经把两条回执持久化后，主线程测试监听拦截真实成功更新，并注入“持久化后确认响应丢失”失败通知；调用既有retryLocalForward动作，回原整数身份，实际持久两条ID/requestId/正文完全一致，失败别名收敛且不重复。此段是动作级ACK丢失重试，不冒称该注入场景也完成真实鼠标入口；真实右键入口在上一段另验。没有修改worker或bundle；故障通知为测试注入，不声称生产已有ACK丢失自动判失败超时。
- `c3-independent-missing-media.json`3项含种子：保留原media元数据与size、仅使合成原件bytes为空，reload后调用真实worker转发文字＋图文新批次。两条均显式failed，整份持久library前后完全相同，未给文字一条单独成功或先分配ID写入。不是helper断言，也没有把“方法返回undefined”当业务成功。

保留夹具限制：首轮2→1切房过渡出现两个同ID输入节点，已改等目标aria-label＋contenteditable=true，实际确认后才测丢附言；ACK丢失前两次未完整隔离integer新消息、失败别名不在当前DOM，故未拿菜单等待超时列产品缺陷，改用明确动作级重试，并保留报告；第三次比较含BigInt未归一化，修正断言序列化后完成。缺件首两夹具直接移除资源记录，冷重载时现有createMockedPhoto即因“No such document”不能完成初始化，无法进入本次worker转发前提；不将它算整worker缺件通过，也未证明是新C3回归。最终通过仅覆盖“原件字节不可用且元数据仍在”的明确边界，资源记录完全缺失时的启动容错继续未验/未收口。

### 阻断一：排队撤回＋转发实际写入活锁

`c3-independent-queued-source-change.mjs/json`从已正常发送的合成源文字/图文出发，先向实际API worker调用deleteMessages撤回源图文；仅暂停该worker第1次真实IDB open成功回调（业务快照已准备），再调用forwardMessages同源两条，120ms后放开。两次调用在观察窗内均未settle；不是只看时间未提交，额外记录了真实IDB put：第一轮1.5秒2021次，复核轮1419次put/1420次open。

复核轮前12个实际持久快照严格交替：奇数源图已删除、目标仅原有2回执；偶数源图重新存在、目标4回执。`withdrawalDone:false`和`forwardDone:false`，errors为空。原因是并发两个mutateLocalProgram各自clone/save后看到另一方递增localWriteRevision，继续重放而无法发布client.mockData；提交双方未完成，却持续把互相冲突快照写回。该证据足以拒绝“只是小库慢/改长timeout”的解释，不能称排队中零半写或源撤回已稳定生效。

最小下一候选应沿既有本机单写所有权串行化业务mutation，使先撤回的源被后转发正确预检拒绝；目标set-state归档也有独立clone/save/revision循环，相关元数据变化须共享顺序或有等效无活锁保证，不能只给一个helper锁而漏该接缝。普通send同队列相邻也需保留并验ID/内容不丢。不得新建第二owner/存储或绕过源/目标校验。隔离浏览器已关闭终止重放，没有正式库影响。

### 阻断二：两目标减一目标丢附言

`c3-independent-two-to-one.json`：实际picker选随手记＋灵感收集，填`C3_TWO_TO_ONE_CAPTION_MUST_SURVIVE`，取消随手记后点单目标转发。目标实际可编辑输入为空；真实Enter得到整数13文字＋14图文，却无附言消息，errors为空，两个核心断言均false。已查看`c3-independent-two-to-one-{preview,submit}.png`。

单目标分支只调用setForwardChatOrTopic，未把caption带入既有目标草稿/确认流程，随后关闭picker清空caption。最小修复须保附言并继续原composer确认，同时不覆盖目标既有草稿/附件；遇目标冲突应明确保持选择与附言供用户处理。已交Sol独立增量，不改冻结C3。

### 阻断三：可达“我的收藏”占位假成功

根要求顺查的同picker“我的收藏”确实可选；实际点击转发后显示英文成功toast“Messages forwarded to Saved Messages”，但所有本地会话无localForward新消息/整数目标，仍停源房的picker/多选。`c3-independent-saved-target.json/png` errors为空；当前真实本机dialogs/chats只有-10/-20/-30，self1没有本地writer目标。源码forwardToSelf无实际完成确认就提示成功，此入口不能用中性说明文案替代能力接入。

最小修复是隐藏该占位或明确不可用且不显示成功；不在本轮额外启用Telegram收藏/账户路径。若将来真接本地收藏房需独立业务契约与回执，本次不扩展。

**审批结论：C3本次完整业务候选不通过，以上三项已交根与Sol执行；正常链/持久幂等/墓碑剥离/缺字节失败可精确复用，不以通过项掩盖活锁及用户稿丢失。** A1h与C1/C2b已批准源码/隔离范围保持；下一C3候选仅重放这些失败和必要源/目标/普通send相邻，不重跑h/e/122秒。A2可继续独立候选。未操作正式服务、窗口、设备或部署。

## 手动截断归篇：需求完整性短预审（不批准源码）

只读核对原`CHAT-JOURNAL-REQUIREMENTS.md`顶部、原主UI表和人工清单A03/A06，用户已确认的同源有效时间戳快捷键、仅随想前台、确认窗默认焦点确认/方向键与Esc取消、确认点分篇/下一新消息强制时间分隔、草稿与旧重编归属及慢媒体/离线/重开/幂等边界均已登记。需求完整性可预审通过；当前仍是待共同固定持久接口和实施，不因登记批准源码或现有API能力。

可复用边界与验收约定：

- 实际快捷键读取须复用`public/shared/hotkeys.js`的datetime＋effectiveShortcuts/binding/chord；`public/app/main.js`同时读取`settings.preferences.extendedShortcuts === true`。扩展关闭时，即使raw datetime保存了自定义值或null，实际datetime仍为Alt+T；扩展开启才采用自定义/清除，未设置回默认。应分别验证这几种状态、冲突拒绝与IME/录制保护，不为随想偷偷开启整组扩展快捷键。
- 现有随想“全局快捷键与后台”/`data-shared-hotkeys`是native唤回收起的F13–F24入口，不能当思绪正文时间戳设置入口已经接好。此次须读/展示同源实际值，设置入口通到正文时间戳配置或等效同源界面；具体bridge读取/写入字段待共同契约，不能拿F15设置或另存一份值冒充。
- 确认前只保存房ID/上下文与用户草稿选区，不消费边界；重复按键不多窗，按钮/Enter走同一确认动作，方向键/Tab/取消/Esc/关闭均无分篇副作用。确认时复核房和上下文；之后切房或晚ACK不能把边界应用到新房。下一首条新消息仅强制既有时间分隔，真实sentAt/ID/正文保持；后继重编仍用原篇，不按ACK时间或显示分隔猜业务篇身份。
- 现有`shiye-journal.flush()`会扫描并上传媒体/等待messages桥回执，它是远端同步流程，不能直接当“确认瞬间的本地接收顺序屏障”；`close-idle`亦不是手动截断。新持久接口须把本机已接受但媒体/同步仍pending的稳定身份纳入边界，使确认前接受的慢媒体和确认后新消息不会倒篇。能力声明、版本/幂等回执、空房无操作与失败/待处理反馈、legacy/shared兼容由数据会话共同定案后再批接线。验收按原清单A→确认→B两篇、取消零副作用、重开/丢ACK/离线重试、两房及自动空闲并发逐项核对。

本次没有新增平行需求流程，也没有跑UI大矩阵或改产品代码；以上持久接口/有效设置通道未定只阻止实施审批，不要求用户重复确认已说清的行为。继续等待Sol的C3精确冻结。

## C3 owner/附言/占位修正：独立定向复审通过

新冻结`tmp/web-chat-improvement/sol-c3-caption`、`sol/compiled-c3-caption`，旧C3/h保持。独立重算manifest SHA=`ffca6876a028ec2e901a63c20264fd82aeb7cc8c5dd5416df718d163d5a8cee9`、diff SHA=`5183e985083e6e7b54be475f3132bf24550cfb11382148cf1371337c5e934d21`，32源/28源map全文匹配，相对旧C3确仅8源。`c3owner-independent-manifest-proof.json`及`c3owner-independent-runtime-proof.json`记录七段每段116–122加载资产SHA全部匹配，每段确实加载承载新owner的worker-Dyws7OE0，未拿残留旧map证明执行新逻辑。

源码审查确认runLocalOwner覆盖完整API mutation与room command操作，沿既有writeQueue，不只锁IDB save；staged MockClient仅持久成功后向实际client发布，失败队列tail可继续。旧replacement队列在owner内部不再调用runLocalOwner自身，flush在owner里只等已有writeQueue，不await自身owner tail。FILE_PARTS在成功后清除，失败保留；selection registry仅渲染器内存并按owner/effect释放，不作为新持久存储。

独立定向结果均errors为空，分段不加总或与Sol自验混算：

| 证据（review目录） | 本段断言数（含重复种子） | 结论 |
|---|---:|---|
| c3owner-independent-source.json | 3 | 原先源撤回hold→转发精确失败已修复：两调用均settle，实际只有1 open/1 put，原图已撤回，目标无新转发回执。 |
| c3owner-independent-archive.json | 3 | 目标先归档hold→转发也settle，1 open/1 put，归档与整批零新增保持。 |
| c3owner-independent-failed-commit.json | 9 | 注入一次真实IDB put失败，持久源和live worker均保原条；随后普通send/draft/flush继续。再hold普通send的真实写入，排队draft＋flush，三者在放行前均不提前ACK，放行后发送唯一整数、草稿持久、flush屏障完成，无嵌套死锁或丢更新。 |
| c3owner-independent-caption.json | 4 | 原两目标减一附言完整进入目标composer，仍由用户Enter确认；整数消息顺序为附言、源文字、源图文。 |
| c3owner-independent-draft-guard.json | 4 | 目标既有文字草稿时明确拒绝，保picker/附言/源房/目标草稿，不覆盖。 |
| c3owner-independent-attachment-guard.json | 4 | 目标真实活跃321×123附件保持；既有最终action守卫拒绝附言覆盖、保picker说明。此段是action级附件与picker共存边界，不模拟穿透媒体遮挡层的鼠标操作。 |
| c3owner-independent-self-guard.json | 5 | 发送草稿与转发两picker均不列“我的收藏”；强制调用既有最终saved动作也拒绝，保选择，无旧英文成功toast。 |

已实际查看附言进入composer、dirty目标拒绝及隐藏收藏/最终拒绝关键帧。收藏脚本首轮缺baseline参数未启动浏览器，后一次原脚本指向可变工作wrapper虽过，均未作为冻结审批证据；已改为ui48＋frozen-c2c3后重新通过，工作wrapper原报告保留`c3owner-self-first-working-wrapper-harness.json`。最终七段只加载冻结wrapper，避免混入C1/C2b未合包改动。

**审批：原C3三个明确阻断均已独立复验修复，允许此冻结的本机普通会话逐条转发、持久回执/幂等守卫、已验picker/附言/冲突保护与单写owner正确性源码纳入后续集成候选。** 旧C3正常保序/原条不变/IDB重放/目标墓碑及outbox剥离、ACK丢失动作重试、缺字节全批失败证据按未改业务helper/身份接缝保留；本轮不重跑h/e/122秒。原C1/C2b审批保持，不能把这些范围当所有picker或最终用户体验总通过。

性能边界必须保留：当前媒体拼字节/createImageBitmap、staged clone和list/search仍占整体owner锁，后到文字会等待；本次仅证明正确性与bounded写入，不称大媒体/文字并行、后台同步或全库性能已优化。不可变媒体准备与锁内身份/资源提交的分离留B后继，不为此扩大本次C3矩阵。真实原生/服务器、最终C1+C2+h+A2同包及完整手动截断接口均未由此批准；没有安装、部署或正式服务/窗口操作。独立浏览器已关闭释放。

## A2 本次原图选择独审：字节与准备守卫通过，控件布局待窄修

精确冻结`tmp/web-chat-improvement/sol-a2-next`、`sol/compiled-a2-next`；manifest SHA=`18cefb492206e312d2c67d8fe94ec973c6e3d26dc9011333d5939549dc7111e3`、diff SHA=`fc77974f9e7f8d6a11e1968087791da58ce4d97fd6682e139fc769a4f845fb67`独立一致。33源/29源map逐全文SHA匹配，相对C3owner仅10文件变化。`a2-independent-manifest-proof.json`与`a2-independent-runtime-proof.json`核三段116/119/121加载资产全匹配，实际buildAttachment、useAttachmentModal及worker均来自该冻结，不拿源码中存在source map替代运行加载链。

`a2-independent-quality.json`19项独验通过（与Sol18项有重叠，不相加）：

- 源PNG1000×600，1872720字节，SHA=`75d49fa7567b7738432f5461ed65219b36aeec10c493e6c34693bcc9d0f31af2`，名称改用`独审_原片.png`；未设置处理偏好时实际变为337898字节WebP，SHA=`6707bbfa1f7d53afab2782a24f107932cf10dd6cc0334ab703842fda51adaa96`。
- 实际点原图、hold图像load回调期间按钮禁用，改最新说明后Enter也不提交旧压缩图；放行并发送后，真实IDB doc102的原件字节数/SHA/MIME/尺寸均等于源PNG，中文文件名在发送attachment.filename保持。source File注册表没有混进发送wire。
- 本次原图切换不回写全局，下次新选图回当前全局；旧明确high/original保持，原图反向切压缩落相同压缩SHA；取消held重建→下一选择→放行旧结果，不覆盖/锁住新选择，也不发送已取消消息。
- 旧附件直接编辑时不可二次选压缩；为避免只验一个“原图”禁用标签，本代理额外撤回已压缩的整数11，再真实恢复/修改说明/提交整数13，IDB新原件字节数/SHA/MIME完全等于原337898字节WebP，实际证明该恢复路径没有二压。未重跑122秒或h全矩阵。

`a2-independent-room-switch.json`4项相邻通过：A原图重建held→切B，B普通键盘消息仍得到唯一整数；放行A旧结果不在B弹附件，不造A图文消息、不串B图片。这里只验证暖页面切房失效边界，不扩大未提交新源File的冷重开持久schema。

源码复核source File只在渲染器按attachment.uniqueId关联，随移除/取消/发送/失效准备及组件清理释放；原件恢复WeakSet路径仍走original。此结论不代表长时间heap或大媒体并行性能通过。照片原有canonical/IDB doc并无源文件名字段，文件名验证止于源File/发送wire，不能把它写成服务器持久文件名全链已保留；原件内容证据目前止IDB，native/HTTP落盘SHA仍待首批同包隔离验证。

**新增控件UI仍不放行：质量Button默认100%宽挤掉标题并越界。** 查看实际关键帧后独立加几何复验`a2-independent-control-geometry.json/png`，稳定等待400ms，errors为空：dialog宽420、右696；新quality Button宽376/右746，菜单右774；标题width0/height180，header高193。根因新非round Button继承width:100%且flex-shrink:0，没有inline/紧凑宽度。不是默认值尚未合C1造成，也不能用“按钮文字显示原图”代替标题/菜单/可操作布局通过。首轮误写header选择器`.modal-header`的夹具异常保留，纠正实际`.modal-header-condensed-wide`后才记录本失败。

最小下一候选只修新按钮紧凑布局并验420及必要窄窗标题/质量/菜单不重叠不越界；原字节/取消/切房通过范围可保留，不重跑C3/h。当前wrapper仍旧默认original，最终须以frozen-C1为底窄改balanced且保持旧明确high/original，不能据“移除偏好后的处理默认balanced”声称首次新档案默认已在现冻结主入口改完。

**审批范围：原件重建、双向质量、准备守卫及所列IDB字节正确性允许进入后续源码候选；A2新控件界面、最终默认值同包和原件native/HTTP整链未批准。** 布局缺陷已交根/Sol，a2-next保持冻结；没有正式窗口、服务器、设备、安装或部署操作，独立浏览器已关闭释放。

### A2 紧凑布局转过，真实键盘激活仍待修

新`sol-a2-layout/compiled-a2-layout`仅AttachmentModal一源：inline/auto宽/紧凑padding与条件标题nowrap/min-width0/间距。manifest SHA=`b502c8374aec5602d0cbda7bbc4ed2360c0d4217d325f9f9d5905dc05800ce4e`、diff SHA=`ec38359d522550ee292f8734563fae2be8445ab7696475c2b5cf5010ff130378`及33源/29源map全文独立匹配；120个实际加载资产SHA匹配且新AttachmentModal执行链已核，记录`a2-layout-independent-{manifest-proof,runtime-proof}.json`。

独立在972/390/320视口实际核对modal宽420/342/280，最长“清晰压缩”按钮72px，原图44px，header均56px；标题宽度非零、各动作无交叠/越界，Tab从关闭按钮可达质量按钮，鼠标切原图/压缩不发消息。**原布局缺陷已通过，可保留该局部scope。** 证据`a2-layout-independent-ui.json`及`a2-layout-high-{972,390,320}.png`。

但该按钮真实focus→Space三视口均不切换，仍停“清晰压缩”；只有鼠标能激活。并非此前HTMLElement.click夹具问题，Playwright真实键盘事件和document.activeElement均已确认。共15项本段断言中12过/3败，errors为空。源码通用Button桌面默认仅绑定mousedown，原生键盘click只有noFastClick等入口才接onClick。最小下一候选只为新质量按钮启用既有键盘支持，不能修改全局Button或把Tab可达当可操作；并验Space/Enter确切切换、不误发送，保既有菜单/取消行为。Sol另建`sol-a2-accessible`，layout冻结不改，未重跑字节/C3/h。首个Space7秒等待超时报告保留，后续将“不激活”记为明确false并用鼠标继续几何检查，没有把局部失败抹为全过。

### A2 单按钮键盘修正：窄验通过，可进入ui49集成

`sol-a2-accessible/compiled-a2-accessible`相对layout只为新质量Button加noFastClick，未改共享Button。manifest SHA=`efcdfe8e4124f13f4cb31af28e6d6b90b75f68668506feb159d66c9e3c6c6bbe`、diff SHA=`0b18d582f23ad06bd3f487eaaa35e6cd64e1c052acbc2fd03b238ce9bc3ae587`、33源/29源map全文及120个实际加载资产SHA匹配，新AttachmentModal实际执行链已核。

`review/a2-accessible-independent-ui.json`20项窄验全过/errors为空：972/390/320视口几何保持；真实Tab可达，Space从清晰压缩切原图、Enter切压缩，均未发送已选图片；既有菜单通过Tab进入后方向键移动选项，Esc只关闭菜单并保附件，再Esc取消不发送。首轮鼠标开菜单后未Tab进入便发方向键，activeElement仍body导致断言失败；已核既有noCaptureFocus策略后沿真实Tab入菜单重验，报告保留`a2-accessible-first-menu-entry-harness.json`，不列产品缺陷。原先新quality Space不激活的缺口现已真正转过。

允许A2当前字节/准备守卫与新控件几何/键盘已验scope进入ui49集成，已直接通知Sol；不重跑19+4字节/切房或C3/h。原默认balanced最终wrapper与隔离native→HTTP落盘SHA仍待同包审核，不写已端到端。

实际开出的旧附件更多菜单仍有英文，属于原C3全可达UI范围，未以A2绿灯代勾：Add（Add）、Move Caption Up（ContextMoveTextUp）、Send as Files（AttachmentMenuSendAsFiles）、Enable Spoiler（AttachmentMenuEnableSpoiler）；同分支反向键ContextMoveTextDown/AttachmentMenuSendAsMedia/AttachmentMenuDisableSpoiler及多项兄弟键也已精确交Sol。另同源ariaLabel硬编码More actions/Cancel attachments，拖入描述AttachmentDragAddItems。根已要求构建前沿词包/注入补齐，不改行为；最终同包只核真实可见标签与原控件边界，不再跑全字节链。浏览器已关闭释放，无正式操作。

## B3 resize 阈值短预审（规划，不执行性能）

同意在既有526.53px漂移基线上采用停止resize后有效内容锚相对视口误差≤2 CSS px的硬门槛，但限定中段、同一有效字符或已解码媒体内容点、无用户新增滚动且目标位置可达。真实wheel/key/touch意图优先；底部固定策略、scroll clamp或原内容已变不能为凑2px拉回用户，须按已有底部/消息锚回退并单列结果。

客观采样从最后宽度/RO稳定事件后的首轮可绘制布局帧起，连续2帧核保持，并于500ms再查不反跳；不能以候选自行声明完成无限延后采样，也不只等回原宽取终帧。连续拖动逐rAF报告同锚max/P95误差和真实稳定耗时，暂停区间也记录；媒体只比较同identity/同内容比例，不把整图框上缘冒称内容点。

保28消息DOM身份、无新增worker读写、有界测量/布局读写、停止后无持续无效写盘作为同夹具门槛。LongTask和LoAF分别报告，基线0时不得新增>50ms主线程任务/LoAF；API不支持写明不可用，不当0。加载预热/媒体解码与采样窗口、记录开销、后台并发负载须同基线一致；更长fixture各自对照，不外推物理FPS或全库已优化。仅通过原三源/唯一滚动owner候选的阈值规划预审，不批准尚未执行的B3收益、壁纸/D1或手动截断源码；根将结果回写原resize契约，保持原需求流程。

## ui49 最终同包：合并边界与真实桥证据定向审批通过

按用户“定点定向、尽量不做多余核查”，本次没有再启动浏览器/服务器，也未重跑A2的19＋4、C3 owner矩阵、h或真实122秒。复用上述精确同源已审结果，仅独立核查最终装配差异、源码→实际执行资产，以及Sol三段同包定向证据是否足以覆盖新增接缝。证据为`review/verify-ui49-integration.mjs`和`review/ui49-independent-integration-proof.json`；不是把Sol自验数计为独立重测数。

批准对象只限`candidate-ui49`（12263文件）、`compiled-app-ui49-final2`、`tmp/web-chat-improvement/ui49-integration`；draft-first及前两编译草稿不在此结论。独立重算delivery manifest SHA=`3b2c6f8ad39e14b98e67d41e0b78a8f85ab2b5c5b90fd092e572c030138fb7a1`、diff SHA=`fc8b9fa7fef22d17169f264b9ff29c11dda75cf9f4f2e924488083ec4c5a6606`、program-files SHA=`2deb6fc9c8816d863201be3cb96d7a4d2968cd20f638bdb4e286f8ad78be0f52`一致，其他四份交接清单摘要亦一致。34源映射的候选文件逐项匹配；30编译源（type-only另列）核sourcesContent，raw词包先还原编译包装再比较。承载这些源码的map对应JS也确在三段实际加载并与候选/交付manifest一致，未拿未引用旧chunk证明执行。这里没有重新散列全部12263个未改交付文件，完整安装清单核验仍沿原标准维护流程。

最终合并增量是受控的：wrapper等于已审frozen-C1全文，仅质量默认original→balanced和ui49版本变化；workspace等于已审frozen-c2c3。vendor业务源码沿已审A1h/C3owner/A2accessible保持，新增AttachmentModal仅两处中文aria与oldLang依赖，未改质量、队列或提交守卫；两词包仅14个既定附件菜单/aria/拖入键。prepare差异止于requiredLocalLabels词键区（重复Set项不改变语义），未触发整份prepare或data/HTML重生成。实际查看`sol/ui49-attachment-chinese-menu.png`，420px附件窗标题、压缩按钮、更多菜单可见且不重叠，四首屏动作中文正常。

Sol同包`ui49-merged-ui.json`的9项、`ui49-forward-smoke.json`的6项和`ui49-native-original-http.json`的5项均有实际操作与非空checks/errors=[]，各自120/122/119个加载资产SHA经独立重算全部匹配候选与delivery，脚本路由直接读candidate-ui49，无源码/编译overlay。前三类已审wrapper、默认balanced、菜单正反向文案/aria、真实文字＋图文转发整数保序/原条保持/IDB回执只覆盖本次合并接缝，三段数不相加冒称全量验收。源右键继承的`lng_context_copy_text`/Pin文案缺口留原中文需求后继窄补，不据此扩扫或宣称全app菜单已中文。

原件桥证据可补齐此前“只到IDB”的边界：夹具脚本实际调用同包`shiyeJournal.configure/flush`，浏览器WebView消息适配器把真实journal请求交冻结C#console；不是直接调用上传helper伪装flush。独立核留存C#源SHA=`03acb44fdd3b54f01fefa08fd93a674a010b2fd6166aca1f1ebccbdd8d0998e1`及冻结chat-reedit2 manifest SHA=`0ba9d02fbebd7e8fa14100b391d9d310762d8ae26a359163d7353f3c70f492ee`一致。首轮8块offset连续，总1872720B，finish后实际messages；留存隔离磁盘原件的字节数与SHA独立读回，等于源PNG/IDB和报告实际HTTP GET的SHA=`75d49fa7567b7738432f5461ed65219b36aeec10c493e6c34693bcc9d0f31af2`。同包整数11→12重编保原时/原件且真实flush，沿既有A1身份范围复用；本次不重启夹具再GET。EXE SHA仍ui48的`fd8b22aed8a1805faad4dc17cf9f792d3d261c028279ca4b24b3578ee3fa744e`，未带共享目录并行native/data/backend候选。

**结论：允许该精确ui49冻结作为首批A/C范围进入原标准保存、备份、升级流程；未发现阻止本次定向合包的新增缺陷。** 可交付范围为已审图文原位重编/恢复和准备守卫、每次原图/默认压缩及所列真实原件桥链、逐字段外观继承、设置父页返回、已验本机普通转发/picker/中文附件菜单。源码回写须沿交接的基线/当前/候选三方窄合并，不能整包覆盖其他会话工作。

此结论不是已安装/实际启用或全部截图意见完成：真实WebView宿主冷启与正式profile未由Chrome＋console代验；照片原有canonical无filename字段，不称服务器持久原名；B布局/壁纸/切换/记忆、大媒体与文字并行、D1、手动截断、新发送按钮显隐与拖高遮字均仍在后继范围。旧TypeScript两处继承错误不写成全库check:ts通过。本独审没有操作正式窗口、服务、手机或部署；无需用户重复确认已授权需求。

### ui49 实测“发送后须手动下拉”：只读定向调查

根回执已按正常流程启用ui49（运行ready21:36:12.6191700Z），本代理不重复安装验收。用户新反馈独立于上段合包范围保留，未因旧通过而排除。已实际查看`D:/UserTemp-1001/codex-clipboard-af204f5d-a98e-4068-a850-36737c127362.png`与`D:/UserTemp-1001/codex-clipboard-b2d21c56-d15f-468c-bcc0-57c03d3139cb.png`：首图可见旧05:38本人尾部和明显向下按钮，后图05:39新本人消息已能显示，输入区较高。两张静帧不能证明新消息在首次发送时已挂DOM，亦不能证明在等同步；“自己发新消息须再下拉才可见”按真实失败登记，不以合成整数ACK/原件链通过代替滚动可见性。

只读源码与精确ui49 build-source-scope核对：MessageList SHA=`0ff80460f924ae8be062513deaefd9654b3eec75deb79d16afaff28fa7850694`、messageListReserves SHA=`957ae0c368e7a07a6c9055abf6e3c59670c5725fb8d46d20eb9c191cae17cb08`、useFocusMessageListElement SHA=`24a3ed93c95818793bb20695d3b9a5697196448b20b8605f2320becac2032f29`与冻结ui48相同。问题不能未经复现就归给此次worker/API或C1代码增量，也不能因源码未改就排除实际几何/时序缺陷。

已向根/Sol同步两处直接线索，尚非已证根因：

- `candidate-ui49/app/shiye-chat-ui.js:185–198`临时scrollTop setter在sendMotion与4秒follow窗口内吞普通scrollTop写；`:851–859`在同一sendMotion存在时又跳过一般滚底，实时可见性依赖唯一instant尾随事务。`:537–546`候选/anchor/roomPending/restoring等守卫或`:617–621`失效后，expiry只清sendMotion，未显式schedule一次尾随收尾。如果本机DOM已出现却错过该事务，可出现新条留在footer下方、需要用户滚动的方向；须实测是哪条guard及是否发生吞写。
- wrapper`:886`发送按钮到click阶段才follow，而实际桌面共享Button通常在mousedown执行发送；应核真实mousedown→DOM插入→click的次序，避免beginSendMotion把刚发送的新根先纳入known/baseline，导致pending无新candidate。Enter走`:871`捕获阶段，另查Modal/IME/房间恢复/用户滚动取消，不把按钮线索直接套给键盘路径。MessageList`:1170`自动新增滚动要求isAtBottom；中段自己的新发送因此也依赖wrapper明确发送意图，不能只改所有新增消息强制拉底。

下一修复的定向验收只覆盖原失败与直接相邻：分别记录本机接受、首个消息DOM可见、整数ACK和远端同步阶段，确认本机新条在ACK/远端held时已显示且footer上方内容可读；按实际较高输入区及普通高度，真实Enter与实际发送按钮重放，记录scrollTop/scrollHeight/clientHeight、footer rect/reserve、尾条rect、follow状态与守卫分支。消息较长超视口按既有可读尾部策略，不能用“必须全条进入视口”制造不可能门槛。自己的新发送应可见；用户自主中段阅读时远端消息/既有ACK不能强拉，发送后再次明确wheel/key/touch滚动应优先；切房晚回调不得拉新房。无需原件/转发/122秒或无关B3/样式矩阵。当前仅只读，未跑新浏览器、未发正式测试消息、未改产品；待Sol具体失败证据和冻结补丁再独验。
