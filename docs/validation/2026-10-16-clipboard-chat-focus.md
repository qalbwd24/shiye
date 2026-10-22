# 聊天图片确认说明框焦点

2026-10-16。用户确认：Win+V 选图片后，希望图片发送确认窗中的说明输入框可以直接继续输入。

## 原因与实现

`previews/telegram-chat/shiye-preview.js` 原有媒体观察器在发送按钮就绪 500ms 后强制聚焦发送按钮，覆盖 AttachmentModal 自带的说明输入框自动焦点。宿主 `DesktopPreview.Activated` 回激活会派发 `shiye-resume`，旧恢复逻辑又保留弹窗中已有的关闭／发送按钮焦点。

修正仅限自有适配层：首次、未操作的图片确认窗默认选择 `#editable-message-text-modal`；说明框准备好后的首个 100ms 检查立即聚焦，之后 500ms 稳定窗口内仅对未交互弹窗兜底，不再等待 500ms 才首次聚焦。Win+V 返回对应的恢复事件也优先选择此说明框。已有文字只在首次无人操作时将光标放末尾。用户开始输入、按键、鼠标操作或中文组词后，保留其主动目标和选区，迟到计时器不能抢走焦点。其他弹窗、按钮左右键及 Enter/Esc 行为保留；发送／取消后的主输入框末尾恢复继续走已有逻辑。

## 已验证

- `node --check previews/telegram-chat/shiye-preview.js` 通过。
- 单文件 ESLint 与 Prettier 通过。
- `node tmp/clipboard-focus/verify-focus.mjs`：12 项隔离 JSDOM 行为通过，覆盖初始说明框／继承草稿末尾、首 100ms 就绪聚焦、首 100ms 用户操作／组词保护、Win+V 对应恢复事件、快捷键恢复、用户按钮选择、输入选区、组词保护、后续恢复选区、普通弹窗。
- 证据：`outputs/2026-10-16-会话位置与过渡/clipboard-focus/dom-result.json`。

## 集成验收入口与边界

`tmp/clipboard-focus/native-helper.js` 提供 `window.shiyeVerifyClipboardFocus`。只注入 `--verify` 的虚构 profile；调用参数 `{openImage, input, native, trustedClick, wait, until, expect}`。其中 `openImage` 复用现有测试生成的 `File` 与编辑器 `.files([file])`，`native`／`trustedClick` 可复用 `shiyeVerifyInput` 返回的桥。入口包含原生 Chromium 输入、说明框中移动光标后恢复、发送后恢复、主动切取消与取消后恢复。

2026-10-17主会话已将helper装配到verify-responsive.js并在原生WebView2中执行：生成图片后说明框默认焦点、模拟宿主返回事件、原生Input.insertText在继承草稿末尾续写、ArrowLeft后选区保持、发送后主输入框恢复、主动取消按钮保留焦点及取消后恢复均通过。报告中clipboardFocus=true；各轮完整报告随总验收封存，聊天其他需求出现失败不据此抹掉或扩大本项结论。

没有读取真实剪贴板历史或操作正式草稿；原生集成使用生成的File并派发与宿主Activated一致的恢复事件，不能据此声称Windows实际Win+V面板、物理回激活完整链或硬件IME已验收。这些仍需人工操作确认。子任务只负责实现及DOM检查，候选构建、原生检查与正式升级均由主会话统一记录。

源码为 `previews/telegram-chat/shiye-preview.js`；临时脚本在 `tmp/clipboard-focus/`，匿名证据在 `outputs/2026-10-16-会话位置与过渡/clipboard-focus/`。

## 2026-10-17 U37：聊天窗口首开与普通激活

新增 `shiye-startup-focus` 事件，供原生宿主首次 ready 后使用。与热键恢复复用 100ms 重试、最多 10s 的焦点恢复；主输入框须已成为 `contenteditable=true` 才定位草稿末尾一次。若有当前会话，等待其输入框挂载，不换掉已有草稿；没有当前会话时优先已有 selected 行，再选择首个会话。首次 ready 前用户已经操作则让位；后续指针、按键、输入或组词会立即终止重试。

普通 `shiye-resume` 增加主输入框兜底与延迟挂载重试，不再仅依赖曾经聚焦的 `lastEditor`。主输入框已活跃时保留光标；其他文字输入框、弹窗、菜单、看图和 IME 保留其焦点语义。热键恢复仍按 U11 末尾续写，但非折叠的手动选区不跳尾。图片确认窗继续优先说明框，保留前轮交互保护。

单文件语法、ESLint、Prettier 通过；隔离 DOM 总计 **27/27**，包含此前 12 项图片说明框回归，以及首开焦点、首次用户让位、普通激活兜底、可编辑就绪、挂载重试、当前会话草稿保留、无选中会话兜底、输入区光标／选区、搜索框、菜单与 IME 保护。脚本和匿名证据沿用上方路径。原生宿主事件、集成检查和部署由主会话统一负责；此处通过结果仍仅限 DOM 与静态检查，不扩展为硬件或正式运行验收。

## 2026-10-17 集成失败后的明确焦点意图修正

主会话在 `native-ui-check-other-window-activation.json` 的第二次生成图片流程中复现失败：主动聚焦“取消”并按左键，等800ms后派发恢复事件，焦点回到说明框。此前通过记录保留为当时的结果，不代表本轮原生复跑没有失败。

本轮在 DOM 验证中加入同样的“取消→ArrowLeft→模拟迟到的说明框自动焦点→恢复事件”顺序，旧码稳定失败。原因不是 `WeakSet` 忘记操作，而是它只记录“有过操作”，恢复时仍直接相信当前 `activeElement`；独立的 Teact/MessageInput 自动聚焦一旦迟到，就覆盖了用户目标。此前 DOM 场景没有注入这次框架自动聚焦，因此漏掉竞争。

修正为按弹窗用 `WeakMap` 记明确用户目标，只在指针、输入、按键和组词事件更新，不把普通 `focusin` 当成新意图。左右键记录实际目的按钮，Tab的keyup记录真实落点；恢复事件优先有效的用户目标。说明编辑区可恢复上次明确用户事件留下的Range，但仅在原节点和边界仍有效时使用；重绘造成节点或边界漂移就放弃该快照。当前组词、菜单以及后续真实用户操作继续优先；初始计时器在有交互后仍不持续聚焦。

新增8项竞争／意图检查：迟到框架焦点、后续操作覆盖早期意图、左右键目的按钮、Tab落点、明确选区恢复、失效目标、重绘Range安全、组词优先。当前 **35/35 DOM检查**，单文件语法、ESLint、Prettier通过。原生竞态复验由主会话统一重新构建后执行，本子任务没有构建／启动／部署，不将DOM通过记为原生已通过。
