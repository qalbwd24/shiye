# 拾页便签 UI3：Markdown 实时预览

日期：2026-10-17。用户要求：编辑时能看见并修改 `#` 等源码，换行或离开后才渲染，类似 Obsidian 实时预览。

## 实现范围

- 新增 `public/editor/notes-markdown-preview.js` 与独立CSS，只给便签装配。当前文字块保留源码，其他块通过PM decorations隐藏语法/呈现标题与行内样式；原始标记仍在文字节点里，是同一份权威内容，不建立另一个可编辑正文。
- 支持基础ATX标题、粗体、斜体、删除线、行内代码、链接/高亮/引用的呈现。代码、转义、图片和任意HTML不被错误当作可执行预览；不请求外部图片。多块选区保留全部源码，合成中文组合期间只映射已有装饰、结束后重绘。
- 既有富标题/常见文字格式，仅在选中编辑且字段可逆时转换对应单块，保留blockId；链接/下划线/未知属性的旧富块保持原样，不静默丢弃。图片/视频、排版、资源身份/出现身份和插入时间不参与整篇Markdown往返。
- rich-document-editor factory增加默认true的enableInputRules/enablePasteRules可选项；便签保留列表输入规则，禁立即吞掉Markdown标记的规则。其他使用方默认不变。vendor只重导现有PM Decoration/DecorationSet并用已锁定依赖重建，未升级依赖，保留许可证。
- 源码/展示不互相覆盖；解析结果按不可变PM Node用WeakMap缓存，避免每次移动光标重新解析整篇。正式便签数据格式仍未确定，此阶段只作为独立UI快照。

## 已通过隔离验证

- `tmp/notes-ui/live-markdown.mjs`：9组，零JS异常、零API写入。真实逐键输入 `# Heading` 保留源码；Enter后前块有标题样式；返回可改成二级；行内加粗/斜体/反引号/删除线；代码/转义保护；撤销重做；切标签/刷新后body相同；合成composition保护；旧标题/加粗保留blockId与图片8字段/旧链接；编号/Tab/ShiftTab/任务勾选回归。
- `tmp/notes-ui/outline-background.mjs`：9组全部复跑通过，含数字/任务混合层级、空项退出、ShiftEnter、背景原图/透明度/模糊/填充/位置/重开/移除，清背景后正文图仍在，400px窄窗无横向溢出。
- 结果 `outputs/notes-ui/live-markdown.json`、`outline-background.json`；已查看 `live-source.png` 与 `live-rendered.png`，均为虚构验收文字，不是用户私人便签截图。
- 定向ESLint/Prettier及rich editor离线bundle构建通过。`npm run check`的文件依赖检查（268模块、0错误）与ESLint通过，在其他会话文件 `previews/telegram-chat/verify-ui.js` 的Prettier告警处停止；本轮没有覆盖其改动。单独 `npm test` 全542项通过（0失败/跳过），日志 `project-check-ui3.log`、`tests-ui3.log`。不能把格式告警所在的全流程称为已通过。
- 更新前确认原便签窗口已关闭、没有该EXE进程；在 `ui3-profile-snapshot.json` 指向的私有目录备份独立profile，使用正常启动入口打开新版PID37072，静态服务PID79828复用。最终原生回读有正文编辑器/格式入口及已保存状态，无保存错误；实际PID/源哈希见 `runtime-ui3.json`，下次重新查询。

## 验证边界

- 以文字块为活动源码范围；Shift+Enter仍在同一块内，不承诺逐物理显示行分别切换。编号/勾选列表继续保留真实结构，不是整篇Markdown源码模式。
- 本轮不是完整Obsidian语法实现，不新增全文源代码切换、跨块围栏代码解析或有损媒体转换。未知富格式保留原编辑路径。
- 中文只验证浏览器文字输入与合成composition事件，不能等同物理输入法候选窗完整验收；真实多屏、长时/异常退出仍留后续。

参考：[Obsidian 编辑与预览模式](https://obsidian.md/help/edit-and-read)，2026-10-17核对。

产物 `D:\拾页\outputs\notes-ui`，临时脚本与虚构数据 `D:\拾页\tmp\notes-ui`；源码改动前备份见 `ui3-source-snapshot.json` 指向的 `var/notes-ui-upgrades` 私有目录。
