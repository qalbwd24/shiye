# Android 0.2.2：本地保存优化验收

## 用户反馈与运行范围

用户已在 Magic7 的 0.2.0 上手测确认基本中文输入可用。手机继续由用户测试；本轮只改电脑源码并覆盖安装电脑主模拟器 `emulator-5554`，没有操作或更新手机。桌面正式运行版和正式日记未修改。

## 实现与构建

最终置顶偏好使用原生 `LocalStore.meta / android-chat-ui-preferences-v1` 为唯一权威，经现有 WebMessagePort 在 SQLite `dispatch` 的 `endTransaction` 完成后回 ACK。原生缺值时才只读旧 IDB 偏好，再回退旧 localStorage；存在的空列表有效，未知字段保留，迁移后不双写旧 IDB。多段草稿采用既有 Tiptap 文档 `getText({blockSeparator:'\n'})` 精确读取，与实际 IDB 草稿逐字比较，保留空段、空格及 emoji，并等待 worker 写队列回执。不是删除空白来规避差异。

先前 0.2.1 独立 IDB 置顶方案的桌面 Chrome 15 项存储断言与 6 项语义回归通过，但真实 Android WebView 133 的严格事务仍出现 ACK 后立即强杀回退旧值，独立新 key 也消失，见专项失败回执。没有把 headless 通过写成 Android 已修复。Chromium 的[公开说明](https://developer.chrome.com/blog/indexeddb-durability-mode-now-defaults-to-relaxed)认为 strict 会在 complete 前通知 OS 刷盘；当前观察不足以锁定其内部原因，也没有通过已废弃的 WebSQL 开关试图修复 IndexedDB（[WebSettings](<https://developer.android.com/reference/android/webkit/WebSettings#setDatabaseEnabled(boolean)>)）。

0.2.2 改为原生唯一权威，13 项 native mock 桥契约断言通过，明确仅验证接缝，不代替原生保存。原生 Java 已编译，Java 中实际注入的 JavaScript 另行抽出后语法检查通过。0.2.1 失败 APK 和证据保留。

0.2.2-frontend / code4 已成功构建。APK `outputs/2026-10-17-android-input-refinement/Shiye-Android-0.2.2-09ae6215.apk`，SHA-256 `09ae6215407e6b7315874fe85a50bbde323e53cd4992eca817ab8a615a6b2ef2`，91,315,451 bytes。全部 11,711 项 Telegram 打包资产逐项 hash 与构建清单一致，共享编辑核及适配文件逐项核对通过，许可和对应源码保留，无 INTERNET 权限。Gradle preBuild 新增适配资产与源文件一致性保护。

电脑曾因可用虚拟内存约 1.1 GiB 导致 2 GiB Gradle JVM 分配失败；崩溃日志保留于本轮 tmp。已关闭本任务闲置的 `Diary_Reference_API_30` 参考模拟器，主 AVD 保留，构建限定 1 GiB 堆与单 worker 后成功；未关闭用户软件或修改系统分页设置。

## 模拟器升级与数据保护

首次升级前实际 flush 得到确认，再停止应用并完整备份私有目录到 `var/android-backups/2026-10-17T22-10-12-428Z-before-input-refinement/app-private.tar`，38,202,368 bytes，SHA-256 `cc3d4997d513aa546f1b39841a5e2f0614a73fa6e4d0835edf6efa9347aa30e9`。覆盖安装 0.2.1 后、启动前的全部 249 个原私有文件逐字节一致。

0.2.2 前再次 flush/备份到 `var/android-backups/2026-10-17T22-31-56-229Z-before-native-preferences/app-private.tar`，33,352,192 bytes，SHA-256 `2801664293cdb1fa6c29c63a1df406bdb6e3ed40858feff1ee0562946012851d`；覆盖安装后启动前 215 个原私有文件全部逐字节一致。未卸载/清库/回滚快照；0.2.2 安装 Success、启动 Status: ok。

首轮强杀矩阵期间主 AVD 进程退出；Windows Application Error 未发现对应崩溃事件，现有 GPU 尾日志不足以确立根因，未归因于应用或 OOM。按原 `Shiye_API_36 / GPU auto / 3 GiB` 配置加 `-no-snapshot` 冷启动后继续使用原 userdata。真正原置顶为首份私有备份中的 `[-10]`，失败后的 `[]` 没有被当作最终原状态。

后续取证明确：22:32:45 的 0.2.2 首启，Chromium `backing_store.cc(195)` 报 `Corruption: missing start of fragmented record(2)`，随后 `bucket_context` 报损坏、`backing_store.cc(1500)` 报 corrupted/deleted database 后重建。摘录保留 `outputs/2026-10-17-android-input-refinement/chromium-idb-corruption-excerpt.txt`。这解释了随后 preview 空库/内存仅 3 seed；冻结 worker 的数据库名和字节未变、没有删除数据库的调用，不能归因于新 native 置顶。

主任务停止应用并留存完整现场到 `var/android-backups/2026-10-17-before-idb-recovery/app-private.tar`，仅从 22:10 原备份恢复 origin 的 LevelDB 与 blob 共 8 文件；247 个其他私有文件逐项 hash 保持，没有回滚 SQLite、日记或媒体。恢复后 4 个原会话的消息哈希与首轮 QA 基线全部精确一致，原置顶 `[-10]` 保持。恢复后的干净独立 IDB key 再次 strict/oncomplete→立即强杀实测保持，因此早先失败发生在受损 origin，不能概括为全部 WebView strict 无效；具体损坏产生原因仍未证实。

定向 Android 交互验收由[专项 QA](2026-10-17-android-input-refinement-qa.md)记录：0.2.2原生偏好19项通过，多段草稿仍失败。该草稿竞态已在后续0.3.0修复并真实验证54字符五段/跨页/冷启/发送精确保持，见[前端细化验收](2026-10-17-android-frontend-polish.md)；不追写为0.2.2整轮通过。

## 项目检查与边界

最终 `npm run check` 的 323 个模块检查与 ESLint 通过，在并行会话的 `tools/verify-revisit-ui.mjs` 格式告警处停止；没有修改该文件或宣称完整 check 全绿。本轮 Android 文件和文档的定向格式检查通过。另以 `SHIYE_TEST_NO_DESKTOP=1 / SHIYE_TEST_CONCURRENCY=2` 完成 `npm test`：671 项，670 通过、1 桌面跳过、0 失败。

本轮不把 CDP 插入中文等同真实输入法组合/候选确认，不扩展照片发送、旋转、长期后台或跨端数据兼容的验收结论。手机当前仍为 0.2.0，相关记录见[手机安装与手测](2026-10-17-android-magic7-install.md)。

成品、哈希、构建/项目检查及 QA 回执位于 `outputs/2026-10-17-android-input-refinement/`；临时构建/脚本在 `tmp/android-input-refinement/`，APK 编译目录沿用 `tmp/android-dual-prototype/app-build/`；私有备份只留 `var/android-backups/`。
