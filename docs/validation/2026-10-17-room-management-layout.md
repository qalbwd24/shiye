# 2026-10-17 会话管理入口重排

ui26已完成针对性验收，并正常保存、标准备份、升级及启动。用户要求把管理放入设置，与会话排列一起，并在每个会话自身设置管理状态。本次只改 `shiye-preview.js`、`shiye-room-workspace.js`、`shiye-preview.css`；不改TS、worker、API，不重启或打包并行后端服务。

正式回执：upgrade的installed/restarted均true，版本 `20261017-ui26`；备份 `2026-10-18T02-54-45-196Z-a8cf651f`。status原生ready/ui26回执 `2026-10-18T02:56:13.0094590Z`，聊天PID53488／托盘38112仅当时快照。12219安装文件SHA于 `02:56:22.270Z` 通过；116%字号、868×1649窗口及2屏档案保持。API仍0.9.24，保留revisit runnerControl=1／autoStart=true及conversationServices=1能力，本轮未重启API。正式日记 `diaryHashUnchanged=false`，不额外归因，不宣称整库hash保持，也未为本轮小改追加全库审核。

候选已删除侧栏第二排toolbar及对应注入逻辑，旧＋新建恢复；设置root进入“会话管理与排列”原navigation页。紧凑列表与默认折叠手工排序减少重复；右键、齿轮及名字进入按会话ID缓存的自身设置。缓存表单从不同入口重开时更新真实父路由；不修改未保存字段。自身置顶／归档／恢复继续调用ui25已验的状态命令及草稿／附件／系统房保护。

两个JS文件 `node --check` 通过，三个修改文件格式已处理；未运行Vite、TS、全库或原生全套。主会话实际检查分两阶段累计13项，首报告整体失败如实保留：

| 证据 | 结果与范围 |
| --- | --- |
| `browser-validation.json`，manifest `bc305cebb590ae586f42312d00128864f6f76504a5a4eeee938d152ba9cb8e3f` | 10项已通过：侧栏无第二排、旧＋可见、统一管理入口、手工排序默认折叠、自身设置无全局选择器、状态更新保留未提交字段、缓存表单保留编辑、从当前父页返回、右键自身设置及未保存标题不误写、单会话归档恢复。随后旧＋真正新建暴露回归，报告 `passed=false`，不能将首报告整体记为通过。 |
| `create-validation.json`，最终manifest `12566c7819d95036eb00b22dc57b421dd5fb43302358f8707938b0c35358fcd2` | 3项通过：旧＋打开完整初始化新建表单、真正保存新会话、统一管理中新建保存后回父页并刷新列表。 |

真实回归原因：隐藏自身设置选择器的分支误用 `if(current)`；新建也可能有current，但没有id字段，异常中断后续表单绑定。已精确改为 `if(!isNew && current)`，最终相较初包只补此guard，未重复前10项；原失败回执保留。主会话已复核统一管理与自身状态截图。分阶段范围由 `source-scope`、`create-fix-scope`、`delivery-manifest-ui26` 记录。

ui25原存储／媒体／草稿及系统房保护按未变worker和相关资产证据复用，不冒称本轮重测。原生实机点击、IME、存储故障、长期性能均未重新验证；本次没有扩大这些边界。

最终候选 `candidate-ui26-final`，12219个程序文件，正式运行与安装hash见上方回执。产物 `outputs/2026-10-17-room-management-layout`；临时 `tmp/room-management-layout`。
