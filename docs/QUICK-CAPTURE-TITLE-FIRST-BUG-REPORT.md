# 快捷记录窗口“先写标题后写正文”问题说明

历史说明：本文复现与代码分析针对 0.9.1。当下 main.js 已在身份变更时调用 bodyEditor.syncIdentity；0.9.11 使用隔离真实界面复核“先标题等待保存→正文→重开”通过。以下保留当时证据，不应据此认定现版仍缺该调用。

> 这份文档用于交给另一位 AI 做独立复核。请先按本文档复现和定位，再决定是否修改代码。文档只描述本地项目和隔离测试，不要求连接官方服务器，也不要直接改生产数据。

## 1. 项目和运行位置

- 项目根目录：`F:\<正式目录>`
- 主程序：`F:\<正式目录>\拾页日记.exe`
- 快捷记录程序：`F:\<正式目录>\拾页快捷记录.exe`
- 前端静态代码：`F:\<正式目录>\public`
- 测试：`F:\<正式目录>\tests`
- 文档：`F:\<正式目录>\docs`
- 当前 `package.json` 版本：`0.9.1`
- 默认本地服务：`http://127.0.0.1:18765`
- Node.js：`D:\软件\Apps\NodeJS\node-v24.18.1-win-x64\node.exe`

主要相关文件：

```text
public/app/main.js
public/editor/body-editor.js
public/editor/persistence.js
public/features/quick-capture-window.js
public/features/quick-capture-session.js
tests/quick-capture.test.mjs
tests/quick-persistence.test.mjs
```

## 2. 用户可见现象

在快捷记录窗口中按以下顺序操作：

1. 打开快捷窗口，每次打开都是新建草稿。
2. 选择“日常”等分类。
3. 先输入标题，等待状态显示“已保存到本地”。
4. 再点击正文并输入文字。

现象：

- 正文在屏幕上看得到，光标也正常移动；
- 底部字数仍是 `0 字`；
- 状态仍显示之前的“已保存到本地”；
- 服务端没有收到正文更新，重新打开或关闭窗口后正文丢失；
- 一开始直接输入正文时，字数统计和保存通常正常。

这不是单纯的“关闭窗口没有触发保存”，而是标题先保存后，正文编辑器仍绑定到旧的草稿 ID。

## 3. 安全的隔离复现

不要使用生产数据目录。建议在项目的 `var` 下创建临时目录并使用未占用端口：

```powershell
$root = 'F:\<正式目录>'
$node = 'D:\软件\Apps\NodeJS\node-v24.18.1-win-x64\node.exe'
$isolated = Join-Path $root 'var\quick-title-first-test'
New-Item -ItemType Directory -Force -Path $isolated | Out-Null

Set-Location $root
& $node '.\src\server.js' '--port=18767' "--data-dir=$isolated"
```

如果当前服务启动参数有变化，以 `package.json` 和 `src/server.js` 为准；关键要求是端口使用 `18767`、数据目录使用上面的隔离目录，不要覆盖 `data`。

浏览器打开：

```text
http://127.0.0.1:18767/?quick=1
```

复现完成后只需停止该 Node 进程。隔离目录可以保留供核对，不要删除生产目录。

## 4. 已确认的复现结果

在版本 `0.9.1` 的隔离服务上按“分类 → 标题 → 等待保存 → 正文”操作：

- 标题能进入服务端；
- 正文在 CodeMirror 画面上可见；
- 字数仍为 `0 字`；
- 服务端条目只有标题和初始正文占位符：

```json
{
  "revision": 1,
  "title": "标题先写测试我用",
  "contentFormat": "markdown",
  "markdownSource": "　　",
  "content": "<p>　　</p>\n"
}
```

该路径在浏览器中可稳定复现，与原生窗口、荣耀投屏或输入法无关。直接先输入正文的路径曾经可以更新字数并保存，所以两种顺序都必须测试。

## 5. 关键代码和根因

### 5.1 编辑器保存前的身份检查

`public/editor/body-editor.js` 中有以下状态和保护条件（行号可能因格式化变化，搜索变量名即可）：

```js
let view = null,
  entryId = null,
  sourceMode = false;
```

正文同步函数先读取当前条目，并拒绝 ID 不一致的更新：

```js
const entry = c.current();
if (!view || !entry || entry.id !== entryId || entry.deleted) return false;
```

`render(entry)` 会把 `entryId` 设置为当前条目的 ID：

```js
entryId = entry?.id || null;
```

保护条件本身合理，问题是草稿换正式 ID 后没有同步更新编辑器的 `entryId`。

### 5.2 草稿 ID 转正式 ID 后编辑器身份过期

