# Android 0.13：紧凑排版、全局透明主题与独立背景

2026-10-18。用户实际测试手机0.11后继续反馈，需求见[本轮确认](../ANDROID-COMPACT-013-REQUIREMENTS.md)。本轮只更新电脑主AVD，手机仍0.11/code13交用户测试；没有将AVD资料复制到手机，也没有操作正式电脑日记或桌面运行版。

## 运行交付

- `0.13.0-density` / code15，最终APK `outputs/2026-10-18-android-compact-013/Shiye-Android-0.13.0-c52752b4.apk`。
- SHA-256 `c52752b42fcfecccb15d3d5727e278b8ecadc1887bd46d0d8ae707170cf3459c`。Gradle assembleDebug成功；AVD `install -r` Success、标准ADB启动Status:ok、版本回读一致。
- 安装前真实聊天flush ACK与完整私有备份保留，位置/hash见同目录`release-receipt.json`。未卸载、清数据或删除旧IDB/SQLite。早期候选3f932828/b6187d7f/f8f75a23保留，不能当最终包。
- AVD仍按Magic7实测：1264×2800、632dpi、系统font_scale1.3、WebView宽320/DPR3.95。Activity仅在自身Configuration使用fontScale1，两个WebView textZoom100；设备的全局字体设置不改。WebView默认minimumFontSize=8曾把6/5夹回8，现显式minimumFontSize/minimumLogicalFontSize=1，应用自身控件约束范围。

## 最终行为

全局主题由原生`GlobalAppearance`统一管理，设置→全局外观。浅色黑字、深色白字与冷蓝色调；聊天列表/消息/写作/思绪原生列表/设置/底部导航和系统栏一致响应。切主题不重建Activity、不重载聊天，也不改壁纸来源或正文。旧chat主题仅在首次迁移且全局尚未明确选择时作为默认；旧scope theme字段保留历史，显示服从全局。

壁纸与主题分开：写作页`appearance/`、思绪列表`appearance-list/`有各自私有设置和选择回调204/207；随想列表、聊天默认、当前会话保持既有独立scope。原生列表使用背景Drawable，文本本身不降透明度，按用户最新纠正，普通记录没有大底板，连续摘要下接小字和细分割线；置顶只用低alpha平面色调与标识。可选无膜/浅膜/深膜；原生膜精确对齐写作CSS `#ffffff38` / `#08131d66`。无膜+100%壁纸保留原图；用户选择极亮图并无膜时，不能保证图上所有弱化信息的对比度。

设置根页明确“启动与写作／全局外观／写作页背景／思绪列表背景／服务连接／数据与关于”；随想列表设置管理会话列表背景及聊天默认外观，会话内设置管理当前会话。分类管理集中新增、改名、删除、默认/取消默认和排序；返回真实父页，排序脏草稿可继续或放弃。默认/增删即时事务，排序显式保存且保留revision冲突保护。

聊天推荐13px正文/输入、8px时间、横8/纵4px留白、间距3px，保留手动参数。正文/输入范围6–28、时间5–16；纵横padding分开。实际短句泡高约27.50px、右边311/320、输入栏约44px、三按钮约36px。时间流内放正文尾部右侧，不单开大行。PNG单图最大176px、GIF缩略128px；原件、消息身份、媒体原字节不缩写。表情包直发通过实际本地ACK，普通图片选择仍保留确认。

写作成功自动保存不再反复闪状态/时间；错误仍可见并能重试。字数固定在工具栏上方左侧；短文/空白页留额外滚动空间，不插入空段或制造空日记。保存ACK复用活编辑DOM；富文本继续复用电脑思绪编辑核，不改为聊天富文本近似实现。

## 验证证据与复用边界

