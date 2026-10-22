# 电脑随想 ui48：设置、外观与转发只读清点

2026-10-19，Sol 常规执行代理。已读 AGENTS.md、WORKSPACE.md、DEVELOPMENT-HANDOFF.md、ACTIVE-SESSION-COORDINATION.md 及 CHAT-MESSAGE-REEDIT-2026-10-19.md、对应验收。仅调查源码和既有证据；没有操作正式窗口、服务、设备，没有改产品。共享协调入口由根维护。本报告不替代新的实际 UI 验证。

## 范围与用户确认

本轮对象是电脑随想 ui48 的 WebView 聊天。优先图文重新编辑、原图上传，再做切房性能与外观；图文/原图/性能由 Astra 调查，本报告不接管。外观默认逐项继承全局，单项可覆盖、单项恢复、全部恢复。新增反馈包括：从列表打开设置返回列表；多选转发完整中文；嵌套截图中的 share 弹窗残留需要重现。

## 实际交付源与证据

- 既有正式回执：`outputs/2026-10-19-chat-message-reedit/runtime-proof-ui48.json` 记录 ui48 于 12:20:45Z native ready，安装目标 `outputs/2026-10-15-Telegram聊天预览`。这是历史回执，本代理没有重新查询当前进程。
- ui48 打包根：`outputs/2026-10-19-chat-message-reedit/candidate-ui48/app`；构建源：`tmp/diary-paragraph-messages/build-web/.ui48-message-reedit`。`build-source-scope-ui48.json` 标明基于 `.ui45-atomic-services`，仅批准21个编辑/排序/视窗源码；`delivery-manifest-ui48.json` 保存12176项交付清单。
- 当前 wrapper `previews/telegram-chat/shiye-preview.js` 与候选 ui48 同名文件 SHA 一致（daebd7…922a），`shiye-room-workspace.js` 也一致（25439c…ff3c）。转发组件当前 vendor 与冻结构建源同 SHA（9d4905…45cc）。完整精确 SHA 在 `outputs/2026-10-19-web-chat-improvement/sol/source-hashes.json`。
- `prepare-preview.mjs:64–118` 将中文 labels 覆盖进 fallback.strings 和 initialStrings.ts，`build-preview.ps1` 默认构建当前 vendor；后续不能直接拿默认构建覆盖 ui48，必须从已验冻结源建立候选并记录最小差异。

## 设置导航

| 路径 | 定位 | 现状与边界 |
| --- | --- | --- |
| 设置页缓存/父页 | shiye-preview.js:600 dialog、613 activateSettingsPage、625 settingsPage | Map 缓存页面，settingsParent 记录父页；返回只 close(back)，close handler 在690–713恢复父页。 |
| 关闭整组设置 | shiye-preview.js:770 disposeSettings、784 requestSettingsClose | 顶部 × 和“关闭设置”统一关闭全 session；有 dirty 会显示保存/放弃/继续。 |
| 会话管理列表 | shiye-room-workspace.js:83 mountRoomManagement、616 openNavigation | 列表名称点击发 shiye-edit-room；当 navigation 仍为 active 时，openRoomSettings 默认继承其父关系。保存后 close(saved) 应回管理列表。 |
| 左侧会话侧栏右键 | shiye-room-workspace.js:244 contextmenu | 直接发 shiye-edit-room，侧栏不是 settings page，无 settingsParent。它与“会话管理列表”是不同入口，不能根据一个入口的证据宣布另一个已修。 |
| Esc 弹窗预选列表 | shiye-room-workspace.js:739 openSwitcher、812 close、handleSwitchKey | 独立 dialog，不进入 settingsSession。需要对照截图确认所说“列表”是哪一种。 |
| 单房设置 | shiye-preview.js:978 openRoomSettings、1180 close(saved)、1193 openSettings | 缓存 key 是 room-ID；cancel/保存返回可恢复父页，而顶部 × 当前语义是关闭设置整体。 |

已有 `verify-conversation-settings.js:29–48` 检查 navigation 的 Esc 回 root；275–356检查旧整组外观。没有证据表明它覆盖最新“列表→房设置→返回列表”、顶部 ×、dirty 分支、跨入口复用同一 room-ID 的父关系。先用隔离合成数据复现，再针对父页来源做局部修改；不要把全部 × 改为返回从而绕过脏表单保护。

