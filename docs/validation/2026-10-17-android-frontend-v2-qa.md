# Android 前端第二版专项验收

2026-10-17 QA 已在主代理独占交接的主 AVD 实际完成会话发送、日记阅读编辑、启动选项、照片入口与原数据保持检查；实际就绪竞态修复后的最终 APK `d50771fc1a3d6eabe91f51ce25fde74912e77fd0442f6f13a85cca16b509b488` 已通过 9 项窄回归，20:55:45Z 结束并交回会话列表。只读静态检查、QA 工具误判与实际产品失败分开记录。

## 范围与输出

仅主模拟器 `emulator-5554`、`dev.shiye.app`；不操作参考 5556、手机、Windows 正式界面或桌面 API。主代理完成新版构建安装、确认可测试并交接后才运行。保留原 App 数据，不 clear、不卸载；旧记录只读核对。测试只新增 `QA-V2` 合成会话、消息、日记。

脚本：`tmp/android-frontend-v2/qa/`；公开回执/合成截图：`outputs/2026-10-17-android-frontend-v2/qa/`；主代理升级前私有快照仍在 `var/android-backups/`。不改旧 `tmp/android-dual-prototype/qa/avd.mjs` 或旧输出。

## 准备的脚本

- `avd.mjs`：复用上一版 AVD/UIAutomator/CDP 工具，固定设备、新输出目录和 19228 CDP 端口；运行要求 `SHIYE_QA_AVD_HANDOFF=emulator-5554` 且传 `--run`。聊天/日记按实际来源路径选择唯一 WebView。
- `inspect.mjs --chat --run`：查看实际桥状态、控件与 APK 权限，不导出日记正文；入口列表/消息页按 snapshot 核验。
- `chat-flow.mjs --run`：默认列表断言、本地创建合成会话、实际点列表、实际输入/发送、等待 flush ACK 和 IDB 单条保存、旧会话/消息摘要哈希保持。
- `diary-flow.mjs --run`：原生快捷新建、合成标题/段落、真实保存返回、独立思绪列表阅读、继续编辑、ACK 后重开内容/身份核验。
- `cross-page.mjs --run`：读取 chat-flow 的 QA 记录；实际菜单置顶、列表首行与 localStorage 界面偏好、模拟 flush 拒绝时保持原页、恢复 ACK 后切日记再回、冷重开检查。消息仍只以 IDB 为权威，置顶 localStorage 是独立界面偏好。
- `sqlite-digest.mjs --database <私有快照内 shiye-local-v1.db> --out <新 QA JSON>`：只读处理主代理提供的一致性 SQLite 备份副本，导出各表计数与 ID/整行哈希，不导出正文或文件名；限制输入为 `var/android-backups/`、输出为本轮 QA 目录。快照必须连 journal/WAL 一致保留或在保存完成/停进程后取得，不能把不一致的单文件复制当作数据变化。

六份脚本已通过 Node 语法检查，`inspect.mjs` 在缺少交接开关时已验证在设备调用前拒绝运行；未调用 ADB。适配器仍在修改，运行时选择器以实际观察为准，脚本存在不代表用例通过。

已从主代理的停进程备份 `var/android-backups/2026-10-17T19-48-15Z-before-frontend-v2/app-private.tar` 仅提取主库及 journal 到 `var/android-backups/qa-v2-before/databases/`，没有提取旧 instrumentation 目录。只读基线 `outputs/2026-10-17-android-frontend-v2/qa/sqlite-before.json`：3 篇、5 旧会话、15 旧消息、2 媒体、3 分类、1 meta；全部已有行以 ID 哈希和整行哈希记录。没有因这一步操作设备。

## 完整检查顺序

1. 主代理交接后确认 APK/设备、启动默认会话列表、原生底栏无歧义 content-desc：随想会话列表／直接新建日记／思绪阅读列表。列表可见置顶区域，点会话才出现消息/输入框；进入消息后底栏按宿主约定隐藏，返回列表恢复。
2. 创建两条 QA 合成会话，实际消息页发送；由真实 UI 长按菜单置顶其中一条，回列表观察顺序，再冷重开观察排序与消息。旧会话不改排序/设置。置顶必须是持久化事实，不能只凭 DOM 类名宣布成功。
3. 发 QA 消息立即返回列表、点击写日记；确认原生收到 flush ACK 后切页。返回随想查看消息恰好一次、草稿/原内容保留。增补 ACK 拒绝/超时场景时仅用 QA 页面临时包装 flush，检查不销毁原页，恢复方法后重试；不改持久化数据。
4. 快捷新建立即进编辑；标题按需显示、两段合成正文、保存状态明确；关闭返回原入口。思绪阅读列表点击相同篇进入只读，继续编辑同 ID；新增一句后保存返回/重开精确哈希相等。
5. 思绪菜单选择启动直接新建，正常关闭/重开进入新的空白编辑页；不经过阅读列表。上一篇内容保持。再验证继续上次页和默认会话列表选项，最终恢复默认会话列表，保留 QA 新篇不清库。
6. 记录升级前已有 SQLite 日记/旧原生消息与新版 IDB 的内容摘要；前后比较旧 ID/正文/媒体身份哈希，新增 QA 内容单列。确认 IDB 名 `shiye-android-telegram-v2`，无桌面数据/API 桥；APK 无 INTERNET 权限。SQLite 与 IDB 独立，不能声称跨端统一/双向同步完成。

