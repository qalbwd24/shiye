# 共享持久媒体任务 V1（源码候选）

2026-10-19。本模块落实[023跨端契约G7](ANDROID-023-CROSS-DEVICE-UI-CONTRACT.md)的数据层；没有UI、手机安装或OS后台常驻。独立审批尚未完成。

`public/shared/shared-upload-jobs.js`导出`createSharedUploadJobs({storage,client,media,libraryId,epoch,openHandle?,idFactory?,clock?,maxConcurrent=2,onChange?})`。storage必须是公共shared client实际使用的同一transaction port；所有任务写入`local-media-job`实体，绝不把Blob放进meta或JSON command。libraryId/epoch固定且与同库meta核对。没有第二Product/SQLite业务owner。

`enqueue({operationId?,messageId?,conversationId,sourceId?,roomId?,sentAt?,text?,replyTo?,messageOwner:'legacy',attachments})`只在实体事务提交后返回任务summary；调用方据此决定清首次草稿/挂进度占位。当前只支持实际已接的legacy journal owner。默认messageId与已有shared-source一致，由首次UUID推导20位字符串；首次sentAt/createdAt、canonical room及sourceId/旧roomId、replyTo、caption文字、附件顺序、每件uploadOperationId固定，不读后续当前openRoom。相同operationId再次enqueue明确拒绝，恢复必须retry原任务，绝不替换原件或改意图。

附件为`{blob,name?,mime?}`（原始Blob直接由IndexedDB结构克隆保存）或`{handle,size,sha256,name,mime}`（持久原生opaque handle，不能是路径/blob URL）。openHandle(handle,metadata)返回`{size,sha256,read(start,end)}`，read只能分块≤256KiB。handle完整SHA先流式核验，media client再沿固定uploadOperationId分块resume/complete。每块ACK的transferred与错误/最终asset元信息持久到该job；原件按附件顺序汇合为一个消息。

任务状态queued→uploading→ready→submitted→acknowledged，failed只显式retry，cancelled不发布。maxConcurrent仅限制媒体任务；原件上传不占普通client outbox。全部原件完成才冻结一个journal-send command（同job operationId、同messageId、原sentAt、caption/reply、完整有序附件），先持久ready再client.enqueue，重开时可重放同wire。submitted只以client.readOperation真实acknowledged结束；pending/blocked保留占位/原件和原wire，不能取消、换ID或换时间。

`start()/resume()`显式枚举并恢复queued/uploading/ready/submitted；`retry(operationId)`恢复同任务；`cancel`只许command冻结前；`list({conversationId,includeCompleted:false})`/`read(op)`返回不含Blob/handle的summary（含messageId、原sentAt、每件上传进度与asset）；`reconcile()`只核对已有outbox ACK；`waitIdle()`用于调用者等待当前工作；`dispose()`停止调度、abort后续块，保留持久任务/原件供新实例恢复，无自循环重试。网络已在途的一次请求可能完成，但不会据此清任务/发到新房。没有OS service；仅active任务有界租约续约timer，dispose清除。

根持有shared-chat-source/runtime接线：对同messageId去重，把summary作为独立media-jobs scope在原sentAt位置合并；提交前普通文字继续走原outbox，正式ACK到来后与同ID实际消息合并，不通过换ID删除重建占位。不要把enqueue返回的localAck当服务器消息ACK。

当前定向tests/shared-upload-jobs.test.mjs使用真实HTTP+fake IndexedDB，恢复持久Blob/同uploadOperationId断点、两个附件和caption/reply同消息、dispose/取消、不可变ID拒绝、原生句柄分块及坏SHA拒绝已通过。首个“文字先ACK、早1秒媒体随后保原时发送”实际复现旧appendChatMessages第401行拒绝早时消息，已交根修复；未修复并复验前G7不能称完成。没有16GiB压力、真实Android WebView/设备或系统杀进程后台常驻验证。

## 延迟媒体的归篇兼容（根/数据代理已确认，实施中）

job冻结journal-send的input另携`deferredMedia:{uploadOperationIds:[按附件顺序的首次UUID]}`。服务端必须按每个上传operation查同资料库完备receipt、真实原件hash/长度并与消息attachments逐一对应（去重原件允许返回既有assetId）；仅此明确路径授予内部late-media许可，普通legacy原API不放宽。

