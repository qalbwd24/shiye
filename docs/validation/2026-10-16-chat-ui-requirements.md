# 2026-10-16 聊天 UI 需求整理核对

范围：读取 D:\拾页 当前源码、已有需求及用户六张截图，把本轮要求写入 docs/CHAT-UI-OPTIMIZATION-2026-10-16.md，U01–U15 均待实施。纳入后续 Esc 修订，明确取代原双 Esc 返回，不把约 800ms 的建议当成确认值。

当前源码定位：shiye-room-workspace.js 无输入判空直接切换；DesktopPreview.cs 仅近边吸附并直接隐藏；shiyeTime.ts 仍以 30 分钟缺省；表情面板没有频次排序／网格按键逻辑。滚动遮挡、缺角、右键错误和 Esc 空白页只记录现象与排查入口，未宣称根因已确认或已修复。

现有日记归档与尚未实现的程序群聊双向收发分开记录。未启动旧目录程序、未改正式数据、未修改功能代码或版本号，未做界面运行验收。

同步入口：QUICK-WORKSPACE-REQUIREMENTS.md、CHAT-JOURNAL-REQUIREMENTS.md、CHAT-MANUAL-CHECKLIST.md、FEATURE-MAP.md、ROADMAP.md、CHANGELOG.md；F:\agent规范 更新既有聊天主题及索引引用，完整需求仍以项目文档为准。

本轮新成品为需求文档与本核对记录。后续检查结果记录在 outputs/2026-10-16-聊天UI需求整理/，临时文件如需生成仅放 tmp/；不复制用户截图或私人聊天正文。

检查结果：npm run check 通过，包含文件检查、ESLint、Prettier 及 298 项测试（298 通过、0 失败）。日志：outputs/2026-10-16-聊天UI需求整理/project-check.log。共享目录 validate_catalog.py 通过，19 个主题、0 错误；报告：F:\agent规范\outputs\2026-10-16-聊天UI需求整理\catalog-check.json。以上验证文档维护和既有项目检查，不代表新 UI 需求已经实现。
