# Android 0.7 思绪编辑与空白保存验收

2026-10-17。本轮产物`outputs/2026-10-17-android-diary-editor-07/`，临时`tmp/android-diary-editor-07/`。按手机0.6截图及后续图标/空白日记/格式一致性反馈实施；只更新主AVD，手机继续用户测试0.6，未读取/编辑手机新日记或覆盖安装。

## 版本与运行

`dev.shiye.app`，0.7.0-editor/code9，APK `Shiye-Android-0.7.0-a416b295.apk`，91,456,311字节，SHA-256 `a416b295fabfa0f3d453e6e08e9c8a9afcbc857243d2bcbeae6613a453a0282f`。Gradle成功；install -r返回Success、包版本回读一致。此前工具启动被审批拒绝，用户手动打开新版本后核查，未绕过拒绝。安装前取得原AVD聊天flush ACK、保存`var/android-backups/2026-10-18T03-30-51-581Z-avd-before-070/app-private.tar`；不清库/导入手机，不重复全库审计。已确认APK内editor三资产/helper与当前源一致、桌面图标PNG字节一致；来源hash见release-receipt/icon-provenance。

## 已做

顶部紧凑直接标题、正文placeholder、分类标签单一入口；去常驻冗余提示，失败/保存中仍反馈；44px三图标时间戳/真实缩进/图片栏。字号8–40、字重400–700、普通段距缺省0且行高独立，旧明确参数保留。思绪主题浅/深、膜无/浅/深分开，取消恢复，旧opacity0.65保留，新选图缺省1；原图需100%＋无膜，无模糊时无额外overscan。

软键盘helper复用共享命令及映射选区；cancelable调用原Enter路径，noncancelable仅精确匹配该次普通分段后补真实全角缩进，IME/无关事务/选择变化不猜改，单次undo/redo已验。组词中点击明确提示，不静默吞掉动作。手机真实输入法候选行为仍待用户体验。

新建仅meta临时草稿，分类/标签/空白不形成正式篇；有内容后同ID落正式日记。已有篇清空拒绝覆盖，返回可继续或明确放弃本次修改，原已保存内容/版本保留。旧createEntry仅seed兼容，不是新UI入口；没有schema/旧库迁移。Desktop主图标public/icons/shiye-512.png直接复用，adaptive icon与roundIcon已装入APK，未重新绘制。

## 实际验证

| 范围              | 证据                                          | 本轮结论                                                                                                                                                            |
| ----------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web外壳/排版      | 初版24项＋接线等15项＋空篇返回2组，分阶段累计 | 已查看浅深/遮罩/8px窄屏/40px、旧偏好、工具布局、媒体身份与时间、保存取消；旧路径证据按未改路径复用，未冒称最后整套重跑                                              |
| Android输入helper | tests/android-editor-input.test.mjs，13项     | 真共享adapter+JSDOM，软分段、精准非取消补缩进、IME/语义节点守护、选区、hardware去重、单次undo/redo、空篇无focus及标题焦点动作通过                                   |
| 内容与存储        | empty目录21组双端判定、24项JVM SQLite事务     | 当前可表达标题/richdoc与电脑实际hasQuickContent相同；生产LocalStore实际dispatch/事务、同ID提升/重开/冲突/媒体保护通过，独立attachments与最终跨端统一不在此证据范围  |
| 真AVD编辑/草稿    | avd-editor-verification.json，15项            | 初始14篇；未改/空白＋分类两次关闭仍14；仅有意义样例变15。同ID提升、无需先点正文的时间戳、实际Enter缩进、44px/3按钮、重开同ID、清空保护确认及原标题/body精确保持通过 |
| 真AVD主题         | avd-appearance-verification.json              | 原生保存dark/none、重建WebView保持、改light即时预览/取消回dark、正文一致，系统栏浅色图标在深底可见                                                                  |
| 真软件键盘        | avd-toolbar-ime-physical.png                  | 物理ADB触点使mIsInputViewShown=true，CSS viewport815→520，toolbar高44/bottom520，恰好在输入法上方。临时AVD硬件键盘显示设置已还原0；未改手机设置                     |

初次CDP触点虽mInputShown=true，但输入法实际视图未显示，截图不作为键盘证据；实际物理触点后重测并替换回执指标。主题检查初次误读page.dataset.theme，实际属性在documentElement，修正验证脚本后通过，未为断言改产品。头部/输入所有截图均为合成内容。

已查看安装包实绘`avd-writing-light.png`、`avd-writing-dark.png`、`avd-reading-light.png`、`avd-reading-dark.png`、`avd-empty-protection.png`和真实键盘图。没有运行无关全库检查/数据hash矩阵，未重新宣称聊天文件/GIF/归档等未改路径全验。物理120Hz、长期负载、真机中文IME/杀进程恢复、完整跨端格式与云同步未完成。

## 交接与下一步

需求入口[0.7需求](../ANDROID-DIARY-07-REQUIREMENTS.md)；UI/输入/草稿各专属文档保留分阶段证据。**共用编辑核和时间戳不等于长文切分、写入格式、存储适配已全统一**，后续[统一接入顺序](../ANDROID-DATA-UNIFICATION-PLAN.md)在迁移前先用副本和同样本往返证明。正式电脑运行程序与手机0.6数据保持；0.7手机推送待用户选择时机。
