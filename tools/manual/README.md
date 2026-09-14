# 手动验收工具

日常回归运行npm test，不使用这里的真实备份工具。

需要检查某个真实旧备份时：

```powershell
node tools/manual/import-backup.mjs --file 'F:\某个目录\备份.zip'
```

脚本只读指定原件，创建独立var/manual-imports/run-*目录，启动临时回环端口，执行导入并保存不含正文的结果计数。不会连接正在使用的18765端口，不会追加到正式工作库。结果库包含解开的私人日记与媒体，应当按私人资料保存。

archive目录是上一阶段固定路径脚本的.txt归档，只供追查原验收过程，不能作为当前运行入口。完整备份的自动压缩加密往返验证在tests/vault2-roundtrip.test.mjs；大库验收不应变成每次开发的默认动作。
