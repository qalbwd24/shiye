# 长文段落消息投影

2026-10-18补充：分段与原body/编号不变，回看Markdown展示仅对日记顶层段落清理写作缩进，marks前处理，代码与嵌套结构保持。Android接入统一读[电脑实际内容契约](DESKTOP-ANDROID-CONTENT-CONTRACT.md)，同输入合成fixture已补，安卓尚未完成消息层接入。后台已更新，ui28本轮标准恢复原生ready，见[本轮验收](validation/2026-10-18-revisit-indent-and-content-contract.md)。

用户2026-10-17确认：朝花夕拾按真实段落和段首缩进拆消息，同一个手打时间戳下的多段按段数依次增加1–2秒。此变更适用于历史长文的只读消息来源；快捷窗正文、排版、手打时间戳和图片插入时间继续保留。

## 解析与时间

共享纯函数`public/shared/diary-paragraph-messages.js`输出通用MessageUnit。顶层段落分开；同一段内实际换行后的全角空格、Tab、两个以上空格缩进或空行形成边界。普通续行和屏幕自动折行不切分。代码、列表、表格、引用块保持结构，不在其中按缩进拆消息。独立时间标记和分割线不生成额外空消息。单段保留原编号；媒体单元不走文字切分。

首段以原单元时间为起点；2–8段且距离下一个真实手打时间足够时，每段加2秒，超过8段或间隔不足时每段加1秒。推算结果不越过下一个更晚的真实手打时间；空间不足时限制并标记`clamped`，同秒按段落顺序排列。没有可信时间时仍不编造时间。

派生时间的`source=paragraph-estimated`，保留`baseInstant/baseSource/offsetMilliseconds`；这些秒数是显示/回看排序估计，并非真实输入时间。媒体沿用已有insertedAt，旧独立附件仍按原日记编辑时间推定，不跟随文字的加秒。

## 身份和数据边界

原Entry、正文richdoc/layout、规范父单元、媒体、分类和标签不改写。`readDiaryCandidate`新增`paragraphMessages`，原`units/layout`保持兼容。来源目录使用派生段落调度，同时保留原父ref的只读解析别名。父单元revision改变会产生另一组段落ID，避免把旧评论默默改指新段落。

派生ID为`父ID:paragraph-v1:r版本:六位段序`；`paragraphProjection`保留父ID、段序/段数、父blockId、步长和限制标记。原父单元的全文sourceSpans不伪装成精确段落范围；派生单元sourceSpans为空，由父引用追溯原文。此层是可重建投影，不建立第二套可编辑正文。

## 已发来信兼容

后端`delivery/paragraph-upgrade.mjs`在串行mutate中添加已经到时的派生投递，按原批次规则版本和原推送时间计算，保持普通投递ID/归档校验及去重契约。旧父投递、批次、评论保留；父投递新增`paragraphReplacements`。新首段可带`replacesDeliveryId`，让前端复用原本地消息号。未来段落不到时不提前投递。重复tick不增加同一投递。

feed保留旧父sequence并返回`superseded:true`，客户端按原始分页游标推进、只将非superseded项交给worker。不能先删父项再计算分页，否则会漏发。旧父回执仍可解析/评论；旧评论保持原关联，新回复指向选中的派生段落。首段替换旧长气泡，其他段落正常呈现，不同时展示全文和其分段。

## 接入与状态

API health的`revisit.paragraphMessages=1`表示新投影服务已加载；tick可返回`reprojected`，区别于正常新到点的`created`。前端需同时支持隐藏父标记和首段替换；仅更换后端不能当作前端已适配。

Android应复用此共享纯函数及相同身份/时间规则；当前安卓尚未接完整MessageUnit适配，本轮不重建APK或声称安卓已使用此算法。朝花夕拾的多实例后端共用来源投影，各实例投递/评论仍独立，前端多实例选择器仍属于另行接入范围。

验证及实际部署见[本轮验收](validation/2026-10-17-diary-paragraph-messages.md)。