## 外观继承

`shiye-preview.js:490` 全局 key 为 `shiye-preview-appearance-v1`；507 单房 key 为 `shiye-room-appearance-v1`。`effectiveAppearance:520` 已按字段缺省回退全局：theme、shade、bubble、radius、messageGap。`apply:539` 负责写入 body CSS/主题。

实际表单 `1005–1028` 只有一个 inheritAppearance 复选框：勾选禁用全部5控件，取消则全启用。`fillAppearance` 根据是否存在整个房对象判断继承。保存 `1163–1171` 要么删除整个房对象，要么把5项全部写入。因此当前使用界面仍是整组继承；不能把 resolver 的逐项回退算作已支持逐项操作。

可低复杂度独立候选：将5项存为稀疏覆盖，未覆盖字段动态显示当前全局有效值；每项独立覆盖/恢复；全部恢复删除覆盖对象。旧完整5字段对象继续解释为5项明确覆盖，不能以“值恰好等于全局”猜测继承。设置取消不持久化，保存失败不提前写外观。未知字段宜保留，避免后续扩展被清空。

范围需要根收口：字体、消息字号、输入字号、消息位置当前读取 settings 全局，窗口/字号又有显示屏记忆；壁纸在 local-assets 与 room-workspace 的独立链路，并非上述5项。用户“每项”如包含这些项，须先明确字段和优先级，不应静默只交付5项后声称全部完成。本代理不改壁纸缓存/图像链路。

## 多选与转发

冻结源 `src/components/main/ForwardRecipientPicker.tsx` 与当前 vendor 一致：95 isMultiSelect，233 handleForwardToMultiple，293 executeForward，368 SelectChats，390 AttachmentCaptionPlaceholder，460 ShareWith。组件混用 useLang/useOldLang；RecipientPicker.tsx:335–350向底层传 isNativeDialog、onClose/onCloseAnimationEnd。

冻结 `src/assets/localization/fallback.strings` 直接可见：661 ShareWith = Share with，662 SelectChats = Select chats，3235–3236 FwdMessagesToChats 一/多数量通知仍英文；708 Forward 已中文，1249 CopyLink 已中文，3151 AttachmentCaptionPlaceholder 已是“添加说明…”。`prepare-preview.mjs` 内联 labels 覆盖中文的 AttachmentCaptionPlaceholder。因此截图 comment 英文不能仅靠此输入框定位，应再检查目标房 composer 的转发头和选项菜单。只有精确定位键后才补中文，不做页面任意文本替换。

另有必须验证的交互边界：选2个目标会显示 caption；用户输入后减为1个，handleForwardToMultiple 直接 setForwardChatOrTopic，未传 caption；减为自己则 forwardToSelf。多目标路径才 executeForward({targets, comment: caption})。这是源码可见潜在说明丢失，尚未实际重现，不应在翻译补丁中顺带改变业务。

`src/global/actions/api/messages.ts:3374 forwardMessagesToChat` 在 comment 时先 sendMessage，再对 realMessages 调 callApi(forwardMessages)，serviceMessages 则 sendMessage；3461 forwardToMultipleChats 遍历目标。选择/多目标具备实现不等于本地 mock/日记端完整 ACK 已验。转发消息来源、媒体、引用、归篇身份必须按已有业务边界核对，避免仅看到弹窗就宣称发送成功。

share 残留目前只能登记待复现：源码是原生 dialog picker＋关闭动画，需记录操作链（从消息/多选/截图进入）、可见 open dialog/遮罩/焦点/forwardMessages 状态；分别检查取消、发送、Esc、窗口收起与查看图片返回。不得用强删 dialog DOM 隐藏根因。

## 可独立任务、测试与并行文件边界

