# Android 日记输入第07轮：只读诊断

2026-10-17：针对用户反馈“时间戳/回车缩进有时失效、行距段距不统一”，先只读核对桌面思绪共用编辑器与Android装配，再按授权实施第5节的Android独立helper及合成测试。没有读取手机私有数据、连接ADB或运行手机产品，不能称手机问题已复现/修复。

## 1. 软键盘回车接缝：已确认缺口

`public/editor/rich-body-adapter.js`在ProseMirror插件的 `handleKeyDown` 中处理普通Enter：排除isComposing、keyCode229、view.composing及compositionend当轮后，只对顶层、折叠选区、paragraph执行splitBlock，再插入两个真正的全角空格。列表、引用、标题、代码、Shift+Enter走原有语义。

该插件没有beforeinput/insertParagraph处理。Android软键盘若仅发送beforeinput，或keydown仅为229，就不会经过这条自定义缩进命令；原生/Tiptap分段仍可能成功，形成“换行成功、缩进没发生”。这是从代码可确认的覆盖缺口，具体手机输入法事件序列尚未采集，不能把所有失败都归因于某一种IME。

`public/features/editor-input.js`虽已有beforeinput→input补缩进，却是另一条普通HTML编辑路径，遇structured/Markdown直接返回。Android只从它取得formatLocalDateTime，没有装配createEditorInput；不能在Tiptap内部再加一套execCommand/innerHTML编辑作为补丁。

最小合成复现：在同一richdoc顶层普通段落末尾，一组执行真实Enter keydown，另一组走没有可用Enter keydown的insertParagraph/native split路径；对比新段是否含 `\u3000\u3000`。补验候选确认Enter不会错误分段/插空格，Shift+Enter、列表/引用/代码行为保持。

建议优先Android局部ProseMirror插件适配软键盘分段，条件限定为明确insertParagraph、非IME组词、顶层paragraph、折叠选区及原entry身份。可取消beforeinput由一个事务接管分段与缩进；不可取消事件不能preventDefault后假称接管，须沿原生事务确认实际产生新段，再仅在该新段补空格。应以本次操作token去重，避免keydown与beforeinput双触发，不扫描/补写历史所有段落。

若需要复用桌面现有分段/横线规则，推荐提取同一命令并只为Android显式启用beforeinput接缝；这属于共享改动，要补桌面普通Enter、IME、撤销的定向回归。不要派发假键盘事件绕过状态，也不要只靠CSS text-indent伪装真实缩进。

## 2. 时间戳静默失败与选区：确认分支、待手机确定触发

Android `editor.js` 的时间戳click在 `composingField || adapter.composing` 时直接return，用户没有反馈；共享 `adapter.insertDateTime` 在canEdit=false时也直接return true。它表达“此编辑器处理此命令”，不表示实际插入成功。因此既不能把true当成功ACK，也不应对组词时被忽略的点击显示已完成。

共享compositionend处理仅在microtask后清除justComposed并commit；但ProseMirror view.composing仍可能在该时间点为true。Android已有waitForComposition用于保存，其条件同时关注字段/adapter组词状态。点击时间戳不能跳过同一保护，也不能用固定几十毫秒延迟猜IME已完成。

timestampButton的pointerdown.preventDefault只是尽量保住当次焦点；Android页面未保存/恢复正文选区。更多/格式弹窗、标题输入、阅读→编辑切换会改变DOM焦点，而ProseMirror state.selection可能仍是正文旧位置。需要区分“继续正文原位置”和“用户正在标题/元数据输入”两种上下文，不能任意把正文旧光标当当前编辑意图。

适配器已提供capturePosition/restorePosition/releasePosition：token绑定entryId且随transaction.mapping更新。建议在正文选区有效时保存token；工具栏操作前确认同一篇、可编辑、非冲突、组词完成，再恢复正确token并插入；完成/取消/换篇释放。不要缓存裸DOM Range或固定数字位置，也不要在composition尚未提交时恢复选区打断候选。

点击发生在组词中可选择：只排队一次明确的本次按钮意图，等待真实组词结束后在映射后的同篇选区执行；超时/换篇取消并明确提示。若不做排队，也应提示“请先完成当前输入后再插入”，不能静默吞掉。具体取舍由本轮负责编辑器的会话确认，本文不改源码。

最小复现：正文句中/句尾/空白段分别插入；拼音未确认时点击按钮；完成候选后再次点击；打开并返回格式弹窗后插入；从标题/阅读页返回正文再插入。检查body真实文字、插入位置、焦点、IME候选与一次撤销，不仅观察toast或按钮点击。

## 3. 段距视觉差：结构原因已经存在

共享insertDateTime沿dateTimeEdit规则，将换行计划转成同一paragraph里的hardBreak；句中/非空选区采用内联时间戳，句尾/空行则包含分隔空行、时间戳和后续缩进。普通Enter的splitBlock产生独立paragraph，两者本来就是不同结构，不能把手机截图里所有换行当同一种节点。

