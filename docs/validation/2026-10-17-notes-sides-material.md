# 便签UI7：目录换侧、大图标与壁纸材质

最终运行回读（2026-10-17）：用户打开日常入口后，PID77596从outputs/notes-ui/app运行已安装取色版，原profile恢复1个标签/54字原草稿，正文编辑区与“已保存”均回读正常；4个原生控件和目录换侧入口存在。诊断44px栏、captionBottom=webTop=52、8grip、wallpaper-tint、windowPreferencesError=false。用户此时窗口位置298/256、1353×1170、置顶false，按当前实际配置保留，不回写早期位置/置顶。exe哈希与验收候选一致，runtime-ui7.json已更新runningVerified:true/manualLaunchPending:false；实际只读证据ui7-daily-native-readback.json不含正文。API仍0.9.24，随想此时ui13 ready（其他会话更新，本轮未操作其窗口/文件/维护）。下文“待打开/未安装”均为过程历史。

当前实施已改为稳定的壁纸取色路线，下面Mica/NCCALCSIZE描述保留为失败候选的过程记录。用户截图证实合成修正版仍有蓝色和系统/自绘按钮重叠，因此Mica路径已从当前生产源码移除；不以之前54用例或DWM成功证明它有效。

## 壁纸取色修正版

后续实际验收已通过：用户手动打开取色候选PID79040，真实标题为灰调、单套大按钮，无原先蓝色/透出其他窗口的绘制问题；运行回执frameMaterial=wallpaper-tint。目录实际左右切换，最大化宽窗常驻/还原8grip、角落双向缩放、灰色/取色切换和保存均通过，共8条实际断言，证据ui7-palette-native-interaction.json。最大化刚切换时控制工具曾返回no monitor found，重新绑定后正常回读Maximized及完整画面；未用旧坐标继续操作。临时置顶用于避开其他置顶窗口遮挡，结束恢复false。没有触碰其他会话窗口。

候选正常保存关闭后，核对日常EXE无运行进程，备份原profile与app到var/notes-ui-upgrades/ui7-palette-20261017T123037Z，再次查进程后安装6个文件，SHA-256逐项一致。安装回执ui7-palette-install.json；未覆盖原草稿或把临时候选草稿并入日常库。已请求用户打开日常入口进行原草稿回读，自动启动未改用其他入口绕过此前拒绝。最终状态与哈希见runtime-ui7.json，尚无真实回读前不宣称日常窗口已启动。

恢复UI6已验的CreateParams：移除WS_CAPTION，保留THICKFRAME、SYSMENU、MIN/MAX；删除NCCALCSIZE重写，DWM系统backdrop/alpha均关闭，Extend边距归零。标题栏44DIP/按钮48DIP与实际23×23DIP图形保留，一窗只绘制一套按钮。WebView/保存关闭/8grip协议保持。

新增NotesFramePalette.cs，在Task.Run中用SPI_GETDESKWALLPAPER只读Windows壁纸，64×32下采样并对左右色去饱和/少量混入灰底。整Form/标题/按钮/边角共用同一全局横向渐变；Paint只沿Parent/Left算偏移，不建HWND。壁纸读取失败、无静态壁纸或高对比度回灰；不复制、不记录壁纸路径/像素，不改变Windows设置。主题或系统偏好变更刷新，避免阻塞输入或因失败无限重试。

设置准确命名“壁纸融合（取色）／中性灰”；frameMaterial默认wallpaper，旧mica/缺失字段归一wallpaper。这是不透明颜色过渡，不是系统Mica、实时透视或桌面模糊。依据：[SPI_GETDESKWALLPAPER官方说明](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-systemparametersinfow)。不同显示器独立壁纸/动态壁纸逐帧匹配没有实现。

新证据ui7-palette-*：11组目录/偏好＋59组前端回归通过；54组整窗/5517断言（增加无WS_CAPTION且保留resize/sysmenu/min/max的检查、palette同实例传播），135项取色/极端色对比/嵌套渐变像素接缝，13项标题栏与23×23DIP图形。离屏不建HWND；样例ui7-palette-native-caption-sample.png使用合成颜色，不导出真实壁纸。

已编译outputs/notes-ui/ui7-palette-candidate，快捷方式更新指向独立tmp/notes-ui/ui7-palette-native-state。蓝色合成候选通过Alt+F4正常关闭（进程退出回读确认）；没有强杀、复制/删除草稿或操作其他会话。启动受此前策略拒绝约束，已请求用户手动打开新候选；实际结果和运行切换后补。

取色修正版本轮完整check已重新运行，文件/ESLint通过，但format阶段被并行src/server/domain/revisit/engine/index.mjs告警阻断，未格式化该文件（project-check-ui7-palette.log）。另全库无桌面测试580项：579通过、0失败、1原生思绪测试按SHIYE_TEST_NO_DESKTOP=1跳过；日志project-tests-ui7-palette.log。不能宣称全库完整check通过。当前取色候选尚无实际运行回执，仍待手动重开。