1. 中文键清单：只读冻结 fallback 与实际组件全部可达菜单，产出英文键/中文值/调用点；获根分派后只改 chinese-labels.json，核对 prepare 的双源注入与两类 lang 钩子。覆盖选择前、单目标、双目标、移除目标、取消、完成通知及搜索空态。低复杂度，可与 Astra 图文实现并行。
2. 设置返回专项：只改 wrapper 路由前先隔离复现三类“列表”。用管理列表→设置保存/取消/Esc/×、dirty保存失败/放弃、返回后列表筛选和滚动、同房从其他入口重开。与外观共享 shiye-preview.js，需同一执行者或由根串行合并。
3. 五项稀疏外观：逐项继承/单项覆盖/单项恢复/全部恢复，保存→切房→重开；全局改变只影响继承项，显式同值不丢覆盖；旧完整对象、空对象、非法值、持久失败。验证深浅、遮罩、气泡透明度、圆角、间距及 dirty。只改 shiye-preview.js 表单/resolver/持久路径，不碰原图和重编辑。
4. 转发行为潜在缺陷与 share 残留：先构建独立复现，不与简单翻译捆绑；若要改 ForwardRecipientPicker / api messages，则与 Astra 图文/发送边界协调后再分派，不直接改共享冻结源。

本代理当前只产出此文档和 sol/source-hashes.json；未跑新浏览器测试、未修改任何产品源码、未构建候选、未安装或启用。根可据此分派实现；此前ui48证明仅按其原范围复用。

## D1 追加：鼠标展开即激活/输入，只读原生调查

已读主需求 `WEB-CHAT-IMPROVEMENT-2026-10-19.md`。本追加仍无产品修改、无进程/窗口/设备操作。

宿主来源有可核对的原件：ui48 EXE SHA256 为 `fd8b22aed8a1805faad4dc17cf9f792d3d261c028279ca4b24b3578ee3fa744e`，与 ui45 交付 EXE 相同；`final-reuse-proof-ui48.json` 明确继承 ui45 原生。当前 `DesktopPreview.cs` SHA `8b90821d305ac553d3273257c94e1eb2184d1d995df8f27040d5c8445e8b6c4a`、`EdgeDock.cs` SHA `367ce1bfa7101bf2e2a8f285e2f6676017d766e9b02c0648edb0880f397a4a62` 均与 ui45 `native-bridge-validation.json` 的 frozen/candidate SHA 相同。不能由此推断 ChatJournalBridge 当前并行源码也未变；新宿主须从冻结原生源集合增量构建，勿直接运行默认 build-window.ps1 混入其他候选。

实际路径与风险：

- `EdgeDock.cs:371 RevealDockFromHover` 先 AnimateDock(false)，仅 `saved.DockActivateOnHover` 为真时增 hoverActivationRequests 并 RestoreEditor。`TickDockCore:384` 在缩回动画中鼠标进入反转时调用一次；408–419 在已隐藏条进入时调用。AnimateDock 立即改 dockHidden=false，正常后续tick不会一直激活。
- `DesktopPreview.cs:1081` 配置是 bool DockActivateOnHover；构造函数1083没有设 true，缺省 false。wrapper 1338 已有“悬停展开时自动激活输入”开关。D1 是对现有默认/行为的新确认，不能仅新增重复开关；旧显式 false 是否应保留由根收口，调查不自行迁移用户偏好。
- `DesktopPreview.cs:526 RestoreEditor` 依次 RevealDock/Show/Activate/BringToFront/web.Focus/inputPending，最后发 shiye-hotkey-resume。网页该事件使用 restoreInput()，会在不满足keepPosition时发 shiye-focus-end，移动聊天光标到末尾。故直接把原开关强制true不能证明满足“保留光标”。
- `DesktopPreview.cs:298 Activated` 也先 web.Focus，再发 shiye-resume；该网页事件用 preservePosition:true/selectChat:false。两路重叠可能让恢复逻辑跑两次；用户输入后迟到timer仍可能争焦点，需要明确单次hover intent与代际。
- `shiye-preview.js:205 restoreInput` 会在 composing、MediaViewer、打开菜单/命令、侧栏用户正在导航时停止；modalFocusTarget:122 会将普通设置dialog中的可编辑控件或按钮作为目标。这个策略用于恢复Win+V/设置焦点，不能当D1“设置不抢”已满足。`keepPosition` 对聊天光标的保护仅在 activeElement仍是原聊天输入或存在非折叠选择时成立；宿主失焦导致activeElement变化时，需要保存/恢复有效Range，不能只保正文。
- `DesktopPreview.cs:961 input-ready` 可执行中文输入模式请求。IME保护须在原生发意图前和网页实际聚焦前检查；不能先激活/切输入法再由DOM composing guard补救。native 已有 dockBusy/dockTypingUntil/OwnedForms 抑制缩回；它们是否足够细分 hover 焦点许可需与页面busy报告链一起核验。

