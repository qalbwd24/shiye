# 2026-10-17 Magic7 安装与用户手测

## 最新：用户授权覆盖安装0.6

2026-10-17 用户要求“安装到手机我看看”，已在HONOR PTP-AN00（<测试手机序列号>）将 `dev.shiye.app` 从0.5.0/code7覆盖安装到0.6.0-ui-preview/code8。APK为已在AVD验收的 `Shiye-Android-0.6.0-82926231.apk`，SHA-256 `829262313fc24e4f1d7e4676f38ae5b8a37beab219fa5b8ef29bf06e6bfb52bd`；install -r返回Success，安装后包版本回读一致。没有卸载、清数据、复制模拟器内容或修改旧一本日记。

安装前实际查询拾页进程不存在，手机前台为旧日记设置页，因此没有可附加的内存草稿/保存桥；未为备份强行启动或终止应用。完整私有备份位于 `var/android-backups/2026-10-18T03-04-51-magic7-before-060/app-private.tar`，归档有效；UTC目录日期18日，客户端本地日期17日。按用户此前要求不继续全库数据审核，未重复原文件hash矩阵，不把覆盖安装成功写成全库逐条审计。没有工具自动启动/操作新版内容，用户直接打开手机拾页体验；本次不宣称新版真机中文IME、120Hz或生命周期全验。

安装回执/日志 `outputs/2026-10-17-android-magic7-060/`；临时脚本 `tmp/android-magic7-060/`。本次仅推送已验APK，不改产品源码、AVD或桌面运行版。下方0.5及更早手机状态为历史。

用户明确授权通过已连接 ADB 安装 APK，随后要求由其自己在手机上手动测试，开发代理留在电脑优化。

## 已完成

- 实际设备：HONOR PTP-AN00，Android16 / API36；手机未发现已有 `dev.shiye.app`。
- 已安装并启动 `dev.shiye.app / 0.2.0-frontend` / code2。ADB 安装返回 Success，启动返回 Status: ok；未卸载/清数据/复制模拟器库。
- APK：`outputs/2026-10-17-android-frontend-v2/Shiye-Android-0.2.0-d50771fc.apk`，SHA-256 `d50771fc1a3d6eabe91f51ce25fde74912e77fd0442f6f13a85cca16b509b488`。
- 手机 WebView 为 `com.google.android.webview / 155.0.8059.43`；默认输入法组件为 `com.baidu.input_mi/.ImeService`，只读取名称，未更改系统设置。
- 用户随后明确反馈“我的手机上可以中文输入”。据此确认该版本在用户当前手机/输入法下基本中文输入可用；这是用户手测证据，不混称代理完成了全部中文输入矩阵。

## 后续边界

手机现由用户手测。后续开发仅改电脑源码并使用电脑模拟器，不继续远程操作手机或覆盖其当前测试版本。组合输入候选确认、跨段选区、连续输入、收放键盘、媒体、旋转和长期后台仍须逐项区分，不能由“可以中文输入”推断全数通过。

电脑侧接续优化当前已知的置顶偏好立即强杀落盘与多段草稿跨页保护边界，保持消息单一权威及旧记录。日志在 `outputs/2026-10-17-android-magic7-install/`，临时目录为 `tmp/android-magic7-install/`；手机测试内容不进入日志/报告。

## 2026-10-17 用户授权覆盖安装0.3.0

用户明确要求“推送到我手机看看”，本次授权覆盖此前暂不操作手机的边界，仅升级当前App并交用户手测。实际HONOR PTP-AN00/API36，ADB序列号<测试手机序列号>，旧0.2.0/code2→0.3.0-frontend/code5，APK SHA-256 12bf11ab2634c80185dfd966d6b25b83b5bbac37072163e2d210310735a26fdc。install -r返回Success，am start返回Status: ok；聊天页面ready与bridgeAvailable均已只读确认，没有发送消息或编辑测试内容。首次安装后附加检查立即要求flush被拒绝，随后只读就绪检查通过，不将其写成手机完整草稿/生命周期已验。

安装前曾因旧进程后台DevTools未响应，唤回旧App后确认聊天flush ACK，再停应用取完整私有备份。备份路径：D:\拾页\var\android-backups\2026-10-17T23-05-09-magic7-before-030\app-private.tar，12939776B，SHA-256 8fe48385c64732119d3acf3fab5eb3ce4dd17f753b225868c4078d33ddb608fe；覆盖安装后、首次启动前204个原私有文件全部逐项hash一致。不卸载/清数据，不复制模拟器库。升级后迁移/真机中文输入/长文与媒体具体体验仍由用户手测，不把0.2.0基本中文确认套用为新版全验。

公开回执与安装/启动日志在 outputs/2026-10-17-android-magic7-030/；临时脚本 tmp/android-magic7-030/；私有备份仅 var/android-backups/。此次仅安装已验APK，未改源码、桌面运行或正式日记。

## 2026-10-17 用户授权保留数据升级0.4.0

用户要求“把0.4这版也推送到我手机上……保留现在的数据”。已对HONOR PTP-AN00（<测试手机序列号>）从0.3.0/code5覆盖安装0.4.0-frontend/code6并启动。APK SHA-256 154c8d7a025300d210b1982542dc3da66dff22374f35441d7ef36a32a7aa017b。安装前唤回旧App并得到聊天flush ACK，再停应用做完整私有备份。未卸载/清数据，未导入模拟器库，未发送消息或插入合成日记。

