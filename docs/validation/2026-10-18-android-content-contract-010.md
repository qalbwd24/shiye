# Android 0.10 共用内容契约验收

2026-10-18，依据后端最新 [实际内容契约](../DESKTOP-ANDROID-CONTENT-CONTRACT.md) 和同一合成fixture；补读 [图片/GIF收藏边界](../STICKER-MEDIA-CONTRACT.md)。0.10.0-content-contract/code12已保留数据覆盖主AVD，并通过用户重新授权的标准ADB命令 `am start -n dev.shiye.app/.MainActivity` 成功启动。手机仍0.6/code8，桌面运行版未由本轮改动。

APK：`outputs/2026-10-18-android-content-contract/Shiye-Android-0.10.0-c54bf181.apk`，91,506,072 bytes，SHA-256 `c54bf18101c747b7d934e9b5ddfe5a5083c9432da74a5f6ea3916b8bf4e1d50a`。版本/SDK及权限经aapt与安装包回读；无INTERNET权限。完整来源与资产逐字节匹配见 `release-receipt.json`。

## 已落地

| 范围           | 本轮实际状态                                                                                                                                                                        |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 长文分段与时间 | 原样打包电脑prepareDiaryUnits/reassembleDiaryUnits/projectDiaryParagraphMessages/readManualTime等模块；没有另写安卓近似版。只计算适配，未启用canonical持久化。                      |
| 富文本         | 同源richdoc v1校验、renderer/schema、Tiptap与转换；稳定blockId、marks、缩进、代码和媒体出现身份保留。未知格式/版本/节点/属性只读阻写。                                              |
| Entry信封      | 新纯adapter保留原件，完整日期、附件、未知字段及服务端revision做保留式合并。完整远端信封尚无本地持久化能力，实际编辑入口会只读保护，避免假保存。                                     |
| 本地SQLite     | schema3新增nullable contentEditedAt，旧行一次按原updatedAt回填；正文变化推进，标题/标签/分类/置顶不推进；显式null保留。DTO补contentFormat和真实正文媒体引用；独立附件不支持则拒写。 |
| 容量           | 已核实title500（HTML输入上限同步）、tags50/每项<100、正文2,000,000 UTF-16、50K节点/64层；原标签空白/空串保留。其他不同限制明确不冒称全兼容。                                        |

专属实现说明：[算法](../ANDROID-CONTENT-ALGORITHMS-010.md)、[存储](../ANDROID-CONTENT-CONTRACT-STORAGE-010.md)、[编辑信封](../ANDROID-ENTRY-ADAPTER-010.md)。

## 实际验证

- 3项同源Node契约/依赖闭包检查、16项实际浏览器合成编辑检查、37项SQLiteJDBC迁移/空值/正文时钟/附件/上限定向通过；Java36编译与Gradle构建通过。未跑无关全库测试。
- APK内11模块依赖闭包及编辑入口/聊天适配资产与当前来源逐字节一致；fixture SHA-256 `30d35ccaaa8ea8ece1d5a519f93716476ed904e6b333f4e23b912ca3f4c9700b`。
- **真实Android WebView9项通过**：完整prepared/projected/reassembled/editorRoundtrip/summary逐对象等于桌面直调结果；实际Tiptap整篇fixture往返相等；完整信封合并、未知属性/canonical/本地不支持信封保护；原生MessagePort连续两次保存实际ACK与版本递增。见 `avd-content-verification.json`、`avd-algorithm-result.json`。
- 安装后5项存储回读通过：schema3，唯一自有合成fixture仍在、createdAt/pinned保持、两次实际保存revision精确+2，正文修改推进内容时钟。见 `avd-storage-verification.json`。只检查该合成行，不做整库个人数据审计。
- 实绘已查看 `avd-editor-final.png`；0.9列表/键盘/缓存15项证据按未改UI来源复用，不冒称0.10重跑全部。fixture图片只验证正文身份/时间和编辑往返，未把不存在的合成图片请求算媒体字节导入通过。

安装前聊天flush确认后完整私有备份 `var/android-backups/2026-10-18T04-30-34-583Z-avd-before-0100/app-private.tar`（42,547,200 bytes）。首次在隐藏且onPause的WebView flush因rAF暂停超时，切回正常聊天页后得到真实确认再备份；未强行安装。存储回读初次只提取db漏WAL导致无表，改为复制db/wal/shm到隔离目录查询；不操作原库。

## 尚未接通

当前SQLite/TL IndexedDB依旧是独立本地库。完整远端Entry Repository、分类名称映射、HTML/Markdown只读转换服务、canonical units/layout持久化与身份映射、chat-journal写口、资源SHA-ID映射/上传回执、会话服务/归档worker、可靠outbox与冲突合并、图片/GIF收藏到正式表情库均未完成。TL数字ID/本地路径不能直接用作跨设备身份；普通独立附件与部分阅读投影不可回存。客户端/云端执行算法的部署位置仍待用户决定。

以后接服务先查health能力和revision，不重新生成收到的ID，不把规范开关false误当已有canonical可编辑；Node/jsdom旧格式转换不伪装成WebView纯函数。系统文件选择器卡住/视频原件导入、物理Magic7 120Hz和长时间负载仍未验。

产物 `outputs/2026-10-18-android-content-contract`，临时 `tmp/android-content-contract-010`；复用Telegram冻结资产 `tmp/android-diary-list-09/telegram-build/assets`，未修改第三方来源/许可证。
