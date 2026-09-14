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