`public/app/main.js` 的快捷新建流程先生成类似 `draft-<token>` 的临时 ID。标题输入调用 `markDirty()`；`public/editor/persistence.js` 首次保存后拿到正式 UUID，并调用：

```js
onIdentity(entry, oldId);
```

`main.js` 当前身份回调主要更新选中项：

```js
async onIdentity(entry, oldId) {
  if (selected === oldId) selected = entry.id;
  // 其他列表或界面状态更新
}
```

它没有通知 `bodyEditor` 更新内部 `entryId`。同时保存回调在编辑器仍聚焦时会跳过重新渲染：

```js
if (current() === entry && document.activeElement?.closest?.('#editorPanel') === null)
  renderEditor();
```

最终状态分裂为：

```text
当前条目的 entry.id       = 正式 UUID
bodyEditor.entryId        = 旧的 draft-UUID
```

后续 CodeMirror 变化进入 `syncDocument`，命中 `entry.id !== entryId` 后返回 `false`。因此正文没有更新 `markdownSource`、`content`，也没有触发 `markDirty()`、字数统计和 PUT 请求。画面仍显示 CodeMirror 自己的文本状态，形成“看得到但没有保存”的假象。

### 5.3 旧测试为什么没有抓到

已有持久化测试主要是直接改内存中的 `entry.content` 后调用保存逻辑，没有真实模拟：

```text
标题输入 -> 草稿 POST -> 临时 ID 改成正式 UUID -> 保持编辑器焦点 -> 正文输入
```

因此单元测试可以通过，但没有覆盖 UI 生命周期和 ID 变更时序。焦点判断会掩盖问题，但首要根因是编辑器身份没有原子更新。

## 6. 交给其他 AI 的排查任务

请先只读检查，不要马上重写编辑器：

1. 确认 `bodyEditor` 的内部 ID 在 `onIdentity` 后是否仍是旧的 `draft-*`。
2. 确认标题保存后再输入正文时，`syncDocument` 是否因 ID 不一致返回 `false`。
3. 确认该路径没有调用 `onContentChanged`、`markDirty` 和字数统计。
4. 确认服务端只收到标题 POST，没有正文 PUT。
5. 对比直接先写正文、先写标题再写正文、标题和正文快速交错三种路径。

调试时只记录 ID、事件名、请求方法、状态码和时间戳，不要把真实日记正文写入日志。

## 7. 建议补充的回归测试

测试应使用隔离数据目录，至少覆盖：

| 场景                             | 需要验证                                         |
| -------------------------------- | ------------------------------------------------ |
| 直接输入正文                     | 字数、`markdownSource`、服务端内容和重开结果一致 |
| 先标题，等待自动保存，再正文     | 正文触发统计和 PUT，重开不丢失                   |
| 标题和正文快速输入               | 最终标题和正文都保留                             |
| 草稿 ID 转正式 ID 后继续输入     | 编辑器身份与当前条目一致                         |
| 输入正文后直接点 X               | 有内容时自动保存；空白草稿不保留                 |
| Alt+T、回车自动缩进、中文输入法  | 不影响同步和字数统计                             |
| 主页面和快捷窗口同时打开同一条目 | 不出现旧版本覆盖新版本                           |

每个场景检查四层结果：画面文本、字数显示、网络请求/服务端条目、关闭后重新打开的内容。

## 8. 修复方向和验收标准

建议把条目身份变更做成编辑器可观察的原子事件，二选一：

- 编辑器绑定条目对象或可变引用，不把临时 ID 复制成不可更新的状态；
- `onIdentity(entry, oldId)` 成功后显式调用编辑器 API 更新内部 ID，并确保后续正文输入只绑定新 ID。

不要简单取消 `entry.id !== entryId` 检查来掩盖问题，否则可能让旧编辑器向新条目写入数据。

验收要求：

1. 标题先保存后继续输入正文，字数立即更新。
2. 正文输入后出现新的保存状态，并在服务端产生正文更新。
3. 关闭快捷窗口再打开，标题、正文、日期格式和缩进都存在。
4. 空白新窗口直接关闭不会留下空白日记。
5. `npm run check` 全部通过，并且包含真实 UI 时序测试。

## 9. 当前结论

目前不需要把主页面改造成多开窗口才能解释这个问题。主页面和快捷窗口可以同时存在，但必须共享同一套条目仓库、身份变更通知、保存队列和冲突策略。当前已确认的是快捷窗口在“草稿转正式条目”时编辑器身份过期；先修复这个生命周期问题，再评估多窗口并发编辑和冲突合并。

本说明文档本身不修改业务代码、不迁移数据、不删除任何原始文件。
