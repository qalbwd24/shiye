# 表情包：五条候选与管理排序

2026-10-18用户确认：`/`浏览和名称搜索都最多同时看到五条，后续结果靠方向键滚动；管理页优化排列并提供快捷调整；移除输入框笑脸按钮，管理入口统一到设置。ui33已标准升级并实际运行，39项安装资产UI及原生运行回执通过，见[验收](validation/2026-10-18-sticker-sort-five.md)。

候选默认显示5行，可在“设置→表情包”选择1–5行。匹配结果不再截断成12项；↑↓/←→继续选择后面的项目，并滚动选中行进视野。缩略图只按可见项目读取，候选不抢输入焦点；名称精确/前缀/包含的相关性仍优先，同分再用收藏排列。窗口过矮时可见行数会减少，保证不伸出窗口。

管理入口：“设置→表情包→管理表情包：名称、备注与排序”。管理页采用单列：缩略图、完整名称、信息编辑/移除，以及上移、下移、置顶、置底；批量操作有按名称排列、反转顺序、恢复常用顺序。点击管理缩略图不会发送消息。管理页不再显示emoji切换按钮，旧emoji/别名数据保留；普通输入区和图片说明区笑脸按钮移除，日常发送使用`/名称`。

## 显示偏好的保存与跨端边界

本轮排序是**本机界面偏好**，不是消息属性或新的后端权威收藏表；不为排序重写历史消息、时间、收藏UUID、Blob、备注或服务器回执。现有IndexedDB `shiye-preview-assets-v1/assets`增加一个独立记录：

```json
{
  "id": "preference:sticker-order-v1",
  "version": 1,
  "mode": "manual",
  "ids": ["sticker:synthetic-local-id"]
}
```

合成示例。mode为manual或usage；ids为本机稳定资产ID，去重、有序；保留已移除素材的历史引用和未知字段。未知高版本不覆盖。上移/下移等操作串行读取最新记录、调整并提交，不用过期副本覆盖连续操作。首次手排以前沿用常用次数；首次调整把当前可见素材顺序固定，新增素材排在已指定项之后。恢复常用只切mode，不删除原素材或别名。名称排序按中文locale、自然数字和忽略英文大小写比较，反转则反转当前可见顺序。

候选行数使用既有`shiye-input-commands-v1.visibleCount`本机偏好，整数1–5，缺省5；旧字段保留。`shiyeStickerOrder.move(assetId, action)`与sort(records)为本机UI接口，不是HTTP API；action为top/up/down/bottom/name/reverse/usage。name/reverse/usage三个批量操作不需要assetId。保存后沿用shiye-stickers-updated通知管理页和候选更新。

Android可采用同样的偏好语义和界面规则，但不能把电脑本机assetId直接当成Android ID或服务mediaId。当前排序偏好**尚不跨端同步**；将来如要同步，需通过serverStickerId/serverMediaId建立身份映射后接入同步协议，本轮未新增排序HTTP口或上传本机IDs。两端原件、GIF、名称/备注仍按[媒体契约](STICKER-IMAGE-CROSS-DEVICE.md)和既有后端API；不另建收藏数据源。Android APK由负责会话独立适配，不随电脑升级。

实现只改桌面`shiye-input.js`、`shiye-preview.css`、`shiye-preview.js`，基于冻结ui32，不混入另会话对共享收藏客户端/Android/同步的未发布改动。产物`outputs/sticker-sort-five`；临时脚本与隔离库`tmp/sticker-sort-five`。运行与数据保留结果见上述验收。
