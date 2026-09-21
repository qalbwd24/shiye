# 功能与文件索引

| 功能／改动                         | 前端位置                              | 后端／共享逻辑                                                    | 回归测试                            |
| ---------------------------------- | ------------------------------------- | ----------------------------------------------------------------- | ----------------------------------- |
| 新建、编辑、自动保存、历史、回收站 | public/app/main.js                    | domain/entries.mjs、routes/entries.mjs、storage/library-store.mjs | entries.test.mjs                    |
| 页面壳与编辑器DOM                  | public/index.html、public/app/main.js | routes/static.mjs                                                 | architecture.test.mjs + 界面        |
| 富文本清洗、搜索文本、字符统计输入 | public/core/dom.js                    | 无                                                                | 界面 + insights.test.mjs            |
| Markdown、隐藏、草稿               | features/editor-tools.js              | routes/entries.mjs                                                | entries.test.mjs                    |
| 分类、标签管理                     | features/organization.js              | routes/organization.mjs                                           | entries.test.mjs                    |
| 模板                               | features/templates.js                 | routes/organization.mjs                                           | entries.test.mjs                    |
| 显示偏好、提醒、自动锁             | features/preferences.js               | routes/organization.mjs、security/access.mjs                      | entries.test.mjs、security.test.mjs |
| 筛选                               | features/search.js                    | 应用本地筛选                                                      | 界面                                |
| 统计、周期回忆、地点               | features/insights.js                  | shared/insights.js                                                | insights.test.mjs                   |
| 随机回忆                           | app/main.js                           | shared/memories.js                                                | insights.test.mjs                   |
| 快捷键                             | app/main.js                           | shared/hotkeys.js、routes/settings.mjs                            | shortcuts.test.mjs                  |
| 绘画、裁剪、录音、朗读             | features/media-tools.js               | routes/media.mjs                                                  | vault.test.mjs + 界面／设备         |
| TXT、HTML、PDF、PNG 导出           | features/export.js、core/downloads.js | 无                                                                | 界面                                |
| 大备份创建／恢复                   | features/backups.js                   | shared/vault2.js、routes/backups.mjs                              | vault2-roundtrip.test.mjs           |
| 旧整包加密备份与旧格式入口         | features/legacy-backups.js            | shared/vault.js、routes/legacy-backups.mjs                        | vault.test.mjs、imports.test.mjs    |
| ZIP64、大备份导入                  | core/api.js 上传辅助                  | routes/imports.mjs、imports/zip-stream.mjs、imports/legacy.mjs    | imports.test.mjs                    |
| 可支持容量／块大小                 | 界面提示需同步                        | public/shared/limits.js                                           | 对应导入／备份测试                  |
| 应用端口、标识、版本               | 启动器构建                            | config/app.json、package.json、src/server/config.mjs              | architecture.test.mjs               |
| 样式、适配、深色、打印             | public/styles/                        | 无                                                                | 桌面与窄屏界面                      |
| 功能入口增加／删减                 | public/features/index.js              | src/server/app.mjs 路由列表                                       | 文件依赖检查 + 对应功能测试         |

表中 features、core、shared 相对于 public；domain、routes、imports、storage、security 相对于 src/server；测试文件相对于 tests。

定位建议：先按表找到模块，再搜索接口路径或命令ID。新增功能更新本表；原安卓特色功能的兼容进度仍以项目上级 research 中的“离线功能对照与验收”报告为依据，避免在不同文档里写出相互矛盾的完成状态。

## 0.5 新增模块

| 功能           | 前端                                                                         | 后端                                                 | 验证                      |
| -------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------- |
| 背景与主题     | features/appearance.js、shared/appearance.js、styles/appearance.css          | routes/appearance.mjs、storage/appearance-compat.mjs | appearance.test.mjs、界面 |
| 右键操作       | features/context-menu.js、features/entry-actions.js、styles/context-menu.css | 复用 entries、organization                           | appearance.test.mjs、界面 |
| 折叠           | features/layout.js、styles/layout.css                                        | preferences.layout                                   | appearance.test.mjs、界面 |
| 背景随备份恢复 | features/backups.js、shared/vault2.js                                        | routes/backups.mjs                                   | vault2-roundtrip.test.mjs |

右键菜单只负责交互与提示，entry-actions 负责带 revision 的库操作；不通过 markDirty 修改删除状态。背景不使用日记附件列表显示。

