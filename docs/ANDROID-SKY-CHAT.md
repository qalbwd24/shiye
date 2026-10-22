# Android 随想浅天蓝样式（2026-10-17）

用户本轮要求：手机界面与电脑拾页风格协调，以浅天蓝为主调、黑色字体，保留默认会话列表、快捷写日记和底部日记阅读三个入口，继续使用成熟 Telegram 消息、列表、附件和动效。原生全局外观及思绪独立外观由主代理实现；本代理仅修改 android/telegram-adapter/android-chat.css。

## 配色与接缝

| CSS 变量                | 默认值    | 用途                 |
| ----------------------- | --------- | -------------------- |
| --shiye-accent          | #428AC4   | 主要按钮、链接、置顶 |
| --shiye-surface         | #F5FAFE   | 列表、顶栏、会话面板 |
| --shiye-ink             | #111827   | 黑色正文/标题        |
| --shiye-muted           | #475569   | 次要文字和图标       |
| --shiye-line            | #CADFEE   | 分割线、输入边框     |
| --shiye-chat-background | #EAF5FC   | 默认聊天壁纸底色     |
| --shiye-bubble-out      | #DDEFFD   | 发出的消息气泡       |
| --shiye-bubble-in       | #FFFFFF   | 接收消息气泡         |
| --shiye-input-surface   | #FFFFFF   | 输入栏和表单         |
| --shiye-selection       | #C9E5F8   | 日期标签/选中态      |
| --shiye-message-meta    | #3D647F   | 时间、发送状态       |
| --shiye-quote-surface   | #C9E5F866 | 引用底色             |

其余 soft/pressed/hover/backdrop/shadow/error 色也集中为 --shiye-* 变量。外观层将来可在根元素设置同名变量；本轮不接入原生聊天壁纸设置或共享日记壁纸存储。原生 chrome 对齐随想 #EAF5FC、思绪 #B6DEF0、底栏 #F2F9FE、文字 #111827。

只映射 Web A 已有颜色变量与表面，不调整虚拟列表行高、气泡结构、输入/滚动尺寸、转场曲线或消息处理。日期/发送勾从绿调统一为蓝调；引用保留蓝色边线、浅蓝底和黑字。已有 44px 更多按钮、SVG、消息段落间距和中文字体栈保持。

聊天与思绪同属蓝调，壁纸偏好保持模块独立。冻结 ui18 的内建浅色壁纸通过 #Main 中既有 #bdcd8c 基色及 withPattern 标记识别，只对这条默认路径做浅蓝底色与柔和灰度渐变混合；图案/canvas 仍由原组件绘制，没有增加覆盖整页的不透明遮罩。自选图片的 customBgImage 层、--custom-background、图案 mask 与原壁纸保存机制保留。该 CSS 选择器对应固定 ui18，不作为未来任意升级包的稳定 API；升级基线时须核对默认壁纸模型。

## 独立交付与来源

先复制 0.3 完整资产、清单、许可证和对应源码到新目录，只 copy，不修改旧证据；再运行 adapter-only 更新自己的 CSS。

- 新可打包资产：tmp/android-sky-ui/telegram-build/assets/telegram。
- 清单/完整许可/对应源码：outputs/2026-10-17-android-sky-ui/telegram。
- 定向截图、回执：outputs/2026-10-17-android-sky-ui/chat。
- 临时脚本与浏览器文件：tmp/android-sky-ui/chat。
- 源基线：outputs/2026-10-17-android-frontend-polish/telegram/build-manifest.json，SHA-256 836fe8d0407f5adfef65bb11054d7811363597f2bc648d9a2c34d28380b1bba6；仍为冻结 ui18，不带桌面并行候选。

最终冻结时间：2026-10-18T00:00:46.685Z。新 build-manifest.json SHA-256：aff96a4da35d306938f1143ff1d6a7433fe50e27f7b95b2b3f2097a12b7ae28c。CSS SHA-256：ea8a29d42f89dc5e0d4a6b8fd36acda5f2d6657c945aed4f84eba6504086de78。

reuse-integrity.json 对照两个清单的 11711 项资源，只有 android-chat.css 的哈希变化，其余 11710 项哈希不变。JS、network guard、worker、媒体、字体/图标许可和消息 schema 均未修改；存储链复用 0.3 既有证据，不冒充本轮重新验过。

重建接缝（仅在新目录已有上述完整基线时）：

```powershell
node android/telegram-adapter/build.mjs --adapter-only --work-dir tmp/android-sky-ui/telegram-build --output-dir outputs/2026-10-17-android-sky-ui/telegram
```

## 定向验收

按 [TESTING-POLICY](TESTING-POLICY.md)，这是局部颜色改动，仅运行受影响视觉与窄屏场景，没有重复草稿/存储/IME/媒体全矩阵。CSS 已单独 Prettier。定向 headless Chrome 使用断外网 appassets 路由、Android UA、触控、合成库及明确的 native preferences JS 替身。

visual-check.json 最终退出 0，11 条实际断言通过，errors=[]、无 failure：

1. 列表浅蓝表面与黑字 computed color 正确。
2. 列表更多按钮仍为 44×44px。
3. 默认壁纸天空底色 #EAF5FC，原 canvas opacity=0.2 仍可见。
4. 成熟发出气泡 #DDEFFD，正文 #111827。
5. 输入区保持白色。
6. 日期浅蓝标签与黑字，移除原绿色日期标签。
7. 实际合成引用使用蓝边、浅蓝底、黑字，有真实宽度。
8. 会话操作面板颜色与列表一致。
9. 独立 CSS 探针确认自选图片伪元素仍有 image、display:block、visibility:visible；不等同实际选择/重开壁纸已验。
10. 360px 独立窗口实际点会话后无页面横向溢出。
11. 无未捕获页面错误。

已实际查看 [412 列表](../outputs/2026-10-17-android-sky-ui/chat/list-412.png)、[412 消息](../outputs/2026-10-17-android-sky-ui/chat/chat-412.png)、[引用](../outputs/2026-10-17-android-sky-ui/chat/quote-412.png)、[菜单](../outputs/2026-10-17-android-sky-ui/chat/menu-412.png)、[360 列表](../outputs/2026-10-17-android-sky-ui/chat/list-360.png)、[360 消息](../outputs/2026-10-17-android-sky-ui/chat/chat-360.png)。

中间探针在同一页面动态 resize 后立刻 reload 时出现列表不在 viewport，保留 visual-check-resize-probe.json / list-resize-probe.png；没有据此改导航或扩大源码范围，最终窄屏采用独立 360px 窗口实际点击。不能把本轮写成旋转已通过。该 probe 与 Android 旋转/旧问题的关系未定位，平台旋转留待按需验证。

本轮未操作 ADB、模拟器、手机、桌面运行版或私人日记。没有测试原生图片网格、中文 IME、强杀落盘或壁纸偏好端到端；本次静态颜色回执不替代新版 Android 安装验收。
