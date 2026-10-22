# 聊天动画与等待时间修订 ui2

日期：2026-10-16。API／项目版本保持 0.9.20，本轮修改聊天宿主与本地资源，构建标识为 `20261016-ui2`，交付依构建哈希区分。

## 需求与实现

用户试用反馈：动画帧率低，离开收起等待太长，希望可调并缩短；Esc 切换等待加长。

- 离开默认 350ms，设置 → 全局快捷键与后台可调 100–3000ms，原生设置持久保存。旧设置没有此字段时使用 350ms。
- Esc 默认 1200ms，外观设置可调 400–5000ms。旧默认 800ms 只迁移一次，其他自定义值保留，之后仍可主动设置 800ms。读取与表单使用同一设置对象。
- 原路径除了 650ms 离开等待，还会先等前端 120＋500ms 保存握手，再开始动画。本轮贴边位移和保存同时进行；保持活窗口与 6 DIP 露边，保存失败恢复可见，保存中也接受露边悬停返回。
- 原 WinForms 16ms 定时器由动画期间专用高精度等待计时器替代，以 8ms 请求 UI 更新，最多保留一帧待处理任务。按 Stopwatch 时间定位，不积压过时位置；结束后停止工作线程与计时。普通等待检测为 40ms，实际触发允许增加一次检测间隔。
- 相同尺寸／DPI／窗口状态的布局跳过重复控件布局；动画过程中不重复启动设置保存防抖。240ms 时长、横向优先、露边和显示几何规则保留。
- 采用 Windows 高精度等待计时器；不支持时退回普通等待计时器，并仅在该次动画期间提高计时分辨率。依据 [CreateWaitableTimerExW](https://learn.microsoft.com/en-us/windows/win32/api/synchapi/nf-synchapi-createwaitabletimerexw)、[SetWaitableTimer](https://learn.microsoft.com/en-us/windows/win32/api/synchapi/nf-synchapi-setwaitabletimer) 和 [timeBeginPeriod](https://learn.microsoft.com/en-us/windows/win32/api/timeapi/nf-timeapi-timebeginperiod)。

## 实测

使用独立原生 WebView2 验收窗口、合成会话与隔离 profile；不向正式日记写入测试消息。最新 82 项聊天和 9 项独立图片检查通过，无 JavaScript 运行异常。

- 同一次运行比较旧调度与新调度：旧左侧收起／展开帧间隔中位数 25.67／25.33ms；新四边收起／展开中位数 8.40–9.29ms。此前一轮比较为旧 28.55／29.91ms、新 8.12–9.93ms。新调度增加窗口位置更新次数，不将该指标宣称为屏幕呈现帧率。
- 四边显式收起与展开、6 DIP 露边、越界纠正、中途反向位置连续和结束停止高频计时通过。
- 设置 150ms 后通过原生消息桥保存、重开设置恢复，上限 3000ms 纠正与恢复 350ms 通过；从实际原生设置文件反序列化回读 350ms。
- 向实际原生策略注入指针位置和已离开时间：阈值前不收起、忙碌时重置、保存未完成时动画已启动、保存中返回露边可展开通过。这是原生策略与保存联动验证，没有移动用户物理鼠标，不能代替真实悬停验收。
- 3 项新增单元测试执行实际设置代码：旧默认迁移、迁移后自定义 800ms 不再覆盖、自定义值重开、无效值及范围处理。

项目测试单独执行 303／303 通过；模块检查 197 个模块无错误，ESLint 通过。完整 `npm run check` 在全库格式检查停止，尚未通过：8 个本轮未修改的富文本实验编辑器文件有格式问题（public/editor/rich-document-editor.js、public/features/rich-text-lab-store.js、public/features/rich-text-lab.js、public/rich-text-lab.html、public/shared/rich-document.js、public/styles/rich-text-lab.css、tools/build-rich-editor.mjs、tools/rich-editor-vendor-entry.mjs）。未自动格式化这些其他工作文件；本轮相关文件单独格式检查通过。项目检查失败与单独测试成功的日志分别保留，不能将 303 项测试通过说成总检查通过。

证据目录：`outputs/2026-10-16-动画优化/`，包含旧版与中间调度报告、最终原生验收副本、项目检查日志及构建清单；原生验收写入 `outputs/2026-10-16-聊天UI优化/native-ui-check.json`。

## 运行状态与剩余验收

此前用户手动打开的 0.9.20 正式服务、聊天与托盘已确认从 D 盘运行，继续使用 F 盘日记和原聊天 profile，见 [入口回读](2026-10-16-desktop-entry-switch.md)。

本次用户选择“暂时保留窗口”，因此 ui2 仅在 `outputs/2026-10-16-动画优化/candidate/` 完成构建和隔离验收，未替换正在使用的普通聊天宿主，也没有重启正式后台。服务代码未改，不需要仅为此 UI 修订重启日记 API。后续用户正常退出聊天后台后再安装宿主／资源并重新打开；不得把此次隔离运行记为正式窗口已更新。

仍待用户实际试用动画观感、物理鼠标离开／返回、快捷键与真实双屏／跨 DPI／插拔。原 U01–U17 其余视觉缺口见 [逐项自检](2026-10-16-chat-ui-self-audit.md)。