## 实际结果（首轮安装 2b279ccc…）

- `chat-flow.json` 通过 6 项：冷启动默认列表、点击会话后真实输入/发送、IDB 恰好一条、新增前旧会话和旧消息哈希保持。新库首次未写入前使用合成 seed，不能把空 IDB 键误判为数据丢失。
- `cross-page-attempt1.json`：实际菜单置顶、首行顺序、flush 拒绝时保持原聊天、恢复后成功切新日记均通过。新 WebView 出现 header 后立即 flush 的首个消息超时 12 秒；稍后相同 list/flush 5–6ms 成功，消息未丢。这是实际 ready/worker 注册竞态，已交主代理修；不将本回执写为全通过。
- `diary-flow.json` 10 项通过：快捷新建、3 段输入和清洁保存 ACK、列表点击只读、只读正文不可编辑、继续编辑同 ID/原内容、新 revision、重开 ACK 正文哈希相同。
- `startup-flow.json` 4 项通过：开屏直接新空白编辑、继续上次同篇、上一篇内容保持、最终恢复默认会话列表。直接写返回原入口会话列表是宿主约定，第一轮 QA 误找 native 更多另存 `startup-flow-attempt1.json`。
- `attachment-check.json`：在 QA 会话物理 tap 屏幕 (84,2189)，一步打开本机原生照片底层网格；截图 `physical-attachment-photo-grid.png` 已查看，显示合成条纹缩略图和相册/文件入口；返回取消，未选择或发送图片。图片发送链路未在本专项冒充通过。
- `old-record-preservation.json`：主代理停进程升级前 tar 与本轮保存 ACK 后停进程取得的 SQLite 副本对比：已有 3 篇/5 旧会话/15 旧消息/2 媒体/3 分类/1 meta 的全部旧行 ID 与整行哈希保持；篇数 3→6，仅新增 3 篇 QA。副本 `var/android-backups/qa-v2-after/databases/`，公开回执仅哈希。
- QA 会话与日记保留；已取消 QA 置顶，只保留原演示“随手记”置顶作为展示；最后恢复会话列表启动。收尾展示偏好通过 adapter togglePin API 恢复，QA 实际菜单置顶操作此前已验证。

`inspect-chat.json` 实机 package 权限中无 INTERNET；IDB 名为 `shiye-android-telegram-v2`，消息权威为 IDB，置顶仅 localStorage 界面偏好。SQLite 旧随想保持，不能声称与新聊天双向同步完成。早期测试工具错误汇总 `test-harness-attempts.json`，未清库或删除 QA 内容。

## 最后就绪修复回归（最终 d50771fc…）

`final-ready-regression.json` 9 项通过：冷启动 ready 包含 transportReady/uiReady，首条 list ACK 136ms、首 flush 110ms；从随想原生底栏切思绪，再回随想替换 WebView 后首 flush 161ms。全部旧和 QA 消息哈希与首次发送保存值精确相同。默认冷启列表、演示“随手记”单独置顶、跨页后列表和置顶均保持。未重复已通过的日记/启动/媒体矩阵。

收尾偏好有一个明确边界：第一轮恢复置顶后立即 force-stop，内存 pinIds 曾为 `[-10]`，下一次启动仍读到 `[-10,-101]`，见 `final-ready-regression-attempt1.json`。再次取消 QA 置顶，留 1.8 秒让 WebView localStorage 偏好落盘后，冷重启和跨 WebView 均保持 `[-10]`。消息 IDB ACK/哈希全过程无丢失。`flush()` 只保证消息与草稿写队列，不应把它解释成 localStorage 界面偏好对立即强杀的持久性承诺；此边界未当成修复完成。

20:55:45Z 结束状态：`emulator-5554` 默认随想会话列表，demo `-10` 单独置顶，QA 内容全部保留，无编辑页/待保存正文，主代理已收到明确交回信息。后续最终展示截图由主代理负责。

## 限制

CDP 插入文本只证明编辑器/真实 Android WebView 保存链路；中文输入法组合、物理设备、长期后台、相册全部分支、桌面同步不在此次结果中冒充通过。截图只在 QA 合成会话/日记页面或仅合成图片的网格生成，不拍已有私人内容。
