# Android 真实 WebView 实时样式预览

2026-10-19 用户说明：127.0.0.1:19384是开发用“样式控制面板”，实际效果在模拟器的拾页App里看。开发者保存支持页面的CSS后，App原位更新，无须每次重装；原生页面/Java/功能变更仍需重新构建。网页右侧只在点击“手动截取”时显示截图，目前不是实时投屏，也不是浏览器内可操作的完整App；普通测试直接操作手机/模拟器，无须操作JSON、hash或CSS参数。019已支持基础editor.css叠加ui-refinement-019/editor.css，QQ独立iframe/shadow的view.css同步注入，参数写回仍只针对基础文件。设备仍绑定emulator-5554，不会因手机已连接就自动切换。

2026-10-17：工具初版已实现；主会话已在真实 AVD 验证临时颜色应用与恢复、style 节点始终为 1、`performance.timeOrigin` 和会话 sentinel 不变，回执见 [live-preview-proof.json](../outputs/2026-10-17-android-ui-preview/live-preview-proof.json)；数值 token 也已验证头像实际尺寸 50→54→50px、节点仍为 1、页面未重载，见 [live-size-proof.json](../outputs/2026-10-17-android-ui-preview/live-size-proof.json)。尚未手机实测。本工具不需要重装 APK、不重载页面，不访问正文、数据库、草稿或业务偏好。

## 启动

在 `D:\拾页` 使用 Node 22.13 以上版本。ADB 已在 PATH 时可省略 `--adb`，也可用环境变量 `ADB` 指定完整路径。必须显式给出设备序列号，工具绝不默认选第一台设备。

```powershell
node android/tools/live-preview/preview.mjs --help
node android/tools/live-preview/preview.mjs --serial emulator-5554 --adb D:/codex-tools/android-sdk/platform-tools/adb.exe --once
node android/tools/live-preview/preview.mjs --serial emulator-5554 --adb D:/codex-tools/android-sdk/platform-tools/adb.exe --port 19384
```

先手动打开指定设备上拾页的随想或思绪编辑页，再打开终端显示的 `http://127.0.0.1:19384/`。省略 `--port` 时分配随机回环端口。`--package` 默认 `dev.shiye.app`。`--once` 只检查包可调试状态、PID/socket 和匹配页面，列出源 hash 后撤销自己的端口转发；不注入、不启动控制页。无匹配页时返回非零退出码。

控制页显示设备、包名、连接页面路径、源码 hash 和实际注入 hash。页面 URL 的查询参数和正文不进入状态或日志。每秒重新发现本包 WebView，页面切换、重建或 App 手动重启后自动重新附加；不启动或终止 App，不执行 reload。错误和等待原因显示在状态区域。

## 编辑流程

直接编辑以下两份源码，保存后约 0.4–1.5 秒会原位更新正在打开的对应页面：

- `android/telegram-adapter/android-chat.css`：随想 WebView。
- `android/app/src/main/assets/editor.css`：思绪编辑 WebView。

工具只读取此白名单；不存在任意文件读写接口。DOM 中唯一 `shiye-android-live-preview` style 节点记录随机会话 owner 与源 SHA-256。相同会话复用节点，重复连接不会叠加 style。其他预览会话已占用页面时明确拒绝，避免互相覆盖。

控制页可调整源码第一个 `:root` 中已有的十六进制颜色变量，以及下列明确白名单中的整数像素值。颜色使用支持透明度的十六进制文本框；尺寸使用带上下限和步长 1 的数字输入框，显示 px，提交时由工具补单位并再次校验，不把尺寸当颜色处理。只展示当前源文件中已有的变量。

| 变量                        | 范围    |
| --------------------------- | ------- |
| `--body-size`               | 8–40px  |
| `--shiye-list-avatar-size`  | 40–56px |
| `--shiye-list-title-size`   | 14–22px |
| `--shiye-list-preview-size` | 12–18px |
| `--shiye-list-time-size`    | 10–14px |

点击「应用临时预览」只修改注入 CSS，不保存 App 偏好。只有显式提交的临时变量覆盖会追加 `!important`，以便预览值优先于 App 通过普通内联样式设置的偏好（例如思绪字号 `--body-size`）；整份源码 CSS 不会被批量加上 `!important`。点击「清除临时参数」会移除这些临时覆盖，重新由当前源码和 App 原有偏好决定外观，不改动内联样式或 App 偏好。源码发生变更后会丢弃该源旧临时覆盖；点击「刷新状态」重新读取字段后再操作。工具自身的 JS/控制页有更新时需要退出并重启工具，随后重新打开控制页；不需要重启 App。

