# 产品同步后端与数据适配验收

2026-10-18。用户确认本会话做后端/数据适配，Android会话接UI/实际Repository；本轮没有操作日常窗口、安装APK或切正式数据源。

## 核心变化

- sync-product独立服务，复用sync-v2认证、序号/分页游标、冲突、原件与通知。
- 业务保真信封、稳定分类/会话/消息身份、canonical长文单元及布局；大正文原件化和hash重组。
- 聊天正文单源、只读归篇；业务发送/撤回与归篇一起提交，撤回清除历史/回执中的原文，不能用晚到消息复活。
- 旧库只读seed/媒体原件恢复及断点；重复seed不覆盖新编辑，也不重新扫描已发布的源原件。
- 固定业务HTTP客户端和事务命令队列，要求与本地消息/评论同事务；不以独立IDB异步拷贝冒充已接Android持久权威。
- 朝花夕拾同一Bearer规则/收件/来源/固定评论端点，私有运行state与实体/回执原子提交，30秒独立调度，失败保留游标并暴露runner错误。

## 实际测试

`tmp/product-sync/backend-core-tests.log`：128项通过，包含14项新产品测试及底层sync、媒体HTTP/缓存、客户端持久队列、CLI、原聊天、评论、消息存储/归档相邻回归。覆盖：

1. 原复合chatUnitId与长十进制字符串；未知字段、原HTML/换行、独立媒体时钟和类别改名保真。
2. 非法旧篇不留下半条子消息；canonical单位/布局保留身份、正文重组一致。
3. 大正文完整回读与损坏hash拒绝；GIF原件字节不重压；源文件不写入，seed重试无重复。
4. 两个隔离Repository离线写入/增量接收、元数据合并；业务消息与outbox事务失败一起回滚。
5. 丢ACK后重开队列按同消息身份再发，只保留一条；接收回执失败保留原job。
6. 五小时归篇、引用、重试、撤回、禁止复活；检查SQLite entities/versions/changes/receipts/conflicts均无撤回原文。
7. 朝花夕拾来源、整组/单条评论、重复tick不重复、评论不成为来源、规则/评论/投递重启恢复；一次130条回看投递与私有状态原子保存。
8. 无认证401、服务器权威写入403、跨对象写入回滚和单独命令依赖。

扩大到聊天UI本地桥测试时共137项、136通过/1失败：`tests/chat-withdrawal-local.test.mjs`的“C# withdrawal allowlist and JavaScript public mirror…”比较的两份`shiye-journal.js`当前不同。失败日志保留`tmp/product-sync/backend-tests.log`；两份UI桥不在本轮改动范围，未代改，也不声称全库通过。之后后端核心定向128项全部通过；没有为了数量重复无关原生UI验收。

15个本轮JS/MJS文件定向ESLint通过；模块引用检查388模块/0错误。F:/agent规范目录校验23条目/ok。未运行全部UI矩阵或正式产品端对端同步。

## 旧库预检

`outputs/product-sync/legacy-audit.json`来自只读结构/容量/底层操作校验：3024篇、296消息、3084媒体、54分类/标签、6469信封，issues为空、无需大正文外置。每次审计两次读取之间源SHA保持。日常软件仍可写，本轮稍早审计为295消息、稍后296，不把正常活动写入误报为整轮整库不变；没有直接写原diary.json。

没有从真实正文生成提交用fixture，没有逐个复制/校验3084个真实原件；实际原件与大正文往返使用合成资料。未知磁盘原件、超限资源、Android本地完整数据迁移仍须专项验收。

## 独立运行

`var/product-sync-lab/runtime.json`：最终代码独立服务18789，host0.0.0.0，当前PID8840为快照；后续先重新查。源码hash与实际HTTP记录见`outputs/product-sync/live-server.json`。8项检查通过：loopback、电脑自身100地址、配对后catalog、合成篇、会话配置、媒体/收藏、朝花夕拾入口/runner和撤销QA凭据。

服务加载最终代码前，只核对并停止本轮自己的18789进程，确认退出后清除其同PID旧锁并重启；此为隔离测试服务的崩溃恢复，不冒充正式维护CLI的优雅关闭。旧18779、正式API/窗口、Android与FlClash均未重启或替换。合成库1篇/1会话/1原件/1收藏；旧日记未导入此网络服务。

本轮没有真机验证18789/正式APK或新的入站防火墙策略；此前18779的FlClash真机网络证据只能证明既有组网路线可行。新端口的电脑自身100请求不能证明手机产品已接通。

## 交接与剩余工作

实际参数/DTO/所有权：[PRODUCT-SYNC-API](../PRODUCT-SYNC-API.md)。Android先实现完整信封、本地权威和单事务队列，再接界面。电脑日常保存事务仍须持续登记并发布增量；一次只读seed不能代替。多朝花夕拾实例绑定/Android通知与保活/云部署也未完成，不应开放成已可用功能。

产物：`outputs/product-sync/`（只读摘要、运行验收与源码hash）。临时：`tmp/product-sync/`（隔离测试库/日志）。测试常驻库：`var/product-sync-lab/`；合成来源：`var/product-sync-demo-source/`。未在盘根、Desktop、Downloads或旧Documents/ChatGPT生成文件。
