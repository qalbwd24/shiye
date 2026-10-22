# 随想后继 ui53：缩放绘制、壁纸和会话记忆

已通过全部组件、热选区新增性能审点及最终合包审核，7目标源码CAS回写后正常保存/备份/标准upgrade运行ui53。operation/backup `2026-10-19T23-52-39-012Z-c908c4bf`，实际ready回读 `2026-10-19T23:54:44.1077670Z`、LocalSaveAck、116%/两屏/前台editor聚焦、无锁。ui52仅已审中间候选、不单独重复重启；本次将绘制前修复、壁纸当前房独立解码、最后会话与热选区局部合为ui53。沿原CHAT-UI-OPTIMIZATION、ROOM-SWITCH、人工表及标准维护流程接续。

## 具体问题与实现

| 范围 | 旧失败 | 后继行为及证据 |
| --- | --- | --- |
| B1/B3缩放阅读 | 同字符972→500宽后偏503.8125px | 先按稳定消息/同字符Range保锚，停稳0.1875px；原MessageList唯一scroll owner。`resize-anchor-high`及`review/ui52-independent`已审 |
| 连续缩放绘制 | 已审停稳版仍可在实际合成PNG抓到文字y3→507 | 在现有window resize/RO绘制周期由同一MessageList提交函数按需measure→forceMutation，更新常规基准防反向补偿；不另建滚动队列/timer。独立36帧y均3、rAF误差0.1875px。`resize-paint-high/independent`已审 |
| 冷壁纸 | 当前房壁纸被无关房头像串行解码挡住 | 当前源独立读本地asset，Image.decode后才提交；epoch/当前房/asset identity守卫防旧结果回灌。2项LRU及32MiB RGBA估算，超预算当前单图可独占。`wallpaper-switch-high/independent`已审 |
| 上次会话 | 普通同hash刷新保B，原生固定入口startup却开第一房A | 仅设备本机记录实际revealed房ID，固定入口优先最后合法房；显式房链接/用户操作优先，缺失/归档/存储拒绝沿原fallback。`room-memory-high/independent`已审 |
| 热切文字选区 | A→B→A草稿和阅读位置保持，选区却折末尾 | 以room＋内容签名/节点path保caret/方向/input-scroller，最多64项内存状态；新输入/IME/改变内容不重放旧值。`room-memory-selection-high/independent`行为及新增性能审点均通过 |

## 算法调查与测量边界

已区分rAF布局观测和实际绘制：第一次旧采样虽有503px几何瞬态，PNG未抓大跳，保留；第二次旧采样明确抓到y507像素帧。新版同字符/原node的113 rAF最大误差0.1875px、38张PNG y均3；非作者另36帧同结果。只为本次浏览器合成输出作结论，不外推真实WebView/DPI/物理显示器全帧。

研究沿WHATWG rendering、CSSWG Resize Observer和Chrome CDP Page screencast原始资料，结合项目Teact/fasterdom调度实测，具体链接及逐帧证据在`resize-paint-high/receipt.md`。同步布局前移消除已测延迟，不代表总CPU/布局成本降低，长房/媒体/原生成本未验。

壁纸测试通过gate暂停inactive头像取得确定等待依赖；耗时包含受控暂停/截图，不能当自然用户基准。Image.decode屏障避免发布未准备URL，但用户物理“半张壁纸”现场未复现，不能据此根治结案。32MiB仅应用对象估算，不是GPU/浏览器硬上限，旧头像和全局fallback路径未重写。

## 数据与所有权

- 消息ID、原文/原件、归篇/撤回/replacement、API/端口及跨端wallpaper字段不变，不切写入owner。
- `shiye-last-room-v1`为**设备本机**localStorage数字房ID，缺失保旧fallback；从本版实际显示房间开始记录，不能恢复过去从未持久化的最后房。显式deeplink优先。
- 热选区只保有界内存签名/路径与偏移，不新增冷存储/共享业务字段，不承诺冷重开caret或未发媒体job持久化。
- ui53原生EXE/DLL/9源闭包精确沿已运行ui51 v3，不混共享目录并行bridge/input候选。UI49 A/C、ui50 SF16、ui51侧栏/输入/hover沿已审代码保持。