## 0.6 模块细分与兼容状态

当前完整对照见 [原版功能核对](FEATURE-PARITY.md)，模块职责见 [0.6 工作交接](ITERATION-0.6.md)。这是后续功能增删的首要索引。

| 功能               | 前端                                           | 后端／共享逻辑                                         | 测试                                        |
| ------------------ | ---------------------------------------------- | ------------------------------------------------------ | ------------------------------------------- |
| 文本编辑、保存     | editor/commands.js、content.js、persistence.js | domain/entries.mjs、routes/entries.mjs                 | feature-boundaries、entries                 |
| 分类和标签管理页   | features/organization.js                       | routes/taxonomy.mjs、shared/taxonomy.js                | feature-boundaries                          |
| 模板               | features/templates.js                          | routes/templates.mjs                                   | entries、imports                            |
| 偏好               | features/preferences.js                        | routes/preferences.mjs                                 | entries、appearance                         |
| 统计               | features/statistics.js                         | shared/statistics.js                                   | insights                                    |
| 周期回忆           | features/insights.js                           | shared/recall.js、entry-state.js                       | insights                                    |
| 上传反馈和文件落区 | features/media-import.js、core/api.js          | routes/media.mjs                                       | feature-boundaries、界面                    |
| 去重与冲突管理     | features/conflicts.js                          | domain/import-reconciliation.mjs、routes/conflicts.mjs | feature-boundaries、vault、vault2-roundtrip |
| 旧元信息修复       | shared/legacy-content.js                       | storage/legacy-metadata.mjs、media-hashes.mjs          | feature-boundaries                          |

上表替代旧表对应模块路径。旧转发模块保留以兼容引用，不再承担业务逻辑。

## 0.7 阅读、写作与媒体

工作计划、模块所有权、操作方法见 [ITERATION-0.7.md](ITERATION-0.7.md)。新增 comments.js / routes/comments.mjs 管理评论；gallery.js 管理单张阅读和附件缩略图；drag-sort.js 提供复用排序；workbench.js 组织设置；0.7.1 已用就地编辑取代原阅读／专业写作切换，具体入口见下表；media-batch.js 管理上传前勾选；core/media-compression.js 处理静态图片；routes/media-compression.mjs 处理新视频暂存和转码。数据冲突继续独立于上传界面。

## 0.7.1 工作区与阅读连续性

本表更新本轮交互入口；详细设计、状态保存边界和验收交接见 [ITERATION-0.7.1.md](ITERATION-0.7.1.md)。后端数据与媒体格式无变更。

| 功能                                         | 前端位置（相对 public）                                           | 保存位置／职责                                                                       | 验证入口                                                           |
| -------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| 固定视口、列表／正文／图评独立滚动           | styles/workbench.css、styles/layout.css、index.html               | 窗口布局与窄屏约束，保证图评栏首尾可达                                               | tests/workbench-layout.test.mjs、隔离浏览器尺寸复核                |
| 自然比例单图、图上箭头／计数／圆点、横向拖动 | features/gallery.js、styles/gallery.css                           | 阅读切图与 190 ms 过渡；正文下方编辑附件，完成后同步右侧；减少动态效果时关闭切换动画 | tests/drag-gallery.test.mjs、tests/gallery-browser.mjs、实际浏览器 |
| 页边活页标签、分类展开列表                   | index.html、features/layout.js、app/main.js、styles/workbench.css | 左侧导航／列表，右侧图评；“全部日记”属于“日记分类”组                                 | tests/workbench-layout.test.mjs、实际点击与窄屏复核                |
| 就地编辑图评栏拖宽与开合偏好                 | features/layout.js、features/workbench.js、shared/appearance.js   | 复用 routes/preferences.mjs，保存 settings.preferences.layout；拖动松手后提交        | tests/workbench-layout.test.mjs、拖宽后刷新                        |
| 最近图片位置                                 | features/gallery.js                                               | localStorage 的 shiye.gallery-position.v1；最近 200 篇，仅日记 ID 与媒体 ID          | tests/gallery-browser.mjs、切图后刷新                              |
| 阅读滚动位置                                 | features/reading-position.js、features/index.js、app/main.js      | localStorage 的 shiye.reading-position.v1；最近 200 篇，仅日记 ID 与滚动偏移量       | 独立滚动、切换日记与刷新复核                                       |
| 筛选及更多视图记忆                           | features/search.js、features/index.js                             | localStorage 的 shiye.search-filter.v1 与 shiye.more-views；不写入日记正文           | 刷新后筛选指示与展开状态复核                                       |

