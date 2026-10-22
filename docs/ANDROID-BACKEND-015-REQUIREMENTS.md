# Android 0.15 后端适配阶段

2026-10-18用户安排：先完成当前UI并保留数据部署手机，由用户测试；然后继续Android通信后端、长日记算法与朝花夕拾入口适配。0.14/code16已在手机与主AVD运行；本阶段源码候选独立标记0.15.0-backend-preview/code17，不自动覆盖手机。

依据[最新接口审计](ANDROID-BACKEND-015-HANDOFF.md)，先实施不会改动现有内容权威的两条接缝：

- 015-A：独立设备同步设置页，固定sync/v1 health/pair/info；独立地址、AndroidKeyStore AES-GCM凭据、libraryId/epoch守卫、异步取消及可回父页。成功仅表示已配对并核验身份，内容同步保持关闭。
- 015-C准备：完整Entry信封、未知字段、独立附件、原时间与基线保留；复用电脑真实prepare/reassemble/paragraph投影，返回只读派生计划。未知格式/版本和canonical篇继续保护；新Repository未落地前不能调用旧LocalStore假装完整保存。

后续015-B/D才实施完整本地权威、内容与outbox同事务、远端inbox与游标同事务、原件任务、双端冲突和保留式旧库切换。015-E才接真实会话身份/服务绑定、独立朝花夕拾规则、持久来信、原文和评论。现有只读服务目录/状态入口继续保留，不能把UI按钮或配对成功当成规则已执行。

当前云服务器由用户另行配置，本阶段只使用本任务新建的隔离测试服务，不动18769/18779、正式日记、后端运行实例或云端。HTTPS走系统TLS；HTTP仅loopback隔离联调。后续局域网/Tailscale明文接入需结合真实部署边界配置专属网络策略，不全局开放WebView联网。

工作目录D:/拾页；产物outputs/2026-10-18-android-backend-015，临时tmp/android-backend-015。配对码等短时凭据只放本地私有var/android-backend-015-qa，不进入日志、源码交付或报告。
