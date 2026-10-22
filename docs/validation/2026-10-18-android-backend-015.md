# Android 015 后端候选：配对与长文准备

2026-10-18。用户先测手机UI，再继续后端适配。**手机与主AVD均保持已交付0.14/code16**；源码候选0.15.0-backend-preview/code17仅以独立包`dev.shiye.backendqa`运行验证，最终QA APK SHA-256 `a7832dce46c2fd62d20c2dc7b102cb3472042b94d69e46504268d4694d542c6e`。没有覆盖主包、迁移旧资料、接云端或自动上传。

## 完成的接缝

1. “服务连接→设备同步与配对”是独立子页。地址、识别服务、配对码/设备名、校验已配对连接分开，返回回真实父页；未保存地址有明确放弃提示。网络使用专属队列，可取消，不占日记保存队列。错误仅显示客户端安全分类，凭据不返回WebView。
2. `AndroidSyncTransport`仅支持固定health/pair/info。业务/收藏地址与sync地址独立，库libraryId及epoch固定保护；地址变化取消旧代际，不能把另一库误当本库。HTTPS使用系统TLS，HTTP仅localhost/127.0.0.1，不开放任意URL/请求头/全局明文网络。
3. token经AndroidKeyStore AES-GCM密封后写私有偏好，地址作为AAD；没有明文回退、token导出或后台内容同步循环。配对/连接成功只核实设备身份，`contentSyncEnabled=false`。
4. `entry-save-preparation.js`复用电脑原prepare/reassemble/paragraph模块，保留完整信封、未知字段、日期、内容时钟、独立附件、稳定媒体出现身份及baseRevision，返回非权威派生计划。旧/未知格式、版本、canonical权威和不一致布局保持只读；`canCommit=false`。仅把该精确本地JS路径加入编辑WebView资源白名单，Telegram仍拒绝非其目录资源，没有放宽联网策略。

## 验证

- 原生传输：97项真实隔离sync服务/JVM HTTP断言、AES-GCM密文/篡改/错误密钥、前缀、认证、取消、另库/epoch等；Android36 SDK编译通过。JVM密钥替身与实际AndroidKeyStore证据分开。
- 真正Android QA：默认未配对/未同步→带路径前缀health→实际配对→私有偏好为密封格式且无明文token→关闭/重开子页后解密并校验→返回父页，6项通过；另实际强停/重启QA进程后仍可用系统密钥解密并校验，共7项。最后APK复验保存凭据的连接校验成功。
- 长文：6项Node/真实Chrome一致性测试通过；实际Android编辑WebView加载本模块，整个跨端fixture返回对象与桌面逐对象完全一致，prepared=true、canCommit=false。合成正文没有经该模块写入LocalStore。
- 最终QA Gradle构建通过。`npm run check`已执行，路径检查通过，lint被并行后端`src/server/sync-product/service.mjs`的未使用device和`tests/sync-product.test.mjs`的未使用productValue阻断；未代改并行代码。新JS与测试定向检查通过，不宣称全库check成功。

Native UI早期测试因重复“配对此设备”标题点错控件，已去掉冗余标题后重测。AVD的ADB shell/uiautomator曾再次卡住，经仅冷重启该AVD恢复；未重启整个ADB服务、未操作手机。编辑模块起初被精确本地资源白名单拦截，补入单一JS路径后实际WebView验证通过；没有以广泛开放资源/网络绕过。

## 未完成与下一步

当前生产保存仍走旧LocalStore/TL各自的原路径；准备模块没有获得写入许可，不是完整Entry Repository、canonical写入、outbox/inbox或跨端同步已完成。朝花夕拾仍只有既有只读服务目录/实例状态，真实会话UUID/实例创建绑定、规则设置、持久收件、原文/评论尚未接通。下一步依[015交接](../ANDROID-BACKEND-015-HANDOFF.md)补完整本地信封与单事务权威，再接增量/原件和业务服务。

并行后端已出现`sync-product`候选源码；本轮未将其未经本客户端验收的能力当成已部署。后续重新读最新前端契约并以实际health/info的product能力和业务路由核验，不能冻结本文历史审计为“永远没有统一业务桥”。

## 产物与清理

产物`outputs/2026-10-18-android-backend-015/`，含`qa-install.json`、`qa-native.json`、`qa-entry-module.json`、`transport/`、`entry/`、构建/检查日志和独立QA APK。临时`tmp/android-backend-015/`。本任务专用随机端口合成库与QA包测试后停止/卸载，自己的AVD reverse移除，短时配对码删除；旧测试服务及正式服务、主包和手机数据不动。主AVD最终恢复运行0.14供用户检查UI。

需求：[015范围](../ANDROID-BACKEND-015-REQUIREMENTS.md)。实现：[同步连接](../ANDROID-SYNC-015-TRANSPORT.md)、[长文准备](../ANDROID-ENTRY-015-PREPARATION.md)。
