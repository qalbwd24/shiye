# 拾页 Android 双入口样机

2026-10-19 Android0.20/code22已保留数据运行主AVD，APK `outputs/2026-10-19-android-feedback020/Shiye-Android-0.20.0-767af0b8.apk`；手机仍019未操作。QQ返回旧UI露出/搜索/IME、日记保存与图文派生/多图顺序/续写/小图、空篇/上一篇已按实际路径核验。默认QQ仍legacy owner，完整同步/迁移不随UI版本冒称完成；用户取消跨会话消息。 [本轮验收](../docs/validation/2026-10-19-android-feedback020.md)；私有备份var/android-backups，临时tmp/android-feedback020。

2026-10-19 Android019已依用户要求保留数据覆盖安装并ADB启动Magic7（0.19.0-ui-product/code21，d9a256d0…）。安装前现有QQ草稿flush成功、完整私有备份64,824,832 bytes；首次启动前30持久文件SHA逐个保持。手机实际QQ/偏好/019资产ready、首房6节点无错，header/list/footer均320px、气泡不越屏且旧Tele窗口隐藏，未发送测试消息或启用完整同步。模拟器及手机现均019，下方“手机仍018”为此前阶段。用户已说明实时预览为开发控制面板，效果看App，网页仅手动截图，尚无实时投屏。 [安装/证据](../docs/validation/2026-10-19-android-magic7-019-install.md)；产物outputs/2026-10-19-android-integration-019/phone-install，临时tmp/android-integration-019/phone-*，私有备份var/android-backups。


2026-10-19 Android019最终正常包已保留数据覆盖运行主AVD（0.19.0-ui-product/code21，APK d9a256d0…）；手机只读回读仍0.18/code20。修复真实Magic7聊天grid 320→455撑宽、发送夺焦点、旧SW/QQ启动门禁与native早绑定；列表全宽/设置固定真实父级、18px加粗标题/32px工具栏/全宽冻结线/上一篇/空篇丢弃已整合。按最新反馈取消逐条置顶加深，模拟器四主页面复用手机写作页原壁纸，原图不打入APK，保留原偏好备份。长文实际桌面prepare/canonical与同SQLite产品保存、原生消息源接缝已验；默认聊天仍legacy owner，完整保留迁移/seed/持续同步/朝花夕拾真实收件仍待接，不能称全端已互通。最终正常旧三房与列表几何、实际编辑比例/IME连发、14 SQLite/5native消息/19调度等定向按路径验收或复用；QA与正常11,768 assets/DEX一致，不跑无关全量。AVD软件兼容swangle临时60Hz，不承诺真机120FPS。产物outputs/2026-10-19-android-integration-019，临时tmp/android-integration-019，私有备份var/android-backups。 [验收](../docs/validation/2026-10-19-android-integration-019.md)。复建先 `node android/tools/stage-integration019.mjs`，激活 `D:/codex-tools/android-state/activate.ps1`，使用独立 `./android/gradlew.bat -p android/integration019 --offline --no-daemon --max-workers=1 assembleDebug`；低提交余量时显式JVM堆512MiB。QA加 `-PqaApplicationId=dev.shiye.integrationqa`，不要用默认android旧017工程覆盖。本轮实时预览支持editor019 overlay及QQ shadow view.css，固定127.0.0.1:19384，源码/包/运行层次分别核对。


2026-10-18 Android018独立QQ候选已在专属QA运行0.18/code20：Astra中视觉/富文本CSS、桌面实际Markdown/richdoc安全reader、ACK锚点/测高/阅读位置和短动效接入；32项内容浏览器、6项实际Android内容与6项设置返回/触摸防误调通过，既有真实worker/原件/冷启证据按路径复用。正常APK03a63c09…与QA assets/DEX一致，但正常手机/主AVD未更新、手机未连接；017 Repository/生产写权威、种子导入/完整同步仍待接。见[需求执行单](../docs/ANDROID-018-REQUIREMENTS-AND-DELIVERY-PLAN.md)、[验收](../docs/validation/2026-10-18-android-qq-rebuild-018.md)。产物outputs/2026-10-18-android-qq-018，临时tmp/android-qq-018。


