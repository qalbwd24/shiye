# Android 016：QQ式独立聊天渲染器适配审计

2026-10-18，只读源码审计。用户要求换成QQ式聊天框架，保留现有功能；已澄清希望保留滑动消息回复、长按逻辑、自定义背景和输入工具栏，当前消息/设置多个框容易误触。本文仅分析数据与适配边界，不修改源码、设备、旧资料或015后端，不把QQ源码或某个UI SDK可直接嵌入作为既成事实。原生ChatKit等组件的具体选型、许可证和裁剪由根另行调研。

## 结论

可以用独立原生聊天视图替换Telegram页面，同时继续让现有本地TL库作为唯一消息/草稿权威；前提是先提供**不依赖旧UI的单写数据服务与完整读写port**。现有包装层不是这样的服务：发送、回复、附件准备、会话切换和草稿仍依赖Web A组件、getGlobal/getActions及编辑器DOM。仅把旧WebView藏到原生列表后面再调用这些对象，可以作为短期适配实验，但仍依赖旧UI，不能宣称已经独立替换。

真正可行的第一条路线是保留同一应用WebView数据目录/同源存储，抽出冻结MockClient/shiyeLocal及必要TL编解码/附件读写为无聊天DOM的本地服务，由原生视图经受限消息桥调用。原生只持有显示快照和输入会话状态，不另存第二份可编辑正文。是否完整无DOM启动、代码闭包及图片编解码在服务宿主中可用，仍需下一阶段原型验证，当前没有完成的headless产品模块。

不能让原生SQLite与TL IDB各存一份可编辑消息，再后台互抄。若最终选原生完整Repository为权威，需要另立保留式切换任务、身份映射和一次性迁移/回退门槛；这不是本轮换UI的顺带操作，也不能拿015的Entry准备模块当作已经存在的聊天Repository。

## 真实基线与权威

build.mjs明确从冻结ui18发布目录`outputs/desktop-maintenance/releases/2026-10-17T18-38-43-932Z-3b4b2c77/app`生成Telegram主体；共享input/stickers及Android wrapper在此之上增量装配。不要用当前vendor工作树的新增set-state/program等能力代替手机实际冻结能力。

本轮只读的014构建worker为`tmp/android-media-014/telegram-build/assets/telegram/worker-DVw1Ca6d.js`，SHA-256 `cf21c75a7666a69accb02ef651ab0a451e6ad1f1b578d7fffa7d5ba79ea09a8c`。内含Android库名、withdrawal-ack，未含set-state。精确冻结源码可由原sourcemap核对；此前摘出`tmp/android-chat-ui-08/archive/ui18-{shiyeLocal,MockClient}.ts`与归档审计一致。压缩bundle中有TL类型名不代表MockClient实现了对应业务；例如类型定义含EditMessage/SendMultiMedia，冻结本地请求处理却没有相应完整分支。

| 资料 | 当前实际权威/位置 | 替代时要求 |
| --- | --- | --- |
| 房间、消息、draft、原件document bytes、撤回墓碑 | 同源IndexedDB `shiye-android-telegram-v2` v1，`preview` store的`library`；MockClient持有内存mockData并编码整份快照提交 | 保留库名、版本、应用profile与源，唯一writer；不由原生直接改IDB或重建瘦身library |
| TL对象/BigInt/typed array | shiyeLocal的encode/decode与Api构造器；未知JSON字段/shiyeType和二进制有既有语义 | 无损透传/保留，不能用普通JSON表单重建、把BigInt或bytes变为有损number/object |
| 收藏原件、192px派生预览、旧alias、本机图库顺序 | `shiye-preview-assets-v1` v1的`assets`；sticker:、mapping:、`view:sticker-panel-order:v1`记录 | 保持资产ID、Blob/previewBlob、未知字段及软删除；顺序仍独立本机偏好，不塞后端DTO |
| 后端收藏身份/元数据 | 既有受保护收藏服务；shared client保留serverStickerId/serverMediaId/serverStickerSnapshot等缓存 | native固定transport沿现有scope/认证及分块校验，不能把收藏接通当全消息同步 |
| 会话置顶/显示/背景 | native preferences load/commit；pinIds、appearance、roomAppearance、roomBackgrounds、listBackground/chatBackground等 | 保留未知偏好、显式手调和父子覆盖，不被新UI缺省覆盖；旧IDB偏好键仅兼容来源 |
| 背景原件与头像 | native私有文件与受限`/telegram/local-background/…`资源URL，prefs只存assetId/url/avatarUrl等引用 | 不将dataURL塞偏好；替换视图仍通过受控资源port使用，不删除旧文件 |
| 输入命令、媒体压缩偏好 | localStorage `shiye-input-commands-v1`、`shiye-image-quality`等 | 原键/未知项保留，明确映射新控件；不恢复已被用户取消的入口或默认快捷键 |
| 原生全局主题、文件picker/导出、返回/IME/tab状态 | MainActivity/TelegramFrontend及背景/文件/收藏固定桥 | 新UI继承同一全局色调、应用生命周期与安全边界，不自创每页主题或任意URL桥 |

