# Android 0.2.1–0.2.2 本地状态定向 QA

2026-10-17 最新：恢复受损聊天 origin 后，0.2.2 原生置顶全定向 **19 项通过**，原四个会话消息哈希保持，真正原偏好 `[-10]` 恢复。多段中文合成草稿的编辑器文字精确断言通过，但实际 flush 保护性超时，IDB 草稿为空，已诊断并交回主代理处理；草稿跨页/重开未通过，不能宣布整体完成。手机 0.2.0 基本中文可输入按用户手测记录，代理未操作手机。

## 最新实际结果（恢复 origin 后）

主代理先保留当前取证包 `var/android-backups/2026-10-17-before-idb-recovery/app-private.tar`，仅从 22:10 备份恢复原 origin 的 leveldb/blob 8 文件，247 个不相关文件哈希保持，SQLite/日记不回滚。`qa/idb-recovery-validation.json` 确认四个原会话消息哈希精确一致、native `[-10]` 保持。

主代理日志已定位 22:32:45 首启 `Corruption: missing start of fragmented record`，随后 origin deleted/rebuilt；损坏具体来源未知。恢复后的 `qa/independent-strict-idb-probe-clean.json` 使用独立新 key、strict readwrite oncomplete 后立即 kill，重开值保持；**早期失效发生在受损 origin，不能概括为所有 WebView strict 事务都无法持久化**。原生权威设计保留；历史失败回执保留但解释须结合 origin 损坏。

### 置顶与迁移

`pin-native-check.json` 于 22:37:18Z 完成，19 项全通过：

- 原生 togglePin Promise ACK 后不补等待立即 force-stop，native/API pin 值保持，真实 `#LeftColumn a[href^="#"]` 首 href 为该 QA 会话；未知字段保留。
- 取消全部 ACK 后立即 kill，native 显式空数组保持，旧 LS 缓存不复活；产品新操作不回写旧独立 IDB preference key。
- `commit(null)` 只清 native 专用 key；旧 IDB 已存在 `[]` 优先于非空 LS，未知字段迁移；旧 IDB 缺失时才回退 LS；两条迁移得到 native ACK 后另立即 kill 均保持；native 存在不重新迁移。
- 首四个会话全部旧消息哈希保持；只创建一条合成置顶测试会话 `-102`，无消息写入。finally 原 native `{version:1,pinIds:[-10]}` 恢复并冷启验证，旧独立偏好 key 私有备份后恢复。

legacy 种子在同一 app 进程替换 WebView 中注入和观察，迁移结果再经真实原生 ACK/kill 核验；没有用固定等待代替列表排序或真实事务完成条件。恢复后的原四个会话共 15 条消息（8/3/3/1）全程只哈希，不打印正文/截图。

### 多段草稿尚未通过

`draft-check.json` 在合成新会话 `-103` 用 CDP 输入 54 UTF-16 字符，5 段含一个空段、两个半角空格、全角空格与 emoji。编辑器 `getText({blockSeparator:'\n'})` 与合成原文精确相同，hash `0ce5407b0a7795a71d934116d0fd742f6e9ec419557651f56f79db2ad3403e4d`；真实 `shiyeAndroidChat.flush()` 10 秒后拒绝“消息或草稿尚未得到本地保存确认”。原拒绝未改、未 strip/trim，尚未进入跨页或 kill。

`draft-diagnostic.json` 进一步核验：编辑器 54 字符、IDB 草稿 0 字符；首差 offset 0 期望 U+0051（Q），持久化值缺失。全局 getter 存在，消息分支 5，待发送 Message 数量 0，QA 新会话尚无 draft/消息分支。HTML 为五个正常 `<p>`（一个空 `<p>`），emoji 为 `<img alt="🙂">`；hardBreak 数 0、含裸换行的 text 节点数 0，不能将失败归为裸换行插入伪影。

22:38:40Z 后已明确将 5554 交回主代理：当前停在 `-103` 合成消息输入页，54 字符尚未获持久化 ACK，未擅自离开；合成原文在 `tmp/android-input-refinement/qa/synthetic.mjs` 可重现。native pin `[-10]` 保持、所有既有消息哈希保持。后续仅修草稿；已通过的 native 19 项无需重复。CDP 中文输入不等于中文输入法组合实测。

## 范围与保存边界

### 0.2.2 准备中的新契约

0.2.1 失败证据保留不覆盖。主代理决定 0.2.2/code4 改由 `LocalStore.meta/android-chat-ui-preferences-v1` 作为置顶唯一权威，经 `window.shiyeAndroidPreferences.load()/commit(value)` 的现有原生 WebMessagePort 桥，SQLite 事务结束才 ACK。源码已核对 load/commit resolve 原始偏好对象或 null；`commit(null)` 仅删除该专用 key，可用于迁移种子准备，不碰其他 meta。旧独立 IDB preference key 仅在 native 缺失时迁移一次，显式空数组优先于 LS，之后不回写旧 IDB。此段仍是源码/QA 准备，实际 AVD 持久化与迁移结果须新候选交接后核验。

