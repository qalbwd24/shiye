# 即时发送去重与会话服务接入验收

2026-10-19 随想ui44已正常保存/备份/标准升级运行（2026-10-19T11:15:26.0944431Z，聊天PID84424仅快照），API0.9.27本轮未重启。修复即时显示1→2→1：randomId＋chat精确串起local/正式ID，历史先返回仍按同一身份展示，不按正文合并，不延迟首显；5次实际发送逐帧1226采样无重复，同文两条保留。朝花夕拾已接固定catalog/create/bind/request、稳定sourceId会话身份、按实例收件/评论/撤回及独立sender；旧固定房不迁移，解绑原引用保持，撤回重新编辑显式恢复原引用。服务保存等待串行目录/worker持久路由ACK后才成功；冲突保留草稿/实例并可明确重新读取，未知provider只读不假实现AI。60项相关Node分阶段、8真实C#桥、5ACK浏览器＋11服务浏览器通过；12057安装SHA由标准CLI完成，最后仅复核相关边界。116%/两屏偏好保持，旧配置一致、runner=waiting。ui43为中间运行阶段，最终ui44只补5个静态/元信息文件；未跑全库/全媒体/Android/压力。产物outputs/2026-10-19-chat-ack-services，临时tmp/chat-ack-services及tmp/diary-paragraph-messages/build-web/.ui43-ack-services。

## 原因与消息修复

冻结ui42真实隔离app复现：本地浮点ID4.000001与已落盘正式ID11在全局和DOM并存约100ms，ACK稍后到达才合并。不是CSS叠影，也没有证据表明同一请求后端实际写成两条；即时模式使这段竞态直接可见。保留即时显示。

发送请求注册randomId/chat/localId/date，worker分配正式ID立即关联；历史/新消息builder读取时补瞬态previousLocalId/date，mock消息列表按精确身份投影，正式记录优先。映射有界1024，失败清理；没有正文比对、没有持久化瞬态关联。真正同文双发是两个身份，继续显示两条。

最终ui43编译资产实际再次触发history先于ACK的全局双身份，1226采样与mutation/rAF全程独特正文maxRoot=1、同文maxRoot=2，五条均保留且整数ACK；ack-validation-summary.json绑定原始JSON/截图SHA。ui44与ui43全部vendor/native/动效代码字节一致，仅5个wrapper/元信息文件增加保存路由屏障，ACK证据按该未改路径复用，未再跑同一矩阵。

## 服务数据与UI

沿用已部署的四固定动作，ChatJournalBridge只添加catalog/create/bind/request四个固定method/path，不开放任意URL。新shiyeJournal.services兼容固定前缀，端口以desktop:sourceId:roomId定位会话。旧-900000001沿兼容API，不迁规则/游标/消息/评论。

设置端口仅保存幂等操作身份/阶段，规则仍读服务器；Web Locks保护同源跨窗操作，无共享锁禁用保存。创建/配置/绑定为分步接口，不假称原子。丢回执精确验证已提交配置revision及目标字段；409/partial明确保留实例和草稿，通过“重新读取并保留现有实例与本页草稿”结束旧意图，不擅自提高revision重放。后台新settings/read/save及participantModel候选未由本包部署。

worker持久化每实例的room/binding/active/next及目标、每条历史/评论原scope，sender按instance独立。feed/ACK/撤回/绑定写在本机IDB持久完成后才确认，期间如发送或草稿写入则rebase最新内存，避免旧快照覆盖新消息。来源与评论逐条排除普通归篇，解绑后旧评论仍走原实例而不改用当前绑定。

默认回复当前活动实例最近来源；有引用则始终使用消息自身实例，多个活动服务无明确引用会阻止猜测。解绑实例只核验已有缓存，不新增历史来信；失效/锁定清除来源正文和媒体，保留本人评论及待发操作。撤回重新编辑返回原来源local ID并恢复显式引用，找不到原对象时保留恢复缓存、不猜新目标。

