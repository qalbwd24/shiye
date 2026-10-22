# 会话后端接口 v1

2026-10-19 源码候选扩展：原子会话设置、多程序/AI参与者、统一收发/评论和会话绑定游标已完成隔离验证；正式API/窗口本轮未更新。新增`external-program`仅提供外部程序/AI角色、参数与消息通道，不调用模型或脚本；旧revisit协议继续保留。当前接入开发以[统一会话后端API](CONVERSATION-MESSAGING-BACKEND-API.md)为准，先检测`atomicConversationSettings/conversationMessaging`能力，不凭0.9.27版本推断已部署。下文创建/绑定是低层接口，新客户端优先使用原子settings/save。

2026-10-18 Android接入增量：手机0.11只用于UI手测；电脑/AVD0.12候选新增INTERNET与原生固定服务发现/status客户端，WebView联网拦截保留。只读目录快照不代替完整本地资料，未实现云同步/身份迁移/绑定或自动收件；最新后端仍按实际health能力与路由，不按package0.9.25猜已上线。见[接入与后续](ANDROID-SERVER-CONNECTION-012.md)及[实际验收](validation/2026-10-18-android-service-adaptation.md)，下方无联网权限等为先前0.11及更早阶段。


本接口由后端维护，前端按此接入会话设置。当前服务类型只有实际实现的`revisit`；AI/其他程序今后以新的服务适配器接入，不显示成已可用。服务实例与会话绑定由后端持久化，前端不保存另一份权威规则/游标/评论。

2026-10-17随想ui27在原兼容朝花夕拾设置接上历史起止日期，并修正随机/间隔切换与主动刷新提示。此表单仍调用/api/revisit，不等于多实例服务选择UI/worker/桥已完成；独立会话接入继续按本契约维护。日期提示协议为前端可重建元数据，参见[模式切换验收](validation/2026-10-17-revisit-mode-switch.md)。

## 发现与创建

沿用拾页本机来源检查和访问锁。写请求携带`X-Diary-Client: desktop`，有Origin时须与当前本机API一致；401使用既有解锁流程。密码/会话不写入服务配置。所有JSON均为UTF-8。

| HTTP                                                  | 用途                                                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| GET `/api/conversation-services`                      | providers、instances、bindings、registry revision与legacy兼容入口；纯读取，不初始化任何记录 |
| POST `/api/conversation-services/instances`           | 创建独立实例；调用方生成并保留UUID，重试保持ID和参数                                        |
| PUT `/api/conversation-services/bindings`             | 用版本校验设置/切换/解除会话绑定                                                            |
| POST `/api/conversation-services/request`             | 通过固定动作访问一个指定实例；适合原生固定桥                                                |
| GET `/api/conversation-services/comments?entryId=...` | 按原日记聚合各实例与旧单例的评论，附instanceId；按评论时刻排序                              |

`GET /api/health`返回的`conversationServices`声明`{version:1,providers:['revisit'],isolatedInstances:true,autoStart:true}`；autoStart跟随生产宿主设置。不能仅凭0.9.24版本号判断接口存在。

创建示例（仅虚构，不应自动写入用户正式库）：

```json
{
  "id": "841ac609-66ef-44fd-a593-8ba0a62209c9",
  "providerId": "revisit",
  "name": "日常回看",
  "config": {
    "enabled": true,
    "mode": "daily-random",
    "dailyTime": "08:00",
    "timeZone": "Asia/Shanghai",
    "categories": []
  }
}
```

返回201及`{id,providerId,name,config}`；同ID相同参数重试返回同一实例，不重置它后来的规则或进度。JSON对象键顺序不影响创建幂等；同ID用于不同参数409。未知服务400。当前默认daily-random、08:00、北京时间、未启用；示例显式打开。categories空数组为全部可用分类，非空必须使用实时分类。interval、title、sender沿用朝花夕拾配置。

2026-10-17新增可选`sourceDateFrom:"2025-10-01"`、`sourceDateTo:null`：随机模式按来源消息在实例时区的日期过滤自定义历史范围，起止边界都包含，不按篇日期/UTC日期过滤。每个边界缺省或null表示不限制；null显式清除，省略保存则保留原值。实际不存在的日期或起始晚于结束返回400。更改任一边界产生新ruleRevision并从当前时刻初始化，原日期/投递/评论保留；没有候选保存空选择，不退回范围外。实例发现的configuration.sourceDateFrom/sourceDateTo描述其日期类型、可空及含边界属性。前端设置页提供“历史日期范围／开始日期／结束日期”，空白转换为null，缺省的日期字段不要以空字符串提交；时区与此范围分别设置。

## 绑定

```json
{
  "id": "be4639c3-ad5f-4533-b8d2-6a9b7e37b586",
  "conversationId": "desktop:6f1da996-1fd7-46cc-ac9a-4dd15f9e9941:-20",
  "instanceId": "841ac609-66ef-44fd-a593-8ba0a62209c9",
  "expectedRevision": 0
}
```

id为稳定bindingId，conversationId是带来源命名空间的稳定会话身份；桌面使用`desktop:<shiyeJournal sourceId>:<roomId>`，手机应复用已同步身份，不能另造裸数字房间。不要用标题或分类名作主键。源码候选允许同会话多个独立实例；同一实例只属于一个会话，解除后也不能改属别的会话，保留历史关联。旧正式端仍为原单绑定前端路径，原生/worker还未适配。

返回`{id,conversationId,instanceId,active,revision}`。新建expectedRevision=0，之后使用当前绑定revision；绑定ID不能改属另一会话，冲突409。紧接上次提交的相同请求可幂等返回，不覆盖更新的选择。

