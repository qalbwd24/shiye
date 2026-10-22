# 拾页界面偏好与待合并规范

2026-10-19当前ui53已正式启用：新增本机last-room导航与有界热文字选区恢复，存储域见下表；不新增portable业务字段或同步owner。原ui51发送按钮可选/输入拖高/hover保持，原生悬停true/revision1已通过正常保存实际落盘；[正式验收](validation/2026-10-19-chat-ui53-continuation.md)。下方旧待启用阶段为历史。

2026-10-19最新正式阶段：showSendButton及held输入拖高/owner-v2已独审并随ui51标准启用，沿既有全局record、缺省true/显式false，未新增会话覆盖/跨端wire。下方待安装为中间记录，详见[ui51验收](validation/2026-10-19-chat-ui51-polish.md)。

2026-10-19 composer新增owner边界已窄修为owner-v2：同结构隔离双editor（旧禁用在前、active在后）命中原held尾字裁31.09px及选区丢失；新查询按实际resizer所属footer定位，保同editor/room身份与原反向选区，tailGap+9.91px。新6项和旧4项定向通过，原19项不重跑；候选/patch/SHA见outputs/2026-10-19-web-chat-improvement/composer-high/owner-v2/receipt.md。仅私有一wrapper，未正式合并安装，旧候选与报告保持。

## 2026-10-19：电脑随想逐项继承与图片默认

用户新要求可选择隐藏输入区发送按钮（常用Enter发送），设置需持久记忆，默认保现显示；隐藏后不保留空宽/不可见焦点，仍保原Enter/Shift+Enter和IME语义。具体存储已在专属候选沿原输入设置接线，未新增同步协议；portable optional沿下述已对齐端scope。上缘手动调高遮字是独立真实反馈，须按原手动/自动高度与独立输入字号计算，不把隐藏按钮当作唯一修复。首批ui49不混此后继改动。

开关作用正常聊天composer的发送按钮；附件/图片确认窗的发送、重新编辑保存/取消及手动分篇确认保留明确操作入口，不能用全局`.send`样式误隐藏这些动作。按钮隐藏也不得绕过附件准备/IME/旧编辑确认门禁。

后继候选字段确定为既有`desktop:thoughts/shiye-preview-appearance-v1`对象的可选`showSendButton:boolean`：缺省/旧记录显示，明确false隐藏。属于全局输入外观，不加入C1十字段会话覆盖；复用原record读取/保存与portable未知JSON（含false）保持，不新增namespace、消息wire或owner。已先向数据会话同步，沿其既有unknown保留兼容执行，尚未正式启用；若数据sanitizer/恢复提出具体冲突再收窄处理，不另起全量数据测试。实际拖动基线证实12行草稿缩至原低高度时held阶段尾字符超clip约31.09px，松手旧focus-end才恢复；小修沿既有measure/mutate保原来已贴底的输入scroller跟随，用户中段阅读与选择不强拉，不改旧36/floor/80compact/160auto规则。

2026-10-19 Sol高专属composer候选已完成上述既定范围：实际外观设置复选框写原record，跨窗storage与重开尊重false，隐藏清display/宽/gap；转发附言的实际send状态由原ComposerEmbeddedMessage转发标记保留，编辑/附件确认仍可见。held阶段同时保贴底草稿及原中段选区，移除pointerup强制focus-end；19项隔离定向通过。候选/精确patch/SHA与未验边界见outputs/2026-10-19-web-chat-improvement/composer-high/receipt.md；只私有三文件，根尚待合并/独审/标准部署，未触正式运行。

用户后续明确逐项继承还包括消息字号、输入字号、发送动效；按既有屏幕字号/窗口记忆计算优先级，不让会话覆盖回写全局。窗口尺寸位置/上次会话与各房阅读位置/草稿/已加载内容两类记忆都要，resize算法单独调研/对照优化。原UI需求与人工表为权威，本页维护具体偏好语义，不另造设置体系。

### 逐项覆盖的端内兼容（已随ui49独审交付）

复用现有 `shiye-room-appearance-v1` 按roomID保存稀疏对象，不另建一套外观存储。保留 `theme/shade/bubble/radius/messageGap`，已增可选 `font/fontSize/inputFontSize/messageAlign/messageRenderMode`；此处字体与对齐是现有外观控件的同类显示项。缺键读全局，明确同值仍表示覆盖；单项恢复删该键，全部恢复清显示覆盖但不删未知业务字段或壁纸资产。旧五字段完整对象继续五项覆盖，不因恰好等全局猜测继承；范围/枚举复用原全局控件。

