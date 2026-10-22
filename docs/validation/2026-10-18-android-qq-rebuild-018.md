# Android018独立聊天重构验收

2026-10-18，当前为候选校验中，**尚未部署手机或主AVD正常包**。正常使用版仍016/code18。本文件随真实回执更新，不能把下面分阶段通过当作最终包全部已通过。

## 核心改变与验证范围

用户要求从头重构聊天本体，摆脱Telegram UI影响。新view在独立同源无脚本shell iframe/shadow内，输入/手势不进入父框架，布局和媒体/表情面板不读取旧Message DOM。原数据owner只通过legacy-source接口接读写与真实worker ACK，未新建第二个消息writer。默认白色，淡蓝可选；本人蓝气泡白字，逐条时间隐藏，原时间数据保留；字号/留白/宽度/透明度/间距/Enter选项继续兼容。

构建固定016 APK的11749原资源和014原生（016原生未改）；仅聊天适配、独立模块及三个原生配色/图库接缝改变，**不混入017后端候选或迁移存储**。017接口/Repository另有完整独立证据，首次完整导入映射见[清单](../ANDROID-FIRST-IMPORT-018-MAP.md)，真实全量导入尚未执行。

## 已发现并处理的真实失败

1. 首次安装的legacy worker把默认seed只留内存，`flush`不会凭空建library；最早source将成功读取但缺key当损坏，导致首发被拒。现仅从未见过有效库且成功读取缺key时允许前置seed ID基线；发送后仍等待真实库/原件/worker回执，读取异常和已有库消失不吞成空库。
2. 实际Android切房草稿/引用检查失败，冷启还发现文字退回旧编辑器快照。独立输入不能继续保留隐藏TL composer的自动草稿writer：确定性门控冻结`useDraft`统一保存函数及两处已排队保存回调。页面生命周期flag在独立renderer安装后保持，即使退出会话/销毁view也不交回旧snapshot；新source的真实saveDraft/clearDraft动作不受影响。并增加持久草稿缓存优先、ready及晚到投影恢复，避免UI异步加载空值覆盖用户输入。
3. 模拟器ADB曾无响应，随后Windows报1455提交内存不足。只重启自有AVD、不wipe，停止本工作区Gradle daemon，改临时2GiB内存/关闭Vulkan参数；屏幕1264×2800/632dpi不变。软件renderer试验曾增加内存压力，最终恢复auto GPU。该环境过程不作为App120FPS或长期稳定性证明。

## 分阶段证据

- `outputs/2026-10-18-android-qq-018/source/`：source隔离mock，最新草稿/历史分页覆盖至少20场景；这些不是实际worker设备证据。
- `renderer/`：实际Chromium独立frame的布局/键盘隔离、输入法事件、手势/锚点/引用/分页等直接验证，按receipt源码hash复用，source为替身。
- `panels/`：原20项面板浏览器路径及单张导入命名7项增量；真实共享元数据表单、资产store/发送源替身，未冒充实际手机原件闭环。
- `android-matrix.json`：最早实际Android已通过首发、持久草稿、键盘隔离/中文组合输入、防重复发送、点击无动作/纵滑/横滑/引用持久等，切房断言失败；等待最终修复包重验后记录最终结果。

最终仍须以实际Android候选检查：冷启与切房/后台不反写、图片GIF/文件原件与命名、原生图库、键盘几何、设置返回及安装字节；通过前不覆盖手机。未测手机OEM输入法、长期后台、物理120FPS、真实大库全量导入/云同步。

产物 `outputs/2026-10-18-android-qq-018/`；临时工程/合成夹具/编译 `tmp/android-qq-018/`；手机安装前备份继续 `var/android-backups/`。

## 后续真实检查与校准

早期23项Android矩阵已完成最终source修复后的实际worker检查，包含图片/GIF/文本附件原件字节保持、真实触摸/中文组合、引用/撤回/切房与表情直接发送。后续视觉/交互改动按路径复用source证据，不将其记录为最终视觉包全套重跑。

