# Android shared runtime v1 候选

## 原思绪入口 shared adapter 接续（2026-10-19，只读清点/待实现）

G9观察结束后已补[31例JDK参考golden与回执](../outputs/2026-10-19-android-shared-import-ui/diary-adapter-audit/reference-fixtures/execution-notes.md)：原filter/calendar/dayKey/streak/neighbor与完整title方法逐字运行，8段范围含at工具，12条关键断言通过。原not-executed保留为verification-static-before-run.json；首次隔离缺at编译失败亦如实登记。真实SQLite/catalog投影、月历视觉、设备/应用均未执行；它是供backend移植对照的算法参考，不是新query port或完整UI验收。

原Java查询兼容参考已静态提取至[reference fixtures](../outputs/2026-10-19-android-shared-import-ui/diary-adapter-audit/reference-fixtures/README.md)：7段原源码逐字范围/hash＋31组合成输入，G9观察窗口内未编译/执行，不能称golden通过。必须保留的实际语义为列表pin降序/createdAt字符串降序/id升序、全文searchText含词AND、日期按设备systemDefault、日历去除所有日期token、全catalog连续天数、“上一篇”为全catalog最大createdAt及bootstrap tie、自动标题YYMMDD＋分类＋从0起篇序。新header需pinned/createdAt/categoryId/search索引及summary→preview/format→contentFormat显式映射；旧native不存在listPage/search/stat RPC或回收站列表接口，不能虚称复用。空meta草稿不入普通entries；Product bootstrap未显式排draftOnly的边界已如实记录。公共data port仍待backend新冻结。

Sol已核实际调用链：`DiaryListPage.refresh → LocalStore.bootstrap`仍读legacy SQLite/Product投影；`editor.js productEntryGet/Save → MainActivity.handleWeb → LocalStore/ProductDiaryStore`仍为Java事务；`/media`与native查看器仍经`MainActivity.originalFile`旧store/Product。signedoffline61/candidate-v3.1导入IDB成功不代表原思绪入口已可见可写。精确文件行号、最小白名单及backend问题见[只读清点](../outputs/2026-10-19-android-shared-import-ui/diary-adapter-audit/call-chain-and-adapter.md)。本轮未实现、构建或操作设备，不改QA8 owned MainActivity/editor/host/stage。

接续保留native列表/原editor/ScrollCapture，以显式shared模式的窄adapter切数据：列表只接受公共IDB有界摘要页；editor同origin直接读写同shared IDB，不经native搬全正文/history，不把shared Entry复制进Java Product。冷启思绪不能依赖先开随想或网络info/start。公共storage transaction/CAS及原lease继续保护多WebView，不能另立业务owner。现Product preparedRecord/canonical验证与服务revision递增ACK不能伪装shared；shared保存需真实Entry能力验证、localRevision/localAck和远端确认分开。HTML/Markdown/独立附件的本机完整阅读编辑能力须补实证，不能只因richdoc可用宣称全部可编辑。

backend待定数据口为：同事务摘要索引的listPage（默认40/最大100、页≤256KiB，cursor绑定库/查询/index revision）、服务端无关本机搜索/总数/日期统计/neighbor/建议标题、按需read正文、结构化Entry草稿/本机阅读sidecar、原件持久native sink和新增图离线引用事务。字段/上限是需求提案，须data owner定稿冻结；不得先用全量diary.list取3157篇body/history再slice。data61仅已导入项`save(...,{sync:false})`可本地保存；create-local/baseOperationId及默认localAck新能力以新freeze/独审为准，不借工作树代码或自造wire放行。

激活继续沿已实现导入信任/事务/status/trust/config回读流程，配置失败保原选择并仅重试选择。返回legacy测试资料是显式模式选择，保两边数据/草稿/outbox/原件；切换先完成当前库本机保存，再持久选择、撤销旧页代际/缓存/恢复位置。不自动降级或按同ID混查旧库。独立Sol高须分别验真正原入口、无服务冷开/新建连改/待同步恢复、分页字节界、媒体及格式完整性；本清点不算功能通过。

2026-10-19最新架构约束覆盖下方早期“先选在线服务器/同步后才使用”的前提：Android与PC都必须是完整本地优先客户端。显式库身份也可来自**已完整校验且验签的资料包**，经用户确认同库/公钥指纹后激活，不要求首次配对或在线info成功。服务地址/登录凭据仍在原生独立保存，不构成资料身份。启动读取本地库、阅读/编辑/原件、草稿与outbox恢复不得依赖网络；服务鉴权失败/身份或key不匹配只阻断网络同步，不阻断既有本地资料。具体新签名流程由[种子契约](SHARED-SEED-V1.md)与原生导入口接续，尚未完成独立验收或正式启用。

本地提交ACK与远端ACK分开：同事务持久业务修改/原件引用/outbox后即可表示“已在本机保存、待同步”；后台上传失败不能误报本地保存失败、回滚本地正文或重造operationId。当前部分diary/directory写入默认仍await sync、create及部分设置的离线投影待补，不能据底层enqueue已持久就声称所有页面离线完整可用。必须专项验证断网保存后销毁重建runtime仍能读到同一修改/原件与同operationId待同步；联网先收最新墓碑/投影再上传，丢ACK幂等。UI023与导入dataQA保持独立，不向手机安装。

