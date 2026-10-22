# 拾页便签 UI5：自然层级、同背景目录与折叠手感

日期：2026-10-17。用户要求先调研成熟UI，再优化折叠的外观/点击/动画；目录可选常驻、与标签同层并共用背景；用中文与自然缩进表达任务归属。

## 调研与设计决定

- [VS Code折叠/缩进](https://code.visualstudio.com/docs/editing/codebasics#_folding)：在正文左侧gutter放折叠控制，按较深缩进确定子范围；本轮沿用这种明确的空间层级，不按中文语义猜上下级。
- [VS Code布局](https://code.visualstudio.com/docs/configure/custom-layout)：可显示/隐藏侧栏并记住布局。本轮用同一body布局的停靠目录，和标签/状态栏齐层，1px竖线分隔、共用窗口背景；图钉切常驻，拖分隔线调宽，窄窗覆盖显示保持正文宽度。
- [Obsidian折叠](https://obsidian.md/help/folding)：标题和缩进列表可通过左侧箭头折叠，折叠后保留入口。本轮换为SVG细箭头，折叠状态持续可见，不用字形三角制造正文字符。
- [W3C目标尺寸指引](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)：小图标仍需足够点击面积。本轮12px图标对应26×26px命中区域；只保留轻背景和明确焦点态。180ms收展与160ms箭头旋转是本项目的短过渡选择，非上述资料要求的固定数值；系统减少动态效果时即时切换。

## 实现

- 新 `notes-smart-indent.js` 仅装配独立便签。普通段落 Enter 精确保留既有半角/全角/Tab前缀；末尾冒号(:/：)后Enter新增两全角空白；空缩进行Enter原地减少一级。Tab/ShiftTab调整整段/选中多段缩进，撤销恢复原文。标题源码/原生标题、列表/任务、代码/表格、媒体、IME、组合键与ShiftEnter交既有路径；设置可关闭自然缩进。
- 目录新工作台默认“智能层级”，已有显式目录模式保留。连续段落组中出现缩进意图时，目录包含该组全部非空根/叶任务；纯无缩进散文不全量塞入目录。中文只是任务名，层级以空白及原生列表结构为准，不新增权威正文或隐式H级别。
- `notes-structure.js`仍用PM decorations折叠，持久折叠状态立即更新，动画结束才隐藏；反向点击衔接当前视觉高度，编辑/定位/销毁会取消过渡并清理；超长段落组（80节点以上）和不支持WAAPI的宿主即时切换。SVG按稳定blockId复用同一DOM节点，实时同步状态与标题，让旋转真实过渡而非重建闪换。
- `notes.html`目录移为body直接子元素，`outline-pinned`宽屏grid包含标签到状态栏；侧栏/标签/状态栏透明共用背景，取消常驻或窄窗为无阴影覆盖模式。图钉、宽度、目录模式仅UI快照偏好，不是正式便签schema。
- 目录行按blockId复用，保留悬停/焦点/旋转；跟随光标或正文滚动更新当前项，并确保长目录当前项可见。拖分隔线调宽；分隔线焦点内的左右方向键是该控件的标准调整操作，不增加全局或便签组合快捷键。

## 验证与运行

- `notes-smart-indent.test.mjs` 9项实际PM键处理：中文/英文冒号、前缀延续/分行、空缩进退级、多段Tab及撤销、禁用/IME/native列表/图文边界。
- `notes-structure.test.mjs` 9项：既有六级标题、缩进/任务结构及媒体保留；短动画终态、快速反向、减少动态效果、稳定SVG及标题属性同步、独立根叶任务保留。
- `npm run check`完整通过：564项测试，0失败/跳过，文件检查、ESLint与全库格式检查通过，日志 `outputs/notes-ui/project-check-ui5.log`。
- Chrome UI5专项与原30组回归由 `tmp/notes-ui/natural-docked-motion.mjs` 执行。旧模式断言通过显式选择“仅标题”/关闭自然缩进运行；原正文精确比较仍保留，动画后的终态等待180ms过渡完成。最终分组回执及截图以 `outputs/notes-ui/ui5-*.json/png` 为准。
- 最终Chrome共43组通过（新增13、原回归30），无JS异常/正式API写入。实测32.30px子段落在45ms降至11.13px，完成后隐藏；快速三连反向后恢复原高、无残留动画；少动态立即切换，body与图片8字段精确相同。目录45项滚动跟随/切标签恢复通过。发现窄窗目录遮挡设置后已修为标签栏下方44px展开，并用真实点击复验设置/图钉/关闭可达；宽屏仍与标签齐顶。截图已人工查看，初轮不存在assetId的夹具被保存保护正确拒绝，已改为实际上传虚构PNG；未绕过存储保护。
- 常规保存关闭/profile快照/标准入口重开后，记录实际PID、原生编辑/保存状态及源码哈希于 `runtime-ui5.json`。真实物理IME候选、多屏和长期运行不由浏览器/合成composition证明。
- 实际启用：已保存的PID23268通过正常Alt+F4退出，确认无该EXE进程后复制profile到 `var/notes-ui-upgrades/ui5-profile-20261017T103627Z`，标准入口打开PID36180。原生回读有正文、目录入口及已保存，无保存错误；复用静态服务79828。主API只读health与package均0.9.24，本轮未重启主API/随想/托盘。主题引用同步后F盘规范20主题校验通过。

产物 `D:\拾页\outputs\notes-ui`，临时脚本/虚构数据 `D:\拾页\tmp\notes-ui`，私人profile和快照保持在 `var/notes-ui-preview`、`var/notes-ui-upgrades`；本轮不重启聊天/托盘/后端、不读写正式日记或个人便签正文。
