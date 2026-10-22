# 子项目5：随想接入

状态：第五步传输核心已分离，并完成18条纯后台接入链路；尚未在正式随想启用。现有UI包装层已委托新客户端；随后独立原生窗口已实际验证来信图文、评论写库和只读原文/本篇评论，其余图形流程仍待验。日常ui20未更新。

负责收件传输、本地缓存/回执、群聊展示、评论目标提示与切换、只读来源查看。规则判断由引擎/服务完成；前端不按自己的计时器另算“哪一篇该出现”。回看接收器不负责启动推送程序。

代码边界：

- `previews/telegram-chat/shiye-revisit-client.js`：无DOM客户端，通过注入的api、command、readLibrary端口执行接收、媒体分段校验、评论outbox及目标状态；不启动定时器或运行器。
- `shiye-revisit.js/css`：现有DOM包装、目标提示、设置、只读查看及15秒轮询；不重新实现收件/发送逻辑。图文接收、一次评论与原文查看已隔离验收；其余交互继续由UI会话负责。
- vendor的`shiyeProgram.ts`、`shiyeLocal.ts`：真实群聊来信与IDB提交；program-clear清理派生源缓存，保留评论/待发操作。目标及回执先提交再替换内存，失败可重试。
- `shiye-journal.js`与`ChatJournalBridge.cs`：固定动作白名单，增加context，不开放任意HTTP/文件访问；JS保留HTTP状态码以识别锁定。独立测试桥已编译并实际执行status/feed/context/comment/source/media；完整撤回/锁定原生流程与正式宿主部署仍待验。

为重新校验已隐藏/撤回来源，每轮仍从feed第0页读取；本地按deliveryId去重。已校验分页前进、结束与媒体偏移/长度；本地持久化回执成功后才前进。评论先处理撤回，再重新读取待发内容，保留稳定operationId。后台提交成功但响应丢失时用同ID重试；409冲突不吞掉/不误确认。

目标选择先调用context，持久化后生效；新推送不得抢占正在输入或手选的目标，重建客户端保留既有目标。实际输入法与组合输入状态仍需界面验收，后台测试仅注入“正在输入”信号。媒体精确评论已有后端能力，但专门按钮/输入尚未在此阶段完成。

测试入口：`node tools/revisit-integration-lab.mjs`。只创建tmp/revisit-decoupling/stage5随机合成库、临时回环端口和私有fake-indexeddb；不能传入正式URL/dataDir。实际运行后端、JS日记桥、固定C#路由镜像、本地worker/写库代码，Telegram构造器为惰性替身；不声称原生宿主或真实浏览器IDB已验收。结束关闭服务，报告在outputs/revisit-decoupling/stage5/integration.json。

余下工作：评论交互/设置与只读查看进一步拆分及图形验收、媒体评论按钮、原生只读窗口；第六步运行器认证/生命周期单独推进。保持现有UI、输入法、字体/窗口记忆和快捷键，不新增默认快捷键。

完成标准：数据接口重试不重复来信；新推送不抢走草稿评论目标；权限失效清除源缓存；程序来信和评论不再被普通归篇上传。头像渲染/媒体评论按钮/原生只读思绪以后分项接入。

本轮详情见[后台接入验收](../validation/2026-10-17-revisit-stage5-background-integration.md)。本轮仅候选源码和后台模拟；遵循用户约束，不执行常规正式升级。

2026-10-17 用户明确前后端分工，独立测试窗口已打开；实际接收图片、评论回写、只读原文及本篇评论已联调，其他图形流程仍待验。UI布局由UI会话继续，数据会话维护后端/共享接入契约，不另做UI分叉。见[协作契约](FRONTEND-BACKEND-CONTRACT.md)和[本轮验收](../validation/2026-10-17-revisit-ui-preview.md)。
