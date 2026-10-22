# Android 本地状态与输入边界优化

2026-10-17 用户已授权安装0.2.0到Magic7并开始自行手测，随后明确要求开发代理在电脑优化；用户确认“手机上可以中文输入”。基本中文输入记为用户手测已确认，不重做输入方案，也不将其扩大为全部输入法交互已验。

本轮保持手机0.2.0供用户测试，只在电脑改安卓源码/构建并用 `emulator-5554` 验证。禁止操作用户手机、修改其输入法或覆盖当前手机App。主目标是修复已有明确边界：置顶偏好立即强杀落盘、多段中文草稿跨页保存比对；不扩展服务器、便签、AI或电脑正式运行版。

可维护代码仍在 `android/`；新产物 `outputs/2026-10-17-android-input-refinement/`，临时 `tmp/android-input-refinement/`。0.2.1 的置顶 IDB 方案在真实 Android WebView 冷启失败，现转为 0.2.2 原生偏好权威候选；构建/安装和真实 AVD 回执以[总验收](validation/2026-10-17-android-input-refinement.md)为准，不由 headless 通过推定 Android 已修复。

## 0.2.2 原生置顶权威与桥契约

真实失败证据为 `qa/minimal-pin-evidence.json`、`qa/restored-after-avd-exit.json` 和 `qa/independent-strict-idb-probe.json`：Android WebView 133 中，togglePin/strict IDB oncomplete 与即时独立读均成功，立即 force-stop 冷启后却回到旧值；独立新 key 也消失。旧 headless Chrome 的强杀通过不能替代这项 Android 失败。只读审查没有发现适配启动用旧缓存覆盖已存在 key 的路径；不能仅凭这些证据给出具体 WebView 内部根因。

### 后续发现：原 origin 的 LevelDB 损坏检测与重建

主任务随后读取 Android 日志，确认 **22:32:45、0.2.2/code4 首次启动**已有 `backing_store.cc:195 Failed open LevelDB ... Corruption: missing start of fragmented record(2)`、`bucket_context:1072 Got corruption` 与 `backing_store:1500 recovering from corrupted(and deleted)database`。这说明旧 origin 的 IndexedDB 底层在该次启动被检测损坏并重建；检测发生在随后 native 最小置顶链之前，不能归因成“原生偏好方案删除消息库”。具体损坏何时、为何产生尚未确立，不能仅凭此前强杀或 AVD 退出推定内部写入根因。

主任务的私有目录比对：22:10 原备份有 `000004.log` 23,805 bytes 与 `000005.ldb` 24,095 bytes；22:31 原生升级前备份仍为同一 ldb、log 为 64,689 bytes；当前重建库出现新 LOG #3。native 最小 ACK→立即 force-stop 链本身已通过并恢复原置顶 `[-10]`，随后旧消息保护检查却发现 `preview.getAllKeys()=[]`、`library` 缺失，页面内存仅 3 个 seed 会话，因此 QA 停止。该阶段的原生置顶通过不能扩大为消息库保护通过。

适配代理只读复核了实际冻结产物与对应源码：0.2.0 和 0.2.2 的主 worker 去网络 guard 前缀后，正文逐字等于同一 ui18 冻结文件加既定三项字符串变换，SHA-256 都是 `4e5f479113ba941e5970e6485230bab08c480eec8842abc31acda640068e1d49`；两份运行字节都只使用一次 `shiye-android-telegram-v2`，没有旧库名残留，主 worker 无 `deleteDatabase` 调用。`loadLocalPreview()` 只读 `preview/library`；缺失时采用内存 seed 并迁移内存会话，不立即写 seed。list/flush 不写 library；既有保存链只 `put(snapshot,'library')`，没有 clear/delete。因而“空 store＋内存 3 seed”的现象与底层重建后 fallback 一致，静态证据不支持本轮改变 namespace 或新 native 代码删库。

此为发现时的阶段记录：主任务保留 22:10、22:31 两份完整私有 tar 并接管取证，计划仅恢复 22:10 原 origin 的 IDB 目录，不回滚 SQLite/日记，再核验原消息 hash。后续恢复动作、结果及原消息是否完整均由[总验收](validation/2026-10-17-android-input-refinement.md)续报；本适配代理没有执行恢复、ADB 或源码变更。