旧LocalStore messages表不是当前聊天权威。`shiye-journal-changes`的saved通知只是本地变化提示，不是完整增量日志/远端游标。冻结worker将encode后的library排入writeQueue，在IDB事务complete后才ACK；它没有当前桌面新增的完整写版本重放保护，因此更不能同时保留两个MockClient实例各自写陈旧整库快照。

## 必须保留的前端功能清单

以下按当前源码与已有交付文档区分实有/受限；没有本轮运行验收。原生替换不能以只显示文字/能发一条消息作为完成。

| 功能 | 当前接缝与保留要求 |
| --- | --- |
| 会话列表/进入/返回 | 原房间ID、标题、末条/草稿摘要、活动/已有归档分区；当前列表与会话切换状态独立；再次进入本地先显示、静默刷新不清屏 |
| 创建与修改会话 | list/create/update本地ACK；title/kind/participants及已有category/description/idleHours/servicePlan等原字段不被简化表单删掉；kind展示不等于后端群聊服务已实现 |
| 置顶与排序 | native pinIds与置顶首位；顺序/未知偏好及失败回执保持；不能新增一份房间顺序覆盖现有偏好 |
| 搜索 | 当前worker本地search与结果定位；显示查询状态并保留原房间/消息身份，不以标题匹配目标 |
| 文本/格式/时间 | 原message文本、entities、out/fromId、date、reply身份及未知字段；已知粗体/链接/代码等由新renderer表达，不能改正文来适应UI；格式未知时完整保留/明确受限，不静默去格式 |
| 发送反馈/列表锚点 | 临时发送行与持久ID关联；本地提交ACK与同步状态分开；确认换ID不重挂旧消息/重复追加，不因历史分页或图解码跳动当前锚点 |
| 草稿与中文输入 | 每房message/entities/replyTo草稿，经SaveDraft保存；输入法组词、选区、Enter偏好、Shift换行、迟到ACK期间继续输入保持；切房/离开要flush，不能把空白草稿变普通消息 |
| 待发附件/说明 | 普通照片预览、空caption可发送、Shift/IME保护、文件入口与最近图/视频picker，保留原字节/格式/MIME校正及取消；待发附件目前主要是composer内存态，不应声称已有完整崩溃恢复 |
| 原件展示/看图/导出 | PNG/GIF/WebP等原字节、动图预览、普通照片不误缩、看图焦点/菜单/返回次序及原文件保存；小缩略图与原件分开，不把preview作为重发源 |
| 表情包 | 单一紧凑图库、原件空caption直发并保留文字草稿/引用、按收藏hash/media关系做10字尺寸、不放大小原图；名称备注管理、软移除/本机拖动顺序；收藏ACK与来源核验/上传重试保留 |
| 文字联想/命名检索 | Android已支持本地名称/note/alias候选；组合输入隐藏、点选sendSticker不抢原输入Enter；当前桌面ui33新增检索/排列不能直接当Android已安装能力，需独立核实后接 |
| 引用回复/滑动回复 | 原replyToMsgId与引用草稿，选择来源后切房/新来信不偷换；新原生滑动仅触发此同一reply命令，不复制被引正文作为新权威 |
| 长按与撤回 | Android长按消息操作/二次确认，实际deleteMessages走撤回逻辑；删除正文与引用预览、保留墓碑/operationId/原ID及既有回复关系，实际持久回执后才确认，不改为物理删记录 |
| 系统/只读消息 | 保留原消息来源/只读标记；系统房不能随便归档。朝花夕拾正式绑定/收件/评论仍未完成，不把演示历史消息视为已接业务 |
| 外观 | 全局浅/深与透明色调、独立列表/默认聊天/每房壁纸和派生头像；可调消息/输入/时间字号、气泡留白/圆角/宽度/间距/透明度，保留原手动偏好 |
| 输入工具栏 | 常驻同一小飞机空内容禁用、附件与图库、键盘/面板切换、IME底栏隐藏恢复；控件不能跟随TG旧DOM残留，也不能默认弹多个相互抢焦点框 |
| 刷新/错误/导航 | 显式刷新轻量反馈、失败可重试、下拉意图；打开图库/看图/设置后按真实父级返回；flush失败保留页面/草稿与可理解错误 |

