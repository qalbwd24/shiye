# 独立后台程序参与会话：实现回执

本页由实现者维护；审批以[独立Sol报告](2026-10-19-shared-business-independent-review.md)为准。2026-10-19，源码及隔离数据接线通过，未部署正式服务、发行正式凭据、安装手机或操作前端5554。

机器人/程序使用独立可撤销Bearer及动作scope，绑定原库/epoch/实例/绑定/会话。显示名允许修改和同名，稳定actor为`program:<instance UUID>`，历史消息保留发送时署名及backend-service来源。用户明确授权的服务在前端密码页继续读写；普通前端密码保护保持。原legacy房owner、ID、引用及归篇算法保持，程序写入仍走原业务事务。程序不提供replacement，也未执行AI模型或任意安装/进程脚本。

接口、Node SDK、私有凭据CLI及无UI单步合成worker见[服务契约](../BACKEND-PROGRAM-PARTICIPANTS-V1.md)。CLI文件写入失败会回滚发行/轮换，旧token保持；文件与SQLite跨介质崩溃边界按契约说明。

独立发现的P1为撤回不存在评论时写入无author墓碑。已改为仅程序上下文missing拒绝且原JSON/索引/回执零写，trusted admin离线撤回兼容。原失败及原反例复审保留在独立报告。旧`20261019-shared-business-1792438254620`包含该问题，不可发布。

最终候选为`outputs/backend-runtimes/20261019-shared-business-1792438691897/runtime-manifest.json`，SHA256 `b81067ab725038646bc63b14fb5cd7cf2036f485b3c8b45daef2d59b7d6c2428`。独立核134/134文件、352 AST相对依赖、99原baseline及来源缓存保持、无overlay漂移，并从冻结包实际启动port0、发行合成token、通过SDK在原legacy房发送/收件。证据`outputs/2026-10-19-shared-business-independent-review/program-final-freeze-independent.json`。

根集中29项程序/SDK/会话/HTTP/auth定向通过；missing-comment修后仅重跑受影响program7＋conversation8共15项，其它未变路径复用。独立另自写3项真实HTTP，亲自执行program7＋SDK3及修后评论场景：覆盖冒名、replyscope、慢body期间撤销、同名改名、重启/轮换/解绑重绑/epoch、800k原件往返、同房引用撤回后媒体权限失效、大feed分块期间水印变化拒绝、CLI输出失败回滚。各范围不合并冒称全项目或设备验收。

修后冻结包在真实库私有副本3157篇/3137媒体通过，除新增shared索引外原业务保持，sourceSessionCache=1，正式指针不变。证据`outputs/2026-10-19-shared-business-integration/real-private-copy-134-program-fixed-compatibility.json`；这项是实现者私有副本验证，独立代理只核回执及对应包SHA，未冒称独立重复实库试验。

PC两个seed固定桥另有独立容量delta：`outputs/2026-10-19-shared-business-integration/pc-seed-capacity-delta-1792438632139/delta-manifest.json`，SHA `183f9d51c43d2e7c53cda15be4d85eee6f3f479c5ad2b555165745a860711429`。四源SHA与22容量真实C# HTTP检查经独立复核，旧31固定桥业务自验保持。仅桥到HTTP两口34MiB，DesktopPreview外层8MiB未改，不能称PC页面端到端32MiB完成。见[容量回执](2026-10-19-shared-pc-seed-capacity.md)。

前端继续使用已验client56纯数据冻结基线，结合该C#窄delta按需接入；不混入正在并行的ui48 A1或Android023局部界面包。完整两端页面、旧独立本机原件采集映射、真实整包传手机、实际网络/设备及正式启用仍需对应接入验收。正式`config/backend-runtime.local.json`仍为chat-reedit2，未创建shared默认启用配置。手机旧测试资料依用户要求先保留，未分类/移动/删除。
