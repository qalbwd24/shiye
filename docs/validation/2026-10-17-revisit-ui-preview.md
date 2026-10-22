# 朝花夕拾独立窗口联调

2026-10-17 用户授权打开独立测试窗口，随后明确UI会话负责前端、数据会话负责后端服务与联调。协作入口为[前后端契约](../revisit/FRONTEND-BACKEND-CONTRACT.md)。本轮未升级/重启日常随想，ui20进程16476为开工时快照，不向正式群聊加入样例，不读取私人日记。

## 实际运行

- 测试EXE：D:/拾页/outputs/revisit-ui-preview/candidate/朝花夕拾测试.exe。程序默认强制隔离verify/journal模式，不接管F15、日常托盘或其他窗口。
- 测试后台：tools/revisit-preview-server.mjs，只接受随机端口或20000以上端口；合成库固定tmp/revisit-ui-preview/data，首次生成后不覆盖。运行端口/进程写在outputs/revisit-ui-preview/runtime.json；本轮后台PID3536、端口63957仅快照。
- 测试profile与窗口状态：tmp/revisit-ui-preview/webview、window.json；主窗口运行回执runtime-status.json。测试原生PID78428仅快照，已回读ready及ui20资源标记。
- 当前窗口已选中“朝花夕拾”。测试库3篇合成长文、4个投递、两组回看，含去年/前年文字与一张合成PNG；旧附件使用日记编辑时间，按既有规则拆成独立媒体来源。
- 重开入口：outputs/revisit-ui-preview/打开朝花夕拾测试.ps1。检查独立服务标识/端口，必要时重启同一测试后台；端口被占用即停止，不连接日常服务。现有测试窗口不再重复启动。

这是当前UI源码快照的联调候选，不承诺与冻结安装ui20所有文件逐字一致；不能只凭界面的ui20标记判断全量功能上线。独立宿主仅修改测试端口/profile、标题及自动验收行为，不回写共享原生源码。后续UI优化由UI会话在共享产品组件完成，再重建测试候选，避免两套界面长期分叉。

## 本轮实际确认

使用computer-use技能、sky返回的唯一测试窗口完成操作，未控制日常随想：

1. 从会话列表进入朝花夕拾，实际看到往年文字、图片和北京时间显示。
2. 通过输入框的原生可访问性set_value输入一条合成评论，再点实际发送按钮；群聊显示今天的评论。此步骤不等于中文输入法候选/Enter发送已验收。
3. 等接收端轮询后，读取独立库确认revisit.comments中只有一条active评论，绑定lab-idea所属固定组，entries仍3篇、deliveries仍4条，未反向生成日记。
4. 点击“查看原日记”，实际打开只读弹窗，看到原文、展开整篇按钮、“评论这一条”和刚才今天的评论；随后关闭弹窗，保留群聊供用户体验。

引用/撤回/失败恢复有18条无前端链路证据，本轮没有把它们全部重新按原生界面走一遍。真实IME、系统重启、长时间推送、视频播放、原生独立只读思绪窗仍待验。测试库初始投递是已知过去时段手动生成，不代表后台已常驻运行定时推送器；独立运行器/生命周期仍是第六步。

## UI会话接续事项

不由数据会话改布局，已同步契约：

- 评论目标条目前固定位置，可能覆盖气泡；应接入输入区布局，并保留明确的组/单条提示。
- 会话列表摘要仍能看见Markdown标记，气泡正文已能渲染；摘要应复用统一纯文本预览。
- 独立宿主外框左上角显示“快笺”，与测试窗口标题不一致，应在统一标题组件核对；此源快照不代表正式ui20存在同样问题。
- 相同后台feed轮询时旧正文节点会重新出现，可访问性链接索引会变化；开发模式出现fasterdom的Unexpected mutation日志（hidden/title）。未见Runtime.exceptionThrown，但不能据此称性能/输入焦点已验收完成。
- UIA焦点报告为RootWebArea，未可靠确认真实键盘/IME焦点，本轮采用指定编辑元素set_value；需UI会话继续真实键盘验收。

## 构建与检查

源复制到tmp/revisit-ui-preview/build-root，未在共享vendor运行准备脚本。依赖junction被Windows拒绝为不受信任装入点后，只保留该临时链接并改为物理复制依赖，未修改系统信任配置。首轮Vite在rendering chunks退出-1073740791；限制RAYON_NUM_THREADS=2、关闭压缩及sourcemap后10.23秒完成。该构建设置仅为联调，不当作正式性能构建。原生编译使用绝对路径后成功，错误/重试日志保留。

产物及日志outputs/revisit-ui-preview，源码/依赖/原生输入/profile/合成库在tmp/revisit-ui-preview。最终模块316/根lint/全库格式检查通过；标准npm run check在默认并行测试阶段因多个Node进程OOM失败，原日志project-check.log保留。显式--test-concurrency=2、SHIYE_TEST_NO_DESKTOP=1复跑全库，643项中642通过/1原生跳过/0失败，耗时46.28秒，日志project-tests-bounded.log；不把默认完整check记为通过。启动脚本语法和已运行窗口识别已验证，后台冷重启分支尚未操作。最终final-receipt.json与ui-receipt.json记录身份、EXE/客户端hash及验收边界；日常ui20/PID16476保持。此测试后台按用户试用保留运行，未启用开机启动或改日常生命周期。
