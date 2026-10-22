# 随想 ui33：五条候选与表情包管理

2026-10-18。用户要求 / 浏览和搜索最多同时显示5条，更多匹配用方向键滚动；管理页优化排列和快捷排序，输入区笑脸移除，管理集中设置。已标准保存/快照/升级启用20261018-ui33；API0.9.25未重启，Android APK不动。规则/本机偏好格式/未跨端同步边界见[实际说明](../STICKER-SORT-FIVE.md)。

只在冻结ui32上替换shiye-input.js、shiye-preview.css、shiye-preview.js和缓存hash/发布元数据；保留另会话对共享收藏客户端、Android与同步的源码，但未把那些候选混入本轮包。服务器、数据schema、原生宿主和看图页不改。排序另存本机UI偏好，历史素材ID/原件/名称/备注/别名不重写。

## 验证

- 4项Node交互测试通过：名称与旧别名、IME/焦点/Enter、异步输入变更保护，以及16候选可达、连续排序串行提交、去重/非法操作、旧素材和别名保持。日志outputs/sticker-sort-five/node-tests.log。
- **39项候选与39项安装资产真实构建浏览器检查通过**：原名称检索/GIF原字节/草稿/IME回归，默认5行360CSS px、可调3行216px、16匹配不截断、到第6/16项滚动仍在输入框；筛选后第6项也能选；笑脸隐藏、设置入口、单列管理、管理缩略图不发送、置顶/下移/名称排序/反转、/浏览跟随顺序，刷新后顺序与行数保留。无页面异常和外部服务请求。截图five-candidates.png、three-candidates.png、sticker-management.png仅为合成库。
- JS/测试ESLint通过。原生EXE/看图页SHA与ui32相同，复用ui31的11项看图证据；未冒充本轮重跑物理看图/QQ拖拽。按照测试策略未重复无关全库检查，未改vendor TS。
- 11915项安装hash一致，安装与原生运行回执都是ui33，API/package=0.9.25、metadata=1；116%与2屏档案保持。正式旧长文3014篇、旧消息295条、旧收藏3个身份/媒体、分类/规范消息库、回看配置/评论/投递/绑定保持；runner=waiting，lastError=null。整库SHA是否相同=false，定时运行状态可正常变化，未直接覆盖正式库。
- 本轮未替用户在真实收藏上排列，也未向正式库发送合成内容；排序/重开验收在独立IDB和隔离API。QQ动图沿用此前用户实测通过，微信直拖依用户要求停止适配。

## 产物与恢复

机器核验outputs/sticker-sort-five/final-verification-ui33.json；发布清单delivery-manifest-ui33.json已标部署。程序/偏好备份D:/拾页/outputs/desktop-maintenance/backups/2026-10-18T07-32-41-505Z-0f7c8f49；私有数据快照F:/<正式目录>/var/upgrades/sticker-ui33-2026-10-18T07-32-33-030Z。原日记、媒体和profile位置保留；后续操作先重新status，不复用旧PID。

产物D:/拾页/outputs/sticker-sort-five，临时脚本与隔离库D:/拾页/tmp/sticker-sort-five。真实快照不进入源码交付，不清理或删除旧备份。
