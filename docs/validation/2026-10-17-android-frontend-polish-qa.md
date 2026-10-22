# Android 0.3.0 前端打磨专项 QA

2026-10-17 本轮实际 AVD 验收完成：聊天前 7 项＋成熟移动回复等后 5 项、日记 16 项、字号/稳定 sheet 4 项通过；原消息/SQLite 原行/原媒体哈希保持，三篇 QA 日记保留。22:59:45Z 后明确交回主代理，默认会话列表运行、原 native pin `[-10]`、无待保存。用户认可的是三入口结构；新视觉已实际检查但仍由用户判断观感，不能把技术验收替代用户审美确认。

## 本轮对应安装与数据基线

实际验证的是 `0.3.0-frontend/code5`、APK `0c468ebc6eeabbef60fb9dce997b3acb701a4003eee30e28a0a39d095f6515a3`（91,336,780B）。主代理已验证 11,711 Telegram 资产、editor/Material 许可/10 个 vector，覆盖安装后启动前 211 个原私有文件哈希一致；这里只记主代理构建回执，不重复声称 QA 独立打包。

主代理升级前通过成熟 refresh 投影确认旧 `-103` 合成五段草稿精确保存，再取完整一致备份 `var/android-backups/2026-10-17T22-49-32-471Z-before-frontend-polish/app-private.tar`，SHA-256 `75319016d39b797d6ded563831f04c44e41f5b8ffd0ed5dc3d35036b4e75d1bd`。QA 只将主 SQLite/journal 与原媒体提取至私有 `var/android-backups/frontend-polish-qa-before/`；不打印旧正文。

QA 过程中主代理另改“关于”中的“本模拟器”为“当前设备”并澄清导出范围，尚未在 QA 时段覆盖安装。主代理将在交回后用仅文案新包最终安装核对；本文件不预报该包 hash，不将上述旧 hash 当作最终运行 hash。

主代理交回后补记：最终 `12bf11ab…` 包已覆盖安装，安装前后210个原私有文件逐项hash一致；另核验冷启、关于文案、原pin `[-10]` 和回默认会话列表四项通过。上述32项实际QA仍对应原 `0c468ebc…` 包，两包仅关于一句话不同的证明及最终回执见[最终包验收](2026-10-17-android-frontend-polish.md)。

## 实际结果

### 随想

`chat-flow.json` 前 7 项实际通过：默认列表、普通 NewChatButton/dialog 真正新建 `QA-POLISH` 会话 `-104`、ApiChat 投影已就绪、54 字符五段含空段/双空格/全角空格/emoji 精确、flush **201ms** 后 IDB 精确保存、跨原生页和冷启动后草稿完全相同、实际发送恰好一条。精确草稿 hash `0ce5407b0a7795a71d934116d0fd742f6e9ec419557651f56f79db2ad3403e4d`；新会话投影缺失的上轮真实失败已在正常创建链路验证解决，不靠 QA 手动补投影。

首轮物理长按进入成熟 Web A 的多选模式，底栏为“已选择 1 条消息”及删除/复制/转发，不出现桌面 `.MenuItem` 右键菜单；因此原脚本等 reply 菜单超时。`chat-flow-attempt1.json`、`chat-diagnostic.json`、`chat-longpress-diagnostic.png` 保留；这是 QA 对移动交互的错误预期，不写成产品长按失败，也未重跑或覆盖前 7 项。

`chat-rest.json` 后 5 项通过：退出选择后沿原 Web A 触摸左滑（屏幕 994→561、240ms）显示回复预览；实际发送后 IDB `replyToMsgId` 精确指向首条 `16`；照片按钮一次 tap 打开原生照片面板；会话菜单真实显示重命名/置顶；全部原会话消息哈希保持。照片面板不截图，未扩大为全媒体发送链验收。

聊天截图 `chat-draft.png`、`chat-sent.png`、`chat-reply-preview.png`、`chat-reply.png`、`chat-room-menu.png` 仅在 `-104` 明确合成会话。发送气泡中的空段已可见，截图实际查看。

### 日记与三入口

`diary-flow.json` 16 项通过：三篇 QA-POLISH 日记均由底部“写日记”直接新建，正常标题/日期/正文保存，日期本月两篇、上月一篇；底部“思绪”进入新原生列表，搜索 QA-POLISH 只显示这三篇，月份分组、分类筛选和真实无结果态均可操作；点击进入同篇只读，长标题完整换行且无横向溢出，继续编辑 ID/bodyHash 不变，返回保留筛选；最后底部回默认会话列表、原 native `[-10]` 保持。

首轮 QA 使用旧分类按钮 dataset 属性失败，实际源码为普通文本按钮＋aria-pressed；失败 `diary-flow-attempt1.json` 保留。改为观察已存在的分类 choices 后，从**同一篇已创建的 QA 日记**继续，不新造重复篇、不重复追加正文，没有改产品代码或放宽保存断言。