最新已验纯data候选：`outputs/2026-10-19-shared-business-integration/data-candidate-1792437266516`，16fixed native方法（较旧13新增feed-item-read/seed-resolve/register）、runtime.wallpaper与uploadJobs，source实现public/shared/shared-chat-source.js/旧Android路径alias。媒体sendFiles(files,replyId,{text,operationId?,messageId?,sentAt?})先同ID本机持久占位；retryUpload/cancelUpload、getSnapshot.uploads及message.uploadState/uploadProgress/mediaItems供UI接线，ACK不锁后发文字。dispose await释放多窗口租约后close。见[媒体契约](SHARED-UPLOAD-JOBS-V1.md)、[壁纸](SHARED-CONVERSATION-WALLPAPER-V1.md)及[独立审批](validation/2026-10-19-shared-business-independent-review.md)。这是data bundle/host与隔离测试通过，页面/真机/OS后台服务/正式启用未验；新机器人专用服务身份不含其中。

2026-10-19壁纸新增需求按[共同图片/本机显示分层提案](SHARED-CONVERSATION-WALLPAPER-V1.md)接续。旧wallpaper过滤仅继续保护本机独立图/裁切位置/缩放/遮罩；共同asset绑定及每房同步开关应进入单独CAS业务域，尚待双方与独立审批，不将旧过滤器当已实现新功能。

2026-10-19。本文件只记录独立候选源码与隔离验证，不表示 UI022、手机 APK 或正式服务已启用。默认仍是 legacy。未修改 MainActivity、LocalStore、TelegramFrontend、聊天 renderer/style 或原 UI022 stage，未控制手机/5554、未安装 APK。

## 激活与身份

`android/qq-chat/shared-runtime.js` 导出 `saveSharedRuntimeConfig`、`readSharedRuntimeConfig`、`loadConfiguredRuntime`。用户明确选择服务器与资料库后，保存 `{enabled:true,libraryId,epoch}` 到本机 `localStorage['shiye-shared-runtime-v1']`，版本为 1；必须提供完整 UUID 身份，不能由首次发现、配对或重试自动替换。随后重开页面。该配置是本机激活身份，不上传为跨端偏好。显式保存 `{enabled:false}` 并重开可回到原 legacy，保留原历史、共享 inbox/outbox 和草稿；不提供自动降级或清空。

原生服务地址仍由现有服务连接设置保存；配对凭据只在原生私有存储。`sharedInfo` 可以帮助用户核对选中的身份，但不会替调用方决定启用哪个库。

`android-chat.js` 的 `installRequiredQQ` 在显式启用时真实调用 `loadConfiguredRuntime`，向 `installIndependentQQChat` 注入 `source`。`install.js` 只增加 `callbacks.source` 注入，其余默认 legacy 路径保持。共享 canonical ID 为原完整字符串；`currentId/openRoom/closeConversation` 与目录 command/pin/order/archive 分支不建立 TL 房，也不改原 worker 的 IDB。共享启用时先隐藏旧 vendor 列表，再安装 `shared-directory-view.js`；错误不展示旧列表冒充共享成功。

## 数据口

显式启用后 `window.shiyeSharedData` 暴露：

- `directory`：完整列表/单房、创建、资料 update、pin/archive setState、完整 order、各 slot 程序 settings/saveSettings。
- `diary`：完整 Entry read/list/create/save、删除/恢复、模板、分类、评论及服务器偏好。原未知字段与本地 revision 仍由公共 client 保留和核验。
- `source`：QQ renderer 的聊天数据口、草稿、发送、撤回、朝花历史/固定评论。
- `client`：持久 outbox/inbox、冲突与 operation/status。`client.onChange` 只触发 `source.refreshLocal`，不会再次调用网络 refresh。
- `auth.pair/status/forgetDevice/unlock`：固定原生口；不返回 token。forget 仅本机清除，不冒称服务器撤销。
- `uploadFiles/readMedia/media`：固定分块原件接口。默认下载 sink 只允许单原件不超过 64 MiB，并核验分段和完整 SHA；超限报 `SHARED_NATIVE_MEDIA_SINK_REQUIRED`，可由调用方提供私有持久 `sinkFactory`，没有伪造大文件支持。
- `stickers.catalog/fromMessage/collect/update`：复用服务器旧收藏业务；注入 source 的收藏菜单直接调用 `source.saveSticker`，不再发旧 TL 收藏事件。多图必须明确指定 `mediaId`，菜单未提供选择时明确提示，不能静默取第一图。既有表情包面板布局与本机素材管理页本轮未重做，不称所有收藏管理 UI 已统一。
- `openRoom/closeRoom`：canonical 会话入口；`directoryCommand` 兼容现有 list/create/update/flush 的窄调用。新建表单在同一表单重试时复用 operationId；分类默认取已收到的真实分类，未收到则明确阻止创建。

## 实际本机偏好采集