**现有限制保持明示：**归档入口当前禁用，不能用隐藏列表假实现。冻结本地handler没有完整EditMessage/ForwardMessages/SendMultiMedia业务分支，继承“更多原有操作”露出的按钮不证明编辑/转发/相册批量操作可持久；不能为移植凑功能把它们写成已经验收。语音/通话/Telegram网络等被裁剪功能不应因引入原生聊天组件重新出现。完整聊天云同步、长文Repository、朝花夕拾实例绑定/收件仍另属后续后端任务。

## 独立渲染器需要的port（以下均为建议接口）

现成BroadcastChannel只有list/create/update/search/flush/withdrawal-ack，不是完整聊天服务API。现有getGlobal/getActions、shiye-editor-request、editable-message-text和附件bundle导出都是旧UI接缝，不作为独立原生port保留名称或依赖。

| port | 读写职责/回执边界 |
| --- | --- |
| lifecycle/open + capabilities | 启动唯一服务writer，返回真实协议/本地命名空间/支持动作、库schema与快照代数；unsupported显式拒绝，不默认为成功 |
| listRooms/getRoom/updateRoom/createRoom | 旧ID与未知字段保留，patch而非重建；房间更新同服务队列提交；归档无真实能力时仍不可写 |
| readHistory/resolveMessage/search | roomId+安全游标/锚点分页，稳定字符串身份、原时间/格式/来源/撤回状态；不依赖DOM已有多少行；历史增量是可丢弃读投影 |
| subscribeChanges | 初始快照与变化/重载指示有顺序，重连可重取；UI代数与远端revision分开；重复通知不能重复消息，ID切换带明确correlation |
| loadDraft/saveDraft/flush | room/thread上下文、text/entities/reply、预期本地基线与输入序号；ACK只确认发出的快照，不把较新文字清空；flush等待所有消息/草稿/偏好/素材任务适当水位 |
| sendText/sendMedia/sendSticker | 一次稳定提交上下文：room/thread、原文本/entities、冻结reply、附件原件引用、关联临时行；服务分配本地持久ID，在同一次本地权威提交完成后回message/media身份；不以UI可见当ACK |
| prepare/read/cancel media | 用户选择URI→原件分块/私有引用，签名/MIME/容量与取消，原始hash/媒体ID和派生预览分开；原生不能接收任意本机路径或任意URL代理 |
| reply/withdraw/withdrawal-ack | 回复目标存在性/撤回状态校验；撤回复用同一墓碑/operationId语义，原引用关联仍可定位；error/ACK明确；暂不补无实现的编辑/转发接口 |
| favorites/catalog/materialize/metadata/source | 继续shared收藏语义、原件验证、完整最后确认DTO缓存、pending合并与真实来源；原生UI替换shared DOM但不另造收藏权威/名字ID |
| viewPreferences/theme/background | 原native字段保留式patch/ACK，图库排序等本机视图偏好独立；全局主题动态更新不销毁输入；壁纸文件仅引用 |
| hostNavigation/IME/viewer/export | native返回栈、当前会话/顶层状态、键盘/面板及焦点所有者，选择/导出/看图取消；配置返回不误切会话 |
| opaque originals/export diagnostics | 未识别字段/对象可无损保留和定位，诊断只记阶段/计数/错误，不记录正文、原图字节、凭据或个人路径 |

