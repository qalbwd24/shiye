# Android019 视觉校准

2026-10-19，接续018审阅。已读需求执行单、交接和018视觉记录，并实际查看 `content/android-rich-chat.png` 与用户QQ参考图。

本轮保留QQ窗口已确认比例，未改字号范围、留白参数、输入测高、消息动画、富文本内容或媒体身份。018实绘的白栏/灰中区/蓝气泡与富文本层次已成立，无需另加阴影、头像、装饰或增加高度。

## 交付

- `android/qq-chat/view.css`：回复条、媒体说明和状态文字改为随主题变化的中性辅助色；禁用发送按钮用现有chrome底色混合蓝色，避免深色中出现突兀的浅色块。尺寸不变。`panels.css`本轮未改。
- `android/ui-refinement-019/editor.css`：独立视觉覆盖，需主会话在实际editor.css之后加载或追加。固定顶栏使用已有surface和细分隔，正文继续保留sky/custom/none与本机壁纸偏好。工具激活态保留颜色并加不占布局的2px内底线；内联代码有轻底色；修正暗色高亮浅字浅底及表格UA文字颜色；引用线、图片说明随主题，首尾正文块去除多余margin。

编辑器沿桌面Tiptap/richdoc入口；未改原 `android/app/src/main/assets/editor.css`、JS、业务、原生或stage。没有修改用户正文字号、行距、字重、段距、字体选择、标题显示/元信息开关、触摸尺寸、工具栏高度、IME规则或保存状态。没有把QQ气泡样式套到长文。

## 验证

真实editor.html及两份既有CSS，加合成正文与新覆盖，在320×700 CSS px/DPR2的headless Chrome检查浅/深×写作/阅读4场景：正文13px保持、无横向溢出、高亮暗字、表格随正文色、阅读工具条仍隐藏。普通段落样本覆盖前后顶栏/页脚/工具栏/正文矩形完全一致。已查看深色写作截图，合成页未跑JS所以按钮disabled/字数0不是产品保存结果。

QQ三个主题与面板深浅基础检查复验通过，47px底栏及输入stable gutter保持。未重新验证Android/IME/真正Tiptap编辑或原件/同步；主会话最终需在实际019包看深色回复提示、阅读/写作切换与一条带高亮/代码的正文。没有运行全项目或无关全套。

产物：`outputs/2026-10-19-android-integration-019/aesthetics/`，含editor四图、receipt和chat子目录。临时：`tmp/android-integration-019/aesthetics/`。自有headless浏览器已关闭。

SHA-256：

- view.css：`cdb5ff151e5dcad1358720af97bae3f07887507a14b1b02dc22be9bde1e231c7`
- editor覆盖：`055fdea99e99abea654254736e0ed7a025aa767f5ecf08d288535408dbb13526`
- panels.css（未改）：`5cfff308edc0ee57a63674b2127b786015fc3f34f4bcf1dd1b6f72b54fb78ef0`

019源码视觉候选已交付，尚不能写成APK已包含或已部署。主会话维护总交接/执行单及最终安装状态。