最小候选建议（待根分派）：复用现有hover展开入口，给RestoreEditor/Activated区分hover原因，并只对单次hidden→expanded转移提交一次hover恢复；独立网页hover事件只在普通聊天、无设置dialog/查看器/菜单/IME且页面代际未变时聚焦现有聊天输入，不切房、不改正文、不重建draft、恢复同房有效Range，不触发focus-end。原有热键/Win+V恢复策略继续按既有路径。宿主激活前先取得明确允许，不能先Activate后发现保护页；如果检查超时/页面失败则只展开，等待下一次明确用户操作。检查完成时复核同次展开和pageGeneration，避免用户已打开设置后迟到抢焦点。允许机制可先做同进程本地事件/固定桥，不涉及新跨端schema。

真实原生验证需独立profile/隔离候选宿主（不能用正式安装目录，也不能仅用CDP Focus模拟鼠标）：

1. 用真实系统鼠标移动离开使宿主贴边，再移入6dip条；从另一个前台窗口开始，不单击聊天即发送真实键盘字符。记录GetForegroundWindow==宿主Handle、WebView document.hasFocus、activeElement、输入内容和hover计数；不可只断言 hoverActivationRequests+1。
2. 先在草稿中段放折叠光标、跨节点选择，分别失焦/缩回/展开，确认在原光标插入，不跳末尾；等待≥1秒排除100ms重试timer迟到覆盖。草稿内容/当前房/消息数保持，只输入测试字符不发送到正式数据。
3. 设置文本框/滑块、图片查看器缩放、图片说明框、菜单、IME composing分别覆盖：展开可发生，但不得自动转到聊天输入或改IME组合；不以合成composition事件代替至少一项真实中文输入法验证。查看器有独立原生OwnedForm，须记录前后台窗口身份。
4. 鼠标在条与展开区边缘来回、缩回动画反转、快速移入移出、页面导航/销毁、窗口已展开、最小化/隐藏/热键恢复分别验证。一次展开最多一个hover焦点提交，用户随后点设置不被迟到恢复抢回。

已有 `EdgeDock.VerifyDockAnimation:495–504` 只测 false/true 时计数，verify模式明确不执行 RestoreEditor，不能算D1真实激活验证。`verify-clipboard-focus.js:35` 测说明光标和主动取消按钮不抢，但不是hover。新候选应复用未改范围，补以上真实宿主测试，源码/隔离/安装/正式启用分别回执。

## A2 追加：质量档位精确值与缺省兼容

`public/core/media-compression.js:2–6` 实际仅 original、balanced、high：原图Infinity/1，均衡2048/0.6，清晰2560/0.82。代码没有clear档名；主需求写original/clear/balanced应按此调查纠正术语，不能把未知clear值静默当已支持。公共compressUpload缺省与未知值落balanced；wrapper UI1250和冻结buildAttachment.ts:26当前缺省是original，说明入口缺省与算法缺省并不相同。prepare-preview.mjs:219复制公共算法到vendor public/shiye-media-compression.js。

建议（未获根最终选择，不实施）：聊天缺省压缩可选现有high“清晰”档，较符合图文清晰优先且复用原算法；若希望完全沿用公共缺省则选balanced。应明确一项后让设置显示、选文件/拖拽/粘贴/编辑替换的实际入口使用同一resolver。只对key不存在/空/非法值回退；旧original、high、balanced均保留原显式值，不批量重写偏好。新建默认无需主动写key；用户手选才持久化。表情包shiyeOriginalSticker仍强制original、shouldSendAsFile仍按原文件路径，不能随缺省变化压缩。

