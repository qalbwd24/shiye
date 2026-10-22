# 朝花夕拾第五步：后台接入模拟

用户授权自建独立后台模拟实际接入，继续项目，不占用其他会话屏幕。此轮没有打开浏览器/产品窗口，没有桌面操作，没有连接日常API、读写正式日记或运行维护升级工具。临时服务只监听系统分配的回环端口，结束关闭。所有种子都是合成数据，不由私人日记派生。

## 实现

收件核心拆为previews/telegram-chat/shiye-revisit-client.js，原随想包装层复用；不另造一套模拟发送逻辑。它负责单飞同步、分页前进检查、媒体分段完整性、评论与撤回outbox、持久目标恢复。每轮重查原记录可见性，不能只取新增而留下失效原文。新增context固定桥动作与HTTP错误状态传递。

本地worker新增源缓存清理，在401/403后清除来信正文/媒体及自动引用缓存，保留个人评论与未发操作；目标、评论确认、撤回确认改为先写成功再替换内存。修正现有本地用户ID类型交叉为never以及来信out标志与Telegram TL“true或缺省”契约不符的类型问题。

prepare-preview/manifest收录新模块，构建准备时按模块内容hash更新传递依赖版本，避免旧模块缓存。此轮未运行整个预览准备/打包或原生编译，不能当作正式升级回执。

## 可重跑测试端

在D:/拾页执行`node tools/revisit-integration-lab.mjs`。不接受URL、dataDir或正式库参数。使用真实createDiaryServer、本地HTTP请求、真实shiye-journal.js（Node VM、无DOM）、从C#白名单读取的固定路由以及真实shiyeLocal/shiyeProgram worker代码。仅Telegram构造器、BroadcastChannel和浏览器IDB环境使用惰性/进程内替身。实际业务持久化、请求/回执与去重代码仍运行。

当前18条链路通过，报告outputs/revisit-decoupling/stage5/integration.json：

- 多个同时同步只执行一条接收链路，稳定deliveryId/本地编号不变。
- 本地feed提交后确认丢失，再次收件不重复。
- 图片经真实媒体分块接口、worker document和IDB保存，原字节一致。
- 评论提交成功但响应丢失，重建worker/客户端后仅保存一条，目标为原固定组。
- 新增60条后台投递跨越feed分页，全部接收；已有输入/手选目标不改变。
- 显式引用覆盖当前组；本地评论确认丢失后重试不重复。
- 发送后撤回遇后台确认丢失，重试清理outbox，原文不复活。
- 发送前撤回仅上传无正文墓碑。
- 真实普通归篇桥即使已配置该群也跳过，评论不成为新回看来源。
- 实际设置访问锁、锁定401、解锁恢复，源缓存清理、个人待发评论保留后重送。
- 首次接入时后台已锁定，空缓存清理不会创建群聊或暴露来源。
- 后台重启和worker重载保持消息、评论、撤回状态及编号。
- 目标/确认存储打开失败，内存状态与持久化状态均不误改变。
- 撤回确认存储失败时保留同一待重试操作，不误丢撤回。
- 合成entries、messageStore、media结构序列化SHA-256前后一致。

媒体失败/分页异常另有负向测试。合成视频资产在此测试只校验媒体传输，不验解码或播放。

## 项目检查

`node --test tests/revisit-client.test.mjs tests/chat-withdrawal-local.test.mjs`：16/16项通过，其中一项运行18条完整链路断言，其余包括分页/媒体异常及既有撤回回归。`npm test`显式设置SHIYE_TEST_NO_DESKTOP=1：643项中642通过、1原生桌面项跳过、0失败，日志all-tests.log。未使用前端页面或原生窗口。

`npm run check`的模块检查315项与根ESLint通过；完整命令在Prettier阶段被两个既有并行文档docs/CHAT-PERFORMANCE-HANDOFF.md、docs/UI-PREFERENCES.md阻断，未代改，项目检查不可标作全绿。之后单独完成上面的全库测试。所有本轮自有JS/文档按项目Prettier格式检查。

vendor的`npm run check:ts`中TypeScript编译已通过，原13项shiyeProgram类型错误已修正；后续ESLint仍有既有shiyeLocal撤回段与shiyeWithdrawals的9项风格错误及MessageText的1项innerHTML警告，未借本轮改写它们。最终日志vendor-types-final.log；新接入模块检查另记vendor-owned-lint-final.log。没有因此绕过正式升级或把整个第三方检查标作通过。

## 边界与位置

报告、检查日志：outputs/revisit-decoupling/stage5。合成隔离库：tmp/revisit-decoupling/stage5随机目录；每次测试独立保留以便复核，不清理他人文件。IDB替身只在进程内存在，重载模拟不是浏览器进程崩溃/断电证明。没有留下常驻测试服务。

此轮证明数据接入与失败重试链路，不证明气泡/目标提示视觉、原生C#桥实际调用、字体/缩放/窗口记忆、中文IME、物理设备、系统通知、长期运行或多端同步。第五步仍有界面分离/交互验收和媒体评论入口，第六步运行器认证/宿主收口尚未完成；不宣称全部功能已正式启用。
