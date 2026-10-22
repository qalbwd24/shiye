# 随想 U52/ui19：切房、输入稳定性与设置验收

## stage-v4 阅读恢复复验（部署前）

原失败相同序列无插桩通过：reading-stage4-original-01/report.json，前三次锚点误差0，字号/窄窗后误差-0.46875px（stage-v3约-1336.47px）。真实设置扩展reading-stage4-persistent-gap-rapid-03/report.json通过10项：产品表单保存A/B间距18/8、消息字号滑条持久保存24px，缩窗返回及40ms快速反向后均约-0.28125px。原3px位置误差阈值未改；两个前置中断/隐藏gear夹具记录保留，不当作阅读恢复结果。本段仅说明已完成的复验，完整最终浏览器、原生、项目检查和安装仍以最终回执为准。

2026-10-17。ui19已正式启用；103项最终浏览器、649＋10原生、643项完整项目检查和12216安装文件SHA-256通过，数据/窗口档案保持。需求见[U52](../CHAT-ROOM-SWITCH-2026-10-17.md)。以下子组与stage-v1是验收过程记录，最终状态以文末“最终验收与运行切换”为准；不复制用户录屏正文。

## 用户确认的范围

- 保留 ui18 消息显示方案，修复侧栏切房空白、快速反向与阅读位置恢复；侧栏展开/折叠增加可退回立即方式的平滑过渡。
- 修复输入框在软折临界区静置仍反复抖动，保留用户手动高度及现有恢复自动高度操作。
- 消息字号与输入字号独立；Ctrl 缩放只调整消息。主输入、placeholder 与图片说明使用相同输入字号、字体和行高。气泡均匀留白保持独立 CSS px，不能随文字同比增长。
- 设置参数可滚动，保存/关闭操作区固定；返回只回真实父页并保留父页位置与焦点。未提交表单返回保留编辑，全局关闭明确保存、放弃或继续；失败不离开、不丢编辑。

## 原失败与因果边界

窄窗合成基线为 496×942 CSS、DPR1.75、108% 等效字号、A600/B8/C单条35行和不同壁纸/草稿。冷 B 首次 DOM 可见约1145ms；原字节绘制采样出现先空白、后背景、再消息。宽窗177–212ms的结果不能代替窄窗。用户视频30fps及采样间隙不能证明物理120Hz或精确首像素时间。

实际快速 A→B→A 中，A旧节点复用而未重新 attach，restoring 已清，complete 和 fallback 守卫都拒绝，仅2500ms安全兜底解除 pending。受控旧版显式 attach 的 ABA 负结果仍保留：已有 revision 能正确拒绝过期 measure/mutate，并非所有失效保护都坏了。

内容已就绪的独立 coordinator 实验显示16/40ms连续 complete 会反复推迟65ms计时，约992/976ms才显现；这证明可推迟，不能单独解释用户录屏。实际冷切换还有 Composer 按钮 slideFadeAndroid 重动画暂停全局更新，以及桌面仍等待已不存在的中栏 transform 约550ms，候选仅调整本地桌面路径，不改其他客户端全局更新策略。详见需求文档和 user-purevalue-a600-b8-c1、user-heavy-value-a600-b8-c1 报告。

原字节481×899、17.28px输入下，70/80位软折文本在紧凑窄区和高区宽布局间反馈，高度97.5/69px、reserve175/156px交替，静置约0.45秒54–55次切换；独立绘制112帧证实真实抖动。候选采用同房同编辑器的自动高区退出滞回，手动高度不被覆盖。

## 隔离子组历史记录

| 子组                            | 实际结果                                   | 证据与边界                                                                                                                           |
| ------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| 字号、设置层级与固定操作区      | 29项通过，errors为空                       | outputs/2026-10-17-room-switch-fix/settings-font-final/report.json；真实滑条操作与重载，包含6个设置页                                |
| 迁移、dirty表单、失败与说明输入 | 24项通过，errors为空                       | settings-edges-final/report.json；真实IDB保存与故障注入、实际附件说明DOM；native window-state为mock-host事件，非物理原生             |
| 输入框稳定性                    | 23场景settled持续切换均0；独立42帧绘制稳定 | composer/summary.md、candidate-diagnostic/report.json、candidate-paint/report.json；该字体矩阵是隔离样式夹具，新设置UI由上述53项另验 |
| coordinator v2                  | 7个受控场景通过，errors为空                | controlled-coordinator-v2/report.json；实际模块、最小调度依赖stub，覆盖重复complete、过期任务与已挂载目标复用，不等价真实切房全链    |
| 侧栏反向与立即/减少动态效果     | 右侧栏v2报告passed且errors为空             | sidebar-reversal-right-v2/report.json；最终集成与原生侧栏实际点击仍待验                                                              |

