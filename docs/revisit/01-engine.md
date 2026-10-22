# 子项目1：回看引擎与契约

目标：不需要启动拾页、随想或数据库，就能判断哪些旧消息落在给定回看窗口。第一步源码已抽取，108组新旧状态快照对照和15项引擎/后端回归通过；全项目结果以[阶段验收](../validation/2026-10-17-revisit-decoupling-stage1.md)为准，尚未正式部署。

最终全项目check通过：580项中579通过、0失败、1桌面项按约定跳过；未操作运行窗口。后续先进行子项目2的来源适配，不在本阶段混入新的推送策略或UI调整。

代码入口：src/server/domain/revisit/engine/index.mjs；契约说明/校验在同目录contracts.mjs，日历运算在calendar.mjs。旧revisit.mjs保留replayInstant和tickRevisit导出，由兼容层调用新引擎。

输入v1：来源列表sources（仅ref、eventTime、category），rule（interval与categories），timeZone（已解析的IANA时区），window（after、through，UTC毫秒，左开右闭）。调用方须先完成可见性校验；引擎不接收正文或媒体字节，不识别Entry、chatJournal或数据库对象。

输出v1：按分钟排序的groups；每组含minute和occurrences，每项仅含ref、replayAt、originalAt。同一来源/回看时刻在一次计划中只返回一次。计划不是已保存或已投递的消息，稳定投递编号、跨次去重和组冻结属于子项目3。

规则：年/月/日的正整数间隔，覆盖所有更早整数倍；无效日历日期和夏令时缺失时刻跳过。北京时间默认值仍在产品设置中；system由宿主先解析，引擎不读取环境默认值或当前时间。首次启动游标、分钟闭合等待、补看上限也由服务负责。

验收：直接导入引擎测试，不引入node模块、HTTP、数据库、DOM、编辑器；给定相同输入结果相同，输入不被修改；年度多年份、跨日、多日去重、分类、边界、闰日、月末、夏令时等有用例；原tick/API的投递编号与状态快照保持一致。
