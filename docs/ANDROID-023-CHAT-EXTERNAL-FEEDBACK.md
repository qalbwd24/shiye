# Android 外部聊天、会话列表及交互需求（023 接续）

2026-10-19。用户要求只读手机当前“聊天界面测试2”，新意见按直接提示词同等优先。已读取当前房间 -104 的38条消息（105–142，其中1条撤回不恢复、10条图片消息）及空草稿；10媒体按SHA去重为6张截图和1份GIF，截图均已查看，GIF仅静态首帧检查，不把测试素材当功能需求。原文/私人图片只存 `var/android-diagnostics/2026-10-19/ui-external-chat-feedback/`，不进APK或公开夹具。未切手机页面、发送、保存或改偏好。

本文件为UI022之后的接续要求，不能因UI022某一局部测试通过就自动关闭本表。UI022仍独立冻结QA12；新候选须另冻结，保留021旧桥与共享runtime候选的实际边界。跨端壁纸与独立审批按[023契约/门槛](ANDROID-023-CROSS-DEVICE-UI-CONTRACT.md)执行。

## 用户已直接确认

1. 点击文字联想表情并发送后，清空整条输入框文字；发送失败保留可恢复原草稿。异步发送期间新输入的文字属于新草稿，不能迟到清空。
2. 输入框默认单行紧凑、输入字号略小于消息；两种字号独立可调，多行自动增高。用户另已确认把现有16/25也改为消息16/输入14，当前手机未直接修改。
3. 输入法原已打开时，长按消息、选择表情、发送图片均保留；全屏看图暂收起，退出后恢复先前状态。
4. 表情支持常用/新增/手动排序，并可调整常用排序中的新增优先程度。
5. 用户说明是类似QQ的图文消息：图片嵌在消息气泡，可正常打开。后续[跨端契约](ANDROID-023-CROSS-DEVICE-UI-CONTRACT.md)已据电脑格式明确：同一业务消息的文字和图片可分多个视觉块，但不拆成两个业务消息ID；原件、单位、引用、评论、撤回及归篇关系保持。

## 逐项需求与验收

| 编号 | 来源消息 | 必须达到的行为 | 核心验证与当前阶段 |
|---|---|---|---|
| X23-01 | 105/106、直接答复 | 收紧输入框高度与字号；独立输入/消息字号，多行增高 | 320CSS/density632/font1.3真实一行、多行、键盘开关；需求已确认，待候选 |
| X23-02 | 105/119/120 | 先调查当前电脑功能/代码，再对齐新建/自身会话设置：壁纸、名称、个人/群聊、参与程序、归篇分类/无新消息截断间隔idleHours（默认5小时） | 电脑ui48与原子设置契约逐字段矩阵；手机触控布局继续独立，不能用假控件替代持久保存 |
| X23-03 | 108 | 选图发送不闪出旧vendor发送页，直接显示本应用发送/上传中状态 | 实际录制选图→待发→ACK，失败可重试，不闪回旧页面 |
| X23-04 | 108 | 大视频/文件独立上传，其他消息可继续发送 | 每项独立状态/稳定操作ID/进度与失败恢复；本地ACK与服务器完成区分，需与后端同步 |
| X23-05 | 109 | 键盘拉起时最近消息被正确顶上来 | 底部跟随、中段保锚、搜索显式锚分别测；QA12中段通过不代替本条底部样本 |
| X23-06 | 111/113/115 | 长按只出现应用菜单，拦系统/OEM重叠菜单；选的是消息正文而非菜单字 | 文字/图片长按、局部选字、复制/粘贴/引用；MagicOS菜单单独验，浏览器contextmenu不等于原生ActionMode |
| X23-07 | 114/116/129、直接答复 | 长按/选择表情/发送图片保留原键盘；全屏退出恢复 | 有/无键盘、长按文本/图片、发送/失败及看图返回；不得干扰正在组合的中文 |
| X23-08 | 112 | 渲染电脑图片附带文字；不要求本轮安卓创建同种文字 | 已确认类似QQ的图文气泡、图片可正常打开；按跨端契约，同一业务ID可有多个视觉块，不能拆为新业务消息ID；保持原件、caption/entities、单位顺序与引用/评论/撤回 |
| X23-09 | 118 | 撤回可重新编辑，功能向电脑最新版本对齐 | 当前ui48为本人不限时编辑/本机持久恢复、原条无正文提示、原时原位后继；不得误沿旧两分钟限制或把旧正文上传后台 |
| X23-10 | 123 | 两个列表页上下透明，底部三个入口用小按钮框，框透明度可调 | 日记/会话列表两页，状态/导航安全区、壁纸连续、可读可点、不会穿透误触 |
| X23-11 | 124 | 会话列表新增会话移入设置；搜索与设置靠右，搜索左/设置右 | 普通与共享目录都核查，创建实际可达，不保留重复顶栏＋ |
| X23-12 | 126 | 搜索点开后返回保留上次结果、关键词、结果位置；聊天返回搜索页仍在原处 | 全局/本房入口按查询和房间隔离，不重搜、不跳结果顶端；显式换词/清除再刷新 |
| X23-13 | 126 | 搜索结果加时间戳、提高信息密度、扩大有效窗口 | 日期时刻、会话名、匹配片段；窄屏/键盘显示更多可选信息，不被固定底栏盖住 |
| X23-14 | 131、直接答复 | 表情可选常用/新增/手动；常用中可调新增优先程度 | 稳定同分顺序、使用统计/新增时刻、重开恢复、旧表情保持；先写算法目标再实现 |
| X23-15 | 133 | 发普通文字后，未用的预选表情栏清掉 | 清空输入、正常ACK/失败/切房/重开生命周期；不残留上条建议 |
| X23-16 | 134 | 每次输入后预选栏不闪烁 | 相同候选复用DOM/URL；候选改变平稳更新；录制输入逐帧检查 |
| X23-17 | 136、直接答复 | 点联想表情发送后清空整条输入文字 | 成功清对应草稿，失败保留；迟到ACK不清新的输入，不把一般表情面板发送的草稿规则混入 |
| X23-18 | 136 | 联想表情功能可开关 | 明确设置入口、关闭立即消失、重开保持，不只隐藏现有栏但后台继续刷新 |
| X23-19 | 139–141 | 发送可选立即出现/平滑动画，参考QQ效果，非线性过渡，修闪动与出现逻辑 | 稳定消息身份、临时→正式ACK不重挂/重复，同文独立；单发/连发/媒体/中段，实际录制逐帧，不称物理120FPS |
| X23-20 | 142 | 页面大幅切换统一做好平滑非线性过渡，防白闪/跳动 | 列表→聊天/返回、搜索→定位/返回、设置父子页，保持真实目标焦点与原位置；不能只整屏透明度遮掩空帧 |
| X23-21 | 后续直接消息 | 打开会话/日记编辑等场景壁纸及消息渲染专项优化，不卡顿/闪烁/跳动 | Astra规划解码/首绘/挂载/节点复用调查与方案，Sol执行，按G9实际关键帧与耗时验证；独立Sol高审核，不达标继续调研成熟方案 |

