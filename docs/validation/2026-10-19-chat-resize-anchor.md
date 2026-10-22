# 随想窗口缩放阅读锚点：B1/B3

当前仅私有候选：三源已由非作者Sol高独审通过，ui52后继合包已准备，最终合包直接相邻审核进行中；尚未源码回写/安装。ui51标准升级独立完成，不把本候选混入已审ui51。

用户要求窗口尺寸变化后仍顺畅阅读，并记忆窗口/会话状态。本项只补窗口实际宽高重排后的同内容位置保持，不代表全部窗口/草稿/已载内容记忆。

## 实现与原失败

复用原B1/Astra草稿与527px旧基线，只改`useContainerHeight.ts`、`MessageList.tsx`、`shiyeRoomViewport.ts`。稳定消息ID＋原text node字符Range/原文快照记录相对视口位置，媒体可降级到已解码图片fraction或消息边界；节点/内容/source变更、切房revision或用户新输入意图使其失效。每挂载container仅一WeakMap锚，窗口重排产生的scroll不覆盖原锚。

宽度信号与已有测量流程合流，实际window宽高变化才触发；原MessageList仍为唯一scroll提交者，底部/发送/明确定位保原优先级；无另一个wrapper/rAF滚动owner、固定长等待或全房DOM缓存。composer-only拖动不冒充window resize。

24条合成消息/真实Chrome与IDB、真实wheel至中段，固定消息19字符870的同一Range：972→800→650→500，旧ui51最终偏移503.8125px；新候选最终误差0.1875px，最后宽度到稳定约32.4ms，随后500ms无反跳。原节点保持、实际高度变化、composer-only、wheel优先且550ms不拉回、底部gap0→0共8直接相邻通过。

连续rAF全采样保留，新版仍出现补偿前max503.8125px瞬态，不能称连续拖动全程无抖或物理高FPS已解决。

## 独立审核与包范围

`outputs/2026-10-19-web-chat-improvement/resize-anchor-high/receipt.md`、`manifest.json`、`independent.md/json`：非作者复核完整effective source仅三源变化、source map逐字对应实际bundle、15个wrapper/CSS与最终ui51相同；独立复测同字符0.1875px，resize与切房并发后新房owner正常。复用原8项同SHA证据，不重全套原生/媒体/发送矩阵。

`candidate-ui52-resize`以ui51冻结资产复用，overlay已审compiled构建，15wrapper仅preview版本标识ui51→ui52，index资源cache按实际SHA更新，native EXE与全部原生闭包保持ui51 v3。`ui52-frozen-manifest.json` SHA `d513af007680856c25ae5b79986015933011ef784d7c17d2797f8a4dc0448d28`，12331文件。最终独审只扩MessageList变更的慢写本人发送直接相邻，不重侧栏/composer/native矩阵。

## 边界

未验证原生WebView拖边、跨屏DPI、延迟原件媒体、撤回/原位替换实际锚点、完整分页/冷重开记忆或壁纸性能。上述不以静态guard或本项停稳通过代验。后续改动须保已审三源与其他功能范围，不回退SF16即时显示。
