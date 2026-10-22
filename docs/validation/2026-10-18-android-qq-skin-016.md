# Android 0.16 QQ 式聊天换肤验收

2026-10-18。用户最终明确只换皮肤，其他参数沿用。主AVD已从0.14/code16保留数据覆盖为 **0.16.0-qq-skin/code18** 并启动；用户随后要求先交手机测试，Magic7也已从0.14保留数据覆盖为同一0.16/code18，安装前flush/完整备份和40持久文件hash保持、版本/启动及QQ模块ready只读核验通过。桌面窗口/正式库/服务未升级。

## 实现与边界

- 左上只有会话名，右上会话设置；保留系统返回。QQ式矩形输入区，左文件入口直接打开原生图库/文件选择，右单一表情包与原小飞机。沿用原消息字号、留白、圆角、宽度、透明度、时间戳、壁纸/浅深色调和发送参数。
- 新 `android-qq-skin.js/css` 只处理外观/菜单定位；`android-qq-gestures.js` 判别明确左滑与纵向滚动，长按复用已有引用/撤回/更多操作。取消、多指、切会话/失效消息不提交，松手不误点菜单；120ms独立translate回位尊重减少动态效果，未改上游transition。左滑56CSS px/长按450ms是候选交互阈值，不宣称为QQ实测值。
- 设置触摸范围条先判方向，纵滚/单点不跳值；横拖沿原min/max/step更新预览，取消恢复开始值，键盘/鼠标原行为继续。未新增持久偏好或自动保存预览值，原未保存提醒和返回父页继续。
- 使用原完整消息/草稿/媒体/表情/撤回通路，是QQ风格皮肤，**不是QQ客户端私有框架或已完成独立原生渲染器**。TUIKit/ChatKit审计见本轮专属文档，未新增其运行依赖。

## 构建与数据保留

`python android/tools/stage-qq-skin.py` 以已安装0.14 APK（29865bf4…）和 `Android-0.14-owned-sources.zip` 为固定基线；34个原生/资源文件保持，11,744个原资产逐字节相同。仅叠加包装脚本、新皮肤/手势和index缓存版本/CSP，不把015配对/Repository候选或桌面ui33资产混入换肤版。SQLite/IDB名称、消息身份、编辑器、算法、收藏/原件与服务接口未迁移。

独立工程 `android/qq-skin`：AGP8.13.2、SDK36、target35、原签名；构建命令见android/README。主包APK SHA-256：

`623f5665db8e9afeaf871ce0ab0e5aff4500390d5d568cf7daeb137919612752`

安装前实际flush确认，停止主包后完整私有tar备份到 `var/android-backups/*-avd-before-016/app-private.tar`；`install -r` Success，版本/启动回读通过。35个持久文件首次启动前SHA保持；无卸载/清数据/导入其他设备资料。安装后的4个owned资产从实际WebView读取哈希与源码一致，live CSS注入关闭，不能由预览掩盖安装旧字节。具体备份哈希/文件路径见输出安装回执。

`android/app` 的015/code17源码仍保留，**不等于本轮运行原生**；后续合并必须用code19以上，重新核验本地Repository/接口再部署。标准adapter builder已补齐QQ模块和样式/cache清单，未运行全量共享资产构建替换本轮固定基线。

## 已验与失败记录

- 23项实际TL/Chrome CDP触摸检查：真实引用草稿、纵滚/反向/短滑/多指/cancel/切上下文、普通tap/子按钮、范围条/checkbox滚动误触、键盘、回位动画及偏好零提交。回位证明与代码hash见 `gestures/browser-report.json`、`source-manifest.json`。
- 19项最终打包资产浏览器集成：实际importmap/CSP加载、非默认11/12/6字号与宽度/留白/透明度保持、头部/工具栏、真实菜单/引用/草稿、原设置未保存/父页/表情入口，无页面JS错误。见 `skin-browser-report.json`。
- 11项最终Android QA：原发送/引用草稿、纵滚、实际长按菜单、设置原范围/返回/表情入口、原IDB权威；截图 `avd-chat.png`、`avd-message-menu.png`。另原生图库已实际触摸打开，照片列表与文件入口同在，见 `avd-gallery.xml/png`；CDP无用户手势的`.click()`不能作为原生picker证明。
- 最终主AVD实际安装模块哈希/ready/QQ皮肤/头部/无live注入只读验证，见 `avd-runtime.json`、`avd-normal-016.png`。没有在主包写入QA消息；合成操作仅隔离 `dev.shiye.qqqa`，验后卸载该临时包。
- AVD曾ADB shell超时，专门 `emu kill` 后按原Shiye_API_36参数无清库冷启动恢复，未kill全局ADB或操作手机。早期QA坐标/布局未稳定和启动ready等待失败保留；最终测试在目标气泡命中检查、发送布局稳定后完成。快速更新使目标失效时取消手势属于安全边界，不宣称所有快速交互或物理120FPS已验。
- 本轮JS ESLint/Prettier通过；全库 `npm run check` 的check-files/lint通过，停止于48个共享/历史文件格式告警，未批量格式化。单独全库测试874项：871通过、3失败（桌面撤回C#/JS镜像一致性、revisit认证超时、rich-document DOM文件失败）。后两项单进程隔离复测22项全过，桌面镜像一致性仍未修，不归因于本轮皮肤，亦不写全库通过。详见project-check/project-tests/isolated-recheck日志。

## 参考与产物

MT只读重开QQ9.3.70工作区3jhhpp8o，定位AIO左滑/回复距离/阻尼/长按和FullBackground路径，返回保留 `outputs/2026-10-18-android-qq-016/mt`。服务后台间歇断连，未取得具体Smali阈值，不拷贝QQ APK代码/私有数据；自有手势实现。框架审计见 [FRAMEWORK-AUDIT](../ANDROID-QQ-016-FRAMEWORK-AUDIT.md)、[数据接缝](../ANDROID-QQ-RENDERER-016-ADAPTER-AUDIT.md)、[手势](../ANDROID-QQ-016-GESTURES.md)。

成品/证据 `outputs/2026-10-18-android-qq-016`，临时/冻结构建 `tmp/android-qq-016`，备份 `var/android-backups`。本轮手机MT专用转发/隔离QA清理，不删除已保存APK分析工作区，不停止手机MT服务。后续数据接口继续按最新 `ANDROID-PRODUCT-SYNC-CONTRACT.md` 接入，皮肤完成不代表完整双端同步已启用。