2026-10-18 后端017/code19候选已完成隔离QA并构建正常包（bd1e6a86…），未部署；手机/主AVD保持016/code18。固定product/sync/原件与同SQLite Repository接缝已验，旧UI写口/权威和完整同步未切换；ANDROID-UI-017-REQUIREMENTS未实施。复建先 `node android/tools/stage-product-preview.mjs` 冻结016基线与共享源码，再激活本机Android环境，用默认android工程 `./android/gradlew.bat -p android --offline --max-workers=1 assembleDebug`；stage会验证基线APK及源码hash，源码变化须重新冻结/验证。独立QA为android/product-preview，Repository验证为android/repository-tests；不得将默认候选构建直接覆盖用户正常包。详见[候选验收](../docs/validation/2026-10-18-android-product-017.md)；源码白名单包/哈希清单位于outputs/2026-10-18-android-product-017，不含DB/凭据/密钥/编译资产。下方016/015为对应历史阶段。

2026-10-18 QQ皮肤0.16/code18已保留数据运行主AVD与Magic7（35/40持久文件hash保持）；参数和数据通路继续，015后端源码未混入。详见[验收](../docs/validation/2026-10-18-android-qq-skin-016.md)。本轮固定基线构建：先 `python android/tools/stage-qq-skin.py`，激活 `D:/codex-tools/android-state/activate.ps1`，再 `./android/gradlew.bat -p android/qq-skin --project-cache-dir D:/拾页/tmp/android-qq-016/gradle-project-cache assembleDebug --offline`。QA加引号参数 `'-PqaApplicationId=dev.shiye.qqqa'`；不要以默认android/app的015/code17构建覆盖本轮。原0.14 APK/owned source ZIP是受哈希校验的本地构建输入，产物outputs/2026-10-18-android-qq-016，临时tmp/android-qq-016；下一轮后端合并用code19以上并重新验完整Repository/接口。

2026-10-18 Android后端015候选已完成配对/库身份守卫/系统密封凭据设置页及完整Entry保存前准备，code17仅独立QA运行，手机和主AVD继续0.14/code16。97真实隔离HTTP、7实际Android配对/重开/返回检查、6长文定向及实际WebView与桌面fixture逐对象一致通过；没有启用内容同步或改生产保存权威。完整Repository/单事务outbox-inbox、长文生产写口和朝花夕拾绑定/收件仍未完成；下一阶段见015交接。全库check停并行sync-product两个未使用变量，未代改。产物outputs/2026-10-18-android-backend-015，临时tmp/android-backend-015；自有QA包/服务/转发和配对码已清理。 [候选验收](../docs/validation/2026-10-18-android-backend-015.md)。

2026-10-18 Android0.14/code16已保留数据覆盖运行Magic7及主AVD（APK29865bf4…）：发送统一原小飞机，单一缩略图库/点选原件直发、长按备注管理与本机拖动排序；实际收藏DTO/名称备注分组时钟及未知字段保真，原生固定收藏API/原件分块和本地文字联想已接。真实隔离Android16项媒体闭环＋4项图库、136原生HTTP、17图库浏览器及7共享测试通过；手机25/AVD37持久文件安装前后hash保持，完整私有备份保留。全库check停40共享/历史格式告警，未混改。用户继续手机UI手测；完整消息/长文Repository同步与朝花夕拾绑定收件仍待接，015按新接缝继续，不把收藏成功当全数据已互通。产物outputs/2026-10-18-android-media-014、临时tmp/android-media-014、备份var/android-backups。 [验收](../docs/validation/2026-10-18-android-media-014.md)。

2026-10-18 Android0.13/code15已保留数据覆盖运行主AVD（APKc52752b4…），手机仍0.11继续用户手测。统一全局浅/深前景与透明色调、分别管理思绪列表/写作/随想scope壁纸；按用户新纠正去掉思绪大圆角卡片，改连续摘要/小字/细分割线，置顶仅轻微平面色调。应用内字号解除系统重复放大与WebView8px夹限，实际13/8推荐和6/5下限、27.5px短气泡/44px输入/36px按钮、PNG/GIF直接本地ACK已验；写作去成功保存闪字、稳定字数/IME、分类单页拖动/默认/返回验收。修复覆盖升级的SW旧模块缓存，版本化精确导入且保留IDB。0.12服务接缝保留，新同步协议另按SYNC-FRONTEND-CONTRACT接Repository，未称云同步已完成。373模块/ESLint和38共享核通过，全库check停在共享/历史格式告警；不承诺120FPS或系统picker已重验。产物outputs/2026-10-18-android-compact-013，临时tmp/android-compact-013，备份var/android-backups。 [验收](../docs/validation/2026-10-18-android-compact-013.md)。