0.2.2 置顶**唯一权威**改为原生 `LocalStore.meta` 的 `android-chat-ui-preferences-v1`，值仍为完整 `{version:1,pinIds:[会话ID],...未知字段}`。主任务实现的现有 WebMessagePort 桥在原生串行 IO 的 `LocalStore.dispatch()` 真正结束事务后才回 ACK。本适配只使用两个接口：

- `window.shiyeAndroidPreferences.load()`：返回完整偏好对象；确实尚无原生值时返回 `null`，不包一层 `value`。
- `window.shiyeAndroidPreferences.commit(value)`：返回完整、实际已提交的偏好对象；保存失败 reject。适配正常流程不传 `null`。

原生设置接口后派发 `shiye-native-preferences-ready`。适配先检查接口是否已存在，否则等待该事件，避免建立时序丢失；无接口 12 秒明确失败，不切回浏览器存储伪造成功。`snapshot.ready` 仍要求偏好初始化完成，新增 `preferenceStorage:'native'`；聊天消息的 `storage:'indexeddb-only'` 继续仅指原 Web A 消息库。

初始化先 `load()`。原生存在的空数组直接采用；只有原生返回 `null` 才只读旧 IDB `preview/android-ui-preferences-v1`，旧 key 存在的 `[]` 优先，旧 key 缺失才读原 localStorage，然后 `commit()` 一次迁移。旧 key 与缓存保留，不删除来源；迁移失败不发布新缓存。后续每条串行变更均读取当前原生对象、保留未知字段、仅修改 pinIds，等待 native commit 回执后才更新内存/排序缓存及 resolve。**适配不再写 IDB 置顶 key**；旧 key 仅迁移来源，不能把原生与 IDB 双写并称为双权威。`togglePin()` 与 `flush()` 均等待原生提交队列，多段草稿的 Tiptap/实际 IDB/worker 回执链保持。

`telegram/native-preferences-mock-check.json` 实际 **13 项 assert** 通过、退出 0、无页面异常。覆盖接口缺失不 ready/不回退、晚到事件、一次迁移/空数组优先、串行变更、native ACK 前 pin/flush/缓存不提前成功、失败拒绝/重试、旧 IDB key 后续不写、原生空数组刷新权威、未知字段与多段草稿。该测试用明确标记的 Node 文件后端模拟 load/commit 契约，`androidVerified:false`；它验证页面接缝，不声称原生 SQLite 事务或 Android 强杀已验。真实桥、meta 内容与强杀恢复由主任务 AVD QA 验收。

## 0.2.1 IDB 候选与历史 headless 回执（Android 冷启失败）

实现限定 `android/telegram-adapter/`。继续冻结 ui18 静态资源，没有引入桌面 ui20 或其他并行候选，没有修改消息 worker、library、IDB 版本、原生 SQLite 或正式日记。本代理未操作手机或任何 AVD；主任务的构建、0.2.1 模拟器安装和后续 QA 以[总验收](validation/2026-10-17-android-input-refinement.md)为准。

置顶唯一权威改为已有 IndexedDB `shiye-android-telegram-v2` 的 `preview` store 中独立 key `android-ui-preferences-v1`，值为 `{version:1,pinIds:[会话ID],...原有未知字段}`。不将偏好写进 `library`。初始化只有 key 缺失时才从旧 localStorage `shiye-android-pins-v1` 迁入；已提交的 `pinIds:[]` 表示用户主动全部取消，优先于任何旧缓存。所有置顶变更串行执行，使用 `readwrite`/`durability:'strict'` 事务，收到真实 `transaction.oncomplete` 后才更新内存和 localStorage 排序缓存并返回 `togglePin(id)` 的 Promise。失败保留旧权威值与旧缓存、明确 reject；显式重试可继续队列。`flush()` 在开始和最终 worker ACK 前都等待置顶写队列。排序仍沿用 `shiye-room-order-v1` 与 `shiye-room-order-changed`；localStorage 只是该接口需要的可重建缓存，不是第二份可编辑权威。`snapshot.ready` 同时要求偏好初始化完成，状态另有 `preferencesReady`。