固定恢复源始终为首份 `var/android-backups/android-input-refinement-qa/preferences-1792275725825.json` 的真实 `[-10]`。`pin-native-check.mjs` 在开头与 finally 均要求恢复该源，不再将失败后的 `[]` 当原状态；预备 native ACK→立即kill、实际列表首位、取消全部不复活、旧 IDB 未被新操作回写、旧消息哈希、未知偏好字段保持。迁移仅用 `commit(null)` 清专用 native key，旧 IDB key/LS 合成种子在同进程替换 WebView 时观察，避免已知旧 IDB 立即kill弱点让种子回滚；迁移到 native 得到 ACK 后另立刻kill验证。覆盖旧 IDB 已存在空数组优先于非空 LS、旧 IDB 缺失回退 LS、native 存在不重新迁移。旧 IDB 原对象私有备份并最后恢复，不碰消息 library 或其他 meta。以上为交接前的准备清单；实际执行边界见下方最小链与保护中止。

### 0.2.2 首次 origin 损坏时的最小链与保护中止（历史）

主代理已覆盖安装 `0.2.2-frontend/code4`，APK `09ae6215407e6b7315874fe85a50bbde323e53cd4992eca817ab8a615a6b2ef2`；交接时提供升级前完整私有备份 `var/android-backups/2026-10-17T22-31-56-229Z-before-native-preferences`，覆盖安装后启动前 215 个原文件哈希一致（主代理回执）。

`native-minimal-pin.json` 实际通过：原生 commit `{version:1,pinIds:[-102,-10]}` 得到 ACK 后不补等待立即 force-stop，冷启 API/native 都为 `[-102,-10]`；随后固定真实原 `[-10]` 通过原生 commit 恢复并再冷启验证保持。本最小脚本只操作 native 专用偏好，没有改 IDB key 或消息。

接着 `pin-native-check.json` 在任何偏好种子/合成记录写入之前执行旧消息摘要保护时发现 `preview/library` 不存在，因此中止；finally 成功确认 native 原偏好 `[-10]` 恢复。尚未执行全 pin 矩阵和草稿。

仅做一条只读 `library-presence-probe.json` 核验后确认：

- `shiye-android-telegram-v2` 数据库及 `preview` store 存在，但 `getAllKeys()` 为 `[]`，`libraryExists:false`，持久化消息数量 0。
- worker 内存会话数量 3、旧合成 `-102` 不存在，与演示 seed 状态一致。
- native/transport/UI ready 均 true，偏好存储报告 native；故不能把消息保护失败当作尚未就绪或 CDP BigInt 误判。

22:33:27Z 已明确交回 5554 给主代理核对备份与恢复；原生 `[-10]` 保持、没有编辑页/未保存正文，未从种子创建新消息或草稿。原因未定位，不能由“安装前文件 hash 一致”推出启动/kill 后库保持。聊天消息恢复和实际库保护尚未完成，整体 0.2.2 QA **未通过**；照片/日记旧轮结果不替代本次保护。真机仍未操作。

本轮所有运行仅固定 `emulator-5554`。脚本必须同时传 `--run` 和设置 `SHIYE_INPUT_QA_HANDOFF=emulator-5554`；原 0.2.1 检查后已将候选版本保护改为 0.2.2，均核对无 INTERNET 权限。旧消息只在浏览器内计算 SHA-256，返回条数与哈希；不打印正文、不截图、不清库。

本次仅验证置顶偏好 IDB ACK/立即强杀、旧 localStorage 一次迁移/空数组不复活、多段草稿保存/跨页/重开。现有日记/媒体/0.2.0 全矩阵不重复。新记录只有 `QA-INPUT-021` 合成会话，测试后保留；偏好先私有备份并显式恢复原值。

## 工具与计划

脚本 `tmp/android-input-refinement/qa/`，回执 `outputs/2026-10-17-android-input-refinement/qa/`。偏好私有备份单独放 `var/android-backups/android-input-refinement-qa/`，不把原消息/草稿导出为样本。

- `avd.mjs`：复制既有工具到新目录，输出/交接开关/CDP 19229 分离，固定 5554；不改旧测试脚本及输出。
- `scoped.mjs`：版本/权限保护、单 key 事务访问、浏览器内旧消息摘要、仅合成会话创建、保存/重开辅助。
- `contract.json`：0.2.2 当前权威为 SQLite `meta/android-chat-ui-preferences-v1`；旧 IDB `android-ui-preferences-v1` 仅迁移来源。真实首份原偏好备份固定为 `preferences-1792275725825.json`。
- `draft-check.mjs`：含中文、一个空段、两个半角空格、全角空格和 emoji 的合成草稿，按真实编辑器 `editable.editor.getText({blockSeparator:'\n'})` 语义精确比对编辑器/IDB/跨页/冷重开文字；不用 textContent/innerText/trim/strip 掩盖差异，只输出哈希、长度和状态。
- `pin-check.mjs`：要求最终 key 契约与 Promise 型 togglePin ACK；原偏好私有备份后检查置顶/取消全部的 ACK→立即强杀，旧 LS 一次迁移、显式空数组权威和未知偏好字段保留，finally 恢复原偏好。源码中 togglePin 在 readwrite 事务 oncomplete 后更新缓存并 resolve；flush 等待 pinWriteQueue。实际持久化须后续 AVD 结果，源码检查不算实测。