2026-10-18 Android0.12服务连接候选已构建、保留数据覆盖运行AVD（code14，APK59cf45a5…）；手机保持用户已安装的0.11/code13继续UI手测。新增原生固定服务客户端、独立网络队列、离线/连接地址与服务目录快照、朝花夕拾实例只读状态；99项真实隔离HTTP断言、10服务回归和最终AVD9正常/4失败返回检查通过。未改正式监听/Host/Origin/访问锁，未自动上传/绑定/改规则；测试仅AVD转发隔离合成库。完整仓库/同步、create-bind UI、自动收件、认证和云部署仍未完成。当前共享工作区0.9.25 check停在sync-lab三个未生成assets，独立lint通过，未代改并行后端。 [验收](../docs/validation/2026-10-18-android-service-adaptation.md)；接口后续顺序见ANDROID-SERVER-CONNECTION-012，产物outputs/2026-10-18-android-service-adaptation，临时tmp/android-service-adaptation。


2026-10-18 用户授权先部署UI后继续后端适配：Magic7已0.10/code12→0.11.0-compact-ui/code13保留数据覆盖安装（APK1914ba64…），install -r Success、版本回读/启动Status:ok及聊天ready只读通过。第一次由手机系统拒绝安装，用户“重试”后成功；安装前App无进程，稳定完整私有备份保留，无需中断编辑/伪造flush。未卸载/清数据/导入AVD资料，手机交用户手测，不继续远程控制。后端适配另在电脑/AVD候选进行，不随之覆盖手机。 [安装记录](../docs/validation/2026-10-17-android-magic7-install.md)。产物outputs/2026-10-18-android-magic7-0110，临时tmp/android-magic7-0110，备份var/android-backups。


2026-10-18 Android0.11/code13已保留数据覆盖运行主AVD（APK1914ba64…）：紧凑可调气泡/小时间戳、全局与会话外观、独立列表壁纸、冷蓝深色/系统栏、回车发送/真实引用撤回、QQ式刷新反馈与失败后切思绪恢复、思绪Aa/分割线/小图、分类长按拖动与返回层级已落地。AVD按Magic7实测设1264×2800/632dpi/font1.3/320dp，虚拟120Hz不代表物理120FPS。真实聊天8/导航9/分类8/最终编辑8及软件键盘几何通过；主矩阵与最终包的未改JS/DEx字节复用边界见验收。手机仍0.10手测、本轮未覆盖；完整本地Repository/outbox/云同步未完成，手机完整本地存储为后续明确约束。 [验收](../docs/validation/2026-10-18-android-refinement-011.md)，产物outputs/2026-10-18-android-refinement-011，临时tmp/android-refinement-011；先重查设备状态再操作。


2026-10-18用户明确：安卓手机长期完整保存本地数据/文件，云端只负责与电脑同步；离线可写改读，本地保存ACK与同步状态分开。本地事务＋outbox、完整Entry/消息/原件/未知字段保留为后续框架约束，当前SQLite/私有媒体/TL IDB继续保留，不以未来缓存定位删除旧库。完整新Repository/可靠同步尚未实现。见[本地优先存储](../docs/ANDROID-LOCAL-FIRST-STORAGE.md)。本次为需求/架构记录，不改设备数据。

2026-10-18 用户要求保留现有数据安装Android0.10：Magic7已从0.6/code8覆盖升级0.10.0-content-contract/code12（APKc54bf181…），install -r Success、版本回读一致、ADB启动Status: ok，聊天页ready/bridgeAvailable只读通过。安装前完整私有备份保留；旧0.6出现双WebView/保存桥无响应，已确认两页无日记编辑器/会话输入框/待发送消息，再停止应用备份，不冒称完整flush ACK。未卸载/清数据/导入AVD内容，未发送消息或编辑用户日记；用户接着真机手测，不继续工具控制。下方手机仍0.6为此前快照。[安装记录](../docs/validation/2026-10-17-android-magic7-install.md)。产物outputs/2026-10-18-android-magic7-0100，临时tmp/android-magic7-0100，备份var/android-backups。

2026-10-18 Android0.10/code12已保留数据覆盖运行主AVD（APKc54bf181…），用户重新授权后标准ADB启动成功。按后端最新实际内容契约共用分段/时间/富文本模块；完整fixture在真实WebView与桌面逐对象一致、实际Tiptap往返及原生保存ACK通过，DBv3内容时钟/迁移5项实际回读通过，另3Node/16浏览器/37SQLite合成定向通过。0.9思绪列表/搜索日期/置顶、页面复用静默刷新、IME底栏隐藏恢复15项已验，按未改UI来源复用。完整Entry持久化/分类映射/canonical/TL消息身份/云同步/表情包收藏仍未接，不支持格式提前只读。手机仍0.6、不操作桌面运行版。[验收](../docs/validation/2026-10-18-android-content-contract-010.md)。产物outputs/2026-10-18-android-content-contract，临时tmp/android-content-contract-010，备份var/android-backups。

