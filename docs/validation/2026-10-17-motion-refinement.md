# 随想ui17消息与窗口动效验收

2026-10-17。**ui17已正常保存、备份、标准升级并启动**，API0.9.24与package一致。主代理负责规划、核心定位与审阅，GPT-6.1-sol中等推理负责执行。需求与取舍见[U50计划](../CHAT-MOTION-REFINEMENT-2026-10-17.md)。

## 实现与来源

消息组此前以首条和末条消息ID组成key，每追加一条都会替换组身份并重建旧消息。本轮仅在本地mock路径使用首条originalId作为稳定key，外部上游路径和DOM id规则保留。冻结ui16的一个JS chunk与对应source map精确修改，源映射修改点后的4785段平移、其余91856段核对一致；不运行共享全量构建，不带入归档/朝花夕拾/数据桥候选。

动效C只改5处参数：稀疏行和时间标记高度300→160ms，曲线为cubic-bezier(0.16,1,0.3,1)；密集单层淡入24%/120ms→80%/80ms。保留连续几何让位、原有单滚动所有者和用户打断，不恢复旧气泡反向补偿。主源与生成镜像按既有单文件复制约定同步。EXE沿用ui16，没有将诊断宿主发布。

## 已完成隔离对照

20/10000条合成库每组5次：首DOM均值分别97.4→61.3ms、142.0→85.6ms；90% DOM几何/opacity代理分别167.3→130.5ms、213.8→159.2ms。旧根替换分别20–24/30–34→0，Markdown调用22–26/32–36→2。此处只对比稳定key，不能把收益全归给动画参数，也不能称DOM代理等于人眼首次可读。

稳定key与稳定key+C另有8组CDP实际绘制。每组旧字形有效匹配20–39帧，无超过2px反向，旧节点保持。图像采集会增加开销，离散采样及子像素抗锯齿使字形匹配阈值偏保守；这些小组不作为总体P95或物理120FPS结论。例如密集短文C的91ms帧尚未见新文字，147.8ms帧已清楚，不能沿用DOM代理83/96ms称其实际可读。稀疏多行97.8ms完整帧已有多行清晰，尚未全展开。原帧/filmstrip与像素匹配JSON保留于本轮message目录。

跨日新时间标记、图片发送、3条快速连发、滚轮打断、减少动画和确认ID转换已通过原型浏览器检查。最终候选浏览器报告为 `message/stage-ui-cache-final/report.json`：实际加载版本化chunk，三次请求served SHA均一致，无CSP错误，两次同组追加分别5/5、6/6旧根保持，多行及图片重开可见。此浏览器context禁用Service Worker，旧原生profile更新另由下述原生04验证。

## 窗口实际测量

主屏只读120Hz，使用合成内容及不含其他窗口的ROI，完整ui16与不初始化WebView的同尺寸纯色宿主分别捕获367/347完整帧，正常停录并逐帧校验。14–18ms实际意图间隔的快速反向已执行，结束回到展开位置、动画泵停止；另有实际鼠标点击移出/露边恢复操作。不是纯hover或物理键盘压力测试。

完整/纯色Location setter P95为9.49/9.21ms，UI入队延迟P95为4.22/4.32ms；实际边缘更新仍有长间隔，不能认定稳定120个不同帧/秒。40ms空闲计时器没有在动画中重复驱动，亦无证据把同步移动成本仅归于WebView。本轮保留原生曲线、当前位置接续和位置通知。常用868×1649/108%尺寸补测捕获138帧；65帧均匀灰色无效，已排除，不能称完整开合全部绘制通过。有效反向部分有36次像素匹配，setter P95为16.02ms；快速反向实测约17–18ms意图间隔。详见[原生记录](2026-10-17-window-motion.md)与`outputs/2026-10-17-motion-refinement/window/tall1649-findings.md`。

## 原生失败、资源更新与最终验收

前两轮分别在第二条／第一条表情追加时发生旧根身份失败；第二轮的799、800仍在真实viewport中但原根断开、当前根不同，其余18条保持，已排除这两条的合法viewport-prune。另发现验收门控把DOM previousLocalId和canonical viewport ID混比的潜在过严问题，但不能用它解释此次实际重建。失败与正常退出／归档清单均保留，未放宽身份或像素断言。

