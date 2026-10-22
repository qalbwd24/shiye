# Android 0.11 分类排序拖动

2026-10-18，用户最新要求覆盖旧“不用拖动”说明。本轮仅修改 `AppSettings.java`，复用现有分类草稿与LocalStore保存事务，没有存储/版本/设备操作。

## 行为

- 分类排序行长按启动Android原生本地DragAndDrop：ClipData为null、localState为当前排序会话对象、flags为0，不导出URI或文件。
- 拖到另一行放开，使用源/目标稳定分类ID在完整orderDraft中重新定位，沿用既有remove/add移动；搜索只筛显示，不把可见行序号误当完整草稿下标。
- 只有有效DROP修改草稿。长按本身不修改顺序或选择，取消/拖出目标/返回均恢复alpha与高亮；未保存草稿仍按原返回确认处理。状态还绑定原生dialog身份及重载代数，旧拖动不能应用到新草稿。
- 保存按钮仍只调用原 `saveCategoryOrder(baseRevision,categoryOrder)` 一次事务。没有边拖边落盘，也不绕过并发版本校验。
- 上移/下移/首尾/指定序号继续可用。行最小48dp，名称可换行；四个方向按钮去默认最小宽度并收紧padding，给320dp与1.3字号留空间。长列表跨越不可见区仍可用原有上下移/指定序号，本轮未引入自动滚动计时器。
- 返回链保持排序→分类管理；分类专用入口再返回关闭，不泄漏到根设置；从主设置进入则分类管理→启动与写作→设置。新增/改名/删除子弹窗仍保留外层父页，外层关闭回调只执行一次。

## 验证边界

10项源码接缝结构审查通过：本地drag参数、owner/generation限制、稳定ID定位、DROP仅改草稿、取消不改顺序、原revision事务、未保存返回确认、categoriesOnly父级保护、无障碍替代按钮及窄宽参数。报告只标sourceOnly；不将其写成实际原生拖动通过。

编译与实际AVD拖动/取消/搜索/返回由主会话完成。本轮未启动App、未操作设备、未改真实分类。集成时核心查看：普通/筛选后拖动一项、拖出取消、返回继续/放弃、单次保存ACK与分类专用入口返回；无需重跑全矩阵。

产物：`outputs/2026-10-18-android-refinement-011/category-drag/source-review.json`。临时：`tmp/android-refinement-011/category-drag/review.mjs`。