53项设置测试绑定 settings-candidate/settings-final-proof-v2.json，SHA-256 为0191c1773e62d97928ca91f3128861acb86593f2c685e29a4fd1e57f237f31a9。该四文件为分别从冻结 ui18 局部补丁生成的设置覆盖层，未复制共享 preview 的其他并行功能；尚未包含最终 core/composer/sidebar 集成，不能称最终 ui19 全套已过。旧中间 proof 保留，不作为最终集成验收。

## 设置兼容与回收

旧输入字号只在首次有效 window-state 按旧消息基准字号×旧文字缩放迁移，例如16×1.08=17.28；已有合法独立输入值优先，非法值重新迁移，此后消息缩放不再改输入。无宿主浏览器按基准字号迁移。均匀留白固定CSS px，系统DPI的物理放大属于正常行为，不承诺跨DPI物理像素相等。

返回缓存只保留当前设置会话的未提交页面DOM，最终关闭回收；保存或放弃会话参数后移除该页，避免下一会话重用旧目标。会话表单绑定打开时ID，异步期间当前房间变化不改写其他会话。自动保存导航页重新进入会同步持久偏好；显式提交页不重初始化草稿。桌面参数等待真实保存结果，失败保留编辑。

主源局部 node --check、ESLint 与定向格式检查已做；全库检查、最终字体原生断言、真实重开、正式安装哈希、保存快照与部署状态仍待最终回执。不保证物理120FPS、长期内存或常驻CPU已解决。

产物在 outputs/2026-10-17-room-switch-fix；测试脚本和中间文件在 tmp/room-switch-fix。正式库与现有窗口未由本设置子任务操作。

## 首轮 stage-v1 本体浏览器记录

最终程序12216文件，stage-proof-ui19.json SHA-256 为403cd0c1234681dbc08c7c057d04ddc872c5e374ea3c553fdb5e91e231006018。全部响应直接读取该candidate，未用route替换旧wrapper或注入产品代码；设置53项、composer33项显式检查通过，侧栏窄/宽2场景含双向快速反转、立即方式与减少动态效果通过，所有记录的加载哈希匹配。有效总回执为 outputs/2026-10-17-room-switch-fix/integrated-browser-final-receipt.json（SHA c187369d692fdd0f19e013431f104405c176851b582fb131d3ba94577e0e21fb）。

composer额外15场景通过真实输入字号设置控件及产品input处理器选择12/17.28/24，覆盖481/360宽、临界70/80软折、真实侧栏切房再返回、拖高后发送/切房/reload的实际高度和存储保持、Home恢复与删除/清空。未覆写CSS字体变量。首次integrated-v1的composer在跨房点击超时：夹具只调用worker造房，漏了产品表单提交后的UI刷新，因此新房不在侧栏；原失败回执保留。修改为实际新建按钮/表单并核对createdId和currentId，独立integrated-v2-composer完整重跑通过，未改产品或削弱断言。前三组有效结果原样复用。

浏览器已正常关闭，时段交原生正式suite。verification/下已归档执行脚本与哈希，独立于程序文件清单。本段不代表原生字体迁移、物理120Hz、安装升级或正式启用通过。

## 最终验收与运行切换

2026-10-17 U52/ui19已正常保存、备份、标准升级并启用（2026-10-17T20:53:30.746Z核验；PID19068仅快照，API0.9.24与package一致）。修复输入框软折临界区紧凑/展开反复反馈造成的抖动，手动高度继续保留；修复快速切回复用节点卡住和旧动画等待造成的切房空白。侧栏新增可反向接续的短过渡，可选立即，并修复展开时键盘焦点恢复顺序。消息/输入字号独立，placeholder及图片说明跟随输入字号，气泡留白固定CSS px；设置参数滚动与保存/关闭分开，返回真实父页，保留未提交编辑。103项最终浏览器、649＋10原生、643项完整项目检查和12216安装文件SHA-256通过；升级准备期间旧版保存一篇日记，之后SHA稳定；108%字号/868×1649/2屏档案保持。备份2026-10-17T20-51-43-770Z-34861e6a。只在冻结ui18上补本轮UI，保留并行数据/朝花夕拾/便签/Android/边框源码而未混入安装。物理120FPS、长期内存和常驻CPU仍未结案。

最终安装来源为stage-v5/stage-proof-ui19.json，总清单delivery-manifest-ui19.json；浏览器integrated-browser-v4-receipt.json，原生native-final-05.json，完整项目project-check-final-02-receipt.json与project-check-final-02.log，运行installed-verification-ui19.json、status-after-upgrade.json及data-state-before/after-upgrade.json。最终103项浏览器含字号/设置/输入和侧栏焦点回归，侧栏2组、输入15场景；候选实际加载资源哈希核对通过。