源码中的 tests 路径相对于项目根。测试入口不等同于已完成每项真实客户端验收，最终结果由主任务记录在 validation/。

### 回顾模块追加

拾光回顾与往日此时由 `public/features/recollection.js` 统一接管，样式在 `public/styles/recollection.css`，随机资格、洗牌与有限历史在 `public/shared/memories.js`，周期匹配继续使用 `public/shared/recall.js`。`createRecollection(c).render(view, root)` 仅处理 `memories`／`recall`，装配应先于旧 insights 的 recall 分支。

单篇通过根入口提供的 `releaseEntryReader()` 与 `mountEntryReader(container, entryId)` 移动唯一阅读器，复用现有图库和评论；列表卡片使用 `data-open-entry`。切篇、切模式及改范围先等待 `c.flush()` 成功。自动测试见 `tests/recollection.test.mjs`，覆盖轮内／轮间抽取、实时资格、有限 ID 保存和异步保存失败／视图替换；实际挂载效果由根 agent 在隔离浏览器验收。回顾切换在 flush 后执行 100 ms 旧页淡出与 200 ms 新页淡入，并检查动画取消后的容器资格；列表提供每批 80 篇的继续加载，不截断剩余日记。

### 就地编辑与相册

`features/workbench.js` 在 `#editorPanel` 上控制 `inline-editing`，正文和标题聚焦时显示工具，侧栏保持布局。正文下方 `#attachmentEditor` 提供附件缩略图；`features/gallery.js` 在编辑期间冻结同篇右侧展示，完成编辑先 `await flush()`，再同步最新附件。正文和附件仍自动保存，“完成编辑”不是事务提交。入口／样式由 `app/main.js`、`index.html`、workbench 与 gallery 相关模块配合。

相册由 `features/album.js` 与 `styles/album.css` 接管 `gallery` 视图。它按媒体 ID 合并可见日记来源，每批最多 80 项，支持瀑布流／方格／列表、密度、排序与类型；偏好在 `shiye.album.v1`。纯逻辑测试见 `tests/album.test.mjs`。完整阅读器搬移由 `features/entry-reader.js` 与 `styles/entry-reader.css` 负责，供两种回顾复用。

## 0.7.2 输入与侧栏细节

正文初始缩进、原生换段和日期格式：public/features/editor-input.js，features/index.js 装配，main.js 调用；autoIndentParagraph 在 preferences.js 和 routes/preferences.mjs 管理。列表封面：features/entry-cards.js、styles/entry-cards.css；仅引用现有媒体。侧栏边界跟随继续由 layout.js 负责，相册随机种子由 album.js 独立管理。详见 [0.7.2 工作文档](ITERATION-0.7.2.md)。

0.7.3 取消普通正文段落额外的 18px 段后间距，相邻段落按普通换行距离排列；不改变行距或手动输入的空行。段落样式在 public/styles/editor.css 的 .body-editor p 中统一管理，阅读与就地编辑共用。

0.7.4 应用图标由 public/icons/shiye.svg 维护；tools/build-icons.mjs 生成各尺寸资源，tools/build-launcher.ps1 嵌入 Windows 启动器。它与个人头像模块独立，见 [图标维护](ICON.md)。

### 浏览来源返回（0.7.6）

`public/features/return-navigation.js` 管理单层来源、保存前置、重复点击和导航取消；`restoreBrowsePosition` 在短暂布局稳定期恢复滚动，用户开始操作即停止。`public/app/main.js` 对 `#alternateView` 的 `data-open-entry`、`data-day` 统一接入，组装应用筛选、月份、展开状态与滚动位置；`public/styles/return-navigation.css` 负责顶部按钮和窄屏换行。

`features/index.js` 装配相册、回顾的 `captureNavigation()`／`restoreNavigation(snapshot)`。快照只保留偏好、ID 和分页，恢复后重新读取实时库，不复制或回写正文。来源属于当前页面生命周期，不是跨刷新历史栈；主动导航会清空。测试在 `tests/return-navigation.test.mjs`、`tests/album.test.mjs`、`tests/recollection.test.mjs`。