Android CSS普通p另有 `margin-bottom:0.7em`、正文默认line-height1.85；引用末段为0，列表段为0.4em。hardBreak只受行高，paragraph还受段后距，所以文字自动折行、时间戳换行、回车新段会出现不同空隙。标题/代码等独立语义的字号行高差异应保留。

最小处理为Android页面统一普通正文的行高与段后距来源，明确自动折行/软换行/空段的外观；同内容对照桌面思绪。若普通p段后距收敛为0，仍保留真实空白段/时间戳空行，不能为减少间距删除body中的空白或批量hardBreak↔paragraph转换。CSS改动只影响展示，不应产生save revision。

合成样例包括自动折行长句、两个普通段、一空白段、Shift+Enter、句尾时间戳、列表/引用。对照computed line-height/margin和body树，同时比对编辑/阅读模式，分清CSS差异与真实正文结构差异。

## 4. 本轮推荐边界

先做Android桥接/插件、选区与展示局部修复，继续复用共享richdoc及时间戳算法；是否提取共享Enter命令由根会话决定。不得新增全局快捷键、重写历史正文、在DOM外维护另一份可编辑body，或因样式调整迁移存储。独立产品文件由负责editor.*的会话维护，本文只读记录，不覆盖并行改动。

建议最少验收集中在“无keydown软键盘分段、候选确认、时间戳按钮选区、普通/空白/软换行段距、单次撤销和保存重开”；手机现由用户手测，此记录不追加ADB、实际输入监控或全库测试。

## 5. 已授权实施：仅 Android helper 与合成验证

根会话随后授权实现局部接缝。新增 `android/app/src/main/assets/android-editor-input.js`，共享编辑内核与editor.js/html/css未由本会话修改。导出：

```js
const { installAndroidEditorInput } = await import('/android-editor-input.js');
// 必须在 adapter.render(entry) 后安装；下一次挂载编辑器前销毁旧实例。
const input = installAndroidEditorInput(adapter, {
  canEdit: () => !reading && !blocked,
  toast,
});
// 时间戳等正文按钮沿现有事件接线，避免同时保留旧点击处理造成双插。
button.addEventListener('pointerdown', (event) => {
  input.capture();
  event.preventDefault();
});
button.addEventListener('click', () => {
  input.runAction(() => adapter.insertDateTime(formatDateTime()));
});
// 关闭/替换本编辑器前 input.destroy()。
```

`runAction`的canEdit只检查页面状态，不要把composing写入canEdit后又静默return；helper自己检查组词并提示。按钮click也应去掉原composing静默return，保留阅读/锁定等页面禁用状态即可。capture使用当前有效正文ProseMirror TextSelection；即使DOM焦点在标题/工具栏或没有DOM选区，也沿正文保留位置操作，不修改标题。新建空篇未focus也可插入，不以自动弹键盘为前置。capture最多持有一个注册token，替换/执行/销毁均release；缺releasePosition的旧adapter不创建token。

对cancelable insertParagraph调用安装好的handleKeyDown props，复用共享Enter命令，成功才preventDefault；不派发假的DOM键盘事件。硬件Enter已处理时避免二次分段，列表/代码/非折叠选择/IME候选/当前compositionend microtask不接管。

noncancelable insertParagraph保持原生分段，并记录**一次明确分段意图**：entryId、旧doc对象、原选择、顶层段索引/起点及分割偏移。局部Plugin的appendTransaction只在下一次docChanged消费意图；逐项证明旧doc/选区/entry未变、仅该paragraph拆成两个、左右Fragment和原mark精确相同、前后文Fragment未改、选区折叠在新段起点、没有IME/UI外部事务，才追加两个全角空格。已有两全角不重复；不匹配就消费并放弃，不在后来编辑重试。其他beforeinput、keydown、选区移动、组词、失焦、按钮操作和销毁也会失效该意图。没有扫描并规范化历史所有段落，不转换hardBreak，不重写其他正文。普通非取消事件的真实原生拆分满足这些条件才补缩进；不宣称任意输入法异常序列都已覆盖。

该Plugin与共享editor使用同一个已打包的public/vendor/rich-editor.js，不引入第二份ProseMirror；helper的相对导入在Android根资源URL规范化为 `/public/vendor/rich-editor.js`。appendTransaction使追加缩进归属原生分段的history事件，单次undo/redo由以下合成真实事务验证。

`tests/android-editor-input.test.mjs`直接挂载真实共享rich-body-adapter与JSDOM，最终13项定向测试通过：可取消软键盘分段；非取消先无副作用、句中/句尾真实splitBlock后补空格且单次undo还原完整原树/redo恢复；已有缩进不重复；无关事务/移光标/同时修改其他段/组词取消；空篇未focus/标题focus后正文插入；组词与同task组词结束保护；语义节点/选区；硬件去重；时间戳映射位置与token释放；ShiftEnter/只读/旧adapter。两新增JS文件定向ESLint通过，Prettier已格式化。测试不是实际Android输入法或手机回归；主editor接线、原生资源白名单与整包运行由负责会话完成，段距CSS仍由页面会话维护。
