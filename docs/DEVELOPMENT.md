# 开发与增删改查指南

## 开始一项变更

1. 查 FEATURE-MAP，确认功能所属模块、存储字段和回归测试。
2. 用 `npm run dev` 打开独立库；正式库用于真实使用，不当作调试沙箱。自动测试只用合成样本。
3. 涉及数据结构或加密格式时，先读 DATA-MODEL，并记录兼容策略。
4. 改实现、测试、文案和相关文档；运行 `npm run format`，再运行 `npm run check`。
5. 在开发界面实际完成一遍相关操作，写入 docs/validation 和 CHANGELOG。

## 增加一个界面功能

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