第三轮携带本地远程调试端口的诊断启动被自动审批以 `blocked by policy` 拒绝，未执行、未重试或绕过；只读CDP脚本未运行。普通桌面自动操作及普通原生启动可用。源码和日志表明现有Service Worker启用且静态资源按URL缓存，但未取得失败进程实际执行源码hash，不能断言完整缓存根因。

最终index通过精确importmap将唯一补丁chunk映射到 `?v=f218e163acc1`；严格CSP仅加入该内联map的SHA-256，不加unsafe-inline、不清profile/cache。最终stage proof为 `stage-proof-ui17-cache.json`，SHA `78c7c0cbb281db64282d5a184d6b9787d714057783362f3b331b91be5ba34d5c`。旧proof及失败保留为过程证据。

原生04普通启动复用同一旧profile/cache，**505项聊天＋10项图片检查通过**，7/7发送在首次DOM与settled两阶段均保留旧根，14项身份诊断无失败；每组有效旧位置轨迹非空、无超过2px反向、opacity无回退。已查看原生合成消息截图。未夹带原生截图的6组首DOM约29.9–46.7ms、90%opacity与几何代理55.4–79.9ms；另1组含截图，分别25.8/50.9ms，不能混作同条件均值。各组最大rAF间隔仍16.6–33.4ms，DOM代理不能称人眼首次可读或物理面板120FPS。

测试进程已正常关闭，进程树/profile残留0，15个生成文件逐项SHA核对后归档，candidate恢复12215程序文件。最终交付清单SHA `4c44e068a4307d020f994418b61fb2de643584580d14b16cee5cee786848cb31`，包含12215程序与42证据附件，另列2个外置验证附件。

## 项目检查与既有边界

根项目 `npm run check` 已591项通过，0失败／跳过；改动组件单文件ESLint通过。vendor `npm run check:ts` 实际退出2，14条错误位于并行候选shiyeLocal.ts／shiyeProgram.ts，未进入ESLint阶段，未代改或将这些文件打包。最终stage浏览器5项断言通过，图片IDB及重开可见；编辑live正确但重开不保留、删除live未即时刷新但重开集合正确，在ui16同夹具中也复现，记录为既有隔离边界，不称完整编辑持久化／即时删除重键通过。

根检查完成于16:18:57 UTC；后续原生验证脚本增加失败详情，针对该脚本另做Node语法、Prettier、ESLint检查通过，未把此前根检查写成后续脚本再次全库验收。ui17从ui16冻结，仅消息包装、修订、index、metadata、单chunk及map六个程序文件变化。验证脚本作为output附件单独记录，不安装到程序内；共享数据/归档/朝花夕拾候选不带入。

## 正式运行切换

标准dry-run通过后执行upgrade，操作 `2026-10-17T16-43-39-661Z-43ec623f` 已complete；正常保存关闭ui16，备份位于 `D:\拾页\outputs\desktop-maintenance\backups\2026-10-17T16-43-39-661Z-43ec623f`，再安装并启动ui17。最初清单尚未生成时的dry-run因缺manifest安全失败，未改运行版；清单完成后正常重试。正式API未重启。

16:46:54 UTC只读核验：随想PID72304、托盘/思绪PID37208（仅当时快照），ready修订ui17，API0.9.24与package一致；12215安装文件SHA-256全部匹配交付清单，验证附件未安装。868×1649、108%字号及两个显示屏的尺寸/字号档案保持；正式diary.json与升级前SHA一致，数据/profile仍在原F盘。随后通过Sky重新识别并激活新版随想窗口，未向真实会话发送测试内容。

回执位于本轮产物：`upgrade-dry-run-ui17.json`、`upgrade-result-ui17.json`、`status-after-upgrade.json`、`installed-verification-ui17.json`、`data-state-after-upgrade.json`。candidate/UPSTREAM与delivery中的pending/installed:false是不可变生成时状态，不等于当前仍未部署；当前运行状态以上述成功安装回执为准。

常驻CPU与长期内存没有在本轮结案；实际面板120FPS、四边和真实跨屏仍不能据短组外推。产物：`D:\拾页\outputs\2026-10-17-motion-refinement\`；临时：`D:\拾页\tmp\motion-refinement\`。
