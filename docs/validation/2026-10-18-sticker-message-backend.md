# 图片/GIF消息收藏后端验收

用户授权后端先行、复用旧收藏、两端同格式与接口、前端按文档接入，旧消息不动。实际契约：[STICKER-BACKEND-API](../STICKER-BACKEND-API.md)。此处先记录代码与隔离结果，正式部署回读另补，不能把测试服务器当正式后台。

2026-10-18后续：正式后端已部署，实际回读与原生恢复如下；上句“另补”为此前候选阶段，不代表当前仍未运行。

## 实现边界

新增`GET /api/stickers/catalog`及`POST /api/stickers/from-message`，后者核验已归档chat复合身份或持久unit ID/revision，再通过同一收藏服务串行提交。多图须选择、occurrence与mediaId一致、已撤回/删除/隐藏/草稿/版本冲突拒绝；canonical与旧聊天缓存分叉拒绝，不通过收藏偷偷修复。

只写既有db.stickers标准记录，旧POST/GET/PUT及备份映射兼容；同资源去重，软删除恢复原ID和用户元数据。source/原文/原消息/媒体/时间/引用不改写，GIF不转码。目录DTO不给正文或本机路径，thumbnailUrl=null明确未实现缩略图服务。桌面C#固定桥/菜单/面板、Android Repository尚待前端接入，本轮不改客户端/EXE/云入口。

## 测试

- 7项新增真实HTTP/域测试＋4项旧收藏/备份回归，合计11/11通过。覆盖PNG/双帧GIF普通消息、超2^53字符串编号、并发等价两端请求只创建一次、原接口共享ID/名字、去重/软删除恢复、重启持久化、原文件字节完全一致。
- 多图/外来媒体/视频/不合法字段与版本拒绝且库保持；规范消息版本/occurrence与删除/撤回拒绝；坏兼容缓存不修复；目录读取不初始化、缺本机写请求头403。写盘rename故障注入后磁盘/内存收藏均回滚，同一来源重试成功。
- 原chat-journal/message-store/backup-restore相邻回归15/15通过；未扩大无关UI/动画/Android/全库测试矩阵。定向lint/format通过。
- 实际正式库只读内存副本抽12条现有图片消息：收藏/重试全部成功、去重一致，源entries/media/messageStore/chatJournal/revisit/categories/conversationServices指纹保持；只改副本收藏，正式写入0。没有输出正文或复制真实图片到测试日志。
- 两次初始合成测试使用了不合规的撤回operationId、将普通accepted回执误当含unitId；分别改为UUID及查询receipts后通过。失败日志保留，未修改产品校验来迁就测试。

证据：`outputs/sticker-message-backend/tests.log`、`source-regression.log`、`preflight.json`、`lint.log`、`format.log`；隔离库/脚本在`tmp/sticker-message-backend/`。共用协议与前端接入的行为明确，不据后台测试宣称实际手机/桌面按钮已经可用。

## 正式部署回读

标准desktop-control先确认ui28/原生ready与API归属，正常保存退出聊天/托盘后暂停运行器，核对稳定快照，2026-10-18T04:46:58Z重启D盘server.mjs。旧PID24496→70644仅为快照，未按旧历史PID操作。私有原件备份`F:/<正式目录>/var/upgrades/sticker-backend-2026-10-18T04-46-58-677Z`，没有直接写正式diary.json。

正式health的version与package均0.9.24，stickerCollection.version=1/catalog=true/fromMessage=true/sourceKinds=chat,unit；catalog真实GET200、version=1，此时0项。没有向正式库收藏私人图片以充当测试；原已登记收藏hash保持，不代表预览IDB/手机的本地素材也是空的。原生桥/旧本地收藏映射的明确待接边界已写契约，不能用空目录覆写它们。

标准start成功恢复ui28原生ready、116%与2屏档案。EXE/UPSTREAM/index/journal/frame五条未改客户端路径SHA核对；原11737项整体安装hash是上轮未改包基线，不冒充本轮重新完整验证。后台运行器running/waiting、成功检查且lastError=null，原daily-random/08:00/北京时间/范围及既有投递、评论保持。

最终指纹：3014篇旧长文逐篇一致；entries/media/messageStore/chatJournal/categories/conversationServices、旧收藏、原评论和配置均保持；旧投递ID仍保留且唯一。新收藏处理不会重编码媒体或变更正文时间。实际回执`final-verification.json`、`start.json`及运行日志存于产物目录。后台接口/格式已可供前端接入；本轮无菜单、APK、实际双端联网或缩略图服务验收。