压缩并非每图都生成新字节：算法保留≤300KiB、>32MiB、动画/无法识别/像素>40MP、无环境能力、编码不可用、压后不更小、缺修改时间等输入；JPEG保JPEG，其余静态透明图可WebP。验收需区分“选压缩档但安全保原件”与失败/实际压缩结果，不把结果文件标成源相机原图。质量偏好已出现在 `shiye-shared-directory-port.js` 的key范围，跨端namespace/默认变动先等协调回执，不自行改schema。

## C1 最新范围与字号/动效优先级追加

根转达用户已明确：逐项会话覆盖也包括消息字号、输入字号、发送动效。本轮仍只针对随想，不把思绪或内部组数据选择扩大成用户问题。本文前述A2 high仅为早期调查建议；根现已收口缺省压缩工程值为balanced，以主需求为准，保留旧显式original/high/balanced。

当前实际实现并没有这三项会话覆盖，不能将下面目标顺序冒称已上线：

| 项 | 当前字段/存储与计算 | 目标最小优先级建议（待schema回执） |
| --- | --- | --- |
| 消息字号 | shiye-preview-appearance-v1.fontSize；shiye-preview.js:563 CSS值为(settings.fontSize或16)×textScale；range14–24。textScale独立来自原生window-state，按显示器记录；WebView ZoomFactor=1。 | 会话明确fontSize→全局fontSize→16，然后乘原有当前屏幕textScale；不能把会话数值再当屏幕倍率乘第二次。 |
| 输入字号 | 同一全局对象inputFontSize；有效7–60时直接作CSS px，不再乘textScale。缺失/非法时inputFontSize():528用(fontSize或16)×textScale一次迁移并持久化；原生window-state到达前避免过早写入。 | 会话明确inputFontSize→全局有效inputFontSize→原有缺省/迁移规则；独立输入字号保持不随消息缩放再次倍乘。 |
| 发送动效 | 独立localStorage键shiye-message-render-mode；instant/smooth/legacy，缺失/非法→instant；shiye-chat-ui.js:53读取，658响应shiye-message-render-mode-changed。prefers-reduced-motion另限制动画，非偏好覆盖。 | 会话明确render mode→全局旧键→instant；仍尊重系统reduced-motion，不因会话选smooth强行动画。 |

原生DesktopPreview.cs:954的zoom-step以0.04步更新TextScale（0.5–2.5），SelectDisplay先选择显示器；DisplayMemory.cs:96/109/131记录/恢复每屏倍率。字号基数并不是每屏一份，实际每屏记忆的是textScale；UI说明中“字号按屏记忆”不能误解成fontSize/inputFontSize已经每屏独立。当前全局inputFontSize一旦有效，不再随屏幕textScale改变。

新增会话字段命名/偏好namespace仍等跨端回执，本代理未创建schema或修改产品。实现应共用单一effectiveAppearance/发送模式解析口；切房需重新应用有效动效并清理上一房未完动画（利用现有stopSendMotion），不把改变全局key冒充会话覆盖。外观编辑取消不写入；单项恢复删除覆盖键而非写当前全局值；旧未知键保留。测试必须覆盖会话值等于全局但仍明确覆盖、跨屏116%/另一倍率、消息缩放不影响独立输入、未选项随全局更新、系统reduced-motion，以及快速切房后的迟到动效。

## C3 范围升级：收件人/多选入口系统适配

用户新增“选择收件人在别的地方比如多选也出现类似情况，这些地方都重新做好UI适配”。已补独立入口图 `outputs/2026-10-19-web-chat-improvement/sol/recipient-adaptation-map.md`，区分选消息/选目标、合法分享/附件恢复误触发、真实父页/取消/焦点/dirty/附件及loading/empty/error。静态依赖存在不等于随想可达，入口图逐项标记待测；4键字典只作局部文案候选，不能满足完整C3。

精确漏注入已确认：EditMessage虽在字典中，但prepare仅replace、不追加，ui48冻结fallback/initial均无该精确键；旧useOldLang缺失直接返回key，ComposerEmbeddedMessage实际使用旧链，与根转达的键名截图一致。SavedMessagesInfo在ChatOrUserPicker的本人收藏subtitle走旧链，冻结fallback确为Forward here to save。审计 `sol/localization-injection-audit.json`。待做受控缺失键注入/断言与两类lang冷启动/缓存验证，不再添加重复字典键蒙混。

