# 项目维护约定

范围：此“电脑前端”目录及其子目录。先读 README、docs/FEATURE-MAP.md 和相关模块。

1. 正式数据在 data/；开发用 npm run dev 的 var/dev-data。测试必须显式指定隔离 dataDir，不从真实日记生成提交用样本，不把正文、密码或解密常量写入日志／聊天。
2. Windows 与 PowerShell 环境，文本 UTF-8。移动或清理文件前核对绝对路径；保留原始备份及未知旧格式字段。
3. 后端新功能放 src/server 对应模块，统一通过存储 mutate 串行提交。路由处理成功返回 true，未匹配返回 false，错误用 fail。不要直接编辑已运行的 diary.json。
4. 前端新功能放 public/features；在 features/index.js 显式装配。c.library 是实时 getter，不要在模块初始化时保存其快照。HTML 显示前 sanitize，纯文本插入模板前 escape。
5. 快捷键命令清单在 public/shared/hotkeys.js；容量上限在 public/shared/limits.js；版本在 package.json；端口在 config/app.json。修改后同步相关文案和说明。
6. 改存储字段、加密头、媒体ID或恢复逻辑前阅读 docs/DATA-MODEL.md；不得通过隐藏按钮或删代码来悄悄丢弃历史数据。新增字段默认向后兼容；破坏性格式变更需要迁移代码和双向样本验证。
7. 第三方代码放 vendor，原始包放 resources/vendor，保留版本和许可证。日常格式化与检查不改第三方文件。
8. 提交交付前运行 npm run check；界面相关变动还需在独立开发库实际操作。检查结果写 docs/validation，更新 CHANGELOG、功能索引和相应使用说明。标清未验证部分。
9. 源码交付使用 npm run package:source 的白名单输出；正式 data、var、旧验收库、密码、真实备份、node_modules 都不进入源码交付。
10. tools/manual/archive 与 docs/archive 是历史依据，不是当前入口。不要运行旧的一次性真实库导入脚本。
11. 用户明确要求每次更新都启动新版。代码和隔离验收通过后，完成正式升级／重启，并检查 /api/health 的版本与 package.json 一致；不能把“源码已改好”当成运行版已更新。用户已授权该项目的常规更新和重启，无需每次重新请求相同授权。先核对编辑保存状态、进程归属并保存升级快照；数据继续保留在原位置。如果工具策略拒绝操作，应明确报告被拒绝的动作和实际运行版本，不绕过策略或谎称启动成功。