多段草稿先在 412×780 Android UA/触摸 headless 中复现：保存的 `DraftMessage.message` 实际正确，旧 DOM `textContent` 丢失 `<br>`，`innerText` 又多出 ProseMirror 尾部占位换行，导致旧 flush 超时。现直接读取现有 Tiptap：`document.querySelector('#editable-message-text').editor.getText({blockSeparator:'\n'})`，与实际 IDB 草稿逐字符相等后再取得 worker `writeQueue` 的 `flushed` ACK；仍等待真实待发送消息完成。没有 strip/trim、折叠空白或重写保存正文。UI 的 `draft.isLocal` 是临时状态，重复触发草稿刷新会再次置真，不能代替持久化回执；本轮以实际 IDB 字符串和 worker ACK 为依据。

下列是 0.2.1 旧 IDB 方案的历史电脑回执，不能作为 0.2.2 原生架构的验收，也不能覆盖上述 Android 冷启失败。两份脚本当时均真实执行断言、退出码 0、`errors:[]`、无 `failure` 字段：

- `telegram/pin-storage-check.json`：**15 项 assert**。包含缺失 key 迁移、并发变更串行、延迟真实事务时 pin/flush 均不提前 resolve、strict 完成回执、写失败保留缓存且 flush 拒绝、重试恢复、空列表不被旧缓存复活、未知字段保留、中文多段精确保存、双空格差异和空段差异均拒绝 ACK、ACK 后立即强杀本轮专用 Chrome 并重开、真实列表置顶首位恢复、library SHA-256 保持、中文草稿全部空白重开保持、无页面异常。
- `telegram/refinement-check.json`：**6 项 assert**。软换行草稿 flush 成功、存储与文档逐字符一致、双空格/全角空格保持、空行与真实尾部 hardBreak 保持、展示占位 trailingBreak 不参与比较、无页面异常。

立即强杀检查只结束该脚本创建的独立 headless Chrome PID，不操作其他浏览器、模拟器或手机。其重开后的实际会话顺序为 `-20/-10/-30`，置顶 `[-20]`；强杀前后合成 library SHA-256 同为 `b82f9e8231b55da6777d47367b5436eb04434ed36da11eeba6728e59bea5f128`。这是电脑浏览器事务/生命周期回归，不代替真实 Android WebView、掉电或全部中文 IME 验收；基础中文输入由用户真机确认，不在本轮重新实现。

## 新资源与重建入口

可打包 assets 根为 `tmp/android-input-refinement/telegram-build/assets`，入口仍 `/telegram/index.html`。当前 0.2.2 适配清单 `outputs/2026-10-17-android-input-refinement/telegram/build-manifest.json` 的 `atUtc` 为 `2026-10-17T22:30:11.115Z`，SHA-256 为 `9fd246a9f045257cb6a44a80b4ee5feafd675cfdba4e4b895388bc852ef24d07`。失败 0.2.1 的旧清单编号为 `5daa88596223700d659882eba726236c271e6378d29c1fdaf610db1b21820a56`；旧 APK 和真实失败回执由主任务保留。0.2.0 独立清单 `47473f3ff980a4e8d1f0c07e5e31c7900be791df713507bee687462e47d70c97` 未覆盖。

以下命令工作目录均为 `D:/拾页`：

```powershell
node android/telegram-adapter/build.mjs --work-dir tmp/android-input-refinement/telegram-build --output-dir outputs/2026-10-17-android-input-refinement/telegram
node android/telegram-adapter/build.mjs --adapter-only --work-dir tmp/android-input-refinement/telegram-build --output-dir outputs/2026-10-17-android-input-refinement/telegram
node android/telegram-adapter/verify-native-preferences.mjs
```

`build.mjs` 对新参数核对绝对目标必须在项目 `tmp/` 与 `outputs/` 下。首次完整生成后，只更新适配资产可用第二条；不会改共享 vendor 或正式安装。源文件均已单独 Prettier，适配目录 ESLint 通过；全项目检查由主任务执行。原失败复现 `telegram/draft-baseline.json/png`、正向 `draft-fixed.png`、强杀重开 `pin-force-restart.png` 保留在本轮 outputs；独立浏览器 profile 和打包中间件留在 `tmp/android-input-refinement/`。

`verify-refinement.mjs`、`verify-pin-storage.mjs` 为前述 0.2.1 浏览器权威历史脚本，不能直接拿当前需要原生 API 的适配资产运行并解释为同一架构；0.2.2 桥契约请使用新增 mock 脚本，真实 Android 则按总验收中的专属 QA 入口。