原生native-final-01在270项后失败：旧测试按Esc回到设置父页后未退出，却点击被模态遮住的聊天区；修复五处父页退出和侧栏完成等待，保留原断言。stage-v2全部12216程序字节与stage-v1相同。native-final-02在600项后发现真实回归：workspace先处理changed并focus，motion后清除inert，导致Esc侧栏展开仍无法聚焦；已改为before-change展开时先恢复交互，收起仍先回焦再禁用。stage-v3只变更侧栏模块、对应index缓存标识及UPSTREAM来源；stage-v3浏览器通过后，原生第三轮继续发现下述阅读回归。前三次失败回执、截图、正常关闭和生成物归档证据保留，不用后续通过覆盖。

修复过程stage-v1/v3切房同夹具冷B就绪1075.4→88.9ms、快速返回A由未就绪变为123.6ms，均为单次诊断样本；独立绘制98.5ms末条可读、298.4ms全部8条清楚。它们不能互换为平均耗时、完全刷新89ms或物理120FPS。输入框原静置0.45秒54–55次布局切换已在临界字体/宽度、发送/切房/重开场景消除，手动高度保持；真实用户的长期操作仍需继续观察。

完整vendor TypeScript检查仍有既有并行shiyeLocal/shiyeProgram的14条错误，未代改；本轮四个vendor修改文件定向ESLint通过，完整项目check通过不代表独立vendor全量类型检查通过。本轮未重新优化宿主窗口动效，继续沿用ui18已安装的柔和/原曲线；不把本轮切房及侧栏验收当作窗口物理120Hz重新验收。

原生native-final-03在643项后发现离开期间字号/窄窗改变时阅读锚点偏移。独立原字节浏览器复现约-1336px，ui18同夹具约-0.47px通过；样式trace证实按24px恢复后、ready约9ms再改17.28px，之后没有scrollTop覆写。最终stage-v4先在受revision/key/node守卫的mutation应用匹配目标房间外观，再measure恢复位置、mutation显示；新增阶段不使用固定等待。阅读位置原误差<3px及稳定性断言保持，重新做真实字号/每房间距、快速反向与最终浏览器/原生全套。最终额外16项阅读检查、7类实际切房通过：原序列字号/窄窗后约-0.47px，真实设置字号/间距及快速反向约-0.28px；实际点击最终切房冷A/B/C就绪163.5/272.1/289.2ms，快速返回最后点击后272.5ms，含侧栏操作，不与此前89ms诊断条件混用。证据reading-stage4-*及最终browser receipt focusedReports。

原生native-final-04在182项处因字号检查误选纯表情100.8px失败；验证器改为本轮独立纯文本、同room/listKey/已确认messageId/唯一合成标记/solid bubble，整条排除表情、媒体、引用和代码，并比较同一ID。原字号增大、输入提示独立和留白固定断言不变；stage-v5只有验证附件变化，全部12216程序字节与stage-v4一致。失败回执及verify-ui-native-05.diff保留。最终原生通过结果见上列native回执。

总清单是升级前冻结记录，其deployed:false不代表当前运行仍是旧版；正式启用以installed-verification-ui19.json和标准升级成功回执为准。

项目检查首轮止于本轮两份文档的格式告警，未进入测试；仅格式化CHAT-PERFORMANCE-HANDOFF.md和UI-PREFERENCES.md后完整重跑通过。失败日志project-check-final.log/receipt保留，有效结果为project-check-final-02.log和project-check-final-02-receipt.json。

标准升级首次dry-run在寻找候选父目录的交付清单时停止，未写安装目录；按既有CLI要求补放同哈希清单及chat/image平面计数后dry-run-02通过。原清单delivery-manifest-ui19-pre-cli-schema.json保留，程序资产完全未改，最终清单为cf3a444bf785ee0b38b62669b9226cf02611850694c645a289d8c9f794307c73。

数据边界：升级前20:51:33Z记录的diary SHA与结束时不同，首次严格哈希检查因此停止。只读元数据确认一篇日记在20:51:51.938Z更新，文件20:51:52.057Z写入，均早于维护prepared20:52:13.887Z及新进程20:53:01Z，属于旧运行版仍在运行时的保存；20:54:25Z和20:55:16Z的保存后SHA相同。保留这次保存，不回滚、不直接改正式diary。未留存前次正文副本，因此不声称旧快照与保存后逐字段一致；已验证的是保存时序、之后文件稳定及窗口/显示屏配置保持。证据save-metadata-investigation.json及data-state-after-upgrade.json只含哈希/数量/时间和散列ID，不复制正文。
