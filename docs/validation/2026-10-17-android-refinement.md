# Android 0.5 功能与交互完善验收

2026-10-17 功能试用版完成并已在AVD启动；性能验收未达标，不能标为全项优化完成。用户已确认背景、三入口布局；本轮需求与历次电脑文档映射见 [需求及取舍](../ANDROID-REFINEMENT-REQUIREMENTS.md)。

## 首轮构建与保留数据

0.5.0-frontend/code7首包SHA-256 `4d14b30a2989375cf4d247859610d6795bc9566e525ec5465977373e7ccec302`，91,397,235字节。Gradle成功36秒；11712个Telegram资产逐项hash、共享编辑核/适配资源及许可证核对通过，无INTERNET权限。

主AVD安装前flush ACK、完整私有tar备份，安装后启动前213个原文件hash全部保持；覆盖安装和启动成功。手机仍0.4由用户使用，本轮未操作手机或桌面运行版。

## 已有定向证据

- 日记真实共享Tiptap＋合成桥24项通过；包括全局设置关闭后分类/版本同步修正后的复跑。
- 聊天移动浏览器24项通过，360/412实绘无横向裁切；原伪元素-50vw导致scrollLeft198问题已修，失败图保留。
- 本地文件桥7项Blob分块/超时取消检查通过；不替代系统文件提供者验收。
- AVD独立UUID SQLite分类/默认/排序/时钟26项通过。

## 首轮AVD真实阻塞

真实点击笑脸已能打开，系统选择合成PNG并导入收藏成功，但点击发送该表情包时WebView出现“Shoot! Something went wrong / [object Event] undefined”。浏览器通过并未覆盖此实际Android问题，当前正在定位；没有清理IDB或隐去按钮来规避。此问题修复前不把首包算功能验收通过，也不启动无效动画矩阵。

实际系统文件/GIF/设置与帧率后续结果见 [QA明细](2026-10-17-android-refinement-qa.md)。模拟器实际刷新率、帧延迟与present间隔分开记录，不将rAF频率或浏览器测试视为Magic7物理120Hz保证。

产物：`outputs/2026-10-17-android-refinement/`；临时：`tmp/android-refinement/`；私有备份：`var/android-backups/2026-10-18T00-35-00-before-refinement/`，不包含在公开报告或源码交付。

## 第二候选（实际复验中）

表情包根因为 Android 所选 File.size=0 但 arrayBuffer 有字节，复制预览时丢字节。适配层实体化异常文件，覆盖普通附件与旧收藏只读恢复；27项浏览器定向通过，仍需真实系统复验。第二包 `Shiye-Android-0.5.0-ad712841.apk` SHA-256 `ad7128412ace7d290ec2202d4a41148f4956e87b3d31c967ca8dd9dd4311478f`，91,411,017字节，构建12秒。安装前聊天与日记均保存ACK；新备份 `var/android-backups/2026-10-18T00-55-53-before-refinement/`，覆盖后262个原私有文件hash全部保持，已启动。回执在 attempt-2。

首包与失败证据保留。attempt-1/telegram-build-manifest.json 复制时已是第二候选清单，不能用作首包清单；首包原清单摘要以 attempt-1/apk-artifact.json 为准，差异解释见 manifest-provenance-note.txt。

## 最终候选3（帧与收尾核查中）

实际AVD已验证候选2的旧收藏PNG、新GIF、普通TXT选择预览发送，原字节hash一致；系统另存TXT也实际落盘字节一致。主代理实看截图发现输入胶囊内层单独白底割裂，候选3只改CSS统一外层surface/内部透明，保留引用块；360/412多行实绘3断言通过。

最终候选APK `Shiye-Android-0.5.0-bc717f57.apk` SHA-256 `bc717f572c4dfef0e01c5a798e5985c07e15acde95a2386a1a5fbffeb83aee3e`，91,411,017字节，构建14秒。flush ACK后完整备份，275原私有文件覆盖前后hash全部保持，已启动。回执 attempt-3，备份 var/android-backups/2026-10-18T01-00-11-before-refinement。只复验输入区并补尚未验的刷新/动画/取消/重开；不重复无影响全矩阵。

## 重开核查发现（继续修复中）

候选3重开后初始800ms PNG为空白占位，后来未点击/重发自行显示，不能写成持久数据丢失，也尚未将初始加载延迟结案。GIF在原持久格式只有filename属性，被上游当普通文件卡，动画未通过，正在补保持原ID/时钟/字节的只读渲染适配。实际显示周期16666666ns，即60Hz；渲染器为Google(Intel) Android Emulator OpenGL ES Translator / Intel Arc B370。不宣称模拟器证明Magic7物理120FPS。

候选3非媒体收尾：系统选文件/另存为取消后全部消息hash精确保持；QA筛选列表手动刷新显示已是最新，筛选与行bounds保持。日记设置等待900ms后opacity=1/transform=none，稳定图无正文重影，早先截图仅进入过渡；默认18px/1.85已显式恢复，正文hash/revision不变。帧测与GIF最终复验仍待候选4。

## 候选4 GIF兼容与最终短测

GIF增加严格MIME/签名的只读预览，从持久化原字节重建，不改worker/历史ID/时钟/下载卡。有限重试处理初次提交尚未落库，换房回收URL和自加节点，回房重新建立；11项定向浏览器实绘/重开/回收通过。

APK `Shiye-Android-0.5.0-c60bac46.apk` SHA-256 `c60bac46e175629911c4d830f69fb12eee6abb11a2704919662f5267666872e6`，91,412,766字节，构建15秒，11712资产及编辑核hash一致。安装前flush ACK，完整备份 var/android-backups/2026-10-18T01-07-45-before-refinement；278原私有文件覆盖前后精确保持，已启动。回执 attempt-4，QA正做最后GIF实绘/重开和4核心帧场景；其余未受影响证据复用。

## 最终结论及后续入口

最终APK为候选4 c60bac46（上文完整SHA）。GIF原生屏幕四次抓帧出现两种图面，冷重开同ID可见；文件另存/取消真实字节与消息hash保持。最终日记18px/1.85、原完整聊天偏好及pin[-10]恢复，回默认会话列表flush ACK。保留2篇QA日记和3个QA会话（后一个仅滤镜诊断）；原7会话消息保持，未操作手机/桌面运行版。

**功能试用可交付，流畅度不达标。** 实际60Hz/GLES Intel Arc B370：发送+IME官方jank44/58=75.86%，切房40/62=64.52%；完成延迟p95分别135.36/133.79ms。该完成延迟不是帧率倒数；实际present间隔也含操作等待。系统Settings同平台基线jank1/121=0.83%、present p50 16.57ms，说明不能把App长帧全推给模拟器。一次去内建背景filter/blend诊断未改善，已撤销临时style，不改用户认可背景。完整原始记录及样本限制见QA明细。

最小阶段拆分只读证据：发送样本p50的SyncQueued→SyncStart约25.47ms、IssueDrawCommandsStart→SwapBuffers约29.06ms，主线程layout约0.04ms、draw约0.30ms；这只能指向渲染队列/绘制阶段，尚不足以定位JS、GPU驱动或具体CSS根因。后续应抓WebView与RenderThread关联trace，避免无证据关闭动画或用简化样式掩盖。Magic7物理120Hz、长期功耗/CPU/内存未验；冻结ui18与桌面ui21后续撤回重编辑差异仍保留。云端尚未接入。

文档映射、功能索引、CHANGELOG和交接入口已更新。测试中间文件tmp/android-refinement，APK/截图/回执outputs/2026-10-17-android-refinement；真实备份var/android-backups，不随源码交付。
