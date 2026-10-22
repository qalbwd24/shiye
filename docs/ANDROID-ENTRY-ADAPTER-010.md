# Android 0.10 编辑入口格式保护

2026-10-18，依据 [电脑后端总契约](DESKTOP-ANDROID-CONTENT-CONTRACT.md)。本轮只实现格式/能力适配与本地编辑保护，没有联网Repository、HTML转换器、远端PUT或真实数据迁移。

## 接缝

`android/app/src/main/assets/desktop-entry-adapter.js` 是独立ES模块：

- `inspectEntryEnvelope(raw, options)` 返回 `supported/readOnly/reason/rawOriginal/entryOriginal/entry`。原件深克隆，不sanitize后重存；UI兼容仅在没有contentFormat且body.format明确shiye-richdoc时补投影格式。HTML/Markdown、未知richdoc版本/节点/属性不可编辑。
- 优先使用共用 `content-algorithms.js:inspectRichDocument`，即共享文档校验与实际编辑器schema校验；独立调用也可注入 `validateRenderableRichDocument`。阅读投影、bodyComplete=false、canonical messageStore权威、chatJournal正文都只读保留。
- `mergeEntryChanges(capability, changes, options)` 从完整entryOriginal深克隆，只接明确可编辑字段；完整date、attachments、未知信封字段未被明确修改就原样保留。revision来自原件/Repository回执，不使用UI dirty计数。该函数是未来完整Entry Repository的保留式合并工具，不等同已经接通电脑写口。

## 当前editor本地写口

`editor.js` 实际通过 `sink:'android-local'` 接入检查。完整datetime、没有本地categoryId、当前本地DTO不能持久化的扩展字段，以及独立attachments不等于正文媒体refs等情况提前只读。不能把远端完整信封直接发给会丢字段的本地接口后声称保存成功。

实际 `saveEntry` 请求仍只包含本地已支持字段（id/baseRevision/title/date/categoryId/tags/body，以及存在时显式正文refs attachments）；native成功DTO回执更新memory rawOriginal与当前revision。正文和资料不同步的远端PUT由未来Repository另行接入。日期UI只显示日历日期；打开页面不截断原date，明确更改日历日时保留原有时刻后缀，但当前本地sink会提前保护含完整时刻的原件。

只读且schema支持时仍可挂载同一富编辑器做阅读，编辑器setEditable(false)、dirty/保存入口阻写；不支持的正文显示保护原因并保留原件。现有时间戳、缩进、组词保护和空白草稿ACK沿用原实现。

## 验证

16项合成浏览器检查通过，实际加载共用renderer/schema和Tiptap：桌面跨端fixture完整往返（含marks、Tab/全角空格、代码、同图不同occurrence/insertedAt）、保留式merge完整日期/附件/未知字段/revision、未知格式/版本/节点/属性、canonical与部分阅读投影拒写、本地body.format兼容、实际时间戳与第二次保存版本、空draftOnly ACK及本地不支持信封0写入。定向ESLint、Prettier和JS语法检查通过。

产物：`outputs/2026-10-18-android-content-contract/editor/verification.json`、`readonly-unsupported.png`；临时：`tmp/android-content-contract-010/editor/verify.mjs`。没有读取真实库，没有设备操作或构建安装。native DBv3字段、资源路由、共享模块复制和正式集成由对应主会话另验。
