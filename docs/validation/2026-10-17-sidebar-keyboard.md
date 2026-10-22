# Esc 控制原会话侧栏

2026-10-17 用户澄清：Esc 控制现有可折叠的 `#LeftColumn`，不是另一个独立会话弹窗。展开时焦点落当前会话，↑↓ 预选、Enter 切入并收起；再次 Esc 收起，不提交预选。输入区方向键保持文字编辑语义。此前手动弹窗不能作为这一需求已实现的依据。

## 已实现源码

`previews/telegram-chat/shiye-room-workspace.js` 新增 `sidebar` 模式，实际焦点放在 `#LeftColumn .ListItem.Chat .ListItem-button` 行本身。行ID由内部 `.shiye-room-settings[data-room-id]` 读取，备用 `.Avatar[data-peer-id]`；上下导航遵循既有用户排列，焦点选中不打开会话或启动倒计时。Enter 复用既有串行草稿 flush／会话切换流程，再回输入区。虚拟列表尚未挂载目标行时，滚动原列表并短时重试；收起或新用户操作取消重试。

只有真实会话行获得焦点时才处理↑↓／Enter。正文、搜索框及行内设置按钮继续各自处理这些键；IME（含结束后保护期）、图片、查看器、设置弹窗、斜杠命令和消息菜单优先。

保留四种模式：

- `sidebar`：会话侧栏，Esc展开／收起。
- `direct`：立即切换到下一会话。
- `list`：弹窗预选，停顿后进入。
- `manual`：弹窗手选，方向键选择、Enter进入。

首次迁移标记为 `shiye-room-switch-sidebar-v1`，JSON保留 `{previousMode,effectivePreviousMode}`。未有标记时记录旧值，再将原模式键 `shiye-room-switch-mode-v1` 设为 `sidebar`；已有标记后，不再覆盖用户后来选回的其他模式。原模式标识、会话ID、排列、草稿和用户会话名称保留。

`previews/telegram-chat/shiye-preview.js` 将侧栏状态统一为 `shiye-set-sidebar` 事件 `{collapsed:boolean,focusCurrent?:boolean}`；唯一 setter 更新原 `settings.sidebarCollapsed`、apply/persist、resize，再发送 `shiye-sidebar-changed`。原按钮及窄屏点行都走同一状态入口。原生回激活不会抢走已展开侧栏行的焦点；侧栏收起后不再套用这一保护，防止隐藏行残留阻碍输入区恢复。前轮35项焦点修正、命名与桌面设置保留。

## 隔离检查

- `node tmp/sidebar-toggle/verify-sidebar.mjs`：**22/22**，执行实际 workspace、wrapper setter及恢复代码，模拟底层外观apply和串行会话端口。覆盖一次迁移、后选direct保留、真实侧栏开关、当前行焦点、排列预选、Enter flush切入、Esc取消、正文／搜索／设置按钮语义、IME及五种上层UI优先、展开／收起后的激活边界、统一按钮状态、无效参数、虚拟行延迟挂载和取消、旧list/manual可选。
- `node tmp/clipboard-focus/verify-focus.mjs`：**35/35**，确认此轮wrapper侧栏焦点保护未破坏已知图片／启动／恢复用例。
- 两个源码文件 `node --check`、ESLint、Prettier通过。
- 侧栏证据：`outputs/2026-10-17-会话侧栏与黑边/sidebar-dom-result.json`；35项证据仍在 `outputs/2026-10-16-会话位置与过渡/clipboard-focus/dom-result.json`。

本子任务没有构建、打开或操作正式窗口，没有部署。DOM检查不等于原生布局、硬件按键、全部长列表虚拟滚动或正式进程已验收；UI10修订号、真实原生集成和正式切换由主会话统一记录。现有root修订号没有在此任务改动，避免覆盖主会话最终修订。

成品是两个源码与本说明；新临时文件在 `tmp/sidebar-toggle/`，新匿名证据在 `outputs/2026-10-17-会话侧栏与黑边/`。不涉及正式数据、profile或旧产物目录迁移。