置顶回归将包括：现有偏好完整备份；QA 会话 togglePin ACK 后不补等待立即 force-stop，冷启顺序保持；取消全部置顶 ACK 后立即强杀不复活；仅删除偏好独立 key 并写旧 LS 合成值，冷启迁移一次；IDB 已有空数组而旧 LS 留非空时不得复活；最后恢复完整原偏好，旧消息摘要保持。迁移种子准备允许等待 LS 落盘，关键新事务 ACK→kill 用例不能靠等待通过。

## 结果与边界

首轮实际 `pin-check-attempt1.json` 已通过：新置顶 Promise ACK 后不补等待立即 force-stop，冷启 pin 与独立 IDB 值保持；未知偏好字段保持。随后清空全部阶段 CDP 断开，finally 恢复连接超时。实际核对 `adb -s emulator-5554 shell pidof` 返回 device not found，Windows emulator/qemu 进程也已不存在；Android 日志请求因设备不存在进入等待，已主动终止，不能据此认定 App 崩溃、OOM 或测试通过。主代理正在按原配置重启 AVD，不 wipe，不操作手机。原偏好私有备份 `var/android-backups/android-input-refinement-qa/preferences-1792275725825.json`，先恢复并核对原消息哈希，再重跑受影响专项。

主代理随后以原 `Shiye_API_36/5554/gpuauto/3GiB`、加 `-no-snapshot` 冷启动现有 userdata，未 wipe/回滚。Windows Application Error 近 20 分钟无 qemu/emulator 崩溃事件；旧 stderr 末尾有 ColorBuffer/Vk 日志，但没有明确退出原因，不能断言为 OOM。

恢复首份真实原偏好 `[-10]` 的 `restored-after-avd-exit.json` **未通过**：产品 togglePin/flush ACK 与 strict 独立 key 写入后，beforeRestart API 与 IDB 均为 `{version:1,pinIds:[-10]}`；立即 force-stop 后 API `[]`，IDB 回到旧 `{version:1,pinIds:[],qaFutureField:...}`。旧消息摘要仍精确保持。一次 QA 命令串在恢复失败后仍继续执行 pin --resume，使第二份“本轮 original”备份成 `[]`；其 finally true 只说明恢复第二份 `[]`，不代表原 `[-10]` 已恢复。失败回执 `restored-after-avd-exit-attempt1.json`、`pin-check-attempt2.json` 保留；后续已停止这种串行继续，恢复失败即停。

按主代理要求停止广矩阵后，`minimal-pin-evidence.json` 提供同一合成会话 `-102` 的最小证据：

1. toggle 前 API `[]`，独立 IDB `pinIds:[]`。
2. `await togglePin('-102')` 的 Promise resolved 返回 `[-102]`；紧接着 API 与真实独立 IDB 均读到 `[-102]`，未知字段保持。
3. 不补等待立即 force-stop 冷启后，API 与独立 IDB 均读回旧 `[]`，`sameAckedPreferenceAfterKill:false`。

这不是初始已置顶导致的反向 toggle，也不是把错误 `[]` 备份当原始值。此实际产品/系统持久化边界尚未定位根因，不能以 strict oncomplete 源码或 headless 通过取代 AVD 结果。0.2.1 APK `7d3c4c265efa460a916b29b3d8b6de563259c88f0ac7d0302e807a49f55de859` 的该项不能宣布修复完成。

22:26:26Z 后已将 5554 明确交回主代理，默认会话列表、当前实际偏好 `[]`，首份原偏好 `[-10]` 仍需后续恢复；合成 `-102` 保留。全部既有消息（包括用户后来写入的记录）只计算哈希核对，未输出正文/截图且哈希保持。手机未操作。草稿实际 AVD 回归、旧偏好迁移/空数组防复活/实际排序专项均尚未完成，不能记为通过。

补充实际渲染列表首位断言，使用 `#LeftColumn a[href^="#"]` 首条 href 对合成 QA ID 精确核对；等待真实排序满足，不能以固定延迟或只读 pinIds 代替。CDP 工具对已关闭连接立即失败，避免恢复阶段在旧连接白等 20 秒；这不改产品保存断言。

工具的语法检查和合成文字 5 行/1 空段/双空格/全角空格/emoji 离线检查已完成；它们不代表后续 AVD 用例通过。

待最终版交接后运行。CDP 中文插入只检验真实 Android WebView 对该文字的保存链路，不能当作中文输入法组合、候选词、语音或手机输入法实测。手机基本中文可输入仍按用户手测记录。