「保存这些参数到源码」需要用户明确点击并确认，只替换该源第一个 `:root` 中已有变量，不新增字段。提交携带读取时的源 SHA-256，写入前再次比较实际文件；检测到并行编辑则拒绝，提示 CAS conflict。保存后仍需正常构建发布，当前预览不等于安装包已更新。多代理并行编辑同一文件时优先直接改源码，避免同时进行控制页保存。

保存源码不保存临时 `!important`，也不修改或覆盖 App 的显式参数。已设置的 App 字号等偏好可能仍优先于保存后的源码默认值；希望持久改变字号，应使用 App 内的排版设置，不能把「保存到源码」理解成修改 App 设置。

「手动截取」只在点击时通过 CDP 抓取当前真实 WebView 可视区，结果在控制页内存显示，不自动写文件、不写截图日志。页面可能含个人内容；需要留证时人工保存至 `outputs/2026-10-17-android-live-preview/`。截图不包括原生窗口、系统栏或其他原生页面。

## 暂停与退出

「暂停预览」删除本会话 style，恢复安装包原有 CSS；再次开启应用当前源码。「退出工具并恢复包内样式」或终端 Ctrl+C 会删除已连接页面上的本会话 style、关闭 CDP、移除自己通过 `adb forward tcp:0` 创建的端口，不动已有转发。终端明确报告清理失败；设备离线时可能无法完成清理。强制结束进程/断电无法执行退出钩子，此时重新打开对应 WebView 可清除残留文档注入；工具不会为清理而擅自重载或杀 App。

服务仅监听 `127.0.0.1`，校验 Host；修改/截图/停止等 POST 要求同源 Origin、本次随机 token 和 JSON。无任意 JavaScript 控制台、无 App 业务调用接口。通过 `run-as <包名> id` 只读确认可调试，再使用本包 PID 对应的 DevTools socket；仅连接 `https://appassets.androidplatform.net/telegram/index.html` 或 `/editor.html`，拒绝远程调试地址与其他页面。

## 边界与验证

原生列表、会话设置原生页面、系统栏、Java、桥接行为和 HTML/JS 修改仍需正常构建安装。本工具只是现有 WebView 的 CSS 迭代入口，不是全 App 热更新，也不证明帧率、后台行为或安装数据完整性。

本地验证入口：

```powershell
node --test android/tools/live-preview/core.test.mjs
node node_modules/eslint/bin/eslint.js android/tools/live-preview/*.mjs
node node_modules/prettier/bin/prettier.cjs --check android/tools/live-preview docs/ANDROID-LIVE-PREVIEW.md
```

5 项测试覆盖目标/调试端点白名单、参数 CSS 注入拒绝、实际生成注入表达式的单节点复用/owner 拒绝/撤销/页面变更、文档重建重注入及 CDP 请求断线清理；另实际启动本地控制服务器（明确使用不存在的 ADB 路径，不连接设备），验证外站 Origin/缺失 token 拒绝、非法源拒绝及正常停止清理。它们不替代实际设备的连接、截图和页面切换验证。仅新增开发工具，不改 Android 产品资源、Gradle 或安装包；不要求为此重新安装 App。

尺寸参数补丁新增第 6 项局部测试，覆盖五个尺寸 token 的上下界、越界、小数、非 px 单位、颜色混入和 CSS 注入拒绝、解析/回写与输入控件元数据。临时覆盖补丁再新增第 7 项，验证只有显式覆盖值带 `!important`、空覆盖恢复原 CSS、保存源码仍保留普通声明，以及非法值拒绝。本次仅运行三个直接相关参数/覆盖测试通过，未为小改重跑既有本地 HTTP 服务器或操作现有预览端口。定向 ESLint、Prettier 和 JS 语法检查通过；此前 AVD 颜色/尺寸证据可复用，思绪字号覆盖内联偏好的实际效果仍待主会话验收。

源码成品：`android/tools/live-preview/`；本工具默认不产生临时文件或截图文件。预留临时目录 `tmp/android-live-preview/`，人工验收产物 `outputs/2026-10-17-android-live-preview/`。
