# Android 0.8 会话背景资源

2026-10-17。ChatBackgrounds 是私有外观资源桥，随想设置通过 `shiyeAndroidBackground.choose()` 选择图片。它不写思绪 entries、聊天正文或媒体出现时间，不替代后续共用电脑算法的内容适配。

图片经 ACTION_OPEN_DOCUMENT 明确选择，最大20MiB，原始字节保留在 `files/chat-backgrounds/<uuid>.image`；按电脑版 `previews/telegram-chat/shiye-room-workspace.js` 的192px中心 cover/WebP质量0.85规则生成 `<uuid>.webp` 头像。原生解码采样限制长边约2048并处理EXIF八方向；视觉参数相同，不承诺不同编码器生成逐字节相同的WebP。

回执仅 `{assetId,url,avatarUrl,position:'center'}`。偏好 `roomBackgrounds[roomId]` 经原有 native preferences 的事务 ACK 保存，未知字段保留；同源资源URL限定 `/telegram/local-background/<uuid>.image|webp`，不把data URL放入偏好，不允许任意文件路径。取消选择返回null、不更新偏好。恢复默认只解除此房间引用；不自动删除其他可能仍被引用的私有图片。

资源写入在IO线程，选图期间保留单个pending请求；WebView dispose 调用 `cancelOwner(port)`，代际token阻止旧导入任务回到新请求。未交付的取消任务删除自身新建的两个文件，不清理旧资源。设置弹窗关闭后的晚到结果也不再写入偏好。

只读交叉检查发现背景请求码205与既有普通文件另存冲突，已在构建前改为206，保留ChatFiles.SAVE_REQUEST=205。MainActivity分别路由，两者不可合并。所有Java源码以Android36的android.jar编译通过；编译不能代替图库/文件选择器/取消重开和AVD实际显示验证，具体集成范围见本轮验收。

外观引用目前仍是本机偏好，不宣称一端改图另一端已同步。以后共用电脑配置/媒体仓库时，应保留原图身份与引用，不能将这些UI资源误作日记附件迁移。
