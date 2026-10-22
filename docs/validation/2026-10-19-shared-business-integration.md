# 共同业务库后端与跨端数据主链验收

最终追加已独立通过：机器人后台授权/SDK/CLI及新134冻结包`20261019-shared-business-1792438691897`，未知评论撤回P1已修；旧1792438254620不可发。PC seed容量delta按桥→HTTP分项通过，外层WebView仍8MiB。[实现回执](2026-10-19-backend-program-participants.md)与[独立报告](2026-10-19-shared-business-independent-review.md)末两节为最新结论，下方待审属历史。无正式服务/手机部署，完整页面与真实互通仍未验。

最新分项按[独立报告](2026-10-19-shared-business-independent-review.md)与[接线契约](../SHARED-BUSINESS-INTEGRATION-V1.md)顶部记录：旧99/72为早期自验，之后4P1/2P2均保留反例并修复复审。backend128/client56已独立冻结通过，原生实际为Android16固定动作/PC12路径；页面/旧本机资源/设备/正式启用未验。新机器人后端134文件/352边已冻结待独审，根定向29/29，私有实库3157篇/3137媒体业务不变；CLI失败回滚与Node SDK边界已覆盖，未正式发行token或执行AI。PC两个seed动作容量正补单独回执，不以旧client56通过代替新C#验证。

本页是实现者自验回执。用户最新要求的独立Sol高审批已另行启动，结论以[独立审查](2026-10-19-shared-business-independent-review.md)为准；本页测试通过不等同独立需求审批通过。见[角色约定](../BACKEND-INDEPENDENT-ACCEPTANCE.md)。

2026-10-19。用户要求“尚未实现就去实现”，本轮继续实现同服务器、同组业务数据、同等业务读写的后端和数据接线。思绪、随想、朝花及未来程序/AI配置在范围内，便签排除；AI只登记，不执行。未安装手机、未操作前端5554、未停止日常电脑程序。

## 实现与证据

唯一业务owner仍为原 `library-store` JSON；新增shared/v1固定网关、同事务增量/幂等回执、原子程序参数、共享pin/archive/order、惰性clientMetadata、独立WebView偏好key-patch/CAS。复用原Entry历史/评论、legacy消息撤回/原时原位replacement、模板/分类与收藏规则。未迁普通房messageOwner，不建第二业务SQLite（仅设备鉴权独立SQLite）。

原件分块、大小/SHA/偏移、断后重放与去重完成；已知旧文件缺失时保留新原件并拒绝虚假成功。大实体按字节分页/descriptor读取，完整校验再提交；大正文离线Blob+ref同事务，重开后上传并复用原业务保存。13个固定原生口，不接受调用方任意URL/路径/动词，不包含安装APK或下载插件执行。

Android已在原入口按显式配置注入shared source/canonical目录，默认legacy保留；PC新增可调用持续目录端口，原source UUID/20位ID/空分类空房保持。两端偏好实际读取已知localStorage/现有native只读load并持续采集，原对象/数组/未知键保留；冲突不覆盖双方。本轮未合并完整设置表单或替换日常PC/Android页面。

主要实现契约：[同库接口](../SHARED-BUSINESS-INTEGRATION-V1.md)、[Android runtime](../ANDROID-SHARED-RUNTIME-V1.md)。

## 最终定向验证

`outputs/2026-10-19-shared-business-integration/final-core-after-fix.log`：**99/99**，涵盖真实HTTP、真实IndexedDB事务port(fake-indexeddb)、独立DOM及worker广播：

