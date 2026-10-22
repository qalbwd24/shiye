# 快捷记录并行开发交接

2026-09-22。依据 [已确认需求](QUICK-CAPTURE-REQUIREMENTS.md)。0.9.1 已接入主入口、共享编辑器和保存队列，并已启动正式本地服务；本文保留接口合同和后续边界，便于继续维护。

## 文件和职责

| 文件                                       | 职责                                                           |
| ------------------------------------------ | -------------------------------------------------------------- |
| `public/features/category-picker.js`       | 独立 native dialog，返回分类名称或取消；不创建日记、不写偏好   |
| `public/shared/category-picker.js`         | 统一排序、搜索、键盘选择模型；每次操作读取实时库               |
| `public/styles/category-picker.css`        | 组件限定样式；需由入口显式加载                                 |
| `public/shared/quick-capture.js`           | 有效内容、编辑历史追溯、三方版本比较的纯规则                   |
| `public/features/quick-capture-session.js` | 新建、上一篇、主窗口跳转、正常关闭的流程适配层；不替代保存队列 |
| `tests/category-picker.test.mjs`           | 分类模型 6 项测试                                              |
| `tests/quick-capture.test.mjs`             | 内容、历史、冲突及窗口流程 15 项测试                           |

## 分类弹窗接口

```js
const picker = createCategoryPicker({ getLibrary: () => currentLibrary });
const category = await picker.open(); // string | null
picker.refresh(); // 库发生分类变化时调用
picker.cancel();
picker.destroy();
```

使用现有 `sortedTaxonomy`，默认高亮 `settings.preferences.defaultCategory`，失效时回到排序后首项。默认标记不改变顺序。搜索、↑↓环绕、Enter、Esc、输入法组词保护、焦点恢复均独立于编辑器。若确认前分类被移除，先显示最新选项，要求再次确认，不能悄悄确认另一个分类。空库不凭空创建分类。

本批仅读取默认分类，后端目前尚不接受该偏好，也没有设置入口。接入时需补偏好验证、重命名/合并/删除后的默认值维护；主入口、过滤器、模板等现有分类控件仍需逐一统一排序。

## 快捷窗口流程适配

`createQuickCaptureSession(c)` 返回 `newEntry()`、`previous()`、`openMain()`、`close()`、`editedAndSaved(entry)`、只读 `busy`/`lastError`。异步失败向调用方抛出，必须明确显示；忙时重复导航返回 `{status:'busy'}`。

依赖由正式入口注入：

- `freeze()`：暂时停止编辑器输入，返回恢复函数；不能把分类弹窗一起锁死。跳转失败恢复交互；正文聚焦在恢复之后执行。
- `flush()`：沿用共享保存队列，先提交 CodeMirror 当前文档，再完成输入法组词，等待当前快照持久化；冲突或错误必须 reject。保存成功回调若需写快捷历史，也必须等待 `editedAndSaved` 完成。
- `chooseCategory()`：调用分类弹窗，取消必须返回 null。
- `mountNew(category)`：准备尚未落库的文档。不得立即调用 POST；模板和自动缩进不是实际用户编辑。
- `mountEntry(id)`、`focusBody()`、`current()`：复用唯一编辑器的读取与文档切换接口。
- `persistedId()`：仅返回已经落库的 ID；不能返回草稿临时 ID。
- `getHistory()`、`setHistory(ids)`：读写快捷编辑历史，只有 ID，没有正文；持久化失败不能悄悄吞掉。组件内部串行写入，跨窗口还需宿主统一协调。
- `getAccessibleEntries()`：返回刷新后的、当前权限可访问的记录。上一篇按快捷历史向更早处追溯，跳过空白/删除/缺失项，不修改被跳过的日记，也不在两篇间循环。
- `openMain(id)`：由桌面壳复用主窗口并定位同一 ID；未保存空白草稿返回 empty，由 UI 提示先输入，不能为了跳转创建空白。
- `cancelCategory()`：原生 X 在启动分类选择期间调用，取消等待中的选择并继续关闭，不创建空白记录。
- `closeWindow()`：只有 flush 成功后才能请求真实窗口关闭。

`editedAndSaved` 只能由实际用户编辑成功保存后调用，挂载、聚焦、默认分类和空白启动不得调用。仅标题或附件有内容属于有效记录。模板默认正文是否变化要由保存适配器与初始快照比较，不能只凭 `hasQuickContent` 决定创建。

## 版本比较接口与安全边界

`compareQuickVersions({base,local,saved})` 只给出判定，不执行写入：

- `adopt-saved`：内容一致，或库里有基线快照且本窗口没有独立改动。
- `save-local`：可靠基线证明只有本窗口的内容发生变化；仍须携带最新 saved.revision 请求，不能无条件覆盖。
- `conflict`：双方不同、记录缺失/不一致、无基线或历史证据不足。

base 必须是最后一次服务端确认的快照；saved 及其 history 必须从当前库读取，不能用客户端自己拼出的历史当服务端证据。历史最多 20 项，找不到基线时保守交给用户选择，不凭时间或文字包含关系猜测。

比较包含标题、权威正文格式/源码、日期、分类、标签、附件顺序、心情/天气/地点及状态；Markdown 的派生 HTML、更新时间和单独管理的评论不触发正文冲突。新增可编辑字段时同步维护这份比较合同与测试。采用副本或本窗口版本时，最终写入必须由后端保留评论、原格式字段等，不能拿 canonical state 替换完整对象。

尚未实现冲突对比弹窗、覆盖前快照、另存关联、再次 revision 校验的交互。模块测试通过不代表冲突处理整条链路完成。

## 下一步接入顺序

1. 编辑核心稳定后，接入默认分类偏好与所有分类排序；正式新建和快捷新建共用弹窗。
2. 扩展共享保存队列，支持内存草稿、实际编辑后首次创建、清空本次新篇后的可恢复处理、请求结果未知时的幂等防重。已有记录清空不能自动删。
3. 接入版本比较和冲突选择 UI，覆盖前留历史，处理第三次并发修改与另存一篇的关联。
4. 桌面宿主提供可等待保存的关闭协议，以及窗口复用、置顶/位置/尺寸记忆、主窗口记录定位；快捷编辑历史按库隔离并持久化。
5. 端到端验收后再更新版本、运行完整检查、生成升级快照并按项目约定启动新版。

快捷窗口由 `desktop/QuickCapture.cs` 承担关闭握手：原生 X 只发送 `request-close`，网页完成提交、保存和冲突检查后回传 `close-ready`；失败回传 `close-failed` 并保留窗口。普通网页的 beforeunload 仍不能保证等待异步保存，因此不要用浏览器标签页关闭流程代替该协议。本批没有额外造一套编辑器或自动保存定时器。

## 本批验证

见 [隔离验证记录](validation/quick-capture-foundation-2026-09-22.md)。隔离测试不读取生产日记；随后在隔离浏览器验证了分类选择、实际输入自动保存和取消新建不增空白记录。本轮新增了“分类选择期间 X 取消并关闭”“关闭前提交 CodeMirror 文档”和“快捷页重复同步正文”的处理；206 项检查全部通过，正式服务已按项目约定重启并核对 `/api/health` 为 0.9.1。
