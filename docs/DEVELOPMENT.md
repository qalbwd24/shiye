# 开发与增删改查指南

本轮电脑聊天用户最新指定：Astra只做规划/必要方案审阅，Sol中负责所有代码、构建与测试执行，Sol高独立审核。额度控制优先复用现成方案与同SHA/同范围证据，仅补实际失败/新增变更路径，不重复全套验证；原有需求/交接/发布流程不变。

2026-10-19网页聊天沿本指南既有流程完善，不另起需求/审核/安装体系：需求与操作主入口[原UI需求](CHAT-UI-OPTIMIZATION-2026-10-16.md)、[原对照](CHAT-UI-REQUIREMENTS-AUDIT.md)、[原人工表](CHAT-MANUAL-CHECKLIST.md)；具体语义回写已有重编/会话管理/切房/偏好契约。截图转录、算法调研与本轮执行文档仅作证据/工作记录。截图可读反馈与用户提示词等重要，独立Sol高按原需求逐项反例审核；实现者不自批。依TESTING-POLICY按影响范围验证，再沿原desktop-control保存/快照/哈希/升级/运行回读，源码候选与正式启用分开，数据格式改动先补契约并协调安卓。

2026-10-18 同步开发接缝：独立HTTP服务与原件/持久队列已经隔离及真机联调；前端按[同步接入契约](SYNC-FRONTEND-CONTRACT.md)对齐参数、认证、库身份、基线版本、游标与本地事务，后端按[实现文档](SYNC-BACKEND-IMPLEMENTATION.md)维护持久化/冲突/状态。新18779库仅合成通信测试，不是正式主库；测试工具/证据见[验收](validation/2026-10-18-sync-device-test.md)。保留旧数据，产品Repository适配后再受控启用。

后续扩展边界（2026-10-17）：先读 [FUTURE-EXTENSIONS.md](FUTURE-EXTENSIONS.md)；便签继续当前开发和用户试用，生活管理/桌面/多端等讨论草案暂不转为实施任务，不擅自增加schema/服务或排期。入口名称按 [PRODUCT-NAMING.md](PRODUCT-NAMING.md) 的主页、思绪、随想、便签使用；保留技术路径与接口原名。

2026-10-17用户再次要求：**后续所有会话积极读写开发文档，保持开发一致。** 开工前阅读当前交接与相关模块文档；过程中及时写回需求确认、设计／接口变化、实现、失败、验收、部署和遗留事项。共享文件每次修改前重新读取，局部更新并保留并行改动；以最新用户确认及实际代码／运行证据处理旧结论，不只依赖会话记忆。产品名遵循 [统一命名](PRODUCT-NAMING.md)，跨模块状态归入 [交接](DEVELOPMENT-HANDOFF.md)。

所有会话先读 [开发进度与交接](DEVELOPMENT-HANDOFF.md)。用户明确要求积极维护开发文档：及时更新需求、实现、验收及运行状态；共享文件先重新读取、局部修改，不批量格式化其他会话正在处理的文件。聊天／托盘维护见 [命令说明](DESKTOP-MAINTENANCE.md)。

## 开始一项变更

1. 查 FEATURE-MAP，确认功能所属模块、存储字段和回归测试。
2. 用 `npm run dev` 打开独立库；正式库用于真实使用，不当作调试沙箱。自动测试只用合成样本。
3. 涉及数据结构或加密格式时，先读 DATA-MODEL，并记录兼容策略。
4. 改实现、测试、文案和相关文档；仅格式化本轮修改文件，再运行 `npm run check`。并行开发时不得用全库格式化覆盖其他会话改动。
5. 在开发界面实际完成一遍相关操作，写入 docs/validation 和 CHANGELOG。

并行开发或机器内存紧张时，可在当前测试进程设置`SHIYE_TEST_CONCURRENCY=2`再运行`npm run check`或`npm test`，允许1–32，不设置仍沿用Node默认并发。仅后台授权阶段还须设置`SHIYE_TEST_NO_DESKTOP=1`，防止原生桌面测试打开窗口。全库格式告警若来自其他会话正在改的文件，记录并另跑有限并发测试/本轮文件检查，不代改其他模块，也不能称最终整轮check全绿。

## 增加一个界面功能

原生窗口接入警示（2026-10-17 便签回归）：不能仅凭自绘按钮/离屏绘图、C#编译或网页测试认定宿主可用。改标题栏后必须检查完整Form的Dock/z-order或显式布局，确认captionBottom<=webTop；WebView子窗口可能吞边缘事件，四边四角需要独立可命中的resize区，角区不能遮住关闭按钮/正文；还需验证最大化/还原及DPI布局。完整宿主集成检查和真实鼠标验证须分开报告。明确认可的自适应材质偏好记录在 [UI-PREFERENCES.md](UI-PREFERENCES.md)，待用户决定后再合并电脑端规范。

