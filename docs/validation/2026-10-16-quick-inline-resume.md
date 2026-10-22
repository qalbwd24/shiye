# 0.9.22 正文插图与最近编辑篇恢复

日期：2026-10-16。源码/运行根目录 D:/拾页。正式和开发 API 均已运行0.9.22，聊天保留20261016-ui8。

## 需求与实现

用户确认问题发生在“新一篇”，本轮不将问题归因为误开旧篇。修复图文图片在正文与底部附件同时显示的问题，并补齐非空分类模板新篇误退回Markdown的代码路径；模板在本轮实际正式库中为空，因此不将模板认定为用户本次问题的唯一原因。

- 粘贴、文件选择、拖入统一保留光标插图链路。gallery仅隐藏已出现在body中的图片卡片，不删除attachments关联或媒体文件；剩余附件排序合并原引用，正文移除/撤销后刷新面板。
- 分类模板只用于新篇，惯性HTML解析、白名单映射、真实schema和字段保真检查；外链/未登记图片及未知结构明确失败，原模板/旧篇不修改。模板本地图片登记到新篇attachments。
- 顶栏“新一篇、最新篇、上一篇、下一篇、主页面打开、设置”。最近篇由成功编辑保存的quick-history决定，只查看不更新。保存失败不导航，待保存草稿不覆盖。
- 只有close-ready/backgrounded之后的focus-editor恢复MRU；普通窗口聚焦不切篇。按entryId记光标/选区/滚动，跨richdoc、旧HTML和Markdown重挂载恢复；图片上传token仍保留原Set身份验证。
- 首次/超过后台留存时限重建仍选择新篇分类，默认5小时规则不变；设置显示正文模式及版本。

## 验证

- npm run check：453/453通过；模块检查235个、ESLint、Prettier通过。日志 outputs/quick-inline-fix/check.txt。
- Chrome真实页面、独立虚构库 tmp/quick-inline-fix/data-*，所有请求重定向到隔离临时服务，未向正式库发写请求。验证分类↑↓/Enter、标题转正文、中文空格、Alt+T、分割线/换行、串行保存；粘贴双图、文件选择、外部drop均正文插入且无底部重复卡片，文字前后保留、原字节SHA一致；独立occurrence/time、图片排版/大图、重开body不变、旧篇不变。
- 同一真实浏览器和rich控件配模拟WebView host：保存第二篇→只看上一篇→普通focus不跳→关闭握手/后台/唤回回第二篇并恢复原光标→最新篇按钮同结果。浏览器模拟消息不是原生热键验收。结果 browser.json、虚构图 quick-richdoc.png 位于 outputs/quick-inline-fix。
- 正式只读Chrome：普通/?quick=1新建图文、四个导航按钮顺序、设置模式/0.9.22回读；阻止所有非GET/HEAD请求，实际0个写请求；前后完整library哈希一致。production-browser.json。
- 用户明确交机后，在随机52720端口创建新的虚构data和profile，使用实际D盘快捷EXE、真实Windows操作验收；未使用bridge-test隐藏控件。测试内容仅2篇，落tmp/quick-inline-fix/native-1792169955311/data，窗口状态独立，正式库0个测试写入。
- 原生已通过：分类↑↓/Enter、选中标题后Enter入正文、中文和空格、Alt+T北京时间、分割线正常且无heading放大；系统文件选择器→生成图片→预览Enter确认→body image/插入时间/附件引用及原字节SHA；实际正文双击大图及只图片放大120%、窗口ZoomFactor保持1。
- 原生后台与光标：编辑乙篇→只看甲篇→Alt+F4正常保存退后台→普通EXE入口恢复乙篇；在恢复光标插入标记，落在原来“结|束”的中间。再次上一篇→最新篇回乙篇，编辑MRU仍为乙。Ctrl+plus保存1.04；正常退出隔离进程并重开，设置实际显示104%，正文保留。
- 本机当前输入法真实按n、i出现中文候选，空格提交“你”，API确认无ni半成品。手动英文后每次唤回强制中文、其他输入法组合尚未完整验证；不把Unicode文本注入单独当IME通过。五小时实际等待、原生F14/F15、原生Ctrl+V/drop未做；后两媒体入口有真实Chrome隔离覆盖。
- 证据 outputs/quick-inline-fix/native.json、native-restart.json；测试进程已正常保存退出，临时随机服务已停止，formal托盘/聊天仍原进程ui8。未额外保存桌面截图或私人日记正文。

## 运行与数据保护

标准desktop-control正常保存退出→新鲜快照→核对稳定→重启已核对的D盘API→health版本→diary字节SHA前后一致→恢复托盘与ui8。正式API PID47056；托盘59404、聊天60688回执ready:true、ui8、当前屏108%及2屏档案保留。正式旧数据不迁移，旧转换第一轮/第二轮不覆写。

私有快照 var/upgrades/quick-inline-0.9.22-20261016-095525；开发快照 var/dev-upgrades/richdoc-20261016-095549，开发diary与快照SHA一致。正式数据及profile仍在部署配置指定F盘原位；不使用迁移初始快照与当前库比较，因为用户期间的正常编辑必须保留。

公开证据 outputs/quick-inline-fix/{activation,stop,start,production-browser,browser,native,native-restart,final-status}.json 与 check.txt；临时执行脚本 tmp/quick-inline-fix，开发重启复用tmp/quick-richdoc-ui/restart-dev.ps1。没有直接修改运行diary.json。