A1旧附件恢复openChatWithDraft不带chatId触发DraftRecipientPicker，属于误路由，不应全局隐藏收件人组件；Astra正在处理，本代理只读未改其候选。其他TG bot/礼物/账户/群管理复用入口仅源码依赖，未经随想真实入口证实不盲扩产品范围。工程默认压缩已收口balanced，C1扩展字号/发送动效依前述最新范围。

## SF12 两分钟撤回反馈补证

三入口已针对冻结ui48本人旧纯文字（约45小时）实际右键菜单编辑/取消、撤回确认、page reload后重新编辑恢复通过，6断言；并实际确认撤回框仍写“两分钟内可重新编辑”。代码本壳三入口无该TTL不等于用户看到的错误提示已修。证据与准确边界 `outputs/2026-10-19-web-chat-improvement/sol/withdrawal-time-limit-audit.md`，其中保留额外重提等待超时，不宣称老消息完整重提通过；未真实等待撤回超过2分钟/未验原生退出。

已核Astra manifest不含DeleteMessageModal，在专属sol-candidate复制冻结文件仅替1处本机恢复条件提示，候选SHA/before/after见sol/withdrawal-label-candidate.json，待独立审核，未编译/部署/修改共享源。

## C2/C3 冻结候选交审（进行中，无安装）

已冻结9文件到 `outputs/2026-10-19-web-chat-improvement/sol/frozen-c2c3`，精确白名单/基线及候选SHA/6个编译映射见 `c2c3-candidate-manifest.json`，完整差异 `c2c3-candidate.diff`。隔离构建 `compiled-c2c3-final`，不复制新data/seed；generator-proof证明prepare除翻译段外前后文逐字保持，完整prepare未执行。

C2实际基线复现：侧栏→设置→外观时自动collapsed，退完仍collapsed。候选复用settingsParent/session记录原房/侧栏滚动与焦点；设置期间外部点击不误收起，返回未切新房则恢复原列表；真实服务子页/房页/根逐层返回、dirty缓存再开/继续/取消、管理列表保存/取消/Esc、侧栏右键入口与120px滚动保持均已过。没有新导航系统。

C3修复明确中文链：缺失key受控追加，保证单换行供readStrings读取；SavedMessagesInfo/EditMessage实际可见中文。消息工具栏本地分支为取消多选/撤回所选消息/复制所选消息/转发；消息计数『N条消息』，目标计数『N个会话』，目标空态中文。实际取消目标返回原消息选择，再取消多选保原消息，旧picker不可见且焦点释放。SF12同包实际新确认文案/取消原条保持通过。

证据 `c2c3-final-summary.json` 分阶段30断言（含重叠，非30独立场景）。原c2c3-ui.json保留passed:false，因为最后用了实际不存在的toolbar Close locator；此前21断言全过。已核原取消按钮在MiddleHeader，后续候选提供真实取消多选并7项实际验证，补SF12两项；不删原失败伪装全绿。截图c3-selection-chinese.png、c3-recipient-chinese.png、sf12-candidate-confirmation.png。两次早期harness等待/selector错误及一次注入空行失败均保留。

此候选是C2局部修复及C3实际明确入口/文案接线，仍不代表完整C3所有共享picker设计/合法转发提交/失败幂等已验；完整业务与A1合包由根协调独审。无共享源码/正式资产/设备修改。后续C1沿sol-candidate新增，不改本冻结快照，避免混审。

## C1与C2b分开冻结（2026-10-19，待独审）

C1只改专属shiye-preview.js十字段resolver/表单/稀疏提交，全局输入迁移只读全局值，跨窗storage跟随；保存失败先不改roomAppearances内存、不标saved。现有mode-changed string及room-switch-start收尾复用，不改scheduler/server/wallpaper owner。原UI-PREFERENCES已先写接线约定。`c1-ui.json`23项真实UI通过，包含实际跨窗storage、116%合成native、同值覆盖、未知false0、取消/单项恢复/全部恢复、模拟setItem失败与reload、0.01px控件精度。截图c1-controls-theme.png/c1-controls-following.png已实际查看；物理跨屏/真实API未验。

