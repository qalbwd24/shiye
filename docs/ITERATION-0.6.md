# 0.6 工作交接

基线：0.5.0 / 3da1d28。开发分支 codex/feature-boundaries-v0.6。开发工作区沿用 F:\<个人目录>\开发工作区\拾页-v0.5.0 目录名；其中应用实际版本以 package.json 和健康接口为准，目录名不是运行版本。

本轮实现和限制以 FEATURE-PARITY.md、IMPORT-CONFLICTS.md 为准，不再把早期“已有入口”表述为“全部兼容”。现有 UI 风格保留，正文编辑引擎未替换。

## 模块划分

| 领域          | 前端交互                                              | 可复用规则／后端                                       | 边界                                                   |
| ------------- | ----------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------ |
| 编辑核心      | public/editor/commands.js、content.js、persistence.js | src/server/domain/entries.mjs、routes/entries.mjs      | 光标命令、清洗和保存队列独立；页面导航不持有保存算法   |
| 分类标签      | features/organization.js、context-menu.js             | shared/taxonomy.js、routes/taxonomy.mjs                | 名称/篇数/手动排序统一；页面与右键菜单复用同一接口     |
| 模板          | features/templates.js                                 | routes/templates.mjs                                   | 与分类路由分开维护；自动绑定旧格式仍有待办             |
| 偏好设置      | features/preferences.js、appearance.js、layout.js     | routes/preferences.mjs、appearance.mjs                 | 更新各自字段；不覆盖快捷键                             |
| 数据统计      | features/statistics.js                                | shared/statistics.js、entry-state.js                   | 统计为纯函数；当前无需独立服务器统计接口               |
| 周期/随机回忆 | features/insights.js、app/main.js                     | shared/recall.js、memories.js                          | 共享可见性状态，算法互相独立                           |
| 媒体接收      | features/media-import.js                              | core/api.js 上传传输、routes/media.mjs                 | 文件选择/粘贴/拖放共用队列；保存关联与文件上传分开反馈 |
| 导入与冲突    | features/conflicts.js、legacy-backups.js、backups.js  | domain/import-reconciliation.mjs、routes/conflicts.mjs | 身份、内容哈希、冲突决策和页面分开                     |
| 启动兼容修复  | 无独立编辑器依赖                                      | storage/legacy-metadata.mjs、media-hashes.mjs          | 数据快照后补齐元信息，原始正文与附件字节不改           |

public/shared/insights.js、src/server/routes/organization.mjs 保留兼容转发，正式组合入口已经使用细分模块。新代码不要重新堆回转发文件。

## 复用与变更规则

新页面通过 features/index.js 的组合入口注册；渲染返回 true 表示已处理，返回 false 交给后续页面。跨页面获取 library 必须使用实时 getter。业务逻辑不要导入特定页面 DOM。公共色彩使用 --paper/--ink/--line/--accent；管理页样式在 management.css。

文本编辑器以后换成 CodeMirror 等时，优先替换 commands/content 适配层和正文视图；保留 persistence 的 API/冲突机制与 Entry 数据契约，不能让编辑器插件直接写 diary.json。

正式运行升级必须执行并验证，见 AGENTS 第 11 条。测试与真实数据核对分开记录。后续关键待办：模板全字段绑定、旧媒体正文定位、导出图文、联网同步、细化字体/对比度和分类布局。
