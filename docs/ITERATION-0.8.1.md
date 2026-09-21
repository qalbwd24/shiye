# 0.8.1 编辑细节与工具收纳

用户最终要求继续直接使用 Markdown，取消此前“改回默认富文本”的提议。本轮不增加默认格式偏好、不转换旧库、不修改后端数据模型。

## 分工与模块

- `features/editor-toolbox.js` 只管理工具折叠，使用 `shiye.editor.tools-expanded` 记忆。默认收起；隐藏区 inert，键盘不会进入不可见控件。原按钮 ID、事件和正文选区沿用，展开本身不写日记。
- `index.html` 提供折叠容器；`body-editor.js` 将源码、原文、图片引用操作放入容器。`styles/markdown-editor.css` 控制过渡、减少动画偏好、普通时间文字和更清晰的分隔线。
- `markdownStructureEnter` 在当前行尾 Enter 时修复两全角格与结构语法的冲突，普通段落仍由 paragraphEnter 管理。事务进入同一撤销栈，不对读取、粘贴或备份执行全篇正则替换。
- `editor-input.js` 对 Markdown 时间插入转义方括号，旧富文本插入仍用纯文字。`live-preview.js` 隐藏非活动行的转义反斜杠、覆盖非链接方括号及独立日期的默认语法高亮。

## 语法依据与范围

参考 [Obsidian 基础语法](https://obsidian.md/help/syntax) 的标题、列表、引用、代码、分隔线和反斜杠转义，以及 [CommonMark 分隔线](https://spec.commonmark.org/0.31.2/#thematic-breaks) 的上下文规则。

三个 `-` 紧贴上一段、且没有日记自动缩进时，可能是合法 Setext 二级标题。保留这类现有语法；需要明确分隔线时使用独立段落或工具中的“分隔线”。带自动缩进的独立标记行在 Enter 时补必要的块边界。代码内的标记、合法链接和已有其他正文不改写。

这次没有实现 Obsidian 双链、公式、callout、插件加载或完整表格实时编辑；0.8 的兼容边界继续适用。验收见 [0.8.1 记录](validation/0.8.1-validation.md)。
