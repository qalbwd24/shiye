# 随想 ui32：/名称检索表情包

2026-10-18。用户明确只要 / 后文字检索自己的收藏，去掉原图片、时间、搜索、表情与表情包命令。本轮基于冻结ui31，仅替换shiye-input.js、shiye-preview.css、shiye-preview.js及其index缓存hash/发布元数据，不混入其他会话候选，不改服务器/消息协议/原生宿主或Android APK。

功能及边界见[使用与跨端规则](../STICKER-NAME-SEARCH.md)。名称/片段/旧sticker别名可查；名称直接可用，无须额外映射。可见候选有缩略图、完整名称、GIF标识，方向键选择，Enter用原sendSticker直接发送，保留草稿与引用。IME确认不发送，无匹配Enter不误发，Esc保留输入。旧emoji映射、偏好未知字段和收藏保留，emoji不进入斜杠候选。现有编辑器检索词24字/非空白限制保持，长名字可用其中片段；首批12候选，输入进一步筛选。缩略预览为首帧，不宣称完整动图悬停播放已实现。

## 实际验证

- 3项Node交互测试通过：直接名称/完整文件名/别名去重、旧命令和emoji候选消失；方向键/selectionchange不失选或抢焦点、IME/连续Enter；改名/移除与异步原件获取后输入已变时不发送。tests/sticker-name-search.test.mjs，日志outputs/sticker-name-search/node-tests.log。
- 21项候选及21项安装资产真实构建浏览器检查通过：缩略图实际加载、名称和别名、保留词可作收藏名、空匹配不发送、方向键Enter仅一条/GIF原字节多帧/无确认页/草稿保留、Esc、IME和改名更新；无页面异常、无Telegram/外部服务请求。初次用例库尚未持久化导致测试基线读取失败，已补实际发送合成基线后再测通过，没有为此改产品。合成fixture仅在tmp隔离库，不写正式库。
- JS与改动测试文件ESLint通过；未改vendor TypeScript，无需重建其冻结产物。按测试策略不重复无关全库检查。原生宿主和看图页与ui31 SHA-256相同，复用ui31的11项看图证据，未冒充本轮重新实测11项。
- 11915安装文件hash全部一致；安装及原生运行回执均20261018-ui32，API0.9.25/metadata=1，字号116%、屏幕档案2个保持。完整机器回执outputs/sticker-name-search/final-verification-ui32.json，发布清单delivery-manifest-ui32.json已标部署。
- 3014篇旧长文、294条原聊天消息、3个旧收藏身份与媒体保持；原媒体元数据、分类/标签、规范消息库、回看配置/评论/既有投递ID与服务绑定保持。原整库SHA是否相同为false，用户日常新写入与是否保留旧实体分开检查，不通过覆盖正式库修复测试。
- QQ动图沿用用户在ui31的实测通过，本轮不改拖入/字节识别。微信聊天表情包直接拖入按用户要求停止适配，不列入通过项。未操作手机或其他会话的模拟器。

## 部署与产物

正常退出保存后私有数据快照：F:/<正式目录>/var/upgrades/sticker-ui32-2026-10-18T07-12-00-516Z。

程序/偏好备份：D:/拾页/outputs/desktop-maintenance/backups/2026-10-18T07-12-09-033Z-638d52d0。后台API与朝花夕拾不因本轮重启，runner=waiting、lastError=null。

产物D:/拾页/outputs/sticker-name-search；临时脚本及合成隔离库D:/拾页/tmp/sticker-name-search。正式日记及原收藏位置不移动、不删除，旧真实备份不纳入源码交付。后续操作重新status，不依赖本轮PID快照。
