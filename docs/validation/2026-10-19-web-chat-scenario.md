# 随想单图带说明：撤回重编缺图复现

2026-10-19。本报告用于确定用户所说的页面与操作对象，结论是**已在冻结 ui48 的随想聊天网页复现缺陷，尚未修复通过**。不是思绪写作窗口，不需要用户先决定内部组图存储策略。

## 环境与证据边界

实际页面及编译 worker 从 `outputs/2026-10-19-chat-message-reedit/candidate-ui48/app` 加载，122个已加载资产 SHA 全部匹配 `delivery-manifest-ui48.json`。独立 Chrome 临时 context、真实 IndexedDB/worker、合成 native bridge；外部 origin 请求拒绝，Service Worker 禁用。没有使用正式会话、数据、API、窗口或安卓设备。

脚本：`tmp/web-chat-improvement/astra-tests/single-image-ui48-baseline.mjs`；原始结果：[复现 JSON](../../outputs/2026-10-19-web-chat-improvement/astra/single-image-ui48-baseline.json)。页面 action 用于准备合成图片与进入编辑/撤回；附件确认发送及撤回提示中的“重新编辑”使用实际页面控件。该证据证明冻结聊天网页的失败链，不代替正式 WebView2 鼠标/输入法或后端同步验收。

## 实际步骤与结果

1. 随想测试会话发送一张合成 PNG 与 `SYNTHETIC_CAPTION` 说明。确认同一条消息 `content.photo` 与 `content.text` 同时存在。[发送后截图](../../outputs/2026-10-19-web-chat-improvement/astra/single-image-sent.png)。
2. 对仍在列表的该条消息开始直接编辑。原气泡仍有图片，编辑摘要显示缩略图，输入框带原说明。[直接编辑截图](../../outputs/2026-10-19-web-chat-improvement/astra/single-image-direct-edit.png)。这一步只证明进入态，未宣称修改后所有媒体行为通过。
3. 取消直接编辑，撤回该消息，再点击撤回提示中的“重新编辑”。当前会话为 `-10`；恢复请求带一个 File 和原说明，却没有 `chatId`，页面打开 `Share with` 收件人选择弹窗，当前聊天编辑输入仅带说明。[撤回恢复截图](../../outputs/2026-10-19-web-chat-improvement/astra/single-image-withdraw-restore.png)。
4. 关闭这个错误弹窗并在编辑框确认，实际新后继 `12` 替代原条 `11`，保留原日期及 root，但 `content` 只有文字，没有 photo。[错误提交截图](../../outputs/2026-10-19-web-chat-improvement/astra/single-image-restore-submit.png)。

这将截图中“图文撤回重发只剩文字”与特定恢复路径出现的 `Share with` 弹窗联系起来。普通转发功能的其他弹窗残留仍需另测，不能据此认定所有 share 问题都同一个原因。

## 源码解释与下一步门槛

冻结 `shiyeWithdrawalUi.ts` 的恢复附件调用 `openChatWithDraft({text,files})` 缺少目标会话；附件 selector 严格匹配当前 `chatId`，而未带会话的请求会进入 `DraftRecipientPicker`。源码不匹配与实际 requestedDraft/弹窗/纯文字后继共同形成证据。

最小修复要绑定正确目标与恢复上下文，保证附件准备成功才提交编辑上下文，恢复原字节不再次压缩。不能仅补 `chatId` 就宣称完成：还须验证确认后新条真的同时有图与说明、取消保持、缺图/切房/已有草稿保护、删除/替换意图以及原时原位与邻居稳定。详细需求见[本轮主需求](../WEB-CHAT-IMPROVEMENT-2026-10-19.md)。

状态：失败复现完成，`functionalPassed:false`；无本轮候选安装/运行启用，性能/原图完整上传/真实原生焦点尚未验。
