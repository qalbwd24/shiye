# Android QQ 体验 016：ChatKit / Tencent UIKit 只读审计

2026-10-18。用户希望原生 QQ 式滑动回复、长按菜单、背景及输入工具栏，消息与设置减少误触；业务仍为拾页。本轮只读上游与本地构建配置，不改依赖、业务源码、数据库或设备。根代理拟独立 `qq-preview` 应用进行 UI 试验，不能据此宣布生产聊天已迁移或全部功能已支持。

## 结论

ChatKit 的 `MessagesList` / `MessageInput` 是与通讯服务无关的原生 UI 组件，适合小范围验证原生触控、排版、壁纸与输入体验。它不是 QQ 源码，不自带 QQ 手势/菜单，也不提供拾页持久化与同步。Tencent UIKit 虽有更多 IM 交互，但当前源码直接依赖腾讯 IM 数据模型、登录状态和 SDK，不能只换布局就成为独立拾页 UI。此结论不构成选择/安装依赖或大规模迁移授权。

## 一手源码基线与维护状态

| 项目 | 本轮读取的固定提交 | 读取状态 |
| --- | --- | --- |
| stfalcon-studio/ChatKit master | `d10cfe3393a9d6ce150e817b22b019dcd17c55fa`，2021-03-29T07:56:55Z | GitHub API 当前主分支；源码 versionName/publication 0.4.1；Apache-2.0；仓库未标 archived。不能据未 archived 推断仍积极维护或 Android16 已验 |
| TencentCloud/chat-uikit-android main | `147b61c6ac17e7d5df6e42e83cf86b5bd625c520`，2026-06-15T06:59:51Z | GitHub API 当前主分支；仓库 LICENSE 为 Apache-2.0；未标 archived。SDK 二进制/第三方另有自身条款，不以仓库许可证替代 |

