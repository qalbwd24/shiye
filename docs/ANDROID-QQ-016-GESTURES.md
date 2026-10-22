# Android 016：QQ式消息与设置触摸适配

2026-10-18。本轮仅新增`android/telegram-adapter/android-qq-gestures.js`，不改wrapper、CSS、build、原生项目、库、正文、设置默认值或键名；没有安装或操作设备。仍是现有完整聊天管线的皮肤/操作适配，不是独立QQ框架或QQ源码复用。

## 接口与装配

```js
installQQGestures({ resolveContext, openMenu, reply, isBlocked, direction = 'left' })
```

只有`body.dataset.shiyeChatSkin==='qq'`时接管触摸。根传入既有localMessageContext、messageActions和安全reply回调；module不直接getActions、不写消息或prefs。可选direction为left/right/both，是安装期试验参数，不新增持久偏好。重复安装返回同一实例，实例提供cancel/dispose/snapshot；根切房/离开可主动cancel，模块也在手势期间核对目标connected、roomId/messageId/version、阻塞状态，并在blur/pagehide/关闭skin时取消。

根在QQ skin下须bypass旧wrapper的messagePress触摸长按识别，避免两套计时器；保留鼠标contextmenu路径。module在document capture阻止上游TG消息触摸识别，但pending/纵向阶段不preventDefault，浏览器滚动和短按click默认行为保持。原生设置/AppSettings不属于此Web触摸接缝。

## 消息行为

- 先判断横纵意图：纵向一旦锁定，不再转回复或长按；移动超过容差即取消长按候选。多指、touchcancel、切房/上下文版本变化、目标移除、阻塞或skin退出取消并还原临时样式。
- 明确横拖才preventDefault，仅当前`.message-content`临时CSS translate，原translate值/priority在release/cancel恢复；不修改布局或消息内容。左滑达到试验距离后调用一次安全reply，反向/短滑不回复。
- 长按450ms后调用既有openMenu，结束阻止兼容mousedown/up/click穿透；新一次主动触摸清除前次尾click防护。普通短按保留原click。
- a/button/input/textarea/select/video/audio/contenteditable/role=button及embedded引用跳转等子控件不进入消息识别，不抢输入法、图片普通点击或原生控件路径。
- 根提供的MT观察命名路径含`AIOContentLeftSwipeHelper/AIOLeftSwipeAreaComponent/REPLY_DISTANCE`，仅确认左滑候选方向；本实现的56px回复距离、450ms和移动阈值为试验值，未取得QQ真实数值，也没有宣称精确复制。

## 设置触摸范围条

仅作用于打开的`.shiye-android-dialog`内启用range的touch pointer；鼠标和键盘仍走原生路径。普通触碰不跳到track位置，垂直意图不改值且可实际滚设置容器，明确横拖按控件原min/max/step和起始值计算，派发原input事件让既有draft预览更新。pointercancel恢复本次起始value并派发input恢复draft，不派change确认；关闭/移除控件会取消。module不调用保存。

Chrome实测即使pointerdown.preventDefault，range仍可能在后续touch默认阶段跳值。因此capture只拒绝本次受控触摸产生的trusted原生input/change，在应用handler看到之前恢复expected值；module明确横拖派发的input照常通过。release后短暂防尾事件，新的pointerdown/keydown立即解除；不会阻断后续正常键盘调整。range的touch-action:pan-y只通过module自有style生效，dispose删除。

设置内checkbox/button/label若已移动/滚动，抑制可能到来的同目标尾click；新主动触摸可正常操作，不永久禁用控件。触摸过程中没有持久参数写入。

## 实际验证与边界

`tmp/android-qq-016/gestures/verify.mjs`在真实冻结TL浏览器页面、320×780移动视口，通过Chrome CDP `Input.dispatchTouchEvent`产生触摸；不是只dispatch合成TouchEvent。使用合成独立IDB与native偏好mock。harness按根允许的同一QQ-bypass方案关闭旧wrapper recognizer，手动启用skin并安装本模块；reply回调实际调用现有TL动作并验证真实引用草稿，openMenu回调仅计数，实际菜单/最终skin/AVD整合留给根验收。

23项定向检查通过：左滑/单次reply/真实引用、translate恢复、纵向与反向不误触、长按与尾click、cancel/多指/上下文变化、短横拖、普通tap/消息内button、真实启用range普通触碰/横拖/纵滑实际滚动/取消恢复/键盘、checkbox滚动尾click、prefs commit计数不增加、无页面错误。针对消息长按callback计数与尾click额外使用synthetic click故意探测防护，未把这一项说成原生菜单已验。ESLint及Prettier定向通过，未重复全库矩阵。

产物：`outputs/2026-10-18-android-qq-016/gestures/browser-report.json`、`ranges-320.png`；临时脚本位于`tmp/android-qq-016/gestures/`。APK构建、原生IME/系统返回、实体触控手感和最终误触改善仍由根独立验。

冻结SHA-256：`53E8362BBEFC6BEF97E550B9A657BACD8F5063B1F3F9DC03D3557D7205CD9F32`。

## 集成收尾：横滑回位

根整合014基线后要求补松手回位。仅horizontal阶段增加`shiye-qq-swiping`，reset移除；保留原translate恢复，另以真实Web Animations只对translate做120ms ease-out回位，减少动态效果时不启用。没有添加常驻surface类，也不覆盖style.transition或其他动画；新手势和dispose会取消旧回位动画。不要再给同一surface叠CSS translate回位。

既有23项真实TL/CDP触摸检查已重跑通过，release项额外核对横滑class的加入/移除、原inline transition一致以及真实Element.animate调用的120ms参数。browser-report.json的returnProof记录该证据；未把调用参数当成设备帧率或实体观感验收。harness设置入口兼容本轮“会话设置”名称；根的最终菜单/AVD边界不变。
