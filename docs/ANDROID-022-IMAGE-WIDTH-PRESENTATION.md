# Android 022 图片宽度展示偏好

图片正文仍使用 `shiye-richdoc` 的 canonical `attrs.widthRatio`（0.1–1）；不新增正文属性。新插入图片把当前本篇宽度（未设置则全局宽度）写为 canonical 回退值，同时以 `entryId + occurrenceId` 在本机展示偏好登记 `inherit`。同一素材的多次插入有不同 `occurrenceId`；旧图没有登记，始终按其原有 canonical 宽度显示。

WebView `localStorage` 键 `shiye.android.diary.image-width-modes.v1` 保存对象 `{version:1, rows:[{entryId,occurrenceId,mode,baseline,explicit}]}`。`mode` 为 `inherit` 或 `explicit`，`baseline` 是该图首次登记时的 canonical 宽度，`explicit` 是用户手调后的宽度或 `null`。写入保留对象中未知顶层键。总记录上限 4096；满额时优先保留当前篇，淘汰较早其他篇记录，被淘汰图片回退到 canonical 宽度。当前篇也达到上限时拒绝新继承登记并明确提示，不悄悄改变既有图片。本篇宽度键仍为 `shiye.android.diary.entry-image-width.v1`，最多 100 篇；全局宽度在 `shiye.android.diary.presentation.v2`。

编辑展示按本篇宽度优先、全局次之，对 `inherit` 图片的 DOM 宽度覆盖 canonical 回退值，不改变正文、媒体身份、原件或更新时间。正式阅读按正文可用宽度全宽展示。单图信息中的“跟随本篇／默认宽度”可显式切换；图注/对齐修改不应固定继承宽度，只有手调宽度或明确关闭跟随才成为单图显式宽度。图片删除后，仅在正文保存确认时清除对应记录；保存失败不提前持久化展示标记。

撤销/重做使 canonical 宽度发生变化时，编辑器根据该图首次登记的宽度恢复继承或显式状态。纯展示模式切换没有 `docChanged` 历史事务，由本机偏好独立保存，不能宣称受正文 Undo/Redo 控制。若单图手调后的宽度恰与 `baseline` 相同，canonical 宽度变化也无法唯一表示用户的模式意图；该边界需要未来共享编辑器历史接口才能消除。

这些偏好当前只在 WebView `localStorage`，尚未自动收集进 `.syseed`，也未跨设备同步。备份或换机缺失标记时会使用正文的 canonical 回退宽度；不得把本机继承展示称为跨端继承。