- 双客户端同ID目录新建/修改/pin/archive/order、多slot参数、原ID未归类空房、同名不合并、未知扩展保留。
- 原电脑API写→共享拉取，反向保存→原API读；重启与丢ACK复用同operation，旧revision/错库不提交。
- 草稿晚写/离线重开、撤回/原时原位replacement、固定历史来源/评论、图片原件/收藏CAS。
- 超过8MiB资料和离线大正文save/create：本地Blob重开、ref小wire、分块hydrate、原history/导入未知字段保留。单场景native cap shim实际request/response均小于1MiB，非64MiB吞吐或真机验收。
- Bearer配对/重启/撤销、Host/Origin/设备绑定、local-admin、锁cookie、LAN伪造Host不能访问旧API。
- 原子游标/ID-only会话索引、过期重快照、确定拒绝暂停/显式恢复、未知ACK禁止丢弃；偏好基线+outbox CAS、真实来源采集/重复无新写/冲突保留。

`final-adjacent-tests.log`：**72/72**，只跑受影响旧journal/replacement、目录、会话/消息、迁移metadata、原件算法，不跑项目全库。初轮 `final-core-tests.log` 为89/90，一次Windows EPERM出现在合成库启动rename；随后只对同一原子rename最多4次尝试（20/60/180ms等待），不重跑业务函数、不删除旧库。`windows-rename-recheck.log` 12项及最终99项通过；最终新增真实文件失败回滚测试在 `library-commit.test.mjs`。初始失败未删除。

定向ESLint通过，`final-lint.log`；最终相关文件格式另见 `final-format.log`。实际Android早期29断言只覆盖当时固定传输；后续49 host Java HTTP断言覆盖鉴权/原件，Android平台port被替代。最终13口有Android harness编译；新runtime、偏好、entity/read未在最终设备APK运行，不把host或DOM测试算成设备验收。证据分别在native-shared-*、host-auth-*、runtime-bootstrap、runtime-preferences子目录。

## 冻结与真实资料兼容

`tools/freeze-shared-backend.mjs` 以原chat-reedit2冻结包为基线，只叠本轮业务/存储/接口模块，遍历AST相对依赖；配置路径锚点继续指原工作区，来源缓存实现保持原冻结版本。

最终包 `outputs/backend-runtimes/20261019-shared-business-1792433517464/runtime-manifest.json`：**121文件、324相对依赖**，清单SHA256 `02c3eb16e94dcbb578c78253116b4d0c481d49c3a0288f5cc86f2d0d35f90a86`。逐文件hash已核验，未改已有冻结包或正式指针。

真实JSON仅复制到原stateDirectory私有performance-audit目录，启动冻结包的隔离副本，无正式测试写入。3156篇、3132媒体；只增加_sharedSync，删除该新索引后业务JSON对象hash完全相同；shared实体6367，来源缓存能力1，冷启动约469ms。此处媒体原件未全量复制/打开、未发测试消息/运行推送，不能称完整媒体或所有内容展示已验。原文没有写入公开产物。汇总 `real-private-copy-compatibility.json`。

3150篇/约17MiB合成测量最终保存中位约190ms，未启用约80ms；改前约211ms，存在336ms离群。热pull约0.05ms、留存heap约17MiB，仅合成独立进程/短样本，仍有全JSON clone/hash/rename成本，不称日常长期性能结案。报告performance-2026-10-19T17-49-44-972Z.json保留源码SHA/负载边界。

## 安装、正式启用和后续边界

源码与隔离接线完成，后端冻结候选完成；正式仍选择chat-reedit2，`config/shared-backend.local.json`未创建。未更换正式服务/桌面资产/手机APK，不把本回执当两端日常页面已经同步。前端UI022依旧冻结021引擎，后续合并新固定口及完整设置/日记页面时按版本与catalog接入；PC端口需明确bootstrap启动，日常PC聊天远端收件仍须其前端适配。

已有.syseed/受限ZIP解压/安装候选证据保持原协议归属；不能把旧Product来源快照包直接当本轮共同JSON的可写库。实际全资料导入、最终Android WebView/Magic7、真实远程HTTPS/多出口、完整程序设置UI、超大原件持久sink及长时间负载尚未验。用户明确先不装手机，保持该边界，不通过安装测试包循环实现服务更新。
