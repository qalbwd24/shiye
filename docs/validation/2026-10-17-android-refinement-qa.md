# Android 0.5 定向集成 QA

最终运行候选4 `c60bac46e175629911c4d830f69fb12eee6abb11a2704919662f5267666872e6`，0.5.0/code7。分类/排版/文件/PNG/GIF核心链路及数据保护已过；**AVD长帧仍明显，不能写流畅或120FPS达标**。以下分包证据按未受修改影响的路径复用，不重跑无关矩阵。

2026-10-17 集成 QA 进行中。主会话已交接主 AVD `emulator-5554`，首包 0.5.0/code7 SHA-256 `4d14b30a2989375cf4d247859610d6795bc9566e525ec5465977373e7ccec302`。主会话安装前后 213 原私有文件逐项哈希一致；本 QA 仅操作该 AVD，手机及桌面运行版不在范围。

按 TESTING-POLICY 聚焦分类事务、写作排版、文件字节回读、表情发送及列表刷新。浏览器日记 24 条与文件桥 7 条是既有源码定向证据，不充当本 APK 运行通过。

| 核心场景 | 当前状态 |
| --- | --- |
| 独立 UUID SQLite 分类、默认、排序及内容时钟 26 条 | 首包真实平台 SQLite 26 条全过，独立 UUID 命名空间 |
| 分类管理、排序保存/放弃、默认新篇、真实 Back | 已过固定底部保存、排序放弃/提交、默认新篇、逐级 Back；QA 分类已删除，原顺序已复位 |
| 编辑器直接分类管理、字号/行高保存取消与真实 Back | 数字 IME 22px/2.1 预览、Back 回父、取消、保存 23px/2 后重开均过；全局分类变更返回保留 24px 未提交草稿；直接分类删除后 body hash 保持、revision 对齐，随后真实输入保存无冲突 |
| 普通文件选择、发送、另存为及取消、实际字节 SHA-256 | 候选2真实系统选择、预览、发送、另存为 Downloads 均过；51 字节及 SHA 完全相同；候选3系统选择/另存为真实 Back 取消均过，前后全部消息 hash 保持 |
| 笑脸实际打开、PNG/GIF 发送及重开；置顶深色和独立字号 | 候选2实际发送字节保持；候选4既有 GIF 双帧真实绘制与冷重开通过，PNG重开显示；消息24px/输入20px保存冷重开独立生效，置顶底色加深且可持久化，最后完整恢复原偏好 |
| 列表刷新无变化不重建，变化保留筛选及阅读锚点 | 候选3在两条 QA 合成结果筛选下手动刷新显示“已是最新”，筛选和全部行 bounds 精确保持；未造大库，自动/变化数据的全生命周期未扩大验收 |
| 切会话、连续发送、IME、表情面板、设置开合的绘制帧 | 候选4四个独占短场景已采，60Hz下有明显长帧；面板/设置样本少，不给稳定百分位保证；不是流畅达标 |

帧率证据将先读取实际 display 与 SurfaceFlinger 周期，再独占采样 gfxinfo framestats 和应用图层 present-history。分别报告 p50/p95/最长帧、8.33ms 与设备实际帧预算，配实际稳定截图核查裁切与回弹。AVD 若为 60Hz 不冒称达到 Magic7 120Hz；rAF 回调频率不当作物理刷新率。

首包 PNG 失败证据：`current-synthetic.png` 与 `sticker-readonly-*.json`。系统返回并写入收藏的 File 声明 `size=0`，但 `arrayBuffer()` 实际 5812 字节、PNG 签名正确，原 blob 的 Image.decode 为 480×320。发送回调复制 File 后弹出 `Shoot! ... [object Event] undefined`。只复现一次，保留原收藏/IDB，已向主会话与聊天代理交接修复；不把首包浏览器通过当 AVD 发送通过。

