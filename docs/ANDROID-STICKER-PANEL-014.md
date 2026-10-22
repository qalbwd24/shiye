# Android 表情图库 014

2026-10-18；本轮源码冻结，根代理负责构建、保留式安装与设备验收。本轮仅合成收藏/隔离浏览器存储，不操作手机、AVD 或正式库。

## 已确认需求与实现

- Android 发送按钮空态、有字和等待状态使用同一上游 `icon-new-send` 小飞机（20 CSS px），空态仍不可发送，原发送/忙态业务保持。隐藏竞争的状态 glyph/Spinner，不更改原 handler。
- 符号面板只保留收藏表情图库，无 emoji 页签、大标题、默认帮助文案和每图下编辑/移除按钮。导入为 36px 点击区的小加号，保留共享模块原文件 input 与原件导入处理。即使由旧 emoji 命令打开，也转入同一个图库。
- 单击缩略图沿共享 picker 原 `onclick → materialize → editor.sendSticker → 本地 ACK`，空 caption 原件发送，草稿保留。没有复制发送管线或另建素材库。
- 长按约 420ms/鼠标右键打开管理：名称与备注复用共享 `promptEdit`（现有后台 note 上限 2000 UTF-16 码元），移除复用共享 API；原名称/备注仍供本地推荐索引使用。
- 顶部排序小图标切换管理模式；此模式触摸/鼠标直接拖动排序，点击缩略图进入管理，不发送。管理内前移/后移是可访问的按钮后备。普通模式允许列表触摸滚动，长按后可管理；排序模式缩略图 `touch-action:none` 以稳定拖动。
- 拖动使用稳定 asset ID；禁用图片的浏览器原生 dragstart，DOM 换位后重新获取 pointer capture，避免 Chromium 换位导致指针流丢失。pointercancel 还原原顺序，不提交；长按/拖动后的 click 被抑制。Android 返回先关管理，再关图库；输入框获得焦点沿原逻辑关闭图库。

## 本机排序契约

最新后台 `/api/stickers` 与 catalog/update 接口没有排序能力或受支持的 order DTO。本轮只保存本机 `shiyeLocalAssets` 的独立视图记录 `view:sticker-panel-order:v1`，不向收藏 DTO 塞入字段，不宣称排序云同步。

保存时读取并展开旧记录，保留未知字段，写 version/order。顺序为当前可见稳定 ID，追加旧顺序中当前未出现的 ID；临时缺失/移除的未知 ID 不丢弃。打开时已知 ID 按保存顺序，尚未出现在偏好中的新收藏沿共享列表原顺序追加。移除收藏不销毁排序偏好。素材原 Blob、来源映射、名称、备注及业务同步均继续由共享模块管理。

## 装配

`android-chat.js` 在共享 `shiye-input.js` 初始化后 await 导入并安装 `./android-sticker-panel.js`。构建需将新增 JS/CSS 复制进 `/telegram/`，JS 加入精确版本 importmap，HTML link `android-sticker-panel.css`，加载在已有 Android CSS 之后。不更改桌面共享 `shiye-input.js`。

## 验证

真实 Chrome（移动 UA/touch、320×780）加载实际 TL 构建及本轮最新源码，使用独立 IDB 与合成 PNG，17 项检查通过、pageerror 0：

1. 空/字/disabled+loading CSS 探针同一小飞机字形、20px/不透明/无动画；Spinner 隐藏但按钮 disabled 保持。
2. 单图库、无页签/标题/可见编辑按钮；导入仍有原 file input、点击区 36px。
3. 既有顺序与新项追加；长按管理及草稿保持；前移后备持久、未知字段和未知 ID 保留。
4. Android 返回先关管理；真实鼠标拖动、CDP 实际触摸拖动均保存且未发消息；pointercancel 还原。
5. 关闭后重开顺序保持；运行时新增收藏在已排序项之后。
6. 点击原共享缩略图 handler，真实本地发送 ACK 后关闭图库，草稿保持；实际 IDB 消息有媒体、caption 为空。
7. 长按名称/备注打开共享编辑器。

浏览器报告：`outputs/2026-10-18-android-media-014/panel/browser-report.json`。截图：`gallery-320.png`、`manage-320.png`、`empty-plane.png`、`busy-plane.png`。验证脚本：`tmp/android-media-014/panel/verify.mjs`。新增模块及 wrapper 定向 ESLint、四文件 Prettier 通过。

边界：忙态是 disabled/loading CSS 探针，不代表模拟了网络慢 ACK；图库发送确实走实际本地 worker ACK。本轮不重测共享后端来源校验、原件元数据/网络鉴权，不声称手机 IME/物理触摸或设备安装已验。关闭后重开测试等待原共享 close/focus 恢复完成（100ms），没有据此宣称同步零间隔开关已验证。没有运行系统文件选择器；只核查原 file input 留存。

## 冻结 SHA-256

| 文件 | SHA-256 |
| --- | --- |
| android/telegram-adapter/android-chat.js | c8e8f904dde5e2b81f83202f4285c7068c5ce8ec4eaf757eb8ccd49182f41453 |
| android/telegram-adapter/android-chat.css | bc0083cf700305308475dca4ab9723a18087c5c672233694c029914a2ca21729 |
| android/telegram-adapter/android-sticker-panel.js | c2fc5386703ccce3bd93b28019f723ba9e4e43956ae67c0e0f2e2882f9ce026c |
| android/telegram-adapter/android-sticker-panel.css | 0158b1762f241ff75d9be9ebebddbe09b1e5784f97f4cdb74da57d5ce8b272cc |
