# Android 020 QQ聊天view实现

2026-10-19。仅修改 `android/qq-chat/view.js` / `view.css`；不改数据源、父页、面板、原生或构建。隔离测试使用合成消息，不读写正式聊天资料。

## 行为与接缝

- 新增左上返回，先关菜单/原件查看/原生选区模式/多选，再沿既有 `onBack` 回父页。
- 普通进房默认到底；仅 `appearance.rememberReadingPosition === true` 恢复本次view生命周期内、稳定房间ID的阅读锚点。未实现跨App重启持久阅读位置。
- `api.locateMessage(id): Promise<boolean>` 等待view ready，在当前会话逐页调用 `source.loadOlder()` 寻找ID（上限100页且无进展停止），定位至视口上部并1800ms描边；失败显示未找到，不假称成功。父页负责先切至正确会话再调用；返回搜索结果仍由父页持有。
- 本人点发送时主动到底；等待ACK期间若用户转而读历史，不在ACK完成后强拉。外部附件发送成功回调主动跟随。原有ACK别名复用行节点，pending/failed等传输元信息不再触发正文替换。
- 输入独立px字号、32–128px内容测高；关闭WebView文字自动放大，避免继承系统文字自动重排造成重复放大。保留 source 传来的明确字号偏好，未静默删除/重设旧设置；输入来源的修正由父任务负责。
- `appearance.selfMessageSide='left'|'right'` 仅改变排列；outgoing、作者、ID与撤回权限不变。时间小标签增加明暗主题背景；间距/宽度/圆角/透明度参数继续生效。
- 长按菜单新增“选择文字”“多选”。选择文字为明确模式，允许原生长按局部选区、系统处理，返回结束，避免自定义菜单与原生选区同时争抢。多选按消息稳定ID，ACK别名迁移选择；复制按显示顺序；返回取消。存在真实 `source.forwardMessages(ids)` / `deleteMessages(ids)` 才显示转发/删除，不伪造能力；只读消息不可删除。
- 横滑引用保留方向/阈值/多指取消，垂直滚动取消长按；明确菜单动作清除余下点击屏蔽，避免多选首击丢失。

## 验证和边界

根集成已补父页搜索等待renderer.roomId与visible、返回恢复搜索、实际Android输入法连发、正常包旧三房和全宽列表测试；最终还发现/修复QQ退出后旧MiddleColumn露出，隐藏改为owner完整生命周期。补充壁纸坐标检查后的隔离DOM最终回执为30项（下方26是早期阶段）。实际构建/安装及未验边界见[020根验收](validation/2026-10-19-android-feedback020.md)。

`node tmp/android-feedback020/chat-view.mjs` 最终26项通过，无浏览器异常。覆盖旧消息ACK节点、迟到ACK不拉走读者、多行快速发送晚窗不回弹、9个换行临界高度、独立输入字号、指定ID定位、左右身份、长按多选累积/返回、原生选择CSS、默认进房到底和历史位置本人发送到底。Prettier与定向ESLint通过。测试使用现有隔离content打包fixture，验证实际view DOM，不冒充新完整APK构建。

已看合成320×700/2x截图及用户105参考，输入工具栏保留紧凑比例、QQ蓝/白底与新返回按钮。没有物理手机、中文OEM输入法、原生文本选择手柄/处理菜单、实际120FPS验收；未构建或操作模拟器，不声称手机问题全部结案。壁纸键盘固定基准需父任务与外壳统一处理。

产物：`outputs/2026-10-19-android-feedback020/chat-view/`（截图、26项回执及最终view哈希）。临时：`tmp/android-feedback020/chat-view.mjs`及本轮编辑脚本。