2026-10-18 回看气泡残留缩进已仅在展示层修复：按diary顶层段落去Unicode段首空白，marks前处理，代码/嵌套结构/聊天及原body/ID/时间/评论保持。13定向＋12实际隔离前端及2共用fixture测试通过；API0.9.24 paragraphIndentation=1已重启，标准恢复ui28原生ready、116%/2屏。冷解析曾timeout后沿原游标自动重试成功；3014旧篇/源字段与11737安装hash保持。用户明确要求安卓复用电脑格式/算法，新增[实际内容契约](../docs/DESKTOP-ANDROID-CONTENT-CONTRACT.md)及合成fixture，写清canonical正式开关仍false、只读投影/现有聊天写口和Android差距，不冒称已全端统一。见[验收](../docs/validation/2026-10-18-revisit-indent-and-content-contract.md)，产物outputs/revisit-paragraph-indent，临时tmp/revisit-paragraph-indent。

开发候选0.8.0-chat-ui/code10：APKfc377e63…已保留数据安装AVD，用户手动打开后再进行原生路径验收；手机仍0.6。17项浏览器定向/Java编译/构建已过，统一气泡与底部面板、会话背景头像、图库视频等见[验收](../docs/validation/2026-10-17-android-chat-ui-08.md)。未接电脑共同归档worker、完整内容协议或云；业务算法后续共用，UI层不另造。

开发版最新：0.7.0-editor/code9已在主AVD实际运行（APKa416b295…），手机仍0.6用户测试。编辑页/主题膜/图标/软键盘/空白草稿更新及真实键盘几何见[0.7验收](../docs/validation/2026-10-17-android-diary-editor-07.md)，产物outputs/2026-10-17-android-diary-editor-07；跨端写入/长文处理尚未全统一，见[后续接入](../docs/ANDROID-DATA-UNIFICATION-PLAN.md)，不把本轮样式当同步完成。

手机最新：2026-10-17已按用户要求把0.6/code8（APK82926231…）保留数据覆盖安装Magic7，Success与版本回读通过，安装前完整备份已保留；用户打开体验，未重复全库审计。见[手机安装](../docs/validation/2026-10-17-android-magic7-install.md)。下方“手机保留0.5”是此前AVD验收阶段。

2026-10-17 最新0.6.0-ui-preview/code8已构建并保留数据覆盖运行主AVD，实际发送/保存/写读/原生重开及实时CSS验证见[实时迭代](../docs/ANDROID-UI-LIVE-ITERATION.md)。APK `outputs/2026-10-17-android-ui-preview/Shiye-Android-0.6.0-82926231.apk`；手机保留0.5，尚未部署0.6。新增真实CSS预览工具、细化会话/聊天/整页思绪、新建先选分类（沿旧日记实际习惯，可关闭）与页面系统栏恢复。源码数据接缝见[跨端适配](../docs/ANDROID-CROSS-DEVICE-ADAPTATION.md)，实际联网/云同步未接入。下方0.5/0.4为历史阶段。

2026-10-17：0.5.0/code7已构建并在主AVD运行，GIF/文件/分类与排版核心验收通过，帧采样发现长帧，流畅度尚未达标，手机仍0.4。需求按电脑已确认文档逐项映射，见`docs/ANDROID-REFINEMENT-REQUIREMENTS.md`；本轮资产`tmp/android-refinement/telegram-build/assets`，产物`outputs/2026-10-17-android-refinement/`。新增分类/默认与排序、分层设置、日记排版、文件类型选择与本地Blob另存为、列表手动/回前台刷新；聊天表情/字号/置顶与菜单适配以该轮验收为准。云端仍未接入，数据不因外观精简删除。

上一版0.4.0基线：浅天蓝/黑字，日记底部仅时间戳，正文格式收进更多；图片由canonical媒体投影为附件网格，思绪可独立选壁纸。最新实现与实际运行边界见[天蓝样式需求](../docs/ANDROID-SKY-UI-REQUIREMENTS.md)、[验收](../docs/validation/2026-10-17-android-sky-ui.md)。

Android 原生外壳，思绪使用 SQLite 与共享 richdoc 编辑核，随想复用已有本地化 Telegram Web A 的移动消息前端。当前为本机独立前端预览，未连接电脑日记、Telegram 账号或云服务器。

默认打开会话列表，底部“写日记”直接新建可写页面，“思绪”进入篇目阅读列表。思绪页更多菜单可选启动时直接新建日记。底部布局是本轮试用安排，永久位置尚待用户体验后确定。最新进度见 [第二版](../docs/ANDROID-FRONTEND-V2.md)。

