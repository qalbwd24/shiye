# 来源接收与大正文后端候选验收

2026-10-19，用户要求继续后端且不影响前端。只补数据/固定桥候选，不部署正式后台或手机。产物在 `outputs/2026-10-19-backend-source-snapshots`。不同Node用例总数106，分阶段验证：104先通过，前端新增数组namespace后增加2项并回归相关21项，其他未改范围复用原证据。

| 范围              | 本轮结果与证据                                                                                                                                                                                             |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 来源编译          | 偏好9、便签14、聊天10项，保留未知普通字段、原件映射与稳定身份，严格排除私有域/非法输入                                                                                                                     |
| 来源真实HTTP      | 12项：数组namespace类型/重启、版本/重放/拒旧、原件下载、重启、真实seed、改名复用、目标改动保护、只读业务保护/邻居不重写、第二SQL故障整批回滚、大profile压包再缩回inline                                    |
| 大正文服务器策略  | 7项：真实原件、严格CAS、幂等回执、事务回滚、普通短篇合并兼容、完整指针替换及超限/错误hash先拒绝                                                                                                            |
| 相邻基础语义      | store/server30、既有product/seed24项，含旧业务撤回及种子后撤回优先                                                                                                                                         |
| 最终Node          | 106项不同用例分阶段通过，`node-tests.log`（104项）与 `frontend-width-contract-tests.log`（最后21项，含2项新增）；定向ESLint和Prettier，`lint.log`、`format.log`                                            |
| 原生本地/HTTP     | 31断言，`payload-qa-http-fixture-fixed/native-payload-result.json`：SQLite小指针/私有原件、离线保存、双次冻结wire、rollback/reopen/corruption、真实upload/ACK/重放、第二库下载、409保留与packed→inline     |
| Android构建与安装 | `native-sources.json`、`native-build.log`、`qa-install.json`；独立 `dev.shiye.syncqa021` 只在后端5580安装。QA APK SHA `e2155d7a8605ef1b0e6fbd11de96ca72be0e4f9feece5c805b6c2d9bbf8dc8ba`，不能装为正式前端 |
| 清理              | `qa-cleanup.json`：5580正常停止，19421无监听，无该reverse，未控制其他设备                                                                                                                                  |

发现并修复的实际问题：旧chat/room重建所有conversation会剥离来源只读；现在仅提交当前房并保护来源owner。最初通用readonly guard又阻断旧业务消息撤回，相邻24项暴露2失败，已改用独立sourceSnapshot标记，最终全过。原始失败不作为通过证据。HTTP QA首次缺canonical blockId，服务启动时拒绝，未到APK构建；失败目录`payload-qa-http-first`保留，修正fixture后再测。QA两个不同探针APK各一次安装，无自动安装重试。

范围复用：31项Android所用native源码与最终冻结SHA一致。其HTTP服务启动时service文件SHA `7f781443f4578a7e89a1d369b67fdd6e9f6a33ff48363e378e7e80b4bc1a10ad`，最终只改commit的来源保护判定，CAS/传输/存储路径未变；旧service内容重建后精确SHA核验，见`qa-reuse.json`及`tested-server-sources/service.mjs`。最终新guard由Node实际覆盖，不重复无关Android安装。此为相关范围复用，不称所有最终server文件均在Android上重新运行。

`candidate-sources`/`source-manifest.json`是可复核后端补丁快照，包含实际QA编译输入；不是可直接替换正式运行包的完整发布。前端会话已收到新契约和边界，继续以021冻结native与UI022白名单开发，不复制本轮全部Java。正式runtime选择仍chat-reedit2，本轮没有重启或直接写正式日记。

未启用与未验：新WebView桥的完整产品页面流程、64MiB真机极限/上传中强杀/TLS矩阵、正式电脑持续增量登记、真实WebView偏好自动捕获、生产聊天写权威迁移、完整电脑资料包。来源资料只读保真，不自动应用设备设置；完整电脑coverage仍false，`--scope computer`继续阻止不完整全量宣称。
