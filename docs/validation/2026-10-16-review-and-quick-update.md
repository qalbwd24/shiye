# 二次复核与快捷窗0.9.21更新

2026-10-16，用户要求单独处理待复核项并更新快捷窗口，继续禁止覆写旧库。源码/常规正式运行根目录 D:\拾页；正式数据/profile仍在既有部署配置位置。

## 29条二次处理

新增 tools/legacy-conversion-review.mjs，仅向新目录 var/migration-lab/review-20261016-a/ 写不可覆盖包；第一轮 full-20261016-a 的源快照、manifest和3015个候选保留。二次每包记录原警告、接受依据、剩余项、第一轮hash、原对象及原body；不通过改变正文或删附件让检查变绿。

- 10条 resolved-preserved：保留作者倒序时间；补缺右括号/中文时分秒的索引识别；仅时分优先明确日期上下文，无明确日期时用篇目民用日并注明推导来源，不猜跨天。
- 3个编辑时间歧义包含在上述10条内：2条正文与唯一历史完全相同且历史时刻吻合原安卓更新时间，采用 history-matched-content-clock；1条有后续真实改写/恢复历史，采用当前更新时间作fallback。证据哈希与revision留在私有包，不把属性更新误当正文时间。
- 19条 compatible-fallback：18篇保留音视频附件原序播放器/下载入口，1篇保留原HTML的2组details/summary及代码。没有声称richdoc v1原生支持全部附件/折叠结构。
- remainingWarnings为空；原警告与处理决定仍留档。22/22音视频资源本地Range GET与MIME核对通过，不等于逐个完整播放/全字节哈希。

独立复核：第一轮3015/3015包完整性通过，29原对象、原body、原图插入时间及已知完整锚点保留。第一轮manifest/源快照原字节hash一致，正式GET3015整库hash仍相等。匿名证据 outputs/legacy-conversion-review/review-20261016-a/{report,independent-recheck}.json。

私有离线页 var/migration-lab/review-20261016-a/comparison-offline.html 已用Chrome打开验证：29记录、22个音视频controls、无脚本/可编辑正文/危险嵌入。图片和音视频引用本机原资源；不是完整便携媒体备份。页面及截图均留在私有var目录，不放匿名报告区。

## 快捷窗更新

新篇默认图文格式的决定在main启动读取服务端health能力后执行，不再要求18766手工参数；`?quick=1&richdoc=0`可临时使用原新建路径。旧HTML/Markdown篇和非空旧模板继续原路径，不批量切换旧篇。主窗口可打开同一新body。

统一“设置”新增图片排版/插入已有图片，沿用原紧凑顶栏。可修改选中图片出现的10–100%宽度、左中右对齐、图注与alt，原文件、assetId、occurrenceId、insertedAt保留。同文件可在文中多次出现；新增出现保留独立时间。修复选中原图再插图会替换原图、以及旧设置模态close事件提前释放新插图位置的问题。

服务端增加上线保护：聊天归篇正文/格式/附件只读，分类标签仍可改；首次属性保存缺contentEditedAt时冻结保存前的有效updatedAt，明确null保留。备份链式ID映射后再生成HTML，避免正文与投影引用不同。旧安卓协议不能无损携带richdoc，push/both明确409阻止有损上传，pull-only正常；不擅自更换同步协议。

## 检查与运行

- 完整npm run check通过436/436，无失败/跳过，含文件引用/ESLint/Prettier；outputs/quick-richdoc-update/check.txt。
- Chrome真实引擎＋虚构隔离库：无额外richdoc参数的新建、分类方向键、懒创建、中文空格、时间快捷键、换行/分割线、双图粘贴Enter、原件字节哈希、图片40%靠左/图注、已有附件第三次插入、独立图片查看、重开保真、旧篇不变；production请求0。证据browser.json、quick-richdoc.png；先前失败截图保留为修复过程，不代表最终结果。
- 正常保存退出统一托盘/聊天后，封存日记及窗口偏好到 var/upgrades/quick-richdoc-0.9.21-20261016-093526/，核对进程归属、空闲文件及SHA后更新API。health确认0.9.21与package.json一致且支持richdoc；日记文件升级前后SHA相同。标准CLI恢复托盘/聊天并重新打开普通快捷窗，聊天仍ui7，未替换其程序/样式。
- 正式18765只读浏览器验收普通`?quick=1`：选择分类即挂载Tiptap，空白不创建篇目，非GET请求0；正式库3015整体hash与原快照一致。证据production-browser.json、activation.json、stop.json、start.json。
- 开发18766也备份后更新0.9.21，开发快照 var/dev-upgrades/richdoc-20261016-093638/。临时脚本与虚构库在 tmp/quick-richdoc-update/。

真实物理中文候选输入、多屏/原生窗口尺寸与字号、热键长时唤回仍需用户实际试用；已有原生宿主回归通过不代替这些硬件体验。二次候选没有导入或替换正式旧篇，朝花夕拾/聊天双向新格式仍是后续阶段。
