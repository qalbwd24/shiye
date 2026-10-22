# 电脑随想：外部图片拖入与表情包直发

2026-10-18后续配套升级已完成：**API0.9.25 / ui30已实际运行**，原生ready。按用户明确要求重试标准维护：正常保存退出，稳定私有快照，tools/restart.ps1成功升级API，再标准upgrade启用ui30。此前审批拒绝是初次尝试的历史记录，下方旧“未部署”描述保留审计，不代表此时运行状态。

最终`final-verification-ui30.json`：11872项安装SHA-256、30项安装资产隔离浏览器检查通过，metadata=1、catalog容量信息生效；3014篇旧长文、285条原聊天消息、媒体元数据、规范消息库、分类、回看配置/评论/旧投递及绑定保留。116%与2屏记忆保持，运行器waiting且无错误。窗口重开后有6条新消息、2个媒体和1个新增收藏正常进入正式库，原收藏名称/备注亦有前端编辑；因此整库SHA改变，不宣称文件逐字未变。测试本身未向正式库写合成消息。私有备份`F:/<正式目录>/var/upgrades/sticker-ui30-2026-10-18T06-10-29-880Z`，程序/偏好备份`outputs/desktop-maintenance/backups/2026-10-18T06-10-56-624Z-a825f98a`。

用户实测反馈QQ已可拖入、微信仍不行，并追加空说明Enter、首次收藏、尺寸和看图焦点要求；另在ui31候选处理，见[跨端说明](../STICKER-IMAGE-CROSS-DEVICE.md)，不能把ui30兼容测试当成微信实拖已经修复。

2026-10-18T06:06Z用户反馈“没有改变”后再次只读核对：安装版本与原生运行回执均为ui29，API仍0.9.24，维护锁为空；标准desktop-control明确只管随想/托盘，不更新API。因此普通重开/刷新不会把ui30候选变成正式版，仍须完成前后端配套发布。本次未再次尝试已被拒绝的后台重启动作，未改日常窗口。

## 本轮实现

- 外部拖入按文件头识别 PNG/APNG、JPEG、GIF、WebP、AVIF，不只信扩展名或 MIME；支持空 MIME、application/octet-stream、GIF 误标 JPG、可读的 HTML 内嵌图片及有效 DataTransfer 文件项。BMP 在浏览器转换为 PNG。普通文件继续走附件路径。
- drop 回调同步发起读取，减少外部临时文件失效；空文件、占位文件或仅有图片链接时显示失败提示，不发送空内容。不自动下载任意外部链接，不扫描微信缓存。
- 新收藏及表情包发送上限 **64 MiB**；超限明确拒绝，旧超限收藏保留目录及原件，不悄悄删掉或转成静态图。列表生成并缓存 **192px WebP 首帧缩略图**，发送仍取原件；GIF 动画不被缩略图替代。普通图片的既有压缩设置继续独立生效。
- 图片/GIF消息右键“保存为表情包”可填写名称与备注；旧收藏可编辑信息。备注最多 **2000 个 UTF-16 码元**，空字符串清除；它属于收藏元数据，不进入消息文字或图片说明。
- 点击表情按钮默认“我的表情包”；方向键移动，Enter 或点击直接发送，没有图片说明/确认发送页；保留正在写的文字草稿。已有 /xxx 映射与 emoji 显式入口保留。
- 旧 UUID、Blob、别名及收藏软删除沿用原规则。错误 MIME 的旧图片在读取侧兼容为图片，不批量改写旧消息。未知尺寸回退展示不等于已经恢复真实图片尺寸。
- 从旧泛型文件收藏时，使用识别后的本地原件导入，保留 localSource；不把本地编号伪装为 canonical unitId 或来源核验回执。

核心路径：`previews/telegram-chat/shiye-media-drop.js`、`shiye-chat-ui.js`、`shiye-stickers.js`、`shiye-input.js`；vendor 的 Composer/useShiyeInput 与本地媒体识别；`src/server/domain/sticker-collection.mjs`、`sticker-message-source.mjs`、`public/shared/limits.js` 和 health 能力字段。原生宿主/固定桥未改，候选复用 ui29 EXE。

## 验证与证据

- **19 项 Node 定向测试通过**：拖入字节归一化、来源核验、收藏备注/清空/大小边界、旧收藏保留及加密备份回归。日志 `outputs/chat-external-media-drop/node-tests.log`。
- **30 项实际构建应用浏览器检查通过**：真实 PNG 输入/右键命名备注、旧收藏/映射保留、GIF 原字节多帧重发、归篇来源回执、压缩偏好下仍发送表情原件、离线重开、默认面板/键盘直发、草稿保留、四种拖入数据、BMP 转换及失败提示。无页面异常、无 Telegram 或其他外部请求。`browser-validation.json` 与三张截图在同一产物目录。
- Vite 构建成功；完整 TypeScript 编译与所改 TS 文件 ESLint、最后菜单单文件再检通过。日志 `tmp/chat-external-media-drop/build-final.log`、`check-ts-final.log`、`check-ts-menu.log`。本轮 JS/后端/测试独立 lint 通过。
- 全库 `check-files` 遇并行 `public/sync-lab/app.js` 引用的三个尚未生成 assets：sync-v2-client.js、sync-v2-media-cache.js、rich-document.js；未代改其他会话生成流程。本轮不宣称完整 npm run check 已通过。
- **没有实际操作微信/QQ拖拽**，测试模拟它们可能交付的空/错 MIME、临时文件及 HTML 图片。若微信只给虚拟占位/链接，仍需先取得真实原件；若根本没有 drop 事件，网页层提示也无法触发。不能把数据路径通过写成跨应用实体拖拽已全部解决。
- PNG/GIF/BMP 为实际浏览器样本；WebP 缩略图实际生成。未逐一实测所有 AVIF/APNG 编码变体，未构建或安装 Android APK，未验收真实 Windows 输入法和窗口生命周期。

## 发布边界与下一步

自动审批拒绝了包含正式后台重启脚本的命令，返回 **blocked by policy**，未提供更具体原因。该命令未执行，没有写入那组重启/快照脚本，也没有停启 API、推送器、托盘或日常窗口。之后仅生成与封存隔离候选，没有通过替代通道执行被拒绝的动作。

当前运行 ui29 / API0.9.24；候选 ui30 必须配套0.9.25后端，不能单独换前端。后续标准发布需重新查询运行状态、确认保存、保存快照并按维护流程升级；没有完成这一步前，用户日常窗口不会出现本轮新功能。本轮未向正式日记或收藏写入合成测试数据，未运行旧数据迁移；不复用上一轮日记 hash 结果冒充本轮全库核验。

候选 `outputs/chat-external-media-drop/candidate-ui30`；SHA-256 清单 `delivery-manifest-ui30.json` 明确 `deployed:false`。`runtime-status.json`是最终只读状态回执。安装 EXE、index.html、shiye-preview.js、shiye-stickers.js、UPSTREAM.json 五个关键文件与ui29候选逐一hash一致，未误装前端。产物 `outputs/chat-external-media-drop/`；其中`failure.png`保留早期测试失败诊断，不代表最终30项结果；临时脚本、隔离库、浏览器资料和日志 `tmp/chat-external-media-drop/`；冻结 vendor 构建工作区沿用 `tmp/diary-paragraph-messages/build-web/`。未来 QQ 推荐/推送机制及 APK 原理分析留后续，不在本轮实现。
