# 自动输入高度与简化工具 ui7 · 2026-10-16

用户反馈空输入框保留过高尺寸，希望文字增多先向上增长一段，超过上限后内部滚动，仍可拖动调整；随后明确删除输入框左侧放大、AI处理和附件按钮，保留图片／视频粘贴和拖入。

## 复现与实现

旧ui6在遗留280px偏好下空输入框仍实际占280px，证据outputs/2026-10-16-自动输入高度/baseline-ui6.json。新逻辑不读取旧高度作为最小高度，旧字段保留；新增浏览器本机shiye-input-cap-v2，仅保存自动增长上限，不进入日记或消息格式。

默认自动增长上限160px，同时不超过可用视口55%；空／短文本按字号显示紧凑高度。拖动立即调整当前高度并保存后续上限，清空、发送或切换会话解除临时固定高度；双击拖动条或聚焦后按Home恢复默认自动高度。正文在上限内增长，超限由外层input-scroller滚动，内层编辑器不重复裁切。

最新消息原本在底部时，随输入框高度变化保留尾部可见；用户滚轮／触摸回看历史后取消跟随。文字大小沿用原每屏记忆；手动输入高度上限为本机profile偏好，受当前窗口约束。

拾页主题下三个左侧按钮display:none，不占位也不进入Tab顺序；保留表情、发送／语音和顶部高度拖动条。媒体粘贴与拖入沿用现有独立事件处理，不依赖附件按钮；/图片仍可选择图片或视频。

## 验证与运行状态

本轮需求对应U25和U26。candidate原生宿主实际加载20261016-ui7；native-ui-check-final.json有217项聊天检查、10项独立图片检查，errors和runtimeErrors为空；npm run check通过，388项项目测试。正式已启用ui7；下次会话应先查询维护CLI的status，以最新回执为准。

宽1164px和窄784px视口均测得空／一行40px、三行93px、长文160px；继续输入不再增长。用真实指针向上拖动96px、向下32px及真实滚轮，检查临时手动高度、清空、Enter发送、切换会话后恢复自动，并保留新上限。检查100%／124%／200%字号的提示／正文显示、移除按钮无布局矩形及左侧圆角内边距；增高不遮最新消息，回看历史不被拉走。

使用生成PNG和1秒H.264 MP4样本，分别派发携带真实File的paste及dragenter/drop事件，经实际应用处理器到确认弹窗；预览图像／视频解码成功，四条路径取消后原文字仍在。原MediaRecorder样本先后遇到WebM不属于当前媒体预览支持类型、MP4录制无有效数据，失败报告保留；最终改用ffmpeg生成有效MP4，不把样本失败算作UI通过。复现命令：`ffmpeg -f lavfi -i testsrc2=size=320x240:rate=12 -t 1 -an -c:v libx264 -pix_fmt yuv420p -movflags +faststart -y tmp/telegram-preview-20261015/composer-media.mp4`，然后候选EXE加`--verify --verify-ui`。

已逐张查看composer-compact.png、composer-capped.png、composer-manual.png：三个左侧按钮已消失、短输入紧凑、长输入封顶、手动拖高有效，文字距左侧圆角留白。delivery-manifest-ui7.json封存候选与证据SHA-256，verification-source保留验收脚本、宿主源码和生成视频样本。清单生成时installed:false只表示封存时状态，正式结果以运行回执为准。

原生日常profile和真实草稿不参与修改性验收。生成的媒体事件仅用于隔离浏览器真实处理链，不等于系统资源管理器拖入或系统剪贴板的完整硬件验证；真实多屏仍需补测。

首次正式切换2026-10-16T15-25-39-223Z-e2ee9929在备份期间检测到新后台PID60148（资源管理器启动），主动中止替换，实际仍ui6。保留upgrade-cancelled-result.json、upgrade-cancelled-error.json和status-after-cancel.json，程序备份已保存；未强杀、未跳过检查，继续使用标准流程重试。此项是并发启动防护触发，不能当作安装成功，也不是审批拒绝。

重试2026-10-16T15-28-09-441Z-3e1baf12已完成保存退出、程序与偏好快照、安装和重启。status-after.json显示普通聊天PID58532、托盘PID58948，实际回执20261016-ui7、ready:true；正式API仍0.9.20，文字124%、每屏档案协议1保留，原F盘数据/profile原位。installed-file-verification.json确认12215个安装文件SHA-256全部匹配。备份位于outputs/desktop-maintenance/backups/同名目录。运行版只核对身份／修订与文件，不改真实草稿作编辑验收。

产物和日志：outputs/2026-10-16-自动输入高度；临时交付／哈希脚本：tmp/ui7-delivery.mjs、tmp/ui7-verify-installed.mjs；生成视频及隔离profile：tmp/telegram-preview-20261015。所有会话继续积极维护需求、实现、验证和运行交接文档。
