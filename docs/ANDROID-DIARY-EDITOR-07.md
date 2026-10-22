# Android 0.7 思绪写读外壳

2026-10-17。按手机0.6反馈调整本页三资产`editor.html/css/js`；主会话统一负责原生外观设置、系统栏、空白草稿存储、构建与AVD。输入代理独立提供`android-editor-input.js`，本页仅接其API。当前已完成源码与合成浏览器定向验证，不等同APK/手机已更新。

## 标题、正文与工具

顶部直接提供可编辑“标题”输入，不再常驻“写日记/已保存到本机/阅读”文字。旧`showTitle:false`不阻挡顶部输入；保留旧标题和300字符上限，不为布局截断正文或标题。标题保持16px紧凑单行；右侧使用明确齿轮打开日记设置。常规保存状态不占行，保存中/失败临时显示，失败可点重试，未确认的输入仍在原页。

正文提示为“正文”。日期、分类、标签继续在正文上方；展开只显示标签，避免重复分类。阅读从设置“阅读本篇”进入，同一正文切只读；继续编辑保持原篇身份。没有新增引用插字功能。

底部为44px高的时间戳、真实两格缩进、图片三个纯图标操作，图形20px，每个44×44px触达并提供aria-label/title。沿现有viewport高度与安全区贴底；时间戳使用公共`insertDateTime`，缩进写入两个全角空格，图片仍走原`pickImage`。空图片区不再显示大标题/文案或占位，非空附件仍由canonical正文投影为原网格。

## 排版偏好与真实空行

现有`shiye.android.diary.presentation.v2`继续唯一保存本页排版，不进入Entry/body。新默认字号16px，范围8–40px；已存有效字号与行高继续读取。新增`fontWeight`400–700默认500、`paragraphSpacing`0–2em默认0；显式已存段距继续保留。行高仍为字号1.2–2.5倍，和段距独立。

默认段后距为0，使普通段落与时间戳hardBreak不再因隐含段后留白产生两种行距。显式空行仍是实际空段，不通过删空段压缩。共享Tiptap原有空段序列化会省略空`content:[]`字段，但保留该段及blockId；本轮没有修改公共核，也不将此原行为写成新数据迁移。独立字重为显示参数，原bold等内联标记保持。

设置延续即时预览、真实父子返回、显式保存/取消。小字号、40px上界、字重、行高和段距分别实测；取消恢复已保存值。

## 外观接口与无遮罩

`window.shiyeApplyAppearance(value)`沿既有背景字段，新增由原生持久化/选择的：

| 字段    | 值                        | 缺失回退 |
| ------- | ------------------------- | -------- |
| `theme` | `light` / `dark`          | `light`  |
| `veil`  | `none` / `light` / `dark` | `light`  |

theme只改文字、表面、字段、工具栏和Web弹窗配色，不改正文。原生系统栏由主会话管理。veil仅控制自定义背景上方遮罩：none透明、light轻白膜、dark深膜；已移除原自定义背景无条件白膜，正文与Tiptap容器均透明。**100%背景不透明度＋无遮罩才显示原图色彩**；none仍尊重既有opacity0.65等明确值，不静默升到1。新选图缺省1由原生提供，旧存储保持。

原固定`inset:-24px`会在blur0时也放大裁切，现改为blur的-3倍overscan：blur0为0，blur4为-12px。fill/position及图片本身仍按既有设置，cover仍有自身的宽高比裁切语义。

## 输入接线与空白草稿回执

本页动态导入`/android-editor-input.js`，在adapter挂载后调用`installAndroidEditorInput(adapter,{canEdit:()=>!reading&&!blocked,toast})`。时间戳/缩进的pointerdown先capture再preventDefault，click走runAction；不再以composing静默return。IME中的操作由helper提示用户完成输入，不插到错误位置；页面销毁释放位置和监听。软键盘Enter适配及其7项验证由输入代理负责，不在本页重复实现。

`getEntry/saveEntry`沿完整Entry回执及递增revision，原生使用`draftOnly:true`表示尚未成为正式记录，正式为false或省略。本页不自写空白判定或阻挡保存，ACK后只回读该布尔状态。空草稿状态文案为“未写内容”且平常隐藏，不显示正式已保存或保存时间；首个有内容ACK沿同ID转正式。分类/标签变化即使revision增加也不冒称已写正文。关闭空草稿meta清理、与公共`hasQuickContent`一致的判定、已有正式篇清空拒绝均由原生代理实现和主会话验收。

## 验证与边界

按[TESTING-POLICY](TESTING-POLICY.md)只验受影响页面。真实共享编辑核、合成正文/媒体、mock原生桥完成初版24项外观定向，覆盖标题、隐藏常规状态、工具尺寸、小字号/上界、独立排版、旧参数、窄屏、深浅及无遮罩、保存失败保留等。之后改段距0、接input helper/草稿ACK、修背景overscan，仅追加15项（含3次启动断言），前24项未受影响路径复用，不冒称最终包全矩阵重测。

最终定向确认真实缩进/时间戳位置、IME反馈、默认零段距、blur边界/旧opacity、draftOnly同ID/递增revision/转正式、已有图片身份和null插入时间。已查看普通/小字号/浅色无膜/浅膜/深膜/深色排版截图。语法、单文件ESLint、三资产及本文Prettier通过。实际中文键盘、Android系统Back/IME inset、原生持久化、安装和手机效果由主会话统一验收，未由浏览器模拟宣称完成。

[跨设备适配](ANDROID-CROSS-DEVICE-ADAPTATION.md)、[前端数据对齐](ANDROID-FRONTEND-DATA-ALIGNMENT.md)与[DATA-MODEL](DATA-MODEL.md)继续约束身份/原时间/未知能力只读保护。目前共用的是编辑核心和时间戳等模块；SQLite日记、Web A IndexedDB与桌面统一消息切分/队列尚未全部接通，本轮不宣称两端长文算法/格式/存储已全统一或远程同步已实现。

产物：`outputs/2026-10-17-android-diary-editor-07/`，`verification.json`及`integration-verification.json`分阶段记录；`wallpaper-none-final.png`反映最终blur0无overscan，较早外观图保留其阶段边界。临时：`tmp/android-diary-editor-07/verify.mjs`、`integration.mjs`。没有操作ADB、手机、真实日记、桌面运行程序或构建APK。

## 既有正式篇清空后的返回

原生`empty_entry`拒绝保存已清空的正式篇，保留原已保存内容。本页RPC错误现在只在内存Error属性保留响应`code/current`，不打印。普通自动保存仍显示明确失败；仅用户返回、flush遇到`empty_entry`时提供轻量确认：“继续编辑”或“放弃修改并返回”。说明涵盖本次正文、标题、分类、标签等全部尚未保存修改，原已保存日记保留。

放弃操作清理节流timer后直接调用`closeEditor`，不再次保存空内容、不删除任何篇；返回失败时确认保持打开并显示错误，当前输入保留。继续编辑/系统返回只关闭确认。新空草稿正常ACK/关闭不弹该确认，其他保存错误也不会误入本流程。

只追加2组合成mock验证并通过：`code/current`保留、自动保存不弹/返回才弹、继续编辑、放弃不新增保存请求且原件完全保持、关闭失败仍留页后可重试；普通磁盘错误保留编辑且不弹专用确认，新空草稿正常关闭。此前39项未重跑，语法/ESLint/Prettier仍通过。回执`empty-close-verification.json`；临时脚本`tmp/android-diary-editor-07/empty-close.mjs`。原生真实库原件保护仍由主会话统一验收。
