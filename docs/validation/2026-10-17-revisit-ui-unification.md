# 朝花夕拾 UI 统一验收

本轮以已验 ui22 冻结前端为底，只接入朝花夕拾相关前端；构建、原生桥与正式维护由主会话管理。ui23 UI 已标准升级并启动，正式朝花夕拾后台未部署、推送未启用。产物位于 `outputs/2026-10-17-revisit-ui-unification`，浏览器脚本与隔离数据位于 `tmp/revisit-ui-unification`。

## 正式 UI 运行回执

主会话标准 upgrade 已完成 installed/restarted:true，修订 `20261017-ui23`；备份 `2026-10-18T00-59-21-246Z-1ef47981`。`status.json` 的 native-runtime-receipt 于 `2026-10-18T01:00:35.8812736Z` 确认 ui23 ready，聊天 PID8312、托盘 PID38012 仅为该时刻快照。`installed-verification.json` 于 `01:00:42Z` 核对全部 12219 安装文件 SHA-256 通过；`runtime-after.json` 确认真实日记 SHA 不变，868×1649、116% 字号及两个显示屏档案保持，不能沿用旧108%描述。

验收范围为 42 项浏览器证据（39 项明确复用＋末次3项可读性定向），13 项原生按原包及精确 EXE/JS 哈希复用，10 项图片检查为旧证据复用；不是整套重新测试。API 仍为 0.9.24 且未重启，health.revisit 未提供能力。此次只安装 UI 和固定桥，不部署后端、不修改正式推送配置或启动运行器；历史日回看/评论/来源链路的实际能力仍来自隔离服务验收，不能写成正式推送已启用。

## 实现

历史来信在首次 Message 渲染时取得专用外观 class，与本人消息共享既有视觉变量和元数据颜色；不改变 outgoing、sender、来源、时间或送达状态。布局方向、头像占位、删除方向继续沿用原消息语义。系统日期提示消费既有 notice/readNotice/clear，显示于当前视口上方约 4 秒；它不占消息流，不强制滚动，普通同步不重启计时。本机日期偏好先于后台 status 加载，后台不可用时仍可修改；明确“刷新回看”沿用已有 refresh。

## 浏览器证据

v1 使用真实候选 app、隔离 HTTP 日记服务及本地 worker。全部 12219 程序文件 SHA-256 核对通过，程序清单 SHA 为 `988f612910ce298967d401ab5eafc39c0533c3765dcffbcdaa84e3d8645336a1`。

`browser-validation-ui23-v1.json` 保留原始失败结果，SHA 为 `65198ba79ef4ac3f6cffa81bfb2e08c9cae35cb2f51edae2592d7d55b8a6f202`。其中 25 项已通过：默认深色与浅色/反向/透明度/留白组合的文字背景、宽度、阴影、时分颜色；真实未引用发送绑定最新单条、显式引用绑定所选消息；来源菜单；满屏 16 条历史底部的可见提示、普通同步不重复、4 秒隐藏、明确刷新复用节点、日期/隐藏偏好及断网本机设置。原检查名称中的 false/true 是组合偏好参数，并非失败/成功状态。

v1 新增媒体检查未通过：实际图片元素四角一致，但 media-inner 仍受左右分组圆角影响。历史中间组为 `[6,15,15,6]px`，本人独立组为 `[15,15,0,15]px`；组条件也不同，不能由此直接宣称同组差值。已按审阅意见将 own 分组圆角与历史外观共享，并仅排除历史来信的 incoming 圆角分支；本人行为及其他 incoming 不变。补丁 `Message.scss` SHA 为 `ca203375c7c7e9d3340bd1daee1bdf37a71a87b7ec6b7f94d37b7f1cab2c406b`，定向 stylelint 0 错误、9 条原有警告。v2 只重验实际图注、媒体裁切/四角、相同分组条件及受影响文字圆角，复用未变功能的 v1 证据。

## 边界