## 电脑功能调查入口与审核职责

当前应以2026-10-19 ui48，而非旧ui21或最初预览表单为准：

- [ui48本人原位编辑/本机恢复验收](validation/2026-10-19-chat-message-reedit.md)，`previews/telegram-chat/shiye-chat-ui.js`、`shiye-input.js`、`shiye-room-workspace.js`、`shiye-conversation-services-ui.js`、`shiye-conversation-messaging.js`；最终包冻结manifest在outputs/2026-10-19-chat-message-reedit。
- [统一会话API](CONVERSATION-MESSAGING-BACKEND-API.md)、[共享会话目录](SHARED-CONVERSATION-DIRECTORY-V1.md)、[Android共享runtime候选](ANDROID-SHARED-RUNTIME-V1.md)；功能存在于服务端/模块不代表Android当前已接通。
- 图片配文/原件/单位/评论按[跨端内容契约](DESKTOP-ANDROID-CONTENT-CONTRACT.md)，收藏备注不是消息caption。

最新分工：Astra只负责调研与规划，Sol负责执行，独立Sol高只读审查需求→实现→实际证据→未验边界，根负责协调、冻结和设备。旧“Astra实现审美/难代码”分工已被用户覆盖。需要逐条有状态，不以测试数量代替需求。任何字段/写入owner/引用/撤回/上传队列变更先同步后端契约。源码、隔离验证、QA安装、普通包、手机实际安装分别记录。

用户新增跨端壁纸要求已确认：同张原件共享、手机cover保持比例适当裁剪、位置/缩放/遮罩透明度各端独立保存；绑定字段/端点由后端共同定稿后再实施。独立Sol高审批标准见上述契约，不能以并行调试尚未互通为由忽略未来互通要求。

用户进一步明确壁纸图片默认同步，可按每个会话关闭同步分别保存电脑/手机图片；重新开启采用原共享壁纸，保留各端独立图片便于以后切回。不改各端独立显示参数的既有确认。

## 离开前最终确认及表情补充