最终补充ui44：服务设置后端成功还需await串行syncServices目录应用及worker持久路由ACK，界面才回“已保存”。后端已保存但本地失败返回partial，明确恢复继续使用原实例；避免刚换绑就发送仍选旧scope。冷启动program-bindings加入已有固定requestId重试，不因worker较晚就绪漏掉首次目录。

未来provider由目录发现和能力声明，当前可执行适配器仍仅revisit；未知类型保持只读，旧scope不丢。已能按已有实例拆分收件/引用，尚未实现AI运行、任意机器人执行、完整多provider设置UI或云同步；不把未来扩展接口写成机器人已实现。

## 针对性验证与失败记录

- Node相关60项分阶段：首次59/60，唯一失败为格式化后journal public镜像未同步；同步后该9项文件全部通过，ui44又按改动重验该文件9/9。其他已过且未改路径复用。包括乱序历史/ACK、同文双发、跨房身份、实际worker收件/IDB/撤回、冲突与孤立实例复用、原引用恢复和ui40待发评论按ID重读。root/vendor各自定向lint通过。
- 原生8项为实际C# ChatJournalBridge＋合成loopback HTTP，四固定映射/desktop header/JSON、401/409传播、未知动作零请求、302不跟随；没有用浏览器stub替代该transport验证。宿主其余源码冻结ui38，仅桥4个case；没有重新跑无关原生全套/图片矩阵。旧图片证据按未改ImageViewer等源码范围复用，不声称同EXE新测。
- 最终服务浏览器11项：实际候选UI/真实worker/端口、实际backend registry/config/feed/comment函数配合合成内存库；两房规则/相同delivery编号隔离、各自房间收件、跨窗共享配置、保存/解绑返回前路由已落盘、解绑历史保留、后端成功本地失败partial与恢复、旧单例状态不变。真实C#桥已单独测；未在正式库建测试绑定或发测试消息/评论。
- 首次服务浏览器在冷worker丢了目录命令，发现真实启动接缝后增加固定requestId重试；带手工二次discover的诊断通过保留在diagnostic，不作为最终证据。最终11项不需要这个绕行。
- 冻结构建来源为可核ui31根＋安装maps精确SHA恢复1658源码，5项历史不匹配保留正确冻结源；仅批准10 vendor文件变化。新包主线程/worker maps中10/10 SHA匹配。第一次Vite导入遇不受信任junction，重建链接命令被自动审批拒绝且未执行；随后无删除解析方案遇PostCSS依赖失败，失败保留。最终用新纯文件子目录向父依赖解析，仅config三处staticCopy路径调整，2048MiB/RAYON1构建10.52秒exit0，没有为失败扩大内存上限或改正式依赖。

## 运行与文件

先正常升级ui43，备份D:\拾页\outputs\desktop-maintenance\backups\2026-10-19T11-08-45-580Z-cbef4eaa；最后5路径delta以ui44正常保存/备份升级，备份D:\拾页\outputs\desktop-maintenance\backups\2026-10-19T11-13-58-215Z-65446c12，operation 2026-10-19T11-13-58-215Z-65446c12。未改文件在两个不可变生成候选之间以hardlink复用，5变化文件先独立复制再写，无安装目录/私人数据硬链接；未删除原候选或旧资产。

当前运行ui44/ready/recovery=false，API0.9.27本轮未重启，runner running=true/state=waiting。12057文件由标准CLI逐目标SHA核验，最终另核native、当前entry/worker和wrapper边界；最终偏好与最新正常退出备份相同，116%/2屏。旧配置一致；自动游标允许正常推进，不把整个日记库要求静止。原profile和正式数据目录保持。

产物D:/拾页/outputs/2026-10-19-chat-ack-services。临时D:/拾页/tmp/chat-ack-services；构建纯文件子根D:/拾页/tmp/diary-paragraph-messages/build-web/.ui43-ack-services。正式数据/凭据/用户正文不进入源码包，本轮未生成源码交付包。
