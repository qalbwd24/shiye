# 持续 appearance 资源与已审组合的窄后继

2026-10-20，只在私有候选实施，未部署、未改正式库或 localStorage、未操作 UI/设备。保留原 `6a10/b020/1fca` 冻结及其第15批独审，不以本次候选覆盖原审批。

最终冻结入口：`outputs/2026-10-20-composed-appearance/candidate-1792488052384/handoff.json`。原 `candidate-1792487877920` 不变，最终只在其客户端补目录启动失败隔离；后端及fallback精确复用。

| 产物 | 精确 SHA256 | 范围 |
| --- | --- | --- |
| main | f2d25859c2717f8afebaf1825530bfd97833e8896a5d64dccd5e1ad51af08904 | 167源/483依赖 |
| 同schema fallback | faf07f20e1c68f94c13ba12699e0760ea8a0d2bb1a314cbdb63dd0189f0b714e | 相同全部源码；四写flag均false |
| client | 65673563c2891659a4f6069a1d7af1161993564563b7532cd49add30955d1c9d | 72源/100内部依赖/22Java |

基于已审 appearance patch `b5c3832f528d978b2bad1c3415a58d3cf2bc9e74164d1810853f1de27fb6b8e6` 的五源语义增量。server proof `3dca1d65…`、source-collection `24ae98ce…` 保留原批准字节；computer-export 在最终组合版本只增加一个固定本地管理 action→route 映射，冻结脚本反向移除此行后与6a版本逐字相同，未回退 e8a 固定代际算法。通用偏好262144 UTF16预算、known key、2MiB raw预算和原 source ACL/私有品牌/原件验证不变。

运行时额外接缝仅在原PC数据runtime与该 public helper：默认接入受控图片 reader；可显式传 `preferenceResource:{request,owner,source}` 复用原成功source收据。owner必须与runtime配置同library/epoch。该 request 是原local-admin固定动作端口，不并入 paired shared methods，也不接受目标磁盘路径。source proof的 `captureRawSha256` 为实际原采集key的raw SHA，`sourceMemberSha256` 为整个原preferences成员SHA；当前raw的SHA仅回显绑定本次客户端读取，不能称服务器看过当前raw正文。

后来新选图片在原收据中没有相同图片或当前已换指针时，使用原 `createSharedMediaClient` 的 begin/chunk/complete，与library/epoch/source/fullSHA/size/MIME绑定的稳定操作UUID及原IDB cache复用耐久上传收据。图片签名字节/MIME、完整SHA、大小和返回asset均核对；只在模块内WeakSet品牌的真实上传结果可走新图分支，caller造 `proofKind` 不算证明。随后仍由原偏好采集/CAS保存mediaUUID，不生成sourceCollection收据、不声称重新采集完整、不改原localStorage。初次接入时本机与服务器偏好不同，仍保留原显式对账门槛；没有借资源迁移绕过冲突保护。

目录端口逐key读取：坏资源保留该key的原耐久checkpoint（首次使用保当前owner值），不会形成删除；其他key仍走原CAS。`preferences.blocked`报告key/code，原onError仍回报；独立已发送消息继续启动。非作者窄审指出目录snapshot自身失败也应隔离，最终仅catch异步`directoryPort.ready`，端口已报onError后继续独立sent；client.start/uploadJobs与owner身份失败不在此catch中，sent自身失败也保持原流程。新的 `runtime.captureDirectory()` 只显式调用原端口collect，与原captureSentMessages同类数据入口；没有新增UI或队列。

实际fixture只读复用既有588采集、成功source操作 `10e2d1be-7e6a-4a56-8405-6eeffbe5b561` 及签后owner备份。raw为1,158,568字节，SHA `a40cd63cda618bc76ed1042191691dadfe2da89d4f903596218289acdb486470`；当前采集preferences成员SHA `90b391300b00cb6314e4e40f8ea10974f6e8d0d75fd3f4aa89fa631521161134`；图片868,771字节、SHA `61504d972f487e99cb1114c109de47f448df394fdb7b14c3704bb3651dfcf743`，原媒体UUID `903789f7-904a-45db-827e-2e7a5fec7a10`。原 generic reader 确实拒绝，受控投影后原false/未知字段保持。实际HTTP仅运行在新私有F盘克隆及随机loopback端口，没有正式HTTP或新采集/签包。

定向验证：实际原收据/成员/fullSHA/原件与品牌反例；真实runtime旧图复用、新选图上传/CAS、未知大资源被拒但新sent写入HTTP；caller伪造上传证明、错误hash、假图片、超2MiB、local读取代际变化、单坏key不删除且其他偏好仍CAS，前冻6个直接场景全过；最终一runtime窄catch再加readSnapshot throw而原耐久sent真实HTTP落库1项，共7个直接场景。6源定向lint零诊断。新图测试先建立真实旧偏好checkpoint再模拟用户换图；首次试验未建checkpoint触发原对账门槛的失败保留，未放宽产品规则。第一轮receipt没有roomId字段造成夹具identity错误也保留。日志 `bootstrap-first/second/third.log`、`frozen-six.log`、`directory-isolation.log` 分别记录，不称首次全过；`combined-bootstrap-evidence.json`明确前6与最终catch增量证据的精确客户端身份。

Android JS bundle `57975267…` 和22Java全部原字节；native known5/unknown6等六项及原30生命周期、旧组合19相关证据按未变SHA复用，不重跑全矩阵。`source-map.json`列完整新旧SHA与唯一旧journal观察边；不把整套PC UI称已闭包。桌面实际恢复图片的renderer resolver、产品启用、设备首导和新的部署维护不在本数据slice，`continuousSyncReady=false`保持。准确f2d/faf/6567已获非作者第十七批限定批准，仍无正式维护/发布或设备许可。

审查索引 `review-index.json` SHA `c8106c524bcbe98426cdcd99681bc44b5f15c4b42b160236b3c67d8e5abbc996`。以索引引用的 `combined-bootstrap-evidence.json` 为合并事实：单独 `actual-bootstrap-evidence.json` 是最后一次name-filter运行的局部输出，未执行的原证明检查旗标为false，不能解释为原证明失败；前冻全6项日志及 `pre-directory-bootstrap-evidence.json` 保留其true结论，合并文件逐批标注。

独审收口另出 `review-index-approved.json`，SHA `1b4cbbd22c9d0ea561cc3fbab8fdcee1a8aec8d74185ea706c8e2b934583df32`，逐SHA绑定非作者 `appearance-freeze-independent.json`、`appearance-delta-independent.json`、`appearance-bootstrap-independent.json`、6项正向日志及目录失败原反例/复审回执。稳定 `outputs/2026-10-20-composed-backend/current-review-locator.json` 与appearance目录同名locator均已实际写入并重读确认准确新handoff和该批准索引；前者SHA `98ca9b53ba527ed2a0501ed83e1e2bd4b9b8b834202027b5083a82633034b9a0`。原current locator逐字另存，不覆盖旧冻结/审批；这仅为候选交接准入，不是部署或资料包交付许可。
