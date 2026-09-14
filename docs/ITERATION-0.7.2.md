# 0.7.2 侧栏与日常输入

## 本轮需求与实现

- 导航标签位于导航栏右上边；列表标签位于列表右边，稍低于导航标签，显示分类、标签或全部日记的名称。图评标签位于媒体朝向正文的一边；收起后仍可点击。窄屏按可用区域保留入口。
- 常用标签紧随日记分类。页签沿用当前主题，不使用参考照片的强烈配色。
- 列表内部保持稳定宽度，减少开合期间的文字重排；媒体拖动每帧合并更新，页签位置先读取再集中写入。卡片摘要最多渲染 240 字，完整正文不变。
- 相册排序增加“随机排列”和“重新打乱相册”。随机种子保存在当前浏览器；重绘、筛选、加载更多和刷新沿用本轮顺序，不改变日记或附件自身顺序。
- 空白新日记默认两个全角空格，普通 Enter 换段自动加两个全角空格。Shift+Enter 为不自动缩进的软换行；输入法组词和列表、引用、标题、代码、表格遵守原编辑语义。
- 用户最终选择 Alt+T，插入本机时间，格式为 `[2026/09/14  23:15:11]`。不添加 CapsLock/F24 处理，不修改全局 AutoHotkey 脚本。
- 列表卡片以第一份图片附件作为淡色背景，文字仍可读；装饰图懒加载、异步解码，不复制图片。原图与媒体时间信息不变。

## 模块管理

根任务负责交互规划、main.js 与 features/index.js 装配、卡片背景、整体验收和发布。子 agent 分别负责 layout.js + workbench.css、album.js、editor-input.js + preferences。

- `features/editor-input.js`：原生换段后的缩进，日期格式，初始正文。`createEditorInput(c)` 回传 `initialContent`、`insertDateTime` 和 `dispose`。
- `features/entry-cards.js` / `styles/entry-cards.css`：装饰性列表封面，与正文编辑和图库排序独立。
- `features/layout.js`：布局偏好、合帧拖动、ResizeObserver 跟随边界；`#listToggleLabel` 由 main.js 用 textContent 同步。
- `features/album.js`：设备本地随机种子与随机排序；随机结果不写入库的媒体记录。
- `routes/preferences.mjs`：新增可选布尔值 `autoIndentParagraph`，缺省开启；旧 `autoIndent` 保留，不迁移旧正文。设置→编辑与记录可关闭新功能。

## 验证与边界

测试使用 `var/ui071-data` 的合成材料，继续由 18767 提供隔离服务；不复制正式日记作为样本。实际结果见 [验收记录](validation/0.7.2-validation.md)。不将 CUA 键盘测试当作真实微信输入法或用户自定义全局脚本验收。开合仍有容器宽度变化，不宣称消除了所有布局成本。
