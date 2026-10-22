# 随想 U53：输入栏与末条消息间距

2026-10-17，ui20已正式启用。需求见[U53](../CHAT-COMPOSER-SPACING-2026-10-17.md)。以下基线/候选段是验证过程，当前状态以最终验收回执为准。

## 原字节基线与决定

合成独立浏览器、496/360 CSS宽、DPR1.75、输入17.28px。自动空输入editor/scroller为40.5px，正文行高28.5px、上下padding6px，本身没有不均匀空白；manual64时scroller64但内部正文仍40.5，placeholder上6/下29.5px。用户手调高度不应被重置，故只让紧凑低输入的内容和提示共用居中布局，高手调继续顶部起笔。

消息底部JS三处都额外加28px，footer顶部14px，形成末气泡到输入区约56.3–56.8px空白。候选三处统一按footer实际高度预留，顶部减至4px，Composer底外边距8→4px；输入scroller到viewport底12→8px，即整体向下4px。紧凑manual64的placeholder上下约17.734/17.766px，auto仍6/6且不增加高度；末气泡到输入区约26.23–26.80px。

曾试图再从CSS减去上游8px间隔，随即核到MessageList对max(bottomReserve,footerReserve)有相同几何预测；CSS单改会令reserveDelta不一致。因此撤回该方案，保留原max和上游8px，不为缩短几像素引入滚动偏移。中间候选仅是诊断证据，不是最终程序。

## 实现边界

- 仅修改shiye-chat-ui.js三处footer预留和shiye-preview.css间距/紧凑内容对齐，源码与public镜像同步。冻结preview只更新ui20修订号；index哈希查询与UPSTREAM来源另记。
- 紧凑对齐限定普通主输入、非rich-expanded/非with-embedded；safe center与自然内容高度保持多行溢出从顶部可读，不改变手调数值或ui19软折滞回。
- 保留笑脸按钮；现有`/表情`和`/表情包`复用同一面板，无新增默认快捷键。
- 自动/手调、空/单行/软折/多行、高低字号、发送/重开/切房、引用与命令需要本体回归；浏览器结果不替代原生验证或安装回读。

产物：`outputs/2026-10-17-composer-spacing`；临时脚本和合成库：`tmp/composer-spacing`。正式日记仅在升级时只读核验，私有升级前副本若生成仅留`tmp/composer-spacing/private`，不用于测试或交付。

## 最终验收与运行切换

2026-10-17 U53/ui20已标准保存、备份、升级启用（2026-10-17T21:27:43.657Z核验；PID16476仅快照，API0.9.24与package一致）。输入栏下移4CSS px，64px紧凑手调的文字/placeholder上下居中；末气泡至输入区约56→26CSS px，自动高度、高手调和引用保留各自布局。保留笑脸，已有/表情、/表情包可用。645＋10原生、643项目检查、172项浏览器及12216安装哈希通过；108%/868×1649/2屏档案保持。冻结ui19仅补五条UI路径，未混入并行功能；备份2026-10-17T21-26-09-859Z-83fa91c7。

最终程序来源stage-v1/stage-proof-ui20.json，交付清单delivery-manifest-ui20.json；浏览器browser-final-receipt.json，原生native-final-02.json，完整项目project-check-final-receipt.json。标准upgrade-final.json、installed-verification-ui20.json、status-final.json回读实际ui20/API0.9.24和12216安装哈希，验证附件不安装。

正式diary前后SHA一致；未写入测试消息。窗口与两个显示屏的宽高/字号字段对照通过。测试均为独立合成库。标准程序/偏好备份：D:\拾页\outputs\desktop-maintenance\backups\2026-10-17T21-26-09-859Z-83fa91c7。

根已查看496宽manual64前后截图与原生最终截图；浏览器量化上下留白与消息距离，原生回归检查输入、字号、引用、图片、发送稳定性、侧栏、阅读位置。截图/DOM回调不构成物理120FPS或长期CPU/内存结案。

原生首轮在33项处的旧会话停顿自动进入检查停止，未进入本轮布局阶段；workspace代码与ui19相同，持续焦点轨迹未留存，不能将原因定为失焦或间距回归。失败JSON、截图、事件和正常关闭/哈希归档保留；同一程序/proof/旧profile与缓存、原断言不变，在开始明确聚焦候选后完成最终原生回归，未在途中循环抢焦点或放宽等待。

最终原生实跑645＋10，原收集器649硬门槛曾拒收，count-review原JSON保留。根独立比较已验ui19：621条非条件断言multiset完全一致；首条消息新开组、不适用4项同组检查，后6条/12阶段真实同组的24项条件断言逐项精确核验，7次发送14阶段身份失败全空，原业务验证脚本不改。canonical native-final-02.json与count-review字节相同，不以任意降低总数门槛代替覆盖检查。
