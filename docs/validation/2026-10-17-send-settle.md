# 发送停稳与输入来源过渡：候选验收

## 最终交付（覆盖下方早期记录）

2026-10-17 U55/ui22已自动备份、标准升级并启动（2026-10-18T00:04:48.998Z核验，聊天PID37820/托盘25832仅快照；API0.9.24与package一致且未重启）。修复600ms收缩锁迟到8px上弹及快速连发确认换ID重排；平滑消息从输入文字区域出发，保留即时默认和原平滑选项。按最新精简策略，最终包原生只验单发来源、平滑/即时多行三连发3核心场景，32断言/12实绘图，确认后晚窗位移均0；7排序与25维护定向通过，未重复649全套。12218安装SHA一致，日记SHA及108%/868×1649/2屏档案保持。备份2026-10-18T00-03-41-418Z-a19c821c；产物outputs/2026-10-17-send-settle、临时tmp/send-settle。共享源码全库697项696过/1项revisit-client关联失败已单独复现，本包不含该共享client/后端；不宣称全库通过。物理120FPS、长期CPU/内存仍未结案。

原生最终采用3个核心场景：03报告独立完成且画面无遮挡的smooth-manual64，及04报告smooth/instant自动多行三连发。32断言、12实绘PNG；连续场景固定最后实际DOM Enter+350ms开始判断，录到+2000ms，3条消息晚窗YRange均0，最后保存确认仍在观察窗内。输入至首次采样可见约33–45ms（含测试开销，不等于精确屏幕呈现延迟）。起点动画实际可见，clip已清除，输入区回空，测试窗口/profile进程及自有18767后台正常关闭无残留。

证据：`native/origin-focused-native-aggregate.json`绑定最终manifest和每个原始报告SHA；03整份失败不复用，只复用已完成单发。初次未选房、第二次侧栏遮挡和第三次旧计时误判均保留失败记录，不记为完整套件通过。

交付证据：`delivery-manifest-ui22.json`明确当前包32原生核心、浏览器当前包证据、7排序与25维护检查；仅按相同EXE/DLL/独立HTML/JS复用10项独立图片窗口旧证据。`upgrade.json`、`final-status.json`、`installed-verification.json`、`data-state-before-upgrade.json`与`data-state-after-upgrade.json`记录实际备份/安装/启动、12218文件SHA及数据偏好保持。维护doctor/可读状态和失败阶段已通过此次真实标准升级使用，用户无需手动运行脚本。

仍未验证：物理120FPS、长期内存/常驻CPU；已有调度守卫console日志不能以runtimeErrors空数组宣称全部console清洁。共享全库revisit-client失败不作为本次候选已通过。

当前包浏览器结果见[浏览器验收](2026-10-17-send-settle-browser.md)；今后执行[按影响范围验证](../TESTING-POLICY.md)。

下方是本轮早期阶段记录，构建与运行状态以上方及最终升级回执为准。

## 状态

2026-10-17最终回读仍为ui21/API0.9.24、聊天PID39944（仅快照）。ui22源码已冻结，但Vite构建启动被自动审批`blocked by policy`拒绝，未绕过。完整候选、最终包浏览器、原生与实际120Hz验收尚未完成，未部署。正式数据/profile未操作。

## 已完成

- ui21平滑满屏64px输入框：约156ms停稳后，约630ms突然上移8px。原始轨迹位于`outputs/2026-10-17-send-settle/smooth-min-496-dpr175`。600ms上游收缩锁释放后padding80→88，与持续贴底观察共同触发位移。
- 单一留白CSS隔离A/B消除迟到8px；即时自动多行无退步。最终helper统一预测/清理旧锁，12项隔离几何与状态边界检查通过。
- 新smooth首版约190ms输入来源过渡，中途61.8ms仅替换content时，动画时钟24.98→32.2ms接续；最终transform/动画/clip清理。稀疏用例根位置与scrollTop稳定，实际filmstrip已审阅。
- filmstrip发现空会话首条存在上游整列表额外淡入，已补MessageList精确源码修复；**这项最终补丁尚未重构建验证**。
- 保留即时／输入框来源／原平滑三个选项。既有即时偏好不变。
- source-scope核对ui21冻结源码84项，记录9个明确覆盖位置，不混入并行源码。旧EXE固定保留原SHA8c205839…。

## 源码检查

最终`npm test`681项通过、0失败，见`project-tests-final.log`与`project-tests-final-exit.json`。325模块结构检查及根ESLint通过，本轮文档格式检查通过。

完整`npm run check`尚非全绿：第一次测试阶段679通过/1失败，为并行shiye-journal源/镜像短时不一致；随后只读比对已相同，未代改。再次check在并行`tests/revisit-daily-random.test.mjs`格式检查停止；未代格式化该文件。单独全库测试最后681通过。各次日志保留，不将重跑成功覆盖历史失败。

## 待继续

用户正常执行`D:\拾页\tmp\send-settle\run-build-ui22.ps1`后，先核构建和candidate-proof，再做最终包中间绘制帧、满屏/稀疏、高手调/自动/64px、长文/连发/媒体/引用/朝花夕拾、换节点/切房/取消/减少动画等验收。7份标准原生脚本和12项依赖已准备，原649＋10断言不变；本轮尚未启动原生测试。

旧满屏轨迹中额外942px与视口等高，上游force-messages-scroll的100vh margin是合理解释，但旧轨迹未记录类名与margin，不能称已直接证明。需在最终包补直接对照。

验收通过后才标准保存、备份、upgrade、ready与全文件SHA回读。物理120Hz、长期CPU/内存仍不因此结案。

产物：`D:\拾页\outputs\2026-10-17-send-settle`。临时脚本、隔离库和冻结构建源：`D:\拾页\tmp\send-settle`。构建说明与拒绝原文分别见产物目录`manual-build.md`、`approval-rejection.md`。
