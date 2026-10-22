# PC两个固定shared seed口容量回执

2026-10-19，独立native实现者自验，不代替独立Sol高审批。

需求：manifest上限32MiB，seed-register/seed-resolve envelope上限34MiB；PC原ChatJournalBridge通用serializer8MiB字符导致容量差距。仅两个固定seed动作选择独立34MiB serializer，并对请求UTF8 bytes、响应声明长度及流式累计bytes限34MiB；其它shared固定请求/响应仍8MiB，legacy通用/renderer/DesktopPreview保持原值。没有任意URL/path或调用方可选limit。

源码：previews/telegram-chat/ChatJournalBridge.cs（SHA256 0292628ce236861d6f640da25b0e27cdde5e8a35696f089ff099b70bcdb33ffb）；tests/helpers/SharedPcBridgeProbe.cs仅console测试harness；tools/verify-shared-pc-capacity.mjs为复现入口。未编辑DesktopPreview/JS frontend owned文件。

验证：

- `node tools/verify-shared-pc-bridge.mjs`：补丁后31真实C#console＋合成业务HTTP检查通过，12固定shared方法/分块SHA/原件roundtrip/unknown零网络，pc-native-0504acaf-222d-48a3-8fa9-a6f06ed17259。
- `node tools/verify-shared-pc-capacity.mjs`：22容量检查通过，pc-capacity-d4486c62-9fe3-4ebe-922e-c8c37c0c2096，summary.json、sources.json、compile.log、cleanup.json。9.1MiB合成完整格式roster到实际共同owner后按业务集合不符409，真实当前小rosterregister/resolve成功；独立transport fixture证明两seed 9MiB请求/响应成功、34MiB界外请求及chunked/declared响应拒绝，UTF8 byte上限独立于字符数，普通fixed8MiB限制保持。
- tools脚本定向lint/format通过。没有扩全项目/设备矩阵。

边界：独立HTTP fixture的大响应不代表正式seed业务响应会有9MiB；不伪造大roster已登记。原renderer/宿主8MiB入口未改，这轮只验证native data port，因此不声称PC UI可以传32MiB。未启动产品EXE/UI、未挂renderer（rendererAttached:false）、未写TL IDB、未安装/操作设备或切换正式服务。服务均为脚本自建ephemeral loopback，cleanup确认关闭。
