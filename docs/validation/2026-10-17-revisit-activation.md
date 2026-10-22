# 朝花夕拾ui22接入检查

用户确认以已启用ui22为基线，适配无问题后正式开启，并要求以后UI把朝花夕拾作为正式功能覆盖。最新可执行清单见[接入清单](../revisit/INTEGRATION-CHECKLIST.md)。产物outputs/revisit-activation，临时tmp/revisit-activation。

## 实测

- 标准desktop-control status只读回读installed.revision=20261017-ui22，API0.9.24；不能仅凭版本号视为新后端。正式health没有revisit，GET /api/revisit为404；监听Node实际命令行是D:/拾页/server.mjs，未重启或更新。
- 直接使用当前安装的ui22 app资源、独立Chrome context、合成IndexedDB、真实独立HTTP日记服务和本地worker。发送合成本人消息，比较两者message-content计算样式，确认背景不同，字号16px、行高24px、圆角14px、四边12px、阴影相同。style-parity.json的sameStyle=false；截图及ui22-probe.log保存于ui22-probe，未连接正式日记，未向Telegram发请求。该证据说明仍不能宣称满足“只有位置不同”，没有擅自修改前端样式。
- 后端/接收44项定向基线通过；随后补明确刷新数据、锁定清理与入口转发后，受影响的client/notice/reply-latest共14项通过。普通轮询不重复发布提示，启用、用户刷新、换周期分别发布；锁定不泄露旧日期，事件不写日记/评论、不改source或游标。回执backend-tests.log、receiver-final.log。
- 正式库未改，未发旧消息，未调用正式config/start/tick，未重启日常窗口或API。以条件授权为准，前端门槛尚未通过，保持未启用。

- 最终三个接收/展示入口文件和通知测试定向ESLint通过，三个源文件及新文档Prettier通过；仅同步vendor/public开发镜像，未复制到安装目录。长期约定已写入AGENTS、功能索引、需求、交接、工作区与F:/agent规范/软件技术路径/日记与消息统一内容模型.md。

首次批量代码/网络/进程状态检查被自动审批以blocked by policy拒绝，未执行；缩小为纯文件读取、再单独只读HTTP与进程查询成功。没有因此绕过正式更新保护。

## 交接

前端完成同一外观及居中系统提示的事件消费后，再以ui22完整候选做少量核心联调。后端源码/接口已具备，但正式API尚待受控升级；不要把旧独立ui21窗口、源码就绪或新生命周期事件视为正式接入完成。未执行新版部署，本轮不跑无关完整浏览器/原生矩阵或全库测试。