消息实际字号为本房有效fontSize乘当前屏textScale；明确inputFontSize独立CSS px，保持原输入字号兼容逻辑。消息动效按本房messageRenderMode→旧全局shiye-message-render-mode→原instant缺省，尊重系统减少动态效果；房覆盖不得改全局key，切房利用原stopSendMotion收尾防旧动效回灌。字体/对齐也只作用本房，参数编辑取消不得持久覆盖。

本方案只是本端显示偏好，不增message/journal/shared wallpaper wire或owner；数据兼容已回执，C1十字段/C2b返回隔离独审及最终ui49定向合包审核通过，已正常标准升级、原生ready启用，见[交付](validation/2026-10-19-web-chat-improvement-ui49.md)。正式资料不另发测试消息，不把启动ready当全场景原生实测。后续字段/缺省改变先回写本节并同步相关会话。壁纸图片继续原独立业务/CAS/ACK，位置缩放遮罩的端内显示归属不变。

数据会话已回执：此既有namespace在PC16键采集白名单，scope为desktop:thoughts，与Android独立；五个optional显示字段及未知可移植JSON字段可按现snapshot/seed保留，无需新后端schema。缺省/删除/同值覆盖由端内resolver解释；原password/token/本机路径/壁纸资源/运行身份等私有过滤与256KiB/30000节点限制继续适用，不能把“保未知字段”理解为上传全部私有状态。已允许在专属C1候选接表单/保存，仍需源码/同包UI独审后合包。

用户确认会话外观默认逐参数跟随全局，可分别覆盖、单项恢复跟随和全部恢复；全局变化继续影响未覆盖项。图片上传本轮新默认为压缩，可手动选原图；旧已显式保存偏好须兼容。设置从会话列表进入时返回该列表。鼠标触发贴边收起窗口展开后需激活并聚焦聊天输入，保留草稿/光标；设置/看图/输入法边界须实际验证。外观/设置候选已有上述局部审核，A2原图入口与D1原生焦点仍待实施/验收，全部尚未部署，详见[主需求](WEB-CHAT-IMPROVEMENT-2026-10-19.md)。

### PC真实资料采集的现有命名空间清点

此节只登记现存存储与资源关联，供数据会话采集逐项核覆盖；不新增同步格式、不把原私有过滤放开，不从16键portable名单推断资源已采齐。

