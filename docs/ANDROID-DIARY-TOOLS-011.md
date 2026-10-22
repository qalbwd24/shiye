# Android 0.11 思绪富文本工具与标签收纳

2026-10-18，本轮仅编辑器HTML/JS/CSS，富文本界面参照电脑“思绪”快捷窗口，**不是随想聊天窗口**；按用户最新[澄清](ANDROID-REFRESH-NAVIGATION-FEEDBACK.md)复用时间戳、分割线、Tab/段首缩进及智能换行习惯，并遵循 [电脑内容契约](DESKTOP-ANDROID-CONTENT-CONTRACT.md) 与现有richdoc/Tiptap。没有新存储格式、HTML转换、同步服务或数据迁移；远端同步尚未完成。

## 变化

- 标签入口及实际标签节点移到顶部更多设置内的属性折叠，正文日期/分类下不再显示标签或折叠按钮。已有展开偏好保留，仅作用于设置内；编辑标签后返回同一设置父页。
- 底部44px工具栏新增Aa“正文格式”按钮，展开单行可横滑格式架；再次点击收起。复用原有隐藏格式弹窗中的真实命令节点，不开新模态层、不替换正文编辑器或唤起另一个输入框。
- 提供撤销/重做、粗体/斜体/下划线/高亮/删除线、二级标题/普通段落、项目/编号列表、引用/代码块/分割线/清格式。图片信息控件仍使用原有出现身份，媒体附件呈现保持。
- 指针按下保住正文焦点和选区，文本格式走现有Android输入保护的capture/runAction；中文组词期间提示先完成输入并阻止命令。撤销/重做保留当前ProseMirror选区，也可用于非文字节点，并独立检查组词/只读。
- 高亮实际复核发现共享adapter调用不存在的toggleHighlight，主会话已在共享rich-body-adapter.js局部改为同一schema通用toggleMark('highlight')。Android仍调用共享adapter.command('hiliteColor')，不留手机专属高亮规则。共享修复尚需电脑日后常规更新采用，不代表本轮重启了电脑运行版。
- 0.10信封能力判断、未知格式只读保护、本地保存回执与空白draftOnly行为保留。

## 验证

按照手机实际逻辑宽度采用320px合成浏览器，并加26px正文大字边界。20项定向检查通过：标签不占正文、默认折叠且入口可见、准确选择原文及展开保持焦点选区、共享粗斜高亮生成真实marks、媒体blockId/assetId/occurrenceId/insertedAt/图注保持、连续操作、撤销/重做整篇结构往返、标题/列表结构及原blockId保持、组词阻写和即时提示、横向工具不撑宽、收起44px、设置父页标签编辑/保存、空白draftOnly ACK、未知版本0写入及无页面错误。

定向ESLint、Prettier、JS语法检查通过。没有操作设备、手机设置、Java、版本或构建；实际IME及AVD安装由主会话集成验证，不把浏览器composition事件当物理手机IME验证。

产物 `outputs/2026-10-18-android-refinement-011/editor/`：`verification.json`、`rich-tools-320.png`、`properties-320.png`，截图已查看。临时脚本 `tmp/android-refinement-011/editor/verify.mjs`。此前0.10的完整桌面fixture/schema/Tiptap往返证据仅按未改共享schema复用，本轮验证真实工具后的body往返。

## 用户追加：缩小图片附件预览

仅CSS调整：实际缩略图在`.attachment-grid .attachment-preview`，正文内rich-image仍是既有紧凑附件占位。附件列不再按屏宽均分放大，改为`min(104px,31vw)`固定小列；320px实际约99px，最多屏宽约三分之一。缩略图object-fit改contain完整展示，图注/时间在图外自然换行，编辑信息保留44px触摸高度。没有修改原件、压缩、widthRatio或occurrence/插入时间。

追加5项窄宽浏览器检查通过：实际约99px几何、图注时间不裁切与44px入口、图片编辑入口可达、完整richdoc及原widthRatio保持、纯视觉调整不触发保存。使用图片后含稳定空段的合成fixture，隔离共享Tiptap既有trailing-node行为；未重跑不受影响的20项工具矩阵。`small-thumbnails-320.png`已实际查看，报告`thumbnail-verification.json`，临时`verify-thumbnails.mjs`。截图与报告仍在本页专属产物目录。

## 思绪分割线入口补齐

仅HTML新增Aa横向工具按钮 `data-command="insertHorizontalRule"`，沿既有选区/组词保护调用共享adapter的divider命令；该命令折叠至选区末端后插入，不替换选中文字，不生成另一种HTML。1条320px实际Tiptap组合断言通过：选中BC后ABCD全文保留、hr在原图片之前、首尾原块ID保留、所有块ID唯一且原图片完整attrs保持。报告`divider-verification.json`，临时`verify-divider.mjs`。JS/CSS及既有20工具/5缩略图路径没有修改，复用原证据，不重复全量。
