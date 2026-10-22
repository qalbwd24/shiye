# 前端、旧格式与可变属性兼容核对

2026-10-16。已按用户要求读取最新开发/交接文件，并把后续读写责任和接口/UI约束同步到 DEVELOPMENT.md、DEVELOPMENT-HANDOFF.md、QUICK-WORKSPACE-REQUIREMENTS.md、统一契约、DATA-MODEL、FEATURE-MAP、CHANGELOG 及 F:/agent规范 对应主题。设计合同见 [FRONTEND-DATA-COMPATIBILITY.md](../FRONTEND-DATA-COMPATIBILITY.md)。

## 本轮代码和验证

- 纯处理器 processorVersion=2：新增可选 contentEditedAt，避免属性更新使正文编辑时间兜底改变；显式 null 仍未知。保持 body、块/图片出现 ID 与原图插入时间。
- 每次处理复用已解析的时区，普通段落不重复创建 Intl 格式器；没有给输入框增加监听器或额外自动保存队列。
- 新增兼容测试 5/5，与已有处理器 14 项合计 19/19 通过。覆盖旧 HTML/Markdown 通过实际 validateEntry/replaceEntry 修改分类和标签后的内容、附件、原始字段、评论保真，以及混合旧库的聊天入库/重试与标签更新。
- `npm run check` 完整通过：文件引用、ESLint、全库格式、353/353 测试，无失败/跳过，退出码 0。包含隔离原生宿主用例；不等于新图文控件已在真实快捷窗完成 IME/布局验收。
- 重新生成 4 份虚构内容样本，处理器版本与当前代码一致。

完整日志 `outputs/content-compatibility/check.txt`。没有读写正式日记，未修改快捷/聊天宿主、现有保存路由或 UI，也没有重启用户窗口。处理器尚未装配到运行应用，本轮不宣称已启用新版本界面。

## 性能核对

虚构 2000 段、28 万字符，Node 中每版热身一次后计时三次：

| 版本        | 三次耗时 ms           | 中位数 ms |
| ----------- | --------------------- | --------- |
| processor 1 | 143.6 / 153.2 / 164.7 | 153.2     |
| processor 2 | 24.4 / 39.3 / 18.8    | 24.4      |

证据 `before.json`、`after.json`。这是该样本上的重复计算改进，不是普遍性能保证；真实浏览器、超长/多图文档、输入法和保存线程/worker 调度仍待接入验收。处理器 async 不表示全部 CPU 工作自动离开 UI 线程，不能在逐键/composition 中运行。

## 已确认但未修复的原有缺口

合成虚构数据库调用真实 taxonomy/chat/entry 代码，结果 `outputs/content-compatibility/gaps.json`：

1. 分类改名改变 Entry.category，但房间配置和归篇边界分类仍旧，重新提交旧房间配置会被拒绝。
2. validateEntry 仍接受归篇正文改写，服务端只读边界尚未实施。
3. 源码核对显示当前聊天桥为本地消息入库＋回执；完整日记/程序向聊天接收消息尚未接通。
4. 新 richdoc 正式读写/恢复、旧篇到聊天的来源适配、内容时钟持久字段和旧客户端保护仍未实现。

这些是后续装配的硬门槛，不能因为 353 项测试通过就说所有需求已完成。当前不更改另一会话的 UI/宿主和生产行为。旧格式仍沿原路径继续使用；下一阶段接入时需要满足 40 项继承基线与本轮合同。

## 位置

成品：`public/shared/content-preparation.js`、`tests/content-compatibility.test.mjs` 与本轮合同/验收文档。统计、日志和缺口：`outputs/content-compatibility/`；虚构准备样本：`outputs/content-preparation/example.json`。临时性能/缺口脚本：`tmp/content-compatibility/`，没有新增盘根或用户主目录产物。
