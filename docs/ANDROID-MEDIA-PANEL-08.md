# Android 0.8 附件面板

2026-10-17。此项只调整选附件的原生 UI，复用现有 Web 文件选择和媒体写入通道，不新增正文、时间、存储或同步算法。不操作手机、AVD、安装或启动；集成和设备验收由主会话执行。

## 实现与接缝

`android/app/src/main/java/dev/shiye/app/AttachmentPicker.java` 保留两参构造器及 `Listener.onPhoto(Uri)`、`onBrowse()`、`onCancel()`，两参仍只显示图片，兼容思绪插图。新增三参 `AttachmentPicker(Activity, Listener, boolean includeVideos)`，聊天传 `true` 即启用图/视频混排；选中的视频同样通过原 `onPhoto(Uri)` 回传 URI，这个旧方法名不表示发生了图片转码。

主会话需要在 manifest 声明 `READ_MEDIA_VIDEO`，只在聊天调用方传 `true`；聊天 HTML 的 accept 和文件浏览入口需要接受视频/通用文件。日记插图继续使用两参构造器及 `image/*` 文件限制。`onBrowse()` 只通知调用者，面板本身不启动系统 Activity，不改 ChatFiles、导入媒体或正文数据。

- 有授权时直接显示最近图库三列网格，按 `date_added DESC, _id DESC` 排序，最多90项。图和视频保持各自 MediaStore URI；视频有播放/时长角标，未知时长显示“视频”。单击即返回一个 URI，沿用当前选图方式。
- Android13分别检查照片/视频权限；Android14兼容有限授权，按实际允许类型查询。部分授权时提供“管理授权”；未授权和拒绝时保留文件入口，不误报整个图库为空。
- 加载、授权范围为空、图库本身为空、提供器失败分别提示；失败支持重试或从文件选择。单缩略图失败显示替代图，仍可选择原件。
- 面板为可见窗口约68%，上限620dp，小窗口至多88%；表头44dp，底部保留图库/文件入口。状态内容可滚动，横屏/较大字号下仍可访问授权与重试按钮。宽度依据实际 GridView 而非固定屏幕宽度计算。
- 关闭/重载递增 generation 并取消 CancellationSignal；旧查询/缩略图回调失效。后台只读线程安全标记，View/tag与缓存提交留在 UI 线程。销毁中取消待选回调，关闭动作只回取消一次；捕获缩略图排队与 shutdown 竞争，避免执行器拒绝异常。

参考既有 [Android UI 分工与证据](ANDROID-REFERENCE-REVIEW.md) 中 Telegram 的最近媒体网格/底部文件入口模式，以系统 Dialog、GridView、MediaStore、ScrollView 组成；没有新抓取网页、导入 Telegram 业务/通讯代码或读取 QQ 私有代码。

## 验证与边界

仅编译 `AttachmentPicker.java`：JBR javac `--release 8`，classpath 为 Android36 的 `android.jar`，成功。保留 Java8 过时和原有 Android 兼容 API 的弃用提示，不视为错误。回执位于 `outputs/2026-10-17-android-chat-ui-08/media/compile-receipt.json`；类文件位于 `tmp/android-chat-ui-08/media/classes/`。未跑全库检查，未触及任何正式日记、媒体或设备数据。

这只证明源码能针对 Android API 编译；运行期 MediaStore 提供器、Android13/14权限组合、横屏/大字号、真实照片/视频缩略图、系统文件入口与聊天视频发送仍需集成包设备验证。不能据此宣称 APK 已部署、手机已验或视频全链已支持。两参日记入口不扩大到视频。