快捷键警示（2026-10-17 用户明确要求）：不能为了新增功能随意设置默认快捷键。增加前核对 shared/hotkeys.js、快捷窗口、聊天、原生宿主和全局注册，明确焦点/弹窗/输入法作用域。优先按钮入口；便签标签快捷键默认关闭，由用户在设置中启用。折叠与目录不增加快捷键，不覆盖已有全局热键或编辑绑定。

在 `public/features/example.js` 创建工厂，让状态只保存在本模块，通过上下文调用公共能力。不要缓存 `c.library`：刷新日记库后对象会更新。

```js
/** @param {import('../core/contracts.js').FeatureContext} c */
export function createExample(c) {
  async function open() {
    await c.flush();
    const entry = c.current();
    if (!entry) return;
    c.modal('示例', `<p>${c.escape(entry.title)}</p>`);
  }
  return { open };
}
```

在 `features/index.js` 导入并初始化，注册按钮或导航；如果需要快捷键，在 `shared/hotkeys.js` 增加命令，并在 main.js 的 runCommand 中接上实际操作。仅支持把快捷键绑定到已经有行为的命令，不能只加一个名字。

需要独立视图时，参照 features/insights.js 的 render(view, root) 协议：处理自己的视图后返回 true。DOM事件处理完要刷新必要区域，避免每个按键都全量重画。

## 增加一个后端接口

在对应 routes 文件内增加分支，或新增工厂并在 src/server/app.mjs 显式注册。接口必须经过请求来源校验和访问锁。

```js
export function createExampleRoutes({ getDb, reply, fail }) {
  return async (req, res, pathname) => {
    if (pathname !== '/api/example' || req.method !== 'GET') return false;
    const entry = getDb().entries[0];
    if (!entry) throw fail(404, '暂无日记');
    return reply(res, 200, { count: getDb().entries.length });
  };
}
```

写操作使用 `await mutate(db => { ...; return result; })`。回调不要 async，不要在其中做网络或文件流操作；媒体先暂存和校验，再进入提交阶段。异常时清理自己创建的临时文件，不能按宽泛目录规则删除用户原件。上传大文件用流，JSON请求 body() 的限额不能当成媒体传输方案。

## 修改日记字段

新图文/消息格式还须遵守 [前端数据兼容合同](FRONTEND-DATA-COMPATIBILITY.md)。属性（分类/标签等）可独立更新，不覆盖正文/媒体身份/评论关系；元数据更新不刷新正文时间。旧 HTML/Markdown 继续原路径读写，新控件沿用快捷窗公共合同，不能把全部旧篇改只读或把纯处理器输出当完整 Entry。最新实际缺口/证据见该合同及 DEVELOPMENT-HANDOFF.md，接入前先验证。

依次检查：domain/entries.mjs → 前端编辑／保存序列化 → 默认值 → 历史快照 → 旧格式导入 → 新旧备份恢复 → DATA-MODEL → 对应测试。

当前 PUT 接收完整日记对象及 revision，不是局部更新。只发送 `{title: ...}` 会校验失败；省略布尔字段可能重置该字段。默认值要兼容旧库中不存在的字段，不能批量把未知字段清掉。

## 移除或停用功能

先移除装配入口与快捷键引用，再去掉不再使用的模块和API注册，运行依赖检查。已有数据字段应保留为兼容字段；停止展示某个功能不等于授权永久删除其记录、历史或附件。准备清理存储字段时，需要独立迁移方案、迁移前备份和可恢复测试。

只有在确认旧备份仍可读取时，才考虑废弃旧恢复路径；新旧备份协议不能随界面按钮一起删掉。

## 代码约定与检查

- 原生 ES modules；文件按职责命名，使用明确 export。工具不放在运行入口，不把个人路径、备份文件名、PID写入可重用源码。
- 2空格缩进、单引号、分号、UTF-8、LF；PowerShell构建脚本为兼容系统 Windows PowerShell 使用 UTF-8 BOM。
- ESLint 检查未定义／未使用变量、不可达代码、常量条件和严格比较。Prettier负责格式；它不代替功能测试。版本已固定在 package-lock.json，参照 [Prettier 官方安装说明](https://prettier.io/docs/install)。
- 运行时仍只需 Node；ESLint、Prettier 和 globals 是开发依赖，不能被浏览器或服务代码导入。
- 注释解释接口约束、数据口径和必要原因；不要逐行复述代码。新增配置只在实际被使用时添加，不建立空的通用框架。

目前没有自动 Git 提交、远程仓库或 CI 发布。忽略规则已准备好；启用版本控制时，应先检查文件清单是否包含任何真实数据。

## 0.6 后续维护入口

当前模块边界和原版差距见 ITERATION-0.6.md / FEATURE-PARITY.md；历史章节的旧路径不再作为新代码落点。通用升级工具为 tools/upgrade.ps1，必须从已验证的开发工作区运行，提供 SourceRef 和 ExpectedVersion；升级前核对正式编辑保存状态。工具检查正式Git状态和服务进程，保存快照、切换发布分支、启动并核对版本。