- 消息默认短促非线性平滑过渡，保留立即出现选项。
- 大文件发送时原位进度占位，后续文字不受阻，完成不换位置；队列身份、引用和重试顺序按G4/G7核验。
- 默认常用优先＋适当新增加权；旧手工序位保留以便切回，不能因缺新字段继续默认为手动而违背新确认。
- 用户进一步明确“表情包排序也是推送优先级”：面板排序和输入联想优先级共享同一偏好/统计基础，联想仍先过滤相关候选，再按已确认优先级稳定排序；不匹配表情不得只因常用挤入。推送粗糙问题需专项改善匹配/稳定候选/预览/清栏，不只改网格排列。
- 表情面板当前粗糙，需要参考QQ成熟层级和流程重做显示、展开收起、预览/管理及触控目标；保持用户已确认的键盘与草稿行为。手机AOSP实际打开/收起、选择/长按/滚动和逐帧结果由独立审查，不能只看CSS。
- 不同步的电脑/手机壁纸也要随服务器资料保留、换机/重装分别恢复，早期仅本机安装身份方案已过时。显示参数仍各端独立。
- 后端会话确认用户手机当前主要测试资料，先完整保留，后续可批量归“测试”等分类；本轮不自动迁移、归类或删除。

## 表情面板候选交互目标（实施前登记）

依据用户“粗糙、向QQ成熟交互学习”的要求，当前计划为不抢输入焦点的非模态停靠面板，位于聊天输入栏上方；键盘开启时依真实剩余视口调整高度，网格独立滚动。头栏为表情/添加/管理/收起；三种排序分段条，新增权重折叠到二级；320CSS四列等宽图、单行名称和GIF标记；长按预览/管理，纵滑取消长按；展开收起短非线性位移。保留原件ACK、createdAt原子持久、查看器实际release Promise、草稿与键盘规则。主源参考Material标准面板可与主界面共同交互；QQ公开页面抓取未获得可核验细节，不宣称取得内部算法或精准复制。此段为早期实施前目标，后续角色按“ Astra规划、Sol执行、Sol高独审”执行；候选仍按源码/截图/真实触摸/逐帧给分层裁决。

2026-10-20 Q14/X23-12/13 本房搜索由主控委派 GPT-6.1-Sol/high 私有实现，等待非作者准确SHA审：`outputs/2026-10-20-android-ui027-room-search/frozen-v1/manifest.json` SHA49afa4c94e1218a5625b28b74fbda837888a261e7c9067810d516d271a91b656，父026 stage d6c9b413。仅qq-chat/view.js、legacy-source.js、新room-search.js，无android-chat/native交集。正常header入口复用原worker全历史search(chatId/query/offset)与WebA focus/history/locate owner；room+query12会话缓存、分页/时间片段、命中返回词/结果/位置、原阅读锚/草稿、跨房/迟查询/迟命中和composition Enter已在隔离真实WebA/worker/IDB16项通过，旧失败保留。源码候选未合包/独审/构建/设备通过，shared源无能力入口隐藏，物理IME与同包回路仍待验；不据此关闭整个X23-12。交接与边界见同目录HANDOFF.md，无canonical/API/正式资料或设备动作。

2026-10-20 Q14/X23-12/13本房搜索准确49afa4c9…已由非作者GPT-6.1-Sol/high定向SOURCE_ADMISSION，报告 `outputs/2026-10-20-android-ui027-room-search/independent-review/source-review.md` SHA `6397002d82063cd3b2797c05208cee0967142307310a262e510a11c09c9c8b3c`。026父d6c9/三源before-after/patch与LF重放逐字节核齐；独立复验作者16项直接路径，补一致部分global缓存缺1000的原focus/worker真实加载→可见→分页位置返回，并将原history loader延至切房后完成，新房80节点及scrollTop6541保持、不抢视图。首次仅删byId而viewport仍有目标的测具失配、默认git CRLF重放字节失败均原件保留，非产品失败。仅准主控窄合此legacy本房源码；shared无能力入口隐藏，未构建/APK/设备/ADB/API/canonical/stage/正式资料动作；native back、真实IME和准确同包QA待验，不关闭整个X23-12/13，不碰并行分割线。

2026-10-20 X23-10/Q15底部三按钮框私有后继027已冻结待非作者审：`outputs/2026-10-20-android-ui027-bottom-nav/frozen-v1/manifest.json` SHAd7d7fdc88a9505beafa4b30fce4227933afcf01fcc703e857032f3b90ab2b12a，父D6不动；新BottomNavAppearance＋MainActivity六处token/hunk＋AppSettings单入口，不覆盖trash同文件段。单独key缺省0、三小框同控0–100，只淡框背景，字形/48dp热区/原bar透明及壁纸/行参数分离。保存成功才更新原nav；失败含SharedPreferences内存先写回退，取消不改，模块切离仅草稿/位置待主动重开。实际3生产Java JDK17/SDK36编译与真实frame/read/persist方法19项过；首Git autocrlf重放失败原件保留，后继显式LF精确hunk/字节重放通过。准确patch/hunk-plan及边界见同目录HANDOFF；未canonical/APK/设备/API，搜索49afa4c9冻结未动，不能代设备paint/生命周期通过。