| 现存位置 | 内容与关联 | 采集边界 |
| --- | --- | --- |
| `shiye-shared-directory-port.js`的`DESKTOP_PORTABLE_PREFERENCE_KEYS` | 原16个显式localStorage键；含全局`shiye-preview-appearance-v1`、按roomID的稀疏`shiye-room-appearance-v1`、命令与显示偏好 | 复用导出的reader与原sanitizer；C1十字段可移植值保持，壁纸资源单列 |
| localStorage `shiye-room-order-v1` | 稳定房ID数组 | 属会话目录手工顺序，不能当一般偏好替代目录状态 |
| IDB `shiye-preview-assets-v1` / `assets` | keyPath `id`，原件为`blob`；全局图`id='wallpaper'`，会话图`wallpaper:room:<uuid>` | 会话关联来自worker `shiyeRooms[roomId].wallpaperAssetId`；同图派生192px头像，没有独立头像权威。原件按字节/hash分流，不复制blob URL |
| 同一assets store `sticker:<uuid>`、`sticker:server:<id>` | 原件`blob`、可选派生`previewBlob`、名称/备注/分组、contentHash、本地/服务器身份和待同步元数据 | 保原本地UUID/原件/动画，与服务收藏身份显式关联；缓存缩略不能替代原件，未确认写入不伪造成服务器ACK |
| 同一assets store `mapping:<name>` | `kind/value/assetId`，指向本地表情或emoji | 别名仍原ID；引用到收藏原件，不能只采一个字符串而漏资源 |
| 同一assets store `preference:sticker-order-v1` | 版本/模式/稳定表情ID顺序 | 既有本机排序偏好，单独端scope；不能无协议改为全端共享顺序 |
| localStorage `shiye-symbol-usage-v1` | 本机表情使用计数 | 端内历史，不在原16键名单，不默认为共享业务；需保留则列端内恢复附录 |
| IDB `shiye-telegram-preview-v1` / `preview` / `library` | 房/active与archived目录、完整已提交messages、documents原bytes等 | 同一readonly事务取已提交逻辑；用原journal source UUID，端内retry字段与业务分离 |
| IDB `shiye-journal-link-v1` / `settings` / `link` | 原`sourceId`、房归篇设置/映射 | 仅读既存身份，绝不能在采集页调用产品初始化创建新UUID；运行/鉴权秘密不导业务 |
| IDB `shiye-withdrawal-recovery-v2` / `recoveries` | 仅本机撤回恢复正文与媒体identity | 私有恢复材料，不共享撤回原文、不复活后台墓碑；不得因资源扫描把它作为已发送业务 |
| localStorage `shiye-room-viewports-v1`、原Teact全局缓存与宿主`window.json` | 阅读锚点/草稿与编辑缓存、窗口和屏档案 | 本机恢复域；与已发送正文/portable设置分开，未提交File准备不在已提交library中 |
| localStorage `shiye-last-room-v1`（ui53） | 最后真实ready的数值room ID，仅固定原生启动URL无活动房时使用 | 本机启动导航域，不加入portable16键/共享业务；显式链接/新操作优先，目标失效或storage拒绝沿原第一房回退。从本版显示房间开始记录，已随ui53启用，见validation/2026-10-19-chat-ui53-continuation.md |
| 运行内存room/thread文字选区Map（ui53，最多64项） | 内容长度/双hash签名、节点path/offset、方向及独立input-scroller top | 热视图恢复域，不持久明文/不加共享wire；同内容/当前代际才恢复，输入/IME/新意图优先。冷重开/媒体/编辑及转发确认不在该范围 |

全局旧外观内`wallpaper`可能仍是待迁的data URL，现代码会迁入assets；只读采集不能执行此迁移。临时blob URL不是原件，未引用资产不得自动丢弃或猜成当前壁纸。独立capture host若使用profile副本，同origin空白页仅读既存库，原备份保持不变；稳定快照不等于持续增量或Android已显示。

真实采集确认当前全局旧图仍在该data URL、assets没有`id='wallpaper'`，不能只采10房图后漏全局fallback。与数据会话确认的显式恢复候选：原`desktop:thoughts/shiye-preview-appearance-v1`保其他键，将data URL表示成可选`wallpaperAssetId`（完整SHA/size已验证的server media UUID），原件纳包，sourceReceipt保原字段/memberSHA→asset映射。此指针仅在后续显式profile导入/恢复resolver消费：先取回并核验原件、落既有本机全局assets，再原子沿原显示fallback切图；失败保旧图并可重试。不串Android/global或每房壁纸三域CAS，不把server UUID直接当blob URL。ui49 A/C不强混此新恢复字段；现阶段只表示原件/参数保留，UI尚未消费或验恢复。

真实采集另发现五个键，现行语义已核：`shiye-input-height`仅旧验证脚本写，当前产品不用；输入高度用cap-v2/manual-height-v1，不猜旧值转换。`shiye-room-state-v1`只是folderManager启动的pin/archive显示缓存，worker事件会重建，不覆盖library权威。`shiye-room-switch-sidebar-v1`是迁移回执JSON（previousMode/effectivePreviousMode），缺失时启动会将旧switch-mode设sidebar；`shiye-switch-timing-v2`是已迁标记，缺失且delay为800时改1200。两迁移键仅列desktop恢复兼容域；完整恢复已选mode/delay时必须防再次迁移覆盖，可在初始化迁移完成后应用偏好并复核，不把flag做Android共享设置。`tt-last-activity`为passcode/autolock本机活动时钟，不上传或跨端复用。以上非16键portable名单的自动扩大；必要值仅在独立work副本窄读，原profile/backup不改。

## 2026-10-17：紧凑输入与消息间距

用户要求输入栏略下移、矮栏提示下方空白均衡、最新消息靠近。ui20已按真实高度统一底部预留并居中低输入内容；保留用户手调高度和高手调顶部起笔。笑脸移除是条件建议，本轮保留按钮及既有命令入口。见[验收](validation/2026-10-17-composer-spacing.md)。

本文件记录用户明确认可的设计及适用范围；待用户决定后再合并电脑端agent开发规范，不直接作为其他软件的永久通用规则。