同一 browser context 先加载 ui22 再加载 ui23，保留 IDB/localStorage，核对 wrapper/client/view 的真实响应 URL 与 SHA。Playwright 路由会禁用 HTTP 缓存，因此本轮不宣称真实命中旧 HTTP 缓存。日期换日消费者使用合成事件验证，不等待墙钟跨午夜。原生窗口、真实用户 profile、正式后台启用与部署由主会话另验；没有修改正式日记。

v2 候选清单 SHA 为 `ceaa867d5e01c2ed9c097d70b8c3beede775e3b6fcd758ab063bb46c0ff07c16`。`media-validation.json` 的 13 项通过，其中 4 项为框架/样本核对，9 项为新增定向检查：首个可见帧已带历史外观 class；相同图片与真实图注在匹配的中间/首条/末条/独立组条件下，媒体元素、内层裁切、正文四角、背景与图注颜色相同；默认/组合偏好图注保留且 16/20px 字号实际生效；Markdown 文字圆角与行高相同。分组条件检查临时给实际渲染节点设置相同 first/last class，读取后恢复原 class，未修改消息数据或 own 语义。

截图复核另外发现 top72px 的系统提示被上游浮动时分覆盖，不能把原“可见”几何检查视为视觉完成。旧聚合另存 `browser-validation-pre-visual-review.json`，发现时曾将最终回执标为待修。经主会话确认，仅把提示 top 改为 112px，共享与 public CSS SHA 一致为 `bec56f4801378e9c81d81da344225ec90aaffcef3b0755e85990ef4413c86d2d`，由主会话静态封包，不重跑 Vite。

release 全部 12219 文件 SHA 核对通过，程序清单 SHA 为 `e7ce4726f249b906c681c2b70ce293f425840670b657fe18eb0c26d82931797a`。与 v2 仅 CSS、入口缓存 query、UPSTREAM 元数据三文件不同，EXE 与全部 JS 不变。`notice-clearance.json` 的 8 项通过，其中 2 项为框架/样本核对、6 项为新增位置检查；满屏底部的浮动时分 bottom92.78px、提示 top112/bottom136.80px，矩形不相交；提示位于视口内并居中，scrollTop2577px 保持。已实际查看 `notice-release-clearance.png`，原 notice visible 结论被此位置及截图复核替换。

位置 release 阶段的聚合回执另存 `browser-validation-position-release.json`，SHA 为 `7ae6650c31bc1deebd40743e8cd681cf847861e14676c23334141cf0121c3252`。它明确列出 24 项 v1 复用、9 项媒体/文字定向、6 项 notice 定向，共 39 项；不把 v1 原失败报告改写为全部通过，原始失败和修复过程均保留。

最后截图审阅发现提示背景仍透出底下长文，影响辨识。仅将 notice 改用正常正文色、不透明 secondary 背景与轻阴影，保留 top112、大小及定位；共享/public CSS SHA 为 `a4e3e1c1cd3e851e9a04cd767eafc37f036d570f8c846970d599b6348958628c`。静态封包为 `candidate-ui23-readable`，清单 SHA 为 `f16e77441dd55117a7dd3c8b2ae8b913ae79d0a7733102c1316b63ddfc15915a`，EXE/全部 JS 与位置 release 保持，只变 CSS、入口缓存 query、UPSTREAM。

可读性定向仅核全部文件哈希后读取样式和截图，未重跑既有 39 项。`notice-readability.json` 的 5 项通过（2 项框架、3 项可读性/运行检查）：背景 `rgb(23,33,38)`，alpha1；正文 `rgb(227,236,238)`；元素 opacity1。实际查看 `notice-readable.png`，确认文字不再与底下长文透叠，位置/尺寸不变。

最终 `outputs/2026-10-17-revisit-ui-unification/browser-validation.json` 为 passed:true，绑定 readable 程序清单，回执 SHA 为 `fed90fa2e1081ae02ad4f4339ee4a364865dcecac8dd4f5a552bff59dedc5d83`；明确索引此前 39 项复用及本次可读性回执。未重跑整库或无关矩阵。浏览器和自建 HTTP 服务均在 finally 正常关闭，测试未接触日常 profile 或正式日记。随后主会话完成正式 UI 升级，见顶部运行回执；后台仍未部署或启用。