2026-10-20 X23-10/Q15底部三框独立alpha候选 d7d7fdc88a9505beafa4b30fce4227933afcf01fcc703e857032f3b90ab2b12a 已获非作者GPT-6.1-Sol/high SOURCE_ADMISSION，仅027后继源码窄合：报告 `outputs/2026-10-20-android-ui027-bottom-nav/independent-review/source-review.md` SHA `f4f6216a4ac76b613a4206d88dd860a6c47af5136a4d43f76d6bfdcf9f3072d0`。父D6/三源身份、MainActivity六token与AppSettings一token、LF replay字节核齐；真实三生产Java API36/JDK17独立编译/19helper通过，完整生产BottomNavAppearance方法以平台事件/偏好/队列shim跑28状态断言过，覆盖取消/切离未生效草稿续接、commit内存先变后失败精确回滚/保草稿、明确保存一次收口/旧host保护。缺省0只给原48dp三小框底色alpha，不淡glyph/text/原selected cue，不改bar/系统栏/列表行/壁纸；旧实色glyph pill移入受控框色避免0残膜。真实Dialog/SeekBar/手势/像素/同包冷读待root，不当设备通过；MainActivity/AppSettings须按hunk-plan与trash窄合，不整源覆盖。未canonical/stage/APK/ADB/API/正式资料动作，旧autocrlf失败保留。

2026-10-20 X23-02 legacy真实设置一源候选待非作者审：`outputs/2026-10-20-android-ui028-room-settings/frozen-v2/manifest.json` SHAc3cb1ed872e3c306d4eb2202578edbf1ca72b2ed48168dee8e951024ffc9481e；父027准确544b，android-chat722fd→db9c，原027/search/native/runtime/CSS保持。新增kind/名称说明/默认5可调idleHours/程序备注真实worker保存、按房缓存/取消/真实父级/后写输入保护；category原值只读、备注不执行，自动归篇/程序完整接线未代完成。shared本轮全部资料保存/新建只读禁用，避免kind忽略/分类任取首/无baseCAS假成功。逐字段源SHA/函数及旧bundleb048与已审client6567/5797差异见capability-matrix4001dcce；无bundle/native/新wire或data owner动作。真实隔离WebA-worker-IDB18项、shared生产函数门槛DOM8项、LF/hunk精确重放过；v1读回期间新稿丢失原反例与route未ready control失败保留，v2修直接反例。仅源码候选，不是X23-02全完成/同包设备通过；无canonical/APK/设备/API，详HANDOFF。

2026-10-20 X23-02/Q15 legacy会话设置后继028一源v2已获非作者GPT-6.1-Sol/high **SOURCE_ADMISSION（partial scope）**：manifest c3cb1ed872e3c306d4eb2202578edbf1ca72b2ed48168dee8e951024ffc9481e；报告 `outputs/2026-10-20-android-ui028-room-settings/independent-review/source-review-v2.md` SHA `84a64f18c6baf27ce2cd81617c8695218d43a5bff5badd3361e5950e9df85722`。父544b、android-chat.js722f→db9c、patch/hunk/声明证据与LF字节重放核齐；独立真实WebA/worker/IDB复现v1 ACK后刷新失稿namedInputs0→v2保新稿1，原18直接路径及新间隔端点/非法/合成横纵滑6相邻过，category/participants/unknown原值保留。shared生产函数existing/new的8门槛独立过，名称说明readonly/保存新建disabled/强制submit拒绝write0；这只是当前旧bundle的显式门槛，不是shared集成。仅legacy既有title/description/kind/默认5可调idleHours/程序备注源码完成；category仍原值只读，程序catalog/执行、多slot/参数、taxonomy选择/真正归篇、shared带CAS编辑与新建/本地服务ACK及跨端壁纸仍未接，不能关闭整个X23-02。原v1/夹具失败保留，无作者/canonical/stage/GradleAPK/ADB/设备/API/后端/正式资料动作；F26背景/alpha/单线/hook块保持，真实Android/IME/准确同包待root另排。


2026-10-20 X23-09/Q14 后继028只读能力核查完成，保持未实现：准确027 stage544b266e…实际main/worker无PC原位替代字段及私有持久恢复store；真实隔离WebA-worker只读source仅withdraw，通用editMessage函数不等PC替代动作。10实际加载源逐SHA核父；PC原21源与UI49/A1h31参考源/实际sourcesContent已核，最小缺口矩阵与每源SHA见 `outputs/2026-10-20-android-ui028-message-reedit/HANDOFF.md`、`capability-matrix.json`、`pc-reuse-source-map.json`。需要主控决定最小vendor源码接缝后再实现，不能仅加QQ按钮、拿previousLocalId代替replacement或后台存旧正文；本轮未改产品源码/构vendor/GradleAPK/设备/API/正式资料，未扩大native/data8/后台wire，027与并行设置候选保持隔离。只读审计不代功能准入或设备通过。