首次安装由手机返回INSTALL_FAILED_ABORTED: User rejected permissions，未继续绕过；用户随后明确回复“已允许，可以重试”，重试install -r返回Success，启动Status: ok。升级后实际日记editor.html的ready与bridgeAvailable均通过只读确认。没有把页面就绪扩大为真机中文IME、壁纸和长文交互全验，具体体验交用户手测。

完整备份 D:\拾页\var\android-backups\2026-10-18T00-17-46-magic7-before-040\app-private.tar，13040640B，SHA-256 5a347506b42a8845503410aaa9e06e2c9562ca0efc09b2b8296b86fcb4a76401。安装后、首次启动前207个原私有文件逐项SHA-256一致，changedOriginalCount=0。首次受拒前备份也保留，未覆盖或清理。文件夹18日为UTC备份日期，本任务客户端本地日期17日。

公开安装/启动/保存与ready回执：outputs/2026-10-17-android-magic7-040/；临时脚本：tmp/android-magic7-040/；私有备份仅var/android-backups/。手机目前0.4.0交用户手测，本次安装不改变桌面运行或正式日记，不宣称云同步已接入。


## 手机0.5部署及用户反馈

2026-10-17 用户已授权部署并实际测试Android0.5.0/code7（APKc60bac46…），安装Success且聊天ready；随后明确效果仍不满意、调整成本高，要求停止继续数据审核。当前优先讨论真实页面即时样式预览/逐页对照，工具尚未实施，见ANDROID-DEBUG-WORKFLOW。安装前完整备份保留；安装期间App自行启动，33个缓存/存储日志等文件变化，不宣称全文件一致；6个native数据/偏好文件及2个原IDB Blob载荷hash一致（其中1个重命名），未作全部LevelDB key语义比较。用户停止要求后不追加核查。

公开回执 outputs/2026-10-17-android-magic7-050；临时 tmp/android-magic7-050；私有备份 var/android-backups/2026-10-18T02-07-43-magic7-before-050。未卸载/清库或导入AVD数据。


## 2026-10-18 最新手机0.10已安装并交用户手测

2026-10-18 用户要求保留现有数据安装Android0.10：Magic7已从0.6/code8覆盖升级0.10.0-content-contract/code12（APKc54bf181…），install -r Success、版本回读一致、ADB启动Status: ok，聊天页ready/bridgeAvailable只读通过。安装前完整私有备份保留；旧0.6出现双WebView/保存桥无响应，已确认两页无日记编辑器/会话输入框/待发送消息，再停止应用备份，不冒称完整flush ACK。未卸载/清数据/导入AVD内容，未发送消息或编辑用户日记；用户接着真机手测，不继续工具控制。下方手机仍0.6为此前快照。

设备HONOR PTP-AN00（<测试手机序列号>）；APK SHA-256 c54bf18101c747b7d934e9b5ddfe5a5083c9432da74a5f6ea3916b8bf4e1d50a。安装前旧版因双WebView中新的transport未就绪，完整保存桥检查失败；隐藏旧页事务确认也超时。只读状态确认两页都是会话列表，无当前会话、composer或pending发送，没有日记编辑页；没有用模拟rAF伪造保存回执。随后停止应用取稳定完整备份再覆盖安装。不宣称读完个人数据或全库逐条审核。

完整私有备份：D:\拾页\var\android-backups\2026-10-18T04-38-57-magic7-before-0100\app-private.tar，14054912 bytes，SHA-256 6ad777ba1c0b6f5b7ec3c4ac17b2d0b50067dadea33744e4c302ad93c709cd99。备份归档有效，未清理旧备份。新版启动会执行已在合成v1/v2库与AVD验证的schema3增列迁移；手机本轮只读确认ready，不再追加个人库审计/试写，不把ready当真机IME/120Hz/长文体验全验。

公开回执/安装/启动与ready日志：outputs/2026-10-18-android-magic7-0100；临时脚本tmp/android-magic7-0100；私有备份仅var/android-backups。未改源码、AVD或桌面运行版。


## 2026-10-18 手机0.11覆盖安装

2026-10-18 用户授权先部署UI后继续后端适配：Magic7已0.10/code12→0.11.0-compact-ui/code13保留数据覆盖安装（APK1914ba64…），install -r Success、版本回读/启动Status:ok及聊天ready只读通过。第一次由手机系统拒绝安装，用户“重试”后成功；安装前App无进程，稳定完整私有备份保留，无需中断编辑/伪造flush。未卸载/清数据/导入AVD资料，手机交用户手测，不继续远程控制。后端适配另在电脑/AVD候选进行，不随之覆盖手机。

完整备份：D:\拾页\var\android-backups\2026-10-18T05-42-09-magic7-before-0110\app-private.tar；22981120 bytes，SHA-256 3ad455ca1e6619f134cc650ca7877d51c8117182d53f6ecbe7ada8f148d17ae4。APK SHA-256 1914ba64bc4a53d80f26ee275caf9118f6acbf7a9f71dba06275e63209259544。初次ready脚本误附加service worker导致window不存在而报拒绝；随后只读实际telegram/index.html确认chatReady=true，未对个人内容试写。没有将ready当IME/长文/120Hz全验。安装与运行回执outputs/2026-10-18-android-magic7-0110；临时tmp/android-magic7-0110。
