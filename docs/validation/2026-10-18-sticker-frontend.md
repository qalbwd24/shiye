# 电脑端表情包前端接入验收

2026-10-18；产物`outputs/sticker-frontend`，临时`tmp/sticker-frontend`。`20261018-ui29`已正式升级启用（2026-10-18T05:24:08.251Z最终核验）；API保持0.9.24，无服务端格式/旧日记迁移。

## 实现

- 普通图片及GIF消息菜单“保存为表情包”；不改原消息，未开启归篇的会话保持原设置；已归篇来源等待回执后走from-message。
- 我的表情包合并后端目录与旧本地收藏；原UUID/Blob/未知字段与`/xxx`映射保留。失败不清库，原件按需读取，MIME/size/SHA检查；移除只改收藏，旧资源保留。
- 再发使用原文件，收藏图片绕过普通图片压缩偏好；GIF原件不转静态图。固定原生桥共用API鉴权，不开放Telegram或任意URL网络。
- Android共用客户端和读取/菜单接缝已写入源文件，APK/AVD/手机本轮未构建或部署，服务连接也尚未实现。详见[接入文档](../STICKER-FRONTEND-INTEGRATION.md)。安卓刷新/富文本反馈已单独交接，导航临时候选已撤回。

## 已通过

- 12项Node测试（1客户端真实隔离API综合场景＋7来源收藏＋4既有收藏/备份回归），含保留旧字段和映射、媒体去重、恢复、原GIF字节、无权限/冲突/撤回、写盘回滚和加密备份。
- 实际构建Chrome应用13项：输入预览发送PNG→右键收藏→后端目录；旧收藏和斜杠映射保留；面板重发双帧GIF且字节一致；GIF重复收藏不增后端条目；普通图片选择压缩偏好时，表情包仍按原PNG重发；已归篇会话from-message；原消息未变；断线仍可选择旧收藏；重开映射保留；无运行异常、无外部请求。采用合成库，无真实日记正文写入测试日志。
- C#实际桥7项：固定catalog、原件上传/收藏、目录DTO、受保护Range读取双帧GIF、移除、移除后原件仍可读、拒绝路径穿越。测试仅自建127.0.0.1:18767隔离服务；未占用/停止其他服务。
- 原生宿主重新编译通过；vendor完整tsc显式8GiB上限通过，受影响两TS文件eslint自动修复后通过。项目层修改JS eslint通过。vendor要求的整套check:ts已尝试，但其全树eslint阶段约4GiB堆耗尽；未记成整套通过。无SCSS改动。保留范围验证，不重复无关全库/动画矩阵。

## 构建边界

在ui28已验证冻结vendor上仅叠加MessageContextMenu、buildAttachment、中文文案及生成类型；wrapper沿ui28叠加输入/收藏/桥文件。原生主体从ui25冻结来源（与当前DesktopPreview.cs同hash）保留，仅增加ChatJournalBridge固定动作；共享DesktopPaths/InputMode未改。未把Android或其他数据/UI候选混入电脑安装。

GUI测试首次发现验收脚本在Web A动作尚未装配时就打开会话，已改为等待openChat及编辑器就绪；最初1xPNG合成文件的浏览器解码失败，改用canvas生成有效PNG。不是把失败样本当产品通过。最终候选13项全部通过。

## 正式升级回读

标准维护CLI正常保存/备份/升级/重启成功；备份`outputs/desktop-maintenance/backups/2026-10-18T05-21-57-740Z-a5e69be0`。原生runningRevision为20261018-ui29、ready=true，API0.9.24与package一致；116%字号、2屏档案保持。

11798个安装文件逐项SHA-256一致；3014篇旧长文内容摘要保持，正式收藏、朝花夕拾配置和评论摘要保持；运行器waiting正常等待下一条。本轮没有在正式库发送合成消息或收藏测试图片。

安装/运行证据：`delivery-manifest-ui29.json`、`browser-validation.json`、`native-bridge-validation.json`、`status-before.json`、`status-after.json`、`upgrade.log`与`final-verification.json`。Chrome实际交互与C#桥测试、正式原生启动回读均已分开记录；没有冒称本轮在手机或正式窗口发图验收。