日期：2026-10-17。用户要求目录可在左/右，指出原生图标仍小，并要求继续实现边框与壁纸过渡。仅便签实现；不修改随想ui11或思绪宿主/正式数据。

## 已实现与隔离检查

目录标题右侧新增换侧图标，提示下一位置；outlineSide保存left/right，旧快照默认right。宽窗共背景停靠、窄窗模糊覆盖均按同一偏好定位，分隔线与拖条换到内容侧；拖宽和聚焦分隔条的方向键对应实际边缘方向。未新增全局/组合快捷键。

此前按钮虽扩大，glyph仍约13DIP。本轮以22–24DIP轮廓/1.9DIP线宽绘制，实际关闭图形像素测量23×23DIP；标题栏44DIP、按钮48DIP宽，增强对比，所有尺寸只乘一次DPI。置顶/保存关闭/独立8grip沿用原协议。

外观设置新增“窗口边框”：壁纸色调（Mica）/中性灰，偏好随独立草稿快照保存。前端appearance消息同步dark/material；原生DWM38设置Mica，限定ExtendFrame为标题栏与边缘，黑刷为Form/Panel/Caption/Grip/Button暴露区保留alpha0，文字/图标独立绘制。WebView和正文仍不透明。失败/高对比度回中性灰并清除扩展边距；支持系统主题/合成变化重应用。回执记录set/extend两个结果，不能只根据S_OK宣称视觉成功。

前端专项11组（左右停靠/覆盖/拖宽/窄窗/设置可点/重载/缺字段兼容/材质消息）与原59组回归通过；正文和媒体比较保持。整窗离屏54用例、4869断言，3尺寸×3合成DPI×正常/最大化/还原×Material开/关；另12组控件检查与实际glyph像素测量。离屏无HWND/Show/WebView或私人profile，不验证真实DWM/NCCALCSIZE。

完整check文件/ESLint阶段通过，format阶段因并行修改的8文件告警中止（日志project-check-ui7.log），未批量格式化它们。另跑全库无桌面测试571项：570通过、0失败、1原生思绪测试以SHIYE_TEST_NO_DESKTOP=1跳过（本轮已有单独便签原生验收路径，且不应借此启动被拒候选）。不宣称完整check已通过。项目源码仍0.9.24，不能据API版本判断独立便签修订。

## 实际材质验证过程

工具启动独立ui7-candidate进程被自动审批拒绝，原始理由blocked by policy；没有换工具/包装命令绕过。准备独立临时profile的候选快捷方式供用户手动打开，用户确认后只操作该候选。

第一候选DWM38/Extend都返回0，但实际标题出现明显Windows强调色，未达到壁纸过渡要求。因此没有把它当作视觉验收通过，也没有将它安装到日常便签。候选已正常保存关闭。

修正版保留WS_CAPTION资格、通过WM_NCCALCSIZE把完整窗口设为client，最大化从消息拟定矩形选择WorkingArea；使用message.HWnd避免Handle getter重入。在Win11 26100+尝试DWM39 redirection bitmap premultiplied alpha，旧系统独立失败时仍有灰色回退。主题/材质变化即时写无正文诊断。新候选已编译至ui7-final-candidate；实际视觉和最大化结果后补，离屏通过不等同这些新原生路径已通过。候选启动仍交由用户手动完成。

## 依据与文件

最终状态：用户随后要求“后门调试或命令行”，按明确命令行授权对同一直接Start-Process进行一次重试，仍被blocked by policy拒绝。未通过隐藏接口、其他工具或包装启动规避。新候选未运行，不安装到日常便签；当前仅原UI6进程73596，保留原几何/置顶/profile。构建和只读回执已完成：`runtime-ui7-candidate.json`；编译后的修正版等待用户手动打开同一候选快捷方式后继续真实检查。最后代码审查已将NCCALCSIZE改为message.HWnd及拟定RECT选屏，避免构造Handle getter重入/旧屏选择风险，候选已重新编译；此分支仍未由无HWND离屏测试执行。

[Mica](https://learn.microsoft.com/en-us/windows/apps/design/style/mica)是随壁纸/主题变化的长期窗口材质，不是实时透视背后窗口。[系统backdrop](https://learn.microsoft.com/en-us/windows/win32/api/dwmapi/ne-dwmapi-dwm_systembackdrop_type)及[自绘扩展框架](https://learn.microsoft.com/en-us/windows/win32/dwm/customframe)说明支持条件、alpha0与内容避让；[DWM属性](https://learn.microsoft.com/en-us/windows/win32/api/dwmapi/ne-dwmapi-dwmwindowattribute)说明新redirection alpha及灰边设置。没有使用未公开的SetWindowCompositionAttribute或修改Windows透明/安全设置。

成品/证据：D:\拾页\outputs\notes-ui（ui7-outline-sides.json、ui7-frontend-summary.json、ui7-native-integrated-layout.json、ui7-native-caption-sample.png及ui7-final-candidate）。临时脚本/隔离profile：D:\拾页\tmp\notes-ui。日常便签仍保留原profile；运行安装回执待实际验证后补充。