C1测试还暴露直接root房设置的旧Escape隐患：通用Escape先close()使dirty页open=false，再把保存确认插入已关闭页，继续后cancel无close事件；`c1-dirty-probe.json`4状态和两截图保留。C2b仅修改既有Escape/settingsParent分支及requestSettingsClose重开dirty页，`c2b-dirty-ui.json`4真实动作通过；不混C1数据代码。

两个冻结wrapper及相对基线SHA/差异在 `c1-c2b-manifest.json`、`c1-candidate.diff`、`c2b-candidate.diff`。C2b SHA e71a73e9d715a0c2287cbc006498059f5b6f0435b6e848c10d96e039e76203a2；C1叠C2b SHA 85065c88c63e3a9c7b64d6631f2404193c0725579aa2c534ad85f5423728f21c。原frozen-c2c3未改，候选未安装/启用，等待独立审核。

C3完整真实提交另见c3-forward-ui.json：纯文11+图文12真实本地整数生成→多选→-20确认，2秒观察仅float Pending、无整数ACK，原消息JSON保持；worker参数forwardMessages完整。首次切房同id多输入selector失败保留。此结果已交根/Astra查处理链，本代理不改forwardAPI/owner，不把中文picker当转发成功。

## 2026-10-19 Sol 接续 g/h 与 C3 事务候选（隔离，未安装）

A1g 在 f 基础仅改 Composer / AttachmentModal / useAttachmentModal，源 File 读取开始即设置同步提交 guard，覆盖旧附件仍可见的准备空窗。实际 gated File 自验保存禁用、Enter/点击无提交、释放后新图与说明整数回执通过；独审亦复核取消/新代际与切房。独审随后发现同附件 caption 输入会触发 f 的全局 input epoch 使新图静默丢弃，故 g 不能作为 A1 全通过。

h 仅对同附件 contenteditable 的 input/compositionstart 不失效已选源；取消、切房、附件数组及编辑身份检查保持。自验复用精确反例，held 期间输入说明后释放，整数后继含 1000×600 新图和最新说明通过。候选 tmp/web-chat-improvement/sol-a1h，输出 sol/compiled-a1h、candidate-h-source-manifest.json、a1h-vs-g.diff、a1h-caption-caption-during-prepare.json，独审待回执。f/g 保持冻结；未控正式原生/API/设备。

C1/C2b 独审源码与实际加载 SHA 已通过（独立 23/4，不能加至自验计数）；原 C2C3/SF12 局部冻结独审保持，不等同完整转发通过。C3b 候选 DraftRecipientPicker 使用专属 ShiyeSendTo，ForwardRecipientPicker 仍转发语义；真实无目标草稿 picker DOM 存在但 root 隐藏，自验未过保留 c3b-role-ui.json，不能只凭源码宣称入口中文可用。

C3 新执行目录 tmp/web-chat-improvement/sol-c3 在 h 上增量，按既有 CHAT-JOURNAL-REQUIREMENTS 原契约补 ForwardMessages 本机事务与 localForward 端内回执。源/附件/目标整批预检后按顺序分配整数；重试校验先于源可用性，墓碑保留最小身份拒绝复活，outbox 不含 retry 字段。纯事务 helper 18 定向通过（构造器 doubles，不能替实际 worker/IDB），真实 UI 与持久重放仍验中。构建源码不改正式 owner / 后台 / 手机 / schema。

### C3 精确冻结交审（Sol 执行，未正式启用）

候选 tmp/web-chat-improvement/sol-c3 基于已独审 h；真实同包 c3-business-ui.json 10项通过（文字+图文保序整数、原条不变、IDB/新worker重放、撤回不复活、归档目标整批失败零写入、实际右键重试保稳定ID）。角色文案4项与纯helper18项分列、不合计。源码/差异/实际加载SHA与未验边界详见 outputs/2026-10-19-web-chat-improvement/sol/c3-candidate-handoff.md；完整C3多入口仍待收口。此前“隐藏”是根Modal0高度的harness误判，真实dialog与动画完成opacity1已核，未修改产品掩盖；多选过渡单项误用亦留原报告并按真实shown/count2重验。

vendor npm run check:ts已在私有全源副本执行，剩ui48原有2个shiyeLocal类型错误（baseline208/510，候选211/534）；定向全部变更TS/TSX另跑eslint通过，不能写全库check:ts通过。没有正式安装/服务重启/设备操作。