## 装配/审核/部署

候选`outputs/2026-10-19-web-chat-improvement/candidate-ui53-continuation`从已审ui52用不变硬链接准备，覆盖一律新临时文件原子rename，不能直接写穿ui51/ui52硬链接。所有新compiled资产由冻结source map逐字证明，包装脚本按实际SHA更新cache URL和版本标识。未引入整目录可变源码重建。

最终冻结`ui53-frozen-manifest.json` SHA `9d8e827ceb31771aa062c13d404336763a3b195cf9f374645ca9932257a4e602`，12365文件、43条overlay记录，paintIncluded/memorySelectionIncluded均true。热选区独审保持通过，另用260041字符HTML/真实selectionchange旧新各29次定点计时，新监听中位0.8/P951.0/max1.2ms、旧max0.1ms；成本可测，本次未构成阻断，不能外推复杂DOM/慢设备/整帧预算。不重行为矩阵。

最终`review/ui53-independent.md/json` passed:true绑定相同manifest；43条overlay/42个文件均独立重算，ui51/ui52原冻结接缝保持，15wrapper逐来源核对、paint两源/viewport helper及实际bundle/source map一致、EXE/DLL仍精确ui51 v3。源码/组件审批与装配分开，未重全矩阵。

一次同包直接相邻复验`sol/ui53-independent-send-neighbor-raw.json`：109实载资产匹配，真实IDB持有2201.9ms下156.4ms本地首显，ACK后同一节点、正式ID585/gap0/消息bottom803.94在footer822之上；hidden按钮、held输入尾字847–869在clip837.5–878内，侧栏红名18px保持。仅一次相关链，交叠断言不累加为独立场景。用已有私有两房capture、无撤回合成变体、未读原件/导出正文或发正式测试。

`ui53-writeback-apply.json`7目标CAS回写（3 TS源＋preview/workspace各根/public两份）通过并留原件备份，其他并行backend/bridge/input源未覆盖。`delivery-manifest-ui53.json`覆盖12365文件、绑定最终冻结SHA，原标准CLI已完成安装字节核验及正常保存备份/升级，实际ready见下节；本轮root未重启API。

## 正式安装与实际启用

`ui53-install.json` installed/restarted=true，标准CLI以12365文件交付证明完整校验后安装；备份`outputs/desktop-maintenance/backups/2026-10-19T23-52-39-012Z-c908c4bf`。`ui53-normal-save-runtime.json`记录旧ui51在23:53:03.1798503Z实际form-closed/LocalSaveAck，无pending/recovery；未强杀或绕过保存。

`ui53-after-status.json`安装/运行均ui53，native ready回读23:54:44.1077670Z、lifecycle save-Saved/LocalSaveAck，输入框实际聚焦，textScale1.16/displayProfiles2，maintenanceLock=null。API仍0.9.27/shared:true，根未重启后台，无新端口/业务字段/消息owner切换、未发正式测试消息或操作手机/5554。

`ui53-native-preference-save.json`只读标量回执确认正常保存后原窗口772×1550、1.16/两屏，以及`DockActivateOnHover=true / DockHoverInputRevision=1`真实落盘；没有强写用户设置或用模拟值代替持久结果。实际启用与隔离功能证据分别记录，不把正式ready冒充原生DPI/物理半图全链复验。

## 尚未完成与边界

手动截断归篇的早期耐久接受/媒体边界接口已交数据owner后继排队，尚无能力不假用close-idle；完整所有会话缓存/冷caret/未发媒体草稿记忆及长期/真实DPI性能仍分别验收。UI本轮局部不等同多端持续同步或整轮全部完成。