详细需求、功能对齐/差距及验收见 [ANDROID-PROTOTYPE](../docs/ANDROID-PROTOTYPE.md)。参考 Telegram 的附件网格和聊天行为，代码来源与许可见 [THIRD-PARTY-NOTICES](THIRD-PARTY-NOTICES.md)。

## 本机构建与运行

已配置 SDK36 / Build Tools36、JDK17、Gradle8.13 / AGP8.13.2。依赖已缓存，首次下载需要配置中既有的本地代理 127.0.0.1:7897。SDK 配置在未提交的 local.properties；调试签名独立于桌面与其他手机项目。

```powershell
. 'D:/codex-tools/android-state/activate.ps1'
node ./telegram-adapter/build.mjs --work-dir tmp/android-compact-013/telegram-build --output-dir outputs/2026-10-18-android-compact-013/telegram
./gradlew.bat --project-cache-dir '../tmp/android-dual-prototype/project-cache' assembleDebug --no-daemon
adb -s emulator-5554 install -r '../tmp/android-dual-prototype/app-build/outputs/apk/debug/app-debug.apk'
adb -s emulator-5554 shell am start -n dev.shiye.app/.MainActivity
# 用户已重新授权标准ADB启动；若工具再次明确拒绝，停止并报告。
```

命令工作目录为 D:/拾页/android。包名 dev.shiye.app；不要用 pm clear 或卸载来“更新”样机，否则会删除在其中录入的内容。覆盖安装保持独立 SQLite 和私有媒体。

适配器参数按项目根目录解析，即使上述命令从 android 目录运行也使用同一产物位置；0.11构建入口/许可/对应源码使用 tmp/android-refinement-011/telegram-build 与 outputs/2026-10-18-android-refinement-011/telegram；冻结ui18基础保留，仅原件贴纸质量接缝，并带入当前共享input/stickers本地客户端，不注入远端transport，不覆盖旧验收产物。仅更新三个适配文件时，可在相同命令末尾追加 --adapter-only。Gradle preBuild 会拒绝与适配器源码不一致的旧资产。

修改聊天或思绪CSS时，优先使用[实时样式工具](../docs/ANDROID-LIVE-PREVIEW.md)，无需每次重装；原生/HTML/JS修改仍构建。Windows PowerShell 5不要把Gradle的stderr警告当失败：允许本机命令完成，并依据退出码及BUILD SUCCESSFUL判断，不能只因SDK XML警告中止。

Gradle 在 tmp/android-dual-prototype 下输出 APK 与共享编辑资产。共享编辑核心、样式与许可在 preBuild 时从项目 public 复制并打包，0.4另原封带入editor-input/rich-date-time/time-zone供时间戳复用；不要修改生成副本。原生/UI 源码位于 app/src/main，局部 WebView 页面是 assets/editor.*。

## 数据与权限

首轮初始化事务写入三篇虚构日记、三个会话和十二条消息。后续创建和修改都是真实本地持久化，不是内存演示。没有 INTERNET 权限，也没有读取或写入桌面日记的代码。

第二版随想消息使用独立 `shiye-android-telegram-v2` IndexedDB 权威库；第一版 SQLite 消息/媒体保留，可从思绪更多菜单“先前的随想记录”进入，未自动合并或双写。0.2.2 的会话置顶以原生 SQLite `meta/android-chat-ui-preferences-v1` 为唯一权威，通过已有 WebMessagePort 等实际事务结束后确认；旧 IDB 置顶 key 只作一次迁移来源，localStorage 是排序缓存。长文继续使用原 SQLite。跨端完整统一与迁移不在本轮前端预览交付内。

只在打开附件面板并选择授权时请求照片访问，支持部分授权和系统选择兜底。照片先固化到应用私有目录，再插入正文/发送，保存 assetId、独立 occurrenceId、insertedAt；图片上限20MiB。原图不会因选择被移动或覆盖。

本地ZIP导出是样机专用格式，包含 SQLite 的 manifest 和 media，**不包含第二版 Telegram 随想的 IndexedDB 或置顶偏好 meta**；菜单明确称为导出思绪与先前记录。不代表兼容电脑版备份，暂未提供恢复入口。不要将其当作完整迁移工具。

0.4思绪壁纸只保存在私有files/appearance及独立SharedPreferences，亦不进入上述ZIP，不是日记媒体。照片导入仍沿用既有LocalStore，每次导入各自assetId，重复字节不表示同一出现；每个canonical图片另有occurrenceId与独立UTC insertedAt。时间戳使用共享电脑逻辑及北京时间默认，未来实际库自定义时区和联网Repository尚未接入。
