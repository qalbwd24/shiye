# Android 019 日记实测反馈：本轮源码接入

2026-10-19。对应 [用户逐项清单](ANDROID-019-USER-FEEDBACK.md) 的 D1–D2、E1–E3、S1–S3。此处是源码候选记录；正常 APK、模拟器和 Magic7 运行由整合验收另记。

| 要求 | 本轮源码处理 | 边界 |
| --- | --- | --- |
| D1、L2 列表层级和全宽 | `DiaryListPage` 的搜索/分类保持内边距，滚动列表直接占满页面；标题 18sp、摘要 14sp、元信息 11sp，行间 1dp 细线。 | 字体缩放、壁纸和真机宽度待安装后验。 |
| D2 置顶分界 | 置顶行加深浅蓝背景；最后一篇置顶行下方才显示“置顶”分界，不在组顶重复标题。 | 深浅主题实绘待验。 |
| E1 固定信息区 | `editor.html` 将标题留在固定页头，日期/星期/已有时刻/已有地点/字数/分类和分割线移入 `.entry-context-header`；`#pageScroll` 仅容纳正文。独立 CSS overlay 由 UI 负责。 | 无地点不伪造；日期只有日时，创建时刻明确标“创建”。键盘滚动待整合验。 |
| E2 空白新篇 | JS 仅对尚未进入产品记录的空白新草稿不提交；退出和转到上一篇都调用 `discardEmptyEntryDraft`。已有正文被清空仍按正常内容变更保存，不因空白误丢。 | 本次未操作正式数据库。 |
| E3 上一篇 | 先完成当前 `flush`，再由原生从 `bootstrap.entries` 已排序的实际记录 ID 选当前后一篇（新草稿则选最近一篇）；保存失败不跳转。 | 需设备点按验证跳转、返回和键盘状态。 |
| S1–S3 设置 | 原生 `AppSettings`、`DiaryAppearance` 使用固定 AlertDialog 标题和按钮、中间滚动内容，明确居中及最大 560dp 宽；外观点按遮罩不会关闭未保存草稿。原生分类子页沿同一 dialog 的 `back()` 返回父页，关闭后原 WebView 实例保留。 | 随想 Web dialog 父层恢复由并行 UI/bridge 整合验。 |

内容保护修复：`LocalStore.productEntryGet/Save` 回传本篇正文和附件引用的本地资产元数据；新选图同步加入编辑页 media 列表，真正的正文变更传给共享 `prepareProductEntry`。仅标题、日期、分类、标签等元数据变更直接克隆旧完整记录并保留 `_canonical` units/layout/sourceRefs/unknown，更新需要的字段与 `_product.refs`，不再重算消息身份或误报 `missing-media`。缺失的本地资产仍交由保存校验拒绝，不制造占位原件。

收到产品媒体关系后，`productEntryMedia` 还会只读查询 Repository 的 `relation`：先按稳定 asset ID 直取，再按 `_product.kind=media` 和 `_product.refs.asset` 明确匹配。仅映射已有的 name/MIME/size/hash/importedAt 等元数据，不补造原件已下载标志或插入时刻；缺失、歧义或无 MIME 的关系仍留作 `missing-media`。分类选择弹窗移除底部“管理分类”，默认项从 bootstrap 的 `writingPreferences.defaultCategoryId` 显式标“默认”，与本篇当前选中状态分别表示。

定向静态核验：`node --check android/app/src/main/assets/editor.js`、编辑 HTML ID/结构解析、七个改动文件的行末空白检查均通过。该 Android 目录在当前 Git 状态为未跟踪文件，`git diff --check` 不提供有效覆盖。未运行 Gradle、ADB 或读写用户真实数据；最终安装包与运行行为尚待 root 整合验证。
