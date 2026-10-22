# 0.9.24 正文缩进与直接插图验收

用户要求：Tab缩进或段首空格缩进；图片不要每次确认，插入后编辑信息。实现选择为Tab两格中文空白，空格保持原样，不把Space强制扩写。

## 实现与兼容

- 新richdoc正文Tab插入两格；Shift+Tab减少段首一档（两中文空格/最多4ASCII空格/一个Tab），选中多段批量操作，包含Ctrl+A。以独立事务撤销，不替换选中文本，保留原格式。对全选后导航显式同步文本选区和Ctrl+Home/End，避免继续输入覆盖正文。
- 旧HTML普通段落支持Tab及段首空白区Shift+Tab，原生undo；Markdown支持单点及多行Tab/Shift+Tab，代码/列表单点使用ASCII两空格。rich列表/表格/代码保留原有键位；设置/弹窗Tab焦点、IME候选键不抢占。未声明聊天输入框Tab已改动。
- 日记纯图片批次直接经原队列处理，保留现有本机清晰度偏好和目标篇/映射光标/独立插入时间，0字节仍拒绝。视频/其他文件/混合批次、评论和收藏保留确认，不修改他们的交互。
- 图片NodeView悬停/选中/键盘聚焦显示“编辑信息”，复用按occurrenceId的排版事务。图注/alt纯文本、宽度10–100%、左右居中；不修改assetId/occurrenceId/insertedAt，也不把按钮写入HTML投影或导出。排版编辑无法恢复此前压缩丢弃的原图字节，当前没有新增重压缩界面。
- 不迁移旧日记、不重写冻结实验包、不改chat ui8。

## 已验证

- 合成真实编辑器事务：Tab/Shift+Tab、选中多段/全选、撤销、样式保留、自动缩进关闭仍可手动Tab、IME/key229/CtrlTab/只读保护；图片编辑按钮接通原有排版测试。
- Chrome独立随机端口/合成数据：真实键盘Tab/ShiftTab/多段、手动ASCII段首空格、Alt+T、分割线；paste/fileinput/drop三路图片均无确认框，三次出现有独立ID；图注/宽度/对齐保存并重开一致；旧源不变；旧HTML和Markdown编辑及undo通过。pageerror为0。browser.json与browser-log.txt。
- 独立Windows WebView快捷窗：定位正文后实际Tab，API回读两格中文缩进；Shift+Tab后API回读缩进移除。native-tab.json/native-shift-tab.json。输入内容仅在tmp的合成库。未重新做物理输入法候选/原生剪贴板全流程，不把浏览器DataTransfer测试说成真实OS剪贴板测试。
- 完整 `npm run check` 482/482通过（模块/ESLint/Prettier/测试），check.txt；F盘主题目录校验20/20通过。

## 正式/开发运行已切换

2026-10-16 当前已正式/开发启用0.9.24：Tab/Shift+Tab正文缩进、纯图片免确认和图片旁编辑信息已接通。482项完整检查、Chrome独立库三条插图/保存重开/新旧编辑、多段及Ctrl+A后导航通过；原生独立快捷窗Tab/Shift+Tab已回读。API PID67788、托盘PID73424、chat PID75060，聊天保持ui8 ready:true。正常保存退出/快照重启后正式日记SHA相同，未改旧库或转换候选。证据 outputs/editor-indent-images，临时 tmp/editor-indent-images，快照 D:\拾页\var\upgrades\editor-indent-images-0.9.24-20261016-110303。

正式health、开发health与package.json均0.9.24。维护CLI正常保存退出成功，API进程经归属核验后独立重启；聊天ui8、108%字号与两屏档案保留。独立测试进程/随机端口已退出，新正式快捷窗已再次唤起。activation.json、stop.json、start.json、final-status.json、dev-health.json记录运行证据。

## 文件位置

证据outputs/editor-indent-images；脚本/合成库tmp/editor-indent-images。升级快照另存var/upgrades，旧数据仍在原F盘位置。
