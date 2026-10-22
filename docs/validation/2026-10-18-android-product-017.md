# Android 0.17 产品接口候选验收

2026-10-18。用户确认当前手机使用文档电脑服务 `http://100.77.215.104:18789/`，服务稳定后再迁移。18779属于另一测试库，凭据、libraryId/epoch和cursor不得混用。18789当前仍是合成产品库，本轮未向它上传手机旧资料，也没有修改其配置。

## 交付与运行

- 0.17.0-product-preview/code19已构建为正常包名候选，APK：`outputs/2026-10-18-android-product-017/Shiye-Android-0.17.0-product-preview-bd1e6a86.apk`，SHA-256 `bd1e6a867eee4e46b6c1d5347fe52a363f2b661edca48693b368d406274cef39`。**没有覆盖手机或主AVD正常包**；两者仍为已交付QQ皮肤0.16/code18。
- 同一候选在AVD专属 `dev.shiye.productqa` 运行验证；normal与QA包的DEX/全部assets逐字节相同。0.16全部11749个assets保持相同，仅新增哈希命名product-content模块，未把并行电脑UI源码混入聊天界面。
- 专属productqa、instrumentation和repositoryqa017包已卸载，transportqa017由其测试脚本清理；自有随机服务/配对输入/reverse已清理。保留原有其他QA包。主AVD0.16冷启动Status:ok。未清用户数据、卸载正常包、操作手机日记或重启日常桌面服务。

## 实现

`AndroidSyncTransport`补齐固定产品14入口、增量snapshot/pull/push/watch/冲突和分块原件接口。URL前缀、系统密封凭据、库身份/epoch、迟到401、取消和有界容量均有保护。HTTP只新增精确100.77.215.104例外，其他私网不放开；迁移HTTPS沿用协议，但地址变化必须重新核验身份，不自动转发旧token。

`ProductRepository`在同一LocalStore连接内保存完整信封、base/local、不可变wire、待发业务命令、映射、冲突和游标。LocalStore候选schema3→4只增表，旧entry/body/revision/null时钟保持；本地projection/intent与接收整页/cursor在同一SQLite事务。已确认撤回不因空重快照复活，unknown和20位ID不丢失，不从UI DTO重建权威正文。canonical编辑默认拒绝，直到共享prepare与生产写口一起切换。

`ProductSyncCoordinator`提供显式连接/手动持久收件、分页超限降limit重试、prepare→push→ACK及固定业务命令接缝。flush必须传依赖检查和业务回执回调，避免不完整映射即发送。朝花夕拾状态/feed/source/configure等固定接口可调用，产品页目前仅状态与只读入口，未实现完整绑定、消息投影和评论UI。

`ProductOriginals`将原件保存在App私有noBackup目录，分块落盘/fsync后提交offset，完成全件SHA再原子发布；可取消、续传和离线检查。严格逻辑MIME，兼容后端对JSON等使用octet-stream安全下载。这里只是原件下载任务基础，正文引用/原件任务/outbox的统一调度仍待业务接入。

`android/product-adapter/product-content.js`直接导出电脑共用sync-product/content-preparation/richdoc/时间/units规则，打包12个实际源文件。哈希模块 `822dbc111d93da72e619e7fd8d8b365f26fe3776381acc635128dd9b777381b0`；输入源码与许可证快照在content-source。不是另写一套手机分段算法。**该模块已在实际WebView核验，但旧编辑器生产保存口仍未改用它。**

连接与产品页的返回/关闭、Activity销毁先取消HTTP再关闭存储，避免退出后迟到回执改动新页面。

## 证据

| 验证 | 结果与实际边界 |
| --- | --- |
| 产品固定HTTP端点 | 90项，真实隔离createSyncServer+productSyncExtension；JVM替代Android Context/密钥提供者，非真机 |
| 原015传输回归 | 97项，新源码重新编译，原证据不覆盖 |
| Repository | 59项实际Android SQLite断言，并与实际共用JS状态机逐对象比较；失败回滚/迟ACK/撤回/未知字段/身份均覆盖 |
| 原件文件状态机 | 74项JVM断言，真实文件/fsync，Source/AtomicFile替身；非设备断电证明 |
| 完整原生HTTP链 | 44项实际Android，真实KeyStore、SQLite、网络XML，两个不同进程；配对恢复、多页收件、真实push/ACK、消息发送撤回、600001字节JSON原件上传下载SHA通过 |
| 页面生命周期与实际迁移 | 11项实际Android；schema3→4保留旧行和null时钟，返回/关闭/销毁均取消新连接页面，未自动导入旧库 |
| 共用内容算法 | 9个golden对象，实际Android WebView与电脑prepared/payload/hydrate逐对象相等，20位ID/大正文保持 |
| 相邻共享回归 | 36项通过；golden契约检查另通过 |
| APK构建 | QA与正常候选Gradle assemble成功，QA与normal DEX/assets相同；完整原UI资源保持 |
| 全项目check | check-files/lint通过，format:check停56份共享/历史格式告警；未批量格式化其他会话文件，不能称全库全绿 |

原始回执分别在本轮outputs的transport/、repository/、originals/、integration/、android-content-module.json、android-lifecycle-migration.log、shared-regression.log、project-check.log、release-manifest.json和cleanup.json。44项测试完全使用随机端口/前缀/专属合成库，不访问手机、主包、18789或正式日记。

## 未完成与接续门槛

1. 现有TL消息/旧长文编辑器的单一权威迁移与保留式映射、同事务projection、共享prepare生产写入尚未切换。正常手机仍0.16，不会因为接口存在自动同步。
2. 原件下载helper尚未接全局持久调度器，上传任务持久化/依赖队列与全部原件离线保有策略尚未端到端接入。
3. 朝花夕拾完整绑定/收件气泡/最近单条deliveryId评论、服务配置页面和断线恢复后台调度尚未完成；固定接口实现不等同完整产品UI交付。
4. 没有验证真实手机→18789完整产品同步、双端同时离线冲突、设备强杀/断电、512MiB性能、长期后台和物理120FPS。
5. 四图提出的思绪顶部冻结/阅读导出/日历标记/分类默认/列表透明度等仍按[UI需求](../ANDROID-UI-017-REQUIREMENTS.md)后续实施，未混入这次接口候选。

复建：先 `node android/tools/stage-product-preview.mjs` 冻结并校验0.16基线APK及当前共享源码，再激活 `D:/codex-tools/android-state/activate.ps1`；`android/gradlew.bat -p android --project-cache-dir D:/拾页/tmp/android-product-017/default-gradle-cache --offline --max-workers=1 assembleDebug`。源变化须重新冻结/验证，不能复用过期内容证据。QA/lifecycle工程为android/product-preview，Repository专属验证为android/repository-tests；集成复现见integration/README.md。

成品和原始回执：`outputs/2026-10-18-android-product-017/`。临时工程、编译、合成库与脚本：`tmp/android-product-017/`。原有手机备份继续留在 `var/android-backups/`，不进入源码包。
