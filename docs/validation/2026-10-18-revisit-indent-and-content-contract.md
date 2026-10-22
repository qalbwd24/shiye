# 回看去缩进及 Android 数据交接

2026-10-18用户截图：分段基本满意，部分气泡仍带段首缩进；随后明确要求把电脑后端数据、格式、算法、富文本说明到开发文档，供正在开发的安卓直接适配。

## 修改与实际验证

只改后端`revisitMarkdown`和`presentRevisitSource`展示调用：对origin=diary的顶层段落/标题，在生成Markdown marks之前清理段首/显式续行后的Unicode空白（含全角、Tab、NBSP及普通空格），不裁剪文本内部空格。清理跨多个带marks的空白atom，避免只trim最终字符串漏掉`**　　正文**`及首时间戳后空白。代码块、行内代码及嵌套列表/引用/表格不应用此清理；聊天原消息不统一去缩进。

unit.body、source.html、完整原日记、时间、段落ID/投递ID和评论关联都不改。现有ui28接收同ID新展示文本后更新原气泡，不创建新消息，不需Vite/EXE/UI打包。health新增`revisit.paragraphIndentation=1`，正文版本仍richdoc v1、API/package仍0.9.24。

- 13项定向通过：首时间戳移除后全角/Tab/NBSP、空白跨bold/italic atom、真实换行、内部空格、代码保护、嵌套结构和聊天保护、原body/HTML不变；同时复核既有分段/时间/引用展示。
- 使用已安装ui28资产＋隔离合成后端，实际Chromium/worker12项通过：旧气泡分段替换/编号/去重路径保留，新气泡正文与实际Markdown顶格，原Entry仍逐字保留缩进。合成截图`outputs/revisit-paragraph-indent/browser/indent-fixed.png`已查看。此轮不重验无关视频、IME、物理120Hz或全库UI矩阵。
- 共享合成fixture和2项契约测试通过：整篇重组保真、富文本编辑往返、手打北京时间、段落时间、同图两处occurrence及独立媒体时间/旧图推定、气泡去缩进但源文保留、超2^53消息字符串身份。Android尚未实际运行fixture，不宣称双端已通过。
- 受影响源码定向lint/format通过；完整项目检查未重复。

## 部署及数据保护

开工只读status已确认用户手动打开的ui28真实ready，不再沿用上轮“窗口未打开”的旧状态。先通过标准desktop-control保存/退出，核对本机18765监听所属D盘server.mjs和Node完整路径，暂停运行器并保存稳定私有快照，再重启后台。没有直接编辑正式diary.json、批量转换旧篇或修改安卓数据。

私有快照`F:/<正式目录>/var/upgrades/diary-indent-2026-10-18T04-09-04-588Z`；API0.9.24回读paragraphMessages=1/paragraphIndentation=1/autoStart=true，标准start成功恢复随想/托盘，ui28原生ready，116%/两屏档案保留。本轮原生启动没有被策略拒绝，与上轮分别记录。

冷启动期间运行器曾15秒timeout，首次最终核验因此未通过（当时主进程仍在）；沿原游标自动退避重试后2026-10-18T04:09:29Z成功，lastError=null，未为通过检查重置进度。不是本轮已解决了冷全库解析/长期内存。最终回读原3014篇旧长文逐篇相同，源entries/media/messageStore/chatJournal/categories/conversationServices哈希保持，原评论/配置/回执保留，投递身份唯一；11737安装资产哈希与原ui28候选保持（UI资产未变）。正常到点来信继续追加，不能称整库字节始终不变。

## 开发文档交接

主入口[电脑与安卓实际内容契约](../DESKTOP-ANDROID-CONTENT-CONTRACT.md)，含运行开关、权威正文、Entry可变属性与版本、richdoc节点/marks、媒体三层ID/插入时间、MessageUnit与SourceRef、长文分段、聊天写口/撤回/归篇、回看/评论、多实例、导出与本机网络限制、安卓字段差距及唯一算法文件。

特别明确正式messageUnits.enabled=false、回看派生不等于已迁移；现有chat-journal没有任意richdoc body上传口；气泡Markdown不是全部richdoc样式的可逆序列化；安卓SQLite/TL/Java校验/打包模块尚有差异。不得依“UI能显示”宣称完整跨端统一或云同步已实现。本轮提供契约与fixture，不擅自启用canonical开关、改云部署或迁移手机。

产物`outputs/revisit-paragraph-indent`；临时脚本/隔离库`tmp/revisit-paragraph-indent`；共用样本`tests/fixtures/cross-device-content-v1.json`、检查`tests/cross-device-content-contract.test.mjs`。完整后端接口继续由API.md及相应专题维护，跨会话交接同步DEVELOPMENT-HANDOFF。

## 按用户要求恢复每日随机模式

用户明确“测试通过并做好文档说明后，把朝花夕拾改回之前设计的随机日期”。13项缩进/分段展示、2项跨端fixture与14项随机/切换定向通过，实际隔离前端12项通过；契约文档及Android交接已写入后，先在正式库只读内存副本验证随机初始化新增0、历史范围与源Entry不变，再通过现有PUT `/api/revisit/config`带expectedRevision切换。

2026-10-18T04:16:50Z回执：mode=daily-random、dailyTime=08:00、timeZone=Asia/Shanghai，保留sourceDateFrom=2025-10-01/sourceDateTo=null、分类、发送者及其他参数；revision=7/ruleRevision=5。规则改变只初始化新游标，不删原17条投递/原评论、固定组或旧随机选择，不手动补发。私有快照`F:/<正式目录>/var/upgrades/restore-random-2026-10-18T04-16-50-240Z`，没有直接修改库文件。

后台首次随机选择2025-11-04，周期北京时间2026-10-18 08:00至次日08:00；本次从切换时刻继续，初始化created=0。运行器恢复running/waiting、lastError=null、有成功检查时间。期间reviewCount=66是现有来源适配提示数，不代表已修好所有旧格式；不为切模式清空提示或自动改旧篇。

安装ui28资产＋正式feed后台只读**11项通过**：14条可见消息实际渲染、来源身份一致、刷新保留ID、引用编辑栏、段首无写作缩进、客户端收到history-day=2025-11-04、无正式写入与前端异常。旧3父receipt仍隐藏，原17条总receipt未删除。测试首次沿用旧“每条都必须有文字”断言遇纯媒体消息失败；纠正为必须有文字或真实媒体，保留`read-only-media-assertion.json`；没有改产品掩盖失败。正式正文不做截图或输出日志。

证据：`random-mode-tests.log`、`random-preflight.json`、`random-restored.json`、`random-runtime.json`、`read-only-display.json`、`contract-source-sha256.json`（18个核对源文件及8个文档链接）。
