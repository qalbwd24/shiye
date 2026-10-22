# 专用资料 QA driver 私有偏好读取窄修

2026-10-20，Sol 执行。仅完成新 driver 候选和纯 mock 验证，等待非作者独立审核。没有启动 AVD、执行真实 ADB、连接任何 HTTP、安装/重装、推包、启动应用或导入数据；未改产品前端、原生 Java/APK、SharedSeedFile、正式服务及私有审批。

## 原失败与候选

复用原 `outputs/2026-10-19-full-seed-data-qa/driver-install-readonly-1792454065999`，base manifest SHA `0b7cf9bffae8987c9e343d809ed716b03f71ec7c8a9615e5a6f3af5106e4c272`。私有 `readonly-command.err` 明确记录 `/system/bin/sh: syntax error: unexpected 'then'`，源是 `adb shell` 拼接 `run-as … sh -c` 参数后丢失完整脚本的参数边界。不能据此称 prefs 不存在、权限错误、已完成最终安装复核或已导入成功。

新候选：[driver-private-prefs-v5/HANDOFF.md](../../outputs/2026-10-20-native-import-completion/driver-private-prefs-v5/HANDOFF.md)。精确 manifest SHA `58f8e132de61b5aa0f7e1c0c248bd798445a07d28c115f46f8550a306e53e0e7`，16 项 artifact；driver SHA `f00306b6fbe0eceb79cd583707a36ccaf03af281fd6c120e726201637e257d0c`。

改为唯一固定命令 `adb -s emulator-5582 shell run-as dev.shiye.dataqa.fullseed cat shared_prefs/backend_services_v1.xml`。无嵌套脚本或命令插值；仅 `exit1 + stdout为空 + stderr精确cat该路径的No such file or directory单行` 归为首次启动缺文件。成功读取须 exit0、stderr为空、stdout非空，再过 XML/locator 核验。其他失败、权限拒绝、run-as/package错误、工具缺失、超时、空成功均停止，不产生最终复核 receipt，不补偿安装。真实设备的 cat 缺文件输出尚未观察，若不匹配只会停止，不能自动扩宽分类。

locator 必须为无 DTD/entity 的正常 `map` XML；baseUrl 缺键/空字符串视为离线，若存在只允许一个直接 string、无嵌套内容、值精确为空或 `http://127.0.0.1:19483`。拒绝重复/错误类型、非 map、坏 XML、正式地址及私有 URL 的附加路径、空白、userinfo 等变体。其他偏好不写入、不迁移。

## 定向验证与保留边界

[mock-tests.log](../../outputs/2026-10-20-native-import-completion/driver-private-prefs-v5/mock-tests.log) 的 12 项纯 mock 通过：原 6 项 consumed-install/只读回执链，夹具仅替换固定 prefs 命令；新增 6 项覆盖原 shell 参数断裂、缺文件精确分类、权限/工具/timeout/空成功、XML/locator、错误 serial/package/path/binary 和失败不发最终 receipt。真实 subprocess/ADB 均被 mock。首轮窄测试 12 项已通过，为冻结证据再执行同 12 项并持久化日志，未扩无关矩阵或重编 APK。

[driver-scope.json](../../outputs/2026-10-20-native-import-completion/driver-private-prefs-v5/driver-scope.json) 和 [driver.patch](../../outputs/2026-10-20-native-import-completion/driver-private-prefs-v5/driver.patch) 核定仅 `adb`、`verify_installed_bytes`、`validate_private_locator` 三函数及固定路径常量变化，无增删函数，其余 22 函数 AST 相同。APK、input manifest、policy、qa-cdp 四份复制 artifact 与原 base 全 SHA 相同；原 package/SDK/AVD/marker/唯一安装预算、七字段 seed 许可、回执链保持。

原台账未修改：attempt SHA `8c7d2fe9af1ca8ae155c27f8471dc55f36b543e6927d318a1eda0f081b397689`；false result SHA `dee19f7a78c5e87d59918914273d91efbe75fd341aca766bc66d26d131011db2`。唯一安装预算已消费，不能重新 install、clear、uninstall、重置台账或重建安装身份；新 driver 不创建新安装台账。

本候选不是任何设备动作许可。待 root 独立审核准确 SHA 后，才可另按既有 marker/资源/owned guard 授权只读复核。后继资料包 `83f936b5…` 不沿用旧 `2f789…` 的 approvedSeed；任何新绑定、push/选择/导入需准确七字段与 root 后续许可。QA APK 仍旧 client66，不支持未来 unbound feature 包。本次未更改任何 seed 绑定。实际 prefs、最终已装包验证 receipt、系统 picker/完整包导入、原件/正文、离线编辑和冷启动均仍未验。

## 只读后继审批 CAS 提案准备