`font-and-sheet.json` 4 项通过：等待更多 sheet 实际 rect 在可视区、动画结束后重拍；21px 经真实字号按钮切换、返回重开仍为 21px；切换不改正文/entry revision；原外观 localStorage 值恢复。原 `diary-more-sheet.png` 只捕获过渡 backdrop，不作视觉通过证据，以 `diary-more-sheet-stable.png` 为准。

实际查看 `diary-editor.png`、`diary-filtered-list.png`、`diary-reading-long-title.png`、`diary-more-sheet-stable.png`：列表仅合成三篇，月标题清楚、底栏三入口完整；阅读长标题正常折行，日期层级与继续编辑可见；更多 sheet 完整位于屏内。编辑标题仍是原单行输入，长标题横向滚动属于该控件语义，阅读详情 h1 完整展示。

### 原数据保护与交回

`final-preservation.json` / `sqlite-preservation.json` 通过：升级前 **7 篇**原 entry、**5** 旧 room、**15** 旧 message、**2** asset、**3** category、**2** meta 的每个原 ID/整行 hash 精确保持；entries **7→10** 仅新增三篇合成日记，其余表数量不变。原两份媒体各 5,395B，逐字节 SHA-256 相等，asset 行和身份保持。数据副本 `var/android-backups/frontend-polish-qa-after/`，公开回执只有哈希/计数。

旧 IDB 所有六个会话消息在测试结束和最后冷启动后哈希精确保持；新 `-104` 只有本轮两条合成消息。最后实际 flush ACK、停进程取一致副本、重启回默认会话列表，原 native pin `[-10]`，无待保存正文。全部合成内容保留、不删除记录，手机和桌面正式数据/运行未操作。

## 范围

固定 `emulator-5554`，禁止手机 ADB/UI；不操作桌面正式运行/日记。候选要求 `0.3.0/code5`，脚本必须同时 `--run` 与 `SHIYE_POLISH_QA_HANDOFF=emulator-5554`。新工具 `tmp/android-frontend-polish/qa/`、公开回执/合成截图 `outputs/2026-10-17-android-frontend-polish/qa/`。旧 QA 脚本和输出不改。

原生置顶/迁移 19 项已在恢复后的 0.2.2 通过，本轮不重复整套。只核对原 `[-10]` 保持。旧用户消息在 WebView 内哈希保护，不打印正文；旧 SQLite 按原行 ID/哈希保护，允许增加明确合成日记。升级前现有 `-103` 合成草稿由主代理先经成熟 refresh/flush 保存并完整备份。

## 准备工具与实际流程

- `avd.mjs`、`scoped.mjs`：新输出/CDP 19230/交接开关、版本权限保护、旧消息浏览器内摘要；不会因调用模块就触碰设备。
- `ui.mjs`：普通新会话按钮/创建 dialog、原生三入口、合成搜索过滤、截图 guard、实际坐标 tap/长按。截图只允许已确认的 QA 会话或 title 以 QA-POLISH 开头的日记；列表先搜索 QA-POLISH 并核对可见记录都合成，不能把用户记录带入截图。
- `chat-flow.mjs`：默认列表→普通 UI 新建 QA-POLISH 会话→确认 ApiChat 投影→同 54 字符五段真实编辑器草稿精确 flush/IDB→三入口跨页→冷启→真实发送一次→实际消息菜单回复/目标身份→附件按钮原生照片入口（不截可能含原图片的网格）→会话菜单。无 trim/strip、无假 ACK。
- `diary-flow.mjs`：三篇明确合成日记通过底部快捷入口正常新建、日期/标题/正文保存；一篇长标题/一篇同月/一篇上月；仅 QA-POLISH 搜索结果截图，检查月份分组、读取/继续同篇、返回筛选保留、分类与空结果，最后回会话列表且原 native `[-10]` 保持。外观偏好私有备份并恢复。
- `sqlite-digest.mjs`、`sqlite-compare.mjs`：只读主代理保存/停止后取得的一致性私有数据库副本，比较原行 ID/整行哈希；不从日记造样本、不返回正文，允许合成新增。工具本身不复制或改运行库。

日记检查准备三篇合成日期（本月两篇/上月一篇），均从底部“写日记”直接新建，正常标题/日期/正文保存；最后通过底部进入思绪，搜索 QA-POLISH，仅合成列表核对月份分组/条数/空结果/分类筛选、打开阅读详情与继续编辑、长标题完整折行及无横向溢出。新空编辑截图只能在已确认的新合成 entry，内容未标记前不截。

## 验证边界

本轮是实际 Android API36/WebView133 主 AVD 流程与截图检查，中文文字由 CDP 插入，不能替代中文 IME 组合/候选词或真机键盘实测。用户手机仍是其自行手测的 0.2.0，本轮没有远程操作或覆盖。未扩展视频/相册全部分支、长期后台、云同步、全后端契约或旧置顶 19 项矩阵。新 UI 视觉好坏仍待用户确认，最终仅关于文案包的安装/版本/原数据回读由主代理记录。