| 场景               | 证据                                                                                                                                                                             |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 实际最终AVD聊天    | `avd-chat-verification.json`：12断言，13/8推荐、6/5真实下限、27.5px短泡、输入与按钮几何、PNG/GIF直发持久身份/无确认通过；`avd-media-geometry.json`补实际预览尺寸                 |
| 实际AVD全局主题    | `avd-theme-verification.json`：3断言，light/dark与native设置同步，隐藏聊天仍收到主题、timeOrigin保持；原生浅/深设置及思绪截图                                                    |
| 实际AVD分类        | `avd-category-verification.json`：12断言，同页控件、默认与取消、真实长按名称拖动、脏草稿返回/继续、保存重开、原顺序恢复、父级返回                                                |
| 实际AVD写作        | `avd-editor-verification.json`：8断言，root16、成功状态隐藏、字数与工具栏稳定、额外滚动、真实富文本写入ACK、节点身份保持、撤销后完整body/块ID恢复                                |
| 实际Android输入法  | `avd-ime-verification.json`：软件键盘真实展开，viewport651→380，字数仍在工具栏上方、工具栏底部等于viewport，无横溢出；原硬键盘偏好0已恢复                                        |
| 原生独立壁纸       | `avd-wallpaper-verification.json`与浅/深原生列表、独立写作背景截图；仅给AVD注入自己的合成图片及两个外观key，原设置另行恢复，未编辑日记数据库；没有重新验证系统图片选择器全流程   |
| 实际Chrome聊天行为 | `chat-behavior/`：主47、旧参数5、直接媒体草稿/引用/切房4，分批增量56；未称最终全量重跑                                                                                           |
| 实际Chrome布局     | `chat-style/`：基础30、PNG6、同图浅深透明13，分别记录受影响规则及截图，pageerror为空                                                                                             |
| 实际Chrome写作     | `editor-category/`：12编辑断言+1同图浅深；含延迟ACK连续输入与选区、不保存空白、错误重试                                                                                          |
| 构建与缓存         | `chat-behavior/build-guard/guard-report.json`5场景；`cache-version/cache-report.json`13实际保留SW旧缓存/IDB断言，静态和动态import是同一新版singleton、单次请求、数据和旧缓存保留 |
| 原生背景绘制合同   | `list-wallpaper/drawable-contract.json`10项，实际Drawable+记录Canvas stub；此项不冒称Android像素测试                                                                             |
| 共享内容核         | `shared-core-tests.log`38项通过，电脑共享格式/分段/富文本回归；不等于远端同步已接                                                                                                |

主题/分类/编辑/IME在f8f75a23包验证，之后仅index缓存版本化重打包；与最终031dc1d9的全部DEX、editor三文件和chat wrapper/CSS逐字节一致，见`evidence-reuse.json`。最终聊天与独立原生背景在最终APK另测；没有用旧包证据掩盖受影响路径。

## 过程中发现的真实问题

初次adapter-only遗漏冻结模块的prepare导出，完整构建补齐后，实际升级仍被原ServiceWorker旧unversioned缓存影响。保留失败记录并修构建器：精确内容hash importmap在module/preload前装配，CSP只增加该map JSON的精确sha256授权，普通静态和动态导入归一到同一版本URL；没有通过清缓存/IDB恢复“成功”。Gradle检查导出，adapter-only在缺接缝时写前拒绝。

测试脚本也修了几个判定问题：尺寸35.9968按浮点容差判断；空输入发送按钮使用真实`.shiye-empty-send`；原生分类从名称拖动，不从含默认/删除按钮的容器中心拖动；IME从真实段落坐标激活；主题等待异步传播而非固定0.3秒断言；外观CSS变量在editorPage而非root。壁纸打开的自动脚本中途未观察到editor页，后续实际页面回读/截图后接续，不把未跑完的一次脚本当完整通过。

`npm run check`本次373模块路径检查、全库ESLint通过，停在Prettier约40个共享/历史文件，未进入npm test；未批量格式化并行文件。013新文档和本轮JS/CSS分别检查，完整仓库check不得标绿。

## 用户追加纠正后的连续列表

初次013思绪仍有大圆角读板，用户明确指出不符合一本日记参考。最终仅改DiaryListPage视觉：移除普通行/月份/置顶heading的大底板，20dp页边距、15dp纵向留白、title15/summary14/meta11、摘要最多4行与0.5dp细分割线；置顶仅约8%平面色调。最终flat浅/深截图见`avd-diary-flat-light.png`和`avd-diary-flat-dark.png`，旧壁纸截图是背景隔离证据，不是最终卡片样式。最终包与031dc1d9仅native列表视觉差异，消息/编辑器/服务/原生背景接缝未改，实际浅深/条目打开另验。

## 仍待后续

手机仍0.11，0.13尚未真机安装/观感测试；系统图片选择器、很多分类的真实边缘自动滚动、完整旧原生随想页面、长期内存/CPU与物理120Hz帧率未本轮重验。旧0.5帧数据不能作为本版性能结果。

0.12服务目录/朝花夕拾只读状态接缝保留。已重读新[同步前端契约](../SYNC-FRONTEND-CONTRACT.md)：独立同步测试服务与日常业务服务是不同协议；不能只填18779到旧服务连接页就称同步。完整SQLite Repository/outbox/inbox、配对凭据、原件任务、跨端身份与编辑基线保护、绑定与自动投递仍待接。

产物`outputs/2026-10-18-android-compact-013/`，临时脚本/构建`tmp/android-compact-013/`，私有备份`var/android-backups/`；源码hash/最终APK与安装回执均在release-receipt.json。实时预览工具继续使用本机19384，仅对AVD调试WebView，不连接手机。