显式共享 runtime 的 `start()` 在初次同步后实际采集一次，再以独立 JS `setTimeout` 每 30 秒采集；不在 `client.onChange` 或每页接收后触发。`dispose()` 清除此计时器，停止后的 capture client 不再派发新 sync/enqueue。未增加原生后台循环、网络 service 或可见 UI。

- `android:diary` 仅通过 `localStorage.getItem` 读取 `shiye.android.diary.presentation.v2`、`shiye.android.diary.entry-image-width.v1`、`shiye.android.diary.image-width-modes.v1`。按 JSON 解析，保留原 namespace 名、object/array 类型与普通未知字段；不枚举其他 localStorage。
- `android:thoughts` 通过现有只读 `window.shiyeAndroidPreferences.load()` 读取 SQLite `meta['android-chat-ui-preferences-v1']` 原对象；bootstrap 使用 `connectNativePreferences` 等待既有桥。真实代码位置为 TelegramFrontend 的 preferences-load、LocalStore 的 getAndroidChatPreferences，不存在另一个 AndroidUiPreferences.java。editor.html 与 Telegram 使用同一 `MainActivity.ORIGIN`，因此上述日记 namespace 可从同源 runtime 读取。
- 公共 `shared-preference-capture` 负责 portable 过滤与 profile CAS：保留 appearance、roomAppearance、listRowOpacity 和普通未知 JSON；排除根 pin/order（目录已有写 owner）、本机背景资源、activation/libraryId/epoch、token 等凭据。原生读到 null 或 JSON 损坏时明确报告，不能作为空对象删除远端。
- `window.shiyeSharedData.preferences.capture()/status()` 暴露采集报告。采集不调用原生 commit、不写本机 localStorage、不自动应用远端；远端有并发修改时保留本机原值并报告冲突。原子 cache checkpoint 与 immutable command 由公共 client 同事务保存，不变设置不重复提交。

`tests/android-shared-preferences.test.mjs` 使用真实三组已知 localStorage 数据、模拟现有 native load port、真实同 JSON HTTP server 与 IndexedDB adapter，验证两个 profile 原类型/未知字段、隐私与目录字段排除、启动及定时采集、不变值零重复写、onChange 不递归采集、远端/本机冲突各自保留及 dispose 清 timer。合并 runtime 旧七场景共八项通过；这是合成数据，不代表已读取手机真实偏好或完成设备验收。

独立目录 view 仅显示标题、pin/归档状态、打开、新建和原设置入口。现有资料表单未扩展成完整程序/分类/角色参数编辑器；这些能力通过上述数据口交前端接入，不声称所有设置页面已完成。未新增或改动既有聊天 renderer/style 文件。

## 打包与验证

在新的隔离基础 stage 上运行 `node android/qq-chat/build-shared-runtime.mjs <absolute-tmp-stage>`。此脚本是 overlay，基础 QQ/worker/assets 需先由既有构建准备；脚本打包公共 shared client/source 依赖，并复制 runtime、独立目录 view、两个窄入口文件。不得只复制源码后保留 `../../public/...` APK 相对 import。脚本拒绝原 `tmp/android-ui-continuation/stage`，不构建或安装 APK。

固定 nativeRequest 现为 13 口，新增 `entity-read → sharedEntityRead → POST /api/shared/v1/entity/read`，按同一 Bearer/配置代际读取不超过 256 KiB 的完整 entity JSON 分段。公共 business client 负责 descriptor 身份/SHA 校验后 hydrate；runtime 不裁剪未知字段。runtime 在 client 之前构造 media，并提供 `preparePayload(job)`：用原 operationId 分块上传本机 Blob，再核验 asset SHA/大小，不改 pending wire。由根维护的 diary client 将大正文离线排为 localPayload Blob 与 `entry-create-ref/entry-save-ref` 小 wire，重开后再上传；身份仍为固定 libraryId/epoch。client 的阻塞/恢复/冲突操作通过 `window.shiyeSharedData.client` 暴露，不能把一次确定拒绝自动换 operationId 重发。

`tests/android-shared-runtime.test.mjs` 七项定向覆盖显式激活/默认零调用、13 固定 nativeRequest 映射、401 分类、64 MiB 边界、目录 DOM/canonical 入口与 vendor 保留、隔离依赖 bundle，以及真实 HTTP + fake IndexedDB 的创建重试/改 intent 拒绝、消息/原件收发、共享 pin、多图明确选择收藏、草稿重开、错误资料库拒绝、local refresh 不递归发网络。新增大正文场景使用 UTF8 超过 8 MiB 的导入 Entry，离线 save/create 不预上传，重开后保留 localPayload 并提交 ref、分块 hydrate；旧 PC read 保留导入未知字段、正文和旧 history 正文。shim 按原生 4 MiB request/8 MiB response 强制检查，本场景实际请求/响应均小于 1 MiB。它不是 Android WebView、设备或 64 MiB 边界吞吐验收；并发恢复/阻塞门槛由对应公共 client/server 验证另记。既有 29 原生断言、49 宿主 Java 原件/鉴权证据保持独立。
