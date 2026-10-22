# Android资料后端候选验收

2026-10-19。用户要求先补后端、与既有接口对齐、前后端独立维护；全部数据包含设置参数，后续需要电脑资料整包到手机。最后明确与「安卓ui」会话协作，并纠正手机反复出现QA安装提示。

## 已完成源码

- `src/server/sync-product/migration-metadata.mjs`保留settings、模板、快捷键、程序参数及未知普通根字段；普通配置不按UI字段白名单重建。已知凭据字段名规范化过滤，明确HTTP(S) URL移除用户凭据和已知敏感查询项；排除报告不含值。此规则仅适用于配置，不能作为任意暗藏密码的通用识别器。
- `legacy-adapter/import/service`接入只读metadata profile、覆盖报告及catalog能力；保留既有sync/product/seed v1。chatJournal/messageStore/revisit逐子域报告可传、遗漏和私有排除，不以顶层出现冒充全域覆盖。`tools/product-seed.mjs export --scope computer`在覆盖不足时明确拒绝。
- `computer-data-inventory.mjs`和`tools/audit-computer-data.mjs`只读显式绝对文件，流式hash/大小、有界JSON结构和缺项，不输出正文、路径或凭据；原始chat profile只算恢复归档。四个来源都有文件也不能推断完整跨端导入，完整标志保持false。
- `ProductSeedFile`流式.syseed及受限ZIP包装，实际中央目录计数/长度、成员白名单、CRC/整包与成员SHA、UTF-8、record/refs、容量和取消边界；错误任务清理自身staging，成功Prepared由调用者close释放。无任意输出路径。
- `ProductSeedInstaller/Repository/Transport/UiBridge`固定export/status/Range/resolve、可信库与checkpoint、私有原件原子发布、同SQLite事务信封/墓碑/原件映射/cursor。保留普通intent及未确认业务command，错库/已初始化禁止回退，同包重试幂等；追平最终pull前不push。失败原件part清理，已校验共享文件不随事务失败误删。
- `ProductMediaBridge/DownloadQueue`通用原件与聊天索引分离；asset墓碑禁读旧映射，不把普通消息撤回当作删除共享原件。payload显式加入增量原件依赖，旧库一次补索引。
- `ProductPayloadReader/DiaryStore`校验私有payload映射、hash/size/UTF-8/kind/refs后提供只读完整数据，原wire base保持不变。当前大正文编辑/重打包上传端口仍未接，读口显式readOnly并拒绝保存，不伪造编辑成功。

## 定向验证

`outputs/2026-10-19-backend-data-completion/`：

| 证据 | 结果 |
| --- | --- |
| backend-final.log | 42 Node测试通过：迁移元数据/清点/产品API/种子；含真实HTTP旧客户端token与库身份在服务重启后保持、设置实际进种子、只读profile禁止旁路修改、computer范围拒绝漏项 |
| lint.log、format.log | 本轮Node改动及测试/工具定向通过 |
| native-sync-result.json | 20实际Android检查通过：SQLite离线提交/重开、显式选择、依赖回滚、HTTP双向、原件SHA、鉴权停重试/退避 |
| native-seed-result.json | 47实际Android检查通过：raw/deflate ZIP、重复/越界/伪造目录条数/截断/损坏/超限、取消staging、20位字符串ID、证明/资源事务回滚、原intent与业务command保留、DB重开、先pull再push、幂等/错回退、resolve墓碑、设置及原件、generic ID、900000字符payload副本与wire base、损坏payload、asset墓碑/共享hash、原件复制中取消及part清理 |
| native-build.log、native-sources.json | 最终QA编译及精确源码hash；Context/LocalStore为独立测试包装，业务类为实际生产源码 |
| install-boundary.json | 真机serial在任何ADB/构建/安装前被拒绝；源码扫描业务Java/Manifest无APK安装API/权限 |
| qa-install.json | 专属AVD与APK SHA、禁止真机/禁止自动安装重试；同SHA比较可跳过多余安装 |
| desktop-status-final.json | 只读回读桌面仍ui48/0.9.27/ready；未切chat-reedit2运行指针 |
| source-manifest.json、candidate-sources | 冻结34个本轮源文件并核对生产Java与实际QA编译SHA；候选补丁快照，不是独立可部署运行包 |
| cleanup.json | 专属5580测试后正常关闭，19421服务/转发清理；同APK安装hash复用条件只读核对为true，未触及手机/5554 |

Android最终使用`emulator-5580`、`Shiye_Emulator_Repair_QA`、480×800/160dpi/1536MiB，无UI尺寸验收。前端会话5554/Magic7适配完全分离。最后仅新增取消复制验证时补跑seed47，复用未改生产源码的sync20；未重复全库/全媒体/浏览器矩阵，没有64GiB真实压力、ZIP64大包、进程突然断电或物理刷新率验收。

保留测试脚本中一次`Probe`与循环变量大小写同名造成的ValidateSet失败，修正变量后47项通过；失败不涉及业务库或真机。此前手机QA多次显式安装的打扰已按用户纠正停止，测试包卸载/转发移除。现在脚本仅允许专用AVD、失败不自动重试；应用启动、同步、插件登记均无安装钩子。早期021正式安装发生在“后端优先”收口之前，见本轮协调历史，不把这次QA候选说成手机已安装。

## 发布与未完成边界

这是后端源码候选和隔离验证；没有更新正式桌面运行包，没有部署新手机APK，没有导入用户真实整库。普通QQ仍legacy owner，新的原生端口不表示生产UI已经接入。

电脑完整资料仍需日记库＋聊天逻辑快照＋便签正文/Blob＋独立偏好的稳定ID和一致快照；原profile归档与只读inventory均不能替代。PC持续变更登记、Android首次导入UI/生产owner接续、大正文编辑上传尚未完成，不能显示全量同步/完整电脑导出。已明确阻止缺项整包发布；没有为了通过验收把complete改成true。

「安卓ui」已回执按021 APK 274478df与其native stage冻结UI022/code24候选，只叠显式前端原生白名单；后端不覆盖其MainActivity/LocalStore/UI源码，也不操作5554。新location字符串及presentation命名空间/未知键保留已双向对齐。共享约定见[并行维护](../ANDROID-FRONTEND-BACKEND-COORDINATION.md)，前端18项意见的UI验收由该会话独立完成。