候选2 APK `ad7128412ace7d290ec2202d4a41148f4956e87b3d31c967ca8dd9dd4311478f` 已修并覆盖（主会话安装前后 262 原私有文件 hash 保持）。未删除首包旧收藏，直接重开该收藏实际点发送，预览/发送与原 PNG hash 一致。新导入 GIF 为 96×72、350ms 双帧循环（本地 Pillow 确认 n_frames=2），当前只证明原字节到达消息存储，尚未把文件本身有两帧当作屏幕动画已验。

普通 TXT 为合成 UTF-8 中文、换行及 NUL 的 51 字节样本，SHA-256 `030f4ae618f252ba554ec7692c38bfda65d2806f772b769d81b9dbcf8cc0308a`。候选2通过系统选文件→预览→发送→点真实消息文件卡→系统另存为 `Downloads/QA-REFINEMENT-saved.txt`→ADB 只读回取公共成品，字节长度与 SHA 相同。

候选2截图还暴露输入胶囊内部独立白底，主会话将仅修 CSS 后交候选3。当前日记父设置截图是在进入过渡抓取，不能当稳定合格图；最终包等待动画完成后重拍设置/正文并检查层级、裁切及回弹。

候选3 SHA-256 `bc717f572c4dfef0e01c5a798e5985c07e15acde95a2386a1a5fbffeb83aee3e`：输入区稳定图已确认单一白色胶囊；日记 `diary-settings-parent-stable.png` 等待 900ms、opacity=1/transform=none，已实际查看无正文重影或透明盖层，正文阅读图也无裁切；已显式保存恢复 18px/1.85，body hash/revision 保持。原置顶一直未改 `[-10]`。

候选3重开媒体复核：PNG 最初 800ms 是空白占位，后续没有点击/重发而自行加载为完整 IMG，不能据初始截图断言持久化丢图。GIF 当前仍普通 `.gif` 文件卡，消息 document attributes 只有 Filename、缺 Animated，实际屏幕两帧尚未通过；已将 `media-structure-*.json` 给聊天代理修复，不以原字节完整替代 GIF 绘制完成。

候选4 GIF 修复后，保留原消息及原 document 1471 字节。`gif-painted-*.json`：实际 IMG `image/gif`、96×72、opacity=1；4张原生 screencap 中同一 787×590 图片区域像素 SHA 交替为两种值，差异 bbox 覆盖画面；`flush→force-stop→start` 冷重开后，同 ID 消息再次有可见300×225 IMG。已实际查看 `gif-reopened-stable.png`：PNG、普通TXT、GIF动画与可下载原文件卡均在屏内。没有把文件本身双帧数或 rAF 当成屏幕动画证据。

最终恢复：日记18px/1.85，原完整 native 偏好快照恢复并冷启，默认会话列表 `inConversation=false`、`pinIds=[-10]`。原7个会话全部消息数量及hash与QA开始前精确一致。保留2篇QA合成日记、3个QA合成聊天会话（附件-105、纯文字PERF-106及后续单次诊断空起始会话）；独立事务测试另在UUID命名空间，不打开真实SQLite日记路径。最终聊天flush ACK干净，没有未发正文/打开的对话框；没有操作手机或桌面运行版。

## 实际帧证据与边界

`display-evidence.txt`：显示周期16666666ns，即60Hz/16.67ms；GLES为 Google(Intel) Android Emulator OpenGL ES Translator、Intel Arc B370，驱动32.0.101.8509。未改模拟器刷新设置。Magic7物理120Hz本轮未测；8.33ms仅作目标参考。

