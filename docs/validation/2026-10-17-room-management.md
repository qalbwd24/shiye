# 2026-10-17 随想会话管理验收

ui25已正常保存、标准备份、升级并启动。主会话完成构建、实际浏览器定向验收和最终截图复核，基底为ui24，保留其朝花夕拾自动续推帮助和固定桥能力；本轮没有部署并行后端候选或重启API。

正式运行回执：`upgrade.json` 的installed/restarted均为true，版本 `20261017-ui25`；备份 `2026-10-18T02-43-55-251Z-333cda82`。`status.json` 原生回执 `2026-10-18T02:45:11.1055181Z` 为ready/ui25，聊天PID59908／托盘19468仅此刻快照，后续操作重新status。12219安装文件SHA于02:45:18Z全部通过。`runtime-after` 回读116%字号、868×1649窗口、2屏档案保持；API仍0.9.24、health保留runnerControl=1／autoStart=true。

正式日记的 `diaryHashUnchanged=false`，后台及用户仍可正常写入；本轮没有日记迁移或直接编辑正式库，不宣称整库hash保持，也未额外展开全库数据审核。此事实不影响上面的程序安装hash核验，两者分开记录。

已完成：8个源码文件的最小实现；其中6个TS/TSX文件定向ESLint通过，`shiye-room-workspace.js` 的 `node --check` 通过。没有运行全库或无关功能矩阵。

实际浏览器证据累计20项，分三个包阶段记录，不能称最终包完整重跑20项：

| 证据文件 | 数量 | 包与范围 |
| --- | --- | --- |
| `browser-validation.json` | 15 | 初包manifest `f62637430b4ce8f7087b4dda96db92d90c9047954a34c6acd37c284deffd656f`，既有房间读回、新增持久会话及发送、置顶顺序、当前草稿归档／恢复／重开、已发消息保留、真实待发附件保护、系统房保护、并发发送、取消置顶、深浅背景及右键管理 |
| `final-targeted-validation.json` | 3 | 第二包manifest `afba9dcaf0563d53265e10263adc376d2193cc56d57712e0dcb06032b2381875`，浅色管理页选中tab对比8.93、禁用按钮样式、置顶与发送并发后重开精确保留1条消息 |
| `accessible-validation.json` | 2 | 最终包manifest `b3763dd1e9c79e4a4d9592741acee49f6e1760c5cbc449e97884f5ff756627d5`，置顶选中行暗色白字对比9.77、浅色白字对比7.00 |

最后静态包仅调整 `paintRoomState` 的selected背景及相应主题变量；worker、朝花夕拾资产和原生EXE未随此样式修订变化。EXE与ui24精确相同，旧10项图片查看器证据仅复用，不称本轮重测。主会话已实际复核最终浅色管理页及侧栏选中行截图。

准备／验证失败回执全部保留：冻结时dependency过滤遗漏dist，恢复实体依赖后重新构建；`selectDraft` 导入错误修为 `selectors/threads`；首轮浏览器等待切房不足，第二次错误检查已隐藏outer modal而实际inner仍可见；后续targeted脚本曾搜索早于worker ready、异步管理页fixture等待不足；最终可读性脚本首轮正则转义错误。对应修复后的定向回执通过。这些准备和脚本问题不冒称产品新功能回归，也没有据此扩大全套测试。

未单独重跑原生实机点击会话管理、中文IME、物理多屏或长期CPU／内存。搜索归档提示、空态最后房归档、编辑中阻止等路径以实现审阅记录，不扩写成上述15项实际操作。存储异常行为仅审阅复制保存及失败不替换内存的代码边界，没有故障注入验证，不能列为实际已通过场景。

持久化使用写版本重放：每次 `saveLocalPreview` 同步递增revision；状态写入等待期间若出现其他保存，则从当前最新库重新复制并应用状态。仅无新写的保存完成后替换内存并ACK，不以旧clone覆盖并发消息。草稿保存可定位已归档dialog，发送接口拒绝写入归档房间。

产物目录：`outputs/2026-10-17-room-management`。临时目录：`tmp/room-management`。最终候选为 `candidate-ui25-accessible`，交付清单 `delivery-manifest-ui25.json`；正式安装及运行状态以本页上方升级后回执为准。
