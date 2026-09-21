# 0.8 工作交接：Markdown 正文编辑

## 目标与完成范围

替换新日记的正文编辑底层，默认 Markdown 并就地显示常见语法。沿用现有日记布局、元数据、附件、评论、回顾与加密备份。旧 HTML 不自动转换，用户核对后转换并独立保留首次原文。

## 模块接口

`createBodyEditor(c)` 拥有唯一编辑实例，提供 render(entry)、command(name,value)、focus()、toggleSource()、isMarkdown、newDocument(template,indent)、registerExtension(id,extension)、dispose()。源码是存储依据，清洗后的 HTML 是其他模块需要的兼容投影。原 HTML 分支仍交给原生富文本命令。

`createLivePreview` 只改变呈现；编辑行显示标记。文档交易经统一命令进入撤销栈，源码切换采用 Compartment，不重建状态。保存仍由 persistence 串行排队，组词期间暂停定时保存，结束后恢复。读取 CM DOM 会得到虚拟渲染结果，不能用来保存、统计或导出。

扩展注册面向项目内可信模块，可独立卸载；不是 Obsidian 插件兼容层。第三方插件加载、权限、沙箱和接口版本需另行设计。

## 兼容与后续

原始格式、未知字段、时间和附件不做全库迁移。显式转换首先保存现有内容；第一次转换的原 HTML 独立归档，普通更新不可覆盖。历史恢复同样恢复格式字段。旧 HTML 模板经转换器插入，块级模板保留段落边界。

实时支持常见 Markdown、单行安全颜色和下划线、本地图片。表格和多行复杂 HTML 保留源码；不将其宣称为完整 Obsidian Live Preview。公式、双链、可视化表格、插件市场留待后续。字数、搜索、导出继续读取 HTML 投影；完整图片使用原媒体文件，无额外复制。

## 构建与验证

`npm ci --ignore-scripts` 恢复依赖，`npm run build:editor` 重建本地 bundle 与许可证清单。运行无需 CDN 或 npm；锁文件固定依赖，resources/vendor 保存原包。每次更改正文协议需跑 npm run check、隔离 UI、备份恢复测试；正式升级遵循 AGENTS.md 和 OPERATIONS.md。

官方依据：CodeMirror https://codemirror.net/；Obsidian 编辑器扩展 https://github.com/obsidianmd/obsidian-developer-docs/blob/main/en/Plugins/Editor/Editor%20extensions.md。只使用开源依赖，不包含 Obsidian 应用代码。当前实现与限制以 validation/0.8-validation.md 为准。
