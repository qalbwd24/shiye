# 会话程序设置前端接缝

2026-10-19 ui44已接真实四固定桥及按实例worker/收件/来源/评论/撤回；原固定房不迁移。目录驱动provider，只实现revisit，未知类型只读。旧“其他房间缺原生worker”是ui42历史，本轮隔离两房/双窗/解绑回归及C#真实桥分别通过，正式未建测试实例。设置后端成功需等待本机路由ACK；分步部分成功和409有显式恢复。AI执行、完整多程序编辑、云同步仍未实现。后端settings新候选不随本包部署。见[最新验收](validation/2026-10-19-chat-ack-services.md)。

2026-10-19最新交接：本轮按用户要求只做后端，未修改UI或正式运行程序。后端候选增加原子`settings/read/save`及统一会话消息接口，适配本UI port时优先映射到[新后端契约](CONVERSATION-MESSAGING-BACKEND-API.md)，不再让客户端自行多步创建/绑定/保存。多个程序需按slotId/bindingId区分；旧朝花夕拾有legacy别名，保留原进度。新HTTP能力未部署时继续禁用普通会话的保存。此前UI源码和生命周期行为保持。

2026-10-19：本轮仅整理设置UI，实际部署情况见[验收](validation/2026-10-19-conversation-services-ui.md)。现有朝花夕拾固定会话继续使用真实兼容桥；任意其他会话的原生桥、worker收件/评论路由未在本轮接通。

## 页面职责

所有会话先进入自身资料/外观设置，再在“程序与服务”选择程序，进入嵌套的程序参数页面。普通会话资料与程序参数分别保存。新会话须先创建，不能以尚不存在的会话身份绑定服务。现有固定朝花夕拾会话沿用原连接，不创建新实例、不迁移或重置进度；以推送开关暂停。

`previews/telegram-chat/shiye-conversation-services-ui.js`只负责表单、版本冲突提示、未保存草稿和导航。它不访问任意HTTP、不直接改库、不运行调度器、不把localStorage当权威配置。动态导入保持正常聊天启动路径轻量。

## 适配器接口

后续原生客户端可注入`window.shiyeConversationServicesPort`，提供两个方法：

```js
readSettings({ roomId });
saveSettings({
  roomId,
  providerId, // 'revisit' 或 null（解除接入）
  instanceId,
  bindingId,
  expectedBindingRevision,
  expectedConfigRevision,
  config,
});
```

两者都返回权威快照：`{providerId,instanceId,bindingId,bindingRevision,config,categories,canSave,reason?}`。`config`包含原实际API的revision、enabled、mode、dailyTime、interval、timeZone、categories、sourceDateFrom/sourceDateTo、title和sender。不支持的通道返回`canSave:false`与reason；保存错误保留status，409不会显示为已保存，输入草稿不被重载覆盖。

这两个方法是前端适配接口，**不是新增HTTP端点**。后台使用已有[会话服务API](CONVERSATION-SERVICES-API.md)的catalog、实例创建、binding和实例request；新适配器须完成稳定命名空间会话ID映射，不能直接把客户端数字roomId当全端身份。创建/绑定操作ID必须稳定且重试复用；读取既有binding和instance后再修改，解除绑定保留历史实例，重新接入要明确恢复原实例，不能每次生成新进度。配置和绑定的revision分别校验，多步骤失败必须报告真实部分状态，不能假装原子成功。

现有固定房`-900000001`由模块内部适配到`shiyeJournal.program('status'/'config')`。它只更改原db.revisit规则；开关/规则由后端持久化，同会话多窗口读取同一配置。BroadcastChannel仅通知相同roomId重新读权威配置，消息本身不携带或保存配置；其他窗口正在编辑时保留草稿并提示冲突。

## 验证与待接线

合成预览注入上述port，演示两会话独立规则和同会话双窗口冲突，不连接正式API。预览fixture位于`tmp/conversation-services-ui`，不得打入产品候选；正式UI在通道缺失时允许查看参数但禁用保存。

下一步仍需原生固定桥白名单、稳定journalSource/conversation身份、worker按instance/binding隔离的feed/ack/outbox/来源/评论/撤回、两个真实会话重开/续推联调。只有这些通过后，才能将普通会话的选择器标记为正式可用。本轮不改变旧日记、旧评论目标或已启用推送进度。
