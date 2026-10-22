# 2026-10-17 Android 思绪/随想样机验收

用户授权自有 Android App 双入口样机，要求核心功能向电脑端对齐，并追加尽量参考 Telegram 客户端的附件照片网格、动效和可复用功能。需求及当前差距见 [ANDROID-PROTOTYPE](../ANDROID-PROTOTYPE.md)。

## 当前结果

原生 Java Views/SQLite 外壳和共享 richdoc 编辑页已构建并覆盖安装到 emulator-5554，包名 dev.shiye.app / 0.1.0-prototype。无 INTERNET，照片授权仅供用户主动附件选择，不连接电脑或云服务。虚构种子与原正式数据完全分离。

AVD 实际数据层测试已通过154项断言：revision冲突/未知节点/重复块ID/null正文等失败不提交；clientId幂等；跨会话回复拒绝；127消息经8页查询无重漏；媒体SHA、精确20MiB接受/+1拒绝；同资源独立出现身份；撤回后重复请求不复活；导出快照与关闭重开、软删除。测试运行独立 ContextWrapper 数据目录，未清理主App数据。回执 outputs/2026-10-17-android-dual-prototype/store-runtime.json。

初次实际运行发现 PRAGMA secure_delete=ON 不能通过 execSQL 执行返回行语句，改为 rawQuery 并验证结果后通过；首次失败回执保留。不能用 javac 成功替代数据库运行验收。

Root 已实际查看思绪列表/编辑页，操作照片面板的首次授权、照片网格点选、插入正文与保存；图片为程序生成的合成色条，未取用用户照片。首次权限未授予时面板展示授权/系统相册入口，授权后直接显示真实 MediaStore 网格。图片按钮已固定右侧，日期中文显示，底栏文字居中。参考行为并非声称原样移植 Telegram GPL 实现。

## 已完成的交互验证

编辑页20项真实检查通过：标题/分类/标签、图片元数据表单且assetId/occurrenceId/insertedAt保持、粗体及Undo/Redo、实际两个全角空格缩进、1万汉字/100段、长文Undo/Redo、阅读只读、保存ACK后force-stop重开同篇正文hash一致、图片解码。日期中文呈现与原生日期控件已查看，但日期值修改未列为这20项中的通过项。回执editor-runtime.json。

原生随想6项通过：创建会话、实际键盘ASCII输入/发送、ACK后清空输入、force-stop恢复同会话/已发消息/未发草稿；native-runtime.json。测试曾将UIAutomator的hint当实际文字误报输入未清空，纠正测试后完整重跑，不是隐藏App失败。测试后首篇虚构样本通过真实ProseMirror事务和metadata控件恢复，5项确认、body hash精确一致；restore-demo.json，未直接写SQLite或清库。

Root另实际在原生随想打开照片网格并选择同一合成PNG，已发出图片消息且缩略图显示，chat-attachment-grid.png、chat-with-image.png。长文与随想均使用同一附件面板。AVD第一次照片标准系统授权是ALLOW ALL；部分授权/拒绝兜底代码尚未各跑一次完整流程。

项目 `npm run check` 的311模块文件检查与ESLint通过，格式阶段被 docs/CHAT-PERFORMANCE-HANDOFF.md、docs/UI-PREFERENCES.md 两个并行文件告警阻断，未代改。随后单独完整 `npm test`：636项中634通过、1失败、1原生桌面按环境变量跳过；失败为 tests/markdown-live-preview.test.mjs:252 的分隔线/自动缩进测试（0≠1）。本轮未修改该桌面Markdown实现/测试，保留真实失败，不声称全库通过。日志project-check.log、project-tests.log；Android编辑JS单独ESLint/node语法通过。

共享 F:/agent规范 索引校验21主题、errors=[]，回执其outputs/android-dual-prototype-catalog-2026-10-17.json。实际中文IME、跨段手势选区、旋转、大字体、备份ZIP的系统保存流程和全部生命周期仍未验。

用户后续要求先熟悉一本日记和复用已有能力，当前原生聊天只作可行性样机，不扩大手写聊天；新增[参考与复用](../ANDROID-REFERENCE-REVIEW.md)及[复用审计](../../outputs/2026-10-17-android-dual-prototype/reuse-audit.md)。审计发现：SQLite消息尚非完整桌面MessageUnit、树限额20000/32与桌面50000/64不同、原生聊天UI只取120条未接hasMore。共同richdoc语法不能等同所有跨端能力已兼容，正式接入前必须解决。

## 一本日记原版参考熟悉

原版1.96.55已在独立断网 emulator-5556（API30 Google APIs，libndk_translation.so）安装运行；API36 ARM ABI安装失败保留为首轮回执。实际新建、标题显隐、ASCII两段输入、Tab、返回保存、阅读/继续编辑与简洁模式已查看截图并保存UI XML，7项XML一致性检查通过，[观察回执](../../outputs/2026-10-17-android-dual-prototype/reference/observations.json)。原版相册虽已授权且合成PNG入MediaStore，选择网格仍为空，未宣称插图成功；Markdown仅到会员介绍，未解锁。与主样机实际插图/发图通过是不同对象。用户最新将目标明确为一本日记长文编辑体验与Telegram消息前端，未因此扩展账号/通讯服务。

## 已知边界

- 原生界面是Java Views，长文主体是局部WebView，不是Compose或整页电脑网页。
- CDP 插入不等于实际中文IME组词；不代表已达到一本日记的所有交互效果。
- 未连接Magic7，没有MagicOS、真实相机或长期性能验收。
- 用户明确首阶段只做思绪/随想；便签/AI/回看/服务器暂缓。自动归篇、旧数据导入、完整备份恢复、跨端同步/全功能设置未完成。ZIP导出是样机专用格式。
- 动画只表示已实现/实际看过过渡，不承诺Telegram完整成熟度或物理帧率。

## 文件

- 可维护源码：D:/拾页/android，README与THIRD-PARTY-NOTICES记录构建/来源。
- APK/截图/回执：D:/拾页/outputs/2026-10-17-android-dual-prototype。
- 构建/隔离仪器测试/QA脚本：D:/拾页/tmp/android-dual-prototype。
- 独立调试签名：D:/codex-tools/android-state/keys/shiye-prototype-debug.jks。未复用正式签名。
