# 朝花夕拾解耦阶段1验收

用户要求先拆成几个子项目，再一步步推进。当前已建立[六子项目入口](../revisit/README.md)及各自职责/依赖/后续任务，本轮只完成第1项的源码抽取。其余五项仍使用现有代码，不冒充已完成物理分离。

## 实际变更

- 新增src/server/domain/revisit/engine/contracts.mjs、calendar.mjs、index.mjs：v1来源/窗口/规则契约和纯回看计划。
- 引擎输入只有来源引用、UTC事件时间、分类、间隔、显式时区和左开右闭窗口；不读取数据库、正文、当前时间、系统时区、文件、网络或界面。
- 旧revisit.mjs保留全部对外函数。服务解析system时区，保留首次启动游标/分钟闭合/手动窗口限制，传规范输入给引擎，再负责稳定投递ID、已发送去重、固定组、事务和评论。
- 数据格式、旧日记、API路径、快捷键、随想前端及原生宿主均未改；不新增进程，不更新现有窗口。不拆数据库或强制独立服务，也没有重新生成全部旧数据。

## 证据

1. 修改前在tmp/revisit-decoupling/stage1生成108组合成基线，覆盖年/月/日间隔、不同时间窗口、手动/自动、重试、分类、隐藏/草稿及未知旧字段；对完整db+结果+重试结果计算SHA-256。修改后108/108完全一致，报告outputs/revisit-decoupling/stage1/compatibility.json。全部是合成样本，不含真实日记。
2. 新增tests/revisit-engine.test.mjs共6项：无正文访问/输入不可变/输出不别名、窗口边界/分类、多日去重/日间隔、闰日/月末/DST缺失、坏契约拒绝、依赖方向。来源必须明确UTC，不能依赖系统对无时区文本的解析。
3. 原tests/revisit.test.mjs的9项后端集成继续通过，包括来源只读/媒体、评论、撤回、隔离重启及CLI调用；局部共15项通过。日志在outputs/revisit-decoupling/stage1/tests.log。
4. 全项目检查使用SHIYE_TEST_NO_DESKTOP=1，文件引用、ESLint、Prettier全部通过；580项中579通过、0失败、1桌面项显式跳过，记录outputs/revisit-decoupling/stage1/check.log。首轮检查发现新引擎index文件的格式告警，已仅修正本轮文件并完整重跑通过，没有代改其他会话源码。未做真实窗口验收，也没有重新打包随想UI；本次不改变UI行为。

## 交接与后续

第2步是数据来源适配：把来源枚举、只读内容解析和展示渲染分离，明确存储端口与每轮快照；保留旧长文时间/旧附件编辑时间兜底、原文保护和未知时间复核。尚未开始第2步物理迁移；不把本次拆引擎当作补齐备份恢复、认证、多端或长期运行验收。

产物目录outputs/revisit-decoupling/stage1；临时脚本、拆分前代码副本与合成哈希基线在tmp/revisit-decoupling/stage1。项目设计文档在docs/revisit/，主题引用已同步F:/agent规范/软件技术路径/日记与消息统一内容模型.md。
