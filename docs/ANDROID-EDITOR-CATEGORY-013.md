# Android 0.13：紧凑思绪编辑与分类单页

2026-10-18。本轮修改仅editor.js/html/css与AppSettings.java；保留“服务连接”、Aa富文本、共享分割线/时间戳/缩进、图片小预览及原件身份。富文本参照电脑思绪快捷窗口，远端同步未完成。

## 编辑页

- 字数从正文尾部移至工具栏上方左侧的固定22px行，跟随实际viewport/键盘高度，不随正文滚走。
- 删除右下“保存于…”元素；自动保存中/成功均不弹提示，错误/只读保护仍可见且保存失败可点击重试。保存队列、revision及原件能力判断未绕过。
- 未配置字号时缺省15px，已有手动字号/行距偏好保持。顶部44px、页边14px；工具触摸区仍44px，避免单靠缩小触摸区实现紧凑。
- 排查源码确认编辑器只在boot挂载一次，ACK仅接版本/原件能力回执，不调用render/setBody。原saving浮层每次出现与savedTime反复清空/写回造成可见状态变化，本轮移除该变化；字数/附件图注/时间相同则不再重复写DOM。实际浏览器延迟ACK间继续输入，原.tiptap与原p节点身份和选区均保留。未把这项合成证据说成手机所有IME闪烁均已解决。
- 通过CSS min-height与尾部padding提供空白滚动空间，不插入空段或修改richdoc。320px空白样例列表client641px、scroll920px，可实际下滑180px且body/0保存保持。
- 颜色只消费宿主全局theme，浅色为不透明黑字＋84%白透明面板，深色为不透明浅字＋84%冷黑透明面板；同图切换不改变原图/veil选择。编辑背景和列表背景仍各自独立。

## 分类单页

入口：设置→启动与写作→分类管理，分类专用入口仍直接打开同页。新增、默认、改名、删除、搜索、长按拖动、上下移/首尾/指定序号集中在一页；新增/改名/删除只开必要的小确认/输入框，不进另一层排序页面。

新增/改名/删除/设默认沿现有LocalStore事务即时保存，界面明确说明；“取消默认”仅改新日记默认，不改已有篇分类。删除继续明确确认并保留原内容。排序始终只改orderDraft，保存排序仍是原saveCategoryOrder/baseRevision单事务；取消拖动不改草稿，返回未保存时提供“继续调整／放弃”。新增/删类后按稳定ID保留仍存在的排序草稿；默认回执更新当前版本，分类身份不重建。

分类ScrollView可纵向滚动。拖动边缘48dp内每32ms滚10dp；退出范围/取消/结束/关闭清理计时器。搜索后的source/target仍按完整草稿稳定ID定位。`themeChanged()`只给当前dialog调色，不重建分类草稿。

AppSettings根保留“服务连接”，新增全局外观及分别命名“写作页背景／思绪列表背景”。本轮不修改MainActivity、LocalStore、背景类或主题资源。

## 证据与边界

13项实际浏览器定向通过：延迟ACK连续输入与节点/选区保持、正确revision、成功无可见保存状态、错误重试、固定字数及键盘大小viewport、空白真实滚动且无数据填充、显式24px偏好保留、同图浅深透明面板及无页面错误。JS ESLint/Prettier/语法检查通过；未重跑不受影响的旧20项工具和5项缩略图矩阵。

使用实际资源aapt2生成本轮临时R后，14个当前Java源码对API36 javac通过；最新AppSettings控件描述追加后又单独编译通过。初次复用旧R.jar因缺AppThemeDark失败，随后用真实res生成解决，没有伪造R常量。临时manifest仅补Gradle namespace供独立资源编译，不改正式manifest。此为编译证据，不是产品打包或设备手势通过。

最终自审补丁：分类名称普通点击显式选中同一行，长按仍启动原生拖动。保存默认分类的回执仅在categoryOrder与orderBase完全一致时重基revision；若其他位置已改排序，保留旧baseRevision并提示核对，使后续排序保存走原有冲突保护，不能用默认分类的成功回执覆盖他端排序。补丁后的AppSettings再次对API36编译通过；未新增复制实现逻辑的镜像测试。

实际AVD分类拖动/默认/取消/保存恢复及自动滚动由根会话验；本轮未操作设备/真实库。AppSettings最终SHA-256：`4822370C78E6DAEE2B8ACD42F1CFAA95084A248BAE74B5D648B034C48EE0A12F`。编辑器三文件保持上一冻结版本。

产物：`outputs/2026-10-18-android-compact-013/editor-category/editor-verification.json`、`compact-keyboard-320.png`、`empty-scroll-320.png`；临时：`tmp/android-compact-013/editor-category/`（浏览器脚本、真实资源生成R、编译class与resources-only.apk，仅用于检查，不是交付安装包）。
