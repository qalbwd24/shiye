# Android 020 日记编辑候选：源码与验证边界

2026-10-19。本文件记录 Android 日记 WebView 与 `LocalStore` 的本轮修改；整体 APK、原生列表及模拟器验收由集成任务记录。手机现有资料和运行包未由本文件对应工作修改。

## 已改源码

- `android/app/src/main/assets/editor.js`：零实际字段差异的编辑事务不再伪造 revision/updatedAt 保存，保留 `ProductDiaryStore` 的字段声明校验；已有 draftOnly 首次转正式篇时显式声明转换，重新 prepare 后保留旧 `_product` 的未知注解。图文正文保存时从同一 richdoc 派生 preview/searchText/wordCount，不另建正文。失败继续保留本页内容并提示重试。
- `android/app/src/main/java/dev/shiye/app/LocalStore.java`：产品记录已有正文、但历史摘要字段为空时，从完整 body 派生只读列表预览、搜索文本和字数；不回写用户记录。原手机意见样本只用于检查元字段形状，正文与截图仍仅在 `var/android-diagnostics/2026-10-19/opinion/`。
- `editor.js` 与 `editor.html`：选图走 `pickImages`，按所选顺序在记录的光标处插入独立图节点，末图后保留可写段落与两格缩进；图片信息显示宽度百分比，删除当前图片引用不删除原件；重复点 H2 回普通段落。“上一篇”移到新建分类弹窗独立区；本篇地点提供明确的手填字段，不调用定位权限。
- `android/ui-refinement-019/editor.css` 是 019/020 打包脚本生成 `editor019.css` 的真实 overlay 源。上下栏与正文采用连续底色；壁纸层使用大视口高度，输入法改变可见高度时不重新缩放；短文不强制额外长页，正文图片有显示尺寸上限。光标只在实际超出正文可视区域时调节滚动。
- 新建空篇仍由 `LocalStore.discardEmptyEntryDraft` 在 `closeEditor` 时丢弃；WebView 首次空白保存不晋升产品记录。仅图片篇保持有内容。

## 已运行的定向检查

- `node --check android/app/src/main/assets/editor.js` 通过。
- `node --test tests/android-editor-input.test.mjs tests/sync-product.test.mjs` 所含项目通过；与共享富文本相邻的 `node --test tests/quick-rich-body.test.mjs` 为 24/24 通过。
- 合并运行 `tests/android-entry-save-preparation.test.mjs` 时 4 项有 1 项失败：历史 015-C 用例在第 80 行仍预期 `currentCanonicalEnabled=false`，当前共享算法返回 true。本轮未改该共享算法或测试，也不把该组报告成全过。

## 尚待集成验证

根集成后续已实际修正/验证：移除base CSS隐藏图片及强制100%宽度，保留实例比例/对齐；多选使用每张新occurrence的原子节点末尾重新捕获位置，避免初始文本光标反复映射造成逆序与图间续写。末图后请求原生IME。实际Android保存/无效事务/多图/阅读/H2取消/宽度/移除/空篇/上一篇及SQLite派生字段核验见[020根验收](validation/2026-10-19-android-feedback020.md)。下面“子任务未构建”仅描述子任务本身；整体构建/安装以根记录为准。

本轮子任务没有构建或操作设备。需在隔离模拟器核对正文实际保存/重开、图文阅读与 `/media/{assetId}`、多选顺序、H2 取消、图片删除/撤销、IME 与滚动、浅深主题和地点。系统滚动截图及物理键盘/壁纸闪烁仍需 Magic7 真机验收。地理定位尚未接入，手填地点不能称自动定位。`MainActivity` 的上一篇排序、分类排序、列表选中和选图原生返回由集成任务负责。

产物目录：`outputs/2026-10-19-android-feedback020/`；临时目录：`tmp/android-feedback020/`。两者目前没有私人正文副本。
