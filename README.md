# 拾页 · 本地日记项目

版本 **0.5.0**。从第三版基线重新实现分区背景、主题色、右键操作与折叠。旧日记格式与加密备份继续兼容，正式 data 工作库保持原位置。需求、调研和实现交接见 [0.5 工作文档](docs/ITERATION-0.5.md)。

正式目录：`F:\我的奋斗\日记软件本地化\电脑前端`。双击根目录 `拾页日记.exe`，或 `F:\我的奋斗\启动拾页日记.lnk`。

## 先看这里

| 你要做什么               | 文档                                     |
| ------------------------ | ---------------------------------------- |
| 使用日记、导入、备份     | [使用说明](docs/USER-GUIDE.md)           |
| 了解结构和模块关系       | [架构说明](docs/ARCHITECTURE.md)         |
| 找到某个功能的代码       | [功能与文件索引](docs/FEATURE-MAP.md)    |
| 增加／移除功能、修改字段 | [开发维护指南](docs/DEVELOPMENT.md)      |
| 日记、媒体、历史如何保存 | [数据模型与兼容规则](docs/DATA-MODEL.md) |
| 查询或调用本地接口       | [API 说明](docs/API.md)                  |
| 打包、验证、更新与回退   | [文件管理与交付](docs/OPERATIONS.md)     |
| 后续工作顺序与已知限制   | [待办清单](docs/ROADMAP.md)              |
| 查看这次整理改了什么     | [变更记录](CHANGELOG.md)                 |

## 目录约定

```text
server.mjs           稳定启动入口，供 exe 与调用方使用
config/              应用标识、默认端口
src/server/          后端组合入口、存储、校验、路由、访问锁、旧格式读取
public/app/          编辑器与应用流程协调
public/core/         DOM、API、图标、下载工具及功能模块接口说明
public/features/     按功能划分的界面模块
public/shared/       前后端可共用的纯逻辑、快捷键、容量上限、备份格式
public/styles/       按职责拆分的样式，加载顺序集中于 style.css
public/vendor/       浏览器实际使用的第三方文件和许可证
resources/           非公开的兼容资源、第三方原始包
desktop/            Windows 启动器源码
tools/              开发、验证、构建、源码打包工具
tests/              自动测试与合成样本
docs/               架构、数据、接口、维护、验收文档
data/               正式工作库；不格式化、不打包进源码
var/                开发数据、手动验收结果、交付产物；不进入源码包
```

## 常用命令

使用 Node.js 22.13+，当前机器已验证 Node.js 24.18.1。**运行应用不需要安装开发依赖**；开发时先运行 `npm ci --ignore-scripts`。

```powershell
npm start                 # 正式库，127.0.0.1:18765
npm run dev               # 独立开发库 var/dev-data，127.0.0.1:18766
npm test                  # 自动发现 tests/*.test.mjs，使用隔离样本
npm run lint              # 未定义变量、未使用变量等检查
npm run format            # 统一代码和文档格式，排除日记数据
npm run check             # 文件依赖、静态检查、格式检查、全部测试
npm run build:launcher    # 从 desktop/Launcher.cs 重新构建 exe
npm run package:source    # 生成不含个人数据的源码目录与 SHA-256 清单
```

当前包含28项自动测试，另有独立开发界面回归。大容量备份的真实验收记录在 `F:\我的奋斗\验收记录`；日常开发无需重复处理真实大库。

修改前阅读 [AGENTS.md](AGENTS.md)。后续功能尽量落到对应模块；不要把业务逻辑重新堆回启动入口。代码使用本地 Git 管理：第三版基线为 2925e6f，旧第四版保留在 main；0.5 开发从第三版分支开始。data、var 等个人和生成内容不进入提交或源码包。当前没有上传到 GitHub。

已保存编辑后，可用 "powershell -NoProfile -ExecutionPolicy Bypass -File tools/restart.ps1" 核对进程并重启到当前代码版本。关闭窗口不会停止旧Node服务；如重启被拦截，请先保留未保存内容。
