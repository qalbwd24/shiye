# Android 020 图片与表情面板接入

2026-10-19。依据 `ANDROID-019-PHONE-CHAT-FEEDBACK.md` 的 F1/F2 与用户提供的 Tele 相册截图；QQ 聊天主体继续使用现有独立视图。

## 已改源码

- `android/app/src/main/java/dev/shiye/app/AttachmentPicker.java`：保留原有单选构造，新增 `AttachmentPicker(activity, listener, includeVideos, true)` 多选模式及 `Listener.onPhotos(List<Uri>)` 默认兼容回调。最近项目按 MediaStore 时间倒序读取最多 300 项；点选顺序以编号展示，最多 50 项。长按图片预览；相册入口按当前查询范围内的 `bucket_display_name` 筛选，文件入口继续交系统文件选择器。顶部握柄可拖动展开/收起，展开高度等于当前可见区域。点“发送(n)”只回传一次按选择顺序排列的 Uri。
- `android/qq-chat/panels.js`：原生选择器返回 FileList 后立即调用 `source.sendFiles`，不再打开第二个发送确认。发送失败保留本次 File 对象；明确失败可以重试，ACK 不确定或 source 锁定时禁用重试并提示先核对聊天记录。表情包仍为点选即调用 `source.sendSticker`。
- `android/qq-chat/panels.css`：失败保留面板展示附件顺序和原件说明。

## 原件与权限边界

原图标识说明当前传递原始 Uri/File 字节，未调用缩放或重新编码；目前无可切换的压缩能力，因此没有提供会误导用户的“关闭原图”开关。预览只用于显示，不替换发送原件。图库权限仍由原有 Android 读取权限路径管理；局部授权只列用户允许项目。相册是最近 300 项内的分组，不宣称整个设备全量相册。

## 主任务接线

`MainActivity.chooseTelegramPhotos` 需用新的四参数构造并覆盖 `onPhotos(List<Uri>)`，将完整 Uri 数组交回 WebChromeClient；旧 `onPhoto` 可继续作单选兼容。现有 `onBrowse` 系统文件选择器支持多选。会话视图仍回调 `panels.files()`，无新前端回调。日记多选能力若由主任务复用，须按自身编辑器语义另接入，不能把单选默认回调误称多选。

## 本阶段验证边界

`node --check android/qq-chat/panels.js` 已通过。四个改动文件在当前 checkout 均为未跟踪文件，`git diff --check` 无法检查其内容。本工作者未启动模拟器、未构建 APK、未修改手机或正式库；实际 MediaStore 相册列、选择顺序、预览、拖动、系统文件切换和发送 ACK 须在集成包模拟器中验证。若权限环境未提供 `bucket_display_name`，图库查询会进入现有错误/文件入口，需按模拟器结果兼容处理。
