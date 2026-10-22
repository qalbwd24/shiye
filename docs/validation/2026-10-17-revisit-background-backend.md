# 朝花夕拾纯后台后端复测

用户要求不使用前端、避开其他会话的屏幕操作。本轮只运行Node后端和HTTP接口测试，不启动浏览器/前端页面/原生产品窗口，不使用鼠标、键盘、剪贴板、截图或桌面控制，不查询或重启正式服务。

命令显式设置SHIYE_TEST_NO_DESKTOP=1，选择revisit-engine、revisit-sources、revisit-delivery、revisit-comments及revisit五个后端测试文件；没有运行全项目前端DOM或原生桌面测试。临时服务显式使用随机隔离dataDir和回环端口，结束时关闭；合成库写在tmp/revisit-decoupling/stage2、stage3、stage4及tmp/revisit-push的随机子目录，正式旧日记不访问/不覆盖。

结果60/60通过、0失败、0跳过，回执outputs/revisit-decoupling/background-backend/backend-tests.log。覆盖时间规则、新旧来源读取、媒体字节、长停机/失败重试/并发去重、状态归档、单条/固定组/媒体评论、撤回优先、按篇查询、评论排除回看及隔离服务重启。原有独立CLI也仅对临时API测试，没有接入正式托盘或窗口生命周期。

本轮复制最新source/delivery/comments隔离报告至outputs/revisit-decoupling/background-backend留档。原测试仍使用对应阶段的临时目录，不误称这些库位于新的background-backend目录；该目录只存本次测试范围记录。未开发/部署第五步UI，不把后端链路通过当作消息显示、IME、字体、焦点、窗口或真实交互已验收。