身份一律在线路上使用字符串并携带命名空间。旧本地数值ID只有在服务内部严格验证安全整数后才转回冻结TL要求的number；禁止将大于2^53的后端messageId、UUID或canonical ID塞进旧Number路径。原始room/message/source/canonical/media分别映射，不能用标题或本机裸房间号冒充跨设备ID。现有storeUpload对本地数字媒体号的Number转换也不能直接复用为服务器UUID适配。

## QQ式手势与设置框的替换要求

保留滑动回复，不以统一禁用swipe应对误触。原生列表须有明确手势仲裁：先观察横/纵意图，纵向交给列表滚动；满足水平阈值且允许回复时只显示预览反馈，松手提交一次reply。ACTION_CANCEL、第二触点、父容器截获、快速反向、滚动/fling、切房、看图/菜单打开均取消本次回复，不留pressed/click。只有真正提交滑动才向子项发取消，不能DOWN已下发后吞MOVE/UP造成后续click误触。阈值用dp/速度与系统touchSlop适配320dp/大字，具体数值由原型手测确定。

长按以一个动作菜单为主；滑动、纵向滚动、长按、点击互斥，同一手势不能先长按又回复/打开图片。系统返回先关顶层菜单/看图/附件/设置，再收键盘/面板或回会话列表；明确保存/取消与实际父页，避免多层弹框覆盖。引用栏和输入工具栏直接在主页面表达状态，常用设置集中分组；不为改外观连开多个不可辨父级的对话框。原生组件须验证可拦截/取消默认手势及状态恢复，不能只换布局皮肤。

## 独立替代门槛与建议顺序

1. **先冻结数据契约与只读双渲染对照。** 使用合成复制库启动独立服务，旧UI不加载；原生列表能读完整历史/草稿/撤回/媒体/未知字段与既有设置。禁止另建消息正文库；原生缓存删除后可全部从唯一服务重建。
2. **原生只读组件实验。** 320dp、用户大字/全局主题、长消息/长GIF、滑动回复预览及取消、长按/看图/父级返回/键盘/工具栏；此时不连接正式私有库、不写消息，不把ChatKit示例数据适配当生产完成。
3. **单写服务闭环。** 独立于旧TG DOM的send/draft/media/reply/withdraw/flush全部走同一writer；正文/原件/回复/临时行换ID、快速连续发送/切房、迟到ACK、新输入、取消/失败均用合成库验；禁止同时运行旧页面writer与新服务writer。
4. **恢复与覆盖升级门槛。** 原ID/typed bytes/未知字段/收藏映射/设置逐对象或hash对照；已有数据库无需升版时不升版，确需变化须独立保留式迁移。强杀后消息/草稿与原件仍一致，旧SW缓存不把新壳换回旧UI；不删IDB/清数据解决升级问题。
5. **最后决定产品切换。** 正常保存/flush、私有备份、明确单writer启用/回退；回退继续读同一权威数据，不能把旧备份覆盖切换后新消息。原库生产切换、设备手势和用户误触改善单独验收后才能替换当前014页面。

若短期无法抽出无DOM服务，可先做独立只读原型验证组件，再单独实施writer抽取；不以长期隐藏完整Telegram界面冒充完成，也不赶在UI更换时顺带迁移015消息/同步权威。当前推荐路线是“原生QQ式交互＋旧库单写服务port”，不是复制QQ客户端或接腾讯云网络/账户。

## 本轮证据与边界

主要只读来源：android/telegram-adapter/build.mjs、android-chat.js/css、android-stickers.js、android-sticker-panel.js、android-sticker-suggestions.js、android-sticker-transport.js；shared shiye-local-assets/input/stickers；TelegramFrontend.java及冻结ui18源码摘出。另核对ANDROID-ARCHIVE-SEAM-08、ANDROID-QQ相关最新用户澄清、014/015交接与现有验收边界。当前vendor源码只作差异参考，不当已安装worker。

本轮只新增本文，没有执行浏览器/原生/设备验证，也未生成迁移代码或业务测试数据。将来实验产物使用`outputs/2026-10-18-android-qq-016/adapter`，临时使用`tmp/android-qq-016/adapter`；本次未另生成这些目录下的产物。手机/AVD014安装状态来自现有交接，没有本轮重新查设备。
