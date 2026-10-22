# Android 0.11 随想设置、刷新与消息操作

2026-10-18。本子任务只修改 `android/telegram-adapter/android-chat.js`，复用当前离线TL/IndexedDB消息、原生偏好ACK和背景资源桥。CSS、Java系统栏/缓存导航、版本与设备安装由各负责会话维护；手机未由本子任务操作。

## 用户设置与交互

- 全局“聊天显示”和会话菜单内“这个会话的显示”分开。房间默认继承全局，显式勾选后保存完整参数覆盖，可“恢复跟随全局”。草稿按全局/房间独立缓存，不互相覆盖；保存才提交原生偏好，未知旧字段保留。取消、系统返回和关闭遇未保存修改时提供继续调整/放弃，继续会保留控件草稿，放弃回到真实父页并恢复已保存外观。
- 新默认：气泡留白8px、最大宽度88%、消息间距4px、时间10px/不透明度62%、气泡背景100%。字号/圆角/宽度/间距/时间字号及两种不透明度都可调，消息间距范围2–20px。旧已保存参数不强行覆盖；“应用紧凑推荐”只改变草稿，明确保存后才更新旧12px/86%等值，保留用户其他自定义及未知参数。
- 浅/深冷蓝主题全局及逐房覆盖。`body[data-shiye-chat-theme]` 与CSS变量驱动外观；上游主题切换只在 `global.sharedState.settings` 真实就绪后执行，成功才记录已应用，shell就绪后补应用。修复初始getActions可用而sharedState未到时的冷启动race；原生系统栏同步由根会话观察该dataset。
- Enter直接发送默认关闭。明确启用后仅处理当前富文本输入区无修饰的Enter，点击既有发送控件，不绕过媒体/引用/写入流程；Shift+Enter、其他修饰键、重复键、IME组词/keyCode229、编辑器composing及组词结束80ms保护保持。未增默认全局快捷键。
- 会话列表下拉及公开 `window.shiyeAndroidChat.refresh()` 走同一去重刷新函数；resume/visibility走静默读。元数据刷新不先flush整篇聊天，保留缓存页面和草稿；15秒整段deadline与epoch取消迟到投影，finally清进行态。小浮层dataset为loading/success/error，旋转CSS由样式代理负责。手动失败有关闭/重试，静默失败不弹窗；不同于导航保存失败的Java策略，不能把刷新成功冒充草稿落盘确认。
- “会话列表背景”独立存 `listBackground`，使用 `--shiye-list-background`/`data-shiye-list-background`；“聊天默认背景”存 `chatBackground`，房间自己的 `roomBackgrounds[id]` 优先，恢复跟随全局只删除该房覆盖。都复用原生choose返回的assetId/url/avatarUrl，不进入正文；取消、失败或选图期间换房/关闭设置不覆盖旧背景。列表标题视觉和图标统一由CSS代理实施，JS保留“随想会话列表”无障碍名。

## 引用与撤回

已核对冻结worker的 `DeleteMessages`：原实现持久化 `shiyeWithdrawnMessages`/outbox墓碑并移除载荷，引用仍保留目标ID。本轮不造消息库、不做DOM删除、不伪造后端canonical身份。

移动UA原右键/长按可能进入选择态，新增消息长按420ms或原contextmenu可达菜单，限定当前真实room、safe本机TL messageId和实际ApiMessage。引用调用原 `updateDraftReplyInfo`，继续使用原Composer发送；撤回仅本人消息提供，二次明确确认后调用原 `deleteMessages`，等本地IDB墓碑存在且payload移除后才关闭确认。保留“更多原有操作”回原消息操作入口，链接/视频原contextmenu保留。超过本地安全数值范围的ID保守不处理，不映射为跨端身份。

长按取消移动>10px，不抢原生滚动。修复两个实际浏览器复现：上游200ms选择timer先接管，及长按松手合成click穿透关闭新菜单；只有真实消息触摸停止旧JS长按传播，长按已打开菜单的touchend抑制穿透。没有新增全局键绑定。

## 表情与跨端边界

已读 [收藏后端协议](STICKER-BACKEND-API.md)。保留并行会话接入的当前 `shiye-stickers.js`/本地原件组件，不联云，不把本机sticker:UUID、TL编号冒充服务器mediaId。旧Blob/映射保留，缩略图仅预览，重发仍原媒体。原PNG重发在用户图片质量small时保留原字节的冻结附件桥由根会话补并测试，不重写普通图片质量选择。

## 定向证据与边界

真实Chrome移动UA、320×740、独立合成浏览器库和原生prefs mock；新011完整依赖来自 `tmp/android-refinement-011/telegram-build/assets/telegram`。测试脚本 `tmp/android-refinement-011/chat-behavior/verify.mjs`，回执/截图 `outputs/2026-10-18-android-refinement-011/chat-behavior/`。最终源码SHA及实际wrapper覆盖方式看同目录receipt，不能把源码覆盖测试误写成旧wrapper已通过。

33项核心浏览器场景通过、pageerror为空：延迟sharedState1.5秒冷启/已有IDB重开、旧设置保留及推荐草稿、Enter/IME/Shift、全局与房间ACK隔离/未知字段、未保存返回保留、同页刷新去重/下拉、失败关闭重试/静默失败、背景取消与独立字段、原actions引用撤回重开，以及实际右键菜单引用/真实touch长按/确认撤回与墓碑ACK、回复目标保留、PNG在small下原字节。

CSS代理另测20.8px/320宽与极端字号；浏览器证据不冒充Android WebView实际textZoom1.3或物理120Hz。原生系统picker、手机输入法/触摸、真实后台挂起与安装状态由根AVD/手机回执单列。本子任务未操作手机/AVD或正式数据。
