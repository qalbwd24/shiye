# Android 0.3.0 前端细化验收

2026-10-17。用户认可的是默认会话列表、独立快捷写、底部日记查看三入口；本轮分别打磨内部页面，不将原样式称为已认可。最终已覆盖安装并启动电脑主模拟器 `emulator-5554`，停在默认会话列表。手机未操作，仍由用户手测 0.2.0。

## 交付与复用

- 会话/消息：复用冻结 Telegram Web A 移动前端，细化中文字体、图标、菜单、触控反馈、段间空白；保留成熟虚拟列表、气泡、输入、媒体选择和动画。新建房间等待 ApiChat 投影就绪，修复编辑器有字但成熟草稿链没有保存的问题，不新增第二份正文权威。
- 长文写读：复用拾页 richdoc 编辑核，参考已实际观察的一本日记。暖白纸面、系统中文18px/1.85行高、紧凑编辑日期、阅读日期分层、完整长标题、统一工具栏/底部面板。已有字体偏好继续有效。
- 思绪列表/导航：按真实日期分月、日期侧栏/摘要/分类/字数，搜索、筛选、不同空态和返回位置；底部随想/写日记/思绪继续独立。原生图标直接使用固定版本 Material Symbols Rounded，许可和来源齐全。

只读核对实际 Entry/MessageUnit/richdoc 与既有写口，审计见[数据对齐](../ANDROID-FRONTEND-DATA-ALIGNMENT.md)。这次没有接入同步 Repository 或云服务器，TL/独立 IDB 不能称为共同后端协议；日记依旧原生 SQLite，聊天依旧独立 IDB。未修改桌面正式运行版、后端存储或正式日记。

## 构建与实际运行

最终 APK：`outputs/2026-10-17-android-frontend-polish/Shiye-Android-0.3.0-12bf11ab.apk`，`0.3.0-frontend / code5`，91,415,909B；SHA-256 `12bf11ab2634c80185dfd966d6b25b83b5bbac37072163e2d210310735a26fdc`。Gradle/JDK17/Android36 构建成功，无 INTERNET 权限。11,711 项 Telegram 资产与 manifest 逐项 hash 一致，编辑核/适配与 Material 许可均核验。

主模拟器 Android16/API36、WebView133。32 项[实际定向 QA](2026-10-17-android-frontend-polish-qa.md)通过：聊天前7＋后5、日记16、字号/面板4。54字符五段（含空段、双空格、全角空格和emoji）经普通新建会话、flush ACK、IDB精确值、跨页、冷启、发送一次、左滑回复身份核验；附件按钮打开原生照片面板。日记验证直新建/保存、月分组、搜索/分类/空结果、阅读长标题、继续同ID原文、返回筛选和21px字号重开保持，恢复原显示偏好。根代理已另查看实际聊天、原生分月列表和长标题截图。

首轮 QA 包为 `0c468ebc…`；之后仅把关于页“本模拟器”改为“当前设备”并准确说明旧导出范围。`qa-vs-final-copy.json` 确认除该句 MainActivity 外所有源/资产一致；APK 离线比较只有 classes2.dex 改变16字节。最终包另行覆盖安装与冷启核对，`qa/final-copy-runtime.json` 四项通过，native pin `[-10]` 保持、关于文案正确并返回会话列表；没有把整套32项谎称在最终新hash又重跑。

原生长按采用 Telegram 的消息选择模式；回复使用真实左滑，首轮测试误期待桌面回复菜单的失败记录保留。日记分类测试首轮错误选择器亦保留，并按实际控件语义接续同一条记录。稳定 sheet 截图取动画完成后帧，过渡帧不作为最终效果。

## 数据保护

首次0.3升级前完整备份 `var/android-backups/2026-10-17T22-49-32-471Z-before-frontend-polish/app-private.tar`，SHA-256 `75319016d39b797d6ded563831f04c44e41f5b8ffd0ed5dc3d35036b4e75d1bd`；安装后启动前211个原私有文件精确一致。

QA结束核对旧IDB六个会话消息冷启后hash一致；原SQLite7篇/5room/15message/2asset/3category/2meta每行保持，只有3篇明确合成日记新增；原2份媒体逐字节一致，未删除合成记录。最终仅文案包安装前再完整备份 `var/android-backups/2026-10-17T23-00-39-before-final-copy/app-private.tar`，SHA-256 `b92d6b77d496f59cbda278033f2bbb6820ccd95940b2dded74e62129f4763d07`；安装后启动前210个原私有文件全部保持。未卸载/清库，原置顶 `[-10]` 保持。旧版 origin 损坏取证与恢复保留[前轮记录](2026-10-17-android-input-refinement.md)，不归因于本次样式。

## 检查与边界

长文31项既有回归＋23项外观检查、聊天22项 headless 断言、原生Java与实际注入JS语法检查通过。最终 `npm run check` 的323模块检查与ESLint通过，在并行文件 `previews/telegram-chat/shiye-revisit.js`、`tools/verify-revisit-ui.mjs` 的格式告警处停止；没有代改或宣称完整check通过，回执 `project-check-final.log`。本轮独立 `npm test` 为671项，670通过/1桌面跳过/0失败，见 `project-test.log`。Android文件与本轮文档定向格式通过；F盘规范目录21主题校验通过。所有项目测试显式 `SHIYE_TEST_NO_DESKTOP=1 / SHIYE_TEST_CONCURRENCY=2`，不启动桌面窗口。

本轮不把 CDP 合成中文输入等同输入法组合/候选确认。手机基本中文仅用户先前在0.2.0确认，0.3.0 MagicOS表现、旋转、长期后台/性能、图片完整发送和跨端同步仍需后续验收。当前APK是可试用前端，不声明全格式迁移或联网完成。

成品/截图/公开回执：`outputs/2026-10-17-android-frontend-polish/`；临时脚本/打包资产：`tmp/android-frontend-polish/`，APK编译沿用 `tmp/android-dual-prototype/app-build/`；私有备份：`var/android-backups/`。未整理或删除用户其他目录。

## 后续手机推送

用户随后明确授权推送到Magic7，0.3.0/code5已覆盖安装并启动，204原私有文件安装前后hash一致；完整备份和边界见[手机安装](2026-10-17-android-magic7-install.md)。上文“手机未操作”是电脑样式交付时快照，本次安装不扩大32项AVD验收为真机全验。
