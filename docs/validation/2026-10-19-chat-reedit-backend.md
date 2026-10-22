# 原位重新编辑配套后端：独立审查与发布

2026-10-19。用户指定由性能会话接手前端ui48完成后的后端适配；已核对原始用户消息及共享需求。前端候选和后端发布分别验收，本页仅记录后端。本轮产物outputs/2026-10-19-chat-reedit-backend，临时tmp/chat-reedit-backend。

## 范围和审查

本人不限时编辑与本机恢复由客户端实施；后台旧正文仍清除，仅留撤回墓碑。legacy journal新身份通过replacementOf/replacementRootId请求受控原时原位追加；同源/同房/同作者、单后继和完整请求幂等，冲突保留客户端待发。已归篇根＋未上传中间版的连续链回原篇，不影响当前篇deadline；不允许覆盖手改/已删篇。

接收不可变chat-reedit2候选，基于source-cache1叠8个修改模块和3个新模块，包含已验原子设置、多slot与程序/AI角色登记。来源缓存helper/入口及工作区路径锚点与已运行基线SHA一致；独立逐文件SHA和Espree AST检查107文件/299相对依赖闭合，无删除文件或非字面量动态import。普通消息保持legacy单写，不迁messageOwner；统一send尚不支持replacement，AI只登记、不执行。

## 独立验证

- 冻结包的72项相关测试通过：12原位/连续编辑、旧journal、会话消息/原子设置、多实例、来源缓存、评论和撤回。首次71/72通过，剩余一项复制测试后源码目录相对路径失效；修正临时测试路径后72/72通过，未改产品代码，初轮日志保留。
- 新写9项真实HTTP检查通过：同一前驱并发只接受一个后继；多条批次中后项冲突时前项也不落盘、JSON字节不变；原位/原时与旧正文清除；服务真正close/reopen后的丢ACK重试；混合已归篇/未上传链回原篇且deadline不变；原子设置CAS；程序登记仍legacy owner；旧固定回看状态保持。
- 当前真实库私有副本3153篇/3132媒体启动成功，health/journal/catalog只读检查通过，副本JSON字节未被重写。副本位于原stateDirectory/performance-audit下，不在公开产物保存正文。
- 来源缓存helper、入口和路径锚点与source-cache1逐文件SHA一致；不重复未改来源目录的125秒性能对比，不把先前性能数值冒充新编辑机制性能结果。

## 正式后端发布与数据核验

已正常保存退出ui44，停止旧回看运行器；JSON稳定且逐文件哈希校验后，在原stateDirectory下备份到 `upgrades/chat-reedit-backend-2026-10-19T12-16-59-279Z`。核对API路径/创建时间、旧指针SHA、库SHA及候选全文件SHA后使用Windows Stop-Process停止已排空旧API；不是服务端优雅SIGTERM。首次脚本因Split-Path参数组合不兼容而在停止API前退出，改用.NET路径函数后继续；失败日志保留，无跳过保护。

新API已从稳定server.mjs加载不可变chat-reedit2，运行指针清单SHA为 `0ba9d02fbebd7e8fa14100b391d9d310762d8ae26a359163d7353f3c70f492ee`；health回读sourceSessionCache=1、atomicConversationSettings=1、conversationMessaging=1。原子服务/统一消息后端此时正式可用，但普通旧房未迁owner，也未向正式库写入测试消息/程序实例。

正式库3153篇/3132媒体、3139原非聊天日记逐项保持；媒体元数据/规则/评论/完整旧chatJournal与messageStore保持，旧78投递身份保持。运行器running/waiting、连续失败0，沿原游标续进。只正常恢复ui44，ready、116%及两屏档案保持，未更换前端资产。

后端已就绪，交由「astra聊天窗口ui优化」会话接续ui48标准升级。**本页后端启用不代表ui48已安装或界面已验收**；前端正式版本应重新status核对。

## 证据与边界

产物 `outputs/2026-10-19-chat-reedit-backend/`：independent-package-audit.json、independent-http-review.json、real-copy-compatibility.json、private-backup.json（仅清单）、api-switch.json、health-after.json、data-verification.json和标准桌面stop/start/status回执。脚本/测试日志在 `tmp/chat-reedit-backend/`；使用的不可变代码包在 `outputs/backend-runtimes/20261019-chat-reedit2/`，旧包及其文件未改。

本轮审查无需修改接收的候选生产代码；正式新增行为来自已独立核验的候选，不只是性能缓存调整。未验新前端安装后的完整物理窗口生命周期、Android或长期泄漏；统一conversations/send没有replacement能力，不能据legacy验收声称统一owner支持原位编辑。

复用测试的会话服务夹具另按其相对root生成于项目 `tmp/tmp/conversation-services/`（合成库）；位置清单保存为产物reused-test-fixtures-inventory.json，未清理或移动其他测试目录。
