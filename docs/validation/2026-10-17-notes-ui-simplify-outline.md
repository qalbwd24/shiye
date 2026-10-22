# 拾页便签 UI2：精简、背景与任务层级

日期：2026-10-17。范围：用户本轮确认的简单便签界面与 Obsidian 式步骤组织；正式内容格式仍未确定。

## 实现

- 顶部合并为一行标签及少量入口；格式菜单默认收起，保留编号/待办/图片等工具。移除“随手记”、编辑时刻、底部试用说明，成功保存显示小勾，失败提示仍可见，试用数据范围说明移入设置。
- 输入 `1. `使用既有编辑器输入规则开始orderedList，回车续项；便签按最近的listItem/taskItem处理Tab/Shift+Tab，存真实嵌套结构。空项回车退出一层，Shift+Enter保持同项换行。任务/普通列表混合时不错误缩进外层父任务。
- `notes-background.js`独立管理壁纸，复用项目现有原图签名识别，支持20MiB本机图片、透明度、0–20px模糊、cover/contain/tile、位置及移除。图片Blob与背景引用随试用工作台原子保存；壁纸不进入正文或正文图片统计。并发选择按序号处理，读取期间阻止误关闭，缺失原图保留引用并报错。
- 没有引入新依赖、正式便签schema或存储API，未修改日记/聊天入口。参考 [Obsidian 官方说明](https://obsidian.md/help/syntax#Lists) 与本地快捷窗外观实现；只借鉴编号/嵌套等交互。

## 验证

- 最终 `npm run check` 全流程通过：文件依赖、ESLint、全库格式与534项测试全部通过（0失败、0跳过），日志 `outputs/notes-ui/project-check-ui2.log`。此前首版两项其他模块失败是历史快照，不作为当前全库结论。
- 编号/背景专项最终9组通过（含任务父项内编号子项只操作最近层级，编号marker保持list-item）；3项原子快照测试通过，便签新模块定向ESLint/格式通过。

- 原7组便签Chrome隔离流程回归通过，字数、待办、图片/原件恢复、多标签/光标/关闭重开、窄窗、主题/缩放及无API写入保持。
- 新隔离脚本 `tmp/notes-ui/outline-background.mjs`：逐键输入1.、Enter/Tab/ShiftTab和刷新结构；ShiftEnter；空项退出；待办嵌套；普通段落Tab；背景上传调节/Blob恢复/清除及正文图保留；简洁布局与400×600窄窗；零脚本异常与零数据API写入。完整结果见 `outputs/notes-ui/outline-background.json`。
- 已打开查看 `simplified.png`、`nested-list.png`、`nested-list-narrow.png` 和 `background-narrow.png`：标签栏紧凑、层级引导线可见，背景不阻断正文编辑。图片和文字均为虚构验收内容，未复制用户日记。
- 原生当前profile通过正常Alt+F4保存退出，确认旧PID28756已退出；在 `var/notes-ui-upgrades/ui2-20261017T094156Z` 保存profile及EXE快照后使用既有启动工具重开。首轮新PID58000，服务PID79828；实际窗口回读确认格式入口存在、旧元信息和试用页脚不可见、草稿已保存。后续PID见runtime-ui2.json。
- 最终最近列表祖先修订验收后，再次正常保存退出PID58000、保存 `ui2-final-snapshot.json` 指向的私有profile快照，并以同一正常入口打开PID34984，原18770静态服务PID79828复用。未新增额外隔离原生实例，最终运行回读见 `runtime-ui2.json`。
- 先前额外隔离原生窗口启动被自动审批拒绝的记录继续保留；本轮没有重试该隔离动作。当前正常保存退出/重开是用户已授权的既有试用窗更新，不操作其他会话进程。真实多屏、全部物理输入法、系统剪贴板来源及崩溃恢复仍未宣称通过。

## 产物

源码 `public/notes.html`、`styles/notes-workspace.css`、`features/notes-workspace.js`、`features/notes-background.js`。成品/截图/检查在 `D:\拾页\outputs\notes-ui`，临时脚本/虚构库在 `D:\拾页\tmp\notes-ui`，私有profile保持 `D:\拾页\var\notes-ui-preview`。