| 短场景 | 官方 janky frames | FrameCompleted−IntendedVsync p50/p95/最长 ms | 实际present间隔 p50/p95/最长 ms |
| --- | --- | --- | --- |
| 三连发＋IME显示/收起 | 44/58，75.86% | 84.73 / 135.36 / 151.41 | 32.42 / 82.36 / 486.90 |
| 两合成会话切换 | 40/62，64.52% | 83.81 / 133.79 / 134.72 | 32.45 / 68.23 / 99.73 |
| 笑脸面板3次开合 | 8/11，72.73% | 51.49 / 101.17 / 101.17 | 217.21 / 250.64 / 250.64 |
| 设置2次开合 | 5/5，100% | 51.21 / 67.88 / 67.88 | 268.76 / 432.95 / 432.95 |

原始 `*-framestats.txt`、`*-surface-0.txt` 与 `performance-summary-*.json` 保留。官方 deadline missed 分别44/40/8/5；完成延迟样本58/62/11/5条均超过16.67ms与8.33ms，但完成延迟不能倒数当FPS，其超预算条数也不是实际掉帧数。present history 有效帧59/62/10/5条；表中间隔包含180–550ms主动操作等待，最长idle gap不能当连续动画掉帧。面板/设置样本尤其少，不作稳健统计结论。

采样独占AVD，reset到采集之间无截图、UIAutomator或其他UI任务；使用真实CDP touch/insertText、少量状态读取与固定操作间等待。发送/面板/设置位于全新纯文字PERF会话，无同屏GIF持续动；切会话曾进入含GIF的附件QA会话约550ms。稳定截图在样本结束后抓取。稳定图已实际查看，无消息被输入栏裁切/设置正文重影；没有逐物理帧像素轨迹证据，不承诺全动效零回弹，也不把本机AVD长帧直接外推手机。

随后按主会话要求追加一次最小归因基线，无扩大App矩阵：同AVD系统Settings首页只读滚动3×450ms，采样约2.18秒，未改变任何设置。官方jank **1/121=0.83%**，完成延迟p50/p95/最长 **23.26/26.83/29.24ms**；Surface实际present122帧、间隔p50/p95/最长 **16.57/18.79/33.24ms**。完成延迟全部超过16.67ms而官方jank仍仅0.83%，也说明pipeline延迟不能直接当掉帧率。系统基线明显优于拾页发送/切会话段，**不能将App长帧全部归咎模拟器或renderer**；具体瓶颈待主会话只读分析原始阶段。`settings-baseline-*.json` 与raw保留。基线结束已回拾页默认列表、pin[-10]、flush ACK，再次停止ADB。

主会话再指定仅一次内建背景CSS归因诊断：对精确内建canvas selector临时注入 `filter:none!important;mix-blend-mode:normal!important`，实际computed style从grayscale(1)/soft-light变为none/normal，opacity0.2保持，不碰自定义背景。为匹配原发送样本的空会话起始布局，新增第三个合成纯文字聊天容器；仍使用原三连发＋IME短脚本，没有增加日记。结果 **47/53=88.68%官方jank**，完成延迟p50/p95/最长 **134.40/250.82/287.30ms**，present间隔 **47.94/148.39/170.42ms**，没有改善。单次非交错AB不能证明去filter导致变差，但不支持filter是已定位瓶颈或该处理有效，不据此更改产品。临时style已移除、没有持久化，flush后回列表/pin[-10]、styleRemaining=false，停止ADB。原始 `send-ime-no-filter-*` 与 `filter-ab-*.json` 保留。

QA 操作修正：分类管理关闭后编辑器分类选择器仍打开，初次后续保存测试误点其背后的正文，未真正输入，revision 断言失败。实际 Back 关闭分类选择器后重新点击输入，正文改变、revision 4→5、保存 ACK 干净；这是测试操作问题，未修改产品源码。分类删除的内容时钟精确保持由前述平台 SQLite 断言证明，UI 回执仅证明正文哈希/revision/后续保存。

产物：`outputs/2026-10-17-android-refinement/qa/`；临时：`tmp/android-refinement/qa/` 与 `tmp/android-refinement/native/test-build/`；真实私有备份仅置 `var/android-backups/` 独立目录，不把正文写入 QA 回执。