新增 `android-incremental.json` 九项实际Android隔离QA通过：主动污染隐藏旧编辑器后新草稿不反写、force-stop/冷启恢复换行空格和引用、三次多行UI发送及350–1750ms气泡无回弹、真实WebM原件worker ACK/逐字节回读、视频查看不自动播放、键盘/输入几何、原生图库进入与取消保留草稿。图库是同Activity的原生Dialog，早期用Activity类名检测失败；实绘确认已打开后改为检查自有QA原生无障碍布局，未改产品去迎合该断言。AVD硬键盘下软键盘显示选项由0设为1，便于后续手测；不改手机设置。

`ux/receipt.json` 为16项Chromium实际DOM轨迹/几何验证：QQ色调、黑图标、慢ACK阅读不拉底、previousLocalId复用原节点、多行三连发停稳与临界软折9组高度。source是替身，不能替代Android存储。`panels/browser-report.json` 已按导入后真实元数据弹窗流程调整测试后20项全通过，旧失败为测试未关闭新增命名表单；快速开关与销毁URL清理有覆盖。`panels/import-naming/browser-report.json`七项通过，保存名称/备注保留原件ID/未知字段/排序关联。原55项renderer在改动后重新通过；最终视觉CSS仍须按最终hash复查。

真实冷启测试只操作 `dev.shiye.qqrebuildqa` 合成资料，不操作正常包/真机的正文。候选输出包含实际WebView与AVD实绘图。手机目前不在ADB设备列表，未执行本轮真机覆盖安装。

## 当前候选与最新内容/设置实测

用户再次明确“复刻窗口前端，内容仍可输入输出Markdown富文本”。已增加 `android/qq-chat/content.js`，直接打包桌面 `public/editor/markdown-renderer.js`、`rich-document-renderer.js`、安全阅读投影与依赖；旧entity格式化函数按桌面源码精确抽取，不改桌面IIFE或重写近似算法。11个实际源码及抽取函数hash保存在 `content/stage-manifest.json`，同版本输入编译与最终APK资产分别记hash。Python stage文本写出有LF→CRLF归一，最早Android hash测试误比编译前hash失败，已改为比最终stageHash；不是实际模块缺失或源码不一致。

- `content/browser/receipt.json`：32项实际桌面renderer/合成源检查，包含Markdown输入原样提交、原源码不被显示覆盖、legacy entity、richdoc fixture/未知结构保护、HTML安全、表格代码窄屏和A/B/A阅读位置。
- `content/android-receipt.json`：6项实际Android，本机UI提交Markdown＋真实worker ACK，加粗/斜体/引用、列表/代码缩进/表格、无横向溢出、实际加载模块hash、richdoc结构不变。只读富文档样本不代表生产Repository读写已接入。
- `android-settings.json`：6项实际Android，会话设置→显示子页，真实触摸竖滑不误调字号，可选蓝实时进入独立frame，未保存返回明确继续/放弃，放弃恢复白色及父页，再返回原会话。
- Astra审美两CSS及富文本局部样式已合并；其 `aesthetics` 为合成CSS验证，设备证据仍以根回读为准。正文没有被换成只读纯字串，长文Tiptap入口未被QQ输入框替代。

正常候选 `Shiye-Android-0.18.0-03a63c09.apk`，SHA-256 `03a63c091248712508251599c918961305179084e24fae8b227b38471e717930`。QA/正常包所有assets及DEX逐字节一致，11746个非改动基线assets保持；实际QA版本0.18/code20。未清空/导入正常手机或主AVD资料，最近ADB仅模拟器、手机未连接，故未执行手机覆盖安装。

017产品Repository/schema4/transport候选仍独立，018保持旧本地owner的过渡保存；生产消息/长文权威切换、产品body内媒体resolver、种子文件入口、全量导入/持续同步、朝花完整绑定与评论UI未交付。richdoc未知节点明确保留且不降级回存。未运行全项目npm check；本轮按TESTING-POLICY执行受影响前端/实际Android检查，不将017全库格式阻断写成018通过。手机OEM输入法、物理120FPS与长期后台未测。
