# 随想原位编辑与原子程序设置：核心验收

2026-10-19。**随想ui48与配套chat-reedit2后端均已正式启用。** 前端正常保存、备份及标准升级启动，实际native ready回执 `2026-10-19T12:20:45.1301665Z`；116%与两屏档案保持。后台由用户指定的“检查拾页运行性能开销”会话独立发布，API0.9.27，sourceSessionCache/atomicConversationSettings/conversationMessaging均1。后续操作先重新status，不复用本文PID快照。

## 需求与范围

本人消息不限时编辑，取消不撤回；确认时原条变无正文提示，新身份的修改版紧接原位置，沿用原时间。撤回正文仅在本机无限期保留，重开可恢复，后台不保存旧正文。评论恢复保持原实例与引用，不把普通消息猜成新绑定机器人的评论。会话侧栏外部点击收起，左/右进入可设置且不截输入框方向键。

同时合入已验ui45原子程序设置：多槽位与程序/AI角色登记、CAS冲突草稿保护、保存等待worker持久路由ACK、稳定sourceId原子初始化。AI登记不代表AI执行器；普通消息仍legacy journal单写，统一消息client没有接入生产owner。

## 已完成的定向证据

- UI45实际服务界面11项、即时发送5项；17真实C#固定路由桥检查。切房查询3→2，真实wheel离底后切走再回的锚点差0。未证实首显耗时改善，不报告速度百分比。详情在 `outputs/2026-10-19-chat-atomic-services`。
- 本机恢复store6项fake-IDB持久重开/事务故障；正文懒读、启动keys-only、32条UI缓存、无TTL，不保存二进制/临时URL，不向后端传恢复正文。
- 原位编辑源码最终27项相关定向通过（15编辑/排序/分页/实际reducer提取＋6持久恢复＋6并发worker）；包含撤回前先持久恢复、单直接后继CAS、请求重试幂等、并发重放不换评论operationId、原房/原引用保护、根/直接前驱分离、同秒ACK四阶段排序、长房根组分页、达到视窗上限时的整组保留。最后cap变更的实际UI与即时ACK见下文。
- 静态侧栏8项实际隔离浏览器通过，覆盖外部点击的目标焦点、left/right/off与Enter、输入框左右键不抢及偏好持久。
- 后台不可变reedit2的12领域/真实归篇测试及6实际HTTP核心通过：原位原时、空墓碑、幂等/409、混合已归篇和未上传连续编辑、原deadline、AI登记不切owner、旧revisit保持。107模块/299相对依赖完整，来源缓存共存。该准备阶段没有写正式测试消息或切后台指针；后续正式发布另列。

## 实际发现与修复边界

初始ui45重现撤回中间消息使后续气泡迁父重挂，刷新感来自DOM分组，不是整页reload。ui46采用mock本人无头像气泡稳定平铺，邻居身份实际保持；同包仍发现同秒替代排序及编辑旧消息自动滚底，故未发布。保留 `reedit-ui-validation-first-failure.json`，不以源码测试覆盖实际失败。

后续补当前投影的rootOrderKey与替代消息跳过普通发送focus/动效，持久orderRootId和previousLocalId不混用；同时只检查>60条长房的旧位置分页/重开，避免新大ID使原位后继缺失或误判到底。

ui47实际隔离Chrome/真实worker和IndexedDB通过12项原位编辑＋5项120条长房：旧消息可编辑、取消不撤回、原时间/原位/同秒顺序、两个邻居DOM不变、中段不滚底、即时和平滑不触发输入框飞入、page reload后从本机恢复；长房root10→121保留原时间，重开around旧位置包含全组，尾页120不混进旧根121。模块重建和实际IDB读取已验，**不是正式原生窗口关闭重开生命周期重测**。`reedit-ui47-validation.json`、`reedit-ui47-long-validation.json`与前后截图；根会话已查看长房重开截图。

审查继续发现addViewportId达到上限的numeric裁剪可留下孤立高ID替代，故最终追加仅mock根组保留（非mock保持原逻辑）。ui48冻结21文件（其余3122源文件与ui45基线相同），22个主线程/worker映射命中；ui47→ui48仅reducer一源变化，12项核心按该追加不改变其路径的源码范围复用。

最终ui48长房8项与ACK5项全部通过，错误数组为空，Chrome已关闭。实际cap前121节点，发送后30节点：旧10/121整组离开视窗，120和新发送保留；重开旧页仍10占位→121改稿→11。即时发送1206逐帧样本，单发最大1气泡，同文双发最大2气泡，5次最终均整数ACK。中段编辑scrollTop与全部rAF均400→400（0px），两个邻居DOM身份保持，smooth89帧无输入框飞入。详见 `frontend-final-summary.json`、`reedit-ui48-long-validation.json`、`ack-ui48-validation.json`；交付清单 `delivery-manifest-ui48.json` 记录12176文件及25项实际UI/范围复用依据，不把这些写成新包全量/全原生通过。

## 发布和交接

用户指定前端完成后交接至 **检查拾页运行性能开销**（local `01a15386-e9c4-7d73-ac9a-72eb7b382a97`）。完成前端同包核心验收后发送具体契约、不可变reedit2候选与证据，由该会话独立审查适配部署后台；根会话协调前端标准保存/备份/安装/hash/运行回读，不并发重启API。

已实际发送上述交接，线程工具确认成功。指定后端会话独立复核72相关冻结测试＋9实际HTTP及当前真实库副本，正常保存/私有快照/选包后正式切换reedit2；3139原日记、媒体/规则/评论、整个旧chatJournal/messageStore及旧78投递身份保持，运行器继续。没有向正式库发验收消息。具体证据由[后端验收](2026-10-19-chat-reedit-backend.md)维护，不将候选6项测试冒称全部部署证据。

根会话在其明确释放控制后重新status，使用标准CLI从candidate-ui48正常保存、备份、完整清单校验、安装并自动启动，操作 `2026-10-19T12-19-43-341Z-705ce37d`，备份 `outputs/desktop-maintenance/backups/2026-10-19T12-19-43-341Z-705ce37d`。12176文件交付由标准维护流程核验；最后仅重复11个相关安装边界SHA、native回执、116%/两屏及后台三能力/不可变manifest身份，不重复全量检查。`runtime-proof-ui48.json`通过，manifest SHA256 `0ba9d02fbebd7e8fa14100b391d9d310762d8ae26a359163d7353f3c70f492ee` 与后端发布一致；此步骤未再次重启API。

原生完整生命周期、全媒体、Android、物理120FPS及长期泄漏本轮不重新验收；未改看图来源路径仅按源码范围复用既有证据，新EXE不是同字节全原生通测。

产物：`outputs/2026-10-19-chat-message-reedit` 和 `outputs/2026-10-19-chat-atomic-services`；临时：`tmp/chat-message-reedit`、`tmp/chat-atomic-services`，冻结web源码在 `tmp/diary-paragraph-messages/build-web`。
