# 全库新副本与图文快捷窗候选验收

日期：2026-10-16；源码工作区 D:\拾页。用户明确“新旧日记区分，不覆写旧日记”，并授权十月长文兼容、全库独立转换及快捷窗第一步更新。

## 全库转换

`tools/legacy-conversion-all.mjs` 仅 GET 正式源，在 `var/migration-lab/full-20261016-a/` 保存不可覆盖来源快照、逐篇原对象、候选正文和校验清单。运行目录必须位于本项目 var/migration-lab，下级路径不得是符号链接；源／算法哈希不一致会拒绝续跑。失败原件留在候选目录，不改源库。

实际3015条：3011普通旧日记转换、4条聊天 canonical 保留；正常2986、待复核29、失败0。包括隐藏2、回收站12、示例4，状态保留。3011篇结构、文字、逻辑空白、附件、重复稳定和原件保留通过；段落结构3010/3011。完整手打时间2290/2290，不完整／倒序等显式列问题，不补造时间。

十月57条全部生成：53篇普通日记、4条聊天；56正常、1待复核（time-order-reversed，完整时间13/13仍保留）。14条带附件；转换出的15个图片出现插入时间均为null。报告的 longForm 是大于5000字符的长度档位，不等于用户所称长文入口；不能据其0值误称未处理十月长文。

独立再GET：3015/3015源对象和整个library哈希与快照一致。实际续跑复用3015个候选包，完整性检查通过；没有覆盖源快照或既有候选。匿名报告 `outputs/legacy-conversion-all/full-20261016-a/report.json`，补充复核 `source-recheck-and-october.json`。本次候选只引用原资源，不是复制了全部媒体的便携备份。

## 快捷窗与保存接口

`quick-document-editor.js` 仅在本机18766且显式 richdoc=1 时为新篇选用新适配器。旧HTML／Markdown原生路径保留，非空旧模板回退；main.js和editor-input.js不再把结构化编辑器DOM存成正文。复用原450ms串行保存、创建幂等、revision冲突和图片确认上传队列。

`rich-body-adapter.js` 用Tiptap事务执行时间、缩进、分割线及插图；上传位置随事务映射，跨篇完成只更新原目标；保存失败重试复用资源及 occurrence。队列在冲突采纳另一版本时还核对最终附件／插图是否真的存在，避免误报保存。IME期间同篇重渲染保持编辑器；外部正文变化保留两份并阻止提交，完成组词后显式选择。

`contentFormat:'richdoc' + body` 为权威，服务端严格schema／属性／登记图片引用校验并生成安全HTML投影。旧客户端只改属性可保留body，降级覆盖正文返回409。contentEditedAt为服务端字段，分类／标签修改不推进。备份重映射覆盖当前及递归history.body，JSON加密与流式恢复用虚构图片验证。

## 实际验证

- 新增独立回归：全量运行器5项、rich正文适配12项、wrapper5项、后端／备份10项、上传冲突1项。
- Chrome真实引擎、独立临时服务器及虚构库，浏览器请求路由只到此测试服务，生产请求0：方向键分类、空白不建篇、中文空格、标题Enter、Alt＋T、自动换行、分割线、自动保存、双图粘贴Enter确认、原字节哈希、独立插图时间、段内手打时间索引、查看大图、重开不变、旧篇不变。
- 证据 `outputs/quick-richdoc-integration/browser.json`、`quick-richdoc.png`；脚本和虚构库位于 `tmp/quick-richdoc-ui/`。
- 完整 `npm run check` 通过：421/421，无失败／跳过，包含文件引用、ESLint、Prettier；日志 `outputs/quick-richdoc-integration/check.txt`。此前388项为上一轮结果。

## 开发运行更新

完整检查后核对18766进程为本工作区 tools/dev-server.mjs、静态新模块与本地源码一致，复制开发diary.json到私有 `var/dev-upgrades/richdoc-20261016-090947/` 并校验SHA-256，之后仅重启此开发服务。新 `/api/health` 为0.9.20（与package.json一致），contentFormats包含richdoc；开发diary.json重启前后哈希一致。

正式18765仍0.9.20旧能力响应，未重启。再次GET正式完整库与本批源快照整体哈希一致，3015条仍在。证据 `outputs/quick-richdoc-integration/runtime.json`；已请求应用打开开发地址，返回queued，不能视为实际窗口已展示或用户已验收。

开发入口 `http://127.0.0.1:18766/?quick=1&richdoc=1`；用户原有正式快捷入口和聊天ui7均未切换。没有为此前受阻的18767对照服务更换启动方式；本次启动的是标准隔离开发服务。

原生IME、窗口热键／托盘／5小时恢复／每屏字号仍未实测。正式库未切换；没有部署或重启另一会话的聊天UI。新候选尚未接通聊天双向richdoc、朝花夕拾查询和评论。
