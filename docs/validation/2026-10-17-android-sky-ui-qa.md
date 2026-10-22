# Android 0.4 浅天蓝界面定向验收

2026-10-17 任务；实际运行 2026-10-18 00:06–00:12 UTC。已在独占 `emulator-5554` 完成本轮核心定向验收，`final-summary.json` 为 `ok=true`。0.4.0/code6，APK SHA-256 `154c8d7a025300d210b1982542dc3da66dff22374f35441d7ef36a32a7aa017b`；本代理重新核对本地 APK 哈希及运行版本，覆盖安装和 246 个原私有文件逐项一致证据由根代理提供。

00:12:32 UTC 最终状态：默认会话列表运行，ready=true、inConversation=false、chat.flush 已 ACK，日记退出前 clean save ACK，无待保存编辑；原 pin[-10]，日记外观恢复原天空蓝。已明确交回根代理，此后不再操作 ADB。手机、参考 AVD、Windows 窗口及桌面 API 未操作。

## 变化与证据边界

本轮只测三入口浅蓝/黑字、日期时间按钮、canonical 图片的附件网格呈现、日记独立原生壁纸。按 [验证政策](../TESTING-POLICY.md) 选测，没有重跑旧 32 项矩阵或 native pin 19 项。根代理提供的日记 33/chat 11/contract 10 与共享 3 条 headless 是独立证据，不冒充本代理 AVD 实测。日期时间、媒体字段及兼容边界见 [契约](../ANDROID-SKY-CONTRACT.md)。

| 实际定向阶段   | 结果   | 关键证据                                                                                                                                                                  |
| -------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 时间戳         | 6/6    | 默认会话→直接空白新建；物理 tap 日期按钮；段末 hardBreak、双全角缩进、两 ASCII 空格、北京时间；真实 DOM 选区内联替换；黑字 rgb(17,24,39)                                  |
| 同图片两次导入 | 7/7    | 真实 native 照片面板→系统文件选择器；只选 QA 文件；新图 canonical 尾部、选区文字未覆盖；两份相同 bytes、独立媒体/出现身份和 UTC 时间；附件双卡；阅读重开 body hash 精确   |
| 壁纸           | 7+5/12 | native 选图预览→取消还原并回收本 session 新文件；再次选图保存；正文/revision 不变；entries/assets 前后全表哈希相同；阅读重开 custom 配置及 5812B 实际图像可读；恢复天空蓝 |
| 安全视觉与末项 | 4/4    | 单篇 QA 过滤原生列表、已有合成聊天、黑字；阅读页滚到底后最后图片时间可见且高于继续编辑按钮                                                                                |
| 数据保护与收尾 | 8/8    | 原 SQLite 行、旧聊天消息、原媒体 bytes、pin[-10] 精确；冷启回默认列表                                                                                                     |

共 37 个定向断言，包含保护和前置条件，不代表 37 个独立功能或扩大后的全矩阵。原始分段回执和组合结论见 `outputs/2026-10-17-android-sky-ui/qa/final-summary.json`。

只新增一篇 `QA-SKY-1792281982608` 合成日记与两次图片导入，均保留。原生 `LocalStore.importMedia` 既有行为每次生成新 assetId，不做 SHA 去重；因此本轮 AVD 核对的是相同 bytes 的两个独立导入，不虚称实测同 assetId 的两次复用。同 assetId/两 occurrence 能力归 contract/headless 证据，不为测试改变业务或伪造 native pick 结果。

## 原数据保持

根代理完整 tar `var/android-backups/2026-10-18T00-03-19-before-sky-ui/app-private.tar` 的 SHA-256 为 `f57aa5798115d75390db0eae277378c686e77b8536292eb46a3d5c13c81551fb`，离线核对后只提取 SQLite 和原媒体到本代理私有目录。

| SQLite 表  | 升级前 | 验收后 | 原行         |
| ---------- | -----: | -----: | ------------ |
| entries    |     10 |     11 | 全部哈希相同 |
| rooms      |      5 |      5 | 全部哈希相同 |
| messages   |     15 |     15 | 全部哈希相同 |
| assets     |      2 |      4 | 全部哈希相同 |
| categories |      3 |      3 | 全部哈希相同 |
| meta       |      2 |      2 | 全部哈希相同 |

7 个原 IDB 消息房间的消息数量/哈希在本轮前、收尾及冷启后相同；2 个原媒体文件各 5395B，bytes SHA-256 保持。壁纸前后 entries11/assets4 的整表哈希相同，不进入内容或资产表。报告仅保留哈希和数量；原正文、数据库副本、偏好备份只在 `var/android-backups/android-sky-ui-qa/`。

## 失败保留与定位

- 首轮、次轮附件脚本分别在 DocumentsUI Recent→Downloads 导航、网格没有 text 文件名处停止，未选择图片且取消后图片数仍 0。脚本只增加观察到的 Show roots/Downloads 导航、完整 QA 文件名的 content-desc 匹配，以及扫描明确的合成文件。两份失败回执均保留；第三轮 7 项通过。
- 壁纸首轮已经完成前 7 项，重开时 QA helper 将旧过滤词追加了一次，导致等待搜索值超时。修正为依据观察到的 EditText 清空过滤文字；`wallpaper-rest` 仅从已提交的壁纸继续后 5 项，不重跑或覆盖前段。首段原始 `.ok=false` 保留，最终 summary 明确组合证据来源。
- 离线准备时修正 QA Buffer 的 SHA 输入方式，最终归档和 APK 校验使用原二进制 bytes；未改产品或真实数据。

没有发现需修改当前 0.4 安装包的新产品阻塞；上述失败均有定位和保留回执，未削弱正文/版本/身份断言。

## 原生壁纸静态审阅

独立 SharedPreferences key `android-diary-appearance-v1`、`files/appearance/UUID.ext` 和受限 `/appearance/` 路径；保存 `.commit()` 后发布，导入有 20MiB/MIME/尺寸校验及 FileDescriptor.sync。审阅曾指出导入 busy 过早清除、未采用新文件回收、旧 session 回调清新 busy 的竞态；根代理已修。冻结版重新读到先核对 draft target 才清 busy，回收仅针对本 session 明确创建的未采用文件，保留旧保存文件/未知文件。AVD 直接覆盖的是正常选择、取消、保存及重开，不把静态修正当成故障注入实测。

## 产物与未验

三张已查看的安全实际截图：

- `outputs/2026-10-17-android-sky-ui/qa/sky-chat-synthetic.png`
- `outputs/2026-10-17-android-sky-ui/qa/sky-native-filtered-list.png`
- `outputs/2026-10-17-android-sky-ui/qa/sky-reading-bottom-synthetic.png`

脚本、中间合成 PNG：`tmp/android-sky-ui/qa/`；新回执：`outputs/2026-10-17-android-sky-ui/qa/`；私有副本/原始备份：`var/android-backups/android-sky-ui-qa/`。所有脚本固定 serial/package，ADB 和截图均要求 `--run` 与 `SHIYE_SKY_QA_HANDOFF=emulator-5554`，仍须明确的根代理交接。

未验：手机与物理中文 IME 组合输入、壁纸透明度/位置/填充/模糊全部组合、异常进程终止中的导入清理、长期后台/性能、远程 Repository/服务器同步。CDP 插入合成文字及定位选区不等于真实输入法。未改变公共编辑核、vendor、服务端或桌面运行版本。
