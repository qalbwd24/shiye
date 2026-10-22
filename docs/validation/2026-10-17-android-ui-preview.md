# Android 0.6 实时样式与三页首轮验收

2026-10-17。本轮目录 `outputs/2026-10-17-android-ui-preview/`，临时 `tmp/android-ui-preview/`。电脑/手机真实日记不迁移，不运行全库数据审核。仅更新主 AVD；Magic7保持0.5用户手测，旧日记仅查看设置、未修改其参数。

## 版本与安装

- `dev.shiye.app`，`0.6.0-ui-preview`，code8；Gradle编译完成，`adb install -r`返回Success，安装后package回读一致，用户手动打开。
- APK `Shiye-Android-0.6.0-82926231.apk`，91,401,311字节，SHA-256 `829262313fc24e4f1d7e4676f38ae5b8a37beab219fa5b8ef29bf06e6bfb52bd`。
- APK内editor HTML/JS/CSS与聊天适配CSS逐字节匹配当前源码，新增分类偏好确已打包；源码hash在`release-receipt.json`。
- 安装前取得聊天flush ACK并备份`var/android-backups/2026-10-18T02-53-46-221Z-avd-before-060/app-private.tar`；不清库、不导入手机/电脑内容、不重复旧全文件矩阵。既有列表/草稿继续可见，但不将可见等同全库无损审计。
- 工具自动启动App曾被审批`blocked by policy`拒绝，命令未执行；由用户手动打开，未换方式绕过。构建初次PowerShell5把SDK XML stderr警告升为NativeCommandError；调整包装器按Gradle退出码判定后成功，无Android编译错误。

## 实时预览

`android/tools/live-preview/`本地控制台仅回环19384，显式AVD序号和应用页白名单；CSS watch不重载。7项局部工具测试通过。颜色应用/恢复、列表头像50→54→50，实际DOM尺寸跟随，timeOrigin保持、style仅一份；编辑临时26px能覆盖内联偏好，清除恢复18px且localStorage未变。临时覆盖使用!important但不写App偏好，保存源码仍为普通CSS声明；原生/HTML/JS仍需构建。工具退出曾实际确认恢复style/移除自己的forward；最终继续运行供调样式。

实际回执：`live-preview-proof.json`（旧0.5上首次颜色）、`live-size-proof.json`（0.6尺寸）、`avd-editor-verification.json`（0.6字号）。独有说明[ANDROID-LIVE-PREVIEW](../ANDROID-LIVE-PREVIEW.md)。

## 分页验证

| 范围                | 本轮证据                                                | 结果与界限                                                                                                                                        |
| ------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 列表/聊天合成浏览器 | 11列表＋15聊天，分阶段26项                              | 360/412、72px虚拟行、50px头像、时间菜单不重叠、置顶状态，独立16/24/28px输入与发送通过；JS/媒体代码未改，旧文件/GIF逻辑证据复用，不冒称重测        |
| 思绪合成浏览器      | 22布局项＋3组新建分类                                   | 单层正文x42→18、y204→121（393视口），空附件95→44，设置保存取消、同图两次occurrence及UTC/null通过；原公共richdoc核未改                             |
| 真实0.6 AVD聊天     | `avd-chat-verification.json`                            | 暂停预览确认安装包72px/50px；合成会话`样式预览 · 0.6`实际中文多行发送、行高测量1.5、输入区在视口内、flush、返回列表通过                           |
| 真实0.6 AVD思绪     | `avd-editor-verification.json`、`avd-diary-reopen.json` | 快捷新建出现分类且不自动聚焦正文；取消不改分类；合成文字/共享电脑时间戳保存，读写切换正文一致；原生思绪列表重开同一ID、只读状态且不弹新建分类通过 |

已查看安装包全屏实绘：`conversation-list-installed.png`、`chat-installed.png`、`diary-writing-installed.png`、`diary-reading-installed.png`。截图包括系统栏和底部导航；最终列表等转场稳定后截取。无新增全局快捷键、无修改正文格式/媒体身份或替换用户背景。

测试脚本最初对Tiptap多段`getText()`误按单换行比较，以及把时间戳预期写成横线分钟格式；按实际段落分隔与共享`[yyyy/MM/dd  HH:mm:ss]`修正后通过，不为断言改变产品正文或时间规则。一次原生切页后立即读取预览状态早于1秒发现周期；增加临时验证脚本有限等待，工具按原逻辑重连。

## 旧日记习惯与后续边界

旧设置真实可见值在`old-diary-{editing,style}-settings.json`与`old-diary-habit-profile.json`。退出保存/首行缩进/无自动键盘/居中标题等与现有行为核对；新建先分类默认true，可保存false且重开保持。天气/位置开启不代表授权加入新功能/权限。字体大小/家族/颜色未取得实际值；行距1.5是Android倍数，系统字体缩放1.3/密度632，不宣称像素级继承。早期旧坐标误入阅读页，已返回并改为每步确认设置Activity/新控件边界；没有保存正文文件，后续不复用该正文输出。

公共adapter仍有JSON key顺序不同可能产生一次语义相同保存的原有边界，未为样式修改公共核。0.5发现的渲染长帧仍未结案，本轮不新增性能采样、不宣称60/120FPS或真机中文IME组合态/强杀恢复全过。

手机电脑互通的约束及实际接口变化已同步[数据适配](../ANDROID-CROSS-DEVICE-ADAPTATION.md)、[本轮入口](../ANDROID-UI-LIVE-ITERATION.md)。当前没有联网权限/远程同步、持久outbox或旧本地双聊天存储迁移；电脑多实例服务及日期范围已部署不等于安卓已接入。电脑版并行工作保持，本轮没有重启其API/窗口。