安全的当前open归篇、投影未被手改、原分类一致且在idleHours内时可按原sentAt插入原组，firstAt取最小、lastAt/idle deadline取最大；不把原较晚文字的时间/位置重写。原归篇closed/manual/过老等不满足条件时，媒体独立创建closed归篇；旧entries JSON逐字段保留，不能关闭当前最新open邻居或把它重新归组。消息仍使用原ID/operationId/sentAt，不能借晚完成更换时间。根委派data_coverage实施该最小业务兼容，独立审核未通过前仍保留G7未完成。

数据模块追加覆盖两件有界并发上传、第三排队、已在途任务取消后不发布；测试通过。新增丢业务ACK重开同wire不重上传、持久outbox handoff中断不可取消并原wire恢复也通过。当前总计8个定向场景，其中首个早时媒体仍等待上述后端修复后复验。

## 2026-10-19 媒体job定向复验（源码/隔离通过，独立审批待复审）

受控late归篇修复已由data_coverage完成，旧早时409保留为本轮已复现缺陷记录；当前jobs9项＋deferred-media3项共12定向通过。包括文字先ACK后媒体保持原time/ID完成、重开断点/Blob、caption/reply/多附件同消息、丢ACK及持久handoff中断原wire恢复、两件并发第三排队/取消不发布、草稿revision同事务清理与回滚、caption500000原上限，以及late归篇旧邻居保护/legacy伪造拒绝。证据outputs/2026-10-19-shared-business-integration/media-jobs-3cb55b4c-956f-4ddb-b9ea-eb8bd2df1b8a（tests.log、sources.json与摘要）。不宣称G7独立审批、真实Android/PC renderer、OS杀进程常驻或16GiB压力已验。

根追加draftClear接线约定：enqueue可带`draftClear:{scope:job.conversationId,expectedRevision}`，scope必须当前任务的固定canonical房；和putJob同事务匹配原revision才清text/reply并revision+1。stale保留新稿、commit失败两者全部回滚。上传完成与ACK时不再清草稿。caption按旧journal业务上限500000字符在本机冻结前拒绝超限，保留附件/草稿，不等上传后污染普通outbox。

## 同一IndexedDB多控制器租约（候选补强）

每个任务在同实体保存`lease:{ownerId,token,expiresAt}`；同IDB事务原子claim，只允许有效租约owner处理。租期60秒，active worker每15秒续约，覆盖大Blob hash期间尚无chunk进度的阶段。每次worker状态/进度/失败/ACK写均校验owner/token；旧worker即使持有已在途请求，租约过期被新owner接管后也不能把成功任务写成failed或倒退进度。相同不可变upload operation仍有服务端幂等保护，但不能以此代替本机状态fence。

`dispose()`现在返回Promise，先abort/清租约timer、再事务释放仅本controller的lease；runtime应await后再关闭storage。显式cancel撤销租约，新旧worker后续写均失效。异常硬杀遗留lease最长60秒；另实例在有效期内不抢，只按expiresAt设单个有界wake，到期重新事务claim；若旧owner已续租则按新expiry重排。冷重开无需再手点retry，dispose清wake，不轮询原件/忙循环。

当前12个jobs（原9＋两个IDB连接/controller竞争、expired takeover后旧worker晚进度/失败、dispose释放后立即接续）＋3deferred共15定向通过；证据outputs/2026-10-19-shared-business-integration/media-jobs-lease-2510db57-e0ff-45ad-8d5d-ff46b7582f16（源SHA/日志）。此处“真实IDB连接”指fake-indexeddb提供的两个独立连接及真实事务实现，仍非Android WebView/物理设备。根source/runtime接线另验，独立审批仍待复审。

最终新增租约到期自动恢复：每个被占job仅一wake timer（最大60001ms），到期只重新事务claim；活owner续约则按其新expiresAt重排，已完成/取消不重启。timer可unref，dispose清除；同注入clock/timers的IDB测试覆盖首次wake遇续租再次排期、旧owner死亡后自动接管、dispose取消wake不删除另一owner租约。最终14job＋3deferred共17定向通过，最新冻结证据outputs/2026-10-19-shared-business-integration/media-jobs-final-5b89cc5a-c3c5-4943-944c-3f2bad1fd33e，含源码SHA与日志。此前15项/需显式重试状态为中间阶段，最终冷重开会自动在租约可接管时继续。根runtime/source合包及独立审批另记，未启用设备或正式服务。