按 root 后续指派，新增 [approval-cas-preparation-v5/HANDOFF.md](../../outputs/2026-10-20-native-import-completion/approval-cas-preparation-v5/HANDOFF.md) 和公开 locator；真实七字段/完整 proposed-after 仅置于原 privateState 的 `approval-proposals` 子目录。private proposal SHA `69740f9ebdb0d89c7656eeaf6305d993007d771e841ab583116f3ffadea3f1f8`，原 live approval beforeSHA `7c375189b6d6ab2d22f04cde4d4a6125849b93473f998430c510156eb3044b75`。提案明确 `approved=false/authorized=false/applied=false`，仅拟 `verify-install-readonly` 后即停，不改变 live approval、seed-input、APK、原台账或许可。actual header 与后继 handoff/export result 完全对应，descriptor 仅 path/bytes/SHA/packageId 更换，同库/epoch/key 保持；实际 library/epoch/指纹未公开。

准备额外发现并保留一处回执引用差异：已审 snapshot `e048827f…c945` 引用的 producer SHA 为 `8f48df…cca`，当前 handoff 同名 producer 文档为 `3a0726…68e`。独审文件本身 SHA 仍准确匹配，actual header/size 亦一致；没有把两份 producer 文档假作同 SHA。提案记录此项需非作者独审/root 最终处理，未藉此放宽任何设备条件。两次准备停止（相对路径 cwd、producer SHA 差异）已留日志；终稿仍只是不生效的审查材料。无真实 ADB/AVD/HTTP/安装或导入动作。

root 随后明确允许纯文件一次全文 SHA 收口此处证据，不依赖当前 producer 报告自报 trusted。新增 [v5b 交接](../../outputs/2026-10-20-native-import-completion/approval-cas-preparation-v5b/HANDOFF.md)，保留 v5 原提案不改。240 种有界换行/BOM/JSON 空白规范组合未重现 `8f48…`，当前 producer 文档仅作为不同文件保留、未复用其字节验证结论；额外单次 1MiB-buffer 流式读取实际 1,838,024,686 字节，全文 SHA 精确为 `83f936b50b9cf0c4c605f1fb232def3716d5499bc783e500a2dcc5bb104690d3`，文件 ID/mtime/size 前后相同，不扫描或重拷原件树。v5b private proposal SHA `8171ac35710fef0a62c249c6a706358dd0f906735756607e0b02bb5f8f3e30bf`；仍为 false/unapplied，live approval/seed-input/原回执均保持，实际设备与网络动作仍为零。新全文 SHA 证据交独审/root 核后才可最终形成审批 CAS，不自行授权或运行。

## root 精确授权后的实际只读复核

独审/root 完成 live approval `7c375…→d143d61e05756aff7a5638da219840365a57dcb7fca38985372279dfe837c4b5` CAS，root 随后只授权一次 `verify-install-readonly` 后停止。执行保留该原审批 SHA，未自行改审批。fresh 资源 D329643659264/physical11289550848/commit23943397376、marker/SDK/5582端口/AVD冲突均过；沿既有 hidden wrapper 仅启动自有专用5582，实际 driver 原 owned-process/console AVD/boot/24GiB容量/禁止正式转发 guard 通过。

唯一实际只读动作 exit0。实际 installed base 完整 SHA 为 `a793ddbd18b575800416c137c81e2af9c12686a2d70292c7fc0febaca76cc394`；真实 apksigner 单证书 `24e2b783…9dfe6`，aapt 包名/code1/name`0.1.0-fullseed-dataqa-ddc74` 一致；固定 prefs 读取和安全 locator guard 均通过。driver 未记录具体属于缺文件/离线/固定私有URL哪种可接受状态，因此不额外推断或复读。

另行 exclusive/fsync 最终复核回执 SHA `199d40a22cbf76ab631e33e17d913e6e46876397314e6251b509dfc47a14d1f7`，绑定原 attempt `8c7d…` 与 false result `dee19…`；原失败台账全文SHA及success=false保持，历史原安装stdout仍不可得，预算未重置。既有 stop 正常关闭自有PID49748、exit0并进程退出实证，完成08:27:37.507283Z；实际审批仍d143，临时pulled base由原driver删除。

公开 body-safe 汇总/私有日志定位见 [实际执行交接](../../outputs/2026-10-20-native-import-completion/readonly-v5-actual-20261020T082626Z/HANDOFF.md)。此次未install/reset/push/launch/import/CDP/编辑/sync/正式HTTP，未操作手机/5554/5580；5582已停。只关闭“既有安装身份最终只读核对”缺口，不代表完整包/正文/原件/离线编辑/冷开已通过，deliveryReady仍false，任何下一设备动作须另获root准确许可。
