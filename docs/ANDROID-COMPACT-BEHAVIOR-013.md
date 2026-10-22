# Android 0.13 紧凑显示与表情包直接发送

2026-10-18。此子任务修改 `android/telegram-adapter/android-chat.js` 与 `build.mjs` 内唯一锚点校验的冻结附件导出接缝；CSS、原生统一主题、版本、APK/设备安装由集成会话负责。未操作手机、AVD或正式库。0.12 原生服务传输模块保持。

## 设置与兼容

消息/输入字号范围扩大至 6–28px、时间 5–16px、左右留白 2–24px、独立上下留白 2–20px、消息间距 0–20px。新默认与明确点击的“应用紧凑推荐”：正文13、输入13、时间8、左右8、上下4、间距3、宽度90%，其余推荐圆角16/时间透明度62%/气泡透明度100%。推荐只改草稿，保存得到原生ACK后生效；不强行覆盖旧自定义。

新增 `bubblePaddingBlock` 对应 `--shiye-bubble-padding-block`，原 `bubblePadding` 在新设置页明确标为左右留白。旧参数没有 block 字段时不注入新 CSS 变量，继续把旧 padding 用于四边；旧房间覆盖也不会被全局新增的 block 值夺走。旧24px四边留白仍可读回，设置页为其保留当前值；主动调整后按新范围保存。全局/房间覆盖、继承、独立草稿、未保存返回、未知偏好与背景字段保持。

主题渲染优先使用原生注入的 `window.shiyeAppTheme` 字符串；监听 `shiye-app-theme`，detail `{theme:'light'|'dark'}` 后重应用。未注入时允许旧聊天主题先显示。聊天显示页移除可编辑的独立主题，改为跟随全局的说明与 `window.shiyeAndroidSettings.open()` 入口。旧全局/房间 theme 字段保留，事件不重写偏好；恢复默认也不擅改旧theme。原生全软件色调层/主题迁移与各页面壁纸由集成会话维护。

## 表情原件发送路径

现用 shared `shiye-input.js` 已有 `editor.sendSticker(file)` 分支；Android 冻结ui18的 editor-request 只提供 `files()`，此前回退至原图片确认窗口。现在 Android wrapper 捕获现有 `shiye-editor-request`，只补 sendSticker；不修改并行 shared input/stickers，不全局跳过普通图片确认。

构建仅对冻结 `assets/useConnectionStatus-Dy1kHT8L.js` 校验唯一函数锚点，导出其既有 `prepareAttachment`/`prepareAttachmentsToSend`；保留上一轮原件质量标记处理。继续调用原 `getActions().sendMessage` 与worker存储，文件原件、真实新消息ID、媒体ID/字节、引用及墓碑均由既有路径维护。缩略图仅预览，PNG不受small质量误压缩，GIF不重新编码。失败保留收藏原件。

接缝拒绝非原件标记、空文件、非图片、超过64MiB、编辑/转发/待发附件/计划消息状态；异步准备后重新检查当前输入节点、会话代际、thread与引用，防止换房或改引用误发。直接发送不带输入框现有文字，原未发送文字保留；不清除发送期间新选的引用。

成功须读取worker已提交的新消息及对应原件字节一致，再得到固定 `flush` 回执，返回 `{messageId,roomId,mediaId,flushed:true}`。未确认时明确提示先查看聊天，不自动重发。此前会话媒体已发送的写入不会通过关面板/切房回滚；本模块没有引入另一本消息库或服务器身份。

普通图片/视频文件继续 `editor.files(files)` 进入原确认窗口。本轮没有改变文件选择质量或普通附件发送参数。

最小原生测试调用（合成 blob，不新增测试 API）：

```js
let editor;
window.dispatchEvent(
  new CustomEvent('shiye-editor-request', {
    detail: {
      receive: (value) => {
        editor = value;
      },
    },
  }),
);
const file = new File([blob], 'fixture.png', { type: 'image/png' });
file.shiyeOriginalSticker = true;
const receipt = await editor.sendSticker(file);
// 对比普通文件：editor.files([file])，仍进入确认。
```

## 验证与产物

以独立013构建资产在真实Chrome移动UA、320×740、合成IDB与原生prefs ACK mock中定向验证。脚本由已验证011场景扩展，既有发送/IME/Shift、全局房间ACK、未知字段、未保存返回、引用撤回墓碑/重开、刷新失败恢复与背景取消继续覆盖；新增小字号/零间距保存重开、推荐明确值、全局主题事件/设置桥、PNG/GIF直接发送原字节持久化与未发送草稿重开、普通图片确认。

累计56个实际浏览器行为断言：完整主组47通过；发现旧24px参数控件赋值顺序会夹至20，调换max/value写入顺序后5个旧参数/主题兼容定向通过；另4个直接媒体真实回执/明确引用/草稿/准备中切房防串定向通过。47项未受该赋值顺序调整影响的发送/主题/媒体证据按源码差异复用，未宣称最终源码重新跑全组。三个最终报告的pageerror均为空。

失败定位单独保留：首次扩展场景在缓存设置页尚未重新装配时立即读控件，修正等待实际控件；重开后点击隐藏的侧栏链接曾等待，改用既有 openRoom；普通图片确认的 `.Modal` 外壳为0高、内部面板实际可见，测试改为等真实发送控件。以上不以修改产品流程掩盖测试问题。

浏览器1.3截图仅将CSS字号乘1.3，不能证明Android系统fontScale/WebSettings实际效果、物理120FPS或原生输入法。原生主题层、手机实际显示、网络服务与版本/安装回读由主验收记录。

正式源码哈希、实际通过清单/截图见 `outputs/2026-10-18-android-compact-013/chat-behavior/receipt.json` 和 `browser-report.json`。独立构建 `tmp/android-compact-013/telegram-build/`；对应源码/许可证/清单 `outputs/2026-10-18-android-compact-013/telegram/`；测试脚本 `tmp/android-compact-013/chat-behavior/`。未覆盖011旧产物。