## 2026-10-17：字号与留白分开、设置分层

用户追加确认（U52/ui19，已启用）：气泡留白按独立 CSS px 数值调整，不跟消息字号等比例放大；消息字号/原文字缩放只影响消息，输入框字号独立，输入提示文字与实际输入字体、字号、行高一致。兼容迁移优先保留旧输入的实际大小。设置参数使用独立滚动区域，保存/关闭置于稳定操作区；返回只退到真实上一级，不错误关闭整个设置。导航不静默丢弃未提交表单。运行状态与验证见 [U52](CHAT-ROOM-SWITCH-2026-10-17.md)，已通过最终浏览器、原生及安装回读。

## 2026-10-17：随想外观变化保留可选项

用户要求文字气泡四周增加均匀留白，并提出此类修改应在设置中可调，不喜欢时可恢复原有体验。本项目后续涉及留白、密度和动效的主观外观变化，优先提供清楚的预设、必要的数值范围和恢复默认入口，兼容已有明确偏好。恢复旧外观通过展示设置完成，不要求降级程序或回滚数据；数据正确性与错误修复不因此变成任意关闭的旧版本开关。

U51 对应“即时显示/平滑过渡”“均匀留白/原有紧凑（6–24px，默认12px）”“柔和收敛/原有曲线”。手动输入高度记住用户选择，保留原拉伸柄 Home/双击恢复自动。功能、验收和实际启用状态见 [U51](validation/2026-10-17-instant-message.md)。

## 2026-10-17：便签目录的自适应材质

用户明确认可：**窗口足够宽时，目录与标签/正文处在同一层、透明共用同一个背景，用细竖线分隔；窗口变窄需要覆盖正文时，目录使用适度毛玻璃帮助分层。** 用户反馈“这个设计挺好的”，要求保留并写入开发文档。

- 宽窗以同背景、低装饰、细分隔线建立布局关系，避免额外不透明卡片或厚阴影。
- 窄窗覆盖层以局部模糊增强文字可读性，同时保留标签、设置、关闭等可操作入口。
- 材质跟随窗口可用空间和覆盖关系，不为展示效果给所有区域叠毛玻璃。
- 当前便签用CSS backdrop-filter实现窗口内部的覆盖模糊；它不等同于透过原生窗口看桌面壁纸。

实施与验收：[UI5](validation/2026-10-17-notes-natural-docked-motion.md)。本轮补充的原生灰边/置顶/记忆及系统材质研究见 [UI6](validation/2026-10-17-notes-frame-memory.md)。

## 本轮窗口一致性要求

便签的尺寸/位置、字号/缩放和置顶应可恢复，关闭前等待保存；基本窗口能力与思绪一致。置顶放原生边框标题栏，灰色边框参考随想。壁纸关联材质先调查当前WinForms/WebView2宿主的真实支持和回退，区分已经呈现与后续方案，不用“设置了DWM属性”冒充用户已看到Mica。

### C1 专属候选接线约定（2026-10-19，尚未安装）

常规执行在sol-candidate沿已冻结C2 wrapper增量：十字段沿既有room-appearance key保存稀疏覆盖，不建立新namespace。每项跟随/自定义及当前有效值，单项恢复删除对应键，全部恢复仅删除十个显示键，未知可移植JSON键（包括false/0）保留。保存时才写localStorage，写成功后才替换内存roomAppearances/标记saved；失败保持dirty和表单。原五项完整对象仍五项明确覆盖，显式同值不推断成跟随。

resolver保持原fontSize14–24、inputFontSize7–60及原theme/font/align/mode枚举；消息CSS=有效fontSize×本屏textScale，输入CSS=有效inputFontSize。原全局inputFontSize缺省迁移单独函数只读全局fontSize/TextScale，绝不由房覆盖触发回写；原生window-state就绪后仍按原机制只迁移缺失项。

使用既有shiye-message-render-mode-changed，detail仍为字符串instant/smooth/legacy，无新wire/事件schema。apply按房覆盖→旧global key→instant解析后派该事件；切房仍由既有shiye-room-switch-start处理stopSendMotion，不重写scheduler。全局动效控件只写旧global key，再apply有效房值，不把房选择写全局。跨窗storage变更重新读现key并应用；该监听不改变消息/壁纸owner或公共数据协议。
