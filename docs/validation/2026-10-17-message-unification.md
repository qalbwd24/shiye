# 统一消息主体：隔离实施验收

日期：2026-10-17。本轮用户限定“还有其他会话操作桌面，先只做数据层和隔离测试”。正式入口未升级或重启，未回写原日记库。实际接口与存储合同见 [实施说明](../MESSAGE-UNITS-IMPLEMENTATION.md)。

## 本轮结果

- 长文保存事务接入共同richdoc单元、时间及稳定编号，原文布局可精确重组。聊天同一主库落同格式正文；Entry和chatJournal兼容缓存受一致性校验保护，聊天原消息禁止直接PUT编辑。
- 分类标签改名不改消息身份或内容时间；评论绑定篇、消息、媒体出现，默认不进入普通消息/回看查询。新图文继续按整篇输入，不增加输入流程。
- 已归档和未归档消息均支持无正文撤回登记；重复请求、丢失回执、服务重开、旧上传和旧备份恢复不复活原文。消息ID不复用，撤回重发用新ID/时间。
- 两种备份链、媒体替换/撤销、评论图片软删/恢复均同步关联。失败事务整体回滚。

## 独立浏览器

命令：`node tmp/message-unification/browser-verify.mjs`。随机端口服务，dataDir位于tmp/message-unification/browser-data-*，仅合成内容，Chrome headless，不连接正式库。

通过实际浏览器键盘输入Tab/Shift+Tab/多段与全选缩进、前导空格、Alt+T时间戳、分割线；通过剪贴板事件、选文件、drop三路免确认插图。图注/宽度/对齐保存重开保持，3个媒体出现时间及编号独立，canonical与整篇richdoc精确重组，重开unit ID不变，旧篇原文不变，pageErrors为空。另确认旧HTML/Markdown缩进撤销仍可用。

证据：outputs/message-unification/browser/browser.json、updated-editor.png。浏览器测试不证明操作系统原生剪贴板、IME或真实快捷窗生命周期。

## 后端及本地聊天适配

主要自动测试：message-units、message-store、message-unit-integration、message-unit-conflicts、message-store-archive、message-unit-candidates、chat-withdrawal-local。

综合接口测试覆盖图文保存/无损重组、消息/媒体评论目标、非法引用回滚、分类改名、服务重开、查询参数与隐藏/草稿过滤、旧篇candidate只读无副作用、离线先撤回后上传、同操作旧revision重试、墓碑排序、嵌套历史清除、receipt状态。

本地worker+IndexedDB+journal 8项故障注入通过，Web A全量tsc --noEmit通过，详见 [聊天撤回](2026-10-17-chat-withdrawal-data.md)。宿主allowlist源码已加withdraw，未构建或启用新版聊天宿主；撤回提示气泡和限时重新编辑UI尚未实现。归档/冲突详细结果见 [归档](2026-10-17-message-unit-archives.md)、[冲突](2026-10-17-message-unit-conflicts.md)。

## 旧日记独立候选

批次full-20261017T051031：3021篇源记录，7聊天保留原结构，3014长文生成7374个候选unit。3002正常，10时间复核，2兼容复核，未丢弃复核条目。3014篇共同结构/可渲染/样式语义/文本/空白/往返重组/重复编号/媒体顺序和旧附件时间检查通过；原段落结构3013通过，1篇兼容保留。批次源GET前后整体hash一致，不写正式库，不覆盖之前候选。

十月专批october-20261017T051031：63篇，7聊天保留、55正常、1时间顺序复核。独立对照707个span/时间段全部匹配，其中705完整时间锚点；18媒体span单独处理。全库独立对照23321项全匹配，其中12253完整手打时间。未知时间不伪造精度；旧附件统一原内容编辑时间兜底，真实insertedAt仍null。

公开统计位于outputs/message-unification/legacy/{批次}/report.json、segment-time-audit.json及source-recheck-20261017T051031.json；私人源与候选位于var/message-unit-candidates/{批次}/，不提交正文。候选引用原媒体，不是独立媒体备份。

## 全项目检查与桌面边界

首次默认 `npm run check` 通过模块/lint/格式及532项，原生Windows快捷窗测试1项失败，位于quick-desktop.test.mjs的退出断言。这个现有测试会编译并启动独立原生窗，运行时误触发，偏离本轮不操作桌面的约定；它只连接自身随机端口合成页/独立profile，没有运行正式入口或写正式日记。已向用户说明，不把它报告为通过，未修改原生代码来掩盖失败。该次日志为outputs/message-unification/check.log。

现为quick-desktop.test.mjs新增显式 `SHIYE_TEST_NO_DESKTOP=1` 跳过开关，默认行为不变。受限数据层回归使用该开关运行完整其余检查，结果记录于outputs/message-unification/check-headless.log。原生失败留待桌面空闲后专项重测，不能以headless通过替代。

明确设置开关后，`npm test` 最终534项：533通过、0失败、1项原生测试跳过，16143ms；证据outputs/message-unification/tests-headless.log。该轮包含最新5项综合接口测试。期间另一次全check在并行便签会话写入中因其临时缺失模块/未格式化文件停在静态阶段，未修改其他会话文件；待其文件写入完成后重新执行受限check。

最终 `SHIYE_TEST_NO_DESKTOP=1 npm run check` 退出0：模块引用、全库ESLint、全库Prettier均通过，534项中533通过、0失败、1项按限制跳过，测试14968ms。最终日志为outputs/message-unification/check-headless.log。正式18765及开发18766只读health均0.9.24且尚未返回messageUnits能力，确认这两个现有进程未加载本轮候选；未为验收重启它们。

## 未交付为正式功能的范围

正式程序本轮未激活消息主体；开发入口下次启动才显式启用。旧候选未自动导回主库，12篇复核仍保留；仅日期+邻行时间的组合写法待专项扩展。朝花夕拾展示组/规则、评论对象切换和只读快捷打开未实现。真实宿主IME/热键/窗口生命周期、手机/自有服务器同步仍待后续验收。

本轮源码在D:/拾页，产物outputs/message-unification，临时tmp/message-unification，私人候选var/message-unit-candidates。跨软件技术引用已同步到F:/agent规范/软件技术路径/日记与消息统一内容模型.md。
