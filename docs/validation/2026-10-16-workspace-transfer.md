# 2026-10-16 · 工作目录整理

## 当前目录和范围

用户要求把当前代码放入工作目录，后续在此优化版本。当前开发根目录为 **D:\拾页**，源码版本 0.9.18；原目录 F:\<正式目录> 保留，正式日记、原聊天 profile、旧 EXE 和后台服务继续留在原位置。

保留原有 public、src、desktop、previews、tests、docs、resources、tools 的模块关系。新生成的构建和报告归 outputs/，临时脚本归 tmp/，开发数据归 var/dev-data/。入口说明为根目录 WORKSPACE.md，README 与 AGENTS 已明确新工作目录及旧路径的历史性质。

## 复制与 Git

- 复制 3,652 个文件，共 255,452,569 字节；每个文件复制前后计算 SHA-256，并再次核对源文件未在该次复制中变化。初始清单：outputs/2026-10-16-工作目录整理/source-manifest.json。
- 包含实际修改的完整 Telegram Web A 源码、自有聊天适配层、聊天归篇后端、许可证与构建资源，不只复制旧源码打包脚本的白名单。
- 没有复制原 data、var、旧 outputs/tmp、旧 EXE、运行时缓存、node_modules 或个人环境配置。依赖按原 package-lock.json 重新安装，根项目 104 个包、聊天项目 906 个包，未升级依赖版本。聊天依赖因离线缓存不足，按锁文件从注册表补齐。
- Git 以本地独立镜像复制，未使用硬链接、未复用旧 Git worktree 元数据、没有远程推送地址。14 个分支引用及 HEAD 完全匹配，原暂存差异保留；原工作区未提交的文件也已复制，没有自动提交。
- git fsck 成功；报告一个原有悬空 tree，不是对象损坏，未清理或修改历史。当前 HEAD 为 0652773f62011b4326be85eabefbf177a12ce937；0.9.18 的后续代码仍按原状态保留在工作文件中。

复制后的有意调整为 README、AGENTS、.gitignore、WORKSPACE 和本记录。聊天构建脚本重新生成合成 seed 日期，因此 **mocks**/default.json 与初始清单不同；不涉及私人消息。详细结果见 transfer-check.json。

## 验证和开发入口

- D:\拾页 下 npm run check：298 项通过，文件依赖、ESLint 和格式检查通过。
- 聊天前端在新目录构建成功；Windows 聊天宿主编译成功，--self-test 的几何检查通过。没有将编译结果当成正常桌面运行验证。
- 独立开发服务已从 D:\拾页\tools\dev-server.mjs 启动，地址 http://127.0.0.1:18766，health 返回 0.9.18；数据目录为 D:\拾页\var\dev-data。运行 npm run dev 前可先复用已有服务。
- 原正式数据没有迁入开发库，原正常程序与托盘未由本任务重启或切换。

## 未完成的路径调整

DesktopPreview.cs 仍有 F 盘项目路径和原共享窗口事件名，tools/upgrade*.ps1 仍是原发布用途。批量调整桌面宿主启动逻辑的命令被自动审批拒绝，仅返回 blocked by policy，没有具体原因；命令未执行，也没有换方式重试这组修改。

因此当前可在 D:\拾页 修改源码、运行主页面开发版、执行测试、构建聊天前端；普通聊天 EXE 的独立工作区运行尚未完成。使用 WORKSPACE.md 的开发入口，不从本目录调用历史正式升级脚本。现有产品默认端口 18765 保留在 config/app.json，不能把 npm start 当成本工作区的隔离开发入口。

## 文件位置

- 源码与独立 Git：D:\拾页。
- 清单、依赖日志、298 项检查日志、构建及迁移验证：D:\拾页\outputs\2026-10-16-工作目录整理。
- 本次新生成的聊天前端和原生编译结果：D:\拾页\outputs\2026-10-15-Telegram聊天预览（保留现有构建约定名称）。
- 搬运和校验脚本：D:\拾页\tmp\workspace-transfer-20261016。
- Windows 构建中间文件：D:\拾页\tmp\telegram-preview-20261015。
- 原代码、正式数据与运行入口：F:\<正式目录>，保留原位。
