# 2026-10-19 更低输入栏与即时发送过渡

2026-10-19 随想ui37已正常保存/备份/标准升级启动（2026-10-19T07:23:54.4781936Z，PID58012仅快照），API0.9.26未重启。输入手调下限48→36CSS px（小字号外壳44px），仅新低档用4px上下留白/36px按钮，旧48/64与自动高度保持；大字号一行＋8保底，降字号/重开恢复36偏好。即时正常单发/两连发与真实整数ACK基线opacity始终1、白字颜色恒定，未复现用户主观亮闪，不宣称白字原因已确定；本轮清理正常本人root在transient类缺失及live-tail挂载路径的默认淡入/缩放/动画，排除删除/选择。14项定向UI通过，11915安装SHA和772×1550/116%/2屏保持；native15＋看图1仅按未改EXE复用，不跑全套。未改journal/worker/存储/API；不将此UI补丁写成内存问题结案。产物outputs/2026-10-19-chat-instant-flash、临时tmp/chat-instant-flash。

## 真实定位与边界

用户已自行选择即时出现，当前偏好/白字配色均保留。ui36基线实际浏览器单发和快速两连发，均取得真实worker ACK整数ID，首条确认确有root更换；正常帧每层opacity为1，文字rgb(227,236,238)恒定，未复现亮度跳变。不能写成白色文字引起错觉，也不能声称本轮已根治用户闪感。

已发现代码风险：旧instant CSS只覆盖is-just-added，确认后的root不一定带该短暂类，vendor默认Message:not(.open)会opacity0/scale.8，live-tail后代.message-list-item有0.2s translateY挂载动画。本人Message根本身也带message-list-item，本轮仅instant正常本人root及直接wrapper强制完整opacity、无transform/transition/animation；排除is-deleting、is-selected及select-mode-active子树，保留选择/删除语义及其他消息路径。额外fixture以实际本人row所在父层加live-tail，并确认vendor selector确实匹配，再逐层检查没有残余mount动画。没有人为给即时模式加新淡入、改白字颜色或关闭媒体动画。

新手调requested36，实际floor=max(36,ceil(lineHeight+8))，仅manual<48且compact时CSS同源min36、垂直padding4、按钮36；16px输入行高26.4时真实scroller36/外壳44，32px字号实际61/外壳69，不裁字、不将requested覆盖成61。降回16恢复36，localStorage读回范围同步36，重开仍保持；旧48/64与auto不改。smooth仅Y轴代码保持原样。

## 定向证据

instant-baseline.json与instant-validation.json均绑定ui36冻结资产＋本轮JS/CSS，14项涵盖旧48/64、新36/44、大小字号、降字号、即时首帧/ACK/颜色、真实ACK身份、唯一可见root、旧root保持、发送高度与重开持久、缺transient类和live-tail语义边界。最终source SHA JS032033d4bc8754c3dade1c599d939b360a287e3c5421e16e26f8e385db52f3cd；CSS9e785caefa803a602deb10203c2383b7b71aa9c16fa66464264910c46f8f5a72。语法/两文件格式通过。截图compact36-instant-final.png已查看。

首次attempt1是测试期望错误：ArrowDown每次24px，64→40符合操作，不能当作直接测试旧48；改为明确写48并重开后通过，保留原attempt。没有跑ui36整套17项、全库、Android或原生全矩阵；ui35原生15/独立看图1仅按相同EXE和独立viewer资源复用，不计本轮执行。

候选从ui36冻结，仅5路径变化：shiye-chat-ui.js、shiye-preview.css、preview修订、index精确cache、UPSTREAM。原生故障恢复、journal门控、worker和API字节保持。11915安装SHA一致；标准维护正常保存ACK/备份/升级重开，窗口全字段等于最新正常保存退出快照，116%及2显示档案保持；原profile继续使用，未迁移、直接写正式JSON或重启API。备份D:\拾页\outputs\desktop-maintenance\backups\2026-10-19T07-21-05-348Z-9e16920d。运行20261019-ui37，health0.9.26。

### 安装校验复用

本轮不再额外读完整11915个文件做第四遍内容hash：标准维护apply本身已逐个核现有目标SHA，复制后再核新目标SHA。根核对complete操作及密封release manifest与候选manifest全部11915项相同，随后只重读5个变化路径＋原生EXE/journal两边界；证据installed-verification.json绑定实际installer源码SHA和release manifest SHA。程序安装校验完整保留，避免重复读取同一套未改资产。正式API PID86988/创建时间06:59:43Z保持，确未重启。

## 内存解释

本轮只读单点memory-current.json：聊天树1263MiB、共用API1857MiB、托盘30MiB，合计约3151MiB/3.08GiB私有提交，非固定4GiB。它是已提交的私有内存额度，不等于全部固定驻留物理RAM；共享工作集不应直接相加。对常驻随记用途仍偏重，冷解析可能超过4GiB总量。此前全机commit94–97%，已实际发生renderer OOM，需要继续降低峰值与长期占用；未证持续泄漏。本轮UI没有新做内存基准，旧冷/热/GC回落不能当补丁节省量。后续技术计划仍见PROJECT-PERFORMANCE-PLAN及ui36验收。

产物D:/拾页/outputs/2026-10-19-chat-instant-flash；临时D:/拾页/tmp/chat-instant-flash。候选proof的deployed:false是发布前证据，实际运行以deployment-complete.json为准。
