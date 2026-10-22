# 初始资料包与增量接续验收

2026-10-18，后端与数据端实现，Android界面由另一会话接入。本轮不操作手机/APK或日常桌面窗口，不切换正式库/原canonical开关。先读[实际接口](../PRODUCT-SEED-API.md)。

## 交付

- `seed-package.mjs`：新版`.syseed`流式容器，逐成员/整包hash、canonical/引用检查、原件hash去重，不打包旧ZIP或整个旧diary.json。
- `seed-service.mjs`：同Bearer导出/Range、包身份/真实checkpoint确认、4MiB缺块上传与重试、只允许空服务的原子业务初始化。异库拒绝、原服务游标不能复用到新服务器。任务/块/回执重启后保留。
- `portable.mjs`：独立同步authority的富文档规范化；保留时间/ID、旧附件编辑时间兜底、回收站正文恢复，以及一类details/summary只读兼容显示。原旧库不改。
- `createSyncClient().importSeed`：同一Repository事务安装，保留本机intent/命令与本机壁纸、不产生回传outbox；先补稳定watermark的pull再push，跨强杀仍保留接续围栏；包后墓碑先安装，旧服务缓存包撤销后不再下载。
- 表情包tags可选共享字段已校验，与name/note/group/媒体身份同一实体；壁纸显示DTO只取本机设置。
- `tools/product-seed.mjs`导出/inspect/initialize-empty；`verify-product-seed.mjs`真实CLI/反代前缀/合成原包验证。golden完全合成，不含用户正文/凭据。

## 实际验证

初轮84项定向/相邻通过；为SourceRef保留补测后，最终130项中129通过，1项旧library-store文件替换遇Windows EPERM；该并发评论项随后独立1项复验通过，不将其写成同一轮130全过。包含10个新种子测试及现有产品、客户端HTTP/事务/快照、媒体HTTP、SQLite存储、消息归档与回看来源/投递/评论。核心包括：同包幂等、断点跨重启、坏hash/越界路径、异库/非空拒绝、事务故障全回滚、原件逐字节、包期间增量、先pull再push、分页接续中断、墓碑不复活、本机壁纸保持、名称/标签一致及旧SourceRef/snapshot原关联保持。Windows轮询打开job.json也曾造成一次EPERM；新增有界原子替换重试后种子定向通过。旧library-store未代改，失败/复验日志均保留。

CLI export→inspect→initialize-empty全流程、反代前缀及golden现有样本解析通过，7实体/1GIF。运行中18789已验证seed=1/stickerTags=1，loopback和电脑自身100地址可达；原同步库libraryId/epoch与升级前私有快照一致，旧设备不需因代码升级换库。一次真实导出/下载/hash/解析/resolve通过，运行测试包11实体/1原件，QA设备随后撤销。不是手机真机新入口验收。

完整`npm run check`：401模块路径检查errors=[]、全项目ESLint通过；格式检查遇60个共享/历史/并行Android等文件告警后停止，未改其它会话文件来消告警，完整全库测试未执行。不把定向结果写成全库通过。本轮自有文件另行定向lint/格式检查。

## 正式资料只读预检

现库3149篇/已含前轮安卓v3备份；来源适配0异常。3139长文可准备7607单元、10聊天归篇，当前预检0阻断。最初发现12个回收站单元被误排除于重组，及1个旧details/summary排版；已用合成回收站/折叠样本回归后再次全源只读预检通过。两次读取期间源整库hash不同，库保持用户/其它后台正常可写；本轮没有正式库写命令，不能声称整轮源文件静止。

前轮安卓ZIP的193篇已正式合入：124新篇、68重复沿用、1修改版独立保留；新125篇为233消息，源53媒体hash回查通过。详见[前轮合并回执](2026-10-18-android-backup-merge.md)。本轮未将完整真实库推给手机或云，不把只读预检当已导出1GB以上完整包。

交付前又经正式API只读确认：193个原始UUID均存在、53媒体hash均登记、原ZIP归档仍在，总3149篇/API0.9.25；无缺项。回执`outputs/product-seed/old-import-readback.json`。

## 运行与产物

原18789进程已退出但留stale-owner lock，核对PID/监听均不存在后，先备份13文件并逐件SHA核验，再保留旧锁启动新版测试服务。私有备份`var/product-seed-backups/20261018-095741/`，不涉及正式18765日常后台。

最终补丁后仅更新本轮自行启动的隔离后台：确认10900的命令归属和无building/committing/uploading任务，再终止该自有进程（非优雅关闭）、复制16文件并逐件SHA核验，保存旧锁；最终进程5776为当时快照。SQLite重开和库身份/epoch、真实导出/下载/解析/resolve再次通过；备份`var/product-seed-backups/20261018-100709-final/`。首次立即回读发生一次冷启动ECONNREFUSED，随后新增有界就绪等待并通过；没有操作日常18765或原生窗口。

- 产物/脱敏报告：`outputs/product-seed/`。
- 私有运行包及纯合成CLI库/凭据：`var/product-seed-running/`、`var/product-seed-cli-lab/`。
- 测试、审计及全库检查日志：`tmp/product-seed/`。
- 规范/可复用合成包：`docs/PRODUCT-SEED-API.md`、`docs/contracts/product-seed-v1.fixture.json`。

Android还需按协议实现文件选择、流式落盘/中断恢复、同一LocalStore安装事务和UI权威映射；不要仅更新root就显示全数据已同步。电脑持续保存增量登记、完整日常双端接线、实际大包手机吞吐与多端升级恢复仍未验/未完成。现有普通兼容API未全局拒绝历史格式，严格新版门槛在种子导出/导入上执行。
