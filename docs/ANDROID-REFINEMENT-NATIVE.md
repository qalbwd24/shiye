# Android 0.5 文件桥与列表刷新

2026-10-17 源码已实施，运行验证等待本轮集成；不能据本页视为手机已更新。完整范围与文档取舍见 [需求](ANDROID-REFINEMENT-REQUIREMENTS.md)。

## 文件处理

旧TelegramFrontend忽略FileChooserParams，把所有选择请求交给图片图库。现在按acceptTypes区分：纯图片保留现有图库；文件/视频/其他类型走系统ACTION_OPEN_DOCUMENT，保留accept及多选模式，不强制转图片。

`native-files.js`向已有MessagePort安装`shiyeAndroidFiles.export({blob,name,mimeType,action})`。实际本地Blob按192KiB顺序分块，原生ChatFiles在IO队列写入专属缓存临时文件；原生检查会话token/所属port/offset/总长度及64MiB上限，系统另存为选择URI后才复制，写完才确认saved。取消明确返回cancelled；发生错误保留原聊天资源，仅清理本次创建的临时文件。离开WebView或Activity关闭也释放本次会话，不扫描或删除其他缓存/历史附件。

action=open先另存为成功，再通过系统ACTION_VIEW打开所选URI；设备没有可用应用时明确说明已保存。不取外部HTTP地址，不开放网络权限，不把未完成传输当成已保存。系统文档提供者写入中途失败可能留下其创建的部分目标文件；界面必须报失败，不能保证第三方提供者支持原子替换。当前不自动删除用户选择的外部URI。

7项Node真实Blob分块检查通过：多块字节一致、offset、失败取消、错误后释放busy、空文件、无效输入与begin超时可取消；实际系统选文件/另存为/取消待AVD验证。

## 思绪刷新

列表提供可见刷新按钮；再次点当前思绪底部入口也刷新。默认回前台自动检查，可在设置切换手动；正文退出保存仍读取最新本地摘要。没有云轮询或虚假刷新动画。

后台读取摘要，合并进行中的重复请求；自动重复检查间隔最短1.5秒。无数据变化时不重建ListView，不闪白、不改变筛选或位置；内容变化时更新adapter并按原首条ID/偏移恢复锚点。分类结构变化才重建分类控件。离页后丢弃旧页面请求结果，失败保留列表并显示重试；搜索输入120ms合并，避免每个按键重复过滤。

全局设置关闭后检查列表，分类排序/名称等变化可显示；删除当前筛选分类后回到全部，避免留下无法取消的失效筛选。分类排序保存采用固定底部按钮，与参数滚动区分开。刷新速度需以AVD实测回执为准，当前未写固定耗时承诺。

新增`showAppSettings`和`showCategories`编辑器RPC。分类管理关闭后返回bootstrap，编辑页由日记适配层对齐同篇revision和categoryId；全局设置打开不重建正文。默认新篇分类与排序存储见 [原生设置](ANDROID-REFINEMENT-SETTINGS.md)。

产物：outputs/2026-10-17-android-refinement/；临时：tmp/android-refinement/。原AVD0.4已flush ACK、完整私有备份，等待覆盖安装；手机继续0.4手测，未操作手机或桌面运行版。

只读复核后的修正：启动系统选择器前复查token/owner与Activity存活；客户端提前生成token，begin迟到/超时也能取消IO队列中的同会话。配置重建当前按取消导出处理，新Activity收到已选目标会提示保存中断，请重新保存，不冒称旋转续传；第三方系统已创建的空目标文件不擅自删除。

集成复核：编辑页showAppSettings现在等待全局设置关闭返回bootstrap，与分类管理同样对齐当前篇版本。从编辑页不能经旧记录入口绕过保存退出，需先回列表；聊天进入旧记录需先收到leaveTelegram保存ACK。


2026-10-17本轮收束：0.5.0/code7 APKc60bac46已在AVD运行，核心功能实际验收及原数据保护通过；性能采样明确未达标，未宣称120FPS，手机保持0.4。最终状态与后续问题以[集成验收](validation/2026-10-17-android-refinement.md)和[QA原始边界](validation/2026-10-17-android-refinement-qa.md)为准，上文准备时“待验”保留为历史。
