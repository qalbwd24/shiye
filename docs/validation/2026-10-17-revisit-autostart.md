# 朝花夕拾随后台自动续推验收

2026-10-17用户明确要求随拾页后台自动启动、退托盘继续、保留进度。本轮已完成并正式更新；同轮新增“会话设置选择后端、多个会话各自规则、未来程序与AI统一入口”是独立的下一阶段，见[会话接入契约](../CONVERSATION-BACKEND-CONTRACT.md)，尚未实现多实例绑定。

## 实现与定向测试

正式server.mjs启用revisitAutoStart，监听后恢复已启用规则；后台宿主复用既有启动单飞/取消，不另建窗口定时器。正常解锁后自动恢复，访问锁不被绕过。显式stop暂停本次后台，后续查询不重启；下次后台启动重新跟随已启用规则，持续关闭使用启用开关。没有新增落盘字段、密码持久化、Windows开机项或独立常驻程序。

tests/revisit-autostart.test.mjs新增4项真实HTTP/进程场景，连同原21项runner测试共25项通过。覆盖无窗口自动启动、停机追赶一次、同一日期/游标/评论保持、后台重开不重复、未启用不启动、启用配置自动运行、手动暂停不被查询撤销、访问锁与正常解锁、真正server.mjs入口。定向ESLint、Prettier通过，未跑无关全量检查。

ui24在冻结ui23上仅改自动续推提示、运行修订、对应缓存query和UPSTREAM元数据。12219文件清单只有这四处delta，原EXE、worker、布局/动效/图片资源不变，复用ui23的13项原生与10项图片证据，未声称重跑UI矩阵。首次封包因源文件和发布包的import缓存query不同而校验失败，保留初始候选；只归一化这两条query后验证精确文案差异，最终candidate-ui24-final通过，不混入其他UI源码。

## 正式更新与进度

标准维护upgrade --no-start完成正常保存、备份与安装ui24；备份`outputs/desktop-maintenance/backups/2026-10-18T02-22-18-299Z-a7f9d727`。停止旧受管运行器后，私有diary与顶层JSON快照位于`F:/<正式目录>/var/upgrades/revisit-autostart-2026-10-18T02-23-27-102Z`，校验稳定后核对路径/PID退出旧API并启动新版。

新API PID55992为02:23:40Z快照，0.9.24 health.revisit.autoStart=true。没有调用正式runner/start；随想未运行时02:23:48Z已自动running/waiting且检查成功。当前日期仍2025-07-20，原rule/config/抽选未变化；02:24:42Z游标从02:22:59.999Z推进至02:23:59.999Z，lastError=null、失败0。既有投递/评论保留且投递ID唯一，当前正式投递0；实际有历史消息的重启去重/追赶由合成库验证，没有向私人历史消息发送测试评论。

恢复窗口前全部3024源Entry/media/messageStore/chatJournal/分类哈希保持；恢复后3014篇旧长文仍逐篇相同。标准start回执ui24 ready，聊天PID65568/托盘40860为快照，116%/两屏档案保持；12219安装文件逐个SHA通过。源码与运行版区分清楚，后台确已加载自动启动能力。

产物`outputs/revisit-autostart`（tests.log、upgrade.json、before/after、automatic-without-window.json、receipt.json及完整程序清单），临时脚本/隔离样本`tmp/revisit-autostart`。没有操作正式窗口的输入/退出按钮；无窗口时后台已自动运行证明生命周期独立，退托盘的既有窗口行为/EXE按未改证据复用。实际电脑重启、长期睡眠与系统开机项未实测；真正服务入口的独立进程重启及正式API重启已测。
