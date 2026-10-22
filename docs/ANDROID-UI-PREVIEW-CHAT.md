# Android 实时预览：会话列表与随想

2026-10-17，本轮只维护 `android/telegram-adapter/android-chat.css` / `android-chat.js` 适配层。主会话独占原生、AVD、手机和最终构建；本文件的浏览器结果不表示APK已更新。

## 约束与来源

按用户确认的参考分工：QQ负责会话列表与页面状态，Telegram负责线性消息、输入与附件体验；现有浅天蓝黑字、0.4认可背景及三入口保持。参考APK未确认的具体数值不视作必须复制的参数。只使用拾页已确认业务。

手机/电脑后续互通，功能与身份遵循实时维护的 `ANDROID-FRONTEND-DATA-ALIGNMENT.md` 和 `CONVERSATION-BACKEND-CONTRACT.md`。本轮不新增schema，不改房间/消息ID、正文、时间语义、媒体原字节或后端绑定。聊天自己的字号、输入字号、padding、壁纸和原生偏好继续独立，用户自定义值优先；保留0.5零大小文件与只读GIF修复。

## 第一步：会话列表

列表是冻结Web A虚拟列表，`CHAT_HEIGHT_PX=72` 参与绝对位置计算；本轮明确保留72px，不用CSS把它改成可变行高。内部为50px头像、12px头像到文字，标题16px/摘要14px/时间11px；22px标题行和20px摘要行之间3px。时间使用等宽数字，菜单保留独立44px点击槽，不侵占摘要。去掉原来绝对定位悬在摘要末端的额外pin图形，置顶仍由持久底色表达。

置顶底色保留用户已要求的 `#c8e2f5`；选中 `#b6d8ef`、按压 `#a9d2ee` 分开，按压优先级高于选中。新增适配CSS token可被实时预览工具调整：`--shiye-list-avatar-size`、`--shiye-list-title-size`、`--shiye-list-preview-size`、`--shiye-list-time-size`、`--shiye-list-pinned`、`--shiye-list-pinned-selected`、`--shiye-list-pinned-pressed`。行高不是可调token。

11项合成浏览器检查通过，0页面错误：360/412两宽的72px行/50px头像、菜单和摘要无重叠、置顶默认色，选中和按压优先级，进入聊天/返回列表。两宽实绘已查看。仅用隔离虚构样例，route读取原0.5冻结资产并覆盖当前adapter源码，没有改冻结包。初次脚本鼠标抬起已经打开会话，随后再次点击隐藏列表超时；修正重复测试动作后通过，未为此改变产品。

成品：`outputs/2026-10-17-android-ui-preview/chat/list-check.json`、`list-360.png`、`list-412.png`。复现：`node tmp/android-ui-preview/chat/verify-list.mjs`（工作目录 `D:\拾页`）。未使用ADB/手机，未生成候选APK，不宣称解决原生长帧。

## 第二步：聊天页

实绘确认现有统一白色Composer、56px工具栏和成熟按钮槽没有出现本轮可复现的重叠，因此保留其布局与动画。修复一个明确样式不一致：adapter正文/placeholder硬写1.5行高，但冻结 `#message-input-text` 的垂直padding计算仍使用1.3125变量；现在将该变量同样设1.5，使可见行高、placeholder位置和测量padding一致，继续沿用独立输入字号。没有更改默认字号、气泡padding或用户偏好值。

日期chip固定12px/18px系统文字，避免消息字号24px时日期也被继承放大；日期和时分使用等宽数字。正文/meta的原有成熟排版、时间语义、文字内容均保持。没有新建FAB或重写成熟Composer/动画状态，没有逐帧扫描或整列替换，也不以关闭动画冒称性能改善。

15项合成浏览器定向通过，0页面错误：360/412统一白色胶囊、16/24/28px独立输入字号的测量行高一致、消息24px与padding12px保持独立、各动作槽在360视口内、大字号发送后清空草稿、成熟消息路径呈现、继续输入保留。360大字号与发送后两行草稿实绘已查看；截图先等待500ms稳定，不把过渡中间帧当最终布局。日期chip最终实绘为12px。报告 `composer-surface-check.json`；实绘 `chat-input-{16,24,28}.png`、`chat-sent-360.png`、`composer-surface-{360,412}-fixed.png`，均在本轮chat产物目录。复现 `node tmp/android-ui-preview/chat/verify-chat.mjs`。

适配CSS Prettier通过。本代理全程未改JS、vendor、Java、editor、Gradle、schema/后端或冻结资产，没有ADB/手机/构建。0.5文件、GIF、持久化与未受影响偏好逻辑按相同JS复用原证据；未重新宣称原生键盘/附件选择、AVD、物理120Hz、长期CPU内存通过。实际预览和最终APK由主会话集成回读。