### C3 三阻断修正最终候选（待独审，非正式运行）

Sol 后续候选 sol-c3-caption 相对旧 C3 冻结仅8文件：同一完整业务 owner 队列与 staged 失败保护；2→1附言沿原草稿入口，目标 dirty 文本/附件明确拒绝并保原选择；本机无 writer 的收藏入口隐藏且最终动作拒绝，不再提前成功 toast。实际最终编译9定向场景均过，源撤回首 IDB held→转发由原2021写盘活锁变为1 open/1 put 后明确失败零新增；归档、program-bindings/feed、保存失败后 send/draft/flush、caption/draft/附件/self相邻均有报告。细节与SHA见 outputs/2026-10-19-web-chat-improvement/sol/c3-owner-candidate-handoff.md。

媒体准备尚占整体 owner 锁、staged复制亦有成本，当前仅正确性，不称性能优化。A2暂停，sol-a2未构建未验不得合入；h与旧C3冻结保持，未操作正式包/原生/API/手机。完整C3与整包仍以独审回执为准。

### A2 本次质量选择最终候选（覆盖上段暂停状态，非正式运行）

C3 owner/附言/self修正已获独立限定scope放行。其后新候选 `tmp/web-chat-improvement/sol-a2-next` 从该冻结继承，10文件增量，实现原File仅renderer内存关联、本次压缩/原图双向重建与h同一pending/取消守卫。真实隔离浏览器18定向检查全过、errors[]，121实际加载资产SHA，33源/29映射；PNG原1,872,720字节→默认WebP337,898字节→改原图后IDB SHA/大小/MIME/1000×600与源一致。取消迟到/下一选择、旧high/original和撤回原件不重压均有证据。

准确SHA、差异、已纠正夹具与未验边界见 `outputs/2026-10-19-web-chat-improvement/sol/a2-candidate-handoff.md`。check:ts仅继承两类型错误，定向eslint0错误/3继承warning，不称全库通过。旧sol-a2仍未验草稿；新sol-a2-next已冻结交独审。原件实际验证止于worker/IDB，native→HTTP隔离原件回读SHA留首批同包；最终wrapper须以frozen-c1/C2b为底窄叠质量默认balanced，不能用旧h wrapper覆盖。未安装/部署/控制正式窗口或设备。

A2独审字节/功能19项与切房4项限定通过，但发现新增quality Button继承100%宽导致420px弹窗标题0宽/193px标题行，故不放行整合。另冻结sol-a2-layout仅AttachmentModal一源布局：Button auto宽/inline与标题单行省略；真实420/342/280px弹窗标题/最长清晰压缩按钮/menu都在框内，header56px，4项定向与eslint0错误，待独审。原失败和原a2-next冻结保留，未以按钮中文标签掩盖布局失败。准确SHA见sol/a2-layout-handoff.md。

### ui49最终合包与后继边界

A2-accessible后续仅quality noFastClick已独审通过20项；最终ui49从frozen C1/C2b与h/C3owner/A2增量合包，并补14附件正反菜单/aria/拖入键（仅词包区、data不变）。candidate-ui49/compiled-app-ui49-final2共12263文件，30变更编译源、34源回写映射；真实同包9 UI/5原件桥/6转发烟测分列，三段实际assetSHA匹配。独审已限定scope放行，见review/ui49-independent-integration-proof.json；准确产物/SHA/失败留存与未验边界见根ui49-candidate-handoff.md。实际原件证据已补journal configure/flush分块→冻结C#console→冻结chat-reedit2 HTTP磁盘/GET SHA，仍非实际WebView宿主冷启。尚未正式安装或共享回写；36目标窄回写仅dryrun，apply等待根明确授权。

后继仅只读复现composer真实拖上沿缩高：12行81→36（有效40）held末字符超clip31.09px，松手focus-end才恢复；单行三临界点正常。不是窗口resize问题，未改ui49/共享源。具体几何/截图/最小measure-mutate方向及普通send按钮范围见sol/ui50-composer-input-source-audit.md。可隐藏按钮字段尚为提案，未写新偏好/后端schema；B3/D1/cut不混首包。
