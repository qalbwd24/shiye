# 0.9.23：文中媒体、旧篇新渲染和剪贴板

用户最新范围：适配新正文结构，直接插图片/视频，旧篇也能新格式渲染；保持原始旧库与快捷输入习惯。代码/正式根D:/拾页，原F盘data/profile保持原位。

## 已实现

- richdoc v1新增video，本地资源解析，controls/preload=metadata，禁任意外链和autoplay。资源文件与出现位置、时间和宽度/对齐/图注分开；image API继续兼容，generic媒体索引接server、派生、备份/恢复及开放数据。
- GET /api/entries/:id/reading-document只读取实时entry/media，返回body/完整安全html/source版本指纹及实时属性。旧附件按原序前置，未知旧插入时间null；details/未支持结构用兼容区域，不保存部分树。运行时converter独立内聚fork，原冻结工具和3015/29包未改写。
- 同一快捷窗/主窗默认只读图文查看旧篇，提示“原始日记保留”；可点“继续编辑原文”回原格式，仍可编辑旧篇。新视图不参加commit，晚响应/旧revision不能覆盖当前篇，媒体不在底部重复。
- clipboard-files同步开始File.arrayBuffer固化字节，FileList空图可取items有效File，只有可信单图paste才允许尝试navigator.clipboard.read，拒绝时明确报错。文本粘贴不读系统剪贴板，空文件不会进入预览或网络。异步前固定原篇/书签，准备阶段不能被关闭/导航越过。

## 证据

- npm run check 478/478、模块245、ESLint/Prettier通过，日志outputs/clipboard-paste-fix/check.txt。
- 定向server/归档43项与editor/媒体57项通过，包括原字节SHA、多出现身份/排版、两个备份恢复路径、旧客户端409、video-only保存、IME/书签原回归。
- Chrome真实页面直接连隔离随机服务：图片paste/file/drop、时间键/分割线/原字节、视频生成H264 MP4→确认→文中插入→实际play/seek→重开一致；旧篇新视图→继续原文编辑且原对象不变，MRU/光标回归通过。browser.json及纯虚构截图quick-richdoc.png。首次测试因Playwright代理重写POST文件体为空而失败，改为直连同一隔离服务通过；未因此修改生产上传传输协议。
- 原生0.9.23独立data/profile：真实Ctrl+V读到当前358KB剪贴板图，Enter后保存body image（默认压缩44364bytes）；同窗上一篇打开虚构旧篇，新图文含图/视频原生控件和继续编辑入口。旧原对象深比较一致。native.json仅匿名结果，没有保存用户剪贴板截图到公共outputs。
- 原0.9.22正式窗口0KB/破图已由UIA观察；为正常保存更新，取消了无效粘贴。当前剪贴板复测非0KB，未重现具体源程序/过期条件；恢复/拒绝分支由回归测试验证，不能声称真实空剪贴板已自动恢复成功。
- 当前正式3018条只读/纯内存审计：3011规范、7安全兼容、异常0，3052旧媒体出现（3031图/21视频）时间均null，源内存对象不变。outputs/entry-reading-document/20261016-live-read-audit.json。
- 正式浏览器只GET/HEAD：新篇图文/设置版本/导航与旧篇只读新视图，写请求0，前后完整library hash一致；production-browser.json。

## 实际更新

已通过现有desktop-control正常保存退出并重启托盘/聊天；API另核对D盘进程、稳定备份、重启。正式/开发均0.9.23，health明确inlineMedia image/video与entryReadingDocuments true；正式API PID5020，chat PID24784回执ui8 ready:true，原108%与两屏档案保留。

正式升级前后diary字节SHA相同，快照var/upgrades/rich-media-reading-0.9.23-20261016-103743；开发快照var/dev-upgrades/richdoc-20261016-103829。旧库没有全量迁移/覆写，用户期间的正常修改/新增保留，不能再与最初3015源快照强比整库hash。历史转换包依赖hash随通用video能力改变，当前不能强行resume到原批次，应保留旧包并另建新批次。

后台CLI是正常保存/备份/替换/启动，不是免重载热更新；聊天安装元数据appVersion仍ui8构建时0.9.21，日记API版本以health为准。没有重新构建或替换聊天UI。

## 产物和限制

公开证据outputs/clipboard-paste-fix、outputs/entry-reading-document；临时脚本/虚构视频tmp/clipboard-paste-fix。原生剪贴板测试库含用户当前剪贴板内容，仅保留本机tmp，不能作为提交样本。原生试验后台和随机服务器均已退出。

原生视频控件已见，实际播放/拖动在Chrome完成；所有Windows视频编解码、真实0字节源恢复、原生drop、五小时实等、全部输入法组合未验。正文audio/普通file尚保留附件/兼容区域，未冒充新增可编辑媒体节点；完整聊天双向richdoc、统一Record API与朝花夕拾仍后续阶段。
