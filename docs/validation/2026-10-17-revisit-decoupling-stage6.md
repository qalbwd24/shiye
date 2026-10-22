# 朝花夕拾第六步：运行器认证、生命周期与重试

2026-10-17 用户授权后端完善，UI由另一会话负责。产物`outputs/revisit-decoupling/stage6`，临时文件`tmp/revisit-decoupling/stage6`；只使用合成库和随机回环端口，未访问正式日记、未操作日常窗口或原UI联调后台。当前是源码及隔离候选，未正式部署。

## 交付内容

模块和协议见[运行器](../revisit/06-runner.md)。固定HTTP客户端、状态机和CLI分别抽取，旧tools/revisit-push.mjs继续可用。API增加受访问锁保护的runner状态/启动/停止端口，默认停止；health新增runnerControl:1能力标记。未修改前端、原生固定动作白名单或vendor，UI应按[前后端契约](../revisit/FRONTEND-BACKEND-CONTRACT.md)后续增加三个固定映射，不能据此宣称UI已接上。

认证使用现有访问锁，不保存密码或Cookie到文件；独立CLI通过私有stdin，API宿主仅借用已授权会话。停止清其内存会话，不锁用户窗口。认证中途停止、并发启动或更换间隔都经过取消/代际校验；等待退避和真实HTTP请求可被取消。401暂停等授权，不自动尝试密码；临时网络/超时/429/5xx退避，服务不支持或响应损坏暂停。服务端仍唯一负责游标和去重。

## 专项隔离验证

`tests/revisit-runner.test.mjs`共21项，回执runner-tests.log：

- 真实访问锁设置、错误密码仅提交一次、解锁续推、服务端重启使会话失效后等新授权。
- 真实HTTP控制八路同时启动；未解锁401、违规参数400、运行时改间隔409、停止后新间隔重开。
- 12次start只有一个在途调用；停止长退避和真实挂起HTTP，停止后不能自行重启。
- 授权过程停止、HTTP宿主等待授权时停止、旧间隔替换时停止，迟到结果不复活任务。
- 确定性指数退避/上限/Retry-After/成功清零，remaining快速追赶分支。
- 真实本地API断开重连；模拟服务器提交后丢失回执，重试前后投递编号深度一致，无新增重复。
- 真实请求超时；401/403/404/429/503/302分类，不跟随重定向、不输出错误正文。
- 损坏JSON/非法字段/过大响应拒绝，超大Retry-After封顶以免计时器溢出。
- 启动真实CLI子进程，stdin密码、once旧汇总格式、JSON行解锁/启动/停止/恢复/退出；所有输出检查无测试密码。
- CLI控制管道EOF取消挂起推送并退出，不遗留后台轮询。

真实HTTP控制报告http-control.json：合成源entries/media/messageStore组合SHA前后一致，状态不含密码或Cookie。recovery.json记录服务器确实新增投递后丢回执，再次调用与断线重连后投递编号相同，源组合SHA相同；不是只对已经存在的手动投递做零新增重试。CLI子进程均由测试创建并结束，测试HTTP服务均关闭；没有使用桌面操作或热键。断线测试不是篡改真实网络/VPN配置。

## 项目回归

专项21项通过，阶段1–6及原接口/CLI共91项回归通过（revisit-regression.log）。首轮完整`npm run check`通过模块引用检查322项、全库ESLint、全库Prettier及667项测试：666通过、0失败、1原生桌面测试显式跳过（project-check.log）。之后加强真实新增投递的丢回执检查，并补控制管道收到null/数组时返回错误后仍可继续控制；最终全库671项中670通过、0失败、1原生桌面跳过，见all-tests-final.log，包含其他会话本轮新增测试。

最后一次`npm run check`的模块引用与全库ESLint通过，但在并行会话正在修改的android/telegram-adapter/build.mjs、android/telegram-adapter/verify-refinement.mjs、tests/chat-withdrawal-ui.test.mjs三文件格式告警处停止，见project-check-final.log；未代改这些文件。因此最终整轮check不记为全绿。最终本轮代码/文档的ESLint及Prettier独立检查见owned-checks.log，代码/契约SHA清单source-manifest.json。首轮全绿属于当时快照，不能替代并行工作后的最终事实。

所有检查设置`SHIYE_TEST_NO_DESKTOP=1`。由于前轮默认测试并行曾导致Windows/Node内存耗尽，tools/test.mjs新增可选`SHIYE_TEST_CONCURRENCY=1..32`，不设置时仍保持旧默认。本轮完整检查使用2，避免打断其他会话。此调整只影响开发检查，不改变产品或后台运行的并发。

## 未验与后续接入

不承诺断电fsync、真实多端、长时间运行/睡眠恢复、系统通知或实际安装宿主的关机清理。独立CLI与API受管模式可选择，最终常驻/托盘/窗口随启策略仍未定，不擅自安装系统服务或设置开机启动。

本轮未重启正式API、测试UI后台或日常窗口，package仍0.9.24。后续UI需使用支持runnerControl的隔离后端验证按钮；旧运行进程不会因源码变化自动拥有新端口。正式启用须另按保存/快照/升级流程，不由本轮隔离测试代替。源数据、评论关联和既有投递契约没有改变。
