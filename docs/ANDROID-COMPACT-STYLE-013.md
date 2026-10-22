# Android 0.13 紧凑聊天样式

2026-10-18。本子任务仅修改 `android/telegram-adapter/android-chat.css`；JS偏好/范围/预设、Java textZoom、集成与设备由主会话和对应代理处理。本报告的浏览器证据不等于手机或AVD已更新。

## 最终变化

- 正文默认上下4px/左右8px、消息间距3px，仍由变量控制。新增 `--shiye-bubble-padding-block`；缺省先退回既有 `--shiye-bubble-padding`，所以旧显式12px值仍四边12px，不擅自重置。JS新预设可明确block4/横8。
- 普通文字时间与状态共用 `--shiye-message-time-size`（CSS缺省8.5px），覆盖所有MessageMeta/时间及状态图标，普通text-content不依赖Markdown标记。文字与末段时间使用正常文流和右浮动；时间有自身真实宽度，空间不足正常换行，clearfix把时间包含进泡内，没有绝对定位遮字。纯emoji独立meta的不同DOM单独处理，照片/视频原浮层定位保留。
- 原来将88%限宽放在整行Message，row-reverse实际只能排到被缩窄行的右边；现在限宽转到message-content-wrapper，文字与媒体均回到实际右缘。320px/16px的本人气泡右缘311px，不再停在约267px。
- Composer默认44px高，附件/表情/空发送/真实发送为36px触区、20px图标；输入与测量clone使用一致1.4行高及最小36px，三行/引用仍向上增长并保持按钮同底边。没有页面zoom/transform缩放。
- 房间标题栏48px高，返回/更多40px触区、20px视觉；标题15px。日期/时间分隔pill为10px字/14px行高/2px上下留白。已核实冻结实际类 `.ScrollDownButton-module__button`，跳底按钮36px、glyph20px。
- 深色底从接近黑色提亮为冷蓝：页面 `#182d40`、泡 `#294359`、输入 `#253e52`，保留浅色文字与原主题/自选壁纸边界。
- GIF确实可能是Document而非Sticker。实际发送DOM为 `.File` 卡片加同级原生 `.media-inner`，其上游12rem最小宽度会将预览撑大。现在只对真实File标题`.gif`及其所属message frame解除该最小值，File/泡最大176px、原生预览最大128px；保留原文件卡/下载动作/字节。已有本地fallback GIF与原生custom-shape贴纸也限制128px，普通照片/视频不受此GIF选择器影响。

## 验证与边界

真实Chrome移动UA、320×780、完整冻结TL构建与真实隔离worker，依赖来自 `tmp/android-refinement-011/telegram-build/assets/telegram`；路由仅替换本轮CSS，其余JS保持011构建。30项定向断言通过，pageerror为空：16px、20.8px、6px正文的短句/多行/长无断词/临界换行/引用/emoji、metadata包含和不遮字/右缘、普通非Markdown DOM、旧12px留白、Composer与真实引用回复、header/date/跳底、深色、真实GIF发送与媒体框限宽、贴纸shape探针。

16px短句含时间泡32px高；emoji泡约49.6px。20.8px/根20.8px用于字体放大边界，时间仍明确8.5px；6px正文比时间小时允许时间自然另排且保持泡包含。真实320×240双帧GIF经现有收藏/附件确认UI发送，实际原生预览128×96px，File宽176px，整体泡约166px高。该GIF保留原生媒体框，fallback `.shiye-local-gif`没有出现，因此没有把仅测试fallback选择器当作GIF通过。

已查看最终浅色/放大/最小字号/深色/GIF截图。native sticker没有发送真实TL Sticker对象，只做实际形状类的克隆DOM/CSS尺寸探针；不冒称原生贴纸全流程重测。原生WebView setTextZoom、系统font_scale、IME、触摸、物理帧率、长时运行和手机安装由根会话接续；本子任务未操作手机、AVD、正式库或桌面运行版。

最终CSS SHA-256：`dc8be796eddef151af9fa6f1faf40294a3e9f43c14226e755cfcf17ae5cdd513`。专属Prettier检查通过；按风险定向验证，未跑无关全库。

产物：`outputs/2026-10-18-android-compact-013/chat-style/report.json` 与 `light-320.png`、`enlarged-320.png`、`minimum-320.png`、`multiline-composer-320.png`、`native-reply-320.png`、`gif-document-320.png`、`jump-control-320.png`、`dark-320.png`。早期 `failure.png` 为中间失败图，最终report无failure且30项通过，不作最终截图引用。临时：`tmp/android-compact-013/chat-style/verify.mjs`、`synthetic-original.gif`。CSS自本回执后冻结，若集成后更改须重新核对hash和受影响证据。

## 追加：真实PNG预览与透明主题色调层

根会话传达用户后续要求后，追加两个独立增量；最新CSS SHA-256为 `09b5fbc82d9ac3aaa669a945a6a9c03d80131fefca210c1d56ddc095c6a13864`，覆盖上节初次冻结hash。30项原布局证据按未改动对应规则复用；新增受影响的图片预览和主题颜色另验，不宣称30项在最终hash下全重跑。

PNG沿原TL photo协议没有sticker标志，因此单张图片的本地预览统一限制176px，而原件和打开图片动作保持。实际选择器命中单Message、直接content-inner/media-inner/img.full-media，排除 `.is-album`、`.File` 及Video固定 `.media-inner.dark`，不靠新增业务字段或伪造Sticker类型。真实512×320 PNG经013新sendSticker路径发送，预览176×110px，原字节逐项一致，无附件确认框；图片仍为原生可点击媒体节点。视频/album为选择器排除DOM探针，未实际发送视频/相册重验。6项增量通过，pageerror为空。

浅色/深色的surface、header、输入、设置面板现在采用冷白/冷蓝透明色调层：surface84%、input85%、soft82%；文字保持opacity1，气泡背景透明度仍由原用户变量独立控制。无图列表有不透明浅蓝/冷蓝底色fallback，有独立列表壁纸时内层清透明，普通行约71%色调板，header84%，能透出原图。全局light/dark事件不改壁纸来源和逐房已存字段，color-scheme分别为light/dark。

同一张橙/蓝分区合成PNG经既有同源local-background URL和原生prefs mock提供；实际全局主题事件下两张列表截图均可见壁纸分区，图片URL完全相同。header前后背景像素不同，未用整页opacity伪造透明。正文默认气泡上对比约17.74:1（浅）/9.07:1（深）；调整metadata色调后，62%默认不透明度合成对比约4.88:1/4.71:1。用户主动选更低透明度的可读性不在此默认值保证内。13项增量通过，pageerror为空；已查看PNG发送、浅/深透明列表截图。

该增量使用 `tmp/android-compact-013/telegram-build/assets/telegram` 的013依赖，并精确替换源码android-chat.js与CSS；最终JS SHA-256 `fa1c297d8362e346dc8f79213894a964f201bc99409fde8202c4a0896bbe2d30`，不是旧011wrapper证明。产物同一chat-style目录的 `png-report.json`、`png-photo-320.png`、`transparent-report.json`、`transparent-list-light-320.png`、`transparent-list-dark-320.png`；临时 `verify-png.mjs`、`verify-transparent.mjs`、`synthetic-wallpaper.png`。专属Prettier再次通过。无设备/正式库操作，系统栏、native全局主题与实际壁纸选择器继续由根集成验收。
