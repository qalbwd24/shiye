# 安卓真机调试入口

2026-10-21 人类明确要求配置scrcpy和WebView调试，以后配合ADB真机测试。已配置完成，操作说明见[真机调试目录](../真机调试/使用说明.md)，工具入口为`tools/android-device-debug.ps1`，配置为同目录`android-device-debug.json`。

## 后续会话工作约定

用户已要求将此流程写入项目文档，并由其他会话主动提醒使用。后续接手安卓UI、键盘、动画或真机交互问题时，优先采用已配置的scrcpy＋ADB＋WebView；在需要真机复测、USB断连、样机升级/重启后提醒一次即可，不在普通问答中重复打断用户。

建议提醒原文：“请用USB连接并解锁手机，打开「拾页 · 样机」。需要电脑观察时运行项目「真机调试」里的「手机投屏.cmd」；我会检查ADB/WebView连接，定位后再给你验收。”

职责与步骤：

1. 用户保持USB连接、解锁并打开样机，告知问题/复现动作；无需先学会DevTools，也不默认要求手动截图或录屏。
2. 会话执行`powershell -NoProfile -ExecutionPolicy Bypass -File tools/android-device-debug.ps1 -Action Status`核对指定手机、样机版本和debug状态。
3. 需要检查网页布局、动画或性能时执行同脚本`-Action WebView`，使用新生成的调试入口；App升级/重启后重新执行，不能复用失效PID或固定旧端口。投屏按需要选「手机投屏」或「只读投屏」。
4. 在该任务已授权范围内，结合ADB、WebView与必要真机复现定位，修改对应准确源码/私有候选，完成必要检查后交用户作最终观感验收。临时DevTools修改要写回源码；用户不必替会话执行整套开发调试。
5. 记录实际设备/样机版本、检查动作和未验项；host、投屏或编译结果分别注明。120Hz问题使用合适的设备帧证据，不以默认60fps投屏冒充通过。

遇到自动审批拦截时如实说明被拒动作和返回原因，不改通道绕过；仅在确需人工操作时请用户完成该一步。既有数据/设备约定与各任务暂停状态保持，不因工具已配置就自动发消息、清库、迁移资料或操作其他App。

## 已完成的配置与验证

- 官方scrcpy5.0.1位于`D:/codex-tools/scrcpy-5.0.1/scrcpy-win64-v5.0.1`，官方Windows下载页给出的ZIP SHA256与下载全文一致。沿用已有`D:/codex-tools/android-sdk/platform-tools/adb.exe`，不改系统PATH、不重启ADB。
- 固定USB手机<测试手机序列号>/PTP-AN00，只将样机`dev.shiye.visualqa`作为WebView调试目标。本轮手机已有code48/0.28.8，本配置未安装或更新App。
- scrcpy实际3秒只读视频连接/解码通过（D3D11VA），未录屏、录音或注入输入，正常结束；不保留后台scrcpy进程。日常入口默认60fps用于观察，不把投屏采样当手机120Hz验收。
- 现有debug代码已经调用`setWebContentsDebuggingEnabled`，无需改产品源或为调试再构包。用户手动打开样机后，实际WebView浏览器Chrome155/协议1.3、一个page目标、只读Runtime.evaluate页面ready/视口元数据通过；未读日记、消息正文、截图或数据库。
- `WebView调试.cmd`按当前样机PID创建loopback动态转发，生成本地inspect入口并链接官方DevTools前端，不显示目标日记/会话标题；App重启后重新运行即可。Chrome/Edge inspect也可使用命令打印的127.0.0.1端口。
- `关闭WebView连接.cmd`只删除带自身owner记录且serial/local/remote仍准确匹配的映射。已实际验证关闭/重连；他方emulator-5554/60542映射保留。最后保留本项目的WebView映射供用户打开调试页，端口以`outputs/android-device-debug-session/connection.json`为准。

本轮ADB正常启动样机的命令被自动审批拒绝（仅返回“被策略阻止”，未执行）；未换通道重试，用户手动打开后完成调试连接。后续由具体真机测试请求确定操作，配置本身不自动点击/输入/清库/迁移资料，不碰QQ、日常包或其他设备/服务。当前PC/data产品工作不因这项配置恢复。

配置回执：[receipt.json](../outputs/2026-10-21-android-device-debug-setup/receipt.json)。临时CSS预览不等于源码保存；正式调整须回对应准确候选并构包，保留各会话源/包身份与已约定的数据边界。

官方依据：[scrcpy Windows安装](https://github.com/Genymobile/scrcpy/blob/master/doc/windows.md)、[WebView远程调试](https://developer.chrome.com/docs/devtools/remote-debugging/webviews)。
