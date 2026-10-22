# 思绪灰色原生边框与窗口记忆核查

2026-10-17 用户要求思绪和便签使用灰色边框，参考随想的中性灰窗口框架；本记录只涉及思绪宿主这一部分。思绪继续使用标准系统标题栏、系统缩放和关闭行为。

## 源码实现

`desktop/QuickCapture.cs` 的 `ApplyTitleTheme()` 在已有深浅色标题栏提示之外设置 `DWMWA_BORDER_COLOR`（34）与 `DWMWA_CAPTION_COLOR`（35）。浅色边线为 `#b8bcc0`、标题栏为 `#f2f2f2`；深色边线为 `#5d6266`、标题栏为 `#292d30`，后者与随想的窗口框架背景一致。边线颜色显式固定，避免激活窗口时继承 Windows 强调色。旧系统不支持这些属性时保留系统窗口框架。

未改正文、保存队列、快捷键、API、原生关闭协议，也没有引入 Mica/Acrylic 或把 CSS 背景误称为系统桌面毛玻璃。

## 实际记忆范围

- 尺寸与位置：`quick-window.json` 保存正常窗口矩形；最小化或最大化时取 `RestoreBounds`，下次恢复正常矩形。没有额外保存最大化状态。
- 置顶与界面缩放：同一文件保存 `TopMost` 与 `ZoomFactor`（0.5–2.5）。缩放意图立即写入；并发窗口写几何时保留尚未被本窗口修改的最新缩放值。
- 字体：独立正文、标题字号、字重和行距经 `/api/preferences` 保存到 `preferences.quickAppearance`；勾选继承时跟随主页文字配置。它和原生界面缩放是两个不同设置。
- 多窗口与多屏：同一运行档案的窗口共享这一个几何设置，最后写入者决定下次新窗位置；新开的多个窗口错位显示。现实现不提供随想那种每块显示屏独立档案。重开或显示设置变化时，用 `FitBounds` 将矩形限制在当前所选屏幕工作区，防止窗口落在屏外。
- 置顶入口：当前思绪仍在“窗口设置”中的 `quickWindowPin`；本灰边补丁没有移动它或添加快捷键。

## 验证与运行边界

隔离候选输出到 `tmp/notes-ui/quick-frame-check/QuickCaptureFrameCheck.exe`，依赖也仅复制到此临时目录；使用同一 .NET Framework C# 编译器及 WebView2 引用编译通过，`--self-test` 返回 0。该自检覆盖 URL 隔离、窗口矩形/错位、关闭闸门及既有宿主设置兼容；未打开 UI，也未替代真正的 Windows 渲染验收。

`node --test tests/quick-capture-window.test.mjs`：4/4 通过，覆盖新篇分类选择、编辑 MRU/光标与滚动恢复、保存失败时阻止导航及后台编辑焦点恢复。

本子任务没有覆盖正在运行的 `拾页快捷记录.exe`，没有重启任何窗口。实际 DWM 激活/失活颜色、实际显示屏与 DPI 切换须由整体升级验收补充。思绪构建入口为 `tools/build-quick-launcher.ps1`；`tools/build-launcher.ps1` 只生成主页启动器。整体升级应使用项目已有维护入口，在确认保存并创建快照之后进行。

临时 EXE 的 SHA-256：`0EE4B3F50C909B53599E22416229ADF66F7A1B709AF355091D41B07DD6C5033C`。

## 整体维护回执补充

上述“未部署”仅为子任务结束时状态。随后重新核对随想ui10已完成，使用标准desktop-control stop正常保存退出，保存旧EXE/config至 `var/notes-ui-upgrades/ui6-thoughts-gray-20261017T110125Z`，安装隔离构建候选并校验SHA-256一致，再用标准start启动。安装EXE哈希为 `A060E13B029E7980FDFE3BC0ED67551875F5489B527A5380D56A5C9A19A3C84B`。回执为 `outputs/notes-ui/thoughts-gray-{install,start,stop}.json`。

最终只读状态：思绪/托盘PID76288、随想PID69500，随想仍20261017-ui10且ready:true，API仍0.9.24；这些PID为此时快照。未改随想安装内容、正文/正式数据或重启API；思绪灰边已进入运行EXE，但没有额外打开真实思绪编辑窗核验激活/失活颜色，不把DWM设置代码与编译视为视觉验收。最终统一回执见 `outputs/notes-ui/runtime-ui6.json`。
