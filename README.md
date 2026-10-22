# 拾页 · Shiye

本地优先的日记 / 随笔 / 会话应用。日记正文、随手记下的思绪、会话聊天都保存在你自己的机器上；
Android 端是 WebView 壳，与本机服务共用同一套前端与数据契约。

## 组成

| 目录 | 内容 |
| --- | --- |
| `src/` | PC 服务端：Node.js 原生 `http` 服务，日记 / 媒体 / 导入 / 同步领域模块 |
| `public/` | PC 前端：原生 HTML/CSS/JS，CodeMirror 与 Tiptap 富文本编辑器 |
| `desktop/` | PC 宿主：C# WinForms + WebView2，托盘与快捷记录窗口 |
| `android/` | Android 客户端：Gradle 工程、Java 原生页面 + WebView |
| `previews/` | 聊天界面预览与构建脚本 |
| `tests/` | 自动化测试（`node --test`） |
| `docs/` | 架构、API、数据模型与功能文档 |

## 运行

需要 Node.js >= 22.13。

```powershell
npm install
npm run dev     # 隔离开发实例 http://127.0.0.1:18766，数据写入 var/dev-data
npm start       # 常规实例，端口读 config/app.json（默认 18765）
npm test        # 自动化测试
npm run check   # 文件检查 + lint + 格式 + 测试
```

数据默认落在 `data/`，首次启动会建立空库。该目录属于个人数据，不纳入版本库。

## Android

在 `android/local.properties` 写明 SDK 路径（不提交），然后：

```powershell
cd android
./gradlew assembleDebug
```

`applicationId` 默认 `dev.shiye.app`，`minSdk 26` / `targetSdk 35`。真机调试工具见
`tools/android-device-debug.ps1`，配置模板为 `tools/android-device-debug.example.json`。

## 桌面端

`desktop/` 为 C# 源码，运行需要 WebView2 Runtime；构建脚本见 `tools/build-launcher.ps1`、
`tools/build-quick-launcher.ps1`。

## 文档

- [架构](docs/ARCHITECTURE.md)
- [API](docs/API.md)
- [数据模型](docs/DATA-MODEL.md)
- [开发约定](docs/DEVELOPMENT.md)
- [功能索引](docs/FEATURE-MAP.md)
- [使用说明](docs/USER-GUIDE.md)
- [路线图](docs/ROADMAP.md)

## 版本库边界

仓库只放源码与文档，不含个人日记数据、本机配置、构建产物、安装包与第三方二进制包，
具体规则见 [.gitignore](.gitignore)。