解除时保留同一id/conversationId，发送`instanceId:null`及最新expectedRevision，返回active=false，保留原instanceId用于追溯。解除不删除实例、日期、进度、投递或评论。换实例同样不改绑旧消息；重新绑定原实例沿原进度继续。创建实例成功、绑定失败时保留该实例，前端可用原ID重试，不创建重复副本。

## 指定实例的固定动作

```json
{
  "instanceId": "841ac609-66ef-44fd-a593-8ba0a62209c9",
  "action": "feed",
  "payload": { "after": 0, "limit": 50 }
}
```

payload必须是对象，无参数也传`{}`。响应保持现有朝花夕拾结构，并增加`scope:{instanceId,providerId,bindingId,bindingRevision}`；绑定解除后后两项可为null。

| action        | payload / 返回                                                                      |
| ------------- | ----------------------------------------------------------------------------------- |
| status        | `{}`；config、categories、cursor、randomDay与scope                                  |
| config        | `{expectedRevision,...配置}`；使用实例自己的config.revision；修改只影响该实例       |
| tick          | 自动`{}`；手动补看`{manual:true,from,to}`；仍使用服务端时钟和既有范围限制           |
| feed          | `{after,limit?}`；各实例独立分页sequence/next/total，不共用游标                     |
| source        | `{deliveryId}`；只读原消息与整篇日记、该实例按篇评论                                |
| media         | `{deliveryId,assetId,offset?}`；来源所属媒体原字节分块，不重新压缩                  |
| context       | `{batchId,deliveryId?,occurrenceId?}`；验证固定回复/媒体对象                        |
| comment       | `{operationId,batchId,deliveryId?,occurrenceId?,text,sentAt?}`；实例内幂等，返回201 |
| withdraw      | `{operationId}`；只撤回该实例评论，墓碑优先                                         |
| comments      | `{entryId}`；该实例的按篇评论与精确定位                                             |
| runner-status | `{}`；该实例运行器状态                                                              |
| runner-start  | `{intervalSeconds?:30}`；绑定后可手动恢复                                           |
| runner-stop   | `{}`；只暂停该实例本次后台运行                                                      |

同一动作也可通过REST使用`/api/conversation-services/instances/<id>/revisit`及既有朝花夕拾后缀/HTTP方法，例如GET根路径为status、POST`/feed`、PUT`/config`、GET`/runner`、POST`/runner/start`。不开放任意URL转发、任意action或旧单例archive恢复到新实例；未知操作400/404，未知实例404，非法ID400。

未绑定实例不自动运行，手动start返回409；自动tick返回disabled且不推进游标。显式手动补看和旧历史/评论读取仍可用于未绑定实例，便于预览与追溯。生产后台为所有活动且启用的实例自动续推；无窗口也执行，锁定后正常解锁自动恢复。只停止A不影响B；解除绑定会收起该实例运行器，保留持久状态。取消启用持续关闭；手动stop暂停至本次后台结束。

## 前端适配约束

1. 会话设置先发现服务，读取绑定，再创建/选择实例和保存绑定；成功回执到达后再显示接入成功。配置修改使用实例revision，绑定修改使用绑定revision。
2. 收件按instanceId独立分页。新投递与组ID含实例命名空间；消息仍保存`instanceId + deliveryId/batchId`及来源，ack/outbox/撤回同样带实例。普通UI不能继续把所有程序消息写进固定房间`-900000001`。
3. 无引用回复当前会话/实例最近已接收历史单条；引用回复消息自身携带的instanceId及deliveryId。发送/草稿/重试时冻结该身份，切换设置或新来信不得重定向。旧实例已解除也可处理其原有评论，不借当前绑定去重新解释它。
4. 旧单例`/api/revisit`与原固定房间保持兼容，不能自动归为新实例、清空或重发。新UI要同时保留旧消息和新实例来源，分类/会话名变化不改稳定编号。
5. 本轮仅部署后端，没有修改或编译会话选择UI/worker/原生桥。桌面接入需要在`ChatJournalBridge.cs`增加固定service-catalog/create/bind/request映射，在`shiye-journal.js`提供独立services入口；浏览器继续由固定桥访问本机接口，不开放任意URL。UI会话按该白名单实现并在自己的包中验收。
6. 两个会话分别验证规则保存/重开/收件、同来源不同投递ID、各自日期/进度、引用/撤回及一次后台重启。具体气泡/设置布局继续由前端维护。

## 存储与范围

新增可选`db.conversationServices={version:1,revision,instances,bindings}`，只在创建/绑定时写入。instance.state复用现有revisit状态模型，各自拥有config/cursor/randomDays/batches/deliveries/comments；通过原全库mutate串行队列提交，旧Entry/media/messageStore/chatJournal及db.revisit不搬迁。实例ID只作为运行时作用域和投递身份的一部分，不写入旧正文。分类改名同步引用该名称的实例过滤器与config.revision，原日期/游标/评论不重置。

当前上限128实例、512绑定，定义于public/shared/limits.js。没有删除/清空端口；服务创建和绑定与业务数据提交均失败可重试，未知持久版本409保留原数据。

完整库快照/备份输出会带新状态；通用合并恢复尚未实现实例/来源ID重映射，因此带conversationServices的备份合并恢复明确422拒绝，避免静默丢弃规则/评论。旧备份路径保持；单例状态archive不能跨实例导入。普通电脑重启使用本地原状态，无需导入备份。