[ChatKit 固定源码](https://github.com/stfalcon-studio/ChatKit/tree/d10cfe3393a9d6ce150e817b22b019dcd17c55fa)、[LICENSE](https://github.com/stfalcon-studio/ChatKit/blob/d10cfe3393a9d6ce150e817b22b019dcd17c55fa/LICENSE)、[Tencent UIKit 固定源码](https://github.com/TencentCloud/chat-uikit-android/tree/147b61c6ac17e7d5df6e42e83cf86b5bd625c520)。以上是主分支内容快照，不声称下载了发布 AAR 或验证了 JitPack 供应链。若后续 vendoring，保留上游 LICENSE/版权、修改标记和适用 NOTICE，登记实际使用的第三方依赖。

已下载少量一手 Java/XML/Gradle/许可证到 `tmp/android-qq-016/framework/ChatKit/` 与 `.../chat-uikit-android/`，不是完整可编译克隆。两项目完整 Git tree 索引与 commit metadata 位于同级 `*-tree.json` / `*-metadata.json`。未复制 QQ APK 源码或操作 MT；不声称取得 QQ 服务端/私有算法。

## ChatKit 可复用与缺口

| 需求 | 已有源码事实 | 拾页需补 |
| --- | --- | --- |
| 原生消息列表 | `MessagesList extends RecyclerView`，专用 `MessagesListAdapter<IMessage>`；支持历史分页、日期头、incoming/outgoing、图片与自定义 holders；默认 reverseLayout=true；变更动画关闭但插入动画仍有 | 真实会话/消息映射、滚动锚点、读取更多、搜索定位、系统/朝花夕拾来源与不可编辑范围、引用回复/撤回/失败重试均为业务接入；不能将默认示例当成现有功能保留 |
| 模型独立性 | `IMessage`: String id/text、IUser、Date；不要求 SDK 消息类；图像通过可替换 `ImageLoader` | 用只读投影适配拾页完整记录，不能把 canonical 富文档压成 getText 后写回；保留未知字段、来源身份与正文原件 |
| 稳定 ID | adapter 的 `update(id,new)`/`update(oldId,new)` 用 String 业务 ID 查找/notifyItemChanged；未实现 RecyclerView `getItemId` 或 `setHasStableIds`；items 为 protected wrappers | 如需要稳定 Recycler 身份，可子类提供无碰撞 long 映射，覆盖日期头/所有 holder 类型；本地行稳定 ID 与归档/服务端 ID 分离，ACK 不换根行、不改时间排序。不能把 String getId 等同 stable Recycler ID，也不能用有碰撞的 hashCode 冒充 |
| 输入/IME | 真 EditText，多行 inputType，公开 `getInputEditText()`/`getButton()`；TextWatcher + typing timer；上游未见 IME action/物理 Enter/组合态发送处理 | 原生 composing spans、选择/粘贴/撤销、Enter 用户偏好与 Ctrl/Shift 行为、中文组词期间不触发发送/候选；不新加默认全局快捷键。键盘/附件面板切换与焦点恢复由宿主负责 |
| 异步 ACK 清稿 | `onSubmit(CharSequence)` 同步 boolean，true 后立刻 `messageInput.setText("")`；没有异步完成回调。CharSequence 可能是可变 Editable | handler 返回 false，先复制 String、reply/附件/输入 revision/房间快照；本地事务持久 ACK 后仅在同房且草稿 revision 仍相同才清；网络同步 ACK 另标状态。忙态锁需独立于 TextWatcher（它会按 length 重新 enable 按钮）。失败保留输入/引用/原件并可重试，禁止迟到 ACK 清除后续输入 |
| 附件/工具栏 | 附件按钮只触发 callback；输入布局只有附件、EditText、发送按钮 | QQ 式工具栏、表情图库/联想、媒体选择/文件访问、录音（若产品授权）、小飞机统一态、引用栏、待发队列均自建 UI 接缝；继续调用既有原件/收藏服务，不复制业务管线 |
| 多媒体 | 默认 image 类型和异步 ImageLoader；`registerContentType` + 自定义 incoming/outgoing holders；默认不负责网络/本地资源加载 | PNG/GIF 原件、动图播放生命周期、表情按已知收藏的10字号限制/比例、不放大、相册/视频/文件/富文本分段需自定义；预览与原件分开，decode异步/取消/缓存/回收，不能让 Recycler 复用串图。需自建点击看原图/附件菜单和可访问名称 |
| 原生长按 | `setOnMessageLongClickListener` / `setOnMessageViewLongClickListener` 已有；底层返回 true 消费长按 | 定位到稳定消息身份的菜单/震动、轻点/长按/滚动冲突、link 子View命中范围、安全操作入口。启用 selectionListener 后长按切换选择，不再调用普通 longclick；selection mode 为 protected static boolean，多实例需隔离或不启用该模式 |
| 滑动回复 | 审计的消息 list/adapter/holders 未见 swipe reply/ItemTouchHelper 实现 | 原生 touch slop、横纵方向锁、RTL/左右气泡方向、触发阈值/一次震动、手指取消回弹；回复不 dismiss/删除行。可以专用手势或 ItemTouchHelper 自定义绘制和复位，不能直接套默认滑动删除；长按/选字/图片拖动/系统返回边缘手势要互斥 |
| 字号/气泡/时间 | attrs + styles 提供 incoming/outgoing 正文/时间/日期/气泡/头像尺寸；dimension转px，holder用 COMPLEX_UNIT_PX；outgoing文字布局为 Flexbox wrap，时间和文字分别子View | 当前13/8视觉参数要明确 dp/sp 与系统 fontScale策略，不能再双重放大；引用/长文/纯emoji/小字号/换行临界/高字体需实测。动态全局修改需重新bind/custom holder，不是更改一个XML attr就更新现有实例 |
| 壁纸/全局主题 | View 背景与气泡 drawables/selectors 可自定义；无现成拾页 scope/settings | 宿主复用原壁纸私有原件、cover/contain/tile/位置/opacity及全局透明色调；列表本身透明，文字保持不透明，沿现有 scope 保存；异步缓存解码，切换不写回原件 |

直接源码：[MessageInput.java](https://github.com/stfalcon-studio/ChatKit/blob/d10cfe3393a9d6ce150e817b22b019dcd17c55fa/chatkit/src/main/java/com/stfalcon/chatkit/messages/MessageInput.java)、[MessagesList.java](https://github.com/stfalcon-studio/ChatKit/blob/d10cfe3393a9d6ce150e817b22b019dcd17c55fa/chatkit/src/main/java/com/stfalcon/chatkit/messages/MessagesList.java)、[MessagesListAdapter.java](https://github.com/stfalcon-studio/ChatKit/blob/d10cfe3393a9d6ce150e817b22b019dcd17c55fa/chatkit/src/main/java/com/stfalcon/chatkit/messages/MessagesListAdapter.java)、[MessageHolders.java](https://github.com/stfalcon-studio/ChatKit/blob/d10cfe3393a9d6ce150e817b22b019dcd17c55fa/chatkit/src/main/java/com/stfalcon/chatkit/messages/MessageHolders.java)。

构造陷阱：`MessagesList(context)` 不执行 parseStyle，holder 明确 style!=null 才 applyStyle，所以并非必然崩溃，而是默认气泡/字体可能未初始化；`MessageInput(context)` 也仅 inflate，属性构造才做 style init。独立试验应使用 XML 或 `(context,null)` 路径并实际检查默认样式。holder通过反射找 `(View,Object)` 或 `(View)` 构造，R8 keep规则亦需跟随固定源码保留。

## Android16 适配边界

上游 ChatKit [构建](https://github.com/stfalcon-studio/ChatKit/blob/d10cfe3393a9d6ce150e817b22b019dcd17c55fa/chatkit/build.gradle) 是 compileSdk29/buildTools29.0.2、min14、Java8、AppCompat1.2.0/Material1.2.1/RecyclerView1.1.0/Flexbox1.0.0，根 AGP4.1.2、Gradle6.5，仓库仍引用 jcenter。已是 AndroidX，不能写成需要从 support library 全量迁移；也不能直接复用旧 Gradle 工程当现代构建已通过。本地当前拾页 compile36/target35/min26、Gradle8.13，尚无本轮 ChatKit 编译证据。

应在独立 preview 中用现代宿主核查 namespace、资源 attrs/ID、依赖解析与反射 keep；锁定实际源码/依赖并保留license。MessageInput 自定义光标用反射私有 TextView/Editor 字段，异常被吞，会静默退回默认光标；现代平台应走公开API，不能把无异常当视觉成功。

Android 官方区分“在 Android16 上运行”与“target36 才触发”的行为：target36 在 Android16 上不可退出 edge-to-edge，且旧 onBackPressed/KEYCODE_BACK 不再收到系统返回，需支持预测返回；sw600dp及以上的自适应/旋转限制也有变化。列表/输入库不接管这些宿主责任。[Android16 target行为](https://developer.android.com/about/versions/16/behavior-changes-16)。本轮当前 target35不能被描述成已触发所有target36行为。

IME 应由宿主通过 WindowInsets/IME 可见区与动画协调输入栏，避免同时 resize 和手动位移造成双补偿；横竖屏/分屏重建保存草稿和锚点。[Android键盘官方指导](https://developer.android.com/develop/ui/views/layout/sw-keyboard)。这里是后续验证要求，无设备/运行证据。

## 与 Tencent UIKit 的实际耦合对比

| 比较 | ChatKit 固定源码 | Tencent UIKit 固定源码 |
| --- | --- | --- |
| 业务模型 | 应用实现 IMessage/IUser，ImageLoader由宿主提供 | ChatPresenter使用 TUIMessageBean、V2TIMMessage、V2TIMManager/V2TIMSendCallback，provider/send/撤回/引用与SDK模型相连 |
| 依赖链 | AppCompat/Material/Recycler/Flexbox，无腾讯通讯依赖 | tuichat `api project(':timcommon')` → timcommon tuicore → tuicore api `imsdk-plus`，默认9.0.7652；源码工程可选本地imsdk-plus项目，仍是SDK依赖 |
| 只做拾页UI | 可以只适配显示投影与用户动作 | 需要拆掉/替换数据provider、Presenter、登录与事件体系；并非排除一个 Maven artifact 就能编译运行 |
| QQ体验 | 原生组件能力可作为素材，手势/工具栏仍自建 | 可参考其公开交互代码，但 Tencent Cloud UIKit不等同消费版QQ实现，也无证据能复制QQ私有行为 |

[tuichat依赖](https://github.com/TencentCloud/chat-uikit-android/blob/147b61c6ac17e7d5df6e42e83cf86b5bd625c520/TUIKit/TUIChat/tuichat/build.gradle)、[tuicore SDK依赖](https://github.com/TencentCloud/chat-uikit-android/blob/147b61c6ac17e7d5df6e42e83cf86b5bd625c520/TUIKit/TUICore/tuicore/build.gradle)、[Presenter](https://github.com/TencentCloud/chat-uikit-android/blob/147b61c6ac17e7d5df6e42e83cf86b5bd625c520/TUIKit/TUIChat/tuichat/src/main/java/com/tencent/qcloud/tuikit/tuichat/presenter/ChatPresenter.java)。Tencent源码模块compile31/target30也不足以证明Android16交互已适配。

## 独立试验可验收范围

建议先合成数据独立applicationId，仅让用户比较原生触感：消息轻点不打开设置、长按菜单、纵向滚动与横向回复互斥、取消不误触、背景透出、紧凑时间与小飞机工具栏；同时覆盖中文IME/组词、字体1.0/1.3、320dp、键盘/面板/返回/旋转。保存与同步的接入另列：ACK前后连续输入、失败重试、切房后迟到ACK、稳定ID不重排、媒体原件与已知表情尺寸、长文分段及朝花夕拾source身份。纯UI样机不应写正式内容或登录腾讯服务，不表示已替换当前TL/WebView业务。

本轮只进行了源码核查和官方资料核对；未编译ChatKit、未做Android16/QQ运行比较、未操作MCP/MT/设备、未修改依赖。文档为唯一项目正式改动。源码与索引临时目录 `tmp/android-qq-016/framework`；预留产物目录 `outputs/2026-10-18-android-qq-016/framework`，本轮无设备截图或构建产物。
